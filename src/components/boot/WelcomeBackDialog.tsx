"use client";

import { useEffect } from "react";

const WELCOME_DURATION_MS = 2000;

type WelcomeBackDialogProps = {
  displayName: string;
  onComplete: () => void;
};

export function WelcomeBackDialog({
  displayName,
  onComplete,
}: WelcomeBackDialogProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onComplete();
    }, WELCOME_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [onComplete]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <div
        className="os-bevel-out absolute w-[min(320px,92vw)] bg-[var(--os-window-face)] p-1 text-[var(--os-button-text)]"
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

        <div className="px-4 py-5 text-sm">
          <p>Welcome back, {displayName}!</p>
        </div>
      </div>
    </div>
  );
}
