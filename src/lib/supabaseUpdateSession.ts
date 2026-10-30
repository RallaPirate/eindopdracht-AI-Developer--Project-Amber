import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase";

/**
 * Refreshes the Auth session cookies for the current request.
 * Must run early in the Next.js proxy so Server Components and Route Handlers
 * see a valid session. Does not redirect — desktop auth UX remains client-side.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const { url, publishableKey } = getSupabasePublicEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  // Do not insert logic between createServerClient and getClaims().
  // getClaims() verifies the JWT and triggers cookie refresh when needed.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
