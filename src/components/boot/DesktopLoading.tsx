"use client";

import { useRef } from "react";

type DesktopLoadingProps = {
  onComplete: () => void;
};

export function DesktopLoading({ onComplete }: DesktopLoadingProps) {
  const completedRef = useRef(false);

  function handleComplete() {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Stretch to fill viewport; distortion allowed so logo/text are never cropped */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/loading-screen.png"
        alt="Loading BioReserve OS"
        className="absolute inset-0 h-full w-full"
        style={{ objectFit: "fill" }}
      />

      <div className="absolute bottom-10 left-1/2 w-[min(800px,80vw)] -translate-x-1/2">
        <div className="os-bevel-in h-7 w-full bg-black p-[2px]">
          <div
            className="os-loading-bar-fill h-full bg-[var(--os-loading-bar)]"
            onAnimationEnd={handleComplete}
          />
        </div>
      </div>
    </div>
  );
}
