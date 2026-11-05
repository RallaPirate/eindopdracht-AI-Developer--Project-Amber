import {
  err,
  ok,
  SAFE_ERROR_MESSAGES,
  type AppError,
  type AppResult,
} from "../../lib/appResult.ts";
import { AuthenticatedQueryIdentityError } from "../../lib/queryCacheIsolation.ts";
import type { AuthAccessSnapshot } from "../../lib/queryCacheIsolation.ts";

/** Scope passed to `useAuthenticatedMutation`. The hook adds the user and epoch. */
export const SPECIES_LOOKUP_MUTATION_KEY = ["species-lookup"] as const;

export const SPECIES_PROPOSAL_COPY = {
  assistant: "AMBER ASSISTANT",
  prompt: "Which dinosaur would you like to add?",
  oneMatch: "Did you mean this species?",
  manyMatches: "Did you mean one of these species?",
  none: "No species matched that name.",
  searching: "Searching the species index…",
  confirm: "Confirm species",
  search: "Search",
  searchAgain: "Search again",
  selected: "Selected species",
  scientificName: "Scientific name",
  externalId: "External ID",
} as const;

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const MAX_ID_LENGTH = 128;
const MAX_RETURNED_NAME_LENGTH = 300;

const SAFE_LOOKUP_MESSAGES = new Set<string>([
  ...Object.values(SAFE_ERROR_MESSAGES),
  "Species name is invalid.",
  "The external species data is invalid.",
  "The external species service is not configured.",
  "The external species service is unavailable.",
  "The external species request timed out.",
  "Cross-origin requests are not permitted.",
]);

/** One row from `GET /api/species/lookup`. Text is rendered, never parsed as HTML. */
export type SpeciesLookupMatch = {
  external_species_id: string;
  scientific_name: string;
};

export type HeldSpeciesSelection = SpeciesLookupMatch & {
  userId: string;
  accessEpoch: number;
};

/**
 * Lookup rows stay bound to the verified user and access epoch that
 * initiated the request and were still current when it was accepted.
 * A later snapshot must not adopt these rows.
 */
export type OwnedSpeciesLookup = {
  userId: string;
  accessEpoch: number;
  submittedName: string;
  matches: readonly SpeciesLookupMatch[];
};

export class SpeciesLookupFailure extends Error {
  readonly appError: AppError;

