import "server-only";

import { z } from "zod";

import {
  err,
  mapSupabaseError,
  ok,
  requireCurrentProfile,
  SAFE_ERROR_MESSAGES,
  type AppError,
  type AppErrorCode,
  type AppResult,
} from "../appResult.ts";
import type { CurrentProfileResult, resolveLinkedProfile } from "../currentProfile.ts";
import {
  parseSpeciesEnrichmentRequest,
  speciesEnrichmentAcceptanceSchema,
  type SpeciesEnrichmentProposal,
} from "./speciesEnrichmentSchemas.ts";
import {
  signSpeciesEnrichmentProposal,
  verifySpeciesEnrichmentProposal,
} from "./speciesEnrichmentSigning.ts";
import { mintSpeciesInsertProof, SPECIES_INSERT_PROOF_HEADER } from "./speciesInsertProof.ts";

/** Large enough for one species identifier and tight enough to reject a payload. */
export const SPECIES_ENRICHMENT_MAX_BODY_BYTES = 1024;

// Acceptance includes the encoded source snapshot as well as the reviewed fields.
export const SPECIES_ACCEPTANCE_MAX_BODY_BYTES = 1024 * 1024;

const acceptanceRequestSchema = z.strictObject({
  signed_proposal: z.unknown(),
  accepted_entry: z.unknown(),
  management_completions: z.unknown(),
});

export const SPECIES_ENRICHMENT_REQUEST_MESSAGES = {
  origin: "Cross-origin requests are not permitted.",
  contentType: "The request body must be JSON.",
  tooLarge: "The request body is too large.",
  malformedJson: "The request body is not valid JSON.",
} as const;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Messages the Agent flow already treats as safe to disclose.
 * Any other agent text is replaced so provider bodies cannot pass through.
 */
const SAFE_AGENT_MESSAGES = new Set<string>([
  ...Object.values(SAFE_ERROR_MESSAGES),
  "Species identifier is invalid.",
  "The enrichment proposal is invalid.",
  "The external species data is invalid.",
  "The external species data was not retrieved.",
  "The species retrieval request was rejected.",
  "The enrichment request reached its execution limit.",
  "The enrichment request timed out.",
  "The language model is not configured.",
  "The external species service is not configured.",
  "The external species service is unavailable.",
  "The external species request timed out.",
  "The retrieval timestamp is invalid.",
]);

type GetCurrentProfile = () => Promise<CurrentProfileResult>;

export type SpeciesEnrichmentEndpointDependencies = {
  getCurrentProfile: GetCurrentProfile;
  runSpeciesEnrichment: (
    request: unknown,
  ) => Promise<AppResult<SpeciesEnrichmentProposal>>;
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

function isJsonContentType(request: Request): boolean {
  const header = request.headers.get("content-type");
  if (header === null) return false;
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Rejects a declared size above the limit, or a header that is not a
 * single byte count. A missing header is allowed; the body is still capped
 * while it is read.
 */
function declaredBodyWithinLimit(request: Request, maxBytes: number): AppResult<true> {
  const header = request.headers.get("content-length");
  if (header === null) return { ok: true, data: true };
  if (!/^\d{1,15}$/.test(header)) {
    return err("validation", SPECIES_ENRICHMENT_REQUEST_MESSAGES.malformedJson);
  }
  if (Number(header) > maxBytes) {
    return err("validation", SPECIES_ENRICHMENT_REQUEST_MESSAGES.tooLarge);
  }
  return { ok: true, data: true };
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<AppResult<Uint8Array>> {
  if (request.body === null) return { ok: true, data: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return err("validation", SPECIES_ENRICHMENT_REQUEST_MESSAGES.tooLarge);
      }
      chunks.push(value);
    }
  } catch {
    return err("validation", SPECIES_ENRICHMENT_REQUEST_MESSAGES.malformedJson);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: body };
}

function parseJsonObject(bytes: Uint8Array): AppResult<unknown> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err("validation", SPECIES_ENRICHMENT_REQUEST_MESSAGES.malformedJson);
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return err("validation", SPECIES_ENRICHMENT_REQUEST_MESSAGES.malformedJson);
  }
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
    case "conflict":
      return 409;
    default:
      return 500;
  }
}

/**
 * Upstream authentication and configuration failures must not be reported
 * as the caller's application role. After Management authorisation, those
 * codes are server failures.
 */
function presentAgentError(error: AppError): AppError {
  if (error.code === "unauthorized" || error.code === "unauthenticated") {
    return {
      code: "unexpected",
      message: SAFE_ERROR_MESSAGES.unexpected,
    };
  }
  return {
    code: error.code,
    message: SAFE_AGENT_MESSAGES.has(error.message)
      ? error.message
      : SAFE_ERROR_MESSAGES[error.code],
  };
}

