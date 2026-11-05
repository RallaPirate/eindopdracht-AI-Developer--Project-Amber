import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SAFE_ERROR_MESSAGES } from "./appResult.ts";
import type { CurrentProfileResult } from "./currentProfile.ts";
import type { ApplicationRole } from "../types/database.ts";
import {
  EXTERNAL_SPECIES_LOOKUP_LIMIT,
  EXTERNAL_SPECIES_NAME_MAX_LENGTH,
  EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH,
  getExternalSpecies,
  lookupExternalSpeciesByName,
  type ExternalSpecies,
} from "./externalSpecies.ts";
import { handleSpeciesLookupGet } from "./speciesLookupEndpoint.ts";

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

    installFetch(() =>
      jsonResponse([speciesRecord({ hybrid: "false", geological_period: 90 })]),
    );
    const invalid = await getExternalSpecies("abelisaurus");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.error.code, "validation");
      assert.equal(invalid.error.message, "The external species data is invalid.");
    }

    installFetch(() =>
      jsonResponse([
        speciesRecord({
          franchise_origins: ["jurassic-park", 3],
        }),
      ]),
    );
    const badArray = await getExternalSpecies("abelisaurus");
    assert.equal(badArray.ok, false);
    if (!badArray.ok) {
      assert.equal(badArray.error.code, "validation");
      assert.equal(badArray.error.message, "The external species data is invalid.");
    }

    const missingField = speciesRecord();
    delete missingField.scientific_name;
    installFetch(() => jsonResponse([missingField]));
    const incomplete = await getExternalSpecies("abelisaurus");
    assert.equal(incomplete.ok, false);
    if (!incomplete.ok) {
      assert.equal(incomplete.error.code, "validation");
      assert.equal(incomplete.error.message, "The external species data is invalid.");
    }
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

