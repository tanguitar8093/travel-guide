import { beforeEach, expect, it, vi } from 'vitest'
import type { SharedTripSnapshot } from './shared-trip.types'
import type { SyncTask } from './sync.types'

const state = vi.hoisted(() => ({ mode: 'hybrid', generation: 0 }))
const mocks = vi.hoisted(() => ({
  list: vi.fn<() => Promise<SharedTripSnapshot[]>>(), cancel: vi.fn(),
  sync: vi.fn(), resolve: vi.fn(),
}))
const store = vi.hoisted(() => ({
  listTasks: vi.fn<() => Promise<SyncTask[]>>(),
  captureAccount() {
    const generation = state.generation
    return () => {
      if (generation !== state.generation) throw new Error('帳號已變更')
    }
  },
}))
vi.mock('./runtime', () => ({ getDatabaseMode: () => state.mode }))
vi.mock('./shared-trip.cloud', () => ({
  sharedTripCloud: { list: mocks.list }, cancelSharedTripCloud: mocks.cancel,
}))
vi.mock('./sync-engine', () => ({ syncHybridManually: mocks.sync }))
vi.mock('./hybrid.runtime', () => ({
  requireHybridStore: () => store,
  runHybridTask: (work: (current: typeof store) => Promise<void>) => work(store),
}))
vi.mock('./shared-trip.local', () => ({
  SharedTripLocal: class { resolve = mocks.resolve },
}))
import { SharedTripRepository } from './shared-trip.repository'

const tripId = '11111111-1111-4111-8111-111111111111'
const regionId = '22222222-2222-4222-8222-222222222222'
function fixture(): SharedTripSnapshot {
  return {
    id: tripId, version: '12', document: {
      trip: {
        id: tripId, regionId, ownerUid: tripId, name: 'Trip', access: 'owner', aclVersion: '1',
        startDate: '2026-10-20', endDate: '2026-10-21',
      },
      region: { id: regionId, name: 'Kyoto', googlePlaceId: 'kyoto', zoom: 12 },
      places: [], items: [],
    },
  }
}

const pending: SyncTask = {
  account: { projectId: 'project', userId: tripId }, deviceId: 'device',
  operationId: '33333333-3333-4333-8333-333333333333', protocolVersion: 1,
  operation: 'region.create', createdAt: '2026-10-20T00:00:00.000Z',
  changes: [], status: 'pending', attempts: 0,
}

beforeEach(() => {
  state.mode = 'hybrid'
  state.generation = 0
  vi.clearAllMocks()
  mocks.list.mockReset().mockResolvedValue([fixture()])
  mocks.cancel.mockReset().mockResolvedValue(undefined)
  mocks.sync.mockReset().mockResolvedValue(undefined)
  mocks.resolve.mockReset().mockResolvedValue(undefined)
  store.listTasks.mockReset().mockResolvedValue([])
})

it.each(['cancel', 'resolve'] as const)('refuses standalone %s before consulting the cloud', async (action) => {
  state.mode = 'indexeddb'
  const repository = new SharedTripRepository()
  await expect(action === 'cancel' ? repository.cancel(tripId) : repository.resolve(tripId, fixture(), 'cloud')).rejects.toThrow()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('does not cancel while existing drafts or uncertain requests remain queued', async () => {
  store.listTasks.mockResolvedValue([pending])
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('請先完成所有待同步操作')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('rechecks pending writes that arrive while fetching the cancellation version', async () => {
  store.listTasks.mockResolvedValueOnce([]).mockResolvedValueOnce([pending])
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('期間新增了待同步操作')
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('uses the latest owner version and then downloads the private copy through hybrid sync', async () => {
  await new SharedTripRepository().cancel(tripId)
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(tripId, expect.any(String), '12')
  expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(store)
  expect(mocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0])
})

it('keeps direct cloud cancellation independent of the hybrid workspace', async () => {
  state.mode = 'supabase'
  await new SharedTripRepository().cancel(tripId)
  expect(mocks.cancel).toHaveBeenCalledOnce()
  expect(store.listTasks).not.toHaveBeenCalled()
  expect(mocks.sync).not.toHaveBeenCalled()
})

it('reports a committed cloud cancellation separately from a failed private download', async () => {
  mocks.sync.mockRejectedValueOnce(new Error('Offline'))
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('雲端已取消共享並保留最新行程，但本機尚未完成同步')
  expect(mocks.cancel).toHaveBeenCalledOnce()
})

it('does not claim cloud cancellation or start downloading after an unconfirmed request', async () => {
  mocks.cancel.mockRejectedValueOnce(new Error('結果尚未確認'))
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('結果尚未確認')
  expect(mocks.sync).not.toHaveBeenCalled()
})

it('reports missing shared content without attempting another cancellation', async () => {
  mocks.list.mockResolvedValueOnce([{ id: tripId, version: '13', document: null }])
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('沒有可取消的共同編輯內容')
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('rejects a viewer cancellation before sending the mutation', async () => {
  const row = fixture()
  if (!row.document) throw new Error('Missing document')
  row.document.trip.access = 'viewer'
  mocks.list.mockResolvedValueOnce([row])
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('只有擁有者')
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('rejects cancellation if the account changed while fetching the shared version', async () => {
  mocks.list.mockImplementationOnce(async () => {
    state.generation += 1
    return [fixture()]
  })
  await expect(new SharedTripRepository().cancel(tripId)).rejects.toThrow('帳號已變更')
  expect(mocks.cancel).not.toHaveBeenCalled()
})

it('never applies an old account conflict choice to a new workspace', async () => {
  mocks.list.mockImplementationOnce(async () => {
    state.generation += 1
    return [fixture()]
  })
  await expect(new SharedTripRepository().resolve(tripId, fixture(), 'cloud')).rejects.toThrow('帳號已變更')
  expect(mocks.resolve).not.toHaveBeenCalled()
})

it('resolves only against the freshly fetched shared snapshot', async () => {
  const expected = fixture()
  const latest = { ...fixture(), version: '13' }
  mocks.list.mockResolvedValueOnce([latest])
  await new SharedTripRepository().resolve(tripId, expected, 'local')
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(tripId, expected, latest, 'local')
})
