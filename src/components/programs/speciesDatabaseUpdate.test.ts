import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAppFailure, SAFE_ERROR_MESSAGES } from "../../lib/appResult.ts";
import { authenticatedQueryKey, type AuthAccessSnapshot } from "../../lib/queryCacheIsolation.ts";
import { SPECIES_DATABASE_QUERY_KEY, SPECIES_LIST_COLUMNS } from "./speciesDatabaseView.ts";
import {
  canEditLocalSpecies,
  createSpeciesUpdateMutation,
  SPECIES_UPDATE_MUTATION_KEY,
  type SpeciesUpdateClient,
  type SpeciesUpdateInput,
} from "./speciesDatabaseUpdate.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const UPDATED_AT = "2026-03-15T14:30:45.123456+00:00";
const NEXT_UPDATED_AT = "2026-11-07T16:28:00.654321Z";

const FIELDS = {
  display_name: "  Amber Lynx  ",
  general_description: "  Lives in the reed beds.  ",
  diet_preferences: "Fish and shorebirds",
  habitat_preferences: "Reed beds",
  handling_guidance: "Keep two handlers on the near side.",
  minimum_handlers: 2,
  safety_class: "high",
} as const;

const ALLOWED_COLUMNS = [
  "display_name",
  "general_description",
  "diet_preferences",
  "habitat_preferences",
  "handling_guidance",
  "minimum_handlers",
  "safety_class",
] as const;

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
  select: string;
};

function access(
  role: string | null,
  overrides: Partial<AuthAccessSnapshot> = {},
): AuthAccessSnapshot {
  return {
    status: "ready",
    userId: "user-a",
    permissionStatus: "active",
    role,
    displayName: "Ada",
    accessEpoch: 4,
    presentation: role
      ? { id: 1, userId: overrides.userId ?? "user-a", role }
      : null,
    ...overrides,
  };
}

function input(overrides: Partial<SpeciesUpdateInput> = {}): SpeciesUpdateInput {
  return {
    id: ID,
    updated_at: UPDATED_AT,
    fields: FIELDS,
    ...overrides,
  };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    ...FIELDS,
    updated_at: NEXT_UPDATED_AT,
    ...overrides,
  };
}

function updateClient(response: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: UpdateCall[] = [];
  const supabase = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const filters: { column: string; value: unknown }[] = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return builder;
            },
            select(query: string) {
              calls.push({ table, payload, filters: [...filters], select: query });
              return Promise.resolve(response);
            },
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

function harness(options: {
  role?: string | null;
  response?: { data: unknown; error: { code?: string; message?: string } | null };
  verified?: AuthAccessSnapshot | null;
  after?: AuthAccessSnapshot[];
  started?: AuthAccessSnapshot;
  refreshError?: unknown;
}) {
  const role = options.role === undefined ? "senior" : options.role;
  const started = options.started ?? access(role);
  const verified = options.verified === undefined ? started : options.verified;
  const after = [...(options.after ?? [started, started])];
  const database = updateClient(
    options.response ?? { data: [storedRow()], error: null },
  );
  let refreshes = 0;
  let supabaseReads = 0;
  const client: SpeciesUpdateClient = {
    supabase: () => {
      supabaseReads += 1;
      return database.supabase;
    },
    started: () => started,
    refreshAccess: async () => {
      refreshes += 1;
      if (options.refreshError) throw options.refreshError;
      return verified;
    },
    accessAfter: () => after.shift() ?? started,
  };
  return {
    mutation: createSpeciesUpdateMutation(client),
    calls: database.calls,
    refreshes: () => refreshes,
    supabaseReads: () => supabaseReads,
  };
}

async function save(
  run: ReturnType<typeof harness>,
  userId = "user-a",
  value: SpeciesUpdateInput = input(),
) {
  return run.mutation.mutationFn(value, { userId });
}

