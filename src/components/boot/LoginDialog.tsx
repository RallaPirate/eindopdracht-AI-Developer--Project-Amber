"use client";

import { useEffect, useRef, useState } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { Win95Button } from "@/components/ui/Win95Button";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email address or password.";
const SERVICE_UNAVAILABLE_MESSAGE =
  "Authentication service unavailable. Please try again.";

type LoginDialogProps = {
  onExecute: (email: string) => void;
  onCreateUser: () => void;
};

export function LoginDialog({ onExecute, onCreateUser }: LoginDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  async function attemptLogin() {
    if (isSubmittingRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (authError) {
        setError(
          isAuthRetryableFetchError(authError)
            ? SERVICE_UNAVAILABLE_MESSAGE
            : INVALID_CREDENTIALS_MESSAGE,
        );
        return;
      }

      onExecute(data.user?.email ?? trimmedEmail);
    } catch {
      setError(SERVICE_UNAVAILABLE_MESSAGE);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        onCreateUser();
        return;
      }

      if (key === "e") {
        event.preventDefault();
        void attemptLogin();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // attemptLogin closes over latest email/password/onExecute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, onExecute, onCreateUser]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <div
        className="os-bevel-out absolute w-[min(360px,92vw)] bg-[var(--os-window-face)] p-1 text-[var(--os-button-text)]"
        style={{ top: "38%", transform: "translateY(-50%)" }}
      >
        <div className="flex items-center justify-between bg-[var(--os-titlebar)] px-2 py-1">
          <span className="text-sm font-bold text-[var(--os-text)]">
            Authentication.exe
          </span>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Close unavailable"
            className="os-bevel-button flex h-4 w-4 items-center justify-center p-0 text-[10px] leading-none text-[var(--os-disabled)]"
          >
            ×
          </button>
        </div>

        <form
          className="space-y-3 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void attemptLogin();
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={isSubmitting}
              onChange={(event) => setEmail(event.target.value)}
              className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none disabled:cursor-default"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none disabled:cursor-default"
            />
          </label>

          {error ? (
            <p className="text-sm text-[var(--os-button-text)]" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className="os-bevel-button flex w-full items-center justify-center gap-2 py-2 text-sm"
            onClick={() => {
              // Google OAuth is UI-only in this milestone.
            }}
          >
            <span
              aria-hidden
              className="flex h-4 w-4 items-center justify-center rounded-sm bg-white text-[10px] font-bold text-[#4285F4]"
            >
              G
            </span>
            Sign in with Google
          </button>

          <div className="flex justify-end gap-2 pt-2">
            <Win95Button
              type="button"
              underlinedChar="C"
              onClick={onCreateUser}
            >
              Create User
            </Win95Button>
            <Win95Button type="submit" underlinedChar="E" disabled={isSubmitting}>
              Execute
            </Win95Button>
          </div>
        </form>
      </div>
    </div>
  );
}
