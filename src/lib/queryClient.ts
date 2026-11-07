import { QueryClient } from "@tanstack/react-query";
import {
  applyPermissionRead,
  createAuthenticatedQueryCache,
  createAuthTransitionController,
  type AuthAccessSnapshot,
  type AuthCommit,
  type PermissionRead,
} from "@/lib/queryCacheIsolation";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid immediate client refetch after SSR / initial hydration.
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;
const SERVER_AUTH_SNAPSHOT: AuthAccessSnapshot = Object.freeze({
  status: "unverified",
  userId: null,
  permissionStatus: "unknown",
  role: null,
  displayName: null,
  accessEpoch: 0,
  presentation: null,
});

const browserQueryIdentity = createAuthenticatedQueryCache();
const browserAuthTransitions = createAuthTransitionController(
  browserQueryIdentity,
  () => getQueryClient(),
);

export function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always create a new client so request data is not shared.
    return makeQueryClient();
  }

  // Browser: reuse one client across renders (important if React suspends).
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
    browserQueryIdentity.installGuard(browserQueryClient);
  }
  return browserQueryClient;
}

export function getVerifiedAuthSnapshot(): AuthAccessSnapshot {
  if (typeof window === "undefined") return SERVER_AUTH_SNAPSHOT;
  return browserQueryIdentity.getSnapshot();
}

export function getVerifiedAuthUserId(): string | null {
  return getVerifiedAuthSnapshot().userId;
}

export function getVerifiedAuthAccessEpoch(): number {
  return getVerifiedAuthSnapshot().accessEpoch;
}

export function getVerifiedAuthPermissionStatus() {
  return getVerifiedAuthSnapshot().permissionStatus;
}

export function subscribeVerifiedAuthSnapshot(listener: () => void): () => void {
  return browserQueryIdentity.subscribe(listener);
}

export const subscribeVerifiedAuthUser = subscribeVerifiedAuthSnapshot;

/**
 * Binds the browser cache to a verified Auth user id.
 * `null` means the session is confirmed absent. Passing the same id
 * (token refresh, repeat session event) keeps cached data.
 */
export function bindBrowserQueryCacheToUser(userId: string | null) {
  if (typeof window === "undefined") return;
  browserQueryIdentity.bindUser(getQueryClient(), userId);
}

/**
 * Drops cached query and mutation data and bumps the access epoch without
 * changing the bound user. Login uses this so a previous session's callbacks
 * cannot write after the new sign-in. Sign-out uses
 * {@link bindBrowserQueryCacheToUser} so queries also stop running.
 */
export function clearBrowserQueryCache() {
  if (typeof window === "undefined") return;
  browserQueryIdentity.invalidateAccess(getQueryClient());
}

export function beginBrowserAuthEvent(
  event: string,
  sessionUserId: string | null,
): number {
  if (typeof window === "undefined") return 0;
  return browserAuthTransitions.beginEvent(event, sessionUserId);
}

export function beginBrowserAuthCheck(): number {
  return browserAuthTransitions.startCheck();
}

export function isBrowserAuthCheckCurrent(generation: number): boolean {
  return browserAuthTransitions.isCurrent(generation);
}

export function commitBrowserVerifiedUser(
  generation: number,
  verified: AuthCommit,
) {
  if (typeof window === "undefined") return "stale" as const;
  return browserAuthTransitions.commit(generation, verified);
}

export function applyBrowserPermissionRead(
  userId: string,
  read: PermissionRead,
) {
  if (typeof window === "undefined") return;
  applyPermissionRead(
    browserQueryIdentity,
    getQueryClient(),
    userId,
    read,
  );
}

/** Invalidates an in-flight verification so it cannot rebind a previous user. */
export function cancelPendingBrowserAuthSync() {
  browserAuthTransitions.cancelPending();
}
