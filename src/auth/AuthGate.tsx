import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import './AuthGate.css'

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const { status, errorMessage: authErrorMessage, signInWithPassword, clearError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormErrorMessage(null)
    clearError()
    setIsSubmitting(true)

    try {
      await signInWithPassword(email.trim(), password)
    } catch (error) {
      setFormErrorMessage(error instanceof Error ? error.message : '登入失敗，請稍後再試。')
    } finally {
      setIsSubmitting(false)
    }
  }

  const visibleError = formErrorMessage ?? authErrorMessage

  if (status === 'loading') {
    return (
      <div className="auth-shell">
        <section className="auth-panel auth-panel-loading" aria-live="polite">
          <p className="auth-eyebrow">TRAVEL PLANNER</p>
          <h1>正在確認登入狀態</h1>
          <p>稍候片刻，正在向 Supabase 取得工作階段。</p>
        </section>
      </div>
    )
  }

  if (status === 'authenticated') {
    return <>{children}</>
  }

  return (
    <div className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="auth-eyebrow">TRAVEL PLANNER</p>
        <h1 id="auth-title">登入後才能使用資料</h1>
        <p className="auth-copy">
          目前專案已切入 Supabase Auth 基礎。只有已受邀成員可以登入；若尚未收到邀請，請先由管理員在 Supabase 建立使用者。
        </p>

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
            <span>密碼</span>
            <input
              autoComplete="current-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="輸入密碼"
              required
            />
          </label>

          {visibleError && (
            <p className="auth-error" role="alert">
              {visibleError}
            </p>
          )}

          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '登入中...' : '登入'}
          </button>
        </form>
      </section>
    </div>
  )
}