"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BootSequence } from "@/components/boot/BootSequence";
import { DesktopLoading } from "@/components/boot/DesktopLoading";
import { FullscreenPrompt } from "@/components/boot/FullscreenPrompt";
import { LoginDialog } from "@/components/boot/LoginDialog";
import { WelcomeBackDialog } from "@/components/boot/WelcomeBackDialog";
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
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { enrichDisplayName, resolveAuthSession } from "@/lib/sessionUser";

export type ShellPhase =
  | "fullscreen"
  | "boot"
  | "awaitingSession"
  | "login"
  | "welcome"
  | "loading"
  | "desktop"
  | "authError";

type SessionStatus =
  | "pending"
  | "authenticated"
  | "anonymous"
  | "config_error"
  | "auth_error";

function displayNameFromEmail(email: string): string {
  const trimmed = email.trim();
  return trimmed.length > 0 ? trimmed : "User";
}

function AuthErrorScreen({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <div
        className="os-bevel-out absolute w-[min(360px,92vw)] bg-[var(--os-window-face)] p-1 text-[var(--os-button-text)]"
        style={{ top: "38%", transform: "translateY(-50%)" }}
      >
        <div className="flex items-center justify-between bg-[var(--os-titlebar)] px-2 py-1">
          <span className="text-sm font-bold text-[var(--os-text)]">{title}</span>
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
        <div className="space-y-2 px-4 py-4 text-sm" role="alert">
          <p>{message}</p>
        </div>
      </div>
    </div>
  );
}

export function BioReserveShell() {
  const [phase, setPhase] = useState<ShellPhase>("fullscreen");
  const [currentUser, setCurrentUser] = useState("User");
  const [welcomeDisplayName, setWelcomeDisplayName] = useState("User");
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("pending");
  const [sessionCheckId, setSessionCheckId] = useState(0);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const sessionStatusRef = useRef(sessionStatus);
  const currentUserRef = useRef(currentUser);
  sessionStatusRef.current = sessionStatus;
  currentUserRef.current = currentUser;

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

  const startBootCycle = useCallback(() => {
    setSignOutError(null);
    setAuthErrorMessage(null);
    setSessionStatus("pending");
    setSessionCheckId((id) => id + 1);
    setPhase("boot");
  }, []);

  const branchAfterSessionResolved = useCallback(() => {
    const status = sessionStatusRef.current;
    if (status === "pending") return;

    if (status === "authenticated") {
      setWelcomeDisplayName(currentUserRef.current);
      setPhase("welcome");
      return;
    }

    if (status === "anonymous") {
      setPhase("login");
      return;
    }

    setPhase("authError");
  }, []);

  useEffect(() => {
    if (sessionCheckId === 0) return;

    let cancelled = false;

    void (async () => {
      const result = await resolveAuthSession();
      if (cancelled) return;

      if (result.status === "authenticated") {
        setSessionStatus("authenticated");
        setCurrentUser(result.displayName);
        setAuthErrorMessage(null);

        void enrichDisplayName(result.user.id).then((name) => {
          if (cancelled || !name) return;
          setCurrentUser(name);
        });
        return;
      }

      if (result.status === "anonymous") {
        setSessionStatus("anonymous");
        setAuthErrorMessage(null);
        return;
      }

      setSessionStatus(result.status);
      setAuthErrorMessage(result.message);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionCheckId]);

  useEffect(() => {
    if (phase === "awaitingSession" && sessionStatus !== "pending") {
      branchAfterSessionResolved();
    }
  }, [phase, sessionStatus, branchAfterSessionResolved]);

  const handleBootComplete = useCallback(() => {
    if (sessionStatusRef.current === "pending") {
      setPhase("awaitingSession");
      return;
    }
    branchAfterSessionResolved();
  }, [branchAfterSessionResolved]);

  const handleWelcomeComplete = useCallback(() => {
    setPhase("loading");
  }, []);

  const handleExecute = useCallback((email: string) => {
    setSignOutError(null);
    setSessionStatus("authenticated");
    setCurrentUser(displayNameFromEmail(email));
    setPhase("loading");

    void (async () => {
      const result = await resolveAuthSession();
      if (result.status !== "authenticated") return;
      const name = await enrichDisplayName(result.user.id);
      if (name) {
        setCurrentUser(name);
      }
    })();
  }, []);

  const handleChangeUser = useCallback(async () => {
    setSignOutError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        setSignOutError("Unable to sign out of this workstation. Please try again.");
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || data.session) {
        setSignOutError("Unable to sign out of this workstation. Please try again.");
        return;
      }

      resetWindows();
      setSessionStatus("anonymous");
      setCurrentUser("User");
      setWelcomeDisplayName("User");
      setAuthErrorMessage(null);
      setPhase("login");
    } catch {
      setSignOutError("Unable to sign out of this workstation. Please try again.");
    }
  }, [resetWindows]);

  const handleReboot = useCallback(() => {
    resetWindows();
    setSignOutError(null);
    setAuthErrorMessage(null);
    setCurrentUser("User");
    setWelcomeDisplayName("User");
    setPhase("fullscreen");
  }, [resetWindows]);

  const handleLocaleChange = useCallback((next: LocalePreference) => {
    writeLocale(next);
  }, []);

  const handleSoundToggle = useCallback(() => {
    writeSoundEnabled(!readSoundEnabled());
  }, []);

  if (phase === "fullscreen") {
    return <FullscreenPrompt onContinue={startBootCycle} />;
  }

  if (phase === "boot") {
    return <BootSequence onComplete={handleBootComplete} />;
  }

  if (phase === "awaitingSession") {
    return <div className="h-full w-full bg-black" aria-busy="true" />;
  }

  if (phase === "authError") {
    return (
      <AuthErrorScreen
        title="Authentication.exe"
        message={
          authErrorMessage ??
          "Authentication is unavailable. Please check the workstation configuration."
        }
      />
    );
  }

  if (phase === "login") {
    return <LoginDialog onExecute={handleExecute} />;
  }

  if (phase === "welcome") {
    return (
      <WelcomeBackDialog
        displayName={welcomeDisplayName}
        onComplete={handleWelcomeComplete}
      />
    );
  }

  if (phase === "loading") {
    return <DesktopLoading onComplete={() => setPhase("desktop")} />;
  }

  return (
    <div className="relative flex h-full w-full flex-col">
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
        onChangeUser={() => {
          void handleChangeUser();
        }}
        onReboot={handleReboot}
      />

      {signOutError ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="os-bevel-out w-[min(360px,92vw)] bg-[var(--os-window-face)] p-1 text-[var(--os-button-text)]">
            <div className="bg-[var(--os-titlebar)] px-2 py-1 text-sm font-bold text-[var(--os-text)]">
              BioReserve OS
            </div>
            <div className="space-y-3 px-4 py-4 text-sm">
              <p role="alert">{signOutError}</p>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="os-bevel-button px-3 py-1 text-sm"
                  onClick={() => setSignOutError(null)}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