describe("lookupExternalSpeciesByName", { concurrency: 1 }, () => {
  test("returns the external id and scientific name for a matching name", async () => {
    installFetch(() =>
      jsonResponse([
        {
          id: "tyrannosaurus-rex",
          scientific_name: "Tyrannosaurus rex",
          diet_profile: "carnivore",
          general_care_recommendations: "Do not disclose this field.",
        },
      ]),
    );

    const result = await lookupExternalSpeciesByName("  Tyrannosaurus   Rex  ");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.data, [
      {
        id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      },
    ]);
    assert.equal(JSON.stringify(result).includes("carnivore"), false);
    assert.equal(JSON.stringify(result).includes("Do not disclose"), false);
    assert.equal(requests.length, 1);
  });

  test("searches case-insensitively and keeps the returned name unchanged", async () => {
    installFetch(() =>
      jsonResponse([
        { id: "tyrannosaurus-rex", scientific_name: "Tyrannosaurus rex" },
      ]),
    );

    const result = await lookupExternalSpeciesByName("tyrannosaurus rex");

    assert.deepEqual(result, {
      ok: true,
      data: [{ id: "tyrannosaurus-rex", scientific_name: "Tyrannosaurus rex" }],
    });
    const url = new URL(requests[0].url);
    assert.equal(
      url.searchParams.get("scientific_name"),
      "ilike.*tyrannosaurus rex*",
    );
  });

  test("requests a partial ilike match", async () => {
    installFetch(() =>
      jsonResponse([
        { id: "tyrannosaurus-rex", scientific_name: "Tyrannosaurus rex" },
      ]),
    );

    const result = await lookupExternalSpeciesByName("saurus");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data[0]?.id, "tyrannosaurus-rex");
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get("scientific_name"), "ilike.*saurus*");
  });

  test("orders multiple matches by scientific name and then id", async () => {
    installFetch(() =>
      jsonResponse([
        { id: "zuniceratops", scientific_name: "Zuniceratops christopheri" },
        { id: "tyrannosaurus-rex", scientific_name: "Tyrannosaurus rex" },
        { id: "tyrannosaurus", scientific_name: "Tyrannosaurus rex" },
      ]),
    );

    const result = await lookupExternalSpeciesByName("saurus");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.data.map((match) => match.id),
      ["tyrannosaurus", "tyrannosaurus-rex", "zuniceratops"],
    );
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get("order"), "scientific_name.asc,id.asc");
    assert.equal(url.searchParams.get("limit"), String(EXTERNAL_SPECIES_LOOKUP_LIMIT));
  });

  test("returns an empty success when nothing matches", async () => {
    installFetch(() => jsonResponse([]));

    const result = await lookupExternalSpeciesByName("Notasaurus");

    assert.deepEqual(result, { ok: true, data: [] });
    assert.equal(requests.length, 1);
  });

  test("rejects empty, malformed, oversized and unsafe names before any request", async () => {
    installFetch(() => jsonResponse([]));
    const samples: unknown[] = [
      "",
      "   ",
      "A",
      "a".repeat(EXTERNAL_SPECIES_NAME_MAX_LENGTH + 1),
      "Tyrannosaurus*",
      "Tyrannosaurus%",
      "Tyrannosaurus_",
      "Tyrannosaurus.rex",
      "rex,or",
      "or(id.eq.abelisaurus)",
      "name:eq",
      "Rex/id",
      "Rex\nrex",
      "Rex\u0000",
      "T. rex",
      null,
      12,
      { scientific_name: "Tyrannosaurus rex" },
    ];

    for (const sample of samples) {
      const result = await lookupExternalSpeciesByName(sample);
      assert.equal(result.ok, false, JSON.stringify(sample));
      if (result.ok) continue;
      assert.equal(result.error.code, "validation", JSON.stringify(sample));
      assert.equal(result.error.message, "Species name is invalid.");
    }

    assert.equal(requests.length, 0);
  });

  test("accepts a name at the maximum length", async () => {
    const name = `A${"b".repeat(EXTERNAL_SPECIES_NAME_MAX_LENGTH - 1)}`;
    installFetch(() => jsonResponse([]));

    const result = await lookupExternalSpeciesByName(name);

    assert.deepEqual(result, { ok: true, data: [] });
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get("scientific_name"), `ilike.*${name}*`);
  });

  test("trims an 80-character name before applying the length limit", async () => {
    const name = `A${"b".repeat(EXTERNAL_SPECIES_NAME_MAX_LENGTH - 1)}`;
    installFetch(() => jsonResponse([]));

    const result = await lookupExternalSpeciesByName(` ${name}`);

    assert.deepEqual(result, { ok: true, data: [] });
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get("scientific_name"), `ilike.*${name}*`);
  });

  test("rejects raw text above the separate request-size limit before any request", async () => {
    const padded = `${" ".repeat(EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH)}Rex`;
    installFetch(() => jsonResponse([]));

    const result = await lookupExternalSpeciesByName(padded);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "validation");
      assert.equal(result.error.message, "Species name is invalid.");
    }
    assert.equal(requests.length, 0);
  });

  test("maps upstream failures, timeouts and invalid shapes without leaking details", async () => {
    installFetch(() => jsonResponse({ message: "secret upstream detail" }, 401));
    const denied = await lookupExternalSpeciesByName("Rex");
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.error.code, "unauthorized");
      assert.equal(denied.error.message, SAFE_ERROR_MESSAGES.unauthorized);
      assert.equal(denied.error.message.includes("secret"), false);
    }

    installFetch(() => new Response("nope", { status: 500 }));
    const failed = await lookupExternalSpeciesByName("Rex");
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.error.message, "The external species service is unavailable.");
      assert.equal(failed.error.message.includes("nope"), false);
    }

    installFetch(() => {
      throw new TypeError("connect ECONNREFUSED 10.1.2.3");
    });
    const network = await lookupExternalSpeciesByName("Rex");
    assert.equal(network.ok, false);
    if (!network.ok) {
      assert.equal(network.error.message, "The external species service is unavailable.");
      assert.equal(network.error.message.includes("10.1.2.3"), false);
    }

    installFetch(() => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const timedOut = await lookupExternalSpeciesByName("Rex");
    assert.equal(timedOut.ok, false);
    if (!timedOut.ok) {
      assert.equal(timedOut.error.message, "The external species request timed out.");
    }

    installFetch(() => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const aborted = await lookupExternalSpeciesByName("Rex");
    assert.equal(aborted.ok, false);
    if (!aborted.ok) {
      assert.equal(aborted.error.message, "The external species request timed out.");
    }

    installFetch(() => new Response("{", { status: 200 }));
    const malformed = await lookupExternalSpeciesByName("Rex");
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.error.code, "unexpected");
      assert.equal(malformed.error.message, "The external species data is invalid.");
      assert.equal(malformed.error.message.includes("{"), false);
    }

    installFetch(() => new Response("missing route", { status: 404 }));
    const missingRoute = await lookupExternalSpeciesByName("Rex");
    assert.equal(missingRoute.ok, false);
    if (!missingRoute.ok) {
      assert.equal(missingRoute.error.code, "unexpected");
      assert.equal(
        missingRoute.error.message,
        "The external species service is unavailable.",
      );
      assert.equal(missingRoute.error.message.includes("missing route"), false);
    }

    installFetch(() => jsonResponse({ id: "tyrannosaurus-rex" }));
    const objectBody = await lookupExternalSpeciesByName("Rex");
    assert.equal(objectBody.ok, false);
    if (!objectBody.ok) {
      assert.equal(objectBody.error.code, "unexpected");
      assert.equal(objectBody.error.message, "The external species data is invalid.");
    }

    installFetch(() =>
      jsonResponse([{ id: "Tyrannosaurus", scientific_name: "Tyrannosaurus rex" }]),
    );
    const rewrittenId = await lookupExternalSpeciesByName("Rex");
    assert.equal(rewrittenId.ok, false);
    if (!rewrittenId.ok) {
      assert.equal(rewrittenId.error.code, "unexpected");
      assert.equal(rewrittenId.error.message, "The external species data is invalid.");
      assert.equal(rewrittenId.error.message.includes("Tyrannosaurus"), false);
    }

    installFetch(() =>
      jsonResponse([{ id: "tyrannosaurus-rex", scientific_name: "" }]),
    );
    const emptyName = await lookupExternalSpeciesByName("Rex");
    assert.equal(emptyName.ok, false);
    if (!emptyName.ok) {
      assert.equal(emptyName.error.code, "unexpected");
      assert.equal(emptyName.error.message, "The external species data is invalid.");
    }

    installFetch(() =>
      jsonResponse(
        Array.from({ length: EXTERNAL_SPECIES_LOOKUP_LIMIT + 1 }, (_, index) => ({
          id: `species-${index}`,
          scientific_name: `Species ${index}`,
        })),
      ),
    );
    const tooMany = await lookupExternalSpeciesByName("Species");
    assert.equal(tooMany.ok, false);
    if (!tooMany.ok) {
      assert.equal(tooMany.error.code, "unexpected");
      assert.equal(tooMany.error.message, "The external species data is invalid.");
    }
  });

  test("calls only the fixed species endpoint with the external publishable key", async () => {
    installFetch(() => jsonResponse([]));

    const result = await lookupExternalSpeciesByName("Tyrannosaurus Rex");
    assert.equal(result.ok, true);
    assert.equal(requests.length, 1);

    const request = requests[0];
    const url = new URL(request.url);
    assert.equal(request.method, "GET");
    assert.equal(request.cache, "no-store");
    assert.equal(request.redirect, "error");
    assert.equal(url.origin, EXTERNAL_ORIGIN);
    assert.equal(url.pathname, "/rest/v1/species");
    assert.equal(url.searchParams.get("id"), null);
    assert.equal(
      url.searchParams.get("scientific_name"),
      "ilike.*Tyrannosaurus Rex*",
    );
    assert.equal(url.searchParams.get("select"), "id,scientific_name");
    assert.equal(url.searchParams.get("order"), "scientific_name.asc,id.asc");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal([...url.searchParams.keys()].length, 4);
    assert.equal(request.headers.get("apikey"), PUBLISHABLE_KEY);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("apikey") === MAIN_APP_KEY, false);
    const headerValues = [...request.headers.values()].join(" ");
    assert.equal(headerValues.includes("service_role"), false);
    assert.equal(headerValues.includes(MAIN_APP_KEY), false);
    assert.equal(headerValues.includes("NEXT_PUBLIC"), false);
  });

  test("does not call the network when configuration is missing or points elsewhere", async () => {
    delete process.env.EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY;
    installFetch(() => jsonResponse([]));

    const missing = await lookupExternalSpeciesByName("Rex");
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.message, "The external species service is not configured.");
    }

    process.env.EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
    process.env.EXTERNAL_SPECIES_SUPABASE_URL = "https://evil.example/rest/v1/species";
    const foreign = await lookupExternalSpeciesByName("Rex");
    assert.equal(foreign.ok, false);
    if (!foreign.ok) {
      assert.equal(foreign.error.message, "The external species service is not configured.");
    }

    process.env.EXTERNAL_SPECIES_SUPABASE_URL =
      "https://mwewivvwhdittuffkcrr.supabase.co.evil.example";
    const lookalike = await lookupExternalSpeciesByName("Rex");
    assert.equal(lookalike.ok, false);
    if (!lookalike.ok) assert.equal(lookalike.error.code, "unexpected");

    assert.equal(requests.length, 0);
  });
});

