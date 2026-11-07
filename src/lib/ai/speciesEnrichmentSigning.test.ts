import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import type { SpeciesEnrichmentProposal } from "./speciesEnrichmentSchemas.ts";
import {
  signSpeciesEnrichmentProposal,
  verifySpeciesEnrichmentProposal,
  type SignedSpeciesEnrichmentProposal,
} from "./speciesEnrichmentSigning.ts";

const ENV_KEY = "SPECIES_ENRICHMENT_SIGNING_SECRET";
const TEST_KEY = "a1".repeat(32);
const PROFILE_ID = "a492ce32-054a-41b2-8c2b-97cc49b0b7e7";
const OTHER_PROFILE_ID = "4e786f4f-978f-4b7e-98c6-2a6103bd6452";
const RETRIEVED_AT = "2026-11-06T12:00:00.000Z";
const previousKey = process.env[ENV_KEY];

const apiProvenance = {
  basis: "api_interpretation" as const,
  supporting_fields: ["region" as const],
  uncertainty: null,
};

const proposal: SpeciesEnrichmentProposal = {
  retrieval: {
    system: "external_species_api",
    external_species_id: "bramble-back",
    retrieved_at: RETRIEVED_AT,
  },
  api_content_authority: "untrusted_api_reference",
  api_facts: {
    id: "bramble-back",
    scientific_name: "Brambleback imaginarius",
    diet_profile: "Browser",
    geological_period: null,
    region: "Río Claro",
    social_requirements: "Pairs",
    general_care_recommendations: "Marsh banks",
    hybrid: false,
    franchise_origins: ["Fictional reserve"],
    franchise_appearances: [],
  },
  proposed_entry: {
    external_species_id: "bramble-back",
    display_name: "Brambleback imaginarius",
    general_description: "Native to Río Claro.",
    diet_preferences: "Marsh shrubs",
    habitat_preferences: "Shallow marsh",
    handling_guidance: "Keep to firm banks.",
    minimum_handlers: null,
    safety_class: "moderate",
  },
  provenance: {
    general_description: apiProvenance,
    diet_preferences: { ...apiProvenance, supporting_fields: ["diet_profile"] },
    habitat_preferences: apiProvenance,
    handling_guidance: {
      basis: "operational_recommendation",
      supporting_fields: ["general_care_recommendations"],
      uncertainty: null,
    },
    minimum_handlers: {
      basis: "operational_recommendation",
      supporting_fields: [],
      uncertainty: "The API gives no handler count.",
    },
    safety_class: { ...apiProvenance, basis: "operational_recommendation" },
  },
};

beforeEach(() => {
  process.env[ENV_KEY] = TEST_KEY;
});

