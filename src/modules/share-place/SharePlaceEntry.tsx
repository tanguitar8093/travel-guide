import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AuthGate, AuthLoadingPanel } from '../../auth/AuthGate'
import { useAuth } from '../../auth/useAuth'
import { importSharedPlace, prepareSharedPlace } from './share-import.service'
import { prepareShareLogin, receiveShare, saveShare, shareLifetime, type ImportResult, type PendingShare } from './share-store'
import './share-place.css'

export function SharePlaceEntry() {
  const auth = useAuth()
  const [share, setShare] = useState<PendingShare>()
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  useEffect(() => {
    let active = true
    void receiveShare().then(value => {
      if (!active) return
      setShare(value)
      if (!value.result && Date.now() - value.createdAt <= shareLifetime) void prepareSharedPlace(value.id).catch(() => {})
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '無法接收分享。') })
    return () => { active = false }
  }, [])
  async function login() {
    if (!share) return
    setSigningIn(true)
    setError('')
    try { prepareShareLogin(share.id); await auth.signInWithGoogle() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法開始登入。'); setSigningIn(false) }
  }
  if (!share && !error) return <AuthLoadingPanel message="正在接收分享" />
  if (!share || auth.status === 'unauthenticated') return <ShareShell>
    <h1>加入 TripMap 地點</h1>
    {share && <p>登入後會繼續加入這次分享的地點，無需重新分享。</p>}
    {error && <p role="alert">{error}</p>}
    {share && <button type="button" disabled={signingIn} onClick={() => void login()}>{signingIn ? '前往 Google…' : '使用 Google 登入後加入'}</button>}
  </ShareShell>
  return <AuthGate><ShareReceiver share={share} /></AuthGate>
}
function ShareShell({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return <main className="share-place-shell"><section className="share-place-panel" aria-label="分享地點至 TripMap">{onClose && <button type="button" className="share-place-close" aria-label="關閉頁面" title="關閉頁面" onClick={onClose}><span aria-hidden="true">×</span></button>}<p className="share-place-brand">旅圖 · TripMap</p>{children}</section></main>
}
function ShareReceiver({ share }: { share: PendingShare }) {
  const { user, signOut } = useAuth()
  const accountId = user?.id
  const [confirmed, setConfirmed] = useState(() => Date.now() - share.createdAt <= shareLifetime)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('準備加入地點…')
  const [result, setResult] = useState<ImportResult>()
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  function closePage() {
    clearTimeout(closeTimer.current)
    try { window.close() } catch { /* Some browsers reject closing; fall back to history. */ }
    closeTimer.current = setTimeout(() => {
      if (!window.closed) window.history.back()
    }, 200)
  }
  useEffect(() => {
    if (!confirmed || !accountId) return
    let active = true
    void importSharedPlace(share.id, accountId, message => { if (active) setStatus(message) })
      .then(value => { if (active) setResult(value) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '加入失敗，請重試。') })
    return () => { active = false }
  }, [share.id, accountId, confirmed, attempt])
  async function editPlace() {
    if (!result) return
    setEditing(true); setError('')
    try {
      const { getDatabaseMode } = await import('../../database/runtime')
      if (getDatabaseMode() === 'hybrid') {
        const { requireHybridStore } = await import('../../database/hybrid.runtime')
        const { syncHybridManually } = await import('../../database/sync-engine')
        await syncHybridManually(requireHybridStore())
      } else if (getDatabaseMode() === 'indexeddb') throw new Error('地點已存入雲端；請切換雲端或混合模式後編輯標籤。')
      location.assign(`/places?edit=${encodeURIComponent(result.placeId)}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法開啟地點。'); setEditing(false) }
  }
  return <ShareShell onClose={result ? closePage : undefined}>
    <h1>{result ? result.status === 'duplicate' ? '地點已存在' : '加入成功' : '加入 TripMap 地點'}</h1>
    {!confirmed ? <>
      <p>這筆分享已超過 24 小時，是否繼續加入？</p>
      <button type="button" onClick={() => { saveShare({ ...share, createdAt: Date.now() }); setConfirmed(true) }}>繼續加入</button>
    </> : result ? <>
      <p className="share-place-name">{result.name}</p>
      <p role="status">{result.status === 'duplicate' ? '已保留原有地點，沒有重複新增。' : '地點已儲存至你的雲端帳號。'}</p>
      <button type="button" disabled={editing} onClick={() => void editPlace()}>{editing ? '正在準備地點…' : '編輯標籤'}</button>
      <button type="button" className="share-place-secondary" onClick={closePage}>關閉頁面</button>
      <p className="share-place-hint">可使用手機的返回手勢或最近使用的應用程式，回到 Google Maps。</p>
    </> : !error && <p role="status" aria-live="polite">{status}</p>}
    {error && <><p role="alert">{error}</p>
      {!result && <button type="button" onClick={() => { setError(''); setStatus('準備加入地點…'); setAttempt(value => value + 1) }}>重試</button>}
      {!result && <button type="button" className="share-place-secondary" onClick={() => void signOut()}>重新登入</button>}
    </>}
    <p className="share-place-account">{user?.email}</p>
  </ShareShell>
}
