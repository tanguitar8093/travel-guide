import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), role: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), from: vi.fn() }))
vi.mock('../database/supabase.client', () => ({ supabaseAuthStorageKey: 'auth', supabaseAuthCodeVerifierKey: 'code', supabase: {
  auth: { getSession: mocks.getSession, onAuthStateChange: mocks.subscribe }, from: mocks.from,
} }))
import { fetchCurrentSession, fetchUserRole, subscribeSessionChange } from './auth.gateway'
const session = { user: { id: 'test-user' } } as Session
let callback: (event: AuthChangeEvent, session: Session | null) => void
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  mocks.getSession.mockResolvedValue({ data: { session }, error: null })
  mocks.role.mockResolvedValue({ data: { role: 'member' }, error: null })
  const chain = { select: () => chain, eq: () => chain, abortSignal: () => chain, maybeSingle: mocks.role }
  mocks.from.mockReturnValue(chain)
  mocks.subscribe.mockImplementation(listener => { callback = listener; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } } })
})
afterEach(() => vi.useRealTimers())
it('runs downstream queries after the SDK callback has returned', async () => {
  const listener = vi.fn(() => { void fetchUserRole('test-user') })
  const unsubscribe = subscribeSessionChange(listener)
  callback('SIGNED_IN', session)
  expect(listener).not.toHaveBeenCalled()
  expect(mocks.from).not.toHaveBeenCalled()
  await vi.runAllTimersAsync()
  expect(listener).toHaveBeenCalledWith(session, 'SIGNED_IN')
  expect(mocks.from).toHaveBeenCalledTimes(1)
  unsubscribe()
})
it('preserves event order and discards deferred work on unsubscribe', async () => {
  const listener = vi.fn()
  const unsubscribe = subscribeSessionChange(listener)
  callback('INITIAL_SESSION', session); callback('TOKEN_REFRESHED', session)
  await vi.runAllTimersAsync()
  expect(listener.mock.calls.map(call => call[1])).toEqual(['INITIAL_SESSION', 'TOKEN_REFRESHED'])
  callback('SIGNED_OUT', null); unsubscribe()
  await vi.runAllTimersAsync()
  expect(listener).toHaveBeenCalledTimes(2)
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
})
it('bounds session reads rather than leaving startup loading forever', async () => {
  mocks.getSession.mockReturnValue(new Promise(() => {}))
  const pending = fetchCurrentSession()
  await vi.advanceTimersByTimeAsync(15000)
  expect(await pending).toMatchObject({ session: null, error: { message: expect.stringContaining('逾時') } })
})
it('bounds role reads without granting access on timeout', async () => {
  mocks.role.mockReturnValue(new Promise(() => {}))
  const pending = fetchUserRole('test-user')
  await vi.advanceTimersByTimeAsync(15000)
  expect(await pending).toMatchObject({ role: null, error: { message: expect.stringContaining('逾時') } })
})
it('converts thrown SDK failures into explicit startup errors', async () => {
  mocks.getSession.mockRejectedValue(new Error('session failed'))
  mocks.role.mockRejectedValue(new Error('role failed'))
  expect(await fetchCurrentSession()).toMatchObject({ session: null, error: { message: 'session failed' } })
  expect(await fetchUserRole('test-user')).toMatchObject({ role: null, error: { message: 'role failed' } })
})
