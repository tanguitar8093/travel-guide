import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravelDatabase } from './database'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import { LocalSyncStore } from './local-sync.store'
import { RegionRepository } from './repositories'
import { getSyncDatabaseName, SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'

describe('local sync foundation', () => {
  const opened: TravelDatabase[] = []
  let context: SyncAccountContext
  let database: SyncDatabase
  let store: LocalSyncStore

  beforeEach(async () => {
    context = new SyncAccountContext()
    database = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'member-a' })
    opened.push(database)
    context.activate(database.account)
    store = new LocalSyncStore(database, context)
    await store.prepareLocal()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const storage of opened.splice(0)) await storage.delete()
  })

  function createRegion() {
    return store.mutate('region.create', (repositories) => repositories.regions.create({
      name: 'Kyoto', zoom: 12, googlePlaceId: 'google-kyoto',
    }))
  }

  async function createItinerary() {
    const regionId = await createRegion()
    return store.mutate('itinerary.setup', async (repositories) => {
      const firstPlaceId = await repositories.places.create({
        name: 'First', regionIds: [regionId], labelIds: [], googlePlaceId: 'first',
      })
      const secondPlaceId = await repositories.places.create({
        name: 'Second', regionIds: [regionId], labelIds: [], googlePlaceId: 'second',
      })
      const tripId = await repositories.trips.create({
        name: 'Trip', regionId, startDate: '2026-10-17', endDate: '2026-10-18',
      })
      const firstId = await repositories.itineraryItems.create({
        tripId, placeId: firstPlaceId, date: '2026-10-17', order: 0, travelDurationMinutes: 10, travelDistanceMeters: 650,
      })
      const secondId = await repositories.itineraryItems.create({
        tripId, placeId: secondPlaceId, date: '2026-10-17', order: 1, travelDurationMinutes: 20, travelDistanceMeters: 12300,
      })
      return { regionId, firstPlaceId, secondPlaceId, tripId, firstId, secondId }
    })
  }

  it('prepares metadata without claiming cloud initialization or sync success', async () => {
    const first = await store.prepareLocal()
    const second = await store.prepareLocal()
    expect(first.deviceId).toBe(second.deviceId)
    expect(await store.getSummary()).toEqual({
      initialized: false, status: 'not-initialized', pendingCount: 0,
      failedCount: 0, conflictCount: 0, lastSyncedAt: undefined,
    })
  })

  it('atomically records data, stable IDs and ordered tasks with predecessors', async () => {
    const id = await createRegion()
    await store.mutate('region.update', (repositories) => repositories.regions.update(id, { name: 'Osaka' }))
    const tasks = await store.listTasks()
    expect(tasks).toHaveLength(2)
    expect(tasks[0].sequence).toBeLessThan(tasks[1].sequence!)
    expect(tasks[0].account).toEqual(database.account)
    expect(tasks[0].changes[0]).toMatchObject({ entity: 'regions', id, kind: 'put', after: { id } })
    expect(tasks[1].changes[0]).toMatchObject({
      before: { name: 'Kyoto' }, after: { name: 'Osaka' },
      predecessorOperationId: tasks[0].operationId,
    })
    expect((await store.getSummary()).pendingCount).toBe(2)
  })

  it('rolls back domain changes when writing the outbox fails', async () => {
    vi.spyOn(database.outbox, 'add').mockRejectedValueOnce(new Error('outbox failed'))
    await expect(createRegion()).rejects.toThrow('outbox failed')
    expect(await database.regions.count()).toBe(0)
    expect(await store.listTasks()).toEqual([])
  })

  it('rolls back the complete operation when validation or later work fails', async () => {
    await expect(store.mutate('invalid.references', async (repositories) => {
      await repositories.regions.create({ name: 'Valid', zoom: 10, googlePlaceId: 'valid' })
      await repositories.places.create({ name: 'Invalid', regionIds: ['missing'], labelIds: [], googlePlaceId: 'invalid' })
    })).rejects.toBeInstanceOf(EntityNotFoundError)
    expect(await database.regions.count()).toBe(0)
    expect(await store.listTasks()).toEqual([])
  })

  it('persists data, queue, sequence and device identity after closing and reopening', async () => {
    const id = await createRegion()
    const original = await store.listTasks()
    database.close()
    const reopened = new SyncDatabase(database.account)
    opened.push(reopened)
    const reopenedStore = new LocalSyncStore(reopened, context)
    expect(await reopenedStore.listTasks()).toEqual(original)
    expect((await reopened.regions.get(id))?.name).toBe('Kyoto')
    expect((await reopenedStore.prepareLocal()).deviceId).toBe(original[0].deviceId)
    await reopenedStore.mutate('region.update', (repositories) => repositories.regions.update(id, { zoom: 13 }))
    expect((await reopenedStore.listTasks())[1].sequence).toBeGreaterThan(original[0].sequence!)
  })

  it('isolates accounts, projects and the legacy database', async () => {
    const id = await createRegion()
    const second = new SyncDatabase({ projectId: database.account.projectId, userId: 'member-b' })
    const otherProject = new SyncDatabase({ projectId: 'other-project', userId: database.account.userId })
    const legacy = new TravelDatabase(`legacy-review-${crypto.randomUUID()}`)
    opened.push(second, otherProject, legacy)
    expect(await second.regions.get(id)).toBeUndefined()
    expect(await otherProject.regions.get(id)).toBeUndefined()
    await new RegionRepository(legacy).create({ name: 'Legacy', zoom: 10, googlePlaceId: 'legacy' })
    expect(await legacy.regions.count()).toBe(1)
    expect(await database.regions.count()).toBe(1)
    context.activate(second.account)
    await expect(store.listTasks()).rejects.toBeInstanceOf(ValidationError)
    context.activate(database.account)
    expect(await store.listTasks()).toHaveLength(1)
    expect(getSyncDatabaseName({ projectId: 'a:b', userId: 'c' }))
      .not.toBe(getSyncDatabaseName({ projectId: 'a', userId: 'b:c' }))
    expect(() => new SyncDatabase({ projectId: '', userId: 'member' })).toThrow(ValidationError)
  })

  it('rolls back an in-flight operation after account switching or sign-out', async () => {
    await expect(store.mutate('account.switch', async (repositories) => {
      await repositories.regions.create({ name: 'Hidden', zoom: 10, googlePlaceId: 'hidden' })
      context.deactivate()
    })).rejects.toBeInstanceOf(ValidationError)
    expect(await database.regions.count()).toBe(0)
    context.activate(database.account)
    expect(await store.listTasks()).toEqual([])
    const oldGeneration = context.capture(database.account)
    context.activate(database.account)
    expect(oldGeneration).toThrow(ValidationError)
  })

  it('rejects domain writes that bypass a tracked operation', async () => {
    await expect(new RegionRepository(database).create({
      name: 'Untracked', zoom: 10, googlePlaceId: 'untracked',
    })).rejects.toBeInstanceOf(ValidationError)
    expect(await database.regions.count()).toBe(0)
  })

  it('records place associations and label changes and skips a no-op assignment', async () => {
    const regionId = await createRegion()
    const { labelId, placeId } = await store.mutate('place.setup', async (repositories) => {
      const labelId = await repositories.labels.create({ name: 'Food', color: '#ff0000' })
      const placeId = await repositories.places.create({ name: 'Cafe', regionIds: [regionId], labelIds: [], googlePlaceId: 'cafe' })
      await repositories.places.addLabel(placeId, labelId)
      return { labelId, placeId }
    })
    expect((await store.listTasks())[1].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'labels', id: labelId }),
      expect.objectContaining({ entity: 'places', id: placeId, after: expect.objectContaining({ labelIds: [labelId] }) }),
    ]))
    await store.mutate('label.assign.noop', (repositories) => repositories.places.addLabel(placeId, labelId))
    expect(await store.listTasks()).toHaveLength(2)
    await store.mutate('label.remove', (repositories) => repositories.places.removeLabel(placeId, labelId))
    await store.mutate('label.delete', (repositories) => repositories.labels.delete(labelId))
    expect((await store.listTasks()).at(-1)?.changes[0]).toMatchObject({ entity: 'labels', kind: 'delete' })
  })

  it('records all estimate invalidations caused by a place change', async () => {
    const itinerary = await createItinerary()
    await store.mutate('place.update', (repositories) => repositories.places.update(
      itinerary.firstPlaceId, { googlePlaceId: 'new-first' },
    ))
    const task = (await store.listTasks()).at(-1)!
    expect(task.changes.map((change) => change.id).sort()).toEqual([
      itinerary.firstPlaceId, itinerary.firstId, itinerary.secondId,
    ].sort())
    expect((await database.itineraryItems.get(itinerary.secondId))?.travelDurationMinutes).toBeUndefined()
    expect((await database.itineraryItems.get(itinerary.secondId))?.travelDistanceMeters).toBeUndefined()
    expect(task.changes.find((change) => change.id === itinerary.secondId)?.before)
      .toMatchObject({ travelDurationMinutes: 20, travelDistanceMeters: 12300 })
  })

  it('groups a full-day reorder and preserves referential deletion rules', async () => {
    const itinerary = await createItinerary()
    await store.mutate('itinerary.reorder', (repositories) => repositories.itineraryItems.reorderForDate(
      itinerary.tripId, '2026-10-17', [itinerary.secondId, itinerary.firstId],
    ))
    expect((await store.listTasks()).at(-1)?.changes).toHaveLength(2)
    expect((await database.itineraryItems.get(itinerary.secondId))?.order).toBe(0)
    expect((await database.itineraryItems.get(itinerary.secondId))?.travelDistanceMeters).toBeUndefined()
    expect((await database.itineraryItems.get(itinerary.firstId))?.travelDistanceMeters).toBeUndefined()
    const count = (await store.listTasks()).length
    await expect(store.mutate('place.delete', (repositories) => repositories.places.delete(itinerary.firstPlaceId)))
      .rejects.toBeInstanceOf(EntityInUseError)
    await expect(store.mutate('region.delete', (repositories) => repositories.regions.delete(itinerary.regionId)))
      .rejects.toBeInstanceOf(EntityInUseError)
    expect(await store.listTasks()).toHaveLength(count)
  })

  it('saves distance in the outbox and invalidates it after transport changes or predecessor deletion', async () => {
    const itinerary = await createItinerary()
    await store.mutate('item.estimate', (repositories) => repositories.itineraryItems.update(
      itinerary.secondId, { travelDurationMinutes: 15, travelDistanceMeters: 800 },
    ))
    expect((await store.listTasks()).at(-1)?.changes[0].after)
      .toMatchObject({ travelDurationMinutes: 15, travelDistanceMeters: 800 })
    await store.mutate('item.transport', (repositories) => repositories.itineraryItems.update(
      itinerary.secondId, { transport: 'WALKING' },
    ))
    expect((await database.itineraryItems.get(itinerary.secondId))?.travelDistanceMeters).toBeUndefined()
    await store.mutate('item.estimate', (repositories) => repositories.itineraryItems.update(
      itinerary.secondId, { travelDurationMinutes: 15, travelDistanceMeters: 800 },
    ))
    await store.mutate('item.delete', (repositories) => repositories.itineraryItems.delete(itinerary.firstId))
    expect((await database.itineraryItems.get(itinerary.secondId))?.travelDistanceMeters).toBeUndefined()
  })

  it('records trip deletion together with all cascading item deletions', async () => {
    const itinerary = await createItinerary()
    await store.mutate('trip.delete', (repositories) => repositories.trips.delete(itinerary.tripId))
    const changes = (await store.listTasks()).at(-1)!.changes
    expect(changes.map((change) => change.id).sort()).toEqual([
      itinerary.tripId, itinerary.firstId, itinerary.secondId,
    ].sort())
    expect(changes.every((change) => change.kind === 'delete' && change.before && !change.after)).toBe(true)
    expect(await database.itineraryItems.count()).toBe(0)
  })

  it('records item deletion and its successor estimate invalidation', async () => {
    const itinerary = await createItinerary()
    await store.mutate('item.delete', (repositories) => repositories.itineraryItems.delete(itinerary.firstId))
    expect((await store.listTasks()).at(-1)?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: itinerary.firstId, kind: 'delete' }),
      expect.objectContaining({ id: itinerary.secondId, kind: 'put' }),
    ]))
  })

  it('captures server baseline tokens without treating unknown versions as new records', async () => {
    const id = await createRegion()
    await database.syncBaselines.put({ entity: 'regions', id, version: 'server-version-7' })
    await store.mutate('region.update', (repositories) => repositories.regions.update(id, { zoom: 14 }))
    const tasks = await store.listTasks()
    expect(tasks[0].changes[0].baseVersion).toBeNull()
    expect(tasks[1].changes[0].baseVersion).toBe('server-version-7')
  })

  it('retains the first before-image and the final result for repeated edits in one operation', async () => {
    const id = await createRegion()
    await store.mutate('region.edit.twice', async (repositories) => {
      await repositories.regions.update(id, { name: 'First edit' })
      await repositories.regions.update(id, { name: 'Final edit' })
    })
    const changes = (await store.listTasks())[1].changes
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ before: { name: 'Kyoto' }, after: { name: 'Final edit' } })
    expect(changes[0].baseVersion).toBeUndefined()
  })

  it('serializes concurrent operations without losing queue entries', async () => {
    const ids = await Promise.all([createRegion(), createRegion(), createRegion()])
    const tasks = await store.listTasks()
    expect(await database.regions.count()).toBe(3)
    expect(new Set(tasks.map((task) => task.sequence)).size).toBe(3)
    expect(tasks.map((task) => task.changes[0].id).sort()).toEqual(ids.sort())
  })

  it('does not allow nested operation groups to detach from the outer transaction', async () => {
    await expect(store.mutate('outer', async (repositories) => {
      await repositories.regions.create({ name: 'Outer', zoom: 10, googlePlaceId: 'outer' })
      await createRegion()
    })).rejects.toThrow('cannot be nested')
    expect(await database.regions.count()).toBe(0)
    expect(await store.listTasks()).toEqual([])
  })

  it('preserves label hierarchy validation without leaving partial data or tasks', async () => {
    await expect(store.mutate('label.cycle', async (repositories) => {
      const parentId = await repositories.labels.create({ name: 'Parent', color: '#ff0000' })
      const childId = await repositories.labels.create({ name: 'Child', color: '#00ff00', parentId })
      await repositories.labels.update(parentId, { parentId: childId })
    })).rejects.toBeInstanceOf(ValidationError)
    expect(await database.labels.count()).toBe(0)
    expect(await store.listTasks()).toEqual([])
  })

  it('reports failed and conflicted tasks without treating an empty queue as synced', async () => {
    await createRegion()
    await createRegion()
    const tasks = await store.listTasks()
    await database.outbox.update(tasks[0].sequence!, { status: 'failed', attempts: 1, error: 'Denied' })
    await database.outbox.update(tasks[1].sequence!, { status: 'conflict' })
    expect(await store.getSummary()).toMatchObject({
      initialized: false, status: 'conflict', pendingCount: 0, failedCount: 1, conflictCount: 1,
    })
  })
})
