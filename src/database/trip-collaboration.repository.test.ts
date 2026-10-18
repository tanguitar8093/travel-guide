import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
vi.mock('./supabase.client', () => ({ supabase: { rpc, auth: { getSession } } }))
vi.mock('./supabase.utils', () => ({
  withSupabaseTimeout: <T>(promise: Promise<T>) => promise,
  mapSupabasePermissionError: () => undefined,
}))

const userId = '11111111-1111-4111-8111-111111111111'
const tripId = '22222222-2222-4222-8222-222222222222'
const trip = {
  id: tripId, name: 'Shared trip', regionId: userId, startDate: '2026-10-19', endDate: '2026-10-20',
  ownerUid: userId, access: 'owner', aclVersion: '0',
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_TRIP_COLLABORATION_ENABLED', 'true')
  rpc.mockReset()
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null })
})

afterEach(() => { vi.unstubAllEnvs() })

it('defaults collaboration to disabled and performs no network calls', async () => {
  vi.stubEnv('VITE_TRIP_COLLABORATION_ENABLED', '')
  const { TripCollaborationRepository, tripCollaborationEnabled } = await import('./trip-collaboration.repository')
  expect(tripCollaborationEnabled).toBe(false)
  await expect(new TripCollaborationRepository().list()).rejects.toThrow('尚未啟用')
  expect(rpc).not.toHaveBeenCalled()
})

it('parses explicit access and rejects malformed list responses', async () => {
  const { parseCollaborationList } = await import('./trip-collaboration.repository')
  expect(parseCollaborationList({ trips: [trip], invitations: [] }).trips[0].access).toBe('owner')
  expect(() => parseCollaborationList({ trips: [{ ...trip, access: 'admin' }], invitations: [] })).toThrow()
  expect(() => parseCollaborationList({ trips: [], invitations: null })).toThrow()
  expect(() => parseCollaborationList({ trips: [{ ...trip, aclVersion: 1 }], invitations: [] })).toThrow()
})

it('omits private place fields from the typed shared projection', async () => {
  const { parseCollaborationDetails } = await import('./trip-collaboration.repository')
  const details = parseCollaborationDetails({
    trip, members: [], invitations: [],
    places: [{ id: 'place-id', name: 'Cafe', notes: 'private', labelIds: ['secret'] }],
    items: [{ id: 'item-id', placeId: 'place-id', date: '2026-10-19', order: 0, note: 'Shared itinerary note' }],
  })
  expect(details.places[0]).not.toHaveProperty('notes')
  expect(details.places[0]).not.toHaveProperty('labelIds')
  expect(details.items[0].note).toBe('Shared itinerary note')
})

it('calls only the scoped collaboration RPC with validated inputs', async () => {
  rpc.mockResolvedValue({ data: { trips: [trip], invitations: [] }, error: null })
  const { TripCollaborationRepository } = await import('./trip-collaboration.repository')
  const repository = new TripCollaborationRepository()
  expect((await repository.list()).trips).toHaveLength(1)
  expect(rpc).toHaveBeenCalledWith('app_trip_collaboration', {
    p_action: 'list', p_trip_id: null, p_payload: {},
  })
  rpc.mockClear()
  await expect(repository.invite(tripId, 'not-a-user-id', 'viewer')).rejects.toThrow('UUID')
  expect(rpc).not.toHaveBeenCalled()
})

it('rejects stale results after account switching', async () => {
  rpc.mockResolvedValue({ data: { trips: [trip], invitations: [] }, error: null })
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: userId } } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: tripId } } }, error: null })
  const { TripCollaborationRepository } = await import('./trip-collaboration.repository')
  await expect(new TripCollaborationRepository().list()).rejects.toThrow('帳號已變更')
})

it('reports absent server migration rather than treating it as empty success', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Missing function' } })
  const { TripCollaborationRepository } = await import('./trip-collaboration.repository')
  await expect(new TripCollaborationRepository().list()).rejects.toThrow('尚未安裝')
})

it('denies unauthenticated calls without reaching the RPC', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null })
  const { TripCollaborationRepository } = await import('./trip-collaboration.repository')
  await expect(new TripCollaborationRepository().list()).rejects.toThrow('請先登入')
  expect(rpc).not.toHaveBeenCalled()
})
