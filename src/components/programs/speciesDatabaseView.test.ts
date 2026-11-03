import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAppFailure, SAFE_ERROR_MESSAGES } from "../../lib/appResult.ts";
import { authenticatedQueryKey } from "../../lib/queryCacheIsolation.ts";
import {
  fetchLocalSpecies,
  filterSpeciesByName,
  parseSpeciesList,
  resolveSelectedSpeciesId,
  sortLocalSpecies,
  SPECIES_DATABASE_QUERY_KEY,
  SPECIES_LIST_PAGE_SIZE,
  type LocalSpecies,
} from "./speciesDatabaseView.ts";

const ID = {
  amber: "00000000-0000-4000-8000-000000000001",
  cedar: "00000000-0000-4000-8000-000000000002",
  amberUpper: "00000000-0000-4000-8000-000000000003",
  bramble: "00000000-0000-4000-8000-000000000004",
} as const;

function row(
  id: string,
  displayName: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    display_name: displayName,
    general_description: `${displayName} description`,
    diet_preferences: `${displayName} diet`,
    habitat_preferences: `${displayName} habitat`,
    handling_guidance: `${displayName} handling`,
    minimum_handlers: 2,
    safety_class: "moderate",
    ...overrides,
  };
}

function parsed(payload: unknown): LocalSpecies[] {
  const result = parseSpeciesList(payload);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected a species list");
  return result.data;
}

const FIXTURE = [
  row(ID.cedar, "Cedar"),
  row(ID.amberUpper, "Amber"),
  row(ID.bramble, "bramble"),
  row(ID.amber, "amber"),
];

test("species list query scope is user-prefixed by the authenticated cache", () => {
  assert.deepEqual(
    authenticatedQueryKey("user-a", SPECIES_DATABASE_QUERY_KEY),
    ["auth-user", "user-a", "species-database", "list"],
  );
});

test("names sort alphabetically without regard to case, then by id", () => {
  const original = [...FIXTURE];
  const species = parsed(FIXTURE);

  assert.deepEqual(
    species.map((entry) => entry.display_name),
    ["amber", "Amber", "bramble", "Cedar"],
  );
  assert.deepEqual(
    species.map((entry) => entry.id),
    [ID.amber, ID.amberUpper, ID.bramble, ID.cedar],
  );
  assert.equal(original[0].display_name, "Cedar");
  assert.deepEqual(
    sortLocalSpecies(species).map((entry) => entry.id),
    species.map((entry) => entry.id),
  );
});

test("stored text is kept verbatim", () => {
  const [species] = parsed([
    row(ID.amber, "  Amber Lynx  ", {
      general_description: "  Lives in the reed beds.  ",
      safety_class: "high",
      minimum_handlers: 3,
    }),
  ]);

  assert.equal(species.display_name, "  Amber Lynx  ");
  assert.equal(species.general_description, "  Lives in the reed beds.  ");
  assert.equal(species.safety_class, "high");
  assert.equal(species.minimum_handlers, 3);
});

test("search matches display_name regardless of case", () => {
  const species = parsed(FIXTURE);

  assert.deepEqual(
    filterSpeciesByName(species, "AMBER").map((entry) => entry.id),
    [ID.amber, ID.amberUpper],
  );
  assert.deepEqual(
    filterSpeciesByName(species, "cEdAr").map((entry) => entry.display_name),
    ["Cedar"],
  );
  assert.equal(filterSpeciesByName(species, "   ").length, species.length);
  assert.deepEqual(filterSpeciesByName(species, "lynx"), []);
});

test("a visible selection is kept, and a hidden one is replaced without being restored", () => {
  const species = parsed(FIXTURE);
  let selectedId = resolveSelectedSpeciesId(species, null);
  assert.equal(selectedId, ID.amber);

  selectedId = ID.amberUpper;
  const amberMatches = filterSpeciesByName(species, "amber");
  selectedId = resolveSelectedSpeciesId(amberMatches, selectedId);
  assert.equal(selectedId, ID.amberUpper);

  selectedId = ID.cedar;
  const hidden = filterSpeciesByName(species, "amber");
  selectedId = resolveSelectedSpeciesId(hidden, selectedId);
  assert.equal(selectedId, ID.amber);

  const cleared = filterSpeciesByName(species, "");
  selectedId = resolveSelectedSpeciesId(cleared, selectedId);
  assert.equal(selectedId, ID.amber);
  assert.equal(resolveSelectedSpeciesId([], ID.cedar), null);
});

test("an empty payload is an empty list, and invalid payloads are failures", () => {
  assert.deepEqual(parseSpeciesList([]), { ok: true, data: [] });

  for (const payload of [
    null,
    { species: [] },
    [row(ID.amber, "amber"), row(ID.cedar, "Cedar", { safety_class: "Low" })],
    [row(ID.amber, "amber", { minimum_handlers: 0 })],
    [row(ID.amber, "amber", { minimum_handlers: "2" })],
    [row(ID.amber, "amber", { general_description: "   " })],
    [row(ID.amber, "   ")],
  ]) {
    const result = parseSpeciesList(payload);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "validation");
  }
});

const SPECIES_COLUMNS =
  "id, display_name, general_description, diet_preferences, habitat_preferences, handling_guidance, minimum_handlers, safety_class";

type SpeciesPage = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type SpeciesQueryCall = {
  signal: AbortSignal;
  from: number;
  to: number;
  orders: string[];
};

function idFor(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function pageOf(count: number, start: number) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return row(idFor(index), `Species ${String(index).padStart(4, "0")}`);
  });
}