function appFailure(
  error: unknown,
  code: "validation" | "unauthorized" | "unauthenticated" | "conflict" | "database" | "unexpected",
) {
  assert.equal(isAppFailure(error), true);
  if (!isAppFailure(error)) return false;
  assert.equal(error.code, code);
  assert.equal(error.message, SAFE_ERROR_MESSAGES[code]);
  assert.equal(error.message.includes("secret"), false);
  return true;
}

test("species editing is offered only to an active senior or management session", () => {
  assert.equal(canEditLocalSpecies(access("senior")), true);
  assert.equal(canEditLocalSpecies(access("management")), true);
  assert.equal(canEditLocalSpecies(access("employee")), false);
  assert.equal(canEditLocalSpecies(access(null)), false);
  assert.equal(canEditLocalSpecies(access("senior", { permissionStatus: "unknown" })), false);
  assert.equal(canEditLocalSpecies(access("senior", { permissionStatus: "revoked" })), false);
  assert.equal(canEditLocalSpecies(access("senior", { status: "suspended", role: null })), false);
  assert.equal(canEditLocalSpecies(access("senior", { userId: "" })), false);
  assert.equal(canEditLocalSpecies(access("senior", {
    presentation: { id: 1, userId: "user-a", role: "employee" },
  })), true);
  assert.equal(canEditLocalSpecies(access("employee", {
    presentation: { id: 2, userId: "user-a", role: "management" },
  })), false);
});

test("species update mutation scope is user-prefixed and does not retry", () => {
  assert.deepEqual(
    authenticatedQueryKey("user-a", SPECIES_UPDATE_MUTATION_KEY),
    ["auth-user", "user-a", "species-database", "update"],
  );
  const run = harness({});
  assert.equal(run.mutation.retry, false);
  assert.equal(run.mutation.gcTime, 0);
});

test("a senior or management editor writes the seven fields and returns the new row", async () => {
  for (const role of ["senior", "management"] as const) {
    const run = harness({ role });
    const saved = await save(run);
    assert.equal(saved.display_name, FIELDS.display_name);
    assert.equal(saved.general_description, FIELDS.general_description);
    assert.equal(saved.updated_at, NEXT_UPDATED_AT);
    assert.notEqual(saved.updated_at, new Date(NEXT_UPDATED_AT).toISOString());
    assert.equal(run.calls.length, 1);
    assert.equal(run.refreshes(), 1);
  }
});

test("the update writes only permitted columns and filters on the original timestamp", async () => {
  const run = harness({});
  await save(run, "user-a", input({
    fields: {
      ...FIELDS,
      id: ID,
      external_species_id: "amber-lynx",
      created_at: UPDATED_AT,
      updated_at: NEXT_UPDATED_AT,
      updated_by: "00000000-0000-4000-8000-000000000099",
    },
  }));

  const [call] = run.calls;
  assert.equal(call?.table, "species_database");
  assert.equal(call?.select, SPECIES_LIST_COLUMNS);
  assert.deepEqual(Object.keys(call?.payload ?? {}).toSorted(), [...ALLOWED_COLUMNS].toSorted());
  assert.deepEqual(call?.payload, FIELDS);
  assert.deepEqual(call?.filters, [
    { column: "id", value: ID },
    { column: "updated_at", value: UPDATED_AT },
  ]);
  assert.notEqual(call?.filters[1]?.value, new Date(UPDATED_AT).toISOString());
  assert.equal(Object.hasOwn(call?.payload ?? {}, "updated_by"), false);
  assert.equal(Object.hasOwn(call?.payload ?? {}, "external_species_id"), false);
});

test("zero rows is a conflict and does not retry", async () => {
  const run = harness({ response: { data: [], error: null } });
  await assert.rejects(
    () => save(run),
    (error: unknown) => appFailure(error, "conflict"),
  );
  assert.equal(run.calls.length, 1);
});

