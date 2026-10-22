import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravelDatabase } from '../../src/database/database'
import { EntityInUseError, EntityNotFoundError, ValidationError } from '../../src/database/errors'
import { BackupRepository } from '../../src/database/backup.repository'
import { ItineraryItemRepository, PlaceRepository, RegionRepository, TripRepository } from '../../src/database/repositories'
import { RouteMapPlaceRepository, RouteMapRepository } from '../../src/database/route-map.repository'
import { LocalSyncStore } from '../../src/database/local-sync.store'
import { SyncAccountContext } from '../../src/database/sync-account-context'
import { SyncDatabase } from '../../src/database/sync.database'
import type { NewPlace } from '../../src/database/models'
import type { StoredLocation } from '../../src/geo/contracts'

const osmLocation = {
  source: 'osm', kind: 'point',
  coordinate: { latitude: 26.2147, longitude: 127.6868 },
  reference: { provider: 'osm', id: 'node/123' },
  datasetVersion: 'fixture-2026-10-23',
} as const satisfies StoredLocation

// Extra properties describe the proposed format without changing production models.
function placeInput(regionId: string, location: unknown = osmLocation): NewPlace & { location: unknown } {
  return { name: 'User-named place', regionIds: [regionId], labelIds: [], location }
}

const storages: Dexie[] = []
let db: TravelDatabase
let places: PlaceRepository
let regionId: string

