import { err, ok, type AppResult } from "./appResult.ts";

/**
 * One record from the external Species API (`public.species`).
 * Field values are preserved as returned. They are untrusted reference
 * data: `general_care_recommendations` is not an instruction to the Agent
 * and is not an approved operational decision.
 */
export type ExternalSpecies = {
  id: string;
  scientific_name: string;
  diet_profile: string;
  geological_period: string | null;
  region: string | null;
  social_requirements: string;
  general_care_recommendations: string;
  hybrid: boolean;
  franchise_origins: string[];
  franchise_appearances: string[];
};

const EXPECTED_HOST = "mwewivvwhdittuffkcrr.supabase.co";
const SPECIES_PATH = "/rest/v1/species";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_SPECIES_ID_LENGTH = 128;

/** Lowercase slug, e.g. `abelisaurus` or `tyrannosaurus-rex`. */
const SPECIES_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const SPECIES_COLUMNS = [
  "id",
  "scientific_name",
  "diet_profile",
  "geological_period",
  "region",
  "social_requirements",
  "general_care_recommendations",
  "hybrid",
  "franchise_origins",
  "franchise_appearances",
] as const;

const MESSAGES = {
  invalidId: "Species identifier is invalid.",
  notConfigured: "The external species service is not configured.",
  unavailable: "The external species service is unavailable.",
  timedOut: "The external species request timed out.",
  invalidData: "The external species data is invalid.",
  mismatchedId: "The external species record did not match the requested identifier.",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExternalSpeciesId(value: unknown): AppResult<string> {
  if (typeof value !== "string") {
    return err("validation", MESSAGES.invalidId);
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SPECIES_ID_LENGTH ||
    !SPECIES_ID_PATTERN.test(trimmed)
  ) {
    return err("validation", MESSAGES.invalidId);
  }

  return ok(trimmed);
}

/**
 * Reads the external project URL and publishable key.
 * The request origin is fixed to the known Species API host; a caller
 * cannot supply a URL. The key is the external publishable key only.
 */
function readExternalSpeciesConfig(): AppResult<{ endpoint: URL; apiKey: string }> {
  const urlValue = process.env.EXTERNAL_SPECIES_SUPABASE_URL?.trim();
  const apiKey = process.env.EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!urlValue || !apiKey) {
    return err("unexpected", MESSAGES.notConfigured);
  }

  let configured: URL;
  try {
    configured = new URL(urlValue);
  } catch {
    return err("unexpected", MESSAGES.notConfigured);
  }

  const originIsAllowed =
    configured.protocol === "https:" &&
    configured.hostname === EXPECTED_HOST &&
    configured.port === "" &&
    configured.username === "" &&
    configured.password === "" &&
    configured.pathname === "/" &&
    configured.search === "" &&
    configured.hash === "";

  if (!originIsAllowed) {
    return err("unexpected", MESSAGES.notConfigured);
  }

  const endpoint = new URL(SPECIES_PATH, configured.origin);
  return ok({ endpoint, apiKey });
}

function parseRequiredText(value: unknown): AppResult<string> {
  if (typeof value !== "string") {
    return err("validation", MESSAGES.invalidData);
  }
  return ok(value);
}

function parseNullableText(value: unknown): AppResult<string | null> {
  if (value === null) return ok(null);
  return parseRequiredText(value);
}

function parseStringArray(value: unknown): AppResult<string[]> {
  if (!Array.isArray(value)) {
    return err("validation", MESSAGES.invalidData);
  }

  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return err("validation", MESSAGES.invalidData);
    }
    items.push(item);
  }
  return ok(items);
}

function parseExternalSpecies(
  value: unknown,
  requestedId: string,
): AppResult<ExternalSpecies> {
  if (!isRecord(value) || typeof value.id !== "string") {
    return err("validation", MESSAGES.invalidData);
  }
  if (value.id !== requestedId) {
    return err("validation", MESSAGES.mismatchedId);
  }

  const scientificName = parseRequiredText(value.scientific_name);
  if (!scientificName.ok) return scientificName;
  const dietProfile = parseRequiredText(value.diet_profile);
  if (!dietProfile.ok) return dietProfile;
  const geologicalPeriod = parseNullableText(value.geological_period);
  if (!geologicalPeriod.ok) return geologicalPeriod;
  const region = parseNullableText(value.region);
  if (!region.ok) return region;
  const socialRequirements = parseRequiredText(value.social_requirements);
  if (!socialRequirements.ok) return socialRequirements;
  const care = parseRequiredText(value.general_care_recommendations);
  if (!care.ok) return care;
  if (typeof value.hybrid !== "boolean") {
    return err("validation", MESSAGES.invalidData);
  }
  const origins = parseStringArray(value.franchise_origins);
  if (!origins.ok) return origins;
  const appearances = parseStringArray(value.franchise_appearances);
  if (!appearances.ok) return appearances;

  return ok({
    id: value.id,
    scientific_name: scientificName.data,
    diet_profile: dietProfile.data,
    geological_period: geologicalPeriod.data,
    region: region.data,
    social_requirements: socialRequirements.data,
    general_care_recommendations: care.data,
    hybrid: value.hybrid,
    franchise_origins: origins.data,
    franchise_appearances: appearances.data,
  });
}

function isTimeout(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("name" in cause)) {
    return false;
  }
  return cause.name === "TimeoutError" || cause.name === "AbortError";
}

async function readSpeciesPayload(
  endpoint: URL,
  apiKey: string,
): Promise<AppResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        apikey: apiKey,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (isTimeout(cause)) {
      return err("unexpected", MESSAGES.timedOut);
    }
    return err("unexpected", MESSAGES.unavailable);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403) {
      return err("unauthorized");
    }
    if (response.status === 404) {
      return err("not_found");
    }
    return err("unexpected", MESSAGES.unavailable);
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return err("unexpected", MESSAGES.unavailable);
  }

  try {
    return ok(JSON.parse(body));
  } catch {
    return err("validation", MESSAGES.invalidData);
  }
}

/**
 * Retrieves one external species by its slug identifier.
 * Reads `EXTERNAL_SPECIES_SUPABASE_URL` and
 * `EXTERNAL_SPECIES_SUPABASE_PUBLISHABLE_KEY` from `process.env`.
 * The publishable key is sent only in the `apikey` header.
 * Does not write to either database and does not use Amber's session.
 */
export async function getExternalSpecies(
  speciesId: unknown,
): Promise<AppResult<ExternalSpecies>> {
  const parsedId = parseExternalSpeciesId(speciesId);
  if (!parsedId.ok) return parsedId;

  const config = readExternalSpeciesConfig();
  if (!config.ok) return config;

  const endpoint = new URL(config.data.endpoint);
  endpoint.searchParams.set("id", `eq.${parsedId.data}`);
  endpoint.searchParams.set("select", SPECIES_COLUMNS.join(","));
  endpoint.searchParams.set("limit", "1");

  const payload = await readSpeciesPayload(endpoint, config.data.apiKey);
  if (!payload.ok) return payload;
  if (!Array.isArray(payload.data)) {
    return err("validation", MESSAGES.invalidData);
  }
  if (payload.data.length === 0) {
    return err("not_found");
  }
  if (payload.data.length !== 1) {
    return err("validation", MESSAGES.invalidData);
  }

  return parseExternalSpecies(payload.data[0], parsedId.data);
}
