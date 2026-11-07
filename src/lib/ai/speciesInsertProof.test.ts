import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

import { mintSpeciesInsertProof, SPECIES_INSERT_PROOF_HEADER } from "./speciesInsertProof.ts";

const ENV_KEY = "SPECIES_INSERT_PROOF_SECRET";
const TEST_KEY = "2b".repeat(32);
const PROFILE_ID = "a492ce32-054a-41b2-8c2b-97cc49b0b7e7";
const OTHER_PROFILE_ID = "4e786f4f-978f-4b7e-98c6-2a6103bd6452";
const AUTH_ID = "a83de29d-d84f-47e9-9180-80130499b568";
const entry = {
  external_species_id: "bramble-back",
  display_name: 'Brambleback "Río" 🦕',
  general_description: "Near C:\\Reserves\nEast bank: low ground.",
  diet_preferences: "Leaves\tand fruit",
  habitat_preferences: "Wetlands of Łódź",
  handling_guidance: "Keep to the keeper's path.",
  minimum_handlers: 2,
  safety_class: "moderate",
} as const;

function mint(profileId = PROFILE_ID) {
  const previousKey = process.env[ENV_KEY];
  process.env[ENV_KEY] = TEST_KEY;
  try {
    const proof = mintSpeciesInsertProof(profileId, entry);
    assert.equal(proof.ok, true);
    return proof.data;
  } finally {
    if (previousKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previousKey;
  }
}

test("fails closed for missing or malformed signing configuration", () => {
  const previousKey = process.env[ENV_KEY];
  try {
    delete process.env[ENV_KEY];
    assert.equal(mintSpeciesInsertProof(PROFILE_ID, entry).ok, false);
    process.env[ENV_KEY] = "not-a-32-byte-key";
    assert.equal(mintSpeciesInsertProof(PROFILE_ID, entry).ok, false);
  } finally {
    if (previousKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previousKey;
  }
});

test("Supabase sends the proof on one insert alongside the caller's bearer token", async () => {
  const proof = mint();
  const requests: Headers[] = [];
  const supabase = createClient("https://amber.invalid", "sb_publishable_fixture", {
    accessToken: async () => "test-caller-token",
    global: {
      fetch: async (url, init) => {
        assert.equal(String(url), "https://amber.invalid/rest/v1/species_database");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), entry);
        requests.push(new Headers(init?.headers));
        return new Response(null, { status: 201 });
      },
    },
  });

  const table = supabase.from("species_database");
  assert.equal((await table.insert(entry).setHeader(SPECIES_INSERT_PROOF_HEADER, proof)).error, null);
  assert.equal((await table.insert(entry)).error, null);
  assert.match(proof, /^v1\.[0-9]{10}\.[0-9a-f]{64}$/);
  assert.equal(requests[0]?.get(SPECIES_INSERT_PROOF_HEADER), proof);
  assert.equal(requests[0]?.get("authorization"), "Bearer test-caller-token");
  assert.equal(requests[1]?.has(SPECIES_INSERT_PROOF_HEADER), false);
});

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

