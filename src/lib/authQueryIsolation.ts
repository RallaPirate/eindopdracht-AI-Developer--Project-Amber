import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBrowserPermissionRead,
  beginBrowserAuthCheck,
  beginBrowserAuthEvent,
  cancelPendingBrowserAuthSync,
  commitBrowserVerifiedUser,
  getVerifiedAuthSnapshot,
  getVerifiedAuthUserId,
  isBrowserAuthCheckCurrent,
} from "@/lib/queryClient";
import {
  classifyPermissionRead,
  resolveAuthVerification,
  type AuthCommit,
  type AuthAccessSnapshot,
  type PermissionRead,
} from "@/lib/queryCacheIsolation";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isApplicationRole } from "@/types/database";

const PERMISSION_RECHECK_MS = 60_000;
const MAX_MISMATCH_RETRIES = 2;

let requestSync: (() => Promise<AuthAccessSnapshot | null>) | null = null;

/**
 * Invalidates an in-flight identity sync so a slow verification cannot
 * reattach the previous user after logout or account switch.
 */
export function cancelPendingAuthQuerySync() {
  cancelPendingBrowserAuthSync();
}

/** Runs a new verification if the browser isolation loop is active. */
export async function requestAuthQuerySync(): Promise<AuthAccessSnapshot> {
  return (await requestSync?.()) ?? getVerifiedAuthSnapshot();
}

/** Requires this check to complete with a fresh, active profile read. */
export async function requestFreshAuthQuerySync(): Promise<AuthAccessSnapshot | null> {
  return (await requestSync?.()) ?? null;
}

async function readPermissionScope(
  supabase: SupabaseClient,
  userId: string,
): Promise<PermissionRead> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role, display_name")
      .eq("auth_user_id", userId)
      .maybeSingle();

    const role = data?.role;
    const status = classifyPermissionRead(Boolean(error), isApplicationRole(role));
    if (status === "active" && isApplicationRole(role)) {
      const displayName =
        typeof data?.display_name === "string"
          ? data.display_name.trim()
          : "";
      return {
        status: "active",
        role,
        displayName: displayName || undefined,
      };
    }
    if (status === "revoked") return { status: "revoked" };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Keeps the browser QueryClient aligned with the verified Supabase Auth user.
 * Auth events drop the previous binding before verification is awaited.
 * Authenticated queries stay disabled until a claims check binds a user id.
 */
