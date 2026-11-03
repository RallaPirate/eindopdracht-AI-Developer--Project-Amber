import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { SAFE_ERROR_MESSAGES } from "./appResult.ts";
import { getExternalSpecies, type ExternalSpecies } from "./externalSpecies.ts";

const ENV_KEYS = [
  "EXTERNAL_SPECIES_SUPABASE_URL",
  "EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const EXTERNAL_ORIGIN = "https://mwewivvwhdittuffkcrr.supabase.co";
const PUBLISHABLE_KEY = "test-publishable-key";
const MAIN_APP_KEY = "main-app-publishable-key";

const SELECT_COLUMNS = [
  "id",
  "scientific_name",
  "diet_profile",
  "geological_period",
  "region",
  "social_requirements",
  "general_care_recommendations",
  "hybrid",
  "franchise_origins",
  "franchise_appearances",
].join(",");

type RecordedRequest = {
  url: string;
  method: string;
  cache: string | undefined;
  redirect: string | undefined;
  headers: Headers;
  signal: AbortSignal | undefined;
};

const previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let requests: RecordedRequest[] = [];
const originalFetch = globalThis.fetch;

function speciesRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "abelisaurus",
    scientific_name: "  Abelisaurus comahuensis  ",
    diet_profile: "carnivore",
    geological_period: null,
    region: "  Isla Nublar  ",
    social_requirements: "solitary",
    general_care_recommendations: "Reference text only.",
    hybrid: false,
    franchise_origins: ["jurassic-park", "jurassic-world"],
    franchise_appearances: [],
    unexpected_extra: "ignore me",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  responder: (request: RecordedRequest) => Promise<Response> | Response,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const recorded: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      cache: init?.cache,
      redirect: init?.redirect,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? undefined,
    };
    requests.push(recorded);
    return responder(recorded);
  }) as typeof fetch;
}

