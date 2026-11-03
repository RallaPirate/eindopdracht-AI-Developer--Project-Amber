import type { QueryClient } from "@tanstack/react-query";

/**
 * First segment of every authenticated query and mutation key.
 * Feature code must keep this prefix so one user's cache cannot collide
 * with another's.
 */
export const AUTHENTICATED_QUERY_ROOT = "auth-user";

/** Placeholder segment used while the Auth user id is not verified. */
const UNVERIFIED_QUERY_USER = "unverified";

export class AuthenticatedQueryIdentityError extends Error {
  constructor() {
    super("Authenticated query identity changed.");
    this.name = "AuthenticatedQueryIdentityError";
  }
}

export type AuthVerificationFailure = {
  name?: string;
  status?: number;
};

export type AuthVerificationClassification =
  | "authenticated"
  | "unauthenticated"
  | "unavailable"
  | "ignored";

export type AuthCommit =
  | { status: "authenticated"; userId: string }
  | { status: Exclude<AuthVerificationClassification, "authenticated"> | "stale" };

export type PermissionRead =
  | { status: "active"; role: string; displayName?: string }
  | { status: "revoked" }
  | { status: "unavailable" };

export type PermissionStatus = "unknown" | "active" | "unavailable" | "revoked";

export type AuthAccessStatus =
  | "unverified"
  | "anonymous"
  | "verifying_profile"
  | "ready"
  | "suspended"
  | "revoked";

export type AuthAccessSnapshot = Readonly<{
  status: AuthAccessStatus;
  userId: string | null;
  permissionStatus: PermissionStatus;
  role: string | null;
  displayName: string | null;
  accessEpoch: number;
  // Presentation ownership is never an authorization capability. Unlike the
  // cache epoch it survives temporary same-user verification and suspension.
  presentation: Readonly<{ id: number; userId: string; role: string }> | null;
}>;

export type AuthenticatedAccess = {
  userId: string;
  epoch: number;
};

/**
 * Maps a Supabase Auth verification result onto a cache decision.
 * `error` must be null when verification succeeded. An empty failure object
 * is still a failure, so callers pass null rather than `{}` for success.
 * Network loss and a discarded token refresh keep the current cache.
 * Any other failure, including an expired or missing session, does not.
 */
export function classifyAuthVerification(
  error: AuthVerificationFailure | null,
  userId: string | null,
): AuthVerificationClassification {
  if (!error) {
    return userId ? "authenticated" : "unauthenticated";
  }

  if (error.name === "AuthRetryableFetchError") return "unavailable";
  if (error.name === "AuthRefreshDiscardedError") return "ignored";

  return "unauthenticated";
}

/**
 * Normalises a Supabase error into a failure record.
 * `null` and `undefined` mean the call succeeded and must stay null so a
 * valid `getClaims()` result is not classified as signed out.
 */
export function failureOf(error: unknown): AuthVerificationFailure | null {
  if (error == null) return null;

  if (typeof error !== "object") {
    return { name: "UnknownAuthError" };
  }

  const record = error as { name?: unknown; status?: unknown };
  const name = typeof record.name === "string" ? record.name : undefined;
  const status = typeof record.status === "number" ? record.status : undefined;
  return { name, status };
}

/**
 * Combines a claims check with the session observed after it.
 * A claims payload whose session user no longer matches is stale.
 */
export function resolveAuthVerification(
  claimsError: unknown,
  claimedUserId: string | null,
  sessionError: unknown,
  sessionUserId: string | null,
): AuthCommit {
  const classified = classifyAuthVerification(
    failureOf(claimsError),
    claimedUserId,
  );
  if (classified === "unavailable" || classified === "ignored") {
    return { status: classified };
  }
  if (classified !== "authenticated" || !claimedUserId) {
    return { status: "unauthenticated" };
  }

  if (sessionError != null) {
    const sessionClass = classifyAuthVerification(
      failureOf(sessionError),
      sessionUserId,
    );
    if (sessionClass === "unavailable" || sessionClass === "ignored") {
      return { status: sessionClass };
    }
    return { status: "unauthenticated" };
  }

  if (sessionUserId !== claimedUserId) {
    return { status: "stale" };
  }

  return { status: "authenticated", userId: claimedUserId };
}

