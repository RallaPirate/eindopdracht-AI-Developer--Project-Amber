"use client";

import {
  Activity, Suspense, use, useCallback, useEffect, useRef, useState,
  useSyncExternalStore, type ReactNode, type SyntheticEvent,
} from "react";
import { BootSequence } from "@/components/boot/BootSequence";
import { DesktopLoading } from "@/components/boot/DesktopLoading";
import { FullscreenPrompt } from "@/components/boot/FullscreenPrompt";
import { LoginDialog } from "@/components/boot/LoginDialog";
import { RegisterDialog } from "@/components/boot/RegisterDialog";
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
import {
  requestAuthQuerySync,
} from "@/lib/authQueryIsolation";
import {
  getVerifiedAuthSnapshot,
  subscribeVerifiedAuthSnapshot,
} from "@/lib/queryClient";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export type ShellPhase =
  | "fullscreen"
  | "boot"
  | "awaitingSession"
  | "login"
  | "register"
  | "welcome"
  | "loading"
  | "desktop"
  | "accessSuspended"
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

// Activity disconnects Effects while retaining state and DOM. The gate also
// prevents hidden query subscriptions from rendering loading branches that
// would otherwise destroy nested forms while the cache is being cleared.
const pendingVerification = new Promise<never>(() => {});
function VerifiedDesktop({ children, presentationId }: { children: ReactNode; presentationId: number }) {
  const access = getVerifiedAuthSnapshot();
  if (access.status !== "ready" || access.presentation?.id !== presentationId) use(pendingVerification);
  return children;
}

