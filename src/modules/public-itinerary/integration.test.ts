import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it } from 'vitest'
import { TravelDatabase } from '../../database/database'
import { SyncDatabase } from '../../database/sync.database'
import { LocalSyncStore } from '../../database/local-sync.store'
import { SyncAccountContext } from '../../database/sync-account-context'
import { TripRepository, PlaceRepository, RegionRepository } from '../../database/repositories'
import { LabelRepository } from '../../database/label.repository'
import { createPublicItineraryCore } from './core'
import { SnapshotItineraryService } from './snapshot.service'

const opened: Dexie[] = []
afterEach(async () => { for (const db of opened.splice(0)) await db.delete() })
async function setup(db: TravelDatabase) {
  await db.regions.add({ id: 'region', name: '京都', zoom: 12, center: { latitude: 35, longitude: 135 } })
  await db.labels.add({ id: 'private-label', name: '私人', color: '#000000' })
  await db.places.add({ id: 'place', name: '清水寺', regionIds: ['region'], labelIds: ['private-label'], notes: '私人備註', mapsUrl: 'https://maps.google.com/' })
  await db.trips.add({ id: 'source', name: '京都旅行', regionId: 'region', startDate: '2026-11-01', endDate: '2026-11-02' })
  await db.itineraryItems.add({ id: 'item', tripId: 'source', placeId: 'place', date: '2026-11-01', order: 0, note: '行程備註' })
}
it('upgrades a populated version 7 database without seeding or losing personal and route data', async () => {
  const name = `sharing-upgrade-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(7).stores({
    regions: '&id, name', places: '&id, name, *regionIds, *labelIds, googlePlaceId', labels: '&id, name, parentId',
    trips: '&id, regionId, startDate, endDate', itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
    routeMaps: '&id, &tripId', routeMapPlaces: '&id, routeMapId, &[routeMapId+googlePlaceId]',
  })
  opened.push(old)
  await old.table('regions').add({ id: 'existing', name: '台北', zoom: 12 })
  await old.table('routeMaps').add({ id: 'map', name: '既有路線', transport: 'WALKING' })
  old.close()
  const db = new TravelDatabase(name)
  opened.push(db)
  expect(await db.regions.get('existing')).toMatchObject({ name: '台北' })
  expect(await db.routeMaps.get('map')).toMatchObject({ name: '既有路線' })
  expect(await db.publicItineraries.count()).toBe(0)
  expect(db.verno).toBe(10)
})
it('uses production stores and repositories for publish, apply, editing, deletion, withdrawal and reopening', async () => {
  const db = new TravelDatabase(`sharing-integrated-${crypto.randomUUID()}`)
  opened.push(db)
  await setup(db)
  const core = createPublicItineraryCore(db)
  const published = await core.publish('source')
  const copy = await core.apply(published.id)
  expect(await new RegionRepository(db).getById(copy.regionId)).toMatchObject({ name: '京都(分享)' })
  const places = await new PlaceRepository(db).findByRegionId(copy.regionId)
  expect(places).toHaveLength(1)
  const label = await new LabelRepository(db).getById(places[0].labelIds[0])
  expect(label!.name).toBe('京都旅行(分享)')
  await new TripRepository(db).update(copy.id, { name: '自行修改副本' })
  expect((await core.readSnapshot(published.id)).trip.name).toBe('京都旅行')
  await new TripRepository(db).delete('source')
  await expect(core.update(published.id, 'source')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
  db.close()
  const reopened = new TravelDatabase(db.name)
  opened.push(reopened)
  const reopenedCore = createPublicItineraryCore(reopened)
  expect(await reopenedCore.list()).toEqual([published])
  await reopenedCore.withdraw(published.id, 'source')
  expect(await reopenedCore.list()).toEqual([])
  expect(await reopened.trips.get(copy.id)).toMatchObject({ name: '自行修改副本' })
})
it('tracks one complete local-workspace application and keeps public snapshots out of personal sync tasks', async () => {
  const context = new SyncAccountContext()
  const db = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'member' })
  opened.push(db)
  context.activate(db.account)
  const store = new LocalSyncStore(db, context)
  await store.prepareLocal()
  await store.mutateDatabase('setup', async db => { await setup(db) })
  const published = await store.mutateDatabase('publish', db => createPublicItineraryCore(db).publish('source'))
  expect(await store.listTasks()).toHaveLength(1)
  const copy = await store.mutateDatabase('apply', db => createPublicItineraryCore(db).apply(published.id))
  const tasks = await store.listTasks()
  expect(tasks).toHaveLength(2)
  expect(tasks[1].changes.map(change => change.entity).sort()).toEqual(['itineraryItems','labels','places','regions','trips'])
  expect(await store.readDatabase(db => db.trips.get(copy.id))).toEqual(copy)
  expect(await store.readDatabase(db => createPublicItineraryCore(db).list())).toEqual([published])
  const before = await Promise.all(db.tables.map(table => table.toArray()))
  const fail = () => { throw new Error('late write failure') }
  db.itineraryItems.hook('creating', fail)
  try {
    await expect(store.mutateDatabase('failed-apply', db => createPublicItineraryCore(db).apply(published.id))).rejects.toThrow('late write failure')
    expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before)
  } finally { db.itineraryItems.hook('creating').unsubscribe(fail) }
  context.deactivate()
  await expect(store.readDatabase(db => createPublicItineraryCore(db).list())).rejects.toThrow()
})
it('previews from a snapshot only and rejects all editing entry points', async () => {
  const db = new TravelDatabase(`sharing-preview-${crypto.randomUUID()}`)
  opened.push(db)
  await setup(db)
  const core = createPublicItineraryCore(db)
  const row = await core.publish('source')
  const service = new SnapshotItineraryService(row.snapshot)
  await new TripRepository(db).delete('source')
  const workspace = await service.loadWorkspace()
  expect(workspace.trips).toEqual([row.snapshot.trip])
  expect(workspace.places[0]).not.toHaveProperty('notes')
  expect(workspace.places[0].labelIds).toEqual([])
  expect(await service.listItems()).toEqual(row.snapshot.items)
  expect(service.getAccess()).toBe('viewer')
  for (const operation of [() => service.createTrip(), () => service.updateTrip(), () => service.deleteTrip(),
    () => service.addItem(), () => service.updateItem(), () => service.deleteItem(), () => service.reorderItems()]) {
    await expect(operation()).rejects.toThrow('唯讀')
  }
})
