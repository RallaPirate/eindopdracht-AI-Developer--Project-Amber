import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAuthenticatedSupabase,
  type AuthenticatedSupabaseAccess,
} from "@/lib/supabaseServer";
import {
  isApplicationRole,
  type ApplicationRole,
} from "@/types/database";

export type { ApplicationRole };

export type CurrentProfileAccess = {
  supabase: SupabaseClient;
  /** Verified Auth user id (`auth.users.id` / JWT `sub`). */
  authUserId: string;
  /** Permanent internal application identity (`profiles.id`). */
  profileId: string;
  /** Authoritative role from `profiles.role` (not Auth metadata). */
  role: ApplicationRole;
};

export type CurrentProfileResult =
  | ({ status: "ok" } & CurrentProfileAccess)
  | { status: "unauthenticated" }
  | {
      /** Authenticated Auth user with no linked permanent profile row. */
      status: "unlinked";
      authUserId: string;
    }
  | { status: "error"; message: string };

type ProfileIdentityRow = {
  id: string;
  role: string;
};

/**
 * Loads the permanent profile linked to a verified Auth identity.
 * Uses the authenticated client and RLS; does not accept role/id from callers.
 */
export async function resolveLinkedProfile(
  access: AuthenticatedSupabaseAccess,
): Promise<CurrentProfileResult> {
  const { data, error } = await access.supabase
    .from("profiles")
    .select("id, role")
    .eq("auth_user_id", access.userId)
    .maybeSingle();

  if (error) {
    return {
      status: "error",
      message: "Unable to resolve the application profile.",
    };
  }

  if (!data) {
    return {
      status: "unlinked",
      authUserId: access.userId,
    };
  }

  const row = data as ProfileIdentityRow;
  if (
    typeof row.id !== "string" ||
    row.id.length === 0 ||
    !isApplicationRole(row.role)
  ) {
    return {
      status: "error",
      message: "Application profile data is invalid.",
    };
  }

  return {
    status: "ok",
    supabase: access.supabase,
    authUserId: access.userId,
    profileId: row.id,
    role: row.role,
  };
}

/**
 * Request-scoped lookup of the authenticated user's permanent profile and role.
 *
 * Authentication alone is not sufficient: a linked `profiles` row is required.
 * Role is read only from `profiles.role` under RLS.
 */
export const getCurrentProfile = cache(
  async (): Promise<CurrentProfileResult> => {
    const access = await getAuthenticatedSupabase();
    if (!access) {
      return { status: "unauthenticated" };
    }

    return resolveLinkedProfile(access);
  },
);
