import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SAFE_ERROR_MESSAGES,
  ok,
  type AppResult,
} from "../appResult.ts";
import type { CurrentProfileResult } from "../currentProfile.ts";
import type { ApplicationRole } from "../../types/database.ts";
import {
  SPECIES_ACCEPTANCE_MAX_BODY_BYTES,
  SPECIES_ENRICHMENT_MAX_BODY_BYTES,
  SPECIES_ENRICHMENT_REQUEST_MESSAGES,
  handleSpeciesAcceptancePost as handleAcceptancePost,
  handleSpeciesEnrichmentPost,
  type SpeciesEnrichmentEndpointDependencies,
} from "./speciesEnrichmentEndpoint.ts";
import type { SpeciesEnrichmentProposal } from "./speciesEnrichmentSchemas.ts";
import {
  signSpeciesEnrichmentProposal,
  verifySpeciesEnrichmentProposal,
  type SignedSpeciesEnrichmentProposal,
} from "./speciesEnrichmentSigning.ts";
import { mintSpeciesInsertProof, SPECIES_INSERT_PROOF_HEADER } from "./speciesInsertProof.ts";

const ENDPOINT = "https://amber.test/api/agent/species-enrichment";
const ACCEPT_ENDPOINT = `${ENDPOINT}/accept`;
const SECRET = "sk-test-secret";
const PROVIDER_URL = "https://api.openai.com/v1/responses";
const PROFILE_ID = "a492ce32-054a-41b2-8c2b-97cc49b0b7e7";
const OTHER_PROFILE_ID = "4e786f4f-978f-4b7e-98c6-2a6103bd6452";
const PROPOSAL_KEY = "SPECIES_ENRICHMENT_SIGNING_SECRET";
const INSERT_KEY = "SPECIES_INSERT_PROOF_SECRET";
const keyFixtures = { [PROPOSAL_KEY]: "1a".repeat(32), [INSERT_KEY]: "2b".repeat(32) };
const previousKeys = Object.keys(keyFixtures).map((name) => [name, process.env[name]] as const);

beforeEach(() => Object.assign(process.env, keyFixtures));
afterEach(() => {
  for (const [name, value] of previousKeys) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const factProvenance = {
  basis: "api_interpretation" as const,
  supporting_fields: ["scientific_name" as const],
  uncertainty: null,
};

const proposal = {
  retrieval: {
    system: "external_species_api",
    external_species_id: "abelisaurus",
    retrieved_at: "2026-11-04T12:00:00.000Z",
  },
  api_content_authority: "untrusted_api_reference",
  api_facts: {
    id: "abelisaurus",
    scientific_name: "Abelisaurus comahuensis",
    diet_profile: "Carnivore",
    geological_period: null,
    region: "South America",
    social_requirements: "Unknown",
    general_care_recommendations: "Untrusted reference text.",
    hybrid: false,
    franchise_origins: [],
    franchise_appearances: [],
  },
  proposed_entry: {
    external_species_id: "abelisaurus",
    display_name: "Abelisaurus comahuensis",
    general_description: "Temporary description.",
    diet_preferences: "Temporary diet proposal.",
    habitat_preferences: "Temporary habitat proposal.",
    handling_guidance: "Temporary handling proposal.",
    minimum_handlers: null,
    safety_class: "moderate",
  },
  provenance: {
    general_description: factProvenance,
    diet_preferences: { ...factProvenance, supporting_fields: ["diet_profile"] },
    habitat_preferences: { ...factProvenance, supporting_fields: ["region"] },
    handling_guidance: {
      basis: "operational_recommendation",
      supporting_fields: ["general_care_recommendations"],
      uncertainty: null,
    },
    minimum_handlers: {
      basis: "operational_recommendation",
      supporting_fields: [],
      uncertainty: "Handler count requires review.",
    },
    safety_class: { ...factProvenance, basis: "operational_recommendation" },
  },
} satisfies SpeciesEnrichmentProposal;

function profile(
  status: "ok",
  role: ApplicationRole,
): Extract<CurrentProfileResult, { status: "ok" }>;
function profile(
  status: "unauthenticated" | "unlinked" | "error",
): CurrentProfileResult;
function profile(
  status: CurrentProfileResult["status"],
  role?: ApplicationRole,
): CurrentProfileResult {
  if (status === "ok") {
    return {
      status: "ok",
      supabase: {} as SupabaseClient,
      authUserId: "auth-user-1",
      profileId: PROFILE_ID,
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
  proposal?: AppResult<SpeciesEnrichmentProposal>;
  onProfile?: () => void;
  onEnrichment?: (request: unknown) => void;
}): SpeciesEnrichmentEndpointDependencies & { enrichmentCalls: unknown[] } {
  const enrichmentCalls: unknown[] = [];
  return {
    enrichmentCalls,
    getCurrentProfile: async () => {
      options.onProfile?.();
      if (typeof options.profile === "function") return options.profile();
      return options.profile ?? profile("ok", "management");
    },
    runSpeciesEnrichment: async (request) => {
      enrichmentCalls.push(request);
      options.onEnrichment?.(request);
      return options.proposal ?? ok(proposal);
    },
  };
}

function requestFor(
  body: BodyInit | null | undefined,
  headers: Record<string, string> = {},
  url = ENDPOINT,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://amber.test",
      ...headers,
    },
    body: body === undefined ? JSON.stringify({ external_species_id: "abelisaurus" }) : body,
  });
}

