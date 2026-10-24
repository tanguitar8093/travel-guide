import type { Session } from '@supabase/supabase-js'
import { supabase } from '../database/supabase.client'

const markerKey = 'tripmap:google-popup'
const lifetime = 5 * 60 * 1000
let pending = false
export const isGooglePopupPending = () => pending

async function within<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('讀取 Google 登入狀態逾時，請重試。')), 15000)
    })])
  } finally { clearTimeout(timer) }
}

function readRequest(): { id: string; createdAt: number } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(markerKey) ?? 'null')
    return value && /^[0-9a-f-]{36}$/i.test(value.id) && Number.isFinite(value.createdAt) &&
      Date.now() - value.createdAt >= 0 && Date.now() - value.createdAt < lifetime ? value : null
  } catch { return null }
}
export const isGooglePopupCallback = () => readRequest() !== null

// The child only completes the SDK callback. No workspace, welcome audio or tokens
// are sent over this channel; the parent reads its session through the SDK.
export async function finishGooglePopup(): Promise<void> {
  const request = readRequest()
  if (!request) return
  const channel = new BroadcastChannel(`tripmap:google-popup:${request.id}`)
  const params = new URLSearchParams(location.hash.slice(1))
  const query = new URLSearchParams(location.search)
  try {
    const providerError = params.get('error_description') || query.get('error_description') || params.get('error') || query.get('error')
    if (providerError) throw new Error(providerError)
    const { data, error } = await within(supabase.auth.getSession())
    if (error) throw error
    if (!data.session) throw new Error('Google 驗證未完成，請重新登入。')
    channel.postMessage({ id: request.id, status: 'success' })
  } catch (cause) {
    channel.postMessage({ id: request.id, status: 'error', message: cause instanceof Error ? cause.message : 'Google 驗證失敗。' })
  } finally {
    sessionStorage.removeItem(markerKey)
    // Remove callback credentials even if a browser refuses to close the child.
    history.replaceState(null, '', location.pathname)
    channel.close()
    window.close()
  }
}

export async function signInWithGoogle(redirectTo: string): Promise<{ session: Session | null; error: Error | null }> {
  if (pending) return { session: null, error: new Error('Google 驗證視窗已開啟。') }
  if (!globalThis.BroadcastChannel) return { session: null, error: new Error('此瀏覽器不支援登入視窗，請使用新版 Chrome。') }
  // Must happen inside the original click, before any await, to avoid popup blocking.
  const popup = window.open('about:blank', '_blank', 'popup,width=500,height=700')
  if (!popup) return { session: null, error: new Error('Google 登入視窗被瀏覽器阻擋，請允許彈出式視窗後再試。') }
  pending = true
  let channel: BroadcastChannel | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let closedAt: number | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    clearInterval(poll)
    channel?.close()
    popup.close()
    pending = false
  }
  try {
    const id = crypto.randomUUID()
    popup.sessionStorage.setItem(markerKey, JSON.stringify({ id, createdAt: Date.now() }))
    const completed = new Promise<void>((resolve, reject) => {
      channel = new BroadcastChannel(`tripmap:google-popup:${id}`)
      channel.onmessage = event => {
        if (event.data?.id !== id) return
        if (event.data.status === 'success') resolve()
        else if (event.data.status === 'error') reject(new Error(typeof event.data.message === 'string' ? event.data.message : 'Google 驗證失敗。'))
      }
      timer = setTimeout(() => reject(new Error('Google 驗證逾時，請重新登入。')), lifetime)
      poll = setInterval(() => {
        // COOP can sever an OAuth window handle. Do not treat that as cancellation
        // while the user is still working in the provider's foreground window.
        if (!popup.closed || !document.hasFocus()) { closedAt = undefined; return }
        closedAt ??= Date.now()
        if (Date.now() - closedAt > 1000) reject(new Error('已取消 Google 登入。'))
      }, 250)
    })
    // Install a rejection handler immediately while the OAuth URL is being prepared.
    void completed.catch(() => {})
    const { data, error } = await Promise.race([
      within(supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo, skipBrowserRedirect: true },
      })),
      completed.then(() => new Promise<never>(() => {})),
    ])
    if (error) throw error
    if (!data.url) throw new Error('無法取得 Google 驗證網址。')
    popup.location.href = data.url
    await completed
    const { data: current, error: sessionError } = await within(supabase.auth.getSession())
    if (sessionError) throw sessionError
    if (!current.session) throw new Error('無法取得登入狀態，請重新登入。')
    return { session: current.session, error: null }
  } catch (cause) {
    return { session: null, error: cause instanceof Error ? cause : new Error('Google 登入失敗。') }
  } finally { dispose() }
}
