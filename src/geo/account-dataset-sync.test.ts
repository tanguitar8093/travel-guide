import { expect, it, vi } from 'vitest'
import { AccountDatasetSync, readPendingDataset, type DatasetSyncStore } from './account-dataset-sync'
import type { OsmDatasetId } from './osm-datasets'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function device(cloud: { dataset?: OsmDatasetId }, cached: OsmDatasetId = 'okinawa') {
  let pending: ReturnType<DatasetSyncStore['get']>
  const store: DatasetSyncStore = { get: () => pending, set: value => { pending = value } }
  const options = {
    store,
    read: vi.fn(async () => cloud.dataset),
    write: vi.fn(async (dataset: OsmDatasetId) => { cloud.dataset = dataset }),
    apply: vi.fn((dataset: OsmDatasetId) => { cached = dataset }),
    report: vi.fn(),
  }
  return { sync: new AccountDatasetSync(options), options, cached: () => cached }
}

it('converges two independent devices in both directions without uploading stale caches', async () => {
  const cloud = { dataset: 'okinawa' as OsmDatasetId }
  const phone = device(cloud, 'okinawa'), desktop = device(cloud, 'taiwan')
  await desktop.sync.refresh()
  expect(desktop.cached()).toBe('okinawa')
  expect(desktop.options.write).not.toHaveBeenCalled()
  await phone.sync.select('taiwan')
  await desktop.sync.refresh()
  expect(desktop.cached()).toBe('taiwan')
  await desktop.sync.select('okinawa')
  await phone.sync.refresh()
  expect(phone.cached()).toBe('okinawa')
})

it('does not import an old browser choice when an account has no cloud preference yet', async () => {
  const desktop = device({}, 'taiwan')
  await desktop.sync.refresh()
  expect(desktop.cached()).toBe('okinawa')
  expect(desktop.options.write).not.toHaveBeenCalled()
})

it('retains failed explicit changes for retry after a reload, without accepting old cloud values', async () => {
  const cloud = { dataset: 'okinawa' as OsmDatasetId }
  const phone = device(cloud, 'taiwan')
  phone.options.write.mockRejectedValueOnce(new Error('offline'))
  await phone.sync.select('taiwan')
  expect(phone.options.store.get()?.dataset).toBe('taiwan')
  expect(phone.options.report).toHaveBeenLastCalledWith('offline')
  phone.sync.stop()
  const reloaded = new AccountDatasetSync(phone.options)
  await reloaded.refresh()
  expect(cloud.dataset).toBe('taiwan')
  expect(phone.options.store.get()).toBeUndefined()
})

it('ignores an old in-flight read when the user selects a new region', async () => {
  const phone = device({ dataset: 'okinawa' })
  const old = deferred<OsmDatasetId>()
  phone.options.read.mockReturnValueOnce(old.promise)
  const reading = phone.sync.refresh()
  const writing = phone.sync.select('taiwan')
  old.resolve('okinawa')
  await Promise.all([reading, writing])
  expect(phone.options.apply.mock.calls.map(([dataset]) => dataset)).toEqual(['taiwan'])
})

it('serializes rapid selections and keeps the newest explicit selection', async () => {
  const cloud = { dataset: 'okinawa' as OsmDatasetId }
  const phone = device(cloud)
  const first = deferred<void>()
  phone.options.write.mockImplementationOnce(async dataset => { await first.promise; cloud.dataset = dataset })
  const writing = phone.sync.select('taiwan')
  void phone.sync.select('okinawa')
  first.resolve()
  await writing
  expect(cloud.dataset).toBe('okinawa')
  expect(phone.options.apply.mock.calls.map(([dataset]) => dataset)).toEqual(['okinawa'])
})

it('never applies a delayed old-account response after logout/account switch', async () => {
  const phone = device({})
  const old = deferred<OsmDatasetId>()
  phone.options.read.mockReturnValueOnce(old.promise)
  const reading = phone.sync.refresh()
  phone.sync.stop()
  old.resolve('taiwan')
  await reading
  expect(phone.options.apply).not.toHaveBeenCalled()
  expect(phone.options.report).not.toHaveBeenCalled()
})

it('does not upload invalid persisted queue data', () => {
  for (const raw of ['invalid', '{"id":"x","dataset":"other"}', '{"dataset":"taiwan"}']) {
    expect(readPendingDataset({ getItem: () => raw }, 'key')).toBeUndefined()
  }
})
