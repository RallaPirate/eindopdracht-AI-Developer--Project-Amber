"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { Win95Button } from "@/components/ui/Win95Button";
import { getEmailConfirmRedirectUrl } from "@/lib/authReturn";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STRONG_PASSWORD_ADVICE =
  "Choose a strong password with a mix of letters, numbers, and symbols.";

const ALREADY_REGISTERED_MESSAGE =
  "An account with this email address already exists.";
const EMAIL_CONFIRMATION_MESSAGE =
  "Check your email to complete registration.";
const SIGNUP_UNAVAILABLE_MESSAGE =
  "Registration is currently unavailable.";
const SERVICE_UNAVAILABLE_MESSAGE =
  "Registration service unavailable. Please try again.";
const GENERIC_ERROR_MESSAGE =
  "Unable to create account. Please try again.";

type FieldErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
};

type RegisterDialogProps = {
  onCancel: () => void;
  onExecute: (email: string) => void;
};

function validateForm(
  email: string,
  password: string,
  confirmPassword: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    errors.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    errors.email = "Enter a valid email address.";
  }

  if (!password) {
    errors.password = "Password is required.";
  }

  if (!confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

function isObfuscatedDuplicateUser(user: User | null): boolean {
  return Boolean(user && (!user.identities || user.identities.length === 0));
}

function mapAuthError(error: { code?: string }): {
  field?: keyof FieldErrors;
  form?: string;
} {
  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      return { field: "email", form: undefined };
    case "email_address_invalid":
      return { field: "email", form: undefined };
    case "weak_password":
      return { field: "password", form: undefined };
    case "signup_disabled":
      return { form: SIGNUP_UNAVAILABLE_MESSAGE };
    default:
      if (isAuthRetryableFetchError(error)) {
        return { form: SERVICE_UNAVAILABLE_MESSAGE };
      }
      return { form: GENERIC_ERROR_MESSAGE };
  }
}

export function RegisterDialog({ onCancel, onExecute }: RegisterDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmittingRef = useRef(false);

  async function attemptRegister() {
    if (isSubmittingRef.current) return;

    const errors = validateForm(email, password, confirmPassword);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(null);
      return;
    }

    const trimmedEmail = email.trim();

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: getEmailConfirmRedirectUrl(),
        },
      });

      if (authError) {
        const mapped = mapAuthError(authError);
        if (mapped.field === "email") {
          setFieldErrors({
            email:
              authError.code === "email_address_invalid"
                ? "Enter a valid email address."
                : ALREADY_REGISTERED_MESSAGE,
          });
        } else if (mapped.field === "password") {
          setFieldErrors({ password: "Choose a stronger password." });
        } else if (mapped.form) {
          setFormError(mapped.form);
        }
        return;
      }

      if (data.session) {
        onExecute(data.user?.email ?? trimmedEmail);
        return;
      }

      if (isObfuscatedDuplicateUser(data.user)) {
        setFieldErrors({ email: ALREADY_REGISTERED_MESSAGE });
        return;
      }

      if (data.user) {
        setFormError(EMAIL_CONFIRMATION_MESSAGE);
        return;
      }

      setFormError(GENERIC_ERROR_MESSAGE);
    } catch {
      setFormError(SERVICE_UNAVAILABLE_MESSAGE);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void attemptRegister();
  }

  function clearFormFeedback() {
    setFormError(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (key === "e") {
        event.preventDefault();
        if (isSubmittingRef.current) return;
        formRef.current?.requestSubmit();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

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
          ref={formRef}
          noValidate
          className="space-y-3 px-4 py-4"
          onSubmit={handleSubmit}
        >
          <label className="block text-sm">
            <span className="mb-1 block">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              disabled={isSubmitting}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
                clearFormFeedback();
              }}
              className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none disabled:cursor-default"
            />
            {fieldErrors.email ? (
              <p className="mt-1 text-sm" role="alert">
                {fieldErrors.email}
              </p>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              disabled={isSubmitting}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((prev) => ({
                  ...prev,
                  password: undefined,
                  confirmPassword:
                    prev.confirmPassword === "Passwords do not match."
                      ? undefined
                      : prev.confirmPassword,
                }));
                clearFormFeedback();
              }}
              className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none disabled:cursor-default"
            />
            {fieldErrors.password ? (
              <p className="mt-1 text-sm" role="alert">
                {fieldErrors.password}
              </p>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block">Confirm password</span>
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={isSubmitting}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setFieldErrors((prev) => ({
                  ...prev,
                  confirmPassword: undefined,
                }));
                clearFormFeedback();
              }}
              className="os-bevel-in w-full bg-[var(--os-input-bg)] px-2 py-1 text-sm text-black outline-none disabled:cursor-default"
            />
            {fieldErrors.confirmPassword ? (
              <p className="mt-1 text-sm" role="alert">
                {fieldErrors.confirmPassword}
              </p>
            ) : null}
          </label>

          <p className="text-sm text-[var(--os-button-text)]">
            {STRONG_PASSWORD_ADVICE}
          </p>

          {formError ? (
            <p className="text-sm" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Win95Button
              type="button"
              underlinedChar="C"
              onClick={onCancel}
            >
              Cancel
            </Win95Button>
            <Win95Button
              type="submit"
              underlinedChar="E"
              disabled={isSubmitting}
            >
              Execute
            </Win95Button>
          </div>
        </form>
      </div>
    </div>
  );
}
