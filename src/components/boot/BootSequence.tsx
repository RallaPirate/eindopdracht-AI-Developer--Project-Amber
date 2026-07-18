"use client";

import { useEffect, useRef, useState } from "react";
import { BOOT_LINES } from "@/components/boot/bootMessages";
import { readSoundEnabled } from "@/lib/preferences";

type BootSequenceProps = {
  onComplete: () => void;
};

const LINE_DELAY_MS = 200;
const COMPLETE_PAUSE_MS = 1700;
/** Delay after sound starts before boot lines begin revealing. */
const MESSAGE_START_DELAY_MS = 2500;
const FADE_OUT_MS = 800;
const BOOT_SOUND_SRC = "/sounds/boot-sequence-sound.mp3";

export function BootSequence({ onComplete }: BootSequenceProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [messagesStarted, setMessagesStarted] = useState(false);
  const completedRef = useRef(false);
  const preRef = useRef<HTMLPreElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  function clearFadeTimer() {
    if (fadeTimerRef.current !== null) {
      window.clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }

  function fadeOutAndStop() {
    const audio = audioRef.current;
    if (!audio) return;

    clearFadeTimer();

    const steps = 16;
    const stepMs = FADE_OUT_MS / steps;
    const startVolume = audio.volume;
    let step = 0;

    fadeTimerRef.current = window.setInterval(() => {
      step += 1;
      audio.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        clearFadeTimer();
        audio.pause();
        audio.currentTime = 0;
        audioRef.current = null;
      }
    }, stepMs);
  }

  function finish() {
    if (completedRef.current) return;
    completedRef.current = true;
    fadeOutAndStop();
    onComplete();
  }

  function skip() {
    setMessagesStarted(true);
    setVisibleCount(BOOT_LINES.length);
    window.setTimeout(finish, COMPLETE_PAUSE_MS);
  }

  useEffect(() => {
    if (readSoundEnabled()) {
      const audio = new Audio(BOOT_SOUND_SRC);
      audio.volume = 1;
      audioRef.current = audio;
      void audio.play().catch(() => {
        // Autoplay may be blocked; continue without sound.
      });
    }

    const delayTimer = window.setTimeout(() => {
      setMessagesStarted(true);
    }, MESSAGE_START_DELAY_MS);

    return () => {
      window.clearTimeout(delayTimer);
      clearFadeTimer();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!messagesStarted) return;

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
  }, [visibleCount, messagesStarted]);

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
        className="h-full overflow-y-auto whitespace-pre font-[family-name:var(--font-boot)] text-[2vw] leading-tight tracking-wide"
      >
        {BOOT_LINES.slice(0, visibleCount).join("\n")}
        {messagesStarted && visibleCount < BOOT_LINES.length ? (
          <span className="animate-pulse">█</span>
        ) : null}
      </pre>
    </div>
  );
}