afterEach(() => {
  if (previousKey === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previousKey;
});

function signFixture(): SignedSpeciesEnrichmentProposal {
  const result = signSpeciesEnrichmentProposal(proposal, PROFILE_ID);
  assert.equal(result.ok, true);
  return result.data;
}

function signTestBytes(bytes: Buffer, purpose = "amber:species-enrichment-proposal:v1:") {
  const payload = bytes.toString("base64url");
  const signature = createHmac("sha256", Buffer.from(TEST_KEY, "hex"))
    .update(purpose + payload, "ascii")
    .digest("hex");
  return { version: 1, payload, signature };
}

function assertInvalid(envelope: unknown, profileId = PROFILE_ID) {
  const result = verifySpeciesEnrichmentProposal(envelope, profileId);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation");
}

test("round-trips the complete temporary proposal for its Management profile", () => {
  const envelope = signFixture();
  assert.equal(envelope.version, 1);
  assert.deepEqual(verifySpeciesEnrichmentProposal(envelope, PROFILE_ID), {
    ok: true,
    data: proposal,
  });
});

test("rejects NUL and unpaired surrogates in proposed database text before signing", () => {
  for (const field of [
    "display_name", "general_description", "diet_preferences",
    "habitat_preferences", "handling_guidance",
  ] as const) {
    for (const invalidCharacter of ["\u0000", "\uD800", "\uDC00"]) {
      const result = signSpeciesEnrichmentProposal({
        ...proposal,
        proposed_entry: { ...proposal.proposed_entry, [field]: `Brambleback${invalidCharacter} habitat` },
      }, PROFILE_ID);
      assert.equal(result.ok, false, `Expected invalid text to be rejected in ${field}`);
      assert.equal(result.error.code, "validation");
    }
  }
});

test("preserves valid Unicode in signed database text", () => {
  const unicodeProposal = {
    ...proposal,
    proposed_entry: { ...proposal.proposed_entry, general_description: "Native to Río Claro. 🦕" },
  };
  const result = signSpeciesEnrichmentProposal(unicodeProposal, PROFILE_ID);
  assert.equal(result.ok, true);
  assert.deepEqual(verifySpeciesEnrichmentProposal(result.data, PROFILE_ID), {
    ok: true,
    data: unicodeProposal,
  });
});

test("rejects altered proposal data, claims and signatures", () => {
  const envelope = signFixture();
  const originalJson = Buffer.from(envelope.payload, "base64url").toString("utf8");
  for (const changedJson of [
    originalJson.replace("The API gives no handler count.", "One handler is enough."),
    originalJson.replace(PROFILE_ID, OTHER_PROFILE_ID),
    originalJson.replace(/"expires_at":\d+/, '"expires_at":4102444800000'),
    ` ${originalJson}`,
  ]) {
    assertInvalid({ ...envelope, payload: Buffer.from(changedJson).toString("base64url") });
  }

  const differentDigit = envelope.signature[0] === "0" ? "1" : "0";
  assertInvalid({ ...envelope, signature: differentDigit + envelope.signature.slice(1) });
  assertInvalid({ ...envelope, signature: "00" });
});

test("rejects the envelope at expiry", ({ mock }) => {
  const issuedAt = Date.parse(RETRIEVED_AT);
  const expiry = issuedAt + 30 * 60 * 1000;
  mock.timers.enable({ apis: ["Date"], now: issuedAt });
  const envelope = signFixture();

  mock.timers.setTime(expiry - 1);
  assert.equal(verifySpeciesEnrichmentProposal(envelope, PROFILE_ID).ok, true);
  mock.timers.setTime(expiry);
  assertInvalid(envelope);
});

test("rejects a different profile and unsupported envelope versions", () => {
  const envelope = signFixture();
  assertInvalid(envelope, OTHER_PROFILE_ID);
  assertInvalid({ ...envelope, version: 2 });
});

test("verifies exact signed bytes and rejects a different signing purpose", () => {
  const bytes = Buffer.concat([
    Buffer.from(" "),
    Buffer.from(signFixture().payload, "base64url"),
  ]);
  assert.equal(verifySpeciesEnrichmentProposal(signTestBytes(bytes), PROFILE_ID).ok, true);
  assertInvalid(signTestBytes(bytes, "amber:species-enrichment-insert:v1:"));
});

test("rejects signed malformed bytes and invalid decoded proposals", () => {
  const json = Buffer.from(signFixture().payload, "base64url").toString("utf8");
  assertInvalid(signTestBytes(Buffer.from("{")));
  assertInvalid(signTestBytes(Buffer.from([0xff])));
  assertInvalid(signTestBytes(Buffer.from(json.replace('"moderate"', '"extreme"'))));
});

test("fails closed when the signing secret is missing or malformed", () => {
  const envelope = signFixture();
  const error = {
    ok: false,
    error: { code: "unexpected", message: "Species proposal signing is not configured." },
  };

  delete process.env[ENV_KEY];
  assert.deepEqual(signSpeciesEnrichmentProposal(proposal, PROFILE_ID), error);
  assert.deepEqual(verifySpeciesEnrichmentProposal(envelope, PROFILE_ID), error);

  process.env[ENV_KEY] = "invalid-key";
  assert.deepEqual(signSpeciesEnrichmentProposal(proposal, PROFILE_ID), error);
  assert.deepEqual(verifySpeciesEnrichmentProposal(envelope, PROFILE_ID), error);
});
