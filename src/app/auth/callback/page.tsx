"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  exchangeOAuthCode,
  markFreshAuth,
  markOAuthError,
} from "@/lib/authReturn";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const oauthError = searchParams.get("error");
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (oauthError) {
        markOAuthError();
        if (!cancelled) router.replace("/");
        return;
      }

      if (tokenHash || type) {
        if (!cancelled) router.replace("/");
        return;
      }

      if (!code) {
        markOAuthError();
        if (!cancelled) router.replace("/");
        return;
      }

      const { ok } = await exchangeOAuthCode(code);
      if (cancelled) return;

      if (ok) {
        markFreshAuth();
      } else {
        markOAuthError();
      }

      router.replace("/");
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return <div className="h-dvh w-full bg-black" aria-busy="true" />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-black" aria-busy="true" />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
