import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./useAuth";
import { TourGuideAnimation } from "../common/TourGuideAnimation";
import { useOsmDataset } from "../geo/osm-dataset-preference";
import { DestinationWelcomePanel } from '../common/destination-welcome/DestinationWelcomePanel';
import { destinationWelcomeSound } from '../common/destination-welcome/sounds';
import "./AuthGate.css";

interface AuthGateProps {
  children: ReactNode;
  pending?: boolean;
}

export function AuthGate({ children, pending = false }: AuthGateProps) {
  const {
    status,
    loginWelcomeRequired,
    completeLoginWelcome,
    userRole,
    hasWorkspaceAccess,
    errorMessage: authErrorMessage,
    signInWithGoogle,
    signOut,
    clearError,
  } = useAuth();
  const dataset = useOsmDataset();
  const loginSoundUrl = destinationWelcomeSound(dataset);
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [welcomeSound, setWelcomeSound] = useState<
    "idle" | "buffering" | "playing" | "blocked" | "failed" | "finished"
  >("idle");
  const welcomeAudio = useRef<HTMLAudioElement | null>(null);
  const playPending = useRef(false);
  const playGeneration = useRef(0);
  const playbackFinished = useRef(false);
  const isSignedOut = status === "unauthenticated";

  useEffect(() => {
    const preloaded = document.getElementById("login-welcome-audio");
    if (preloaded instanceof HTMLAudioElement && preloaded.src !== new URL(loginSoundUrl, document.baseURI).href) {
      preloaded.src = loginSoundUrl;
    }
  }, [loginSoundUrl]);

  useEffect(() => {
    // Back from the OAuth provider can restore this page from the back/forward
    // cache, including its pending button state. No auth request completes then.
    const resetAfterReturn = () => setIsSubmitting(false);
    window.addEventListener("pageshow", resetAfterReturn);
    return () => window.removeEventListener("pageshow", resetAfterReturn);
  }, []);

  useEffect(
    () => () => {
      // Invalidate an interrupted play promise (including StrictMode effect cleanup).
      playGeneration.current += 1;
      playPending.current = false;
      welcomeAudio.current?.pause();
    },
    [],
  );

  useEffect(() => {
    if (loginWelcomeRequired && !isSignedOut) {
      playWelcomeSound();
    }
    if (isSignedOut) {
      stopWelcomeSound();
    }
    // Start alongside data loading; entering the workspace still waits for onended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWelcomeRequired, isSignedOut]);

  useEffect(() => {
    if (welcomeSound === "finished" && status === "authenticated" && !loginWelcomeRequired) {
      setWelcomeSound("idle");
    }
  }, [welcomeSound, status, loginWelcomeRequired]);

  useEffect(() => {
    if (!loginWelcomeRequired || (welcomeSound !== "blocked" && welcomeSound !== "failed")) return;
    // Retry on browser activation without adding controls or changing the welcome screen.
    const retry = () => playWelcomeSound();
    const retryWhenVisible = () => { if (document.visibilityState === "visible") retry(); };
    document.addEventListener("visibilitychange", retryWhenVisible);
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
    window.addEventListener("focus", retry);
    return () => {
      document.removeEventListener("visibilitychange", retryWhenVisible);
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      window.removeEventListener("focus", retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWelcomeRequired, welcomeSound]);

  function stopWelcomeSound() {
    playGeneration.current += 1;
    playPending.current = false;
    playbackFinished.current = false;
    const audio = welcomeAudio.current;
    welcomeAudio.current = null;
    if (audio) {
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
    }
    setWelcomeSound("idle");
  }

  function playWelcomeSound() {
    if (playPending.current || playbackFinished.current) return;
    let audio = welcomeAudio.current;
    if (audio && !audio.paused) return;
    if (!audio) {
      const preloaded = document.getElementById("login-welcome-audio");
      audio = preloaded instanceof HTMLAudioElement ? preloaded : new Audio(loginSoundUrl);
      if (audio.src !== new URL(loginSoundUrl, document.baseURI).href) audio.src = loginSoundUrl;
      audio.preload = "auto";
      welcomeAudio.current = audio;
      audio.onplaying = () => {
        if (welcomeAudio.current === audio) setWelcomeSound("playing");
      };
      audio.onended = () => {
        if (welcomeAudio.current === audio) {
          playbackFinished.current = true;
          setWelcomeSound("finished");
          completeLoginWelcome();
        }
      };
      audio.onerror = () => {
        if (welcomeAudio.current === audio) {
          console.warn("[welcome-audio] 音檔載入失敗", audio?.error);
          setWelcomeSound("failed");
        }
      };
    }
    // Resume the existing element at its current position; load() would restart it.
    const generation = ++playGeneration.current;
    playPending.current = true;
    setWelcomeSound("buffering");
    const requestedAt = performance.now();
    void audio.play().then(() => {
      if (generation === playGeneration.current && !audio.paused) {
        console.info(`[welcome-audio] 開始播放，等待 ${Math.round(performance.now() - requestedAt)} ms`);
      }
    }).catch((cause) => {
      if (welcomeAudio.current === audio && generation === playGeneration.current) {
        console.warn("[welcome-audio] 播放未開始", cause);
        setWelcomeSound(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "blocked"
            : "failed",
        );
      }
    }).finally(() => {
      if (generation === playGeneration.current) playPending.current = false;
    });
  }

  async function handleGoogleSignIn() {
    setFormErrorMessage(null);
    clearError();
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      stopWelcomeSound();
      setFormErrorMessage(error instanceof Error ? error.message : "登入失敗，請稍後再試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  const visibleError = formErrorMessage ?? authErrorMessage;
  const welcomePending = status !== "unauthenticated" && Boolean(loginWelcomeRequired);
  const showingWelcome = status !== "unauthenticated" && (
    welcomeSound === "playing" || (welcomeSound === "finished" && status === "loading")
  );
  // Keep the existing login card until playback starts. Never insert a flag/loading
  // detour between the Google window and the synchronized destination welcome.
  const preparingWelcome = welcomePending && !showingWelcome;

  if ((status === "loading" && !preparingWelcome) || showingWelcome || (!preparingWelcome && pending && status === "authenticated" && hasWorkspaceAccess)) {
    return <AuthLoadingPanel welcome={showingWelcome} ready={status === "authenticated"} />;
  }

  if (!preparingWelcome && status === "authenticated" && hasWorkspaceAccess) {
    return <>{children}</>;
  }

  if (!preparingWelcome && status === "authenticated" && !hasWorkspaceAccess) {
    return (
      <div className="auth-shell">
        <section className="auth-panel" aria-labelledby="auth-pending-title">
          <p className="auth-eyebrow">旅圖 · TripMap</p>
          <h1 id="auth-pending-title">帳號已登入，等待開通工作區權限</h1>
          <p className="auth-copy">
            目前角色：{userRole ?? "basic"}。請聯絡管理員升級為 member
            後再使用。
          </p>
          {authErrorMessage && (
            <p className="auth-error" role="alert">
              {authErrorMessage}
            </p>
          )}
          <button
            className="auth-secondary"
            type="button"
            onClick={() => void signOut()}
          >
            登出
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <section className="auth-panel" aria-label="登入">
        <div className="auth-brand">
          <p className="auth-eyebrow">旅圖 · TripMap</p>
          <p className="auth-tagline" lang="en">Your Journey, Your Map.</p>
        </div>
        <TourGuideAnimation />
        <div className="auth-form">
          <button className="auth-secondary auth-google-login" type="button"
            disabled={isSubmitting || preparingWelcome} onClick={() => void handleGoogleSignIn()}>
            <svg className="auth-google-logo" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24.8v7.42h10.54a9.02 9.02 0 0 1-3.91 5.92v4.92h6.33c3.7-3.41 5.85-8.43 5.85-14.34Z" />
              <path fill="#34A853" d="M24.8 43.6c5.28 0 9.71-1.75 12.95-4.8l-6.33-4.92c-1.75 1.18-3.99 1.89-6.62 1.89-5.1 0-9.42-3.45-10.96-8.1H7.3v5.07A19.56 19.56 0 0 0 24.8 43.6Z" />
              <path fill="#FBBC05" d="M13.84 27.67a11.75 11.75 0 0 1 0-7.5V15.1H7.3a19.56 19.56 0 0 0 0 17.64l6.54-5.07Z" />
              <path fill="#EA4335" d="M24.8 12.07c2.88 0 5.45 1 7.49 2.96l5.62-5.62A18.8 18.8 0 0 0 24.8 4.25 19.56 19.56 0 0 0 7.3 15.1l6.54 5.07c1.54-4.65 5.86-8.1 10.96-8.1Z" />
            </svg>
            {isSubmitting ? "前往 Google…" : "Google 登入"}
          </button>
          {visibleError && <p className="auth-error" role="alert">{visibleError}</p>}
        </div>
      </section>
    </div>
  );
}

// Authentication owns login timing; the shared panel only renders the destination.
export function AuthLoadingPanel({ welcome = false, ready = false, message = '載入中' }: { welcome?: boolean; ready?: boolean; message?: string }) {
  const dataset = useOsmDataset();
  return <DestinationWelcomePanel dataset={dataset} welcome={welcome} ready={ready} message={message} />;
}
