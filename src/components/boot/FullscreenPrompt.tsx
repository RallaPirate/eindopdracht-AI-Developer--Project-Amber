"use client";

import { useCallback, useEffect } from "react";
import { Win95Button } from "@/components/ui/Win95Button";

type FullscreenPromptProps = {
  onContinue: () => void;
};

export function FullscreenPrompt({ onContinue }: FullscreenPromptProps) {
  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Browser may deny fullscreen; continue anyway.
    }
    onContinue();
  }, [onContinue]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "e") {
        event.preventDefault();
        void enterFullscreen();
        return;
      }

      if (key === "c") {
        event.preventDefault();
        onContinue();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enterFullscreen, onContinue]);

  return (
    <div className="flex h-full w-full items-center justify-center bg-black px-4">
      <div className="os-bevel-out w-full max-w-md bg-[var(--os-window-face)] p-1 text-[var(--os-button-text)]">
        <div className="bg-[var(--os-titlebar)] px-2 py-1 text-sm font-bold text-[var(--os-text)]">
          BioReserve Systems
        </div>
        <div className="space-y-4 px-4 py-5 text-sm leading-relaxed">
          <p>
            For the best workstation experience,
            <br />
            BioReserve OS is designed to run in fullscreen mode.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Win95Button underlinedChar="E" onClick={enterFullscreen}>
              Enter Fullscreen
            </Win95Button>
            <Win95Button underlinedChar="C" onClick={onContinue}>
              Continue Windowed
            </Win95Button>
          </div>
        </div>
      </div>
    </div>
  );
}
