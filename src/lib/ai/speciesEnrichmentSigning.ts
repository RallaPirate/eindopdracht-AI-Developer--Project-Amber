import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { err, ok, type AppResult } from "../appResult.ts";
import {
  speciesEnrichmentProposalSchema,
  type SpeciesEnrichmentProposal,
} from "./speciesEnrichmentSchemas.ts";

const VERSION = 1;
const PURPOSE = "amber:species-enrichment-proposal";
const REVIEW_TTL_MS = 30 * 60 * 1000;
const HEX_32_BYTES = /^[a-f0-9]{64}$/i;
const NOT_CONFIGURED = "Species proposal signing is not configured.";
const INVALID_PROPOSAL = "The signed species proposal is invalid or expired.";

const envelopeSchema = z.strictObject({
  version: z.literal(VERSION),
  payload: z.string().regex(/^[A-Za-z0-9_-]+$/),
  signature: z.string().regex(HEX_32_BYTES),
});

const payloadSchema = z.strictObject({
  profile_id: z.uuid(),
  expires_at: z.number().int().positive(),
  proposal: speciesEnrichmentProposalSchema,
});

export type SignedSpeciesEnrichmentProposal = z.infer<typeof envelopeSchema>;

function readSigningKey(): Buffer | null {
  const secret = process.env.SPECIES_ENRICHMENT_SIGNING_SECRET;
  return secret && HEX_32_BYTES.test(secret) ? Buffer.from(secret, "hex") : null;
}

function proposalMac(key: Buffer, encodedPayload: string): Buffer {
  return createHmac("sha256", key)
    .update(`${PURPOSE}:v${VERSION}:`, "ascii")
    .update(encodedPayload, "ascii")
    .digest();
}

/** The caller supplies the permanent profile ID after authorizing Management. */
export function signSpeciesEnrichmentProposal(
  proposal: SpeciesEnrichmentProposal,
  profileId: string,
): AppResult<SignedSpeciesEnrichmentProposal> {
  const key = readSigningKey();
  if (!key) return err("unexpected", NOT_CONFIGURED);

  const payload = payloadSchema.safeParse({
    profile_id: profileId,
    expires_at: Date.now() + REVIEW_TTL_MS,
    proposal,
  });
  if (!payload.success) return err("validation", INVALID_PROPOSAL);

  const encodedPayload = Buffer.from(JSON.stringify(payload.data), "utf8").toString("base64url");
  return ok({
    version: VERSION,
    payload: encodedPayload,
    signature: proposalMac(key, encodedPayload).toString("hex"),
  });
}

/** Verify the exact encoded bytes before decoding or trusting any claims. */
export function verifySpeciesEnrichmentProposal(
  envelope: unknown,
  profileId: string,
): AppResult<SpeciesEnrichmentProposal> {
  const key = readSigningKey();
  if (!key) return err("unexpected", NOT_CONFIGURED);

  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) return err("validation", INVALID_PROPOSAL);

  const { payload, signature } = parsed.data;
  if (!timingSafeEqual(proposalMac(key, payload), Buffer.from(signature, "hex"))) {
    return err("validation", INVALID_PROPOSAL);
  }

  const bytes = Buffer.from(payload, "base64url");
  if (bytes.toString("base64url") !== payload) return err("validation", INVALID_PROPOSAL);

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return err("validation", INVALID_PROPOSAL);
  }

  const verified = payloadSchema.safeParse(decoded);
  if (
    !verified.success ||
    verified.data.profile_id !== profileId ||
    verified.data.expires_at <= Date.now()
  ) {
    return err("validation", INVALID_PROPOSAL);
  }

  return ok(verified.data.proposal);
}
