import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAppFailure, SAFE_ERROR_MESSAGES } from "../../lib/appResult.ts";
import { authenticatedQueryKey } from "../../lib/queryCacheIsolation.ts";
import {
  applySpecimenList,
  EMPTY_SUBJECT_SELECTION,
  fetchSpecimensForSpecies,
  filterSpecimensBySpecies,
  parseSpecimenList,
  reduceReportSubject,
  specimenOptionLabel,
  specimensForSpeciesQueryKey,
  SPECIMEN_LIST_COLUMNS,
  SPECIMEN_LIST_PAGE_SIZE,
  type SpecimenOption,
  type SubjectSelection,
} from "./specimenSelection.ts";

const SPECIES = {
  lynx: "00000000-0000-4000-8000-0000000000a1",
  fern: "00000000-0000-4000-8000-0000000000c1",
  bramble: "00000000-0000-4000-8000-0000000000b1",
} as const;

const SPECIMEN = {
  ash: "00000000-0000-4000-8000-0000000000a2",
  birch: "00000000-0000-4000-8000-0000000000a3",
  moss: "00000000-0000-4000-8000-0000000000c2",
} as const;

const CATALOGUE = [
  { id: SPECIES.lynx },
  { id: SPECIES.fern },
  { id: SPECIES.bramble },
];

function specimen(
  id: string,
  speciesId: string,
  assetCode: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    species_id: speciesId,
    asset_code: assetCode,
    nickname: null,
    status: "active",
    ...overrides,
  };
}

function parsed(payload: unknown): SpecimenOption[] {
  const result = parseSpecimenList(payload);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected a specimen list");
  return result.data;
}

const ASH = specimen(SPECIMEN.ash, SPECIES.lynx, "rapt-01", {
  nickname: "Ash",
  status: "active",
});
const BIRCH = specimen(SPECIMEN.birch, SPECIES.lynx, "RAPT-02", {
  nickname: "Birch",
  status: "quarantine",
});
const MOSS = specimen(SPECIMEN.moss, SPECIES.fern, "FERN-01", {
  nickname: "  ",
  status: "under_treatment",
});

function chooseSpecies(selection: SubjectSelection, speciesId: string) {
  return reduceReportSubject(selection, { type: "species", speciesId });
}

function chooseSpecimen(
  selection: SubjectSelection,
  specimenId: string | null,
  specimens: readonly SpecimenOption[],
) {
  return reduceReportSubject(selection, {
    type: "specimen",
    specimenId,
    specimens,
  });
}

function receiveList(
  selection: SubjectSelection,
  speciesId: string,
  specimens: readonly SpecimenOption[],
) {
  return reduceReportSubject(selection, {
    type: "records",
    species: CATALOGUE,
    response: { speciesId, specimens },
  });
}

test("specimen list query scope is user-prefixed and separated by species", () => {
  assert.deepEqual(
    authenticatedQueryKey("user-a", specimensForSpeciesQueryKey(SPECIES.lynx)),
    ["auth-user", "user-a", "specimens", "by-species", SPECIES.lynx],
  );
  assert.notDeepEqual(
    specimensForSpeciesQueryKey(SPECIES.lynx),
    specimensForSpeciesQueryKey(SPECIES.fern),
  );
});

test("specimens from several species filter by species, including an empty species", () => {
  const original = [BIRCH, MOSS, ASH];
  const lynx = filterSpecimensBySpecies(parsed(original), SPECIES.lynx);
  const fern = filterSpecimensBySpecies(parsed(original), SPECIES.fern);
  const bramble = filterSpecimensBySpecies(parsed(original), SPECIES.bramble);

  assert.deepEqual(lynx.map((entry) => entry.id), [SPECIMEN.ash, SPECIMEN.birch]);
  assert.deepEqual(fern.map((entry) => entry.id), [SPECIMEN.moss]);
  assert.deepEqual(bramble, []);
  assert.equal(original[0].asset_code, "RAPT-02");
  assert.equal(specimenOptionLabel(lynx[0]), "rapt-01 — Ash (active)");
  assert.equal(specimenOptionLabel(fern[0]), "FERN-01 (under_treatment)");
});

test("asset codes follow PostgreSQL trim and keep the stored text", () => {
  for (const assetCode of [" RAPT-01 ", "\tRAPT-01", "\nRAPT-01\n", "\u00A0RAPT-01", "\t", "\u00A0", " \t "]) {
    const [row] = parsed([specimen(SPECIMEN.ash, SPECIES.lynx, assetCode)]);
    assert.equal(row.asset_code, assetCode);
  }
  for (const assetCode of ["", " ", "   "]) {
    const result = parseSpecimenList([specimen(SPECIMEN.ash, SPECIES.lynx, assetCode)]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "validation");
  }
});

