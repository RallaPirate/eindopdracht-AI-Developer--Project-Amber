import { speciesEnrichmentProposalSchema } from "@/lib/ai/speciesEnrichmentSchemas";
import { AppFailure, SAFE_ERROR_MESSAGES, type AppErrorCode } from "@/lib/appResult";

export async function requestSpeciesEnrichment(externalSpeciesId: string) {
  const response = await fetch("/api/agent/species-enrichment", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ external_species_id: externalSpeciesId }),
  });

  if (!response.ok) {
    const accessCodes: Partial<Record<number, AppErrorCode>> = {
      401: "unauthenticated",
      403: "unauthorized",
    };
    const code = accessCodes[response.status] ?? "unexpected";
    throw new AppFailure({ code, message: SAFE_ERROR_MESSAGES[code] });
  }

  const body = await response.json();
  const proposal = speciesEnrichmentProposalSchema.safeParse(body?.data);
  if (
    body?.ok !== true ||
    !proposal.success ||
    proposal.data.retrieval.external_species_id !== externalSpeciesId ||
    proposal.data.api_facts.id !== externalSpeciesId ||
    proposal.data.proposed_entry.external_species_id !== externalSpeciesId
  ) {
    throw new AppFailure({ code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected });
  }
  return proposal.data;
}
