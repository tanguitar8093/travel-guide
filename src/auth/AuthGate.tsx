import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./useAuth";
import { TourGuideAnimation } from "../common/TourGuideAnimation";
import { OkinawaLoginScene } from "./OkinawaLoginScene";
import loginSoundUrl from "../../media/okiniwa-login.wav";
import "./AuthGate.css";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const {
    status,
    userRole,
    hasWorkspaceAccess,
    errorMessage: authErrorMessage,
    signInWithGoogle,
    signOut,
    clearError,
  } = useAuth();
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [welcomeSound, setWelcomeSound] = useState<
    "idle" | "playing" | "blocked" | "failed" | "finished"
  >("idle");
  const welcomeAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      welcomeAudio.current?.pause();
    },
    [],
  );

  useEffect(() => {
    if (welcomeSound === "finished" && status !== "loading" && !isSubmitting) {
      setWelcomeSound("idle");
    }
  }, [welcomeSound, status, isSubmitting]);

  function stopWelcomeSound() {
    const audio = welcomeAudio.current;
    welcomeAudio.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    setWelcomeSound("idle");
  }

  function playWelcomeSound() {
    let audio = welcomeAudio.current;
    if (!audio) {
      audio = new Audio(loginSoundUrl);
      welcomeAudio.current = audio;
      audio.onended = () => {
        if (welcomeAudio.current === audio) setWelcomeSound("finished");
      };
      audio.onerror = () => {
        if (welcomeAudio.current === audio) setWelcomeSound("failed");
      };
    }
    if (audio.error) audio.load();
    setWelcomeSound("playing");
    void audio.play().catch((cause) => {
      if (welcomeAudio.current === audio) {
        setWelcomeSound(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "blocked"
            : "failed",
        );
      }
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
      setIsSubmitting(false);
    }
  }

  const visibleError = formErrorMessage ?? authErrorMessage;
  const waitingForSound =
    welcomeSound === "playing" ||
    welcomeSound === "blocked" ||
    welcomeSound === "failed";
  const showingOkinawaWelcome =
    waitingForSound ||
    (welcomeSound === "finished" && status === "loading");

  if (status === "loading" || showingOkinawaWelcome) {
    return (
      <div className="auth-shell">
        <section
          className="auth-panel auth-panel-loading"
          role="status"
          aria-label="正在確認登入狀態"
          aria-live="polite"
        >
          {showingOkinawaWelcome ? (
            <div className="auth-island-heading">
              <p className="auth-eyebrow">旅圖 · TripMap</p>
              <p className="auth-island-destination">
                <span>沖繩</span>
                <span className="auth-island-separator">·</span>
                <span className="auth-island-english" lang="en">Okinawa</span>
              </p>
            </div>
          ) : (
            <p className="auth-eyebrow">旅圖 · TripMap</p>
          )}
          {showingOkinawaWelcome ? (
            <OkinawaLoginScene />
          ) : (
            <TourGuideAnimation />
          )}
          <p className="auth-loading-caption">
            {showingOkinawaWelcome && status === "authenticated"
              ? "準備出發"
              : "載入中"}
            <span className="auth-loading-dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
          {showingOkinawaWelcome && (
            <p className="auth-tagline" lang="en">
              Your Journey, Your Map.
            </p>
          )}
          {(welcomeSound === "blocked" || welcomeSound === "failed") && (
            <div className="auth-welcome-audio">
              <p>
                {welcomeSound === "blocked"
                  ? "播放迎賓音效，開始沖繩之旅。"
                  : "音效暫時無法播放，請重試。"}
              </p>
              <button
                type="button"
                className="auth-secondary"
                onClick={playWelcomeSound}
              >
                {welcomeSound === "blocked" ? "播放迎賓音效" : "重試音效"}
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (status === "authenticated" && hasWorkspaceAccess) {
    return <>{children}</>;
  }

  if (status === "authenticated" && !hasWorkspaceAccess) {
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
            disabled={isSubmitting} onClick={() => void handleGoogleSignIn()}>
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
