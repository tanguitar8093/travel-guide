import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAuth } from './useAuth'
import './AuthGate.css'

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const {
    status,
    errorMessage: authErrorMessage,
    signInWithPassword,
    signUpWithPassword,
    clearError,
  } = useAuth()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [formNoticeMessage, setFormNoticeMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormErrorMessage(null)
    setFormNoticeMessage(null)
    clearError()

    if (mode === 'signUp' && password !== confirmPassword) {
      setFormErrorMessage('兩次密碼輸入不一致。')
      return
    }

    setIsSubmitting(true)

    try {
      if (mode === 'signIn') {
        await signInWithPassword(email.trim(), password)
        return
      }

      const { requiresEmailConfirmation } = await signUpWithPassword(email.trim(), password)
      setPassword('')
      setConfirmPassword('')
      setMode('signIn')

      if (requiresEmailConfirmation) {
        setFormNoticeMessage('註冊成功，請到信箱完成驗證後再登入。')
      } else {
        setFormNoticeMessage('註冊成功，你已經可以直接登入。')
      }
    } catch (error) {
      setFormErrorMessage(
        error instanceof Error
          ? error.message
          : mode === 'signUp'
            ? '註冊失敗，請稍後再試。'
            : '登入失敗，請稍後再試。',
      )
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
        <h1 id="auth-title">{mode === 'signIn' ? '登入後才能使用資料' : '建立新帳號'}</h1>
        <p className="auth-copy">
          {mode === 'signIn'
            ? '若你已經有帳號，請直接登入。'
            : '註冊完成後會寄出驗證信，完成驗證後才能登入。'}
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
            <span>{mode === 'signIn' ? '密碼' : '設定密碼'}</span>
            <input
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'signIn' ? '輸入密碼' : '設定密碼'}
              required
            />
          </label>

          {mode === 'signUp' && (
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
            {isSubmitting ? (mode === 'signIn' ? '登入中...' : '註冊中...') : mode === 'signIn' ? '登入' : '註冊'}
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setFormErrorMessage(null)
              setFormNoticeMessage(null)
              clearError()
              setMode(mode === 'signIn' ? 'signUp' : 'signIn')
              setConfirmPassword('')
            }}
          >
            {mode === 'signIn' ? '沒有帳號？建立一個新帳號' : '我已經有帳號，回到登入'}
          </button>
        </form>
      </section>
    </div>
  )
}
