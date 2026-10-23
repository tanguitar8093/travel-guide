import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useAdminSyncInfo } from '../../common/useAdminSyncInfo'

export function AdminCreateAccount() {
  const { signUpWithPassword } = useAuth()
  const { visible } = useAdminSyncInfo()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!visible || busy) return
    setError('')
    setNotice('')
    if (password !== confirmation) {
      setError('兩次密碼輸入不一致。')
      return
    }
    setBusy(true)
    try {
      const result = await signUpWithPassword(email.trim(), password)
      setPassword('')
      setConfirmation('')
      setNotice(result.requiresEmailConfirmation
        ? '帳號已建立，請至信箱完成驗證。'
        : '帳號已建立。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '建立帳號失敗，請稍後再試。')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null
  return <section className="data-management-card" aria-labelledby="admin-create-account-heading">
    <h2 id="admin-create-account-heading">建立帳號</h2>
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field"><span>電子郵件</span>
        <input type="email" autoComplete="off" required value={email} disabled={busy}
          onChange={event => setEmail(event.target.value)} />
      </label>
      <label className="auth-field"><span>設定密碼</span>
        <input type="password" autoComplete="new-password" required value={password} disabled={busy}
          onChange={event => setPassword(event.target.value)} />
      </label>
      <label className="auth-field"><span>確認密碼</span>
        <input type="password" autoComplete="new-password" required value={confirmation} disabled={busy}
          onChange={event => setConfirmation(event.target.value)} />
      </label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <button className="auth-submit" type="submit" disabled={busy}>{busy ? '建立中…' : '建立帳號'}</button>
    </form>
  </section>
}
