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
    })).rejects.toThrow('沖繩圖資範圍')
    await expect(places.create({
      name: '京都 Google', googlePlaceId: 'google-place', regionIds: [osmRegionId], labelIds: [],
    })).rejects.toThrow('Google 地圖')

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
    })).rejects.toThrow('沖繩圖資範圍')
  })

  it('requires coordinates for OSM places even when a navigation URL is provided', async () => {
    const database = new TravelDatabase(`required-coordinate-${crypto.randomUUID()}`)
    databases.push(database)
    const regionId = await new RegionRepository(database).create(DEFAULT_OSM_REGION)
    const places = new PlaceRepository(database)
    await expect(places.create({
      name: '未定位', mapsUrl: 'https://example.com/maps', regionIds: [regionId], labelIds: [],
    })).rejects.toThrow('只有導航網址')
    expect(await database.places.count()).toBe(0)
  })

  it('rejects identical coordinate pairs across sources and names but permits editing the same place', async () => {
    const database = new TravelDatabase(`unique-coordinate-${crypto.randomUUID()}`)
    databases.push(database)
    const regionId = await new RegionRepository(database).create(DEFAULT_OSM_REGION)
    const places = new PlaceRepository(database)
    const location = {
      source: 'user' as const, kind: 'user-picked' as const,
      coordinate: { latitude: 26.33, longitude: 127.92 },
    }
    const input = { name: '原地點', location, regionIds: [regionId], labelIds: [] }
    const id = await places.create(input)
    await expect(places.create({
      ...input, name: '另一名稱', location: {
        ...location, source: 'osm', reference: { provider: 'osm', id: 'node/123' },
      },
    })).rejects.toThrow('原地點')
    await expect(places.update(id, { name: '改名', location })).resolves.toBeUndefined()
    const second = await places.create({
      ...input, name: '第二地點',
      location: { ...location, coordinate: { latitude: 26.34, longitude: 127.92 } },
    })
    await expect(places.update(second, { location })).rejects.toThrow('改名')
    await expect(places.update(second, { location: undefined, mapsUrl: 'https://example.com/' })).rejects.toThrow('只有導航網址')
    expect(await database.places.count()).toBe(2)
    expect((await places.getById(second))?.location?.coordinate.latitude).toBe(26.34)
  })

  it('serializes concurrent duplicate creations in the same IndexedDB transaction scope', async () => {
    const database = new TravelDatabase(`concurrent-coordinate-${crypto.randomUUID()}`)
    databases.push(database)
    const regionId = await new RegionRepository(database).create(DEFAULT_OSM_REGION)
    const places = new PlaceRepository(database)
    const input = {
      name: '同一位置', regionIds: [regionId], labelIds: [],
      location: { source: 'user' as const, kind: 'user-picked' as const,
        coordinate: { latitude: 26.33, longitude: 127.92 } },
    }
    const results = await Promise.allSettled([
      places.create(input),
      places.create({
        ...input, name: '同位置的另一入口',
        location: { ...input.location, coordinate: { latitude: 26.3302, longitude: 127.92 } },
      }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await database.places.count()).toBe(1)
  })

  it('rejects nearby coordinates or matching names on create and update without blocking metadata edits', async () => {
    const database = new TravelDatabase(`nearby-place-${crypto.randomUUID()}`)
    databases.push(database)
    const regionId = await new RegionRepository(database).create(DEFAULT_OSM_REGION)
    const places = new PlaceRepository(database)
    const input = {
      name: '原地點', regionIds: [regionId], labelIds: [],
      location: { source: 'user' as const, kind: 'user-picked' as const,
        coordinate: { latitude: 26.33, longitude: 127.92 } },
    }
    await places.create(input)
    const nearby = { ...input.location, coordinate: { latitude: 26.3302, longitude: 127.92 } }
    const far = { ...input.location, coordinate: { latitude: 26.34, longitude: 127.92 } }
    await expect(places.create({ ...input, name: '其他入口', location: nearby }))
      .rejects.toThrow('和「原地點」距離不到 50 公尺')
    await expect(places.create({ ...input, location: far }))
      .rejects.toThrow('和「原地點」名稱相同')
    const second = await places.create({ ...input, name: '第二地點', location: far })
    await expect(places.update(second, { name: '原地點' })).rejects.toThrow('名稱相同')
    await expect(places.update(second, { location: nearby })).rejects.toThrow('距離不到 50 公尺')
    expect(await places.getById(second)).toMatchObject({ name: '第二地點', location: far })
    await database.places.add({ ...input, id: 'legacy-copy', name: '舊副本', location: nearby })
    await expect(places.update('legacy-copy', { notes: '保留既有資料的備註修改' })).resolves.toBeUndefined()
    await expect(places.update('legacy-copy', { name: '改名後仍過近' })).rejects.toThrow('距離不到 50 公尺')
    expect(await database.places.count()).toBe(3)
  })
})

it('allows independent Japan and Okinawa copies, and still rejects duplicates within Japan',async()=>{
  const {osmRegion}=await import('../geo/osm-datasets')
  const database=new TravelDatabase(crypto.randomUUID())
  try{
    await database.open()
    const regionRepository=new RegionRepository(database),placeRepository=new PlaceRepository(database)
    const jp=await regionRepository.create(osmRegion('japan'))
    const ok=await regionRepository.create({...osmRegion('okinawa'),name:'沖繩複本'})
    const input={name:'那霸',location:{source:'user' as const,kind:'user-picked' as const,coordinate:{latitude:26.2124,longitude:127.6809}},labelIds:[]}
    const first=await placeRepository.create({...input,regionIds:[ok]})
    const second=await placeRepository.create({...input,regionIds:[jp]})
    expect(first).not.toBe(second)
    await expect(placeRepository.create({...input,name:'日本附近重複',regionIds:[jp]})).rejects.toThrow('50 公尺')
    expect(await database.places.count()).toBe(2)
  }finally{database.close();await database.delete()}
})
