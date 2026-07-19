"use client";

import { useEffect, useRef, useState } from "react";
import { LanguageMenu } from "@/components/desktop/LanguageMenu";
import { StartMenu } from "@/components/desktop/StartMenu";
import type { WindowState } from "@/components/desktop/useWindowManager";
import { Win95Button } from "@/components/ui/Win95Button";
import type { LocalePreference } from "@/lib/preferences";
import { getProgram, type ProgramId } from "@/types/programs";

type TaskbarProps = {
  currentUser: string;
  windows: WindowState[];
  activeId: ProgramId | null;
  locale: LocalePreference;
  soundEnabled: boolean;
  onFocusWindow: (id: ProgramId) => void;
  onLocaleChange: (locale: LocalePreference) => void;
  onSoundToggle: () => void;
  onChangeUser: () => void;
  onReboot: () => void;
};

function formatOsClock(now: Date): { time: string; date: string } {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  // Display year is always 1993; do not mutate the Date object.
  return {
    time: `${hours}:${minutes}`,
    date: `${day}//${month}//1993`,
  };
}

export function Taskbar({
  currentUser,
  windows,
  activeId,
  locale,
  soundEnabled,
  onFocusWindow,
  onLocaleChange,
  onSoundToggle,
  onChangeUser,
  onReboot,
}: TaskbarProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [clock, setClock] = useState(() => formatOsClock(new Date()));
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setClock(formatOsClock(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!barRef.current?.contains(event.target as Node)) {
        setStartOpen(false);
        setLangOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const sortedWindows = [...windows].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div
      ref={barRef}
      className="os-bevel-out relative z-[10000] flex h-8 shrink-0 items-center gap-1 bg-[var(--os-graphite)] px-1 text-[var(--os-text)]"
    >
      <div className="relative">
        <Win95Button
          className={`!text-[var(--os-button-text)] ${startOpen ? "!border-[var(--os-border-dark)_var(--os-border-light)_var(--os-border-light)_var(--os-border-dark)]" : ""}`}
          onClick={() => {
            setStartOpen((open) => !open);
            setLangOpen(false);
          }}
        >
          Start
        </Win95Button>
        {startOpen ? (
          <StartMenu
            currentUser={currentUser}
            onChangeUser={onChangeUser}
            onReboot={onReboot}
            onClose={() => setStartOpen(false)}
          />
        ) : null}
      </div>

      <div className="mx-0.5 h-5 w-px bg-[var(--os-border-shadow)]" />

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {sortedWindows.map((win) => {
          const program = getProgram(win.id);
          const isActive = activeId === win.id;
          return (
            <button
              key={win.id}
              type="button"
              className={`os-bevel-button max-w-[160px] truncate px-2 py-0.5 text-left text-xs ${
                isActive
                  ? "!border-[var(--os-border-dark)_var(--os-border-light)_var(--os-border-light)_var(--os-border-dark)]"
                  : ""
              }`}
              onClick={() => onFocusWindow(win.id)}
            >
              {program.title}
            </button>
          );
        })}
      </div>

      <div className="os-bevel-in relative ml-auto flex items-center gap-1 bg-[var(--os-graphite)] px-1 py-0.5">
        <div className="relative">
          <button
            type="button"
            className="px-1 text-xs hover:bg-black/20"
            aria-label="Language"
            onClick={() => {
              setLangOpen((open) => !open);
              setStartOpen(false);
            }}
          >
            {locale === "nl" ? "NL" : "EN"}
          </button>
          {langOpen ? (
            <LanguageMenu
              locale={locale}
              onSelect={(next) => {
                onLocaleChange(next);
                setLangOpen(false);
              }}
            />
          ) : null}
        </div>

        <button
          type="button"
          className="px-1 text-xs hover:bg-black/20"
          aria-label={soundEnabled ? "Sound on" : "Sound off"}
          aria-pressed={soundEnabled}
          onClick={onSoundToggle}
          title={soundEnabled ? "Sound on" : "Sound off"}
        >
          {soundEnabled ? "♪" : "✕"}
        </button>

        <div
          className="min-w-[88px] px-1 text-right text-xs leading-tight tabular-nums"
          title={`${clock.date} ${clock.time}`}
        >
          <div>{clock.time}</div>
          <div>{clock.date}</div>
        </div>
      </div>
    </div>
  );
}
