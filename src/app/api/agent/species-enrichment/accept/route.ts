import { handleSpeciesAcceptancePost } from "@/lib/ai/speciesEnrichmentEndpoint";
import { getCurrentProfile, resolveLinkedProfile } from "@/lib/currentProfile";

export function POST(request: Request): Promise<Response> {
  return handleSpeciesAcceptancePost(request, getCurrentProfile, resolveLinkedProfile);
}
