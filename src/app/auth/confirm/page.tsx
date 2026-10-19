"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  markEmailConfirmError,
  markFreshAuth,
  verifyEmailConfirmation,
} from "@/lib/authReturn";

function AuthConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      const code = searchParams.get("code");

      if (code && !tokenHash) {
        markEmailConfirmError();
        if (!cancelled) router.replace("/");
        return;
      }

      if (!tokenHash || type !== "email") {
        markEmailConfirmError();
        if (!cancelled) router.replace("/");
        return;
      }

      const { ok } = await verifyEmailConfirmation(tokenHash);
      if (cancelled) return;

      if (ok) {
        markFreshAuth();
      } else {
        markEmailConfirmError();
      }

      router.replace("/");
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return <div className="h-dvh w-full bg-black" aria-busy="true" />;
}

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-black" aria-busy="true" />}>
      <AuthConfirmContent />
    </Suspense>
  );
}
