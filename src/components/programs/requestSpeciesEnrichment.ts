import {
  speciesEnrichmentProposalSchema,
  type SpeciesEnrichmentAcceptance,
} from "@/lib/ai/speciesEnrichmentSchemas";
import type { SignedSpeciesEnrichmentProposal } from "@/lib/ai/speciesEnrichmentSigning";
import { AppFailure, SAFE_ERROR_MESSAGES, type AppErrorCode } from "@/lib/appResult";

const ACCESS_CODES: Partial<Record<number, AppErrorCode>> = {
  401: "unauthenticated",
  403: "unauthorized",
};

export type SpeciesAcceptanceRequest = Omit<SpeciesEnrichmentAcceptance, "proposal"> & {
  signed_proposal: SignedSpeciesEnrichmentProposal;
};

const ACCEPTANCE_MESSAGES = {
  validation: "The species entry was rejected. Check the completions and justifications.",
  invalidProposal: "This proposal is invalid or expired. Search again to generate a new proposal.",
  duplicate: "A local entry already exists for this species. Check Browse Species.",
  unconfirmed: "The save could not be confirmed. Check Browse Species before trying again.",
} as const;

export class SpeciesAcceptanceFailure extends Error {
  constructor(readonly reason: keyof typeof ACCEPTANCE_MESSAGES) {
    super(ACCEPTANCE_MESSAGES[reason]);
  }
}

function postSpeciesRequest(path: string, body: unknown) {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function requestSpeciesEnrichment(externalSpeciesId: string) {
  const response = await postSpeciesRequest("/api/agent/species-enrichment", {
    external_species_id: externalSpeciesId,
  });

  if (!response.ok) {
    const code = ACCESS_CODES[response.status] ?? "unexpected";
    throw new AppFailure({ code, message: SAFE_ERROR_MESSAGES[code] });
  }

  const body = await response.json();
  const proposal = speciesEnrichmentProposalSchema.safeParse(body?.data);
  const signedProposal = body?.signed_proposal;
  if (
    body?.ok !== true ||
    signedProposal?.version !== 1 ||
    typeof signedProposal.payload !== "string" || !signedProposal.payload ||
    typeof signedProposal.signature !== "string" || !signedProposal.signature ||
    !proposal.success ||
    proposal.data.retrieval.external_species_id !== externalSpeciesId ||
    proposal.data.api_facts.id !== externalSpeciesId ||
    proposal.data.proposed_entry.external_species_id !== externalSpeciesId
  ) {
    throw new AppFailure({ code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected });
  }
  return { proposal: proposal.data, signedProposal: signedProposal as SignedSpeciesEnrichmentProposal };
}

export async function requestSpeciesAcceptance(request: SpeciesAcceptanceRequest): Promise<void> {
  let response: Response;
  try {
    response = await postSpeciesRequest("/api/agent/species-enrichment/accept", request);
  } catch {
    throw new SpeciesAcceptanceFailure("unconfirmed");
  }

  const access = ACCESS_CODES[response.status];
  if (access) throw new AppFailure({ code: access, message: SAFE_ERROR_MESSAGES[access] });
  if (response.status === 409) throw new SpeciesAcceptanceFailure("duplicate");

  const body = await response.json().catch(() => null);
  if (response.status === 400) {
    throw new SpeciesAcceptanceFailure(
      body?.error?.message === "The signed species proposal is invalid or expired."
        ? "invalidProposal"
        : "validation",
    );
  }
  if (
    response.status !== 201 ||
    body?.ok !== true ||
    body.data?.external_species_id !== request.accepted_entry.external_species_id
  ) {
    throw new SpeciesAcceptanceFailure("unconfirmed");
  }
}
