import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TravelDatabase } from './database'
import { RouteMapRepository, RouteMapPlaceRepository } from './route-map.repository'
import { RegionRepository, TripRepository } from './repositories'
import { SyncDatabase } from './sync.database'
import { SyncAccountContext } from './sync-account-context'
import { LocalSyncStore } from './local-sync.store'
import { backupRepository } from './backup.repository'

let db: TravelDatabase
let maps: RouteMapRepository
let markers: RouteMapPlaceRepository

beforeEach(() => {
  db = new TravelDatabase(`route-test-${crypto.randomUUID()}`)
  maps = new RouteMapRepository(db)
  markers = new RouteMapPlaceRepository(db)
})
afterEach(async () => { vi.restoreAllMocks(); await db.delete() })

async function setupTrip() {
  const regionId = await new RegionRepository(db).create({ name: 'City', googlePlaceId: 'city', zoom: 12 })
  const tripId = await new TripRepository(db).create({ regionId, name: 'Trip', startDate: '2026-10-19', endDate: '2026-10-20' })
  return { regionId, tripId }
}

it('persists a related map and independent added locations across reopening', async () => {
  const { tripId } = await setupTrip()
  const id = await maps.create({ name: 'Map', tripId, transport: 'WALKING' })
  const marker = await markers.create({ routeMapId: id, googlePlaceId: 'new-location' })
  db.close()
  db = new TravelDatabase(db.name)
  expect(await new RouteMapRepository(db).findByTripId(tripId)).toMatchObject({ id, tripId })
  expect(await new RouteMapPlaceRepository(db).findByRouteMapId(id)).toEqual([{ id: marker, routeMapId: id, googlePlaceId: 'new-location' }])
  expect(await db.places.count()).toBe(0)
})

it('rejects invalid references, duplicate trip maps and duplicate marker IDs', async () => {
  await expect(maps.create({ name: 'Bad', tripId: 'missing', transport: 'WALKING' })).rejects.toThrow()
  const { tripId } = await setupTrip()
  const id = await maps.create({ name: 'Map', tripId, transport: 'WALKING' })
  await expect(maps.create({ name: 'Duplicate', tripId, transport: 'DRIVING' })).rejects.toThrow('already')
  await expect(markers.create({ routeMapId: 'missing', googlePlaceId: 'p' })).rejects.toThrow()
  await markers.create({ routeMapId: id, googlePlaceId: 'p' })
  await expect(markers.create({ routeMapId: id, googlePlaceId: 'p' })).rejects.toThrow('already')
})

it('cascades trip deletion only to its maps and markers, preserving unrelated data', async () => {
  const { tripId, regionId } = await setupTrip()
  const id = await maps.create({ name: 'Map', tripId, transport: 'WALKING' })
  const standalone = await maps.create({ name: 'Standalone', transport: 'TRANSIT' })
  await markers.create({ routeMapId: id, googlePlaceId: 'p' })
  await markers.create({ routeMapId: standalone, googlePlaceId: 'q' })
  await new TripRepository(db).delete(tripId)
  expect(await maps.getById(id)).toBeUndefined()
  expect(await markers.findByRouteMapId(id)).toEqual([])
  expect(await maps.getById(standalone)).toBeDefined()
  expect(await markers.findByRouteMapId(standalone)).toHaveLength(1)
  expect(await db.regions.get(regionId)).toBeDefined()
})

it('deleting a map never deletes the associated trip', async () => {
  const { tripId } = await setupTrip()
  const id = await maps.create({ name: 'Map', tripId, transport: 'WALKING' })
  await maps.delete(id)
  expect(await db.trips.get(tripId)).toBeDefined()
})

it('atomically queues route writes and all trip cascade deletions in hybrid mode', async () => {
  const sync = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'owner' })
  const context = new SyncAccountContext()
  context.activate(sync.account)
  const store = new LocalSyncStore(sync, context)
  try {
    await store.prepareLocal()
    const ids = await store.mutate('route.setup', async (repo) => {
      const regionId = await repo.regions.create({ name: 'City', googlePlaceId: 'city', zoom: 12 })
      const tripId = await repo.trips.create({ regionId, name: 'Trip', startDate: '2026-10-19', endDate: '2026-10-20' })
      const mapId = await repo.routeMaps.create({ name: 'Map', tripId, transport: 'WALKING' })
      const markerId = await repo.routeMapPlaces.create({ routeMapId: mapId, googlePlaceId: 'p' })
      return { tripId, mapId, markerId }
    })
    expect((await store.listTasks())[0].changes.map((row) => row.entity)).toEqual(['regions', 'trips', 'routeMaps', 'routeMapPlaces'])
    await store.mutate('trip.delete', (repo) => repo.trips.delete(ids.tripId))
    const changes = (await store.listTasks())[1].changes
    expect(changes).toHaveLength(3)
    expect(changes.every((change) => change.kind === 'delete')).toBe(true)
    expect(await sync.routeMaps.count()).toBe(0)
    vi.spyOn(sync.outbox, 'add').mockRejectedValueOnce(new Error('outbox failed'))
    await expect(store.mutate('route.create', (repo) => repo.routeMaps.create({ name: 'Rollback', transport: 'WALKING' }))).rejects.toThrow('outbox failed')
    expect(await sync.routeMaps.count()).toBe(0)
  } finally { await sync.delete() }
})