beforeEach(() => {
  requests = [];
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  process.env.EXTERNAL_SPECIES_SUPABASE_URL = EXTERNAL_ORIGIN;
  process.env.EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://amber-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = MAIN_APP_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe("getExternalSpecies", { concurrency: 1 }, () => {
  test("retrieves one species and keeps nullable fields and arrays", async () => {
    const origins = ["jurassic-park", "jurassic-world"];
    installFetch(() => jsonResponse([speciesRecord({ franchise_origins: origins })]));

    const result = await getExternalSpecies("  abelisaurus  ");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const species: ExternalSpecies = result.data;
    assert.equal(species.id, "abelisaurus");
    assert.equal(species.scientific_name, "  Abelisaurus comahuensis  ");
    assert.equal(species.diet_profile, "carnivore");
    assert.equal(species.geological_period, null);
    assert.equal(species.region, "  Isla Nublar  ");
    assert.equal(species.social_requirements, "solitary");
    assert.equal(species.general_care_recommendations, "Reference text only.");
    assert.equal(species.hybrid, false);
    assert.deepEqual(species.franchise_origins, origins);
    assert.notEqual(species.franchise_origins, origins);
    assert.deepEqual(species.franchise_appearances, []);
    assert.equal("unexpected_extra" in species, false);
    assert.equal(requests.length, 1);
  });

  test("rejects malformed identifiers before any network request", async () => {
    installFetch(() => jsonResponse([]));
    const samples: unknown[] = [
      "",
      "   ",
      "Abelisaurus",
      "abelisaurus rex",
      "abelisaurus/id",
      "../abelisaurus",
      "abelisaurus&select=*",
      "-abelisaurus",
      "abelisaurus-",
      "a".repeat(129),
      null,
      12,
      { id: "abelisaurus" },
    ];

    for (const sample of samples) {
      const result = await getExternalSpecies(sample);
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.error.code, "validation");
      assert.equal(result.error.message, "Species identifier is invalid.");
    }

    assert.equal(requests.length, 0);
  });

  test("returns not_found when the identifier matches no species", async () => {
    installFetch(() => jsonResponse([]));

    const result = await getExternalSpecies("missing-species");

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: "not_found",
        message: SAFE_ERROR_MESSAGES.not_found,
      },
    });
    assert.equal(requests.length, 1);
  });

  test("maps upstream 401 and 403 to unauthorized and other HTTP failures to unavailable", async () => {
    installFetch(() => jsonResponse({ message: "secret upstream detail" }, 401));
    const denied = await getExternalSpecies("abelisaurus");
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.error.code, "unauthorized");
      assert.equal(denied.error.message, SAFE_ERROR_MESSAGES.unauthorized);
      assert.equal(denied.error.message.includes("secret"), false);
    }

    installFetch(() => new Response("forbidden", { status: 403 }));
    const forbidden = await getExternalSpecies("abelisaurus");
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.error.code, "unauthorized");

    installFetch(() => new Response(null, { status: 404 }));
    const missing = await getExternalSpecies("abelisaurus");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "not_found");

    installFetch(() => new Response("nope", { status: 500 }));
    const failed = await getExternalSpecies("abelisaurus");
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.error.code, "unexpected");
      assert.equal(
        failed.error.message,
        "The external species service is unavailable.",
      );
      assert.equal(failed.error.message.includes("nope"), false);
    }
  });

  test("reports network errors and timeouts without exposing the cause", async () => {
    installFetch(() => {
      throw new TypeError("connect ECONNREFUSED 10.1.2.3");
    });
    const network = await getExternalSpecies("abelisaurus");
    assert.equal(network.ok, false);
    if (!network.ok) {
      assert.equal(network.error.code, "unexpected");
      assert.equal(network.error.message, "The external species service is unavailable.");
      assert.equal(network.error.message.includes("10.1.2.3"), false);
    }

    installFetch(() => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const timedOut = await getExternalSpecies("abelisaurus");
    assert.equal(timedOut.ok, false);
    if (!timedOut.ok) {
      assert.equal(timedOut.error.code, "unexpected");
      assert.equal(timedOut.error.message, "The external species request timed out.");
    }
  });

  test("rejects malformed JSON and invalid record structure", async () => {
    installFetch(() => new Response("{", { status: 200 }));
    const malformed = await getExternalSpecies("abelisaurus");
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.error.code, "validation");
      assert.equal(malformed.error.message, "The external species data is invalid.");
    }

    installFetch(() => jsonResponse(speciesRecord({ hybrid: "false", geological_period: 90 })));
    const invalid = await getExternalSpecies("abelisaurus");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.error.code, "validation");
      assert.equal(invalid.error.message, "The external species data is invalid.");
    }

    installFetch(() =>
      jsonResponse(
        speciesRecord({
          franchise_origins: ["jurassic-park", 3],
        }),
      ),
    );
    const badArray = await getExternalSpecies("abelisaurus");
    assert.equal(badArray.ok, false);
    if (!badArray.ok) assert.equal(badArray.error.code, "validation");
  });

  test("rejects a record whose id does not match the request", async () => {
    installFetch(() => jsonResponse([speciesRecord({ id: "allosaurus" })]));

    const result = await getExternalSpecies("abelisaurus");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "validation");
      assert.equal(
        result.error.message,
        "The external species record did not match the requested identifier.",
      );
      assert.equal(result.error.message.includes("allosaurus"), false);
    }
  });

  test("calls only the fixed species endpoint with GET, a publishable key and one-record filters", async () => {
    installFetch(() => jsonResponse([speciesRecord()]));

    const result = await getExternalSpecies("abelisaurus");
    assert.equal(result.ok, true);
    assert.equal(requests.length, 1);

    const request = requests[0];
    const url = new URL(request.url);
    assert.equal(request.method, "GET");
    assert.equal(request.cache, "no-store");
    assert.equal(request.redirect, "error");
    assert.equal(url.origin, EXTERNAL_ORIGIN);
    assert.equal(url.pathname, "/rest/v1/species");
    assert.equal(url.searchParams.get("id"), "eq.abelisaurus");
    assert.equal(url.searchParams.get("select"), SELECT_COLUMNS);
    assert.equal(url.searchParams.get("limit"), "1");
    assert.equal([...url.searchParams.keys()].length, 3);
    assert.equal(request.headers.get("apikey"), PUBLISHABLE_KEY);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("apikey") === MAIN_APP_KEY, false);
    assert.equal(request.signal instanceof AbortSignal, true);

    const headerValues = [...request.headers.values()].join(" ");
    assert.equal(headerValues.includes("service_role"), false);
    assert.equal(headerValues.includes(MAIN_APP_KEY), false);
  });

  test("does not call the network when configuration is missing or points elsewhere", async () => {
    delete process.env.EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY;
    installFetch(() => jsonResponse([]));

    const missing = await getExternalSpecies("abelisaurus");
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.code, "unexpected");
      assert.equal(missing.error.message, "The external species service is not configured.");
    }

    process.env.EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
    process.env.EXTERNAL_SPECIES_SUPABASE_URL = "https://evil.example/rest/v1/species";
    const foreign = await getExternalSpecies("abelisaurus");
    assert.equal(foreign.ok, false);
    if (!foreign.ok) {
      assert.equal(foreign.error.message, "The external species service is not configured.");
    }

    process.env.EXTERNAL_SPECIES_SUPABASE_URL = "http://mwewivvwhdittuffkcrr.supabase.co";
    const insecure = await getExternalSpecies("abelisaurus");
    assert.equal(insecure.ok, false);
    if (!insecure.ok) assert.equal(insecure.error.code, "unexpected");

    assert.equal(requests.length, 0);
  });
});
