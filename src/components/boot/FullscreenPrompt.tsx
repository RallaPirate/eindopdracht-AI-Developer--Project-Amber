"use client";

import { Win95Button } from "@/components/ui/Win95Button";

type FullscreenPromptProps = {
  onContinue: () => void;
};

export function FullscreenPrompt({ onContinue }: FullscreenPromptProps) {
  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Browser may deny fullscreen; continue anyway.
    }
    onContinue();
  }

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
            <Win95Button onClick={enterFullscreen}>Enter Fullscreen</Win95Button>
            <Win95Button onClick={onContinue}>Continue Windowed</Win95Button>
          </div>
        </div>
      </div>
    </div>
  );
}
