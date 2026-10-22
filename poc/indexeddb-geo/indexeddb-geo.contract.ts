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
import type { NewPlace, NewRegion } from '../../src/database/models'
import type { StoredLocation } from '../../src/geo/contracts'
import { validateLocationMetadata } from '../../src/database/location.validation'
import { validateRegion } from '../../src/database/validation'

const osmLocation = {
  source: 'osm', kind: 'point',
  coordinate: { latitude: 26.2147, longitude: 127.6868 },
  reference: { provider: 'osm', id: 'node/123' },
  datasetVersion: 'fixture-2026-10-23',
} as const satisfies StoredLocation

function placeInput(regionId: string, location: StoredLocation = osmLocation): NewPlace {
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

describe('OSM location persistence and validation', () => {
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
    ['negative OSM ID', { ...osmLocation, reference: { provider: 'osm', id: 'way/-1' } }],
    ['fractional OSM ID', { ...osmLocation, reference: { provider: 'osm', id: 'node/1.5' } }],
    ['unknown OSM type', { ...osmLocation, reference: { provider: 'osm', id: 'area/12' } }],
    ['wrong reference provider', { ...osmLocation, reference: { provider: 'google', id: 'node/123' } }],
    ['reference unknown field', { ...osmLocation, reference: { ...osmLocation.reference, address: 'Not allowed' } }],
    ['coordinate unknown field', { ...osmLocation, coordinate: { ...osmLocation.coordinate, ownerUid: 'injected' } }],
    ['numeric string', { ...osmLocation, coordinate: { latitude: '26', longitude: 127 } }],
    ['array coordinate', { ...osmLocation, coordinate: [26, 127] }],
    ['array location', []],
    ['empty dataset', { ...osmLocation, datasetVersion: '' }],
    ['user claiming OSM reference', { ...osmLocation, source: 'user' }],
    ['legacy user claiming dataset', {
      source: 'legacy-user', kind: 'point', coordinate: osmLocation.coordinate, datasetVersion: 'unexpected',
    }],
    ['unknown kind', { ...osmLocation, kind: 'invalid' }],
    ['unknown field', { ...osmLocation, ownerUid: 'injected-owner' }],
    ['Google runtime content', { ...osmLocation, source: 'google', reference: { provider: 'google', id: 'google' } }],
  ])('rejects invalid location even alongside a valid Google ID: %s', async (_name, location) => {
    const input = { ...placeInput(regionId), location, googlePlaceId: 'valid-google' }
    // @ts-expect-error Exercise untrusted runtime input at the repository boundary.
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

  it('accepts all OSM reference types without rounding large IDs', async () => {
    for (const type of ['node', 'way', 'relation'] as const) {
      const location: StoredLocation = {
        ...osmLocation, reference: { provider: 'osm', id: `${type}/900719925474099312345` },
      }
      const id = await places.create(placeInput(regionId, location))
      expect((await places.getById(id))?.location).toEqual(location)
    }
  })

  it('does not invalidate identical locations or dataset-version-only changes', async () => {
    const id = await places.create(placeInput(regionId))
    const ids = await itinerary(id)
    const before = await db.itineraryItems.bulkGet(ids)
    await places.update(id, { location: structuredClone(osmLocation) })
    await places.update(id, { location: { ...osmLocation, datasetVersion: 'next-dataset' } })
    expect(await db.itineraryItems.bulkGet(ids)).toEqual(before)
    expect((await places.getById(id))?.location).toEqual({ ...osmLocation, datasetVersion: 'next-dataset' })
  })

  it.each(['add', 'remove', 'reference', 'source', 'kind'] as const)(
    'invalidates location identity changes: %s', async change => {
      const id = await places.create({
        ...placeInput(regionId), googlePlaceId: 'unchanged-google',
        location: change === 'add' ? undefined : osmLocation,
      })
      const ids = await itinerary(id)
      const location: StoredLocation | undefined = change === 'remove' ? undefined
        : change === 'reference' ? { ...osmLocation, reference: { provider: 'osm', id: 'way/123' } }
        : change === 'source' ? { source: 'user', kind: 'point', coordinate: osmLocation.coordinate }
        : change === 'kind' ? { ...osmLocation, kind: 'approximate-center' } : osmLocation
      await places.update(id, { location })
      for (const index of [1, 2]) {
        expect(await db.itineraryItems.get(ids[index])).toMatchObject({ id: ids[index], arrivalTime: '10:00' })
        expect((await db.itineraryItems.get(ids[index]))?.travelDurationMinutes).toBeUndefined()
        expect((await db.itineraryItems.get(ids[index]))?.travelDistanceMeters).toBeUndefined()
      }
    },
  )

  it('rejects removal of the only usable location and preserves estimates', async () => {
    const id = await places.create(placeInput(regionId))
    const ids = await itinerary(id)
    const before = await places.getById(id)
    const items = await db.itineraryItems.bulkGet(ids)
    await expect(places.update(id, { location: undefined })).rejects.toBeInstanceOf(ValidationError)
    expect(await places.getById(id)).toEqual(before)
    expect(await db.itineraryItems.bulkGet(ids)).toEqual(items)
  })

  it('invalidates every occurrence across trips and dates without crossing day boundaries', async () => {
    const id = await places.create(placeInput(regionId))
    const firstIds = await itinerary(id)
    const secondIds = await itinerary(id)
    const tripId = (await db.itineraryItems.get(firstIds[0]))!.tripId
    const items = new ItineraryItemRepository(db)
    const nextDay = await items.create({
      tripId, placeId: id, date: '2026-10-24', order: 0, travelDurationMinutes: 30, travelDistanceMeters: 300,
    })
    const nextDaySuccessor = await items.create({
      tripId, placeId: (await db.itineraryItems.get(firstIds[0]))!.placeId,
      date: '2026-10-24', order: 1, travelDurationMinutes: 40, travelDistanceMeters: 400,
    })
    const unrelated = await db.itineraryItems.bulkGet([firstIds[0], firstIds[3], secondIds[0], secondIds[3]])
    await places.update(id, { location: { ...osmLocation, coordinate: { latitude: 27, longitude: 128 } } })
    for (const itemId of [firstIds[1], firstIds[2], secondIds[1], secondIds[2], nextDay, nextDaySuccessor]) {
      const item = await db.itineraryItems.get(itemId)
      expect(item?.travelDurationMinutes).toBeUndefined()
      expect(item?.travelDistanceMeters).toBeUndefined()
    }
    expect(await db.itineraryItems.bulkGet([firstIds[0], firstIds[3], secondIds[0], secondIds[3]])).toEqual(unrelated)
  })

  it('validates backup v3 with location-only places and markers', () => {
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

describe('Region center provenance', () => {
  it('persists OSM metadata without creating a Google ID or modifying legacy regions', async () => {
    const regions = new RegionRepository(db)
    const input: NewRegion = {
      name: 'OSM region', zoom: 12, center: osmLocation.coordinate,
      centerMetadata: { source: 'osm', kind: 'approximate-center', reference: osmLocation.reference },
    }
    const beforeLegacy = await regions.getById(regionId)
    const id = await regions.create(input)
    await regions.update(id, { name: 'Renamed' })
    db.close()
    const reopened = new TravelDatabase(db.name)
    storages.push(reopened)
    expect(await reopened.regions.get(id)).toEqual({ id, ...input, name: 'Renamed' })
    expect(await reopened.regions.get(regionId)).toEqual(beforeLegacy)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts independent user metadata at coordinate boundaries', async () => {
    for (const source of ['user', 'legacy-user'] as const) {
      const input: NewRegion = {
        name: source, zoom: 12, center: { latitude: -90, longitude: 180 },
        centerMetadata: { source, kind: 'map-center' },
      }
      const id = await new RegionRepository(db).create(input)
      expect(await db.regions.get(id)).toEqual({ id, ...input })
    }
  })

  it('rejects orphan metadata and invalid center updates atomically', async () => {
    const regions = new RegionRepository(db)
    await expect(regions.create({
      name: 'Invalid', googlePlaceId: 'valid', zoom: 12, centerMetadata: { source: 'user', kind: 'point' },
    })).rejects.toBeInstanceOf(ValidationError)
    const id = await regions.create({
      name: 'OSM', zoom: 12, center: osmLocation.coordinate,
      centerMetadata: { source: 'osm', kind: 'point', reference: osmLocation.reference },
    })
    const before = await regions.getById(id)
    await expect(regions.update(id, { name: 'Must not save', center: undefined })).rejects.toBeInstanceOf(ValidationError)
    await expect(regions.update(id, { center: { latitude: NaN, longitude: 127 } })).rejects.toBeInstanceOf(ValidationError)
    expect(await regions.getById(id)).toEqual(before)
  })

  it.each([
    null, [], { source: 'google', kind: 'point' }, { source: 'user', kind: 'invalid' },
    { source: 'osm', kind: 'point' },
    { source: 'user', kind: 'point', ownerUid: 'injected' },
    { source: 'user', kind: 'point', coordinate: osmLocation.coordinate },
  ])('rejects invalid metadata shape: %j', value => {
    expect(() => validateLocationMetadata(value)).toThrow(ValidationError)
  })

  it('reports null legacy centers as ValidationError instead of TypeError', () => {
    expect(() => validateRegion({ name: 'Invalid', zoom: 12, center: null })).toThrow(ValidationError)
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
    expect(target.verno).toBe(11)
    expect(await target.routeMapPlaces.where('[routeMapId+location.reference.id]')
      .equals(['legacy-map', 'node/123']).count()).toBe(0)
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

  it('queues location and all invalidated legs together, and rolls all of them back on outbox failure', async () => {
    const sync = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'owner' })
    storages.push(sync)
    const context = new SyncAccountContext()
    context.activate(sync.account)
    const store = new LocalSyncStore(sync, context)
    await store.prepareLocal()
    const { placeId, itemIds } = await store.mutate('osm-itinerary.setup', async repositories => {
      const region = await repositories.regions.create({ name: 'Region', googlePlaceId: 'region', zoom: 12 })
      const placeId = await repositories.places.create(placeInput(region))
      const otherPlace = await repositories.places.create({
        name: 'Other', googlePlaceId: 'other', regionIds: [region], labelIds: [],
      })
      const tripId = await repositories.trips.create({
        name: 'Trip', regionId: region, startDate: '2026-10-23', endDate: '2026-10-23',
      })
      const itemIds: string[] = []
      for (let order = 0; order < 3; order += 1) {
        itemIds.push(await repositories.itineraryItems.create({
          tripId, placeId: order === 0 ? placeId : otherPlace, date: '2026-10-23', order,
          travelDurationMinutes: 10, travelDistanceMeters: 100, arrivalTime: '10:00',
        }))
      }
      return { placeId, itemIds }
    })
    const update = { location: { ...osmLocation, coordinate: { latitude: 27, longitude: 128 } } }
    const beforePlace = await sync.places.get(placeId)
    const beforeItems = await sync.itineraryItems.bulkGet(itemIds)
    const beforeTasks = await store.listTasks()
    vi.spyOn(sync.outbox, 'add').mockRejectedValueOnce(new Error('queue failed'))
    await expect(store.mutate('osm-itinerary.update', repositories => repositories.places.update(placeId, update)))
      .rejects.toThrow('queue failed')
    expect(await sync.places.get(placeId)).toEqual(beforePlace)
    expect(await sync.itineraryItems.bulkGet(itemIds)).toEqual(beforeItems)
    expect(await store.listTasks()).toEqual(beforeTasks)
    await store.mutate('osm-itinerary.update', repositories => repositories.places.update(placeId, update))
    const tasks = await store.listTasks()
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toEqual(beforeTasks[0])
    const task = tasks[1]
    expect(task.changes).toHaveLength(3)
    expect(task.changes.find(change => change.entity === 'places' && change.id === placeId))
      .toMatchObject({ before: beforePlace, after: { id: placeId, ...update } })
    for (const itemId of itemIds.slice(0, 2)) {
      const change = task.changes.find(value => value.entity === 'itineraryItems' && value.id === itemId)
      expect(change).toMatchObject({
        before: { travelDurationMinutes: 10, travelDistanceMeters: 100 },
        after: { id: itemId, arrivalTime: '10:00' },
      })
      const after = change?.after
      expect(after && 'travelDurationMinutes' in after ? after.travelDurationMinutes : undefined).toBeUndefined()
      expect(after && 'travelDistanceMeters' in after ? after.travelDistanceMeters : undefined).toBeUndefined()
    }
    expect(task.changes.some(change => change.id === itemIds[2])).toBe(false)
    expect(await sync.itineraryItems.get(itemIds[2])).toEqual(beforeItems[2])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects writes after account switching without losing the old local data or queue', async () => {
    const sync = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'owner' })
    storages.push(sync)
    const context = new SyncAccountContext()
    context.activate(sync.account)
    const store = new LocalSyncStore(sync, context)
    await store.prepareLocal()
    const id = await store.mutate('osm.setup', async repositories => {
      const region = await repositories.regions.create({ name: 'Region', googlePlaceId: 'region', zoom: 12 })
      return repositories.places.create(placeInput(region))
    })
    const before = await sync.places.get(id)
    const tasks = await store.listTasks()
    context.activate({ ...sync.account, userId: 'different-owner' })
    await expect(store.mutate('osm.stale-update', repositories => repositories.places.update(id, { notes: 'Must not save' })))
      .rejects.toBeInstanceOf(ValidationError)
    expect(await sync.places.get(id)).toEqual(before)
    context.activate(sync.account)
    expect(await store.listTasks()).toEqual(tasks)
  })
})