type EnrichmentBody = {
  ok?: boolean;
  data?: SpeciesEnrichmentProposal;
  signed_proposal?: SignedSpeciesEnrichmentProposal;
  error?: { code?: string; message?: string };
};

async function readBody(response: Response): Promise<EnrichmentBody> {
  return response.json() as Promise<EnrichmentBody>;
}

describe("species enrichment endpoint authorisation", () => {
  test("returns the temporary proposal for management", async () => {
    const deps = dependencies({});
    const order: string[] = [];
    deps.getCurrentProfile = async () => {
      order.push("profile");
      return profile("ok", "management");
    };
    deps.runSpeciesEnrichment = async (request) => {
      order.push("agent");
      deps.enrichmentCalls.push(request);
      return ok(proposal);
    };

    const response = await handleSpeciesEnrichmentPost(
      requestFor(JSON.stringify({ external_species_id: "  abelisaurus  " }), {
        "content-type": "application/json; charset=utf-8",
        "sec-fetch-site": "same-origin",
      }),
      deps,
    );
    const body = await readBody(response);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, proposal);
    assert.deepEqual(verifySpeciesEnrichmentProposal(body.signed_proposal, PROFILE_ID), ok(proposal));
    assert.equal(JSON.stringify(body).includes(keyFixtures[PROPOSAL_KEY]), false);
    assert.deepEqual(deps.enrichmentCalls, [
      { external_species_id: "abelisaurus" },
    ]);
    assert.deepEqual(order, ["profile", "agent"]);
    assert.equal(
      body.data?.api_facts.general_care_recommendations,
      "Untrusted reference text.",
    );
    assert.equal(
      body.data?.proposed_entry.handling_guidance,
      "Temporary handling proposal.",
    );
  });

  test("rejects an unauthenticated caller before the agent runs", async () => {
    const deps = dependencies({ profile: profile("unauthenticated") });
    const response = await handleSpeciesEnrichmentPost(requestFor(undefined), deps);
    const body = await readBody(response);

    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.deepEqual(body.error, {
      code: "unauthenticated",
      message: SAFE_ERROR_MESSAGES.unauthenticated,
    });
    assert.deepEqual(deps.enrichmentCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("rejects unlinked, employee and senior callers before the agent runs", async () => {
    const cases: Array<{ name: string; profile: CurrentProfileResult }> = [
      { name: "unlinked", profile: profile("unlinked") },
      { name: "employee", profile: profile("ok", "employee") },
      { name: "senior", profile: profile("ok", "senior") },
    ];

    for (const item of cases) {
      const deps = dependencies({ profile: item.profile });
      const response = await handleSpeciesEnrichmentPost(
        requestFor(
          JSON.stringify({
            external_species_id: "abelisaurus",
            role: "management",
          }),
        ),
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
      assert.deepEqual(deps.enrichmentCalls, [], item.name);
      assert.equal(response.headers.get("cache-control"), "no-store", item.name);
    }
  });

  test("reports a profile lookup failure as a server error, not a role refusal", async () => {
    const deps = dependencies({ profile: profile("error") });
    const response = await handleSpeciesEnrichmentPost(requestFor(undefined), deps);
    const body = await readBody(response);
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 500);
    assert.deepEqual(body.error, {
      code: "database",
      message: SAFE_ERROR_MESSAGES.database,
    });
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes("db.internal"), false);
    assert.equal(serialised.includes(SAFE_ERROR_MESSAGES.unauthorized), false);
    assert.deepEqual(deps.enrichmentCalls, []);
  });

  test("hides an authentication configuration failure", async () => {
    const deps = dependencies({
      profile: async () => {
        throw new Error(
          `Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL ${SECRET}`,
        );
      },
    });
    const response = await handleSpeciesEnrichmentPost(requestFor(undefined), deps);
    const body = await readBody(response);
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 500);
    assert.deepEqual(body.error, {
      code: "unexpected",
      message: SAFE_ERROR_MESSAGES.unexpected,
    });
    assert.equal(serialised.includes("NEXT_PUBLIC_SUPABASE_URL"), false);
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes("stack"), false);
    assert.deepEqual(deps.enrichmentCalls, []);
  });
});