/**
 * A profile read error is transient. A missing or invalid role is confirmed.
 */
export function classifyPermissionRead(
  failed: boolean,
  roleIsValid: boolean,
): PermissionRead["status"] {
  if (failed) return "unavailable";
  if (!roleIsValid) return "revoked";
  return "active";
}

export function authenticatedQueryKey(
  userId: string,
  scope: readonly unknown[],
): readonly unknown[] {
  return [AUTHENTICATED_QUERY_ROOT, userId, ...scope];
}

export function unverifiedQueryKey(
  scope: readonly unknown[],
): readonly unknown[] {
  return authenticatedQueryKey(UNVERIFIED_QUERY_USER, scope);
}

/**
 * Auth user id embedded in a query key, if this key is user-scoped.
 * The unverified placeholder is not an identity.
 */
export function authenticatedQueryUserId(
  queryKey: readonly unknown[],
): string | null {
  if (queryKey[0] !== AUTHENTICATED_QUERY_ROOT) return null;
  const userId = queryKey[1];
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (userId === UNVERIFIED_QUERY_USER) return null;
  return userId;
}

export function shouldRunAuthenticatedQuery(
  userId: string | null,
  enabled: boolean = true,
  permissionStatus: PermissionStatus = "unknown",
): boolean {
  return userId !== null && enabled && permissionStatus === "active";
}

export function isAuthenticatedAccessCurrent(
  currentUserId: string | null,
  currentEpoch: number,
  started: AuthenticatedAccess,
): boolean {
  return currentUserId === started.userId && currentEpoch === started.epoch;
}

/**
 * Drops fields that would replay privileged rows after a permission change.
 * `resetQueries()` restores `initialData`, so authenticated queries never keep it.
 */
export function stripPrivilegedQueryOptions<T extends object>(
  options: T,
): Omit<T, "initialData" | "initialDataUpdatedAt" | "placeholderData"> {
  const copy = { ...options } as Record<string, unknown>;
  delete copy.initialData;
  delete copy.initialDataUpdatedAt;
  delete copy.placeholderData;
  return copy as Omit<T, "initialData" | "initialDataUpdatedAt" | "placeholderData">;
}

type IdentityListener = () => void;

function isAuthenticatedQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === AUTHENTICATED_QUERY_ROOT;
}

/**
 * Binds one QueryClient to a verified Auth user and permission scope.
 * Identity, session and permission changes cancel in-flight work and drop
 * cached rows. Cancellation does not undo a write the server already committed.
 */
