import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function requireSupabaseEnv(
  name: string,
  value: string | undefined,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

export function getSupabasePublicEnv(): {
  url: string;
  publishableKey: string;
} {
  return {
    url: requireSupabaseEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    publishableKey: requireSupabaseEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

/**
 * Cookie-backed browser Supabase client for Client Components.
 * Sessions are stored in cookies so the same identity is available to
 * server-side helpers and the Next.js proxy refresh path.
 *
 * Uses the publishable key only — RLS remains the permission boundary.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const { url, publishableKey } = getSupabasePublicEnv();
  // createBrowserClient already singletons; we still cache for env-fail-once behaviour.
  browserClient = createBrowserClient(url, publishableKey);
  return browserClient;
}