test("database errors, extra rows and malformed rows are not success", async () => {
  const secret = { data: [storedRow()], error: { code: "XX000", message: "internal secret" } };
  const denied = { data: [storedRow()], error: { code: "42501", message: "permission secret" } };
  const cases = [
    { response: secret, code: "database" as const },
    { response: denied, code: "unauthorized" as const },
    { response: { data: null, error: null }, code: "unexpected" as const },
    { response: { data: storedRow(), error: null }, code: "unexpected" as const },
    { response: { data: [storedRow(), storedRow({ id: OTHER_ID })], error: null }, code: "unexpected" as const },
    { response: { data: [storedRow({ id: OTHER_ID })], error: null }, code: "unexpected" as const },
    { response: { data: [storedRow({ safety_class: "severe" })], error: null }, code: "validation" as const },
  ];

  for (const entry of cases) {
    const run = harness({ response: entry.response });
    await assert.rejects(
      () => save(run),
      (error: unknown) => appFailure(error, entry.code),
    );
    assert.equal(run.calls.length, 1);
  }
});

test("invalid input fails before the role recheck or the write", async () => {
  const run = harness({});
  const { display_name: _name, ...withoutName } = FIELDS;
  for (const value of [
    input({ id: "amber" }),
    input({ updated_at: "2026-03-15T14:30:45" }),
    input({ fields: null }),
    input({ fields: withoutName }),
    input({ fields: { ...FIELDS, minimum_handlers: 0 } }),
    input({ fields: { ...FIELDS, safety_class: "severe" } }),
    input({ fields: { ...FIELDS, display_name: "   " } }),
  ]) {
    await assert.rejects(
      () => save(run, "user-a", value),
      (error: unknown) => appFailure(error, "validation"),
    );
  }
  assert.equal(run.refreshes(), 0);
  assert.equal(run.supabaseReads(), 0);
  assert.equal(run.calls.length, 0);
});

test("a stable employee, a presentation-only role and a signed-out session do not write", async () => {
  const employee = harness({ role: "employee" });
  await assert.rejects(
    () => save(employee),
    (error: unknown) => appFailure(error, "unauthorized"),
  );

  const remembered = harness({
    started: access("employee", {
      presentation: { id: 9, userId: "user-a", role: "management" },
    }),
  });
  await assert.rejects(
    () => save(remembered),
    (error: unknown) => appFailure(error, "unauthorized"),
  );

  const signedOut = harness({
    started: access(null, {
      status: "anonymous",
      userId: null,
      permissionStatus: "unknown",
      role: null,
      presentation: null,
    }),
  });
  await assert.rejects(
    () => save(signedOut, ""),
    (error: unknown) => appFailure(error, "unauthenticated"),
  );

  assert.equal(employee.calls.length, 0);
  assert.equal(remembered.calls.length, 0);
  assert.equal(signedOut.calls.length, 0);
  assert.equal(employee.refreshes(), 1);
  assert.equal(employee.supabaseReads(), 0);
});

test("a role, user or epoch change after the fresh check does not write or report success", async () => {
  const demoted = harness({
    verified: access("employee"),
    after: [access("employee")],
  });
  const switched = harness({
    verified: access("senior", { userId: "user-b", accessEpoch: 5 }),
    after: [access("senior", { userId: "user-b", accessEpoch: 5 })],
  });
  const restarted = harness({
    verified: access("senior", { accessEpoch: 8 }),
    after: [access("senior", { accessEpoch: 8 })],
  });
  const mismatchedUser = harness({});

  for (const run of [demoted, switched, restarted]) {
    await assert.rejects(
      () => save(run),
      (error: unknown) => {
        assert.equal(error instanceof Error && error.name, "AuthenticatedQueryIdentityError");
        return true;
      },
    );
    assert.equal(run.calls.length, 0);
    assert.equal(run.supabaseReads(), 0);
  }

  await assert.rejects(
    () => save(mismatchedUser, "user-b"),
    (error: unknown) => error instanceof Error && error.name === "AuthenticatedQueryIdentityError",
  );
  assert.equal(mismatchedUser.calls.length, 0);
});

