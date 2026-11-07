import {
  err,
  ok,
  requireCurrentProfile,
  SAFE_ERROR_MESSAGES,
  type AppError,
  type AppErrorCode,
  type AppResult,
} from "./appResult.ts";
import type { CurrentProfileResult } from "./currentProfile.ts";
import {
  parseExternalSpeciesName,
  type ExternalSpeciesNameMatch,
} from "./externalSpecies.ts";

/**
 * HTTP boundary for a Management-only scientific-name lookup.
 * The external Species API is contacted only after the caller's
 * authoritative profile role is management. This module does not
 * persist species and does not call a language model.
 */

export const SPECIES_LOOKUP_REQUEST_MESSAGES = {
  origin: "Cross-origin requests are not permitted.",
  invalidName: "Species name is invalid.",
} as const;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Messages the lookup already treats as safe to disclose.
 * Any other text is replaced so provider bodies cannot pass through.
 */
const SAFE_LOOKUP_MESSAGES = new Set<string>([
  ...Object.values(SAFE_ERROR_MESSAGES),
  SPECIES_LOOKUP_REQUEST_MESSAGES.invalidName,
  "The external species data is invalid.",
  "The external species service is not configured.",
  "The external species service is unavailable.",
  "The external species request timed out.",
]);

export type SpeciesNameLookupRecord = {
  external_species_id: string;
  scientific_name: string;
};

export type SpeciesLookupEndpointDependencies = {
  getCurrentProfile: () => Promise<CurrentProfileResult>;
  lookupSpeciesByName: (
    speciesName: string,
  ) => Promise<AppResult<ExternalSpeciesNameMatch[]>>;
};

function respond(result: AppResult<unknown>, status: number): Response {
  const body = result.ok
    ? { ok: true as const, data: result.data }
    : {
        ok: false as const,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };

  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function failure(error: AppError, status: number): Response {
  return respond(err(error.code, error.message), status);
}

/**
 * Same-origin browser requests are allowed. A missing Origin is allowed
 * when Sec-Fetch-Site is absent or `same-origin`, so a same-origin GET
 * fetch is not rejected solely because the browser omitted Origin.
 * A present Origin or Sec-Fetch-Site that is not same-origin is rejected.
 */
function isSameOrigin(request: Request): boolean {
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (expected === "null") return false;

  const originHeader = request.headers.get("origin");
  if (originHeader !== null) {
    let actual: string;
    try {
      actual = new URL(originHeader).origin;
    } catch {
      return false;
    }
    if (actual === "null" || actual !== expected) return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite.toLowerCase() !== "same-origin") {
    return false;
  }

  return true;
}

function readLookupName(request: Request): AppResult<string> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return err("validation", SPECIES_LOOKUP_REQUEST_MESSAGES.invalidName);
  }

  const pairs = [...url.searchParams.entries()];
  if (pairs.length !== 1 || pairs[0]?.[0] !== "name") {
    return err("validation", SPECIES_LOOKUP_REQUEST_MESSAGES.invalidName);
  }

  return parseExternalSpeciesName(pairs[0][1]);
}

function statusForCode(code: AppErrorCode): number {
  switch (code) {
    case "validation":
      return 400;
    case "unauthenticated":
      return 401;
    case "unauthorized":
      return 403;
    case "not_found":
      return 404;
    default:
      return 500;
  }
}

const UPSTREAM_GATEWAY_MESSAGES = new Set<string>([
  "The external species data is invalid.",
  "The external species service is unavailable.",
]);

/** Upstream lookup failures are a bad gateway. Caller input stays HTTP 400. */
function statusForLookupError(error: AppError): number {
  if (error.code === "unexpected" && UPSTREAM_GATEWAY_MESSAGES.has(error.message)) {
    return 502;
  }
  return statusForCode(error.code);
}

/**
 * Upstream authentication and configuration failures must not be reported
 * as the caller's application role. After Management authorisation, those
 * codes are server failures.
 */
function presentLookupError(error: AppError): AppError {
  let code = error.code;
  let message = error.message;

  if (code === "unauthorized" || code === "unauthenticated") {
    code = "unexpected";
    message = SAFE_ERROR_MESSAGES.unexpected;
  } else if (code === "not_found") {
    code = "unexpected";
    message = "The external species service is unavailable.";
  } else if (
    code === "validation" &&
    message === "The external species data is invalid."
  ) {
    code = "unexpected";
  }

  return {
    code,
    message: SAFE_LOOKUP_MESSAGES.has(message)
      ? message
      : SAFE_ERROR_MESSAGES[code],
  };
}

function toLookupRecords(
  matches: readonly ExternalSpeciesNameMatch[],
): SpeciesNameLookupRecord[] {
  return matches.map((match) => ({
    external_species_id: match.id,
    scientific_name: match.scientific_name,
  }));
}

/**
 * Authorises a Management caller, then searches the external Species API
 * by scientific name. No external request is made for a caller who is
 * not Management, or for a query that fails validation.
 */
export async function handleSpeciesLookupGet(
  request: Request,
  dependencies: SpeciesLookupEndpointDependencies,
): Promise<Response> {
  if (request.method !== "GET") {
    return failure(
      { code: "validation", message: SAFE_ERROR_MESSAGES.validation },
      405,
    );
  }

  if (!isSameOrigin(request)) {
    return failure(
      {
        code: "unauthorized",
        message: SPECIES_LOOKUP_REQUEST_MESSAGES.origin,
      },
      403,
    );
  }

  let profile: CurrentProfileResult;
  try {
    profile = await dependencies.getCurrentProfile();
  } catch {
    return failure(
      { code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected },
      500,
    );
  }

  const access = requireCurrentProfile(profile);
  if (!access.ok) {
    if (access.error.code === "unauthenticated") {
      return failure(
        { code: "unauthenticated", message: SAFE_ERROR_MESSAGES.unauthenticated },
        401,
      );
    }
    if (access.error.code === "unauthorized") {
      const message =
        access.error.message === SAFE_ERROR_MESSAGES.unlinked
          ? SAFE_ERROR_MESSAGES.unlinked
          : SAFE_ERROR_MESSAGES.unauthorized;
      return failure({ code: "unauthorized", message }, 403);
    }
    return failure(
      { code: "database", message: SAFE_ERROR_MESSAGES.database },
      500,
    );
  }

  if (access.data.role !== "management") {
    return failure(
      { code: "unauthorized", message: SAFE_ERROR_MESSAGES.unauthorized },
      403,
    );
  }

  const name = readLookupName(request);
  if (!name.ok) return failure(name.error, 400);

  let matches: AppResult<ExternalSpeciesNameMatch[]>;
  try {
    matches = await dependencies.lookupSpeciesByName(name.data);
  } catch {
    return failure(
      { code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected },
      500,
    );
  }

  if (!matches.ok) {
    const error = presentLookupError(matches.error);
    return failure(error, statusForLookupError(error));
  }

  return respond(ok(toLookupRecords(matches.data)), 200);
}