beforeEach(async () => {
  db = new TravelDatabase(`geo-contract-${crypto.randomUUID()}`)
  storages.push(db)
  places = new PlaceRepository(db)
  regionId = await new RegionRepository(db).create({ name: 'Region', googlePlaceId: 'google-region', zoom: 12 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in IndexedDB tests') }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const storage of storages.splice(0)) await storage.delete()
})

async function itinerary(placeId: string) {
  const tripId = await new TripRepository(db).create({
    regionId, name: 'Trip', startDate: '2026-10-23', endDate: '2026-10-24',
  })
  const items = new ItineraryItemRepository(db)
  const ids: string[] = []
  for (let order = 0; order < 4; order += 1) {
    const id = order === 1 ? placeId : await places.create({
      name: `Stop ${order}`, googlePlaceId: `google-${order}`, regionIds: [regionId], labelIds: [],
    })
    ids.push(await items.create({
      tripId, placeId: id, date: '2026-10-23', order,
      arrivalTime: '10:00', travelDurationMinutes: 10 + order, travelDistanceMeters: 100 + order,
    }))
  }
  return ids
}

describe('Google compatibility gates', () => {
  it('keeps Google-only records unchanged after edits and reopening, without inventing coordinates', async () => {
    const id = await places.create({
      name: 'My Google place', googlePlaceId: 'google-place', regionIds: [regionId], labelIds: [],
      notes: 'Original note',
    })
    await places.update(id, { notes: 'Edited note' })
    const before = await places.getById(id)
    db.close()
    const reopened = new TravelDatabase(db.name)
    storages.push(reopened)
    expect(await new PlaceRepository(reopened).getById(id)).toEqual(before)
    expect(before).toEqual({
      id, name: 'My Google place', googlePlaceId: 'google-place', regionIds: [regionId], labelIds: [],
      notes: 'Edited note',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('continues accepting URL-only places and legacy manually centered regions', async () => {
    const url = 'https://www.google.com/maps/search/?api=1&query=26,127'
    const id = await places.create({ name: 'URL-only', mapsUrl: url, regionIds: [regionId], labelIds: [] })
    expect(await places.getById(id)).toEqual({
      id, name: 'URL-only', mapsUrl: url, regionIds: [regionId], labelIds: [],
    })
    const input = { name: 'Manual region', center: { latitude: 26, longitude: 127 }, zoom: 12 }
    const manualId = await new RegionRepository(db).create(input)
    expect(await db.regions.get(manualId)).toEqual({ id: manualId, ...input })
  })

  it('preserves Google route endpoints, duplicate protection and map-only deletion', async () => {
    const maps = new RouteMapRepository(db)
    const markers = new RouteMapPlaceRepository(db)
    const mapId = await maps.create({
      name: 'Map', transport: 'TRANSIT', originGooglePlaceId: 'origin', destinationGooglePlaceId: 'destination',
    })
    await markers.create({ routeMapId: mapId, googlePlaceId: 'extra' })
    await expect(markers.create({ routeMapId: mapId, googlePlaceId: 'extra' })).rejects.toBeInstanceOf(ValidationError)
    expect(await maps.getById(mapId)).toEqual({
      id: mapId, name: 'Map', transport: 'TRANSIT', originGooglePlaceId: 'origin', destinationGooglePlaceId: 'destination',
    })
    await maps.delete(mapId)
    expect(await markers.findByRouteMapId(mapId)).toEqual([])
    expect(await db.regions.get(regionId)).toBeDefined()
  })

  it('retains estimates on name edits, and clears exactly the incoming and successor legs on Google ID changes', async () => {
    const id = await places.create({ name: 'Google', googlePlaceId: 'old', regionIds: [regionId], labelIds: [] })
    const ids = await itinerary(id)
    const before = await db.itineraryItems.bulkGet(ids)
    await places.update(id, { name: 'Renamed' })
    expect(await db.itineraryItems.bulkGet(ids)).toEqual(before)
    await places.update(id, { googlePlaceId: 'new' })
    const after = await db.itineraryItems.bulkGet(ids)
    for (const index of [1, 2]) {
      expect(after[index]).toMatchObject({ id: ids[index], arrivalTime: '10:00' })
      expect(after[index]?.travelDurationMinutes).toBeUndefined()
      expect(after[index]?.travelDistanceMeters).toBeUndefined()
    }
    for (const index of [0, 3]) expect(after[index]).toEqual(before[index])
  })

  it.each([1, 2])('continues reading Google backups version %s without manufacturing location data', version => {
    const backup = new BackupRepository().validateImport({
      format: 'travel-planner-backup', version, exportedAt: '2026-10-23T00:00:00.000Z',
      data: {
        regions: [{ id: regionId, name: 'Region', googlePlaceId: 'region', zoom: 12 }],
        places: [{ id: 'place', name: 'Google', googlePlaceId: 'google', regionIds: [regionId], labelIds: [] }],
        labels: [], trips: [], itineraryItems: [],
        ...(version === 2 ? { routeMaps: [], routeMapPlaces: [] } : {}),
      },
    })
    expect(backup.data.places[0]).toEqual({
      id: 'place', name: 'Google', googlePlaceId: 'google', regionIds: [regionId], labelIds: [],
    })
  })
})

describe('OSM proposed behavior: expected red until phase 3 is implemented', () => {
  it('creates a location-only place without a fabricated Google ID or URL and survives reopening', async () => {
    const input = placeInput(regionId)
    const id = await places.create(input)
    db.close()
    const reopened = new TravelDatabase(db.name)
    storages.push(reopened)
    expect(await new PlaceRepository(reopened).getById(id)).toEqual({ id, ...input })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts independent user coordinates including zero and out-of-Okinawa positions', async () => {
    for (const coordinate of [{ latitude: 0, longitude: 0 }, { latitude: 48.8, longitude: 2.3 }]) {
      const input = placeInput(regionId, { source: 'user', kind: 'user-picked', coordinate })
      const id = await places.create(input)
      expect(await places.getById(id)).toEqual({ id, ...input })
    }
  })

  it.each([
    ['NaN', { ...osmLocation, coordinate: { latitude: NaN, longitude: 127 } }],
    ['infinity', { ...osmLocation, coordinate: { latitude: 26, longitude: Infinity } }],
    ['latitude range', { ...osmLocation, coordinate: { latitude: 91, longitude: 127 } }],
    ['longitude range', { ...osmLocation, coordinate: { latitude: 26, longitude: -181 } }],
    ['missing longitude', { ...osmLocation, coordinate: { latitude: 26 } }],
    ['null', null],
    ['missing OSM reference', { source: 'osm', kind: 'point', coordinate: { latitude: 26, longitude: 127 } }],
    ['incomplete OSM ID', { ...osmLocation, reference: { provider: 'osm', id: '123' } }],
    ['zero OSM ID', { ...osmLocation, reference: { provider: 'osm', id: 'node/0' } }],
    ['unknown kind', { ...osmLocation, kind: 'invalid' }],
    ['unknown field', { ...osmLocation, ownerUid: 'injected-owner' }],
    ['Google runtime content', { ...osmLocation, source: 'google', reference: { provider: 'google', id: 'google' } }],
  ])('rejects invalid location even alongside a valid Google ID: %s', async (_name, location) => {
    const input = { ...placeInput(regionId, location), googlePlaceId: 'valid-google' }
    await expect(places.create(input)).rejects.toBeInstanceOf(ValidationError)
    expect(await db.places.count()).toBe(0)
  })

  it('retains existing data after an invalid location update', async () => {
    const id = await places.create({ name: 'Original', googlePlaceId: 'google', regionIds: [regionId], labelIds: [] })
    const before = await places.getById(id)
    const changes = { name: 'Must not save', location: { ...osmLocation, coordinate: { latitude: 999, longitude: 127 } } }
    await expect(places.update(id, changes)).rejects.toBeInstanceOf(ValidationError)
    expect(await places.getById(id)).toEqual(before)
  })

  it('keeps relationship and in-use deletion guards for OSM places', async () => {
    await expect(places.create(placeInput('missing'))).rejects.toBeInstanceOf(EntityNotFoundError)
    const id = await places.create(placeInput(regionId))
    await itinerary(id)
    await expect(places.delete(id)).rejects.toBeInstanceOf(EntityInUseError)
    expect(await places.getById(id)).toBeDefined()
  })

  it('preserves OSM location and existing estimates when only the user name or notes change', async () => {
    const id = await places.create(placeInput(regionId))
    const ids = await itinerary(id)
    const before = await db.itineraryItems.bulkGet(ids)
    await places.update(id, { name: 'My renamed place', notes: 'My own notes' })
    expect(await places.getById(id)).toMatchObject({
      id, name: 'My renamed place', notes: 'My own notes', location: osmLocation,
    })
    expect(await db.itineraryItems.bulkGet(ids)).toEqual(before)
  })

  it('clears exactly two affected legs when coordinates change but the Google ID does not', async () => {
    const input = { ...placeInput(regionId), googlePlaceId: 'unchanged-google' }
    const id = await places.create(input)
    const ids = await itinerary(id)
    const before = await db.itineraryItems.bulkGet(ids)
    const changes = { location: { ...osmLocation, coordinate: { latitude: 26.22, longitude: 127.69 } } }
    await places.update(id, { ...changes, name: input.name })
    const after = await db.itineraryItems.bulkGet(ids)
    for (const index of [1, 2]) {
      expect(after[index]?.travelDurationMinutes).toBeUndefined()
      expect(after[index]?.travelDistanceMeters).toBeUndefined()
      expect(after[index]?.arrivalTime).toBe('10:00')
    }
    for (const index of [0, 3]) expect(after[index]).toEqual(before[index])
    expect(await places.getById(id)).toMatchObject({ googlePlaceId: 'unchanged-google', ...changes })
  })

  it('rolls back both location and all estimate changes when invalidation fails', async () => {
    const id = await places.create({ ...placeInput(regionId), googlePlaceId: 'unchanged-google' })
    const ids = await itinerary(id)
    const before = await places.getById(id)
    const beforeItems = await db.itineraryItems.bulkGet(ids)
    db.itineraryItems.hook('updating', () => { throw new Error('estimate write failed') })
    const changes = { name: 'Must roll back', location: { ...osmLocation, coordinate: { latitude: 27, longitude: 128 } } }
    await expect(places.update(id, changes)).rejects.toThrow('estimate write failed')
    expect(await places.getById(id)).toEqual(before)
    expect(await db.itineraryItems.bulkGet(ids)).toEqual(beforeItems)
  })

  it('validates backup v3 with location-only places and markers without changing their payloads', () => {
    const place = { id: 'place', ...placeInput(regionId) }
    const marker = { id: 'marker', routeMapId: 'map', name: 'User marker', location: osmLocation }
    const backup = new BackupRepository().validateImport({
      format: 'travel-planner-backup', version: 3, exportedAt: '2026-10-23T00:00:00.000Z',
      data: {
        regions: [{ id: regionId, name: 'Region', center: osmLocation.coordinate, zoom: 12 }],
        places: [place], labels: [], trips: [], itineraryItems: [],
        routeMaps: [{ id: 'map', name: 'Map', transport: 'WALKING' }], routeMapPlaces: [marker],
      },
    })
    expect(backup.data.places).toEqual([place])
    expect(backup.data.routeMapPlaces).toEqual([marker])
  })
})

describe('literal pre-extension v10 upgrade fixtures', () => {
  it.each([false, true])('preserves Google records and sync state when reopening a legacy DB (hybrid=%s)', async hybrid => {
    const account = { projectId: crypto.randomUUID(), userId: 'upgrade-owner' }
    const target = hybrid ? new SyncDatabase(account) : new TravelDatabase(`geo-upgrade-${crypto.randomUUID()}`)
    storages.push(target)
    const old = new Dexie(target.name)
    storages.push(old)
    old.version(10).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds, googlePlaceId',
      labels: '&id, name, parentId',
      trips: '&id, regionId, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
      routeMaps: '&id, &tripId',
      routeMapPlaces: '&id, routeMapId, &[routeMapId+googlePlaceId]',
      publicItineraries: '&id, &sourceTripId, createdAt, updatedAt',
      ...(hybrid ? {
        outbox: '++sequence, &operationId, status', syncMetadata: '&id',
        syncBaselines: '[entity+id]', syncConflicts: '&id', sharedItineraries: '&id',
      } : {}),
    })
    const googlePlace = { id: 'legacy-place', name: 'Original', googlePlaceId: 'legacy-google', regionIds: [], labelIds: [] }
    await old.table('places').add(googlePlace)
    await old.table('routeMaps').add({ id: 'legacy-map', name: 'Map', transport: 'TRANSIT', originGooglePlaceId: 'legacy-google' })
    await old.table('routeMapPlaces').add({ id: 'legacy-marker', routeMapId: 'legacy-map', googlePlaceId: 'extra-google' })
    if (hybrid) {
      await old.table('outbox').add({
        sequence: 7, operationId: 'frozen-operation', account, deviceId: 'original-device',
        protocolVersion: 1, operation: 'places.update', createdAt: '2026-10-23T00:00:00.000Z',
        changes: [{ entity: 'places', id: googlePlace.id, kind: 'put', after: googlePlace, baseVersion: '11' }],
        uploadChanges: [{ entity: 'places', id: googlePlace.id, kind: 'put', after: googlePlace, baseVersion: '11' }],
        status: 'failed', attempts: 1, error: 'unknown upload outcome',
      })
      await old.table('syncMetadata').add({ id: 'workspace', account, deviceId: 'original-device', initialized: true, cursor: '42' })
      await old.table('syncBaselines').add({ entity: 'places', id: googlePlace.id, version: '11', record: googlePlace })
      await old.table('syncConflicts').add({ id: 'workspace', token: 'original-review', rows: [], localChoiceChanges: [] })
    }
    const original: Record<string, unknown[]> = {}
    for (const table of old.tables) original[table.name] = await table.toArray()
    old.close()
    await target.open()
    for (const [name, records] of Object.entries(original)) expect(await target.table(name).toArray()).toEqual(records)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('hybrid local transaction boundary, not cloud protocol approval', () => {
  it('queues the complete OSM location with the record and rolls back if queue persistence fails', async () => {
    const sync = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'owner' })
    storages.push(sync)
    const context = new SyncAccountContext()
    context.activate(sync.account)
    const store = new LocalSyncStore(sync, context)
    await store.prepareLocal()
    const id = await store.mutate('place.osm-create', async repositories => {
      const region = await repositories.regions.create({ name: 'Region', googlePlaceId: 'region', zoom: 12 })
      return repositories.places.create(placeInput(region))
    })
    const queued = await store.listTasks()
    expect(queued).toHaveLength(1)
    expect(queued[0].changes.find(change => change.id === id)?.after).toMatchObject({ id, location: osmLocation })
    const beforePlaces = await sync.places.toArray()
    vi.spyOn(sync.outbox, 'add').mockRejectedValueOnce(new Error('outbox failed'))
    await expect(store.mutate('place.osm-edit', repositories => repositories.places.update(id, { notes: 'Must roll back' })))
      .rejects.toThrow('outbox failed')
    expect(await sync.places.toArray()).toEqual(beforePlaces)
    expect(await store.listTasks()).toEqual(queued)
    expect(fetch).not.toHaveBeenCalled()
  })
})