test("an inconclusive recheck rejects without writing and distinguishes a changed owner", async () => {
  const unchanged = harness({ verified: null });
  await assert.rejects(() => save(unchanged), (error: unknown) => appFailure(error, "database"));
  assert.equal(unchanged.calls.length, 0);
  assert.equal(unchanged.supabaseReads(), 0);

  for (const after of [
    access("employee"),
    access("senior", { userId: "user-b" }),
    access("senior", { accessEpoch: 5 }),
    access(null, { status: "anonymous", userId: null, permissionStatus: "unknown" }),
  ]) {
    const changed = harness({ verified: null, after: [after] });
    await assert.rejects(() => save(changed),
      (error: unknown) => error instanceof Error && error.name === "AuthenticatedQueryIdentityError");
    assert.equal(changed.calls.length, 0);
    assert.equal(changed.supabaseReads(), 0);
  }
});

test("a role change after the write rejects the row instead of reporting success", async () => {
  const run = harness({ after: [access("senior"), access("employee")] });
  await assert.rejects(
    () => save(run),
    (error: unknown) => error instanceof Error && error.name === "AuthenticatedQueryIdentityError",
  );
  assert.equal(run.calls.length, 1);
});

test("a thrown client or a failed recheck does not become a successful write", async () => {
  let reads = 0;
  const thrown = createSpeciesUpdateMutation({
    supabase: () => {
      reads += 1;
      throw new Error("socket secret");
    },
    started: () => access("senior"),
    refreshAccess: async () => access("senior"),
    accessAfter: () => access("senior"),
  });
  await assert.rejects(
    () => thrown.mutationFn(input(), { userId: "user-a" }),
    (error: unknown) => appFailure(error, "unexpected"),
  );
  assert.equal(reads, 1);

  const refresh = harness({ refreshError: new Error("profile secret") });
  await assert.rejects(
    () => save(refresh),
    (error: unknown) => appFailure(error, "unexpected"),
  );
  assert.equal(refresh.supabaseReads(), 0);
  assert.equal(refresh.calls.length, 0);
});

test("success merges the exact saved version before invalidating the scoped list", async () => {
  const run = harness({ response: { data: [storedRow({ display_name: "Zulu renamed" })], error: null } });
  const saved = await save(run);
  const caller: unknown[] = [];
  const writes: unknown[] = [];
  const rows = [{ ...saved, updated_at: UPDATED_AT }, { ...saved, id: OTHER_ID, display_name: "Aardvark" }];
  await run.mutation.onSuccess(saved, input(), undefined, {
    cache: {
      getQueryData: <T>(scope: readonly unknown[]) => {
        assert.deepEqual(scope, SPECIES_DATABASE_QUERY_KEY);
        return rows as T;
      },
      setQueryData: (scope, data) => { writes.push({ scope, data }); },
      invalidateQueries: async (scope) => {
        assert.equal(writes.length, 1);
        caller.push(scope);
      },
    },
  });
  assert.deepEqual(caller, [SPECIES_DATABASE_QUERY_KEY]);
  assert.deepEqual(writes, [{ scope: SPECIES_DATABASE_QUERY_KEY, data: [rows[1], saved] }]);
  assert.equal(saved.updated_at, NEXT_UPDATED_AT);
  assert.deepEqual(
    authenticatedQueryKey("user-a", SPECIES_DATABASE_QUERY_KEY),
    ["auth-user", "user-a", "species-database", "list"],
  );
  assert.notDeepEqual(
    authenticatedQueryKey("user-a", SPECIES_DATABASE_QUERY_KEY),
    authenticatedQueryKey("user-b", SPECIES_DATABASE_QUERY_KEY),
  );
  assert.equal(caller.some((scope) => JSON.stringify(scope).includes("user-b")), false);
});