// Opt in with psql and a disposable, empty loopback Postgres cluster owned by amber_test.
// Fixtures simulate Supabase Auth and the restricted Vault view. All repository migrations run.
const psql = process.env.AMBER_TEST_PSQL;
const port = process.env.AMBER_TEST_PG_PORT;
test("PostgreSQL verifies JS proofs, expiry bounds, role, audit and uniqueness", {
  skip: !psql || !port,
}, ({ mock }) => {
  assert.ok(psql && port && /^\d{4,5}$/.test(port));
  const migrations = new URL("../../../supabase/migrations/", import.meta.url);
  const schema = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readFileSync(new URL(name, migrations), "utf8")).join("\n");

  const proof = mint();
  const otherProfile = mint(OTHER_PROFILE_ID);
  const forged = proof.slice(0, -1) + (proof.endsWith("0") ? "1" : "0");
  mock.timers.enable({ apis: ["Date"], now: Date.now() - 120_000 });
  const expired = mint();
  mock.timers.reset();

  const caller = `set local role authenticated;
    set local "request.jwt.claims" = '${JSON.stringify({ sub: AUTH_ID, role: "authenticated" })}';`;
  const attempt = (header?: string, row: Record<string, unknown> = entry) =>
    `select pg_temp.try_insert_species(${literal(JSON.stringify(row))}::jsonb, ${header ? literal(header) : "null"});`;

  const encodedFields = Object.values(entry).map((value) => Buffer.from(String(value), "utf8").toString("hex"));
  const expiryCases = [
    { seconds: -1, status: "42501" },
    { seconds: 0, status: "42501" },
    { seconds: 1, status: "23505" },
    { seconds: 61, status: "23505" },
    { seconds: 65, status: "23505" },
    { seconds: 66, status: "42501" },
  ];
  // Sign relative to the same statement clock the verifier uses. These run
  // after insertion, so 23505 means the proof passed RLS and reached uniqueness.
  const attemptAtExpiryOffset = (seconds: number) => `
    with expiry as (select floor(extract(epoch from statement_timestamp()))::bigint + (${seconds}) as at)
    select pg_temp.try_insert_species(${literal(JSON.stringify(entry))}::jsonb,
      'v1.' || at || '.' || encode(extensions.hmac(convert_to(
        'amber:species-enrichment-insert:v1:' || at || ${literal(`:${PROFILE_ID}:${encodedFields.join(":")}`)},
        'UTF8'), decode('${TEST_KEY}', 'hex'), 'sha256'), 'hex'))
    from expiry;`;

  const changedRows = Object.entries(entry).map(([key, value]) => ({
    ...entry,
    [key]: typeof value === "number" ? value + 1 : key === "safety_class" ? "high" : `${value}-changed`,
  }));

  const result = spawnSync(psql, ["-XqAtw", "-h", "127.0.0.1", "-p", port,
    "-U", "amber_test", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    input: `
      begin;
      set local standard_conforming_strings = on;
      create role anon;
      create role authenticated;
      create role service_role;
      create schema extensions;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
      $$;
      create function auth.role() returns text language sql stable as $$
        select current_setting('request.jwt.claims', true)::jsonb ->> 'role'
      $$;
      grant usage on schema auth to authenticated;
      create schema vault;
      create table vault.decrypted_secrets (name text unique, decrypted_secret text);
      ${schema}
      create function pg_temp.try_insert_species(input jsonb, proof text) returns text language plpgsql as $$
      declare
        candidate public.species_database := jsonb_populate_record(null::public.species_database, input);
        actor uuid;
      begin
        perform set_config('request.headers',
          jsonb_strip_nulls(jsonb_build_object('${SPECIES_INSERT_PROOF_HEADER}', proof))::text, true);
        insert into public.species_database (external_species_id, display_name, general_description,
          diet_preferences, habitat_preferences, handling_guidance, minimum_handlers, safety_class)
        values (candidate.external_species_id, candidate.display_name, candidate.general_description,
          candidate.diet_preferences, candidate.habitat_preferences, candidate.handling_guidance,
          candidate.minimum_handlers, candidate.safety_class)
        returning updated_by into actor;
        return actor::text;
      exception when insufficient_privilege or unique_violation then
        return sqlstate;
      end;
      $$;
      insert into auth.users (id, email) values ('${AUTH_ID}', 'management@example.invalid');
      update public.profiles set id = '${PROFILE_ID}', role = 'management' where auth_user_id = '${AUTH_ID}';
      ${caller}
      ${attempt(proof)}
      reset role;
      insert into vault.decrypted_secrets values ('species_database_insert_proof_v1', '${TEST_KEY}');
      ${caller}
      ${[undefined, "broken", forged, expired, otherProfile].map((header) => attempt(header)).join("\n")}
      ${changedRows.map((row) => attempt(proof, row)).join("\n")}
      ${attempt(proof)}
      ${attempt(proof)}
      reset role;
      -- The fixture signer needs pgcrypto to mint proofs at exact SQL clock boundaries.
      grant usage on schema extensions to authenticated;
      ${caller}
      ${expiryCases.map(({ seconds }) => attemptAtExpiryOffset(seconds)).join("\n")}
      reset role;
      update public.profiles set role = 'senior' where id = '${PROFILE_ID}';
      ${caller}
      ${attempt(proof)}
      select has_column_privilege('public.species_database', 'updated_by', 'INSERT');
      reset role;
      select has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT');
      rollback;
    `,
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    ...Array(6 + changedRows.length).fill("42501"), PROFILE_ID, "23505",
    ...expiryCases.map(({ status }) => status), "42501", "f", "f",
  ]);
});