export function createAuthenticatedQueryCache() {
  let presentationId = 0;
  let presentation: AuthAccessSnapshot["presentation"] = null;
  let snapshot: AuthAccessSnapshot = Object.freeze({
    status: "unverified",
    userId: null,
    permissionStatus: "unknown",
    role: null,
    displayName: null,
    accessEpoch: 0,
    presentation: null,
  });
  const listeners = new Set<IdentityListener>();
  const guardedClients = new WeakSet<QueryClient>();

  function getSnapshot(): AuthAccessSnapshot {
    return snapshot;
  }

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function subscribe(listener: IdentityListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function publish(
    next: Omit<AuthAccessSnapshot, "accessEpoch" | "presentation">,
    bumpEpoch: boolean,
  ) {
    snapshot = Object.freeze({
      ...next,
      accessEpoch: snapshot.accessEpoch + (bumpEpoch ? 1 : 0),
      presentation,
    });
    emit();
  }

  function discardAuthenticatedEntries(client: QueryClient) {
    void client.cancelQueries({
      predicate: (query) => isAuthenticatedQuery(query.queryKey),
    });
    client.removeQueries({
      predicate: (query) => isAuthenticatedQuery(query.queryKey),
    });
    client.getMutationCache().clear();
  }

  /**
   * Bumps the access epoch and drops every cached query and mutation.
   * Does not change the bound user. `clear()` removes queries, so a query's
   * `initialData` is not written back.
   */
  function invalidateAccess(client: QueryClient) {
    publish(
      {
        status: snapshot.status,
        userId: snapshot.userId,
        permissionStatus: snapshot.permissionStatus,
        role: snapshot.role,
        displayName: snapshot.displayName,
      },
      true,
    );
    void client.cancelQueries();
    client.clear();
  }

  /**
   * Drops a successful write from an earlier user, session or permission epoch.
   * A fetch that started after the current epoch is kept.
   */
  function installGuard(client: QueryClient) {
    if (guardedClients.has(client)) return;
    guardedClients.add(client);

    client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;

      const keyUserId = authenticatedQueryUserId(event.query.queryKey);
      if (!keyUserId) return;

      const metaEpoch = event.query.meta?.accessEpoch;
      const seenEpoch = snapshot.accessEpoch;
      const seenUser = snapshot.userId;
      const seenBlocked = snapshot.status !== "ready";
      const staleEpoch = metaEpoch !== seenEpoch;
      const wrongUser = keyUserId !== seenUser;
      if (!staleEpoch && !wrongUser && !seenBlocked) return;

      const queryKey = event.query.queryKey;
      queueMicrotask(() => {
        const stillWrongUser =
          authenticatedQueryUserId(queryKey) !== snapshot.userId;
        const stillStale = metaEpoch !== snapshot.accessEpoch;
        const stillBlocked = snapshot.status !== "ready";
        if (!stillWrongUser && !stillStale && !stillBlocked) return;
        client.removeQueries({ queryKey, exact: true });
      });
    });
  }

  /** Synchronously blocks access while an Auth event is being verified. */
  function beginVerification(client: QueryClient) {
    if (
      snapshot.status === "unverified" && snapshot.userId === null &&
      snapshot.presentation === presentation
    ) return;
    publish(
      {
        status: "unverified",
        userId: null,
        permissionStatus: "unknown",
        role: null,
        displayName: null,
      },
      true,
    );
    void client.cancelQueries();
    client.clear();
  }

  /**
   * `null` is a verified signed-out state.
   * The same user id keeps the cache. Token refresh uses that path.
   * A real identity change also bumps the access epoch.
   */
  function bindUser(client: QueryClient, nextUserId: string | null) {
    if (nextUserId === null || presentation?.userId !== nextUserId) {
      presentation = null;
    }
    if (
      snapshot.userId === nextUserId &&
      (nextUserId !== null || snapshot.status === "anonymous")
    ) {
      return;
    }

    publish(
      {
        status: nextUserId === null ? "anonymous" : "verifying_profile",
        userId: nextUserId,
        permissionStatus: "unknown",
        role: null,
        displayName: null,
      },
      true,
    );
    void client.cancelQueries();
    client.clear();
  }

  /**
   * Same Auth user, new sign-in. The user id matches, but pending callbacks
   * and cached rows belong to the previous session and must not continue.
   * A different session user unbinds immediately; verification binds the id later.
   */
  function noteReauthentication(client: QueryClient, sessionUserId: string) {
    // An event's unverified id may discard a presentation, never authorize it.
    if (presentation?.userId !== sessionUserId) presentation = null;
    beginVerification(client);
  }

  /**
   * Records a confirmed role. The first confirmation does not drop rows that
   * were just fetched under the current session. A later role change removes
   * cached queries instead of resetting them, so `initialData` cannot return.
   */
  function bindPermission(
    client: QueryClient,
    nextUserId: string,
    nextPermissionScope: string,
    displayName: string | null = null,
  ) {
    if (snapshot.userId !== nextUserId) return;
    if (
      snapshot.permissionStatus === "active" &&
      snapshot.role === nextPermissionScope &&
      snapshot.displayName === displayName
    ) {
      return;
    }

    const roleChanged =
      snapshot.permissionStatus === "active" &&
      snapshot.role !== nextPermissionScope;
    if (
      !presentation || presentation.userId !== nextUserId ||
      presentation.role !== nextPermissionScope
    ) {
      presentation = Object.freeze({
        id: ++presentationId, userId: nextUserId, role: nextPermissionScope,
      });
    }
    publish(
      {
        status: "ready",
        userId: nextUserId,
        permissionStatus: "active",
        role: nextPermissionScope,
        displayName,
      },
      roleChanged,
    );
    if (roleChanged) discardAuthenticatedEntries(client);
  }

  /**
   * Confirmed missing profile or invalid role. Privileged rows are removed
   * and stay blocked until a later valid role is confirmed.
   */
  function revokePermission(client: QueryClient, nextUserId: string) {
    if (snapshot.userId !== nextUserId) return;
    if (snapshot.permissionStatus === "revoked") return;

    presentation = null;

    publish(
      {
        status: "revoked",
        userId: nextUserId,
        permissionStatus: "revoked",
        role: null,
        displayName: null,
      },
      true,
    );
    discardAuthenticatedEntries(client);
  }

  /**
   * Role could not be read. Hide cached rows, but do not record the profile
   * as unlinked. A later successful read can confirm the same role.
   */
  function concealPrivilegedData(client: QueryClient, nextUserId: string) {
    if (snapshot.userId !== nextUserId) return;
    if (snapshot.status === "suspended") return;
    publish(
      {
        status: "suspended",
        userId: nextUserId,
        permissionStatus: "unavailable",
        role: null,
        displayName: null,
      },
      true,
    );
    discardAuthenticatedEntries(client);
  }

  return {
    getSnapshot,
    getAccessEpoch: () => snapshot.accessEpoch,
    getPermissionScope: () =>
      snapshot.permissionStatus === "active" ? snapshot.role : null,
    getPermissionStatus: () => snapshot.permissionStatus,
    subscribe,
    installGuard,
    beginVerification,
    bindUser,
    invalidateAccess,
    noteReauthentication,
    bindPermission,
    revokePermission,
    concealPrivilegedData,
  };
}

