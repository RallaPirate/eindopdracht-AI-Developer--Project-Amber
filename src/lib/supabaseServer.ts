import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase";

type VerifiedClaims = NonNullable<
  NonNullable<
    Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>["data"]
  >["claims"]
>;

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers. Reads the Auth session from cookies; never uses the
 * service-role key. Ordinary data access remains subject to RLS.
 *
 * Create a new client per request — do not cache across requests.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component where cookies cannot be written.
          // The proxy refreshes sessions on the response path.
        }
      },
    },
  });
}

export type AuthenticatedSupabaseAccess = {
  supabase: SupabaseClient;
  /** Verified Auth user id (`sub` claim). */
  userId: string;
  claims: VerifiedClaims;
};

/**
 * Returns a cookie-authenticated Supabase client plus the verified user id.
 * Identity comes from JWT verification via `getClaims()` — never from
 * client-supplied body/query fields.
 *
 * Returns `null` when there is no valid authenticated session.
 */
export async function getAuthenticatedSupabase(): Promise<AuthenticatedSupabaseAccess | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  const userId = data?.claims?.sub;
  if (error || !userId || typeof userId !== "string") {
    return null;
  }

  return {
    supabase,
    userId,
    claims: data.claims,
  };
}
