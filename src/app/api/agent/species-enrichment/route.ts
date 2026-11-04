import { getCurrentProfile } from "@/lib/currentProfile";
import { runSpeciesEnrichmentFlow } from "@/lib/ai/speciesEnrichmentFlow";
import { handleSpeciesEnrichmentPost } from "@/lib/ai/speciesEnrichmentEndpoint";

/**
 * Management-only temporary species enrichment.
 * The handler resolves the linked profile and role before the Agent runs.
 * The response is not an approved or stored species record.
 */
export function POST(request: Request): Promise<Response> {
  return handleSpeciesEnrichmentPost(request, {
    getCurrentProfile,
    runSpeciesEnrichment: runSpeciesEnrichmentFlow,
  });
}