  constructor(error: AppError) {
    super(SAFE_LOOKUP_MESSAGES.has(error.message)
      ? error.message
      : SAFE_ERROR_MESSAGES[error.code]);
    this.name = "SpeciesLookupFailure";
    this.appError = {
      code: error.code,
      message: this.message,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpectedFailure(): SpeciesLookupFailure {
  return new SpeciesLookupFailure({
    code: "unexpected",
    message: SAFE_ERROR_MESSAGES.unexpected,
  });
}

/**
 * Management may open the proposal tab only after this session's role
 * has been verified. A remembered presentation role is not enough.
 */
export function canOfferSpeciesProposal(access: AuthAccessSnapshot): boolean {
  return (
    access.status === "ready" &&
    access.permissionStatus === "active" &&
    access.role === "management" &&
    typeof access.userId === "string" &&
    access.userId.length > 0
  );
}

/**
 * A confirmed id belongs to the access epoch that selected it.
 * Logout, account switches and role changes hide it.
 */
export function visibleConfirmedSpecies(
  held: HeldSpeciesSelection | null,
  access: AuthAccessSnapshot,
): SpeciesLookupMatch | null {
  if (!held || !canOfferSpeciesProposal(access)) return null;
  if (held.userId !== access.userId || held.accessEpoch !== access.accessEpoch) {
    return null;
  }
  return {
    external_species_id: held.external_species_id,
    scientific_name: held.scientific_name,
  };
}

/** The lookup's stored identity still matches this verified snapshot. */
export function speciesLookupAccessOwns(
  owned: OwnedSpeciesLookup | null,
  access: AuthAccessSnapshot,
): owned is OwnedSpeciesLookup {
  return (
    owned !== null &&
    canOfferSpeciesProposal(access) &&
    owned.userId === access.userId &&
    owned.accessEpoch === access.accessEpoch
  );
}

/**
 * Rows may be shown only for the name and access epoch that accepted them.
 * Editing the search text hides earlier matches.
 */
export function visibleSpeciesMatches(
  owned: OwnedSpeciesLookup | null,
  access: AuthAccessSnapshot,
  currentName: string,
): readonly SpeciesLookupMatch[] {
  if (!speciesLookupAccessOwns(owned, access)) return [];
  if (owned.submittedName !== currentName) return [];
  return owned.matches;
}

/**
 * Builds a selection from the lookup's original identity.
 * A newer user or epoch returns nothing instead of relabelling the rows.
 */
export function acceptedSpeciesSelection(
  owned: OwnedSpeciesLookup | null,
  chosenId: string | null,
  access: AuthAccessSnapshot,
  currentName: string,
): HeldSpeciesSelection | null {
  if (chosenId === null) return null;
  const matches = visibleSpeciesMatches(owned, access, currentName);
  const match = matches.find((item) => item.external_species_id === chosenId);
  if (!match || !owned) return null;
  return {
    userId: owned.userId,
    accessEpoch: owned.accessEpoch,
    external_species_id: match.external_species_id,
    scientific_name: match.scientific_name,
  };
}

/**
 * A Management recheck is current only when the snapshot that started it,
 * the snapshot the check returned, and the snapshot after the await are
 * the same verified Management user and access epoch.
 */
export function sameManagementAccess(
  started: AuthAccessSnapshot,
  verified: AuthAccessSnapshot,
  after: AuthAccessSnapshot,
): boolean {
  if (
    !canOfferSpeciesProposal(started) ||
    !canOfferSpeciesProposal(verified) ||
    !canOfferSpeciesProposal(after)
  ) {
    return false;
  }
  return (
    started.userId === verified.userId &&
    started.userId === after.userId &&
    started.accessEpoch === verified.accessEpoch &&
    started.accessEpoch === after.accessEpoch
  );
}

export function isSpeciesLookupAccessDenial(error: unknown): boolean {
  return (
    error instanceof SpeciesLookupFailure &&
    (error.appError.code === "unauthenticated" ||
      error.appError.code === "unauthorized")
  );
}

/** Accepts a successful lookup body. A bad row fails the whole list. */
export function parseSpeciesLookupPayload(
  body: unknown,
): AppResult<SpeciesLookupMatch[]> {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.data)) {
    return err("unexpected");
  }

  const matches: SpeciesLookupMatch[] = [];
  for (const item of body.data) {
    if (!isRecord(item)) return err("unexpected");
    const id = item.external_species_id;
    const scientificName = item.scientific_name;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > MAX_ID_LENGTH ||
      !ID_PATTERN.test(id)
    ) {
      return err("unexpected");
    }
    if (
      typeof scientificName !== "string" ||
      scientificName.trim().length === 0 ||
      scientificName.length > MAX_RETURNED_NAME_LENGTH
    ) {
      return err("unexpected");
    }
    matches.push({
      external_species_id: id,
      scientific_name: scientificName,
    });
  }
  return ok(matches);
}

function codeForStatus(status: number): AppError["code"] {
  if (status === 400) return "validation";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "unauthorized";
  return "unexpected";
}

function messageFor(code: AppError["code"], candidate: string): string {
  if (code === "validation") {
    return candidate === "Species name is invalid."
      ? candidate
      : SAFE_ERROR_MESSAGES.validation;
  }
  if (code === "unauthenticated") return SAFE_ERROR_MESSAGES.unauthenticated;
  if (code === "unauthorized") {
    return candidate === SAFE_ERROR_MESSAGES.unlinked
      ? candidate
      : SAFE_ERROR_MESSAGES.unauthorized;
  }
  if (SAFE_LOOKUP_MESSAGES.has(candidate)) return candidate;
  return SAFE_ERROR_MESSAGES.unexpected;
}

/** Maps an HTTP failure onto a safe error. Status wins over a forged body code. */
export function speciesLookupError(status: number, body: unknown): AppError {
  const code = codeForStatus(status);
  const candidate =
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.message === "string"
      ? body.error.message
      : "";
  return { code, message: messageFor(code, candidate) };
}

export function speciesLookupMessage(error: unknown): string | null {
  if (error instanceof AuthenticatedQueryIdentityError) return null;
  if (error instanceof SpeciesLookupFailure) return error.appError.message;
  return SAFE_ERROR_MESSAGES.unexpected;
}

/**
 * Calls the authenticated name lookup. Results are not stored in a query
 * cache; the mutation hook drops them when access changes.
 */
export async function requestSpeciesNameLookup(
  name: string,
): Promise<SpeciesLookupMatch[]> {
  let response: Response;
  try {
    response = await fetch(`/api/species/lookup?name=${encodeURIComponent(name)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw unexpectedFailure();
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw unexpectedFailure();
  }

  if (!response.ok) {
    throw new SpeciesLookupFailure(speciesLookupError(response.status, body));
  }

  const parsed = parseSpeciesLookupPayload(body);
  if (!parsed.ok) throw new SpeciesLookupFailure(parsed.error);
  return parsed.data;
}