async function readManagementJson(
  request: Request,
  getCurrentProfile: GetCurrentProfile,
  maxBytes: number,
) {
  if (request.method !== "POST") {
    return failure(
      { code: "validation", message: SAFE_ERROR_MESSAGES.validation },
      405,
    );
  }

  if (!isSameOrigin(request)) {
    return failure(
      {
        code: "unauthorized",
        message: SPECIES_ENRICHMENT_REQUEST_MESSAGES.origin,
      },
      403,
    );
  }

  if (!isJsonContentType(request)) {
    return failure(
      {
        code: "validation",
        message: SPECIES_ENRICHMENT_REQUEST_MESSAGES.contentType,
      },
      400,
    );
  }

  const declaredLength = declaredBodyWithinLimit(request, maxBytes);
  if (!declaredLength.ok) {
    return failure(declaredLength.error, 400);
  }

  let profile: CurrentProfileResult;
  try {
    profile = await getCurrentProfile();
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

  const bytes = await readLimitedBody(request, maxBytes);
  if (!bytes.ok) return failure(bytes.error, 400);

  const payload = parseJsonObject(bytes.data);
  if (!payload.ok) return failure(payload.error, 400);

  return { access: access.data, payload: payload.data };
}

/** Returns the proposal in the existing data field, with an envelope for acceptance. */
export async function handleSpeciesEnrichmentPost(
  request: Request,
  dependencies: SpeciesEnrichmentEndpointDependencies,
): Promise<Response> {
  const input = await readManagementJson(
    request, dependencies.getCurrentProfile, SPECIES_ENRICHMENT_MAX_BODY_BYTES,
  );
  if (input instanceof Response) return input;

  const parsed = parseSpeciesEnrichmentRequest(input.payload);
  if (!parsed.ok) return failure(parsed.error, 400);

  let proposal: AppResult<SpeciesEnrichmentProposal>;
  try {
    proposal = await dependencies.runSpeciesEnrichment(parsed.data);
  } catch {
    return failure(
      { code: "unexpected", message: SAFE_ERROR_MESSAGES.unexpected },
      500,
    );
  }

  if (!proposal.ok) {
    const error = presentAgentError(proposal.error);
    return failure(error, statusForCode(error.code));
  }

  const signed = signSpeciesEnrichmentProposal(proposal.data, input.access.profileId);
  if (!signed.ok) return respond(err("unexpected"), 500);

  return Response.json(
    { ok: true, data: proposal.data, signed_proposal: signed.data },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function handleSpeciesAcceptancePost(
  request: Request,
  getCurrentProfile: GetCurrentProfile,
  recheckLinkedProfile: typeof resolveLinkedProfile,
): Promise<Response> {
  const input = await readManagementJson(request, getCurrentProfile, SPECIES_ACCEPTANCE_MAX_BODY_BYTES);
  if (input instanceof Response) return input;

  const parsed = acceptanceRequestSchema.safeParse(input.payload);
  if (!parsed.success) return respond(err("validation"), 400);

  const { authUserId, profileId, supabase } = input.access;
  const { signed_proposal, accepted_entry, management_completions } = parsed.data;
  const verified = verifySpeciesEnrichmentProposal(signed_proposal, profileId);
  if (!verified.ok) {
    return verified.error.code === "validation"
      ? respond(verified, 400)
      : respond(err("unexpected"), 500);
  }

  const acceptance = speciesEnrichmentAcceptanceSchema.safeParse({
    proposal: verified.data,
    accepted_entry,
    management_completions,
  });
  if (!acceptance.success) return respond(err("validation"), 400);

  const entry = acceptance.data.accepted_entry;
  const proof = mintSpeciesInsertProof(profileId, entry);
  if (!proof.ok) return respond(err(proof.error.code), statusForCode(proof.error.code));

  try {
    const { error } = await supabase
      .from("species_database")
      .insert(entry)
      .setHeader(SPECIES_INSERT_PROOF_HEADER, proof.data);
    if (error) {
      if (error.code === "42501") {
        // Read the linked profile again without the request-cached profile lookup.
        const current = await recheckLinkedProfile({ supabase, userId: authUserId });
        if (
          current.status === "unlinked" ||
          (current.status === "ok" && (current.role !== "management" || current.profileId !== profileId))
        ) {
          return respond(err("unauthorized"), 403);
        }
        return respond(err("database"), 500);
      }
      const safeError = mapSupabaseError(error);
      return failure(safeError, statusForCode(safeError.code));
    }
  } catch {
    return respond(err("database"), 500);
  }

  return respond(ok({ external_species_id: entry.external_species_id }), 201);
}