test("a specimen row with a missing nickname or unknown status is rejected", () => {
  const missingNickname: Record<string, unknown> = { ...ASH };
  delete missingNickname.nickname;
  for (const payload of [
    [missingNickname],
    [specimen(SPECIMEN.ash, SPECIES.lynx, "   ")],
    [specimen(SPECIMEN.ash, SPECIES.lynx, "rapt-01", { status: "Active" })],
    [specimen(SPECIMEN.ash, SPECIES.lynx, "rapt-01", { nickname: 1 })],
    [specimen(SPECIMEN.ash, "lynx", "rapt-01")],
    null,
  ]) {
    const result = parseSpecimenList(payload);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "validation");
  }
  assert.equal(parsed([specimen(SPECIMEN.ash, SPECIES.lynx, "rapt-01", { nickname: null })])[0]?.nickname, null);
});

test("changing species clears the specimen, which stays optional", () => {
  const lynx = parsed([ASH, BIRCH]);
  const fern = parsed([MOSS]);
  let selection = chooseSpecies(EMPTY_SUBJECT_SELECTION, SPECIES.lynx);
  selection = chooseSpecimen(selection, SPECIMEN.ash, lynx);
  assert.deepEqual(selection, { speciesId: SPECIES.lynx, specimenId: SPECIMEN.ash });

  selection = chooseSpecimen(selection, null, lynx);
  assert.deepEqual(selection, { speciesId: SPECIES.lynx, specimenId: null });

  selection = chooseSpecimen(selection, SPECIMEN.ash, lynx);
  const sameSpecies = chooseSpecies(selection, SPECIES.lynx);
  assert.equal(sameSpecies, selection);

  selection = chooseSpecies(selection, SPECIES.fern);
  assert.deepEqual(selection, { speciesId: SPECIES.fern, specimenId: null });

  const otherSpecies = chooseSpecimen(selection, SPECIMEN.ash, [...lynx, ...fern]);
  assert.equal(otherSpecies.specimenId, null);
  assert.equal(otherSpecies.speciesId, SPECIES.fern);

  selection = chooseSpecimen(selection, SPECIMEN.moss, fern);
  assert.equal(selection.specimenId, SPECIMEN.moss);
  selection = reduceReportSubject(selection, { type: "species", speciesId: null });
  assert.deepEqual(selection, EMPTY_SUBJECT_SELECTION);
});

test("a stale specimen response cannot restore a specimen from another species", () => {
  const lynx = parsed([ASH, BIRCH]);
  const fern = parsed([MOSS]);
  let selection = chooseSpecies(EMPTY_SUBJECT_SELECTION, SPECIES.lynx);
  selection = chooseSpecimen(selection, SPECIMEN.ash, lynx);
  selection = chooseSpecies(selection, SPECIES.bramble);
  assert.equal(selection.specimenId, null);

  const staleLynx = receiveList(selection, SPECIES.lynx, lynx);
  assert.equal(staleLynx, selection);
  assert.equal(staleLynx.specimenId, null);

  const mixed = receiveList(selection, SPECIES.bramble, [...lynx, ...fern]);
  assert.equal(mixed, selection);

  const emptySpecies = receiveList(selection, SPECIES.bramble, []);
  assert.deepEqual(emptySpecies, {
    speciesId: SPECIES.bramble,
    specimenId: null,
  });

  selection = chooseSpecies(EMPTY_SUBJECT_SELECTION, SPECIES.lynx);
  selection = chooseSpecimen(selection, SPECIMEN.ash, lynx);
  const unrelatedEmpty = applySpecimenList(selection, SPECIES.fern, []);
  assert.equal(unrelatedEmpty.specimenId, SPECIMEN.ash);

  const stillThere = receiveList(selection, SPECIES.lynx, lynx);
  assert.equal(stillThere.specimenId, SPECIMEN.ash);

  const removed = receiveList(selection, SPECIES.lynx, parsed([BIRCH]));
  assert.deepEqual(removed, { speciesId: SPECIES.lynx, specimenId: null });

  selection = chooseSpecies(stillThere, SPECIES.fern);
  selection = chooseSpecies(selection, SPECIES.lynx);
  const lateOriginalList = receiveList(selection, SPECIES.lynx, lynx);
  assert.equal(lateOriginalList.specimenId, null);
  assert.equal(lateOriginalList.speciesId, SPECIES.lynx);
});

