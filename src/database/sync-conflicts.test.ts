import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSyncStore } from './local-sync.store'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import { getSavedConflictReview, prepareConflictReview, resolveConflictReview } from './sync-conflicts'
import { syncHybridManually, type SyncLock } from './sync-engine'
import type { CloudSyncRecord } from './sync-cloud.adapter'

describe('durable conflict resolution', () => {
  let database: SyncDatabase
  let context: SyncAccountContext
  let store: LocalSyncStore
  let remote: CloudSyncRecord
  let events: CloudSyncRecord[]
  let cursor: string
  const lock: SyncLock = async (_name, work) => { await work() }
  beforeEach(async () => {
    database = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'member' })
    context = new SyncAccountContext()
    context.activate(database.account)
    store = new LocalSyncStore(database, context)
    await store.prepareLocal()
    const id = crypto.randomUUID()
    remote = { entity: 'regions', id, version: 'v1', record: { id, name: 'Original', zoom: 12, googlePlaceId: 'google' }, sequence: '1' }
    events = [remote]
    cursor = '1'
    await store.applyRemote([remote], { initialize: true, cursor })
    await store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Local' }))
    remote = { ...remote, version: 'v2', record: { ...remote.record!, name: 'Cloud' }, sequence: '2' }
    cursor = '2'
    events.push(remote)
    expect(await store.applyRemote([remote], { cursor })).toBe(false)
  })
  afterEach(async () => { await database.delete() })
  const cloud = () => ({
    snapshot: vi.fn(async () => ({ protocolVersion: 1 as const, cursor, records: remote.record ? [remote] : [] })),
    pull: vi.fn(async (after: string) => ({ protocolVersion: 1 as const, cursor, hasMore: false, changes: events.filter((row) => Number(row.sequence) > Number(after)) })),
    push: vi.fn(async (task: import('./sync.types').SyncTask) => {
      expect(task.changes[0].baseVersion).toBe(remote.version)
      remote = { ...remote, record: task.changes[0].after ?? null, version: 'uploaded', sequence: String(Number(cursor) + 1) }
      cursor = remote.sequence!
      events.push(remote)
      return { status: 'applied' as const, operationId: task.operationId, cursor, changes: [remote] }
    }),
  })

  it('persists conflict details and the review across reopening', async () => {
    expect((await store.listTasks())[0].conflictRecords?.[0].record).toMatchObject({ name: 'Cloud' })
    const review = await prepareConflictReview(store, cloud(), lock)
    expect(review.rows[0]).toMatchObject({ local: { name: 'Local' }, cloud: { name: 'Cloud' } })
    expect(review.localNames).toContainEqual({ entity: 'regions', id: remote.id, name: 'Local' })
    database.close()
    database = new SyncDatabase(database.account)
    store = new LocalSyncStore(database, context)
    expect((await getSavedConflictReview(store))?.token).toBe(review.token)
    expect((await getSavedConflictReview(store))?.localNames).toEqual(review.localNames)
  })

  it('keeps local final values in a new version-checked operation, without immediate upload', async () => {
    await store.mutate('region.update-again', (repositories) => repositories.regions.update(remote.id, { name: 'Latest Local' }))
    const previous = (await store.listTasks()).map((task) => task.operationId)
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    await resolveConflictReview(store, review.token, 'local', adapter, lock)
    const tasks = await store.listTasks()
    expect(tasks).toHaveLength(1)
    expect(previous).not.toContain(tasks[0].operationId)
    expect(tasks[0].changes[0]).toMatchObject({ baseVersion: 'v2', after: { name: 'Latest Local' } })
    expect(adapter.push).not.toHaveBeenCalled()
    expect(await database.regions.get(remote.id)).toMatchObject({ name: 'Latest Local' })
    await syncHybridManually(store, adapter, lock)
    expect(await store.listTasks()).toHaveLength(0)
    expect(remote.record).toMatchObject({ name: 'Latest Local' })
  })

  it('adopts cloud and explicitly discards the entire pending batch', async () => {
    await store.mutate('region.create', (repositories) => repositories.regions.create({ name: 'Also pending', zoom: 12, googlePlaceId: 'other' }))
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    expect(review.pendingOperations).toBe(2)
    await resolveConflictReview(store, review.token, 'cloud', adapter, lock)
    expect(await database.regions.count()).toBe(1)
    expect(await database.regions.get(remote.id)).toMatchObject({ name: 'Cloud' })
    expect(await store.listTasks()).toHaveLength(0)
    expect(await getSavedConflictReview(store)).toBeUndefined()
    expect(adapter.push).not.toHaveBeenCalled()
  })

  it('rejects stale local reviews and retains the queue', async () => {
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    await store.mutate('region.update', (repositories) => repositories.regions.update(remote.id, { name: 'New edit' }))
    await expect(resolveConflictReview(store, review.token, 'cloud', adapter, lock)).rejects.toThrow('本機')
    expect(await store.listTasks()).toHaveLength(2)
    expect(await database.regions.get(remote.id)).toMatchObject({ name: 'New edit' })
  })

  it('rejects cloud changes after preview without modifying local data', async () => {
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    remote = { ...remote, version: 'v3', record: { ...remote.record!, name: 'Cloud newer' } }
    await expect(resolveConflictReview(store, review.token, 'local', adapter, lock)).rejects.toThrow('雲端資料已改變')
    expect((await store.listTasks())[0].status).toBe('conflict')
  })

  it('uses the cloud tombstone version when retaining a locally edited deleted record', async () => {
    remote = { ...remote, version: 'deleted', record: null, sequence: '3' }
    cursor = '3'
    events.push(remote)
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    expect(review.rows[0].cloud).toBeNull()
    await resolveConflictReview(store, review.token, 'local', adapter, lock)
    expect((await store.listTasks())[0].changes[0].baseVersion).toBe('deleted')
    await syncHybridManually(store, adapter, lock)
    expect(remote.record).toMatchObject({ name: 'Local' })
  })

  it('refuses to discard an operation whose upload outcome is uncertain', async () => {
    await store.mutate('region.create', (repositories) => repositories.regions.create({ name: 'Uncertain', zoom: 12, googlePlaceId: 'other' }))
    const task = (await store.listTasks())[1]
    await database.outbox.update(task.sequence!, { status: 'failed', uploadChanges: task.changes })
    await expect(prepareConflictReview(store, cloud(), lock)).rejects.toThrow('未確認')
    expect(await store.listTasks()).toHaveLength(2)
  })

  it('rolls back a local choice that would introduce dangling references', async () => {
    await store.mutate('place.create', (repositories) => repositories.places.create({ name: 'Dependent', googlePlaceId: 'place', regionIds: [remote.id], labelIds: [] }))
    await store.mutate('region.other', (repositories) => repositories.regions.create({ name: 'Other', zoom: 12, googlePlaceId: 'other' }))
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    review.rows = review.rows.map((row) => row.entity === 'regions' && row.id === remote.id ? { ...row, local: null } : row)
    await database.syncConflicts.put(review)
    const before = await store.inspectSyncState()
    await expect(resolveConflictReview(store, review.token, 'local', adapter, lock)).rejects.toThrow(`使用的地圖「${remote.id}」不存在`)
    expect(await store.inspectSyncState()).toEqual(before)
  })

  it('rejects switching accounts during resolution', async () => {
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    adapter.snapshot.mockImplementationOnce(async () => {
      context.deactivate()
      return { protocolVersion: 1, cursor, records: [remote] }
    })
    await expect(resolveConflictReview(store, review.token, 'cloud', adapter, lock)).rejects.toThrow('帳號')
    expect(await database.outbox.count()).toBe(1)
  })

  it('preserves everything on a storage failure during resolution', async () => {
    const adapter = cloud()
    const review = await prepareConflictReview(store, adapter, lock)
    const before = await store.inspectSyncState()
    const spy = vi.spyOn(database.syncBaselines, 'clear').mockRejectedValueOnce(new Error('disk full'))
    await expect(resolveConflictReview(store, review.token, 'cloud', adapter, lock)).rejects.toThrow('disk full')
    spy.mockRestore()
    expect(await store.inspectSyncState()).toEqual(before)
    expect((await getSavedConflictReview(store))?.token).toBe(review.token)
  })

  it('rejects local changes made while fetching the review', async () => {
    const adapter = cloud()
    adapter.snapshot.mockImplementationOnce(async () => {
      await store.mutate('region.update', (repositories) => repositories.regions.update(remote.id, { name: 'New during request' }))
      return { protocolVersion: 1, cursor, records: [remote] }
    })
    await expect(prepareConflictReview(store, adapter, lock)).rejects.toThrow('本機資料已改變')
    expect(await getSavedConflictReview(store)).toBeUndefined()
  })
})