it('upgrades existing standalone version 4 without changing original records', async () => {
  await db.delete()
  const name = `route-upgrade-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(4).stores({ regions: '&id, name', places: '&id, name, *regionIds, *labelIds, googlePlaceId', labels: '&id, name, parentId', trips: '&id, regionId, startDate, endDate', itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]' })
  await old.table('regions').add({ id: 'old', name: 'Preserved', zoom: 12, googlePlaceId: 'old' })
  old.close()
  db = new TravelDatabase(name)
  expect(await db.regions.get('old')).toMatchObject({ name: 'Preserved' })
  expect(await db.routeMaps.count()).toBe(0)
})

it('downloads map snapshots and deletions atomically without creating upload tasks', async () => {
  const sync = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'download-owner' })
  const context = new SyncAccountContext()
  context.activate(sync.account)
  const store = new LocalSyncStore(sync, context)
  try {
    await store.prepareLocal()
    expect(await store.applyRemote([
      { entity: 'routeMaps', id: 'map', version: 'v1', record: { id: 'map', name: 'Map', transport: 'WALKING' } },
      { entity: 'routeMapPlaces', id: 'p', version: 'v2', record: { id: 'p', routeMapId: 'map', googlePlaceId: 'google' } },
    ], { initialize: true, cursor: '2' })).toBe(true)
    expect(await sync.routeMapPlaces.count()).toBe(1)
    expect(await store.listTasks()).toEqual([])
    await store.applyRemote([
      { entity: 'routeMapPlaces', id: 'p', version: 'v3', record: null, sequence: '3' },
      { entity: 'routeMaps', id: 'map', version: 'v4', record: null, sequence: '4' },
    ], { cursor: '4' })
    expect(await sync.routeMaps.count()).toBe(0)
    expect(await sync.routeMapPlaces.count()).toBe(0)
    expect(await store.listTasks()).toEqual([])
  } finally { await sync.delete() }
})

it('upgrades a hybrid version 6 database while retaining pending operations and metadata', async () => {
  const account = { projectId: crypto.randomUUID(), userId: 'upgrade-owner' }
  const current = new SyncDatabase(account)
  const old = new Dexie(current.name)
  old.version(6).stores({
    regions: '&id, name', places: '&id, name, *regionIds, *labelIds, googlePlaceId',
    labels: '&id, name, parentId', trips: '&id, regionId, startDate, endDate',
    itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
    outbox: '++sequence, &operationId, status', syncMetadata: '&id',
    syncBaselines: '[entity+id]', syncConflicts: '&id',
  })
  await old.table('outbox').add({ operationId: 'keep', status: 'pending' })
  await old.table('syncMetadata').add({ id: 'workspace', account, deviceId: 'keep', initialized: false })
  old.close()
  try {
    expect(await current.routeMaps.count()).toBe(0)
    expect((await current.outbox.toArray())[0].operationId).toBe('keep')
    expect((await current.syncMetadata.get('workspace'))?.deviceId).toBe('keep')
  } finally { await current.delete() }
})

const empty = { regions: [], places: [], labels: [], trips: [], itineraryItems: [] }

it('normalizes old backups and validates the new graph before accepting v2', () => {
  expect(backupRepository.validateImport({ format: 'travel-planner-backup', version: 1, exportedAt: new Date().toISOString(), data: empty }).data.routeMaps).toEqual([])
  const value = {
    format: 'travel-planner-backup', version: 2, exportedAt: new Date().toISOString(),
    data: { ...empty, routeMaps: [{ id: 'map', name: 'Map', transport: 'WALKING' }], routeMapPlaces: [{ id: 'p', routeMapId: 'map', googlePlaceId: 'g' }] },
  }
  expect(backupRepository.validateImport(value).data.routeMapPlaces).toHaveLength(1)
  expect(() => backupRepository.validateImport({ ...value, data: { ...value.data, routeMaps: [] } })).toThrow('missing map')
  expect(() => backupRepository.validateImport({ ...value, data: { ...value.data, routeMapPlaces: [{ ...value.data.routeMapPlaces[0], latitude: 25 }] } })).toThrow('unsupported')
})
