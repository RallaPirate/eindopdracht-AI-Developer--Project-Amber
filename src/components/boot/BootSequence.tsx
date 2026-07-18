"use client";

import { useEffect, useRef, useState } from "react";
import { BOOT_LINES } from "@/components/boot/bootMessages";

type BootSequenceProps = {
  onComplete: () => void;
};

const LINE_DELAY_MS = 55;
const COMPLETE_PAUSE_MS = 600;

export function BootSequence({ onComplete }: BootSequenceProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const completedRef = useRef(false);
  const preRef = useRef<HTMLPreElement>(null);

  function finish() {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }

  function skip() {
    setVisibleCount(BOOT_LINES.length);
    window.setTimeout(finish, COMPLETE_PAUSE_MS);
  }

  useEffect(() => {
    if (visibleCount >= BOOT_LINES.length) {
      const timer = window.setTimeout(finish, COMPLETE_PAUSE_MS);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setVisibleCount((count) => count + 1);
    }, LINE_DELAY_MS);

    return () => window.clearTimeout(timer);
    // finish is stable enough for this presentation-only effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter") {
        event.preventDefault();
        skip();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [visibleCount]);

  return (
    <div
      className="h-full w-full cursor-default overflow-hidden bg-black p-4 text-[var(--os-text)]"
      onClick={skip}
      role="presentation"
    >
      <pre
        ref={preRef}
        className="h-full overflow-y-auto whitespace-pre font-[family-name:var(--font-boot)] text-lg leading-tight tracking-wide"
      >
        {BOOT_LINES.slice(0, visibleCount).join("\n")}
        {visibleCount < BOOT_LINES.length ? (
          <span className="animate-pulse">█</span>
        ) : null}
      </pre>
    </div>
  );
}
