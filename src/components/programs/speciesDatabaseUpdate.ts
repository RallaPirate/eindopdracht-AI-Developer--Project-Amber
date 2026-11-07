import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AppFailure,
  fromSupabaseResult,
  SAFE_ERROR_MESSAGES,
  unwrapAppResult,
  type AppErrorCode,
} from "../../lib/appResult.ts";
import {
  AuthenticatedQueryIdentityError,
  type AuthAccessSnapshot,
} from "../../lib/queryCacheIsolation.ts";
import {
  parseSpeciesConcurrencyKey,
  parseSpeciesEditableFields,
  parseSpeciesList,
  SPECIES_DATABASE_QUERY_KEY,
  SPECIES_LIST_COLUMNS,
  sortLocalSpecies,
  type LocalSpecies,
  type SpeciesEditableFields,
} from "./speciesDatabaseView.ts";

/** Scope passed to `useAuthenticatedMutation`. The hook adds the user and epoch. */
export const SPECIES_UPDATE_MUTATION_KEY = ["species-database", "update"] as const;

export type SpeciesUpdateInput = {
  id: unknown;
  /** Original, unmodified `updated_at` from the loaded row. */
  updated_at: unknown;
  fields: unknown;
};

export type SpeciesUpdateClient = {
  supabase: () => SupabaseClient;
  started: () => AuthAccessSnapshot;
  refreshAccess: () => Promise<AuthAccessSnapshot | null>;
  accessAfter: () => AuthAccessSnapshot;
};

type SpeciesUpdateAttempt = SpeciesUpdateClient & {
  actingUserId: string;
};

type SpeciesListCache = {
  invalidateQueries: (scope: readonly unknown[]) => Promise<void>;
};

type SpeciesUpdateCache = SpeciesListCache & {
  getQueryData: <T>(scope: readonly unknown[]) => T | undefined;
  setQueryData: <T>(scope: readonly unknown[], data: T) => void;
};

function fail(code: AppErrorCode): never {
  throw new AppFailure({ code, message: SAFE_ERROR_MESSAGES[code] });
}

function isSpeciesEditor(access: AuthAccessSnapshot): boolean {
  return (
    access.status === "ready" &&
    access.permissionStatus === "active" &&
    (access.role === "senior" || access.role === "management") &&
    typeof access.userId === "string" &&
    access.userId.length > 0
  );
}

/** Verified Senior or Management session. A remembered presentation role is not enough. */
export function canEditLocalSpecies(access: AuthAccessSnapshot): boolean {
  return isSpeciesEditor(access);
}

function sameSession(left: AuthAccessSnapshot, right: AuthAccessSnapshot): boolean {
  return (
    left.status === right.status &&
    left.userId === right.userId &&
    left.permissionStatus === right.permissionStatus &&
    left.role === right.role &&
    left.accessEpoch === right.accessEpoch
  );
}

/**
 * Senior and Management may edit only while the invocation, the fresh
 * profile read and the snapshot after that read are the same session.
 * A remembered presentation role is not an editor capability.
 */
function requireSpeciesEditor(
  started: AuthAccessSnapshot,
  verified: AuthAccessSnapshot | null,
  after: AuthAccessSnapshot,
  actingUserId: string,
): void {
  if (!sameSession(started, after) || (verified && !sameSession(started, verified))) {
    throw new AuthenticatedQueryIdentityError();
  }
  if (!isSpeciesEditor(started) || started.userId !== actingUserId) {
    if (
      started.userId === null ||
      started.status === "anonymous" ||
      started.status === "unverified"
    ) {
      fail("unauthenticated");
    }
    if (started.userId !== actingUserId) throw new AuthenticatedQueryIdentityError();
    fail("unauthorized");
  }
  // An unavailable fresh check is not evidence that this owner changed.
  // Reject the write, but let the editor retain this epoch's draft for retry.
  if (!verified) fail("database");
}

function speciesUpdatePayload(fields: SpeciesEditableFields): SpeciesEditableFields {
  return {
    display_name: fields.display_name,
    general_description: fields.general_description,
    diet_preferences: fields.diet_preferences,
    habitat_preferences: fields.habitat_preferences,
    handling_guidance: fields.handling_guidance,
    minimum_handlers: fields.minimum_handlers,
    safety_class: fields.safety_class,
  };
}

function acceptedSpeciesRow(
  payload: unknown,
  id: string,
): LocalSpecies {
  if (!Array.isArray(payload)) fail("unexpected");
  if (payload.length === 0) fail("conflict");
  if (payload.length !== 1) fail("unexpected");

  const parsed = parseSpeciesList(payload);
  if (!parsed.ok) throw new AppFailure(parsed.error);
  const [row] = parsed.data;
  if (!row || row.id !== id) fail("unexpected");
  return row;
}

/**
 * Updates one species row. Invalid input fails before the role recheck.
 * The write is a single UPDATE filtered by `id` and the original `updated_at`.
 * One parsed row is success. No rows is a conflict. Anything else fails.
 */
export async function updateLocalSpecies(
  input: SpeciesUpdateInput,
  attempt: SpeciesUpdateAttempt,
): Promise<LocalSpecies> {
  const key = unwrapAppResult(parseSpeciesConcurrencyKey(input));
  const fields = unwrapAppResult(parseSpeciesEditableFields(input.fields));
  const payload = speciesUpdatePayload(fields);

  const started = attempt.started();
  let verified: AuthAccessSnapshot | null;
  try {
    verified = await attempt.refreshAccess();
  } catch {
    fail("unexpected");
  }
  requireSpeciesEditor(started, verified, attempt.accessAfter(), attempt.actingUserId);

  let response: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    response = await attempt.supabase()
      .from("species_database")
      .update(payload)
      .eq("id", key.id)
      .eq("updated_at", key.updated_at)
      .select(SPECIES_LIST_COLUMNS);
  } catch {
    fail("unexpected");
  }

  requireSpeciesEditor(started, verified, attempt.accessAfter(), attempt.actingUserId);
  const written = unwrapAppResult(fromSupabaseResult(response));
  return acceptedSpeciesRow(written, key.id);
}

/** Invalidates the signed-in user's species list through the mutation cache capability. */
export function invalidateSpeciesDatabaseQuery(
  cache: SpeciesListCache,
): Promise<void> {
  return cache.invalidateQueries(SPECIES_DATABASE_QUERY_KEY);
}

/**
 * Options for `useAuthenticatedMutation`. Retry stays off: a conflict or a
 * failed role check must not issue another write.
 */
export function createSpeciesUpdateMutation(client: SpeciesUpdateClient) {
  return {
    mutationKey: SPECIES_UPDATE_MUTATION_KEY,
    retry: false as const,
    gcTime: 0,
    mutationFn: (input: SpeciesUpdateInput, context: { userId: string }) =>
      updateLocalSpecies(input, {
        ...client,
        actingUserId: context.userId,
      }),
    onSuccess: (
      data: LocalSpecies,
      _variables: SpeciesUpdateInput,
      _result: unknown,
      context: { cache: SpeciesUpdateCache },
    ) => {
      const rows = context.cache.getQueryData<LocalSpecies[]>(SPECIES_DATABASE_QUERY_KEY);
      if (rows) {
        // Publish the confirmed database version before a fallible refetch.
        // Both cache operations remain bound to the mutation's owner and epoch.
        context.cache.setQueryData(SPECIES_DATABASE_QUERY_KEY,
          sortLocalSpecies([...rows.filter((row) => row.id !== data.id), data]));
      }
      return invalidateSpeciesDatabaseQuery(context.cache);
    },
  };
}