describe("lookup route with the real species client", { concurrency: 1 }, () => {
  function caller(role: ApplicationRole): CurrentProfileResult {
    return {
      status: "ok",
      supabase: {} as SupabaseClient,
      authUserId: "auth-user-1",
      profileId: "profile-1",
      role,
    };
  }

  function requestFor(name: string): Request {
    return new Request(
      `https://amber.test/api/species/lookup?name=${encodeURIComponent(name)}`,
      {
        method: "GET",
        headers: {
          origin: "https://amber.test",
          "sec-fetch-site": "same-origin",
        },
      },
    );
  }

  test("denied roles make zero external API calls", async () => {
    installFetch(() => jsonResponse([]));

    for (const role of ["employee", "senior"] as const) {
      const response = await handleSpeciesLookupGet(requestFor("Rex"), {
        getCurrentProfile: async () => caller(role),
        lookupSpeciesByName: lookupExternalSpeciesByName,
      });
      const body = (await response.json()) as {
        ok?: boolean;
        data?: unknown;
        error?: { code?: string };
      };
      assert.equal(response.status, 403, role);
      assert.equal(body.error?.code, "unauthorized", role);
      assert.equal(body.data, undefined, role);
      assert.equal(response.headers.get("cache-control"), "no-store", role);
    }

    const unauthenticated = await handleSpeciesLookupGet(requestFor("Rex"), {
      getCurrentProfile: async () => ({ status: "unauthenticated" }),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(requests.length, 0);
    assert.equal(
      JSON.stringify(await unauthenticated.json()).includes(PUBLISHABLE_KEY),
      false,
    );
  });

  test("management receives the external id without the publishable key", async () => {
    installFetch(() =>
      jsonResponse([
        {
          id: "tyrannosaurus-rex",
          scientific_name: "Tyrannosaurus rex",
          diet_profile: "carnivore",
        },
      ]),
    );

    const response = await handleSpeciesLookupGet(requestFor("Rex"), {
      getCurrentProfile: async () => caller("management"),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    const body = (await response.json()) as {
      ok?: boolean;
      data?: Array<{ external_species_id: string; scientific_name: string }>;
    };
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.deepEqual(body.data, [
      {
        external_species_id: "tyrannosaurus-rex",
        scientific_name: "Tyrannosaurus rex",
      },
    ]);
    assert.equal(serialised.includes(PUBLISHABLE_KEY), false);
    assert.equal(serialised.includes("carnivore"), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(requests[0]?.headers.get("apikey"), PUBLISHABLE_KEY);
    assert.equal(requests[0]?.headers.get("apikey") === MAIN_APP_KEY, false);
  });

  test("classifies upstream lookup failures separately from a valid empty search", async () => {
    const name = `A${"b".repeat(EXTERNAL_SPECIES_NAME_MAX_LENGTH - 1)}`;
    installFetch(() => jsonResponse([]));
    const padded = await handleSpeciesLookupGet(
      requestFor(` ${name}`),
      {
        getCurrentProfile: async () => caller("management"),
        lookupSpeciesByName: lookupExternalSpeciesByName,
      },
    );
    assert.equal(padded.status, 200);
    assert.deepEqual(await padded.json(), { ok: true, data: [] });
    assert.equal(requests.length, 1);
    assert.equal(
      new URL(requests[0].url).searchParams.get("scientific_name"),
      `ilike.*${name}*`,
    );

    installFetch(() => jsonResponse([]));
    const empty = await handleSpeciesLookupGet(requestFor("Notasaurus"), {
      getCurrentProfile: async () => caller("management"),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { ok: true, data: [] });

    installFetch(() => new Response("{", { status: 200 }));
    const malformed = await handleSpeciesLookupGet(requestFor("Rex"), {
      getCurrentProfile: async () => caller("management"),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    const malformedBody = (await malformed.json()) as {
      error?: { code?: string; message?: string };
    };
    assert.equal(malformed.status, 502);
    assert.equal(malformedBody.error?.code, "unexpected");
    assert.equal(
      malformedBody.error?.message,
      "The external species data is invalid.",
    );
    assert.equal(malformedBody.error?.message?.includes("{"), false);
    assert.equal(malformed.headers.get("cache-control"), "no-store");

    installFetch(() =>
      jsonResponse([{ id: "Not A Slug", scientific_name: "Tyrannosaurus rex" }]),
    );
    const invalidRow = await handleSpeciesLookupGet(requestFor("Rex"), {
      getCurrentProfile: async () => caller("management"),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    const invalidBody = (await invalidRow.json()) as {
      error?: { code?: string; message?: string };
    };
    assert.equal(invalidRow.status, 502);
    assert.equal(invalidBody.error?.code, "unexpected");
    assert.equal(invalidBody.error?.message, "The external species data is invalid.");
    assert.equal(JSON.stringify(invalidBody).includes("Not A Slug"), false);

    installFetch(() => new Response("no such route", { status: 404 }));
    const missing = await handleSpeciesLookupGet(requestFor("Rex"), {
      getCurrentProfile: async () => caller("management"),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    const missingBody = (await missing.json()) as {
      error?: { code?: string; message?: string };
    };
    assert.equal(missing.status, 502);
    assert.equal(missingBody.error?.code, "unexpected");
    assert.equal(
      missingBody.error?.message,
      "The external species service is unavailable.",
    );
    assert.equal(JSON.stringify(missingBody).includes("no such route"), false);
    assert.equal(JSON.stringify(missingBody).includes("not found"), false);

    const invalidName = await handleSpeciesLookupGet(requestFor("R"), {
      getCurrentProfile: async () => caller("management"),
      lookupSpeciesByName: lookupExternalSpeciesByName,
    });
    const invalidNameBody = (await invalidName.json()) as {
      error?: { code?: string };
    };
    assert.equal(invalidName.status, 400);
    assert.equal(invalidNameBody.error?.code, "validation");
  });
});
