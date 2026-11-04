import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SAFE_ERROR_MESSAGES,
  ok,
  type AppResult,
} from "../appResult.ts";
import type { CurrentProfileResult } from "../currentProfile.ts";
import type { ApplicationRole } from "../../types/database.ts";
import {
  SPECIES_ENRICHMENT_MAX_BODY_BYTES,
  SPECIES_ENRICHMENT_REQUEST_MESSAGES,
  handleSpeciesEnrichmentPost,
  type SpeciesEnrichmentEndpointDependencies,
} from "./speciesEnrichmentEndpoint.ts";
import type { SpeciesEnrichmentProposal } from "./speciesEnrichmentSchemas.ts";

const ENDPOINT = "https://amber.test/api/agent/species-enrichment";
const SECRET = "sk-test-secret";
const PROVIDER_URL = "https://api.openai.com/v1/responses";

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
    general_care_recommendations: "Untrusted reference text.",
  },
  proposed_entry: {
    external_species_id: "abelisaurus",
    display_name: "Abelisaurus comahuensis",
    general_description: "Temporary description.",
    handling_guidance: "Temporary handling proposal.",
    safety_class: "moderate",
  },
  provenance: {
    general_description: { basis: "api_interpretation" },
    handling_guidance: { basis: "operational_recommendation" },
    marker: "do-not-reassemble",
  },
} as unknown as SpeciesEnrichmentProposal;

function profile(
  status: "ok",
  role: ApplicationRole,
): CurrentProfileResult;
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

async function readBody(response: Response): Promise<{
  ok?: boolean;
  data?: SpeciesEnrichmentProposal;
  error?: { code?: string; message?: string };
}> {
  return response.json() as Promise<{
    ok?: boolean;
    data?: SpeciesEnrichmentProposal;
    error?: { code?: string; message?: string };
  }>;
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
