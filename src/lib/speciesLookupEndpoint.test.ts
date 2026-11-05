import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SAFE_ERROR_MESSAGES, ok, type AppResult } from "./appResult.ts";
import type { CurrentProfileResult } from "./currentProfile.ts";
import type { ApplicationRole } from "../types/database.ts";
import {
  EXTERNAL_SPECIES_NAME_MAX_LENGTH,
  EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH,
  type ExternalSpeciesNameMatch,
} from "./externalSpecies.ts";
import {
  SPECIES_LOOKUP_REQUEST_MESSAGES,
  handleSpeciesLookupGet,
  type SpeciesLookupEndpointDependencies,
  type SpeciesNameLookupRecord,
} from "./speciesLookupEndpoint.ts";

const ENDPOINT = "https://amber.test/api/species/lookup";
const SECRET = "sb_secret_test_key";

const matches: ExternalSpeciesNameMatch[] = [
  { id: "tyrannosaurus-rex", scientific_name: "Tyrannosaurus rex" },
];

function profile(status: "ok", role: ApplicationRole): CurrentProfileResult;
function profile(status: "unauthenticated" | "unlinked" | "error"): CurrentProfileResult;
function profile(
  status: CurrentProfileResult["status"],
  role?: ApplicationRole,
): CurrentProfileResult {
  if (status === "ok") {
    return {
      status: "ok",
      supabase: {} as SupabaseClient,
      authUserId: "auth-user-1",
      profileId: "profile-1",
      role: role ?? "management",
    };
  }
  if (status === "unlinked") {
    return { status: "unlinked", authUserId: "auth-user-1" };
  }
  if (status === "error") {
    return {
      status: "error",
      message: `profile lookup failed at db.internal with ${SECRET}`,
    };
  }
  return { status: "unauthenticated" };
}

function dependencies(options: {
  profile?: CurrentProfileResult | (() => Promise<CurrentProfileResult>);
  matches?: AppResult<ExternalSpeciesNameMatch[]>;
  onProfile?: () => void;
  onLookup?: (speciesName: string) => void;
}): SpeciesLookupEndpointDependencies & { lookupCalls: string[] } {
  const lookupCalls: string[] = [];
  return {
    lookupCalls,
    getCurrentProfile: async () => {
      options.onProfile?.();
      if (typeof options.profile === "function") return options.profile();
      return options.profile ?? profile("ok", "management");
    },
    lookupSpeciesByName: async (speciesName) => {
      lookupCalls.push(speciesName);
      options.onLookup?.(speciesName);
      return options.matches ?? ok(matches);
    },
  };
}

