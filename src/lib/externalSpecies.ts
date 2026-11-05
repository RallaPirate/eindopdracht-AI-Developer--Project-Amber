import { err, ok, type AppError, type AppResult } from "./appResult.ts";

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

/** Accepted search text after trimming and collapsing repeated spaces. */
export const EXTERNAL_SPECIES_NAME_MAX_LENGTH = 80;

/**
 * Raw query text before normalisation. Larger than the normalised limit so
 * surrounding whitespace still fits, and small enough to reject a huge query.
 */
export const EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH = 256;

/** PostgREST `limit` for a name lookup. The full table is never requested. */
export const EXTERNAL_SPECIES_LOOKUP_LIMIT = 10;

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
  invalidName: "Species name is invalid.",
  notConfigured: "The external species service is not configured.",
  unavailable: "The external species service is unavailable.",
  timedOut: "The external species request timed out.",
  invalidData: "The external species data is invalid.",
  mismatchedId: "The external species record did not match the requested identifier.",
} as const;

/**
 * Letters, spaces, hyphens and apostrophes only.
 * Excludes PostgREST reserved characters and LIKE wildcards.
 */
const SPECIES_NAME_PATTERN = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

/** Returned scientific names are reference text, not a second search query. */
const MAX_RETURNED_SCIENTIFIC_NAME_LENGTH = 300;

const NAME_LOOKUP_COLUMNS = ["id", "scientific_name"] as const;

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
 * Normalises a species-name search.
 * Trims ends, collapses repeated spaces, then applies length and character limits.
 * Does not contact the external service.
 */
export function parseExternalSpeciesName(value: unknown): AppResult<string> {
  if (typeof value !== "string") {
    return err("validation", MESSAGES.invalidName);
  }
  if (value.length > EXTERNAL_SPECIES_NAME_RAW_MAX_LENGTH) {
    return err("validation", MESSAGES.invalidName);
  }

  const normalised = value.trim().replace(/ {2,}/g, " ");
  if (
    normalised.length < 2 ||
    normalised.length > EXTERNAL_SPECIES_NAME_MAX_LENGTH ||
    !SPECIES_NAME_PATTERN.test(normalised)
  ) {
    return err("validation", MESSAGES.invalidName);
  }

  return ok(normalised);
}

/**
 * Escapes a value embedded in a PostgREST `ilike` filter.
 * `*` is PostgREST's wildcard; `%` and `_` are SQL LIKE wildcards.
 * `, . : ( )` are reserved filter characters. The name parser already
 * rejects these; escaping keeps a future pattern change from becoming injection.
 */
function escapePostgrestIlikeLiteral(value: string): string {
  return value.replace(/[\\*,.:()%_]/g, (character) => `\\${character}`);
}

function isCanonicalSpeciesId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SPECIES_ID_LENGTH &&
    SPECIES_ID_PATTERN.test(value)
  );
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

/** One external species identified during a name search. */
export type ExternalSpeciesNameMatch = {
  /** Canonical `public.species.id` as returned by the external API. */
  id: string;
  /** `scientific_name` as returned by the external API. */
  scientific_name: string;
};

function parseSpeciesNameMatch(value: unknown): AppResult<ExternalSpeciesNameMatch> {
  if (!isRecord(value) || !isCanonicalSpeciesId(value.id)) {
    return err("validation", MESSAGES.invalidData);
  }
  if (
    typeof value.scientific_name !== "string" ||
    value.scientific_name.trim().length === 0 ||
    value.scientific_name.length > MAX_RETURNED_SCIENTIFIC_NAME_LENGTH
  ) {
    return err("validation", MESSAGES.invalidData);
  }

  return ok({
    id: value.id,
    scientific_name: value.scientific_name,
  });
}

function compareNameMatches(
  left: ExternalSpeciesNameMatch,
  right: ExternalSpeciesNameMatch,
): number {
  if (left.scientific_name < right.scientific_name) return -1;
  if (left.scientific_name > right.scientific_name) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Name lookup must not report an upstream failure as bad caller input
 * or as a missing species. By-id retrieval keeps its own error contract.
 */
function upstreamLookupFailure(failure: AppError): AppResult<never> {
  if (failure.code === "not_found") {
    return err("unexpected", MESSAGES.unavailable);
  }
  if (failure.code === "validation") {
    return err("unexpected", MESSAGES.invalidData);
  }
  return err(failure.code, failure.message);
}

/**
 * Searches the external Species API by scientific name.
 * Case-insensitive partial match via PostgREST `ilike`, bounded and ordered.
 * Reads the same fixed-host configuration as {@link getExternalSpecies}.
 * Does not write to either database and does not use Amber's session.
 */
export async function lookupExternalSpeciesByName(
  speciesName: unknown,
): Promise<AppResult<ExternalSpeciesNameMatch[]>> {
  const parsedName = parseExternalSpeciesName(speciesName);
  if (!parsedName.ok) return parsedName;

  const config = readExternalSpeciesConfig();
  if (!config.ok) return config;

  const endpoint = new URL(config.data.endpoint);
  const literal = escapePostgrestIlikeLiteral(parsedName.data);
  endpoint.searchParams.set("scientific_name", `ilike.*${literal}*`);
  endpoint.searchParams.set("select", NAME_LOOKUP_COLUMNS.join(","));
  endpoint.searchParams.set("order", "scientific_name.asc,id.asc");
  endpoint.searchParams.set("limit", String(EXTERNAL_SPECIES_LOOKUP_LIMIT));

  const payload = await readSpeciesPayload(endpoint, config.data.apiKey);
  if (!payload.ok) return upstreamLookupFailure(payload.error);
  if (!Array.isArray(payload.data) || payload.data.length > EXTERNAL_SPECIES_LOOKUP_LIMIT) {
    return err("unexpected", MESSAGES.invalidData);
  }

  const matches: ExternalSpeciesNameMatch[] = [];
  for (const item of payload.data) {
    const parsed = parseSpeciesNameMatch(item);
    if (!parsed.ok) return upstreamLookupFailure(parsed.error);
    matches.push(parsed.data);
  }

  matches.sort(compareNameMatches);
  return ok(matches);
}
