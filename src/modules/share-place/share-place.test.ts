import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), search: vi.fn() }))
vi.mock('../../database/supabase.client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: mocks.getSession } } }))
vi.mock('../../geo/osm-service', () => ({ searchOsmLocations: mocks.search }))
import { extractMapsUrl, importSharedPlace, prepareSharedPlace } from './share-import.service'
import { prepareShareLogin, readShare, receiveShare, restoreShareAfterLogin, saveShare } from './share-store'
const id = 'e15692da-d36b-47b7-9526-f262da7c27c3'
const mapsUrl = 'https://maps.app.goo.gl/tWvNV7FfEfHbpd5X6'
const result = { status: 'created', placeId: id, name: '那霸機場' }
const candidate = { name: '那霸機場', mapsUrl: 'https://www.google.com/maps?q=26.2,127.6', location: { coordinate: { latitude: 26.2, longitude: 127.6 } } }
const pending = () => ({ id, createdAt: Date.now(), title: '那霸機場', text: mapsUrl, url: '' })
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); vi.stubGlobal('navigator', {})
  vi.stubGlobal('location', { origin: 'https://trip.test', pathname: '/share/place', search: `?receipt=${id}` })
  vi.stubGlobal('history', { replaceState: vi.fn() })
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } })
  mocks.search.mockResolvedValue([candidate])
  mocks.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: result, error: null, status: 200 }) }))
})
afterEach(() => vi.unstubAllGlobals())
it('extracts one Google Maps link and rejects ambiguous or unrelated input', () => {
  expect(extractMapsUrl(pending())).toBe(mapsUrl)
  expect(() => extractMapsUrl({ title: '', text: 'https://evil.test/maps', url: '' })).toThrow('Google Maps')
  expect(() => extractMapsUrl({ title: '', text: mapsUrl, url: 'https://goo.gl/maps/other' })).toThrow('一個')
})
it('persists the worker receipt before removing its transport copy', async () => {
  const cache = { match: vi.fn().mockResolvedValue(new Response(JSON.stringify(pending()))), delete: vi.fn() }
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })
  await receiveShare()
  expect(readShare(id)?.text).toBe(mapsUrl)
  await receiveShare()
  expect(cache.match).toHaveBeenCalledTimes(1)
  expect(cache.delete).toHaveBeenCalledTimes(1)
})
it('refuses URL parameters without a share receipt', async () => {
  location.search = '?url=' + encodeURIComponent(mapsUrl)
  await expect(receiveShare()).rejects.toThrow('分享選單')
})
it.each([false, true])('preserves OAuth callback and receipt across login (other window: %s)', otherWindow => {
  prepareShareLogin(id)
  if (otherWindow) sessionStorage.removeItem('tripmap:share:oauth-return')
  vi.stubGlobal('location', { pathname: '/', origin: 'https://trip.test', href: 'https://trip.test/#access_token=test' })
  restoreShareAfterLogin()
  expect(history.replaceState).toHaveBeenCalledWith(null, '', `/share/place?receipt=${id}#access_token=test`)
})
it('prepares through the common Maps API adapter without writing before login', async () => {
  saveShare(pending())
  await prepareSharedPlace(id)
  expect(mocks.search).toHaveBeenCalledWith(mapsUrl)
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(mocks.getSession).not.toHaveBeenCalled()
  await importSharedPlace(id, 'user-a', vi.fn())
  expect(mocks.search).toHaveBeenCalledTimes(1)
  expect(mocks.rpc).toHaveBeenCalledWith('app_import_place', expect.objectContaining({ p_operation_id: id, p_name: '那霸機場' }))
})
it('single-flights rendering, keeps a stable operation ID and does not reimport a completed receipt', async () => {
  saveShare(pending())
  const first = importSharedPlace(id, 'user-a', vi.fn())
  expect(importSharedPlace(id, 'user-a', vi.fn())).toBe(first)
  await first
  await importSharedPlace(id, 'user-a', vi.fn())
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
  expect(readShare(id)?.text).toBe('')
})
it('retries an ambiguous API failure with the same resolved payload', async () => {
  saveShare(pending())
  mocks.rpc.mockImplementationOnce(() => ({ abortSignal: () => Promise.resolve({ error: { message: 'network' } }) }))
  await expect(importSharedPlace(id, 'user-a', vi.fn())).rejects.toThrow('network')
  await importSharedPlace(id, 'user-a', vi.fn())
  expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
  expect(mocks.search).toHaveBeenCalledTimes(1)
})
it('does not import a receipt bound to a different account', async () => {
  saveShare({ ...pending(), accountId: 'other' })
  await expect(importSharedPlace(id, 'user-a', vi.fn())).rejects.toThrow('另一個登入帳號')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('does not automatically add approximate coordinates', async () => {
  saveShare(pending())
  mocks.search.mockResolvedValue([{ ...candidate, warning: '推估位置，請確認' }])
  await expect(importSharedPlace(id, 'user-a', vi.fn())).rejects.toThrow('推估')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
