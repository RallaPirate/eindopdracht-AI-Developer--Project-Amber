import "server-only";

import { createHmac } from "node:crypto";
import { z } from "zod";

import { err, ok, type AppResult } from "../appResult.ts";
import type { speciesEnrichmentAcceptanceSchema } from "./speciesEnrichmentSchemas.ts";

export const SPECIES_INSERT_PROOF_HEADER = "x-amber-species-insert-proof";

const VERSION = "v1";
const PURPOSE = "amber:species-enrichment-insert";
const TTL_SECONDS = 60;
const profileIdSchema = z.uuid();

type AcceptedSpeciesEntry = z.infer<typeof speciesEnrichmentAcceptanceSchema>["accepted_entry"];

/** Mint only after server-side acceptance validation, using the verified profile ID.
 * Set the result on the outgoing insert with setHeader, never from an inbound header.
 */
export function mintSpeciesInsertProof(
  profileId: string,
  entry: AcceptedSpeciesEntry,
): AppResult<string> {
  const secret = process.env.SPECIES_INSERT_PROOF_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) {
    return err("unexpected", "Species insert proof signing is not configured.");
  }

  // Keep this order and encoding in sync with private.verify_species_insert_proof.
  // Hex encodes UTF-8 bytes so colons and JSON escaping cannot change field boundaries.
  const fields = [
    entry.external_species_id,
    entry.display_name,
    entry.general_description,
    entry.diet_preferences,
    entry.habitat_preferences,
    entry.handling_guidance,
    String(entry.minimum_handlers),
    entry.safety_class,
  ];
  if (!profileIdSchema.safeParse(profileId).success || fields.some((field) => !field.isWellFormed())) {
    return err("validation");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const encodedFields = fields.map((field) => Buffer.from(field, "utf8").toString("hex"));
  const message = [PURPOSE, VERSION, expiresAt, profileId.toLowerCase(), ...encodedFields].join(":");
  const signature = createHmac("sha256", Buffer.from(secret, "hex")).update(message).digest("hex");
  return ok(`${VERSION}.${expiresAt}.${signature}`);
}
