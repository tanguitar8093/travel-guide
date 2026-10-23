import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAuth } from "./useAuth";
import { TourGuideAnimation } from "../common/TourGuideAnimation";
import { useMapProvider } from "../geo/provider-preference";
import { OkinawaLoginScene } from "./OkinawaLoginScene";
import loginSoundUrl from "../../media/okiniwa-login.wav";
import "./AuthGate.css";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const { provider } = useMapProvider();
  const {
    status,
    userRole,
    hasWorkspaceAccess,
    errorMessage: authErrorMessage,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    clearError,
  } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [formNoticeMessage, setFormNoticeMessage] = useState<string | null>(
    null,
  );
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormErrorMessage(null);
    setFormNoticeMessage(null);
    clearError();

    if (mode === "signUp" && password !== confirmPassword) {
      setFormErrorMessage("兩次密碼輸入不一致。");
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === "signIn") {
        if (provider === "osm") playWelcomeSound();
        await signInWithPassword(email.trim(), password);
        return;
      }

      const { requiresEmailConfirmation } = await signUpWithPassword(
        email.trim(),
        password,
      );
      setPassword("");
      setConfirmPassword("");
      setMode("signIn");

      if (requiresEmailConfirmation) {
        setFormNoticeMessage("註冊成功，請到信箱完成驗證後再登入。");
      } else {
        setFormNoticeMessage("註冊成功，你已經可以直接登入。");
      }
    } catch (error) {
      stopWelcomeSound();
      setFormErrorMessage(
        error instanceof Error
          ? error.message
          : mode === "signUp"
            ? "註冊失敗，請稍後再試。"
            : "登入失敗，請稍後再試。",
      );
    } finally {
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
    (welcomeSound === "finished" && status === "loading") ||
    (provider === "osm" && mode === "signIn" && isSubmitting);

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
      <section
        className="auth-panel"
        aria-label={mode === "signIn" ? "登入" : "建立新帳號"}
      >
        <div className="auth-brand">
          <p className="auth-eyebrow">旅圖 · TripMap</p>
          <p className="auth-tagline" lang="en">
            Your Journey, Your Map.
          </p>
        </div>
        {mode === "signIn" ? (
          <TourGuideAnimation />
        ) : (
          <>
            <h1 id="auth-title">建立新帳號</h1>
            <p className="auth-copy">
              註冊完成後會寄出驗證信，完成驗證後才能登入。
            </p>
          </>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>電子郵件</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="auth-field">
            <span>{mode === "signIn" ? "密碼" : "設定密碼"}</span>
            <input
              autoComplete={
                mode === "signIn" ? "current-password" : "new-password"
              }
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "signIn" ? "輸入密碼" : "設定密碼"}
              required
            />
          </label>

          {mode === "signUp" && (
            <label className="auth-field">
              <span>確認密碼</span>
              <input
                autoComplete="new-password"
                name="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再輸入一次密碼"
                required
              />
            </label>
          )}

          {formNoticeMessage && (
            <p className="auth-notice" role="status">
              {formNoticeMessage}
            </p>
          )}

          {visibleError && (
            <p className="auth-error" role="alert">
              {visibleError}
            </p>
          )}

          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? mode === "signIn"
                ? "登入中..."
                : "註冊中..."
              : mode === "signIn"
                ? "登入"
                : "註冊"}
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setFormErrorMessage(null);
              setFormNoticeMessage(null);
              clearError();
              setMode(mode === "signIn" ? "signUp" : "signIn");
              setConfirmPassword("");
            }}
          >
            {mode === "signIn"
              ? "沒有帳號？建立一個新帳號"
              : "我已經有帳號，回到登入"}
          </button>
        </form>
      </section>
    </div>
  );
}