function lookupRequest(
  query = "name=Tyrannosaurus%20Rex",
  headers: Record<string, string> = {},
  method = "GET",
): Request {
  return new Request(`${ENDPOINT}?${query}`, {
    method,
    headers: {
      origin: "https://amber.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}

async function readBody(response: Response): Promise<{
  ok?: boolean;
  data?: SpeciesNameLookupRecord[];
  error?: { code?: string; message?: string };
}> {
  return response.json() as Promise<{
    ok?: boolean;
    data?: SpeciesNameLookupRecord[];
    error?: { code?: string; message?: string };
  }>;
}

describe("species lookup endpoint authorisation", () => {
  test("returns name matches for management", async () => {
    const deps = dependencies({});
    const order: string[] = [];
    deps.getCurrentProfile = async () => {
      order.push("profile");
      return profile("ok", "management");
    };
    deps.lookupSpeciesByName = async (speciesName) => {
      order.push("lookup");
      deps.lookupCalls.push(speciesName);
      return ok([
        {
          id: "tyrannosaurus-rex",
          scientific_name: "Tyrannosaurus rex",
          diet_profile: "carnivore",
        } as ExternalSpeciesNameMatch,
      ]);
    };

    const response = await handleSpeciesLookupGet(
      lookupRequest("name=Tyrannosaurus%20Rex"),
      deps,
    );
    const body = await readBody(response);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(body, {
      ok: true,
      data: [
        {
          external_species_id: "tyrannosaurus-rex",
          scientific_name: "Tyrannosaurus rex",
        },
      ],
    });
    assert.equal(JSON.stringify(body).includes("carnivore"), false);
    assert.deepEqual(deps.lookupCalls, ["Tyrannosaurus Rex"]);
    assert.deepEqual(order, ["profile", "lookup"]);
  });

  test("allows a same-origin GET that omits Origin", async () => {
    const deps = dependencies({});
    const response = await handleSpeciesLookupGet(
      new Request(`${ENDPOINT}?name=Rex`, {
        method: "GET",
        headers: { "sec-fetch-site": "same-origin" },
      }),
      deps,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(deps.lookupCalls, ["Rex"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("rejects an unauthenticated caller before lookup", async () => {
    const deps = dependencies({ profile: profile("unauthenticated") });
    const response = await handleSpeciesLookupGet(
      lookupRequest("name=Tyrannosaurus%20Rex&role=management"),
      deps,
    );
    const body = await readBody(response);

    assert.equal(response.status, 401);
    assert.deepEqual(body.error, {
      code: "unauthenticated",
      message: SAFE_ERROR_MESSAGES.unauthenticated,
    });
    assert.deepEqual(deps.lookupCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(JSON.stringify(body).includes("Tyrannosaurus"), false);
  });

  test("rejects unlinked, employee and senior callers before lookup", async () => {
    const cases: Array<{ name: string; profile: CurrentProfileResult }> = [
      { name: "unlinked", profile: profile("unlinked") },
      { name: "employee", profile: profile("ok", "employee") },
      { name: "senior", profile: profile("ok", "senior") },
    ];

    for (const item of cases) {
      const deps = dependencies({ profile: item.profile });
      const response = await handleSpeciesLookupGet(
        lookupRequest("name=Tyrannosaurus%20Rex"),
        deps,
      );
      const body = await readBody(response);

      assert.equal(response.status, 403, item.name);
      assert.equal(body.ok, false, item.name);
      assert.equal(body.error?.code, "unauthorized", item.name);
      assert.equal(
        body.error?.message,
        item.name === "unlinked"
          ? SAFE_ERROR_MESSAGES.unlinked
          : SAFE_ERROR_MESSAGES.unauthorized,
        item.name,
      );
      assert.equal(body.data, undefined, item.name);
      assert.deepEqual(deps.lookupCalls, [], item.name);
      assert.equal(response.headers.get("cache-control"), "no-store", item.name);
    }
  });

  test("reports a profile lookup failure without internal details", async () => {
    const deps = dependencies({ profile: profile("error") });
    const response = await handleSpeciesLookupGet(lookupRequest(), deps);
    const body = await readBody(response);
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 500);
    assert.deepEqual(body.error, {
      code: "database",
      message: SAFE_ERROR_MESSAGES.database,
    });
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes("db.internal"), false);
    assert.deepEqual(deps.lookupCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("hides a thrown authentication failure", async () => {
    const deps = dependencies({
      profile: async () => {
        throw new Error(`Missing EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY ${SECRET}`);
      },
    });
    const response = await handleSpeciesLookupGet(lookupRequest(), deps);
    const serialised = JSON.stringify(await readBody(response));

    assert.equal(response.status, 500);
    assert.equal(serialised.includes("EXTERNAL_SPECIES"), false);
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes("stack"), false);
    assert.deepEqual(deps.lookupCalls, []);
  });
});

describe("species lookup endpoint requests", () => {
  test("rejects missing, duplicate, extra and oversized name parameters", async () => {
    const queries = [
      "",
      "role=management",
      "name=",
      "name=Rex&name=Rex",
      "name=Rex&limit=1000",
      `name=${"R".repeat(EXTERNAL_SPECIES_NAME_MAX_LENGTH + 1)}`,
      `name=${encodeURIComponent(`${" ".repeat(EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH)}Rex`)}`,
      "name=Tyrannosaurus*",
      "name=T.rex",
      "name=or(id.eq.abelisaurus)",
    ];

    for (const query of queries) {
      const deps = dependencies({});
      const response = await handleSpeciesLookupGet(lookupRequest(query), deps);
      const body = await readBody(response);

      assert.equal(response.status, 400, query);
      assert.equal(body.error?.code, "validation", query);
      assert.equal(
        body.error?.message,
        SPECIES_LOOKUP_REQUEST_MESSAGES.invalidName,
        query,
      );
      assert.deepEqual(deps.lookupCalls, [], query);
      assert.equal(response.headers.get("cache-control"), "no-store", query);
      assert.equal(JSON.stringify(body).includes("abelisaurus"), false, query);
    }
  });

  test("accepts an 80-character name with surrounding space", async () => {
    const name = `A${"b".repeat(EXTERNAL_SPECIES_NAME_MAX_LENGTH - 1)}`;
    const deps = dependencies({});
    const response = await handleSpeciesLookupGet(
      lookupRequest(`name=${encodeURIComponent(` ${name} `)}`),
      deps,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(deps.lookupCalls, [name]);
  });

  test("returns an empty list when the lookup has no matches", async () => {
    const deps = dependencies({ matches: ok([]) });
    const response = await handleSpeciesLookupGet(lookupRequest("name=Notasaurus"), deps);
    const body = await readBody(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, data: [] });
    assert.deepEqual(deps.lookupCalls, ["Notasaurus"]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("rejects a cross-origin request before authentication", async () => {
    let profileCalls = 0;
    const deps = dependencies({
      onProfile: () => {
        profileCalls += 1;
      },
    });
    const response = await handleSpeciesLookupGet(
      lookupRequest("name=Rex", {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
      deps,
    );
    const body = await readBody(response);

    assert.equal(response.status, 403);
    assert.equal(body.error?.message, SPECIES_LOOKUP_REQUEST_MESSAGES.origin);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(profileCalls, 0);
    assert.deepEqual(deps.lookupCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("rejects a non-GET method before lookup", async () => {
    const deps = dependencies({});
    const response = await handleSpeciesLookupGet(
      lookupRequest("name=Rex", {}, "POST"),
      deps,
    );

    assert.equal(response.status, 405);
    assert.deepEqual(deps.lookupCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("hides upstream and thrown lookup failures", async () => {
    const leaked = `provider body ${SECRET} at https://mwewivvwhdittuffkcrr.supabase.co/rest/v1/species`;
    const cases: Array<{
      result: AppResult<ExternalSpeciesNameMatch[]>;
      status: number;
      code?: string;
    }> = [
      {
        result: { ok: false, error: { code: "unexpected", message: leaked } },
        status: 500,
      },
      {
        result: {
          ok: false,
          error: { code: "unauthorized", message: SAFE_ERROR_MESSAGES.unauthorized },
        },
        status: 500,
      },
      {
        result: {
          ok: false,
          error: { code: "validation", message: "The external species data is invalid." },
        },
        status: 502,
        code: "unexpected",
      },
      {
        result: {
          ok: false,
          error: { code: "unexpected", message: "The external species data is invalid." },
        },
        status: 502,
        code: "unexpected",
      },
      {
        result: {
          ok: false,
          error: { code: "not_found", message: "secret upstream 404" },
        },
        status: 502,
        code: "unexpected",
      },
    ];

    for (const item of cases) {
      const deps = dependencies({ matches: item.result });
      const response = await handleSpeciesLookupGet(lookupRequest("name=Rex"), deps);
      const body = await readBody(response);
      const serialised = JSON.stringify(body);

      assert.equal(response.status, item.status);
      if (item.code) assert.equal(body.error?.code, item.code);
      if (item.status === 502) {
        assert.equal(body.error?.message?.includes("not found"), false);
        assert.equal(
          body.error?.message === "The external species data is invalid." ||
            body.error?.message === "The external species service is unavailable.",
          true,
        );
      }
      assert.equal(serialised.includes(SECRET), false);
      assert.equal(serialised.includes("supabase.co"), false);
      assert.equal(serialised.includes("provider body"), false);
      assert.equal(serialised.includes("secret upstream"), false);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }

    const thrown = dependencies({
      onLookup: () => {
        throw new Error(leaked);
      },
    });
    const response = await handleSpeciesLookupGet(lookupRequest("name=Rex"), thrown);
    const serialised = JSON.stringify(await readBody(response));
    assert.equal(response.status, 500);
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes("stack"), false);
  });
});