export function startAuthQueryIsolation(): () => void {
  if (typeof window === "undefined") return () => {};

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseBrowserClient();
  } catch {
    return () => {};
  }

  let disposed = false;
  let retryTimer: number | undefined;
  let verifiedSession: { token: string; userId: string; epoch: number } | null = null;
  // A visibility or explicit check can supersede the event's scheduled check.
  // The latest generation must still finish revalidating the recovery.
  let recoveryPending = false;

  const beginStrictAuthEvent = (event: string, userId: string | null) => {
    verifiedSession = null;
    recoveryPending = false;
    return beginBrowserAuthEvent(event, userId);
  };

  const clearRetry = () => {
    if (retryTimer === undefined) return;
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const scheduleRetry = (generation: number, retries: number) => {
    if (disposed || !isBrowserAuthCheckCurrent(generation)) return;
    if (retries >= MAX_MISMATCH_RETRIES) return;
    clearRetry();
    retryTimer = window.setTimeout(() => {
      if (disposed || !isBrowserAuthCheckCurrent(generation)) return;
      retryTimer = undefined;
      void verifyGeneration(beginBrowserAuthCheck(), retries + 1);
    }, 50);
  };

  const verifyGeneration = async (
    generation: number,
    retries = 0,
  ): Promise<AuthAccessSnapshot | null> => {
      if (disposed || !isBrowserAuthCheckCurrent(generation)) {
        return null;
      }
    const recovery = recoveryPending ? verifiedSession : null;
      let verified: AuthCommit | undefined;
    let token: string | undefined;
    let sessionToken: string | undefined;
      try {
        const initialSession = await supabase.auth.getSession();
        if (disposed || !isBrowserAuthCheckCurrent(generation)) {
          return null;
        }
        token = initialSession.data.session?.access_token;
        // Bind the claims check to the exact token, then ensure the active
        // session still uses it before recording or revalidating that token.
        const claims = initialSession.error
          ? { data: null, error: initialSession.error }
          : await supabase.auth.getClaims(token);
        if (disposed || !isBrowserAuthCheckCurrent(generation)) {
          return null;
        }

        const session = await supabase.auth.getSession();
        if (disposed || !isBrowserAuthCheckCurrent(generation)) {
          return null;
        }

        sessionToken = session.data.session?.access_token;
        const claimedUserId =
          !claims.error &&
          typeof claims.data?.claims?.sub === "string" &&
          claims.data.claims.sub.length > 0
            ? claims.data.claims.sub
            : null;

        verified = resolveAuthVerification(
          claims.error,
          claimedUserId,
          session.error,
          session.data.session?.user?.id ?? null,
        );
      } catch {
        if (disposed || !isBrowserAuthCheckCurrent(generation)) return null;
        if (recovery) generation = beginStrictAuthEvent("SIGNED_IN", recovery.userId);
        scheduleRetry(generation, retries);
        return null;
      }
      if (!verified) return null;

      if (disposed || !isBrowserAuthCheckCurrent(generation)) {
        return null;
      }
      if (recovery && (
        verified.status !== "authenticated" ||
        verified.userId !== recovery.userId ||
        token !== recovery.token ||
        sessionToken !== recovery.token
      )) {
        generation = beginStrictAuthEvent("SIGNED_IN", recovery.userId);
        if (verified.status === "authenticated") {
          scheduleRetry(generation, retries);
          return null;
        }
      }

      if (verified.status === "stale") {
        commitBrowserVerifiedUser(generation, verified);
        scheduleRetry(generation, retries);
        return null;
      }

      if (verified.status === "ignored" || verified.status === "unavailable") {
        return null;
      }

      clearRetry();
      commitBrowserVerifiedUser(generation, verified);
      if (disposed || !isBrowserAuthCheckCurrent(generation)) {
        return null;
      }

      if (verified.status !== "authenticated") {
        return null;
      }
      const verifiedUserId = verified.userId;
      if (getVerifiedAuthUserId() !== verifiedUserId) {
        return null;
      }

      const permission = await readPermissionScope(supabase, verifiedUserId);
      if (disposed || !isBrowserAuthCheckCurrent(generation)) {
        return null;
      }
      if (getVerifiedAuthUserId() !== verifiedUserId) {
        return null;
      }
      applyBrowserPermissionRead(verifiedUserId, permission);
      if (permission.status !== "active" || !isBrowserAuthCheckCurrent(generation)) {
        if (isBrowserAuthCheckCurrent(generation)) {
          verifiedSession = null;
          recoveryPending = false;
        }
        return null;
      }
      const access = getVerifiedAuthSnapshot();
      verifiedSession = token && token === sessionToken && access.status === "ready"
        ? { token, userId: verifiedUserId, epoch: access.accessEpoch }
        : null;
      recoveryPending = false;
      return access;
  };

  const sync = () => {
    clearRetry();
    return verifyGeneration(beginBrowserAuthCheck());
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (disposed) return;
    // The callback must not itself call getClaims or getSession.
    const access = getVerifiedAuthSnapshot();
    const userId = session?.user?.id ?? null;
    const repeatedSignIn = event === "SIGNED_IN" &&
      verifiedSession !== null &&
      session?.access_token === verifiedSession.token &&
      access.status === "ready" &&
      userId === access.userId && userId === verifiedSession.userId &&
      access.accessEpoch === verifiedSession.epoch;
    const strictEvent = recoveryPending && event === "TOKEN_REFRESHED" ? "SIGNED_IN" : event;
    const generation = repeatedSignIn
      ? beginBrowserAuthCheck()
      : beginStrictAuthEvent(strictEvent, userId);
    recoveryPending = repeatedSignIn;
    clearRetry();
    window.setTimeout(() => {
      if (!disposed) void verifyGeneration(generation);
    }, 0);
  });

  const onVisible = () => {
    if (document.visibilityState === "visible") sync();
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);

  const intervalId = window.setInterval(() => {
    if (document.visibilityState === "visible") sync();
  }, PERMISSION_RECHECK_MS);

  requestSync = sync;
  sync();

  return () => {
    disposed = true;
    if (requestSync === sync) requestSync = null;
    clearRetry();
    window.clearInterval(intervalId);
    data.subscription.unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
  };
}