export type AuthenticatedQueryCache = ReturnType<
  typeof createAuthenticatedQueryCache
>;

/**
 * Applies an Auth event before any awaited verification.
 * The session user id is only a signal that the previous binding is unsafe.
 * It is not itself a verified identity.
 */
export function applyBrowserAuthEvent(
  cache: AuthenticatedQueryCache,
  client: QueryClient,
  event: string,
  sessionUserId: string | null,
): void {
  if (event === "SIGNED_OUT" || sessionUserId === null) {
    cache.bindUser(client, null);
    return;
  }

  // A routine refresh does not start a new access lifetime. Claims and the
  // linked profile are still rechecked by the synchronization loop.
  if (
    event === "TOKEN_REFRESHED" &&
    sessionUserId === cache.getSnapshot().userId
  ) {
    return;
  }

  cache.noteReauthentication(client, sessionUserId);
}

/**
 * Applies a finished verification. Unavailable and ignored results keep the
 * binding already chosen by the auth event.
 */
export function commitVerifiedAuthUser(
  cache: AuthenticatedQueryCache,
  client: QueryClient,
  verified: AuthCommit,
): void {
  if (verified.status === "ignored" || verified.status === "unavailable") {
    return;
  }
  if (verified.status !== "authenticated") {
    cache.bindUser(client, null);
    return;
  }
  cache.bindUser(client, verified.userId);
}

export function applyPermissionRead(
  cache: AuthenticatedQueryCache,
  client: QueryClient,
  userId: string,
  read: PermissionRead,
): void {
  if (cache.getSnapshot().userId !== userId) return;

  if (read.status === "active") {
    cache.bindPermission(client, userId, read.role, read.displayName ?? null);
    return;
  }
  if (read.status === "revoked") {
    cache.revokePermission(client, userId);
    return;
  }
  cache.concealPrivilegedData(client, userId);
}

/**
 * Sequences auth events and the verification that follows them.
 * `beginEvent` drops the previous cache binding before the caller awaits.
 * A commit from an older event cannot restore that binding.
 */
export function createAuthTransitionController(
  cache: AuthenticatedQueryCache,
  getClient: () => QueryClient,
) {
  let generation = 0;

  function cancelPending() {
    generation += 1;
  }

  function beginEvent(event: string, sessionUserId: string | null) {
    generation += 1;
    applyBrowserAuthEvent(cache, getClient(), event, sessionUserId);
    return generation;
  }

  function startCheck() {
    generation += 1;
    return generation;
  }

  function isCurrent(startedGeneration: number) {
    return startedGeneration === generation;
  }

  function commit(startedGeneration: number, verified: AuthCommit) {
    if (!isCurrent(startedGeneration)) return "stale" as const;
    commitVerifiedAuthUser(cache, getClient(), verified);
    return "applied" as const;
  }

  return {
    cancelPending,
    beginEvent,
    startCheck,
    isCurrent,
    commit,
  };
}