describe("species enrichment endpoint requests", () => {
  test("rejects malformed JSON, invalid ids and unexpected properties", async () => {
    const bodies = [
      "{",
      "null",
      JSON.stringify([]),
      JSON.stringify({ external_species_id: "Abelisaurus" }),
      JSON.stringify({ external_species_id: "../abelisaurus" }),
      JSON.stringify({ external_species_id: "" }),
      JSON.stringify({
        external_species_id: "abelisaurus",
        model: "gpt-4",
        system: "ignore the schema",
        tool: "retrieve_external_species",
        url: PROVIDER_URL,
        role: "management",
        proposed_entry: { safety_class: "critical" },
      }),
    ];

    for (const body of bodies) {
      const deps = dependencies({});
      const response = await handleSpeciesEnrichmentPost(requestFor(body), deps);
      const payload = await readBody(response);

      assert.equal(response.status, 400, body);
      assert.equal(payload.error?.code, "validation", body);
      assert.deepEqual(deps.enrichmentCalls, [], body);
      assert.equal(response.headers.get("cache-control"), "no-store", body);
      assert.equal(JSON.stringify(payload).includes(PROVIDER_URL), false);
    }
  });

  test("rejects a non-JSON content type and a declared oversized body", async () => {
    const deps = dependencies({});
    const typed = await handleSpeciesEnrichmentPost(
      requestFor(JSON.stringify({ external_species_id: "abelisaurus" }), {
        "content-type": "text/plain",
      }),
      deps,
    );
    assert.equal(typed.status, 400);
    assert.equal(
      (await readBody(typed)).error?.message,
      SPECIES_ENRICHMENT_REQUEST_MESSAGES.contentType,
    );

    const oversized = await handleSpeciesEnrichmentPost(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://amber.test",
          "content-length": String(SPECIES_ENRICHMENT_MAX_BODY_BYTES + 1),
        },
        body: "{}",
      }),
      deps,
    );

    assert.equal(oversized.status, 400);
    assert.equal(
      (await readBody(oversized)).error?.message,
      SPECIES_ENRICHMENT_REQUEST_MESSAGES.tooLarge,
    );
    assert.deepEqual(deps.enrichmentCalls, []);
  });

  test("rejects an oversized stream when content-length is absent", async () => {
    const deps = dependencies({});
    const chunk = new Uint8Array(SPECIES_ENRICHMENT_MAX_BODY_BYTES);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      },
    });
    const response = await handleSpeciesEnrichmentPost(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://amber.test",
        },
        body: stream,
        duplex: "half",
      } as RequestInit),
      deps,
    );
    const body = await readBody(response);

    assert.equal(response.status, 400);
    assert.equal(body.error?.message, SPECIES_ENRICHMENT_REQUEST_MESSAGES.tooLarge);
    assert.deepEqual(deps.enrichmentCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const lying = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      },
    });
    const understated = await handleSpeciesEnrichmentPost(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://amber.test",
          "content-length": "8",
        },
        body: lying,
        duplex: "half",
      } as RequestInit),
      deps,
    );
    assert.equal(understated.status, 400);
    assert.equal(
      (await readBody(understated)).error?.message,
      SPECIES_ENRICHMENT_REQUEST_MESSAGES.tooLarge,
    );
    assert.deepEqual(deps.enrichmentCalls, []);
  });

  test("rejects a cross-origin browser request before authentication", async () => {
    let profileCalls = 0;
    const deps = dependencies({
      onProfile: () => {
        profileCalls += 1;
      },
    });
    const response = await handleSpeciesEnrichmentPost(
      requestFor(undefined, {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
      deps,
    );
    const body = await readBody(response);

    assert.equal(response.status, 403);
    assert.equal(body.error?.message, SPECIES_ENRICHMENT_REQUEST_MESSAGES.origin);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(profileCalls, 0);
    assert.deepEqual(deps.enrichmentCalls, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

describe("species enrichment endpoint agent failures", () => {
  test("returns not found without reshaping the error", async () => {
    const deps = dependencies({
      proposal: {
        ok: false,
        error: {
          code: "not_found",
          message: `missing at ${PROVIDER_URL} ${SECRET}`,
        },
      },
    });
    const response = await handleSpeciesEnrichmentPost(requestFor(undefined), deps);
    const body = await readBody(response);
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 404);
    assert.deepEqual(body.error, {
      code: "not_found",
      message: SAFE_ERROR_MESSAGES.not_found,
    });
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes(PROVIDER_URL), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("hides provider failures and does not present them as a role refusal", async () => {
    const leaked = {
      ok: false as const,
      error: {
        code: "unauthorized" as const,
        message: `provider rejected ${SECRET} at ${PROVIDER_URL}`,
        stack: `Error: ${SECRET}`,
      },
    };
    const deps = dependencies({
      proposal: leaked as AppResult<SpeciesEnrichmentProposal>,
    });
    const response = await handleSpeciesEnrichmentPost(requestFor(undefined), deps);
    const body = await readBody(response);
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 500);
    assert.deepEqual(body.error, {
      code: "unexpected",
      message: SAFE_ERROR_MESSAGES.unexpected,
    });
    assert.equal(serialised.includes(SAFE_ERROR_MESSAGES.unauthorized), false);
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes(PROVIDER_URL), false);
    assert.equal(serialised.includes("stack"), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("keeps a known safe proposal error and strips an unknown one", async () => {
    const safe = dependencies({
      proposal: {
        ok: false,
        error: {
          code: "validation",
          message: "The enrichment proposal is invalid.",
        },
      },
    });
    const safeResponse = await handleSpeciesEnrichmentPost(
      requestFor(undefined),
      safe,
    );
    assert.equal(safeResponse.status, 400);
    assert.deepEqual((await readBody(safeResponse)).error, {
      code: "validation",
      message: "The enrichment proposal is invalid.",
    });

    const leaked = dependencies({
      proposal: {
        ok: false,
        error: {
          code: "validation",
          message: `proposal rejected near ${PROVIDER_URL} ${SECRET}`,
        },
      },
    });
    const leakedResponse = await handleSpeciesEnrichmentPost(
      requestFor(undefined),
      leaked,
    );
    const body = await readBody(leakedResponse);
    const serialised = JSON.stringify(body);
    assert.equal(leakedResponse.status, 400);
    assert.deepEqual(body.error, {
      code: "validation",
      message: SAFE_ERROR_MESSAGES.validation,
    });
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes(PROVIDER_URL), false);
  });

  test("hides a thrown agent error", async () => {
    const deps = dependencies({});
    deps.runSpeciesEnrichment = async () => {
      throw new Error(`generation failed with ${SECRET} at ${PROVIDER_URL}`);
    };
    const response = await handleSpeciesEnrichmentPost(requestFor(undefined), deps);
    const body = await readBody(response);
    const serialised = JSON.stringify(body);

    assert.equal(response.status, 500);
    assert.deepEqual(body.error, {
      code: "unexpected",
      message: SAFE_ERROR_MESSAGES.unexpected,
    });
    assert.equal(serialised.includes(SECRET), false);
    assert.equal(serialised.includes("generation failed"), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

const acceptedEntry = {
  ...proposal.proposed_entry,
  minimum_handlers: 2,
};

function acceptanceBody() {
  const signed = signSpeciesEnrichmentProposal(proposal, PROFILE_ID);
  assert.equal(signed.ok, true);
  return {
    signed_proposal: signed.data,
    accepted_entry: acceptedEntry,
    management_completions: {
      minimum_handlers: { value: 2, justification: "Management requires two handlers." },
    },
  };
}

function acceptanceRequest(body: unknown, headers: Record<string, string> = {}) {
  return requestFor(JSON.stringify(body), headers, ACCEPT_ENDPOINT);
}

function handleSpeciesAcceptancePost(
  request: Request,
  getCurrentProfile: Parameters<typeof handleAcceptancePost>[1],
  recheckLinkedProfile: Parameters<typeof handleAcceptancePost>[2] = async () => {
    assert.fail("Unexpected profile recheck");
  },
) {
  return handleAcceptancePost(request, getCurrentProfile, recheckLinkedProfile);
}

function acceptanceClient(reply = () => new Response(null, { status: 201 })) {
  const requests: Request[] = [];
  const supabase = createClient("https://database.invalid", "sb_publishable_fixture", {
    accessToken: async () => "test-caller-token",
    global: {
      fetch: async (url, init) => {
        requests.push(new Request(url, init));
        return reply();
      },
    },
  });
  return {
    requests,
    getCurrentProfile: async () => ({ ...profile("ok", "management"), supabase }),
  };
}

describe("species acceptance endpoint", () => {
  test("accepts the enrichment envelope and sends one caller-scoped insert with a new proof", async ({ mock }) => {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T12:00:00Z") });
    const enriched = await handleSpeciesEnrichmentPost(requestFor(undefined), dependencies({}));
    assert.equal(enriched.status, 200);
    const enrichment = await readBody(enriched);
    const client = acceptanceClient();
    const body = { ...acceptanceBody(), signed_proposal: enrichment.signed_proposal };
    const browserProof = "untrusted-browser-proof";

    const response = await handleSpeciesAcceptancePost(
      acceptanceRequest(body, { [SPECIES_INSERT_PROOF_HEADER]: browserProof }),
      client.getCurrentProfile,
    );
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get(SPECIES_INSERT_PROOF_HEADER), null);
    assert.deepEqual(await response.json(), { ok: true, data: { external_species_id: "abelisaurus" } });

    assert.equal(client.requests.length, 1);
    const [insert] = client.requests;
    assert.equal(insert.method, "POST");
    assert.equal(insert.url, "https://database.invalid/rest/v1/species_database");
    assert.equal(insert.headers.get("authorization"), "Bearer test-caller-token");
    assert.doesNotMatch(insert.headers.get("prefer") ?? "", /resolution=/);
    assert.deepEqual(await insert.json(), acceptedEntry);
    const proof = mintSpeciesInsertProof(PROFILE_ID, acceptedEntry);
    assert.equal(proof.ok, true);
    assert.equal(insert.headers.get(SPECIES_INSERT_PROOF_HEADER), proof.data);
    assert.notEqual(insert.headers.get(SPECIES_INSERT_PROOF_HEADER), browserProof);
  });

  test("rechecks authentication, profile linkage and Management role", async () => {
    const client = acceptanceClient();
    const management = await client.getCurrentProfile();
    const cases = [
      [profile("unauthenticated"), 401],
      [profile("unlinked"), 403],
      [{ ...management, role: "employee" }, 403],
      [{ ...management, role: "senior" }, 403],
      [profile("error"), 500],
    ] as const;

    for (const [caller, status] of cases) {
      const response = await handleSpeciesAcceptancePost(
        acceptanceRequest(acceptanceBody()), async () => caller,
      );
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.text()).includes(SECRET), false);
    }
    assert.deepEqual(client.requests, []);
  });

  test("rejects forged, expired and cross-profile envelopes before any insert", async ({ mock }) => {
    const client = acceptanceClient();
    const issuedAt = Date.parse("2026-11-06T12:00:00Z");
    mock.timers.enable({ apis: ["Date"], now: issuedAt });
    const body = acceptanceBody();
    const { signed_proposal: envelope } = body;
    const forged = { ...envelope, payload: `${envelope.payload}A` };

    const forgedResponse = await handleSpeciesAcceptancePost(
      acceptanceRequest({ ...body, signed_proposal: forged }), client.getCurrentProfile,
    );
    assert.equal(forgedResponse.status, 400);

    const crossProfileResponse = await handleSpeciesAcceptancePost(acceptanceRequest(body), async () => ({
      ...await client.getCurrentProfile(), profileId: OTHER_PROFILE_ID,
    }));
    assert.equal(crossProfileResponse.status, 400);

    mock.timers.setTime(issuedAt + 30 * 60 * 1000);
    const expired = await handleSpeciesAcceptancePost(acceptanceRequest(body), client.getCurrentProfile);
    assert.equal(expired.status, 400);
    assert.deepEqual(client.requests, []);
  });

  test("rejects invalid completions, altered accepted values and unsigned request fields", async () => {
    const client = acceptanceClient();
    const body = acceptanceBody();
    // A missing signing key would return 500 if the endpoint reached proof minting.
    delete process.env[INSERT_KEY];
    for (const invalid of [
      { ...body, management_completions: {} },
      { ...body, management_completions: { minimum_handlers: { value: 2, justification: " " } } },
      { ...body, accepted_entry: { ...acceptedEntry, display_name: "Client override" } },
      { ...body, accepted_entry: { ...acceptedEntry, updated_by: PROFILE_ID } },
      { ...body, proposal },
      { ...body, insert_proof: "untrusted" },
    ]) {
      const response = await handleSpeciesAcceptancePost(acceptanceRequest(invalid), client.getCurrentProfile);
      assert.equal(response.status, 400);
    }
    assert.deepEqual(client.requests, []);
  });

  test("fails closed when proposal signing or insert proof configuration is missing", async () => {
    const client = acceptanceClient();
    const body = acceptanceBody();
    for (const key of [PROPOSAL_KEY, INSERT_KEY] as const) {
      delete process.env[key];
      const response = await handleSpeciesAcceptancePost(acceptanceRequest(body), client.getCurrentProfile);
      assert.equal(response.status, 500);
      assert.deepEqual((await readBody(response)).error, {
        code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected,
      });
      process.env[key] = keyFixtures[key];
    }
    delete process.env[PROPOSAL_KEY];
    const enrichment = await handleSpeciesEnrichmentPost(requestFor(undefined), dependencies({}));
    assert.equal(enrichment.status, 500);
    assert.deepEqual(await enrichment.json(), {
      ok: false, error: { code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected },
    });
    assert.deepEqual(client.requests, []);
  });

  test("maps duplicate conflicts and database failures without returning raw details", async () => {
    for (const [code, dbStatus, status, appCode] of [
      ["23505", 409, 409, "conflict"],
      ["XX000", 500, 500, "database"],
    ] as const) {
      const client = acceptanceClient(() => Response.json({
        code, message: SECRET, details: "private database details",
      }, { status: dbStatus }));
      const response = await handleSpeciesAcceptancePost(acceptanceRequest(acceptanceBody()), client.getCurrentProfile);
      assert.equal(response.status, status);
      assert.equal(client.requests.length, 1);
      assert.deepEqual(await response.json(), {
        ok: false, error: { code: appCode, message: SAFE_ERROR_MESSAGES[appCode] },
      });
    }
  });

  test("rechecks the caller's linked profile after an INSERT denial", async ({ mock }) => {
    const client = acceptanceClient(() => Response.json({ code: "42501", message: SECRET }, { status: 403 }));
    const management = await client.getCurrentProfile();
    const cases = [
      { name: "Management access intact", current: management, status: 500, code: "database" },
      { name: "downgraded to Senior", current: { ...management, role: "senior" }, status: 403, code: "unauthorized" },
      { name: "unlinked", current: profile("unlinked"), status: 403, code: "unauthorized" },
      { name: "linked profile changed", current: { ...management, profileId: OTHER_PROFILE_ID }, status: 403, code: "unauthorized" },
      { name: "inconclusive recheck", current: profile("error"), status: 500, code: "database" },
      { name: "recheck threw", current: null, status: 500, code: "database" },
    ] as const;

    for (const { name, current, status, code } of cases) {
      client.requests.length = 0;
      const recheck = mock.fn<Parameters<typeof handleAcceptancePost>[2]>(async () => {
        if (!current) throw new Error(SECRET);
        return current;
      });
      const response = await handleSpeciesAcceptancePost(
        acceptanceRequest(acceptanceBody()), client.getCurrentProfile, recheck,
      );
      assert.equal(response.status, status, name);
      assert.equal(response.headers.get("cache-control"), "no-store", name);
      assert.deepEqual(await response.json(), {
        ok: false, error: { code, message: SAFE_ERROR_MESSAGES[code] },
      }, name);
      assert.equal(client.requests.length, 1, name);
      assert.equal(recheck.mock.callCount(), 1, name);
      const [identity] = recheck.mock.calls[0].arguments;
      assert.equal(identity.supabase, management.supabase, name);
      assert.equal(identity.userId, management.authUserId, name);
    }
  });

  test("enforces the acceptance JSON size and origin limits", async () => {
    const client = acceptanceClient();
    const body = acceptanceBody();
    const requests = [
      [acceptanceRequest(body, { origin: "https://foreign.test" }), 403],
      [acceptanceRequest(body, { "content-type": "text/plain" }), 400],
      [acceptanceRequest(body, { "content-length": String(SPECIES_ACCEPTANCE_MAX_BODY_BYTES + 1) }), 400],
      [requestFor(" ".repeat(SPECIES_ACCEPTANCE_MAX_BODY_BYTES + 1), {}, ACCEPT_ENDPOINT), 400],
      [requestFor("{", {}, ACCEPT_ENDPOINT), 400],
    ] as const;
    for (const [request, status] of requests) {
      const response = await handleSpeciesAcceptancePost(request, client.getCurrentProfile);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.deepEqual(client.requests, []);
  });
});
