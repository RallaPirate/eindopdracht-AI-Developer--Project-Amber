import type {
  CurrentProfileAccess,
  CurrentProfileResult,
} from "@/lib/currentProfile";

/**
 * Shared failure categories for authenticated database reads/writes.
 * Keep messages user-facing and free of credentials, tokens or DB internals.
 */
export type AppErrorCode =
  | "validation"
  | "unauthenticated"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "database"
  | "unexpected";

export type AppError = {
  code: AppErrorCode;
  /** Safe message suitable for UI or Agent disclosure. */
  message: string;
};

export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export const SAFE_ERROR_MESSAGES = {
  validation: "The provided input is invalid.",
  unauthenticated: "You must be signed in to continue.",
  unauthorized: "You do not have permission to perform this action.",
  not_found: "The requested record was not found.",
  conflict: "This operation conflicts with existing data.",
  database: "Unable to complete the database operation. Please try again.",
  unexpected: "Something went wrong. Please try again.",
  unlinked: "Your account is not linked to an application profile.",
} as const;

export function ok<T>(data: T): AppResult<T> {
  return { ok: true, data };
}

export function err(
  code: AppErrorCode,
  message: string = SAFE_ERROR_MESSAGES[code],
): AppResult<never> {
  return { ok: false, error: { code, message } };
}

export function isAppResultOk<T>(
  result: AppResult<T>,
): result is { ok: true; data: T } {
  return result.ok;
}

const APP_ERROR_CODES: readonly AppErrorCode[] = [
  "validation",
  "unauthenticated",
  "unauthorized",
  "not_found",
  "conflict",
  "database",
  "unexpected",
];

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return (
    typeof value === "string" &&
    (APP_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Deterministic display text for a recognised AppError.
 * Never trusts an arbitrary accompanying message, except the exact
 * unlinked-profile string paired with `unauthorized`.
 */
function sanitiseAppError(error: AppError): AppError {
  const message =
    error.code === "unauthorized" &&
    error.message === SAFE_ERROR_MESSAGES.unlinked
      ? SAFE_ERROR_MESSAGES.unlinked
      : SAFE_ERROR_MESSAGES[error.code];

  return { code: error.code, message };
}

/**
 * Error class for TanStack Query / local throw sites.
 * Prefer returning plain `AppResult` across Server Action boundaries.
 */
export class AppFailure extends Error {
  readonly code: AppErrorCode;
  readonly appError: AppError;

  constructor(error: AppError) {
    const sanitised = sanitiseAppError(error);
    super(sanitised.message);
    this.name = "AppFailure";
    this.code = sanitised.code;
    this.appError = sanitised;
  }
}

export function isAppFailure(error: unknown): error is AppFailure {
  return error instanceof AppFailure;
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    isAppErrorCode(candidate.code) && typeof candidate.message === "string"
  );
}

/** Throws `AppFailure` when the result is not ok. Useful inside queryFn. */
export function unwrapAppResult<T>(result: AppResult<T>): T {
  if (!result.ok) {
    throw new AppFailure(result.error);
  }
  return result.data;
}

/** Safe UI/Agent message from thrown values or plain `AppError` objects. */
export function toUserMessage(error: unknown): string {
  if (isAppFailure(error)) {
    return sanitiseAppError(error.appError).message;
  }
  if (isAppError(error)) {
    return sanitiseAppError(error).message;
  }
  return SAFE_ERROR_MESSAGES.unexpected;
}

export function unexpectedError(cause?: unknown): AppError {
  void cause;
  return {
    code: "unexpected",
    message: SAFE_ERROR_MESSAGES.unexpected,
  };
}

/**
 * Maps `getCurrentProfile()` outcomes into the shared result shape.
 * Does not change authentication or RLS behaviour.
 */
export function requireCurrentProfile(
  profile: CurrentProfileResult,
): AppResult<CurrentProfileAccess> {
  switch (profile.status) {
    case "ok":
      return ok({
        supabase: profile.supabase,
        authUserId: profile.authUserId,
        profileId: profile.profileId,
        role: profile.role,
      });
    case "unauthenticated":
      return err("unauthenticated");
    case "unlinked":
      return err("unauthorized", SAFE_ERROR_MESSAGES.unlinked);
    case "error":
      return err("database", profile.message);
  }
}

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

type SupabaseResponseLike<T> = {
  data: T;
  error: SupabaseErrorLike | null;
};

/**
 * Converts a Supabase `{ data, error }` response into `AppResult`.
 * Query errors never become successful empty data.
 */
export function fromSupabaseResult<T>(
  response: SupabaseResponseLike<T>,
): AppResult<T> {
  if (response.error) {
    return errFromSupabase(response.error);
  }
  return ok(response.data);
}

/**
 * Like `fromSupabaseResult`, but treats a successful null/undefined payload
 * as not found (e.g. `maybeSingle()` with no matching row).
 */
export function fromSupabaseSingleResult<T>(
  response: SupabaseResponseLike<T | null>,
): AppResult<T> {
  if (response.error) {
    return errFromSupabase(response.error);
  }
  if (response.data == null) {
    return err("not_found");
  }
  return ok(response.data);
}

export function errFromSupabase(error: SupabaseErrorLike): AppResult<never> {
  return { ok: false, error: mapSupabaseError(error) };
}

/**
 * Maps PostgREST / Postgres failure codes to safe application errors.
 * Never forwards raw `message`, `details` or `hint` to callers.
 */
export function mapSupabaseError(error: SupabaseErrorLike): AppError {
  const code = typeof error.code === "string" ? error.code : "";

  switch (code) {
    case "42501":
      return {
        code: "unauthorized",
        message: SAFE_ERROR_MESSAGES.unauthorized,
      };
    // PGRST300 (JWT claims / config) stays database via the default branch.
    case "PGRST301":
    case "PGRST302":
    case "PGRST303":
      return {
        code: "unauthenticated",
        message: SAFE_ERROR_MESSAGES.unauthenticated,
      };
    case "PGRST116":
      return {
        code: "database",
        message: SAFE_ERROR_MESSAGES.database,
      };
    case "23505":
      return {
        code: "conflict",
        message: SAFE_ERROR_MESSAGES.conflict,
      };
    case "23503":
    case "23514":
    case "22P02":
    case "22001":
      return {
        code: "validation",
        message: SAFE_ERROR_MESSAGES.validation,
      };
    case "28000":
    case "28P01":
      return {
        code: "unauthenticated",
        message: SAFE_ERROR_MESSAGES.unauthenticated,
      };
    default:
      return {
        code: "database",
        message: SAFE_ERROR_MESSAGES.database,
      };
  }
}
