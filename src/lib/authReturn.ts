import { getSupabaseBrowserClient } from "@/lib/supabase";

const FRESH_AUTH_KEY = "bioreserve:fresh-auth:v1";
const OAUTH_ERROR_KEY = "bioreserve:oauth-error:v1";
const EMAIL_CONFIRM_ERROR_KEY = "bioreserve:email-confirm-error:v1";

export const GOOGLE_SIGN_IN_ERROR_MESSAGE =
  "Unable to sign in with Google. Please try again.";
export const EMAIL_CONFIRM_ERROR_MESSAGE =
  "Unable to confirm your email. Please try again.";
export const FRESH_AUTH_SESSION_ERROR_MESSAGE =
  "Unable to complete sign in. Please try again.";

const exchangePromises = new Map<string, Promise<unknown>>();

function writeFlag(key: string): void {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Private browsing or disabled storage.
  }
}

function clearFlag(key: string): boolean {
  try {
    const had = sessionStorage.getItem(key) === "1";
    sessionStorage.removeItem(key);
    return had;
  } catch {
    return false;
  }
}

export function getOAuthCallbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

export function getEmailConfirmRedirectUrl(): string {
  return `${window.location.origin}/auth/confirm`;
}

export function markFreshAuth(): void {
  writeFlag(FRESH_AUTH_KEY);
}

export function consumeFreshAuth(): boolean {
  return clearFlag(FRESH_AUTH_KEY);
}

export function markOAuthError(): void {
  writeFlag(OAUTH_ERROR_KEY);
}

export function consumeOAuthError(): boolean {
  return clearFlag(OAUTH_ERROR_KEY);
}

export function markEmailConfirmError(): void {
  writeFlag(EMAIL_CONFIRM_ERROR_KEY);
}

export function consumeEmailConfirmError(): boolean {
  return clearFlag(EMAIL_CONFIRM_ERROR_KEY);
}

/**
 * Runs an exchange at most once per key. Concurrent callers await the same Promise.
 */
export function runExchangeOnce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = exchangePromises.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn();
  exchangePromises.set(key, promise);
  return promise;
}

export async function signInWithGoogle(): Promise<{ error: Error | null }> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getOAuthCallbackUrl(),
      },
    });

    if (!error) {
      return { error: null };
    }

    return { error: new Error(GOOGLE_SIGN_IN_ERROR_MESSAGE) };
  } catch {
    return { error: new Error(GOOGLE_SIGN_IN_ERROR_MESSAGE) };
  }
}

export async function exchangeOAuthCode(code: string): Promise<{ ok: boolean }> {
  const key = `oauth:${code}`;
  return runExchangeOnce(key, async () => {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return { ok: !error };
  });
}

export async function verifyEmailConfirmation(
  tokenHash: string,
): Promise<{ ok: boolean }> {
  const key = `email:${tokenHash}:email`;
  return runExchangeOnce(key, async () => {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });
    return { ok: !error };
  });
}