test("an empty specimen list keeps the species selected", () => {
  let selection = chooseSpecies(EMPTY_SUBJECT_SELECTION, SPECIES.bramble);
  selection = receiveList(selection, SPECIES.bramble, []);
  assert.deepEqual(selection, { speciesId: SPECIES.bramble, specimenId: null });

  const unavailable = reduceReportSubject(selection, {
    type: "records",
    species: CATALOGUE,
    response: null,
  });
  assert.equal(unavailable, selection);

  const missingSpecies = reduceReportSubject(selection, {
    type: "records",
    species: [{ id: SPECIES.lynx }],
    response: null,
  });
  assert.deepEqual(missingSpecies, EMPTY_SUBJECT_SELECTION);
});

type SpecimenPage = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type SpecimenQueryCall = {
  signal: AbortSignal;
  speciesId: string;
  from: number;
  to: number;
  orders: string[];
};

function specimenClient(pageFor: (from: number, speciesId: string) => SpecimenPage) {
  const calls: SpecimenQueryCall[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "specimens");
      return {
        select(query: string) {
          assert.equal(query, SPECIMEN_LIST_COLUMNS);
          return {
            eq(column: string, speciesId: string) {
              assert.equal(column, "species_id");
              const orders: string[] = [];
              const builder = {
                order(columnName: string) {
                  orders.push(columnName);
                  return builder;
                },
                range(from: number, to: number) {
                  return {
                    abortSignal(signal: AbortSignal) {
                      calls.push({
                        signal,
                        speciesId,
                        from,
                        to,
                        orders: [...orders],
                      });
                      return Promise.resolve(pageFor(from, speciesId));
                    },
                  };
                },
              };
              return builder;
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

test("a specimen read is filtered by species and does not turn errors into an empty list", async () => {
  const signal = new AbortController().signal;
  const blocked = {
    from() {
      throw new Error("should not query");
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    () => fetchSpecimensForSpecies(blocked, "not-a-species", signal),
    (error: unknown) => {
      assert.equal(isAppFailure(error), true);
      if (!isAppFailure(error)) return false;
      assert.equal(error.code, "validation");
      return true;
    },
  );

  const emptyRead = specimenClient(() => ({ data: [], error: null }));
  const empty = await fetchSpecimensForSpecies(emptyRead.supabase, SPECIES.bramble, signal);
  assert.deepEqual(empty, []);
  assert.equal(emptyRead.calls[0]?.speciesId, SPECIES.bramble);
  assert.equal(emptyRead.calls[0]?.signal, signal);
  assert.deepEqual(emptyRead.calls[0]?.orders, ["asset_code", "id"]);
  assert.deepEqual(
    emptyRead.calls[0] && [emptyRead.calls[0].from, emptyRead.calls[0].to],
    [0, SPECIMEN_LIST_PAGE_SIZE - 1],
  );

  const lynxRead = specimenClient((_from, speciesId) => ({
    data: speciesId === SPECIES.lynx ? [BIRCH, ASH] : [MOSS],
    error: null,
  }));
  const lynx = await fetchSpecimensForSpecies(lynxRead.supabase, SPECIES.lynx, signal);
  assert.deepEqual(lynx.map((entry) => entry.id), [SPECIMEN.ash, SPECIMEN.birch]);
  assert.equal(lynxRead.calls[0]?.speciesId, SPECIES.lynx);

  const fern = await fetchSpecimensForSpecies(
    specimenClient(() => ({ data: [], error: null })).supabase,
    SPECIES.bramble,
    signal,
  );
  assert.deepEqual(fern, []);

  await assert.rejects(
    () =>
      fetchSpecimensForSpecies(
        specimenClient(() => ({
          data: [ASH],
          error: { code: "XX000", message: "internal secret details" },
        })).supabase,
        SPECIES.lynx,
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
      fetchSpecimensForSpecies(
        specimenClient(() => ({ data: [ASH, MOSS], error: null })).supabase,
        SPECIES.lynx,
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

test("a specimen read continues until a short page", async () => {
  const signal = new AbortController().signal;
  const extraId = "00000000-0000-4000-8000-000000001001";
  const read = specimenClient((from) => {
    if (from === 0) {
      return {
        data: Array.from({ length: SPECIMEN_LIST_PAGE_SIZE }, (_, index) =>
          specimen(
            `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
            SPECIES.lynx,
            `RAPT-${String(index + 1).padStart(4, "0")}`,
          ),
        ),
        error: null,
      };
    }
    return {
      data: [specimen(extraId, SPECIES.lynx, "RAPT-9999")],
      error: null,
    };
  });

  const specimens = await fetchSpecimensForSpecies(read.supabase, SPECIES.lynx, signal);
  assert.equal(specimens.length, SPECIMEN_LIST_PAGE_SIZE + 1);
  assert.equal(specimens.at(-1)?.id, extraId);
  assert.equal(read.calls.length, 2);
  assert.equal(read.calls[1]?.speciesId, SPECIES.lynx);
  assert.equal(read.calls[1]?.signal, signal);
});
