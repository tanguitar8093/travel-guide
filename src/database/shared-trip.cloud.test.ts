import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
vi.mock('./supabase.client', () => ({ supabase: { rpc, auth: { getSession } } }))
vi.mock('./supabase.utils', () => ({
  withSupabaseTimeout: <T>(promise: Promise<T>) => promise,
}))

const userId = '11111111-1111-4111-8111-111111111111'
const tripId = '22222222-2222-4222-8222-222222222222'
const operationId = '33333333-3333-4333-8333-333333333333'
const request = {
  p_action: 'cancel', p_trip_id: tripId,
  p_payload: { operationId, baseVersion: '12' },
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_TRIP_COLLABORATION_ENABLED', 'true')
  vi.stubEnv('VITE_TRIP_SHARED_EDITING_ENABLED', 'true')
  rpc.mockReset()
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null })
})

afterEach(() => { vi.unstubAllEnvs() })

it('confirms cancellation through the dedicated RPC without repeating a confirmed request', async () => {
  rpc.mockResolvedValue({ data: { cancelled: true }, error: null })
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await cancelSharedTripCloud(tripId, operationId, '12')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('app_cancel_shared_trip', request)
})

it.each(['rejected request', 'fetch error'])('retries a cancellation with the identical receipt payload after %s', async (failure) => {
  if (failure === 'rejected request') rpc.mockRejectedValueOnce(new Error('Response lost'))
  else rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'Failed to fetch' } })
  rpc.mockResolvedValue({ data: { cancelled: true }, error: null })
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await cancelSharedTripCloud(tripId, operationId, '12')
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(rpc.mock.calls[0]).toEqual(['app_cancel_shared_trip', request])
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
})

it.each([
  ['42501', 'Only owner may cancel sharing'],
  ['P0001', 'Shared version changed'],
  ['PGRST202', 'Missing function'],
])('does not retry a definite server rejection %s', async (code, message) => {
  rpc.mockResolvedValue({ data: null, error: { code, message } })
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await expect(cancelSharedTripCloud(tripId, operationId, '12')).rejects.toThrow()
  expect(rpc).toHaveBeenCalledTimes(1)
})

it('stops an uncertain cancellation after one receipt retry and explicitly reports its unknown outcome', async () => {
  rpc.mockRejectedValue(new Error('Offline'))
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await expect(cancelSharedTripCloud(tripId, operationId, '12')).rejects.toThrow('結果尚未確認，可能已完成')
  expect(rpc).toHaveBeenCalledTimes(2)
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
})

it('never retries the old account cancellation under a newly signed-in account', async () => {
  rpc.mockRejectedValueOnce(new Error('Response lost'))
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: userId } } }, error: null })
    .mockResolvedValue({ data: { session: { user: { id: tripId } } }, error: null })
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await expect(cancelSharedTripCloud(tripId, operationId, '12')).rejects.toThrow('帳號已變更')
  expect(rpc).toHaveBeenCalledTimes(1)
})

it('rejects a response received after sign-out without reporting cancellation success', async () => {
  rpc.mockResolvedValue({ data: { cancelled: true }, error: null })
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: userId } } }, error: null })
    .mockResolvedValue({ data: { session: null }, error: null })
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await expect(cancelSharedTripCloud(tripId, operationId, '12')).rejects.toThrow('帳號已變更')
  expect(rpc).toHaveBeenCalledTimes(1)
})

it.each([null, {}, { cancelled: false }])('does not turn a malformed cancellation response into success: %j', async (data) => {
  rpc.mockResolvedValue({ data, error: null })
  const { cancelSharedTripCloud } = await import('./shared-trip.cloud')
  await expect(cancelSharedTripCloud(tripId, operationId, '12')).rejects.toThrow('結果尚未確認')
  expect(rpc).toHaveBeenCalledTimes(1)
})
