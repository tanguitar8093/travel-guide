import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { oauth, getSession, register, create } = vi.hoisted(() => ({
  oauth: vi.fn(), getSession: vi.fn(), register: vi.fn(), create: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: create }))
vi.mock('../database/supabase.client', () => ({
  supabase: { auth: { signInWithOAuth: oauth, getSession } },
}))
import { signInWithGoogle, signUpWithPassword } from './auth.gateway'
import { isGooglePopupPending } from './google-popup'

let channel: { onmessage?: (event: { data: unknown }) => void; close(): void }
const values = new Map<string, string>()
const popup = { sessionStorage: { setItem: (key: string, value: string) => values.set(key, value) }, location: { href: '' }, close: vi.fn(), closed: false }
const open = vi.fn()
beforeEach(() => {
  vi.clearAllMocks(); values.clear(); popup.closed = false; vi.useFakeTimers()
  open.mockReturnValue(popup)
  vi.stubGlobal('window', { open })
  vi.stubGlobal('document', { hasFocus: () => true })
  vi.stubGlobal('BroadcastChannel', class {
    onmessage?: (event: { data: unknown }) => void
    constructor() { channel = this }
    close() {}
  })
  getSession.mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('opens synchronously, keeps the parent URL, and reads the SDK session after the correlated callback', async () => {
  oauth.mockResolvedValue({ data: { url: 'https://provider.example/authorize' }, error: null })
  const result = signInWithGoogle('https://preview.example')
  expect(open).toHaveBeenCalledTimes(1)
  expect(isGooglePopupPending()).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://preview.example', skipBrowserRedirect: true } })
  expect(popup.location.href).toBe('https://provider.example/authorize')
  const { id } = JSON.parse(values.get('tripmap:google-popup')!)
  channel.onmessage?.({ data: { id: 'wrong-window', status: 'success' } })
  expect(getSession).not.toHaveBeenCalled()
  channel.onmessage?.({ data: { id, status: 'success' } })
  expect(await result).toMatchObject({ session: { user: { id: 'test-user' } }, error: null })
  expect(isGooglePopupPending()).toBe(false)
  expect(popup.close).toHaveBeenCalled()
})

it('returns a clear error when the browser blocks the popup', async () => {
  open.mockReturnValue(null)
  expect(await signInWithGoogle('https://preview.example')).toMatchObject({ session: null, error: { message: expect.stringContaining('阻擋') } })
  expect(oauth).not.toHaveBeenCalled()
})

it('cleans up a provider error and permits a retry', async () => {
  const error = new Error('Provider is not enabled')
  oauth.mockResolvedValue({ data: {}, error })
  expect(await signInWithGoogle('https://preview.example')).toEqual({ session: null, error })
  expect(isGooglePopupPending()).toBe(false)
  expect(popup.close).toHaveBeenCalled()
})

it('releases pending state when the user closes the verification window', async () => {
  oauth.mockResolvedValue({ data: { url: 'https://provider.example/authorize' }, error: null })
  const result = signInWithGoogle('https://preview.example')
  await vi.advanceTimersByTimeAsync(0)
  popup.closed = true
  await vi.advanceTimersByTimeAsync(1600)
  expect(await result).toMatchObject({ error: { message: '已取消 Google 登入。' } })
  expect(isGooglePopupPending()).toBe(false)
})

it('creates accounts with an isolated client without persisting a replacement session', async () => {
  create.mockReturnValue({ auth: { signUp: register } })
  register.mockResolvedValue({ data: { session: null }, error: null })
  const result = await signUpWithPassword('new@example.com', 'password', 'https://preview.example')
  expect(create).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  expect(register).toHaveBeenCalledWith({
    email: 'new@example.com', password: 'password',
    options: { emailRedirectTo: 'https://preview.example' },
  })
  expect(result).toEqual({ requiresEmailConfirmation: true, error: null })
})
