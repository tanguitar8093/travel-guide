import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OSM_REGION, DEFAULT_OSM_REGION_ID } from '../geo/osm-coverage'
import { defaultRegionIds, regionsForMapProvider } from '../geo/region-provider'
import { TravelDatabase } from './database'
import { ValidationError } from './errors'
import { PlaceRepository, RegionRepository } from './repositories'

describe('provider-specific regions', () => {
  const databases: Dexie[] = []
  afterEach(async () => {
    for (const database of databases.splice(0)) {
      database.close()
      await database.delete()
    }
  })

  it('upgrades the standalone IndexedDB with an Okinawa OSM region and preserves Google regions', async () => {
    const legacy = new Dexie('travel-planner')
    legacy.version(11).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds, googlePlaceId',
      labels: '&id, name, parentId',
      trips: '&id, regionId, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
      routeMaps: '&id, &tripId',
      routeMapPlaces: '&id, routeMapId, &[routeMapId+googlePlaceId], &[routeMapId+location.reference.id]',
      publicItineraries: '&id, &sourceTripId, createdAt, updatedAt',
    })
    databases.push(legacy)
    await legacy.open()
    await legacy.table('regions').add({
      id: 'google-kyoto', name: '京都', zoom: 12, googlePlaceId: 'google-kyoto',
    })
    await legacy.table('places').bulkAdd([
      {
        id: 'old-osm-place', name: '海中道路', regionIds: ['google-kyoto'], labelIds: [],
        location: { source: 'user', kind: 'user-picked', coordinate: { latitude: 26.33, longitude: 127.92 } },
      },
      { id: 'google-place', name: '京都店', googlePlaceId: 'google-place', regionIds: ['google-kyoto'], labelIds: [] },
    ])
    await legacy.table('trips').bulkAdd([
      { id: 'osm-trip', name: '沖繩 OSM 行程', regionId: 'google-kyoto', startDate: '2026-10-23', endDate: '2026-10-23' },
      { id: 'mixed-trip', name: '混合行程', regionId: 'google-kyoto', startDate: '2026-10-23', endDate: '2026-10-23' },
    ])
    await legacy.table('itineraryItems').bulkAdd([
      { id: 'osm-item', tripId: 'osm-trip', placeId: 'old-osm-place', date: '2026-10-23', order: 0 },
      { id: 'mixed-osm-item', tripId: 'mixed-trip', placeId: 'old-osm-place', date: '2026-10-23', order: 0 },
      { id: 'mixed-google-item', tripId: 'mixed-trip', placeId: 'google-place', date: '2026-10-23', order: 1 },
    ])
    legacy.close()

    const database = new TravelDatabase()
    databases.push(database)
    await database.open()
    expect(await database.regions.get('google-kyoto')).toMatchObject({ name: '京都', googlePlaceId: 'google-kyoto' })
    expect(await database.regions.get(DEFAULT_OSM_REGION_ID)).toEqual({
      ...DEFAULT_OSM_REGION, id: DEFAULT_OSM_REGION_ID,
    })
    expect(await database.places.get('old-osm-place')).toMatchObject({ regionIds: [DEFAULT_OSM_REGION_ID] })
    expect(await database.places.get('google-place')).toMatchObject({ regionIds: ['google-kyoto'] })
    expect(await database.trips.get('osm-trip')).toMatchObject({ regionId: DEFAULT_OSM_REGION_ID })
    expect(await database.trips.get('mixed-trip')).toMatchObject({ regionId: 'google-kyoto' })
    expect(defaultRegionIds(await database.regions.toArray(), 'osm')).toEqual([DEFAULT_OSM_REGION_ID])
    expect(defaultRegionIds(await database.regions.toArray(), 'google')).toEqual(['google-kyoto'])
  })

  it('filters Google and OSM regions independently and defaults to the first matching region', () => {
    const regions = [
      { id: 'google', name: '京都', zoom: 12, googlePlaceId: 'google' },
      { id: 'osm-z', name: '沖繩南部', zoom: 8, mapProvider: 'osm' as const },
      { id: 'osm-a', name: '沖繩', zoom: 8, mapProvider: 'osm' as const },
    ]
    expect(regionsForMapProvider(regions, 'google').map(region => region.id)).toEqual(['google'])
    expect(defaultRegionIds(regions, 'osm')).toEqual(['osm-z'])
  })

  it('keeps OSM places in the Okinawa OSM region and rejects Google-region or out-of-coverage assignments', async () => {
    const database = new TravelDatabase(`region-provider-${crypto.randomUUID()}`)
    databases.push(database)
    const regions = new RegionRepository(database)
    const places = new PlaceRepository(database)
    const osmRegionId = await regions.create(DEFAULT_OSM_REGION)
    const googleRegionId = await regions.create({ name: '京都', zoom: 12, googlePlaceId: 'google-kyoto' })
    const location = {
      source: 'user' as const, kind: 'user-picked' as const,
      coordinate: { latitude: 26.33, longitude: 127.92 },
    }

    await expect(places.create({
      name: '海中道路', location, regionIds: [googleRegionId], labelIds: [],
    })).rejects.toBeInstanceOf(ValidationError)
    await expect(places.create({
      name: '京都', location: {
        ...location, coordinate: { latitude: 35.68, longitude: 139.76 },
      }, regionIds: [osmRegionId], labelIds: [],
    })).rejects.toThrow('Okinawa dataset coverage')
    await expect(places.create({
      name: '京都 Google', googlePlaceId: 'google-place', regionIds: [osmRegionId], labelIds: [],
    })).rejects.toThrow('Google region')

    const id = await places.create({
      name: '海中道路', location, regionIds: [osmRegionId], labelIds: [],
    })
    expect(await places.getById(id)).toMatchObject({ regionIds: [osmRegionId], location })
  })

  it('rejects OSM regions outside the current Okinawa dataset', async () => {
    const database = new TravelDatabase(`region-bounds-${crypto.randomUUID()}`)
    databases.push(database)
    const regions = new RegionRepository(database)
    await expect(regions.create({
      ...DEFAULT_OSM_REGION,
      center: { latitude: 35.68, longitude: 139.76 },
    })).rejects.toThrow('Okinawa dataset coverage')
  })
})