function blockUnverifiedInteraction(event: SyntheticEvent, presentationId: number) {
  const access = getVerifiedAuthSnapshot();
  if (access.status === "ready" && access.presentation?.id === presentationId) return;
  event.preventDefault();
  event.stopPropagation();
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
  const [resumePhase, setResumePhase] = useState<
    "welcome" | "loading" | "desktop"
  >("welcome");

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
  const authAccess = useSyncExternalStore(
    subscribeVerifiedAuthSnapshot,
    getVerifiedAuthSnapshot,
    getVerifiedAuthSnapshot,
  );
  const startBootCycle = useCallback(() => {
    setSignOutError(null);
    setAuthErrorMessage(null);
    setResumePhase("welcome");
    setSessionStatus("pending");
    setSessionCheckId((id) => id + 1);
    setPhase("boot");
  }, []);

  const branchAfterSessionResolved = useCallback(() => {
    const status = sessionStatusRef.current;
    if (status === "pending") return;

    if (status === "authenticated") {
      const access = getVerifiedAuthSnapshot();
      if (access.status !== "ready") {
        setResumePhase("welcome");
        setPhase("accessSuspended");
        void requestAuthQuerySync();
        return;
      }
      if (access.displayName) setCurrentUser(access.displayName);
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
    void requestAuthQuerySync().then((result) => {
      if (cancelled) return;
      if (result.status === "ready" && result.userId) {
        setSessionStatus("authenticated");
        setCurrentUser(result.displayName ?? "User");
        setAuthErrorMessage(null);
        return;
      }

      if (result.status === "anonymous") {
        setSessionStatus("anonymous");
        setAuthErrorMessage(null);
        return;
      }

      if (result.status === "revoked") {
        setSessionStatus("auth_error");
        setAuthErrorMessage(
          "This account is not linked to an active BioReserve profile.",
        );
        return;
      }

      if (result.status === "suspended" && result.userId) {
        setSessionStatus("authenticated");
        setAuthErrorMessage(
          "Unable to verify profile access. Protected access is suspended.",
        );
        return;
      }

      // A replacement check owns the final outcome. Keep boot pending until
      // the subscribed authority below resolves its presentation.
      setSessionStatus("pending");
    });
    return () => {
      cancelled = true;
    };
  }, [sessionCheckId]);

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

  const handleExecute = useCallback(async (email: string) => {
    setSignOutError(null);
    setSessionStatus("authenticated");
    setCurrentUser(displayNameFromEmail(email));
    setResumePhase("loading");
    setPhase("accessSuspended");

    const access = await requestAuthQuerySync();
    if (access.status === "ready") {
      setCurrentUser(access.displayName ?? displayNameFromEmail(email));
      setAuthErrorMessage(null);
      setPhase("loading");
      return;
    }
    if (access.status === "revoked") {
      setAuthErrorMessage(
        "This account is not linked to an active BioReserve profile.",
      );
      setPhase("authError");
    }
  }, []);

  const handleChangeUser = useCallback(async () => {
    setSignOutError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        void requestAuthQuerySync();
        setSignOutError("Unable to sign out of this workstation. Please try again.");
        return;
      }

      const access = await requestAuthQuerySync();
      if (access.status !== "anonymous") {
        setSignOutError("Unable to sign out of this workstation. Please try again.");
        return;
      }

      setSessionStatus("anonymous");
      setCurrentUser("User");
      setWelcomeDisplayName("User");
      setAuthErrorMessage(null);
      setPhase("login");
    } catch {
      void requestAuthQuerySync();
      setSignOutError("Unable to sign out of this workstation. Please try again.");
    }
  }, []);

  const handleReboot = useCallback(() => {
    setSignOutError(null);
    setAuthErrorMessage(null);
    setCurrentUser("User");
    setWelcomeDisplayName("User");
    setPhase("fullscreen");
  }, []);

  const handleLocaleChange = useCallback((next: LocalePreference) => {
    writeLocale(next);
  }, []);

  const handleSoundToggle = useCallback(() => {
    writeSoundEnabled(!readSoundEnabled());
  }, []);

  let effectivePhase = phase;
  if (phase === "desktop" && authAccess.status !== "ready") {
    effectivePhase = authAccess.status === "anonymous" ? "login" : "accessSuspended";
  } else if (
    phase === "accessSuspended" ||
    phase === "authError" ||
    phase === "awaitingSession"
  ) {
    // Intermediate or superseded check results cannot strand boot or recovery.
    // Presentation follows the latest authoritative snapshot on every render.
    if (phase !== "awaitingSession" || authAccess.status === "suspended") {
      effectivePhase = "accessSuspended";
    }
    if (authAccess.status === "ready") effectivePhase = resumePhase;
    if (authAccess.status === "anonymous") effectivePhase = "login";
    if (authAccess.status === "revoked") effectivePhase = "authError";
  }

  if (phase === "desktop" && authAccess.presentation) {
    const blocked = authAccess.status !== "ready";
    const presentationId = authAccess.presentation.id;
    const guardInteraction = (event: SyntheticEvent) => blockUnverifiedInteraction(event, presentationId);
    return (
      <div className="relative h-full w-full">
        <div
          className="h-full w-full"
          hidden={blocked}
          inert={blocked}
          aria-hidden={blocked || undefined}
          onClickCapture={guardInteraction}
          onDoubleClickCapture={guardInteraction}
          onMouseDownCapture={guardInteraction}
          onPointerDownCapture={guardInteraction}
          onKeyDownCapture={guardInteraction}
          onKeyUpCapture={guardInteraction}
          onInputCapture={guardInteraction}
          onChangeCapture={guardInteraction}
          onSubmitCapture={guardInteraction}
          onFocusCapture={guardInteraction}
        >
          <Activity mode={blocked ? "hidden" : "visible"}>
            <Suspense fallback={null}>
              <VerifiedDesktop presentationId={presentationId}>
                <ProtectedDesktop
                  key={authAccess.presentation.id}
                  currentUser={authAccess.displayName ?? currentUser}
                  locale={locale}
                  soundEnabled={soundEnabled}
                  signOutError={signOutError}
                  onDismissError={() => setSignOutError(null)}
                  onLocaleChange={handleLocaleChange}
                  onSoundToggle={handleSoundToggle}
                  onChangeUser={() => { void handleChangeUser(); }}
                  onReboot={handleReboot}
                />
              </VerifiedDesktop>
            </Suspense>
          </Activity>
        </div>
        {blocked ? (
          <AuthErrorScreen
            title="Authentication.exe"
            message="Verifying identity and profile access. Protected access is suspended."
          />
        ) : null}
      </div>
    );
  }

  if (effectivePhase === "fullscreen") {
    return <FullscreenPrompt onContinue={startBootCycle} />;
  }

  if (effectivePhase === "boot") {
    return <BootSequence onComplete={handleBootComplete} />;
  }

  if (effectivePhase === "awaitingSession") {
    return <div className="h-full w-full bg-black" aria-busy="true" />;
  }

  if (effectivePhase === "accessSuspended") {
    return (
      <AuthErrorScreen
        title="Authentication.exe"
        message="Verifying identity and profile access. Protected access is suspended."
      />
    );
  }

  if (effectivePhase === "authError") {
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

  if (effectivePhase === "login") {
    return (
      <LoginDialog
        onExecute={handleExecute}
        onCreateUser={() => setPhase("register")}
      />
    );
  }

  if (effectivePhase === "register") {
    return (
      <RegisterDialog
        onCancel={() => setPhase("login")}
        onExecute={handleExecute}
      />
    );
  }

  if (effectivePhase === "welcome") {
    return (
      <WelcomeBackDialog
        displayName={authAccess.displayName ?? welcomeDisplayName}
        onComplete={handleWelcomeComplete}
      />
    );
  }

  if (effectivePhase === "loading") {
    return <DesktopLoading onComplete={() => setPhase("desktop")} />;
  }

  return null;
}

// Window state and program instances belong to one verified presentation owner.
function ProtectedDesktop({
  currentUser,
  locale,
  soundEnabled,
  signOutError,
  onDismissError,
  onLocaleChange,
  onSoundToggle,
  onChangeUser,
  onReboot,
}: {
  currentUser: string;
  locale: LocalePreference;
  soundEnabled: boolean;
  signOutError: string | null;
  onDismissError: () => void;
  onLocaleChange: (locale: LocalePreference) => void;
  onSoundToggle: () => void;
  onChangeUser: () => void;
  onReboot: () => void;
}) {
  const {
    windows, activeId, openWindow, closeWindow, focusWindow, moveWindow,
  } = useWindowManager();
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
        onLocaleChange={onLocaleChange}
        onSoundToggle={onSoundToggle}
        onChangeUser={onChangeUser}
        onReboot={onReboot}
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
                  onClick={onDismissError}
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