function speciesClient(pageFor: (from: number) => SpeciesPage) {
  const calls: SpeciesQueryCall[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "species_database");
      return {
        select(query: string) {
          assert.equal(query, SPECIES_COLUMNS);
          const orders: string[] = [];
          const builder = {
            order(column: string) {
              orders.push(column);
              return builder;
            },
            range(from: number, to: number) {
              return {
                abortSignal(signal: AbortSignal) {
                  calls.push({ signal, from, to, orders: [...orders] });
                  return Promise.resolve(pageFor(from));
                },
              };
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

function singlePage(page: SpeciesPage) {
  return speciesClient(() => page);
}

test("a query error or invalid row does not become an empty list", async () => {
  const signal = new AbortController().signal;

  const emptyRead = singlePage({ data: [], error: null });
  const empty = await fetchLocalSpecies(emptyRead.supabase, signal);
  assert.deepEqual(empty, []);
  assert.equal(emptyRead.calls[0]?.signal, signal);
  assert.deepEqual(emptyRead.calls[0]?.orders, ["display_name", "id"]);
  assert.deepEqual(emptyRead.calls[0] && [emptyRead.calls[0].from, emptyRead.calls[0].to], [
    0,
    SPECIES_LIST_PAGE_SIZE - 1,
  ]);

  const sorted = await fetchLocalSpecies(
    singlePage({ data: FIXTURE, error: null }).supabase,
    signal,
  );
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    [ID.amber, ID.amberUpper, ID.bramble, ID.cedar],
  );

  await assert.rejects(
    () =>
      fetchLocalSpecies(
        singlePage({
          data: null,
          error: { code: "XX000", message: "internal secret details" },
        }).supabase,
        signal,
      ),
    (error: unknown) => {
      assert.equal(isAppFailure(error), true);
      if (!isAppFailure(error)) return false;
      assert.equal(error.code, "database");
      assert.equal(error.message, SAFE_ERROR_MESSAGES.database);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchLocalSpecies(
        singlePage({
          data: [row(ID.amber, "amber", { safety_class: "severe" })],
          error: null,
        }).supabase,
        signal,
      ),
    (error: unknown) => {
      assert.equal(isAppFailure(error), true);
      if (!isAppFailure(error)) return false;
      assert.equal(error.code, "validation");
      return true;
    },
  );

  await assert.rejects(
    () =>
      fetchLocalSpecies(
        singlePage({ data: null, error: null }).supabase,
        signal,
      ),
    (error: unknown) => {
      assert.equal(isAppFailure(error), true);
      if (!isAppFailure(error)) return false;
      assert.equal(error.code, "validation");
      return true;
    },
  );
});

test("a species read continues until a short page and keeps rows past the cap", async () => {
  const signal = new AbortController().signal;
  const lynxId = idFor(SPECIES_LIST_PAGE_SIZE + 1);
  const read = speciesClient((from) => {
    if (from === 0) {
      return { data: pageOf(SPECIES_LIST_PAGE_SIZE, 1), error: null };
    }
    if (from === SPECIES_LIST_PAGE_SIZE) {
      return { data: [row(lynxId, "Beyond Lynx")], error: null };
    }
    return { data: [], error: null };
  });

  const species = await fetchLocalSpecies(read.supabase, signal);
  assert.equal(species.length, SPECIES_LIST_PAGE_SIZE + 1);
  assert.deepEqual(
    filterSpeciesByName(species, "lynx").map((entry) => entry.id),
    [lynxId],
  );
  assert.deepEqual(
    read.calls.map((call) => [call.from, call.to]),
    [
      [0, SPECIES_LIST_PAGE_SIZE - 1],
      [SPECIES_LIST_PAGE_SIZE, SPECIES_LIST_PAGE_SIZE * 2 - 1],
    ],
  );
  assert.deepEqual(read.calls[1]?.orders, ["display_name", "id"]);
  assert.equal(read.calls[0]?.signal, signal);
  assert.equal(read.calls[1]?.signal, signal);
});

test("a later page failure or invalid row does not return the earlier page", async () => {
  const signal = new AbortController().signal;
  const failed = speciesClient((from) => {
    if (from === 0) {
      return { data: pageOf(SPECIES_LIST_PAGE_SIZE, 1), error: null };
    }
    return {
      data: pageOf(SPECIES_LIST_PAGE_SIZE, 1),
      error: { code: "XX000", message: "later page secret" },
    };
  });

  await assert.rejects(
    () => fetchLocalSpecies(failed.supabase, signal),
    (error: unknown) => {
      assert.equal(isAppFailure(error), true);
      if (!isAppFailure(error)) return false;
      assert.equal(error.code, "database");
      assert.equal(error.message, SAFE_ERROR_MESSAGES.database);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );
  assert.equal(failed.calls.length, 2);
  assert.equal(failed.calls[1]?.signal, signal);

  const invalid = speciesClient((from) => {
    if (from === 0) {
      return { data: pageOf(SPECIES_LIST_PAGE_SIZE, 1), error: null };
    }
    return {
      data: [row(idFor(SPECIES_LIST_PAGE_SIZE + 1), "Beyond Lynx", { safety_class: "severe" })],
      error: null,
    };
  });

  await assert.rejects(
    () => fetchLocalSpecies(invalid.supabase, signal),
    (error: unknown) => {
      assert.equal(isAppFailure(error), true);
      if (!isAppFailure(error)) return false;
      assert.equal(error.code, "validation");
      return true;
    },
  );
  assert.equal(invalid.calls.length, 2);
});
