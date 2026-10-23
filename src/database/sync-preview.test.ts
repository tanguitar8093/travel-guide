import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalSyncStore } from './local-sync.store'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import { previewHybridSync } from './sync-preview'
import type { CloudSyncSnapshot } from './sync-cloud.adapter'

describe('read-only hybrid preview', () => {
  let database: SyncDatabase
  let context: SyncAccountContext
  let store: LocalSyncStore
  beforeEach(async () => {
    database = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'member' })
    context = new SyncAccountContext()
    context.activate(database.account)
    store = new LocalSyncStore(database, context)
    await store.prepareLocal()
  })
  afterEach(async () => { await database.delete() })
  const snapshot = (records: CloudSyncSnapshot['records'] = []): CloudSyncSnapshot => ({ protocolVersion: 1, cursor: '0', records })
  const create = () => store.mutate('region.create', (repositories) => repositories.regions.create({ name: 'Kyoto', zoom: 12, googlePlaceId: 'kyoto' }))

  it('shows independent cloud/local records without changing data, queue or metadata', async () => {
    const id = await create()
    const before = await store.inspectSyncState()
    const summary = await store.getSummary()
    const result = await previewHybridSync(store, { snapshot: async () => snapshot([{ entity: 'regions', id: 'cloud', version: 'v1', record: { id: 'cloud', name: 'Tokyo', zoom: 12, googlePlaceId: 'tokyo' } }]) })
    expect(result.pendingOperations).toBe(1)
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, difference: 'local-only', pending: true, conflict: false }),
      expect.objectContaining({ id: 'cloud', difference: 'cloud-only', pending: false }),
    ]))
    expect(await store.inspectSyncState()).toEqual(before)
    expect(await store.getSummary()).toEqual(summary)
  })

  it('flags same-ID creation collisions even when the content matches', async () => {
    const id = await create()
    const record = await database.regions.get(id)
    const result = await previewHybridSync(store, { snapshot: async () => snapshot([{ entity: 'regions', id, version: 'v1', record: record! }]) })
    expect(result.rows[0]).toMatchObject({ difference: 'same', conflict: true })
  })

  it('rejects account changes during the network request', async () => {
    await expect(previewHybridSync(store, { snapshot: async () => {
      context.deactivate()
      return snapshot()
    } })).rejects.toThrow()
  })

  it('rejects local changes during preview and preserves those edits', async () => {
    await expect(previewHybridSync(store, { snapshot: async () => {
      await create()
      return snapshot()
    } })).rejects.toThrow('重新比對')
    expect(await database.outbox.count()).toBe(1)
  })

  it('rejects invalid cloud references without applying anything', async () => {
    await expect(previewHybridSync(store, { snapshot: async () => snapshot([
      { entity: 'places', id: 'place', version: 'v1', record: { id: 'place', name: 'Place', googlePlaceId: 'google', regionIds: ['missing'], labelIds: [] } },
    ]) })).rejects.toThrow('使用的區域「missing」不存在')
    expect(await database.places.count()).toBe(0)
    expect(await database.outbox.count()).toBe(0)
  })

  it('preserves local data after a network failure', async () => {
    await create()
    const before = await store.inspectSyncState()
    await expect(previewHybridSync(store, { snapshot: async () => { throw new Error('offline') } })).rejects.toThrow('offline')
    expect(await store.inspectSyncState()).toEqual(before)
  })
})
