import { getCurrentProfile } from "@/lib/currentProfile";
import { lookupExternalSpeciesByName } from "@/lib/externalSpecies";
import { handleSpeciesLookupGet } from "@/lib/speciesLookupEndpoint";

/**
 * Management-only scientific-name lookup against the external Species API.
 * The handler resolves the linked profile and role before any external request.
 * The response is a list of names and canonical ids, not a stored species record.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleSpeciesLookupGet(request, {
    getCurrentProfile,
    lookupSpeciesByName: lookupExternalSpeciesByName,
  });
}
