import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSyncStore } from './local-sync.store'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import { syncHybridManually, type SyncLock } from './sync-engine'
import type { CloudSyncRecord } from './sync-cloud.adapter'
import type { SyncTask } from './sync.types'

describe('manual hybrid sync', () => {
  let database: SyncDatabase
  let context: SyncAccountContext
  let store: LocalSyncStore
  let sequence: number
  let events: CloudSyncRecord[]
  let records: Map<string, CloudSyncRecord>
  let receipts: Map<string, { status: 'applied'; operationId: string; cursor: string; changes: CloudSyncRecord[] }>
  const lock: SyncLock = async (_name, work) => { await work() }
  beforeEach(async () => {
    database = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'member' })
    context = new SyncAccountContext()
    context.activate(database.account)
    store = new LocalSyncStore(database, context)
    await store.prepareLocal()
    sequence = 0
    events = []
    records = new Map()
    receipts = new Map()
  })
  afterEach(async () => { await database.delete() })
  const cloud = () => ({
    snapshot: vi.fn(async () => ({ protocolVersion: 1 as const, cursor: String(sequence), records: [...records.values()].filter((row) => row.record) })),
    pull: vi.fn(async (cursor: string) => ({ protocolVersion: 1 as const, cursor: String(sequence), hasMore: false, changes: events.filter((row) => Number(row.sequence) > Number(cursor)) })),
    push: vi.fn(async (task: SyncTask) => {
      const receipt = receipts.get(task.operationId)
      if (receipt) return receipt
      const conflicts = task.changes.filter((change) => change.baseVersion !== (records.get(change.id)?.version ?? null))
      if (conflicts.length) return { status: 'conflict' as const, conflicts: conflicts.map((change) => ({ entity: change.entity, id: change.id, version: records.get(change.id)?.version ?? null, record: records.get(change.id)?.record ?? null })) }
      const changes = task.changes.map((change) => {
        const row = { entity: change.entity, id: change.id, version: crypto.randomUUID(), record: change.after ?? null, sequence: String(++sequence) }
        records.set(change.id, row)
        events.push(row)
        return row
      })
      const result = { status: 'applied' as const, operationId: task.operationId, cursor: String(sequence), changes }
      receipts.set(task.operationId, result)
      return result
    }),
  })
  const create = () => store.mutate('region.create', (repositories) => repositories.regions.create({ name: 'Kyoto', zoom: 12, googlePlaceId: 'kyoto' }))
  const remoteRegion = () => {
    const id = crypto.randomUUID()
    const row: CloudSyncRecord = { entity: 'regions', id, version: crypto.randomUUID(), record: { id, name: 'Tokyo', zoom: 12, googlePlaceId: 'tokyo' }, sequence: String(++sequence) }
    records.set(id, row)
    events.push(row)
    return row
  }

  it('initializes cloud data, uploads local data and leaves no download-generated tasks', async () => {
    const remote = remoteRegion()
    const id = await create()
    await syncHybridManually(store, cloud(), lock)
    expect(await database.regions.count()).toBe(2)
    expect(await database.regions.get(remote.id)).toEqual(remote.record)
    expect(records.get(id)?.record).toBeDefined()
    expect(await store.listTasks()).toEqual([])
    expect((await store.getSummary()).lastSyncedAt).toBeDefined()
  })

  it('rebases ordered edits and uploads a later deletion', async () => {
    const id = await create()
    await store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Changed' }))
    await syncHybridManually(store, cloud(), lock)
    expect(records.get(id)?.record).toMatchObject({ name: 'Changed' })
    await store.mutate('region.delete', (repositories) => repositories.regions.delete(id))
    await syncHybridManually(store, cloud(), lock)
    expect(records.get(id)?.record).toBeNull()
    expect(await store.listTasks()).toEqual([])
  })

  it('preserves edits made during upload and sends their newer value', async () => {
    const id = await create()
    const adapter = cloud()
    const push = adapter.push.getMockImplementation()!
    adapter.push.mockImplementationOnce(async (task) => {
      await store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Newer' }))
      return push(task)
    })
    await syncHybridManually(store, adapter, lock)
    expect(await database.regions.get(id)).toMatchObject({ name: 'Newer' })
    expect((await store.listTasks()).length).toBe(1)
    await syncHybridManually(store, adapter, lock)
    expect(records.get(id)?.record).toMatchObject({ name: 'Newer' })
  })

  it('retries a lost response with the same payload before pulling its own committed event', async () => {
    await create()
    const adapter = cloud()
    const push = adapter.push.getMockImplementation()!
    adapter.push.mockImplementationOnce(async (task) => { await push(task); throw new Error('lost response') })
    await expect(syncHybridManually(store, adapter, lock)).rejects.toThrow('lost response')
    const first = adapter.push.mock.calls[0][0]
    await syncHybridManually(store, adapter, lock)
    expect(adapter.push.mock.calls[1][0].changes).toEqual(first.changes)
    expect(sequence).toBe(1)
    expect(await store.listTasks()).toEqual([])
  })

  it('stops initialization collisions without overwriting local data', async () => {
    const id = await create()
    records.set(id, { entity: 'regions', id, version: 'remote', record: { id, name: 'Other', zoom: 12, googlePlaceId: 'other' } })
    const adapter = cloud()
    await expect(syncHybridManually(store, adapter, lock)).rejects.toThrow('衝突')
    expect(await database.regions.get(id)).toMatchObject({ name: 'Kyoto' })
    expect((await store.getSummary()).conflictCount).toBe(1)
    expect(adapter.push).not.toHaveBeenCalled()
    expect((await store.getSyncMetadata()).initialized).toBe(false)
  })

  it('downloads later updates and deletions without creating an outbox entry', async () => {
    const row = remoteRegion()
    const adapter = cloud()
    await syncHybridManually(store, adapter, lock)
    const update = { ...row, version: 'updated', record: { ...row.record!, name: 'Updated' }, sequence: String(++sequence) }
    events.push(update)
    await syncHybridManually(store, adapter, lock)
    expect(await database.regions.get(row.id)).toMatchObject({ name: 'Updated' })
    events.push({ ...row, version: 'deleted', record: null, sequence: String(++sequence) })
    await syncHybridManually(store, adapter, lock)
    expect(await database.regions.get(row.id)).toBeUndefined()
    expect(await store.listTasks()).toEqual([])
  })

  it('stops on incoming conflicts and retains both cursor and local edit', async () => {
    const row = remoteRegion()
    const adapter = cloud()
    await syncHybridManually(store, adapter, lock)
    const cursor = (await store.getSyncMetadata()).cursor
    await store.mutate('region.update', (repositories) => repositories.regions.update(row.id, { name: 'Local' }))
    events.push({ ...row, version: 'other', sequence: String(++sequence) })
    await expect(syncHybridManually(store, adapter, lock)).rejects.toThrow('衝突')
    expect(await database.regions.get(row.id)).toMatchObject({ name: 'Local' })
    expect((await store.getSyncMetadata()).cursor).toBe(cursor)
    expect((await store.getSummary()).conflictCount).toBe(1)
  })

  it('rejects stale accounts before applying downloaded data', async () => {
    const adapter = cloud()
    adapter.snapshot.mockImplementation(async () => {
      context.deactivate()
      return { protocolVersion: 1, cursor: '0', records: [remoteRegion()] }
    })
    await expect(syncHybridManually(store, adapter, lock)).rejects.toThrow('account')
    expect(await database.regions.count()).toBe(0)
  })

  it('does not contact the cloud if another tab holds the lock', async () => {
    const adapter = cloud()
    await expect(syncHybridManually(store, adapter, async () => { throw new Error('locked') })).rejects.toThrow('locked')
    expect(adapter.snapshot).not.toHaveBeenCalled()
  })

  it('retains the task when a success response omits its changed records', async () => {
    await create()
    const adapter = cloud()
    adapter.push.mockImplementationOnce(async (task) => ({ status: 'applied', operationId: task.operationId, cursor: '1', changes: [] }))
    await expect(syncHybridManually(store, adapter, lock)).rejects.toThrow('不完整')
    expect((await store.listTasks())[0].status).toBe('failed')
    expect(await database.regions.count()).toBe(1)
  })

  it('rolls back invalid downloaded references without advancing the cursor', async () => {
    await syncHybridManually(store, cloud(), lock)
    const cursor = (await store.getSyncMetadata()).cursor
    const adapter = cloud()
    adapter.pull.mockImplementationOnce(async () => ({ protocolVersion: 1, cursor: '1', hasMore: false, changes: [{ entity: 'places', id: 'place', version: 'v1', record: { id: 'place', name: 'Invalid', googlePlaceId: 'google', regionIds: ['missing'], labelIds: [] }, sequence: '1' }] }))
    await expect(syncHybridManually(store, adapter, lock)).rejects.toThrow('missing region')
    expect((await store.getSyncMetadata()).cursor).toBe(cursor)
    expect(await database.places.count()).toBe(0)
  })
})
