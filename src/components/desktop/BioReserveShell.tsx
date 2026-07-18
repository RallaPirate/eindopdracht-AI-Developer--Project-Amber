"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { BootSequence } from "@/components/boot/BootSequence";
import { DesktopLoading } from "@/components/boot/DesktopLoading";
import { FullscreenPrompt } from "@/components/boot/FullscreenPrompt";
import { LoginDialog } from "@/components/boot/LoginDialog";
import { Desktop } from "@/components/desktop/Desktop";
import { Taskbar } from "@/components/desktop/Taskbar";
import { useWindowManager } from "@/components/desktop/useWindowManager";
import {
  readLocale,
  readSoundEnabled,
  subscribeLocale,
  subscribeSound,
  writeLocale,
  writeSoundEnabled,
  type LocalePreference,
} from "@/lib/preferences";

export type ShellPhase =
  | "fullscreen"
  | "boot"
  | "login"
  | "loading"
  | "desktop";

function displayNameFromEmail(email: string): string {
  const trimmed = email.trim();
  return trimmed.length > 0 ? trimmed : "Operator";
}

export function BioReserveShell() {
  const [phase, setPhase] = useState<ShellPhase>("fullscreen");
  const [currentUser, setCurrentUser] = useState("Operator");

  const locale = useSyncExternalStore(
    subscribeLocale,
    readLocale,
    () => "en" as const,
  );
  const soundEnabled = useSyncExternalStore(
    subscribeSound,
    readSoundEnabled,
    () => true,
  );

  const {
    windows,
    activeId,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindow,
    resetWindows,
  } = useWindowManager();

  const handleExecute = useCallback((email: string) => {
    setCurrentUser(displayNameFromEmail(email));
    setPhase("loading");
  }, []);

  const handleChangeUser = useCallback(() => {
    resetWindows();
    setPhase("login");
  }, [resetWindows]);

  const handleReboot = useCallback(() => {
    resetWindows();
    setCurrentUser("Operator");
    setPhase("fullscreen");
  }, [resetWindows]);

  const handleLocaleChange = useCallback((next: LocalePreference) => {
    writeLocale(next);
  }, []);

  const handleSoundToggle = useCallback(() => {
    writeSoundEnabled(!readSoundEnabled());
  }, []);

  if (phase === "fullscreen") {
    return <FullscreenPrompt onContinue={() => setPhase("boot")} />;
  }

  if (phase === "boot") {
    return <BootSequence onComplete={() => setPhase("login")} />;
  }

  if (phase === "login") {
    return <LoginDialog onExecute={handleExecute} />;
  }

  if (phase === "loading") {
    return <DesktopLoading onComplete={() => setPhase("desktop")} />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <Desktop
          windows={windows}
          activeId={activeId}
          onOpenProgram={openWindow}
          onFocusWindow={focusWindow}
          onCloseWindow={closeWindow}
          onMoveWindow={moveWindow}
        />
      </div>
      <Taskbar
        currentUser={currentUser}
        windows={windows}
        activeId={activeId}
        locale={locale}
        soundEnabled={soundEnabled}
        onFocusWindow={focusWindow}
        onLocaleChange={handleLocaleChange}
        onSoundToggle={handleSoundToggle}
        onChangeUser={handleChangeUser}
        onReboot={handleReboot}
      />
    </div>
  );
}
