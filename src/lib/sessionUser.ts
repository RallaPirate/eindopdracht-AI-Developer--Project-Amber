import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export type AuthSessionResult =
  | {
      status: "authenticated";
      user: User;
      displayName: string;
    }
  | {
      status: "anonymous";
    }
  | {
      status: "auth_error";
      message: string;
    }
  | {
      status: "config_error";
      message: string;
    };

function fallbackDisplayName(user: User): string {
  const email = user.email?.trim();
  return email && email.length > 0 ? email : "User";
}

export async function resolveAuthSession(): Promise<AuthSessionResult> {
  let supabase;
  try {
    supabase = getSupabaseBrowserClient();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Authentication is not configured correctly.";
    return { status: "config_error", message };
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return {
      status: "auth_error",
      message: "Unable to verify the current session. Please try again.",
    };
  }

  const session = data.session;
  if (!session?.user) {
    return { status: "anonymous" };
  }

  return {
    status: "authenticated",
    user: session.user,
    displayName: fallbackDisplayName(session.user),
  };
}

export async function enrichDisplayName(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const name =
      typeof data.display_name === "string" ? data.display_name.trim() : "";
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
