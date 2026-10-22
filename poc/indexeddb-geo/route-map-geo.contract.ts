import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravelDatabase } from '../../src/database/database'
import { BackupRepository } from '../../src/database/backup.repository'
import { EntityNotFoundError, ValidationError } from '../../src/database/errors'
import { PlaceRepository, RegionRepository } from '../../src/database/repositories'
import { RouteMapPlaceRepository, RouteMapRepository } from '../../src/database/route-map.repository'
import { assertRouteEndpointReference, getRouteMapEndpoint, validateRouteEndpoint } from '../../src/database/route-endpoint'
import { LocalSyncStore } from '../../src/database/local-sync.store'
import { SyncDatabase } from '../../src/database/sync.database'
import { SyncAccountContext } from '../../src/database/sync-account-context'
import type { StoredLocation } from '../../src/geo/contracts'
import type { SyncTask } from '../../src/database/sync.types'
import type { SharedTripSnapshot } from '../../src/database/shared-trip.types'

const location = {
  source: 'osm', kind: 'point', coordinate: { latitude: 26, longitude: 127 },
  reference: { provider: 'osm', id: 'node/123' },
} as const satisfies StoredLocation

const databases: TravelDatabase[] = []
let db: TravelDatabase
let maps: RouteMapRepository
let markers: RouteMapPlaceRepository
let backups: BackupRepository
let mapId: string

beforeEach(async () => {
  db = new TravelDatabase(`geo-route-contract-${crypto.randomUUID()}`)
  databases.push(db)
  maps = new RouteMapRepository(db)
  markers = new RouteMapPlaceRepository(db)
  backups = new BackupRepository(db)
  mapId = await maps.create({ name: 'Map', transport: 'WALKING' })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden') }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const database of databases.splice(0)) await database.delete()
})

async function place() {
  const regionId = await new RegionRepository(db).create({
    name: 'Region', center: location.coordinate, zoom: 12,
    centerMetadata: { source: 'osm', kind: 'map-center', reference: location.reference },
  })
  return new PlaceRepository(db).create({ name: 'Place', location, regionIds: [regionId], labelIds: [] })
}

