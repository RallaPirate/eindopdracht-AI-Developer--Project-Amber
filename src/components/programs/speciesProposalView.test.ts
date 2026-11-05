import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SAFE_ERROR_MESSAGES } from "../../lib/appResult.ts";
import type { AuthAccessSnapshot } from "../../lib/queryCacheIsolation.ts";
import { authenticatedQueryKey } from "../../lib/queryCacheIsolation.ts";
import {
  acceptedSpeciesSelection,
  canOfferSpeciesProposal,
  isSpeciesLookupAccessDenial,
  parseSpeciesLookupPayload,
  requestSpeciesNameLookup,
  sameManagementAccess,
  SPECIES_LOOKUP_MUTATION_KEY,
  speciesLookupAccessOwns,
  speciesLookupError,
  SpeciesLookupFailure,
  visibleConfirmedSpecies,
  visibleSpeciesMatches,
  type HeldSpeciesSelection,
  type OwnedSpeciesLookup,
} from "./speciesProposalView.ts";

const originalFetch = globalThis.fetch;

function access(
  overrides: Partial<AuthAccessSnapshot> = {},
): AuthAccessSnapshot {
  return {
    status: "ready",
    userId: "user-a",
    permissionStatus: "active",
    role: "management",
    displayName: "Ada",
    accessEpoch: 3,
    presentation: { id: 1, userId: "user-a", role: "management" },
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("proposal lookup is scoped by the authenticated mutation key", () => {
  assert.deepEqual(
    authenticatedQueryKey("user-a", SPECIES_LOOKUP_MUTATION_KEY),
    ["auth-user", "user-a", "species-lookup"],
  );
});

test("only a verified management session may propose a species", () => {
  assert.equal(canOfferSpeciesProposal(access()), true);
  assert.equal(canOfferSpeciesProposal(access({ role: "employee" })), false);
  assert.equal(canOfferSpeciesProposal(access({ role: "senior" })), false);
  assert.equal(
    canOfferSpeciesProposal(access({
      status: "verifying_profile",
      permissionStatus: "unknown",
      role: null,
      presentation: { id: 4, userId: "user-a", role: "management" },
    })),
    false,
  );
  assert.equal(
    canOfferSpeciesProposal(access({
      status: "revoked",
      permissionStatus: "revoked",
      role: null,
    })),
    false,
  );
  assert.equal(
    canOfferSpeciesProposal(access({ status: "suspended", role: null })),
    false,
  );
});

test("a confirmed species stays visible only for that user and access epoch", () => {
  const held: HeldSpeciesSelection = {
    userId: "user-a",
    accessEpoch: 3,
    external_species_id: "tyrannosaurus-rex",
    scientific_name: "Tyrannosaurus rex",
  };

  assert.deepEqual(visibleConfirmedSpecies(held, access()), {
    external_species_id: "tyrannosaurus-rex",
    scientific_name: "Tyrannosaurus rex",
  });
  assert.equal(visibleConfirmedSpecies(held, access({ accessEpoch: 4 })), null);
  assert.equal(visibleConfirmedSpecies(held, access({ userId: "user-b" })), null);
  assert.equal(visibleConfirmedSpecies(held, access({ role: "senior" })), null);
  assert.equal(visibleConfirmedSpecies(null, access()), null);
});

test("a lookup stays bound to the access epoch that accepted it", () => {
  const owned: OwnedSpeciesLookup = {
    userId: "user-a",
    accessEpoch: 3,
    submittedName: "Rex",
    matches: [{
      external_species_id: "tyrannosaurus-rex",
      scientific_name: "Tyrannosaurus rex",
    }],
  };

  assert.equal(speciesLookupAccessOwns(owned, access()), true);
  assert.equal(speciesLookupAccessOwns(owned, access({ accessEpoch: 4 })), false);
  assert.equal(speciesLookupAccessOwns(owned, access({ userId: "user-b" })), false);
  assert.deepEqual(visibleSpeciesMatches(owned, access(), "Rex"), owned.matches);
  assert.deepEqual(visibleSpeciesMatches(owned, access(), "Stegosaurus"), []);
  assert.deepEqual(visibleSpeciesMatches(owned, access({ accessEpoch: 4 }), "Rex"), []);

  const accepted = acceptedSpeciesSelection(
    owned,
    "tyrannosaurus-rex",
    access(),
    "Rex",
  );
  assert.equal(accepted?.userId, "user-a");
  assert.equal(accepted?.accessEpoch, 3);

  const relabelled = acceptedSpeciesSelection(
    owned,
    "tyrannosaurus-rex",
    access({ accessEpoch: 4 }),
    "Rex",
  );
  assert.equal(relabelled, null);
  assert.equal(acceptedSpeciesSelection(owned, "tyrannosaurus-rex", access(), "Steg"), null);
});

test("a management recheck fails when the epoch changes while it is awaited", () => {
  const started = access();
  const moved = access({ accessEpoch: 4 });
  assert.equal(sameManagementAccess(started, started, started), true);
  assert.equal(sameManagementAccess(started, started, moved), false);
  assert.equal(sameManagementAccess(started, moved, moved), false);
  assert.equal(
    sameManagementAccess(started, started, access({ role: "senior" })),
    false,
  );
});

test("lookup access denial is only an authenticated HTTP rejection", () => {
  assert.equal(
    isSpeciesLookupAccessDenial(new SpeciesLookupFailure({
      code: "unauthorized",
      message: "You do not have permission to perform this action.",
    })),
    true,
  );
  assert.equal(
    isSpeciesLookupAccessDenial(new SpeciesLookupFailure({
      code: "unauthenticated",
      message: "You must be signed in to continue.",
    })),
    true,
  );
  assert.equal(
    isSpeciesLookupAccessDenial(new SpeciesLookupFailure({
      code: "validation",
      message: "Species name is invalid.",
    })),
    false,
  );
  assert.equal(isSpeciesLookupAccessDenial(new Error("unauthorized")), false);
});

test("lookup payload keeps external text and rejects a malformed list", () => {
  const markup = "<img src=x onerror=alert(1)>";
  const parsed = parseSpeciesLookupPayload({
    ok: true,
    data: [
      { external_species_id: "tyrannosaurus-rex", scientific_name: markup },
      {
        external_species_id: "abelisaurus",
        scientific_name: "Abelisaurus comahuensis",
        diet_profile: "carnivore",
      },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data[0]?.scientific_name, markup);
  assert.equal("diet_profile" in parsed.data[1], false);

  const badId = parseSpeciesLookupPayload({
    ok: true,
    data: [{ external_species_id: "Not A Slug", scientific_name: "Rex" }],
  });
  assert.equal(badId.ok, false);

  const empty = parseSpeciesLookupPayload({ ok: true, data: [] });
  assert.deepEqual(empty, { ok: true, data: [] });
});

test("lookup HTTP errors keep an allowlisted message and drop provider text", () => {
  const leaked = "secret at https://mwewivvwhdittuffkcrr.supabase.co/rest/v1/species";
  const invalid = speciesLookupError(400, {
    ok: false,
    error: { code: "unexpected", message: "Species name is invalid." },
  });
  assert.deepEqual(invalid, {
    code: "validation",
    message: "Species name is invalid.",
  });

  const forged = speciesLookupError(400, {
    ok: false,
    error: { code: "unauthorized", message: leaked },
  });
  assert.equal(forged.code, "validation");
  assert.equal(forged.message, SAFE_ERROR_MESSAGES.validation);
  assert.equal(forged.message.includes("supabase"), false);

  const denied = speciesLookupError(403, {
    error: { message: SAFE_ERROR_MESSAGES.unauthorized },
  });
  assert.equal(denied.code, "unauthorized");
  assert.equal(denied.message, SAFE_ERROR_MESSAGES.unauthorized);

  const upstream = speciesLookupError(502, {
    error: { message: "The external species service is unavailable." },
  });
  assert.equal(upstream.code, "unexpected");
  assert.equal(upstream.message, "The external species service is unavailable.");

  const gatewayLeak = speciesLookupError(502, { error: { message: leaked } });
  assert.equal(gatewayLeak.message, SAFE_ERROR_MESSAGES.unexpected);
  assert.equal(gatewayLeak.message.includes("secret"), false);
});

test("name lookup calls only the authenticated endpoint and preserves text", async () => {
  const markup = "<script>alert(1)</script>";
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      ok: true,
      data: [{ external_species_id: "tyrannosaurus-rex", scientific_name: markup }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const matches = await requestSpeciesNameLookup(" Tyrannosaurus rex ");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    `/api/species/lookup?name=${encodeURIComponent(" Tyrannosaurus rex ")}`,
  );
  assert.equal(calls[0]?.url.includes("/api/agent/"), false);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.credentials, "same-origin");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(matches[0]?.scientific_name, markup);
  assert.equal(matches[0]?.external_species_id, "tyrannosaurus-rex");
});

test("name lookup reports invalid, unauthorised and failed responses safely", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: false,
    error: { code: "validation", message: "Species name is invalid." },
  }), { status: 400 })) as typeof fetch;
  await assert.rejects(
    () => requestSpeciesNameLookup("R"),
    (error: unknown) => {
      assert.ok(error instanceof SpeciesLookupFailure);
      assert.equal(error.appError.code, "validation");
      assert.equal(error.appError.message, "Species name is invalid.");
      return true;
    },
  );

  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
  await assert.rejects(
    () => requestSpeciesNameLookup("Rex"),
    (error: unknown) => {
      assert.ok(error instanceof SpeciesLookupFailure);
      assert.equal(error.appError.code, "unauthenticated");
      assert.equal(error.appError.message.includes("nope"), false);
      return true;
    },
  );

  globalThis.fetch = (async () => {
    throw new TypeError("connect ECONNREFUSED 10.1.2.3");
  }) as typeof fetch;
  await assert.rejects(
    () => requestSpeciesNameLookup("Rex"),
    (error: unknown) => {
      assert.ok(error instanceof SpeciesLookupFailure);
      assert.equal(error.appError.message, SAFE_ERROR_MESSAGES.unexpected);
      assert.equal(error.appError.message.includes("10.1.2.3"), false);
      return true;
    },
  );
});