describe('v11 markers and indexes', () => {
  it('persists named OSM markers without Google placeholders after reopening', async () => {
    const input = { routeMapId: mapId, name: 'User name', location }
    const id = await markers.create(input)
    db.close()
    const reopened = new TravelDatabase(db.name)
    databases.push(reopened)
    expect(await new RouteMapPlaceRepository(reopened).getById(id)).toEqual({ id, ...input })
    expect(reopened.verno).toBe(11)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('enforces provider identity, ignores dataset version, and scopes uniqueness to each map', async () => {
    const input = { routeMapId: mapId, name: 'User name', location }
    await markers.create(input)
    await expect(markers.create(input)).rejects.toBeInstanceOf(ValidationError)
    await expect(markers.create({ ...input, location: { ...location, datasetVersion: 'next' } }))
      .rejects.toBeInstanceOf(ValidationError)
    const otherId = await maps.create({ name: 'Other', transport: 'WALKING' })
    await markers.create({ ...input, routeMapId: otherId })
    await markers.create({
      ...input, location: { ...location, reference: { provider: 'osm', id: 'way/123' } },
    })
    expect(await db.routeMapPlaces.count()).toBe(3)
    // The storage constraint must also reject writes bypassing repository validation.
    await expect(db.routeMapPlaces.add({ id: crypto.randomUUID(), ...input })).rejects.toMatchObject({ name: 'ConstraintError' })
  })

  it('enforces both Google and OSM constraints when a marker has both references', async () => {
    await markers.create({ routeMapId: mapId, name: 'Both', googlePlaceId: 'google', location })
    await expect(markers.create({ routeMapId: mapId, googlePlaceId: 'google' })).rejects.toBeInstanceOf(ValidationError)
    await expect(markers.create({ routeMapId: mapId, name: 'OSM duplicate', location })).rejects.toBeInstanceOf(ValidationError)
  })

  it('does not merge independently selected user positions by coordinates', async () => {
    const userLocation: StoredLocation = { source: 'user', kind: 'user-picked', coordinate: location.coordinate }
    for (const name of ['One', 'Two']) await markers.create({ routeMapId: mapId, name, location: userLocation })
    expect(await db.routeMapPlaces.count()).toBe(2)
  })

  it('rejects missing names, invalid locations and nonexistent maps without partial writes', async () => {
    await expect(markers.create({ routeMapId: mapId, location })).rejects.toBeInstanceOf(ValidationError)
    await expect(markers.create({ routeMapId: 'missing', name: 'OSM', location })).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(markers.create({
      routeMapId: mapId, name: 'Invalid', googlePlaceId: 'valid',
      location: { ...location, coordinate: { latitude: NaN, longitude: 127 } },
    })).rejects.toBeInstanceOf(ValidationError)
    expect(await db.routeMapPlaces.count()).toBe(0)
  })

  it('rolls back updates which would duplicate another marker', async () => {
    const firstId = await markers.create({ routeMapId: mapId, name: 'One', location })
    const secondId = await markers.create({ routeMapId: mapId, googlePlaceId: 'second' })
    const before = await markers.getById(secondId)
    await expect(markers.update(secondId, { name: 'Duplicate', location })).rejects.toBeInstanceOf(ValidationError)
    expect(await markers.getById(secondId)).toEqual(before)
    expect(await markers.getById(firstId)).toMatchObject({ location })
  })
})

describe('neutral route endpoints', () => {
  it('normalizes legacy Google endpoints without rewriting saved records', async () => {
    await maps.update(mapId, { originGooglePlaceId: 'origin', destinationGooglePlaceId: 'destination' })
    const before = await maps.getById(mapId)
    expect(getRouteMapEndpoint(before!, 'origin')).toEqual({
      kind: 'location', id: `${mapId}:origin`,
      value: { kind: 'google', reference: { provider: 'google', id: 'origin' } },
    })
    expect(await maps.getById(mapId)).toEqual(before)
    expect(before).not.toHaveProperty('origin')
  })

  it('persists private place, same-map marker and inline endpoints', async () => {
    const placeId = await place()
    const markerId = await markers.create({ routeMapId: mapId, name: 'Marker', location })
    await maps.update(mapId, {
      origin: { kind: 'place', placeId }, destination: { kind: 'route-map-place', routeMapPlaceId: markerId },
    })
    expect((await maps.getById(mapId))?.origin).toEqual({ kind: 'place', placeId })
    const inline = { kind: 'location', id: crypto.randomUUID(), value: { kind: 'stored', name: 'Inline', location } } as const
    await maps.update(mapId, { destination: inline })
    expect((await maps.getById(mapId))?.destination).toEqual(inline)
  })

  it('rejects missing and cross-map references without saving other edits', async () => {
    const before = await maps.getById(mapId)
    await expect(maps.update(mapId, { name: 'Must not save', origin: { kind: 'place', placeId: 'missing' } }))
      .rejects.toBeInstanceOf(EntityNotFoundError)
    const otherMap = await maps.create({ name: 'Other', transport: 'WALKING' })
    const markerId = await markers.create({ routeMapId: otherMap, googlePlaceId: 'google' })
    await expect(maps.update(mapId, { origin: { kind: 'route-map-place', routeMapPlaceId: markerId } }))
      .rejects.toBeInstanceOf(ValidationError)
    expect(await maps.getById(mapId)).toEqual(before)
  })

  it('rejects conflicting legacy fields and equal neutral endpoints', async () => {
    const endpoint = {
      kind: 'location', id: 'inline',
      value: { kind: 'google', reference: { provider: 'google', id: 'google' } },
    } as const
    await expect(maps.update(mapId, { origin: endpoint, originGooglePlaceId: 'different' }))
      .rejects.toBeInstanceOf(ValidationError)
    await expect(maps.update(mapId, { origin: endpoint, destinationGooglePlaceId: 'google' }))
      .rejects.toBeInstanceOf(ValidationError)
    await maps.update(mapId, { origin: endpoint, originGooglePlaceId: 'google' })
    expect((await maps.getById(mapId))?.origin).toEqual(endpoint)
  })

  it('uses explicit identity, not coordinates, for independent user endpoints', async () => {
    const value = {
      kind: 'stored', name: 'User endpoint',
      location: { source: 'user', kind: 'user-picked', coordinate: location.coordinate },
    } as const
    await maps.update(mapId, {
      origin: { kind: 'location', id: 'one', value }, destination: { kind: 'location', id: 'two', value },
    })
    await expect(maps.update(mapId, { destination: { kind: 'location', id: 'one', value } }))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it.each([
    null, [], { kind: 'unknown' }, { kind: 'place', placeId: '' },
    { kind: 'place', placeId: 'place', ownerUid: 'injected' },
    { kind: 'location', id: 'inline', value: { kind: 'stored', name: '', location } },
    { kind: 'location', id: 'inline', value: { kind: 'google', reference: { provider: 'osm', id: 'node/1' } } },
    { kind: 'location', id: 'inline', value: { kind: 'stored', name: 'Name', location: { ...location, source: 'google' } } },
  ])('rejects malformed endpoint %j', endpoint => {
    expect(() => validateRouteEndpoint(endpoint)).toThrow(ValidationError)
  })

  it('clears references on marker deletion or moving to another map, without deleting the map', async () => {
    const markerId = await markers.create({ routeMapId: mapId, name: 'Marker', location })
    await maps.update(mapId, { origin: { kind: 'route-map-place', routeMapPlaceId: markerId } })
    const otherMap = await maps.create({ name: 'Other', transport: 'WALKING' })
    await markers.update(markerId, { routeMapId: otherMap })
    expect((await maps.getById(mapId))?.origin).toBeUndefined()
    await maps.update(otherMap, { destination: { kind: 'route-map-place', routeMapPlaceId: markerId } })
    await markers.delete(markerId)
    expect((await maps.getById(otherMap))?.destination).toBeUndefined()
    expect(await maps.list()).toHaveLength(2)
  })

  it('clears private-place references atomically and preserves unrelated endpoints', async () => {
    const placeId = await place()
    await maps.update(mapId, {
      origin: { kind: 'place', placeId }, destinationGooglePlaceId: 'keep-google',
    })
    const before = await maps.getById(mapId)
    db.routeMaps.hook('updating', () => { throw new Error('map write failed') })
    await expect(new PlaceRepository(db).delete(placeId)).rejects.toThrow('map write failed')
    expect(await db.places.get(placeId)).toBeDefined()
    expect(await maps.getById(mapId)).toEqual(before)
  })

  it('removes place endpoint on successful deletion', async () => {
    const placeId = await place()
    await maps.update(mapId, { origin: { kind: 'place', placeId }, destinationGooglePlaceId: 'keep' })
    await new PlaceRepository(db).delete(placeId)
    expect(await maps.getById(mapId)).toMatchObject({ id: mapId, destinationGooglePlaceId: 'keep' })
    expect((await maps.getById(mapId))?.origin).toBeUndefined()
  })

  it('rejects shared endpoints without an account-scoped cache', async () => {
    await expect(maps.update(mapId, { origin: { kind: 'shared-place', tripId: 'trip', placeId: 'shared' } }))
      .rejects.toBeInstanceOf(ValidationError)
  })
})

describe('backup v3 complete local replacement', () => {
  it('round-trips all new fields and endpoint references while retaining UUIDs', async () => {
    const placeId = await place()
    const markerId = await markers.create({ routeMapId: mapId, name: 'Marker', location })
    await maps.update(mapId, {
      origin: { kind: 'place', placeId }, destination: { kind: 'route-map-place', routeMapPlaceId: markerId },
    })
    const before = await backups.exportAll()
    expect(before.version).toBe(3)
    const target = new TravelDatabase(`geo-backup-target-${crypto.randomUUID()}`)
    databases.push(target)
    const targetBackups = new BackupRepository(target)
    await targetBackups.replaceAll(JSON.parse(JSON.stringify(before)))
    const after = await targetBackups.exportAll()
    expect(after.data).toEqual(before.data)
    expect(after.version).toBe(3)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves legacy output v2 and rejects new fields disguised as v2', async () => {
    const legacy = await backups.exportAll()
    expect(legacy.version).toBe(2)
    const placeId = await place()
    const backup = await backups.exportAll()
    expect(backup.data.places[0].id).toBe(placeId)
    expect(() => backups.validateImport({ ...backup, version: 2 })).toThrow(ValidationError)
    expect(backups.validateImport(legacy).version).toBe(2)
  })

  it('rejects invalid graph before clearing any live records', async () => {
    const placeId = await place()
    await maps.update(mapId, { origin: { kind: 'place', placeId } })
    const before = await backups.exportAll()
    const invalid = structuredClone(before)
    invalid.data.places = []
    await expect(backups.replaceAll(invalid)).rejects.toBeInstanceOf(ValidationError)
    expect((await backups.exportAll()).data).toEqual(before.data)
  })

  it('rejects a backup endpoint referencing a marker in a different map', async () => {
    const otherMap = await maps.create({ name: 'Other', transport: 'WALKING' })
    const marker = await markers.create({ routeMapId: otherMap, name: 'OSM', location })
    const before = await backups.exportAll()
    const invalid = structuredClone(before)
    invalid.data.routeMaps.find(map => map.id === mapId)!.origin = { kind: 'route-map-place', routeMapPlaceId: marker }
    await expect(backups.replaceAll(invalid)).rejects.toThrow('another map')
    expect((await backups.exportAll()).data).toEqual(before.data)
  })

  it('rolls back replacement if a later table write fails', async () => {
    await place()
    const before = await backups.exportAll()
    db.routeMaps.hook('creating', () => { throw new Error('restore failed') })
    await expect(backups.replaceAll(before)).rejects.toThrow('restore failed')
    expect((await backups.exportAll()).data).toEqual(before.data)
  })

  it('rejects duplicate OSM references but permits independent user markers', async () => {
    await markers.create({ routeMapId: mapId, name: 'OSM', location })
    const before = await backups.exportAll()
    const duplicate = structuredClone(before)
    duplicate.data.routeMapPlaces.push({ ...duplicate.data.routeMapPlaces[0], id: 'duplicate' })
    expect(() => backups.validateImport(duplicate)).toThrow(ValidationError)
    for (const name of ['One', 'Two']) {
      await markers.create({
        routeMapId: mapId, name,
        location: { source: 'user', kind: 'user-picked', coordinate: location.coordinate },
      })
    }
    expect((await backups.exportAll()).data.routeMapPlaces).toHaveLength(3)
  })

  it('rejects shared-place export explicitly rather than dropping the endpoint', async () => {
    // A raw record simulates an account-scoped route map without copying shared documents.
    await db.routeMaps.update(mapId, { origin: { kind: 'shared-place', tripId: 'shared-trip', placeId: 'shared-place' } })
    await expect(backups.exportAll()).rejects.toThrow('共享')
    expect((await maps.getById(mapId))?.origin).toBeDefined()
  })
})

describe('sync protocol boundary', () => {
  async function setup() {
    const sync = new SyncDatabase({ projectId: crypto.randomUUID(), userId: 'owner' })
    databases.push(sync)
    const context = new SyncAccountContext()
    context.activate(sync.account)
    const store = new LocalSyncStore(sync, context)
    await store.prepareLocal()
    return { sync, store }
  }

  it('blocks new-format upload without freezing payloads, incrementing attempts or changing the queue', async () => {
    const { sync, store } = await setup()
    await expect(store.mutate('geo.create', repositories => repositories.routeMapPlaces.create({
      routeMapId: 'missing', name: 'Invalid', location,
    }))).rejects.toBeInstanceOf(EntityNotFoundError)
    expect(await store.listTasks()).toEqual([])
    await store.mutate('geo.create', async repositories => {
      const id = await repositories.routeMaps.create({ name: 'Map', transport: 'WALKING' })
      await repositories.routeMapPlaces.create({ routeMapId: id, name: 'OSM', location })
    })
    const before = await store.listTasks()
    await expect(store.prepareUpload()).rejects.toThrow('尚未支援')
    expect(await store.listTasks()).toEqual(before)
    expect(await sync.routeMapPlaces.count()).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains exact legacy frozen payloads and operation IDs across retry and DB reopening', async () => {
    const { sync, store } = await setup()
    await store.mutate('legacy.create', repositories => repositories.routeMaps.create({ name: 'Legacy', transport: 'WALKING' }))
    const task = (await store.prepareUpload())!
    const frozen = structuredClone(task.changes)
    await store.markUpload(task, 'failed', 'Unknown outcome')
    sync.close()
    const reopened = new SyncDatabase(sync.account)
    databases.push(reopened)
    const context = new SyncAccountContext()
    context.activate(reopened.account)
    const retry = await new LocalSyncStore(reopened, context).prepareUpload({ retryOnly: true })
    expect(retry?.operationId).toBe(task.operationId)
    expect(retry?.protocolVersion).toBe(1)
    expect(retry?.changes).toEqual(frozen)
    expect(retry?.uploadChanges).toEqual(frozen)
  })

  it('blocks unknown protocol versions without rewriting a persisted task', async () => {
    const { sync, store } = await setup()
    const task: Omit<SyncTask, 'protocolVersion'> & { protocolVersion: number } = {
      operationId: 'future-task', account: sync.account, deviceId: 'device', protocolVersion: 2,
      operation: 'future', createdAt: new Date().toISOString(), changes: [], attempts: 0, status: 'pending',
    }
    // @ts-expect-error Simulate an on-disk task produced by a newer client.
    await sync.outbox.add(task)
    const before = await store.listTasks()
    await expect(store.prepareUpload()).rejects.toThrow('協定版本')
    expect(await store.listTasks()).toEqual(before)
  })

  it('rejects direct account-DB replacement or clearing without discarding any queued changes', async () => {
    const { sync, store } = await setup()
    await store.mutate('legacy.create', repositories => repositories.routeMaps.create({ name: 'Legacy', transport: 'WALKING' }))
    const repository = new BackupRepository(sync)
    const before = await repository.exportAll()
    const tasks = await store.listTasks()
    await expect(repository.replaceAll(before)).rejects.toThrow('不能直接覆蓋')
    await expect(repository.clearAllData()).rejects.toThrow('不能直接覆蓋')
    expect((await repository.exportAll()).data).toEqual(before.data)
    expect(await store.listTasks()).toEqual(tasks)
  })

  it('tracks marker deletion and endpoint cleanup in the same task, rolling back on queue failure', async () => {
    const { sync, store } = await setup()
    const { map, marker } = await store.mutate('marker.setup', async repositories => {
      const map = await repositories.routeMaps.create({ name: 'Map', transport: 'WALKING' })
      const marker = await repositories.routeMapPlaces.create({ routeMapId: map, name: 'OSM', location })
      await repositories.routeMaps.update(map, { origin: { kind: 'route-map-place', routeMapPlaceId: marker } })
      return { map, marker }
    })
    const beforeMap = await sync.routeMaps.get(map)
    const beforeTasks = await store.listTasks()
    vi.spyOn(sync.outbox, 'add').mockRejectedValueOnce(new Error('queue failed'))
    await expect(store.mutate('marker.delete', repositories => repositories.routeMapPlaces.delete(marker)))
      .rejects.toThrow('queue failed')
    expect(await sync.routeMaps.get(map)).toEqual(beforeMap)
    expect(await sync.routeMapPlaces.get(marker)).toBeDefined()
    expect(await store.listTasks()).toEqual(beforeTasks)
    await store.mutate('marker.delete', repositories => repositories.routeMapPlaces.delete(marker))
    expect((await sync.routeMaps.get(map))?.origin).toBeUndefined()
    const changes = (await store.listTasks()).at(-1)!.changes
    expect(changes).toHaveLength(2)
    expect(changes.find(change => change.id === marker)).toMatchObject({ kind: 'delete', entity: 'routeMapPlaces' })
    expect(changes.find(change => change.id === map)).toMatchObject({ kind: 'put', entity: 'routeMaps' })
  })

  it('accepts accessible cached shared-place references and reports revocation without private fallback', async () => {
    const { sync, store } = await setup()
    const tripId = crypto.randomUUID()
    const placeId = crypto.randomUUID()
    const regionId = crypto.randomUUID()
    const snapshot: SharedTripSnapshot = {
      id: tripId, version: '1',
      document: {
        trip: {
          id: tripId, name: 'Shared', regionId, startDate: '2026-10-23', endDate: '2026-10-23',
          ownerUid: 'different-owner', access: 'viewer', aclVersion: '1',
        },
        region: { id: regionId, name: 'Shared region', googlePlaceId: 'region', zoom: 12 },
        places: [{ id: placeId, name: 'Shared place', googlePlaceId: 'google' }], items: [],
      },
    }
    await store.syncTransaction(database => database.sharedItineraries.put(snapshot))
    const endpoint = { kind: 'shared-place', tripId, placeId } as const
    const id = await store.mutate('shared.endpoint', repositories => repositories.routeMaps.create({
      name: 'Map', transport: 'WALKING', origin: endpoint,
    }))
    expect((await sync.routeMaps.get(id))?.origin).toEqual(endpoint)
    await expect(new BackupRepository(sync).exportAll()).rejects.toThrow('共享')
    await store.syncTransaction(database => database.sharedItineraries.put({ ...snapshot, version: '2', document: null }))
    await expect(assertRouteEndpointReference(sync, id, endpoint)).rejects.toThrow('unavailable')
    // Revocation must never resolve the same UUID through the private places table.
    await store.syncTransaction(database => database.places.add({
      id: placeId, name: 'Unrelated private place', googlePlaceId: 'private', regionIds: [], labelIds: [],
    }))
    await expect(assertRouteEndpointReference(sync, id, endpoint)).rejects.toThrow('unavailable')
  })
})
