import { beforeEach, expect, it, vi } from 'vitest'
import type { Place } from '../../database/models'
import type { GooglePlaceDetails } from '../place/google-places.service'
import type { StoredLocation } from '../../geo/contracts'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), getById: vi.fn(), details: vi.fn(), estimate: vi.fn(),
  trips: vi.fn(), items: vi.fn(),
  routeMapCreate: vi.fn(), routeMapUpdate: vi.fn(), routeMapGet: vi.fn(), routeMapList: vi.fn(), routeMapFindByTrip: vi.fn(),
  routeMapPlaceCreate: vi.fn(), routeMapPlaceDelete: vi.fn(), routeMapPlaceFind: vi.fn(),
  sharedTrips: vi.fn(),
  provider: vi.fn(), osmEstimate: vi.fn(),
}))
vi.mock('../../geo/provider-preference', () => ({ getMapProvider: mocks.provider }))
vi.mock('../../geo/osm-service', () => ({ routeOsmLocations: mocks.osmEstimate }))
vi.mock('../../database/shared-trip.types', () => ({ sharedTripEditingEnabled: true }))
vi.mock('../../database/shared-trip.repository', () => ({ sharedTrips: { list: mocks.sharedTrips } }))
vi.mock('../../database', async () => ({
  ...await import('../../database/errors'),
  places: { list: mocks.list, getById: mocks.getById },
  trips: { list: mocks.trips },
  itineraryItems: { findByTripId: mocks.items },
  routeMaps: {
    create: mocks.routeMapCreate, update: mocks.routeMapUpdate, getById: mocks.routeMapGet,
    list: mocks.routeMapList, findByTripId: mocks.routeMapFindByTrip,
  },
  routeMapPlaces: {
    create: mocks.routeMapPlaceCreate, delete: mocks.routeMapPlaceDelete, findByRouteMapId: mocks.routeMapPlaceFind,
  },
}))
vi.mock('../place/google-places.service', () => ({
  getGooglePlaceDetails: mocks.details,
  getGoogleRouteEstimate: mocks.estimate,
  isGooglePlacesConfigured: () => true,
  mountPlaceAutocomplete: vi.fn(),
}))

import { RouteCalculatorService } from './route-calculator.service'
import type { RouteCalculationInput } from './route-calculator.service'

const saved: Place = { id: 'saved', name: '已存車站', googlePlaceId: 'station', regionIds: [], labelIds: [] }
const google: GooglePlaceDetails = {
  id: 'cafe', displayName: 'Google 咖啡店', location: { lat: 25.03, lng: 121.56 },
}
const input: RouteCalculationInput = {
  origin: { source: 'saved', placeId: saved.id },
  destination: { source: 'google', place: google },
  transport: 'WALKING',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.provider.mockReturnValue('google')
  mocks.osmEstimate.mockResolvedValue({ durationMinutes: 9, distanceMeters: 650 })
  mocks.list.mockResolvedValue([saved])
  mocks.getById.mockResolvedValue(saved)
  mocks.details.mockResolvedValue({ id: 'station', location: { lat: 25.04, lng: 121.55 } })
  mocks.estimate.mockResolvedValue({ durationMinutes: 12, distanceMeters: 800 })
  mocks.items.mockResolvedValue([])
  mocks.trips.mockResolvedValue([])
  mocks.routeMapCreate.mockResolvedValue('map-id')
  mocks.routeMapUpdate.mockResolvedValue(undefined)
  mocks.routeMapGet.mockResolvedValue({ id: 'map-id', name: 'Map', transport: 'DRIVING' })
  mocks.routeMapList.mockResolvedValue([])
  mocks.routeMapFindByTrip.mockResolvedValue(undefined)
  mocks.routeMapPlaceCreate.mockResolvedValue('marker-id')
  mocks.routeMapPlaceDelete.mockResolvedValue(undefined)
  mocks.routeMapPlaceFind.mockResolvedValue([])
  mocks.sharedTrips.mockResolvedValue([])
})

const osmLocation: StoredLocation = {
  source: 'osm', kind: 'point', reference: { provider: 'osm', id: 'node/123' },
  coordinate: { latitude: 26.2, longitude: 127.7 }, datasetVersion: '2026-10-20',
}
const userLocation: StoredLocation = {
  source: 'user', kind: 'user-picked', coordinate: { latitude: 26.3, longitude: 127.8 },
}

it('routes OSM and user-defined endpoints without requesting Google details or routes', async () => {
  mocks.provider.mockReturnValue('osm')
  mocks.getById.mockResolvedValue({ ...saved, googlePlaceId: undefined, location: osmLocation })
  const result = await new RouteCalculatorService().calculate({
    ...input,
    destination: { source: 'osm', place: { id: 'coordinate:26.3,127.8', name: '海邊停車場', location: userLocation } },
  })
  expect(result).toMatchObject({
    provider: 'osm', durationMinutes: 9, distanceMeters: 650,
    origin: { id: 'osm:node/123', name: saved.name, location: osmLocation },
    destination: { name: '海邊停車場', location: userLocation },
  })
  expect(result.origin.googlePlaceId).toBeUndefined()
  expect(mocks.osmEstimate).toHaveBeenCalledExactlyOnceWith(osmLocation.coordinate, userLocation.coordinate, 'WALKING')
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it.each(['TRANSIT', 'TWO_WHEELER'])('explicitly rejects unsupported OSM transport %s before resolution', async transport => {
  mocks.provider.mockReturnValue('osm')
  await expect(new RouteCalculatorService().calculate({ ...input, transport })).rejects.toThrow('不支援')
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.osmEstimate).not.toHaveBeenCalled()
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('does not resolve Google-only endpoints or fall back to Google in OSM mode', async () => {
  mocks.provider.mockReturnValue('osm')
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('Google')
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.estimate).not.toHaveBeenCalled()
  expect(mocks.osmEstimate).not.toHaveBeenCalled()
})

it('preserves Google behavior for a saved place with both independent OSM and Google references', async () => {
  mocks.getById.mockResolvedValue({ ...saved, location: osmLocation })
  await new RouteCalculatorService().calculate(input)
  expect(mocks.estimate).toHaveBeenCalledWith('station', 'cafe', 'WALKING')
  expect(mocks.osmEstimate).not.toHaveBeenCalled()
})

it('persists neutral marker provenance and user names, never an OSM ID in googlePlaceId', async () => {
  const service = new RouteCalculatorService()
  const marker = await service.resolveEndpoint({ source: 'osm', place: { id: 'node/123', name: '入口', location: osmLocation } })
  await service.addRouteMapPlace('map-id', marker)
  expect(mocks.routeMapPlaceCreate).toHaveBeenCalledExactlyOnceWith({
    routeMapId: 'map-id', name: '入口', location: osmLocation,
  })
  mocks.routeMapPlaceFind.mockResolvedValue([{ id: 'marker-id', routeMapId: 'map-id', name: '入口', location: osmLocation }])
  const loaded = await service.loadRouteMap('map-id')
  expect(loaded.markers).toMatchObject([{
    id: 'osm:node/123', name: '入口', location: osmLocation,
    selection: { kind: 'route-map-place', routeMapPlaceId: 'marker-id' },
  }])
  await service.addRouteMapPlace('map-id', marker)
  expect(mocks.routeMapPlaceCreate).toHaveBeenCalledTimes(1)
  await service.removeRouteMapPlace('map-id', 'osm:node/123')
  expect(mocks.routeMapPlaceDelete).toHaveBeenCalledWith('marker-id')
  expect(mocks.details).not.toHaveBeenCalled()
})

it('restores coordinate-only markers without scanning saved places or requesting Google', async () => {
  mocks.provider.mockReturnValue('osm')
  mocks.routeMapPlaceFind.mockResolvedValue([
    { id: 'osm-marker', name: '入口', location: osmLocation },
    { id: 'user-marker', name: '停車場', location: userLocation },
  ])
  const loaded = await new RouteCalculatorService().loadRouteMap('map-id')
  expect(loaded.markers.map(marker => marker.name)).toEqual(['入口', '停車場'])
  expect(loaded.unavailable).toEqual([])
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.details).not.toHaveBeenCalled()
})

it('keeps valid restored markers when another marker has invalid stored coordinates', async () => {
  mocks.provider.mockReturnValue('osm')
  mocks.routeMapPlaceFind.mockResolvedValue([
    { id: 'invalid', name: '損壞地點', location: { ...userLocation, coordinate: { latitude: 200, longitude: 127.8 } } },
    { id: 'valid', name: '停車場', location: userLocation },
  ])
  const loaded = await new RouteCalculatorService().loadRouteMap('map-id')
  expect(loaded.markers.map(marker => marker.name)).toEqual(['停車場'])
  expect(loaded.unavailable).toHaveLength(1)
  expect(loaded.unavailable[0]).toContain('損壞地點')
  expect(mocks.details).not.toHaveBeenCalled()
})

it('reads each unique scheduled OSM place once regardless of repeated itinerary items', async () => {
  mocks.provider.mockReturnValue('osm')
  mocks.items.mockResolvedValue([
    { placeId: 'first', date: '2026-10-23' },
    { placeId: 'first', date: '2026-10-24' },
    { placeId: 'second', date: '2026-10-24' },
  ])
  mocks.getById.mockImplementation(async (id: string) => ({
    ...saved, id, name: id, googlePlaceId: undefined,
    location: id === 'first' ? osmLocation : userLocation,
  }))
  const loaded = await new RouteCalculatorService().loadTripMarkers('trip')
  expect(mocks.getById.mock.calls).toEqual([['first'], ['second']])
  expect(loaded.markers).toHaveLength(2)
  expect(loaded.markers.find(marker => marker.name === 'first')?.dates).toEqual(['2026-10-23', '2026-10-24'])
  expect(loaded.unavailable).toEqual([])
  expect(mocks.details).not.toHaveBeenCalled()
})

it('resolves all four persisted neutral endpoint kinds through the facade', async () => {
  mocks.provider.mockReturnValue('osm')
  mocks.getById.mockResolvedValue({ ...saved, location: osmLocation })
  mocks.sharedTrips.mockResolvedValue([{
    id: 'shared-trip', document: {
      places: [{ id: 'shared-place', name: '共同入口', location: osmLocation }], items: [],
    },
  }])
  mocks.routeMapList.mockResolvedValue([{ id: 'map-id' }])
  mocks.routeMapPlaceFind.mockResolvedValue([{ id: 'marker-id', name: '後加入口', location: userLocation }])
  const service = new RouteCalculatorService()
  await expect(service.resolveEndpoint({ source: 'selection', selection: { kind: 'place', placeId: 'saved' } })).resolves.toMatchObject({ name: saved.name, location: osmLocation })
  await expect(service.resolveEndpoint({ source: 'selection', selection: { kind: 'shared-place', tripId: 'shared-trip', placeId: 'shared-place' } })).resolves.toMatchObject({ name: '共同入口', location: osmLocation })
  await expect(service.resolveEndpoint({ source: 'selection', selection: { kind: 'route-map-place', routeMapPlaceId: 'marker-id' } })).resolves.toMatchObject({ name: '後加入口', location: userLocation })
  await expect(service.resolveEndpoint({ source: 'selection', selection: {
    kind: 'location', id: 'location-id', value: { kind: 'stored', name: '自行命名', location: userLocation },
  } })).resolves.toMatchObject({ name: '自行命名', location: userLocation })
  expect(mocks.details).not.toHaveBeenCalled()
})

it('does not reinterpret missing shared endpoints as private place IDs', async () => {
  mocks.getById.mockResolvedValue({ ...saved, id: 'missing', location: osmLocation })
  await expect(new RouteCalculatorService().resolveEndpoint({ source: 'selection', selection: {
    kind: 'shared-place', tripId: 'shared-trip', placeId: 'missing',
  } })).rejects.toThrow('找不到共同行程地點「missing」')
  expect(mocks.getById).not.toHaveBeenCalled()
})

it('propagates OSM service failure without falling back to Google', async () => {
  mocks.provider.mockReturnValue('osm')
  mocks.osmEstimate.mockRejectedValue(new Error('OSM 離線'))
  await expect(new RouteCalculatorService().calculate({
    ...input, origin: { source: 'osm', place: { id: 'node/123', name: '入口', location: osmLocation } },
    destination: { source: 'osm', place: { id: 'user', name: '終點', location: userLocation } },
  })).rejects.toThrow('OSM 離線')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('uses the current shared itinerary and its names rather than retained private items', async () => {
  mocks.sharedTrips.mockResolvedValue([{
    id: 'shared-trip', version: '2', document: {
      places: [{ id: 'shared-place', name: 'Shared park', googlePlaceId: 'shared-google' }],
      items: [{ id: 'shared-item', placeId: 'shared-place', date: '2026-10-20', order: 0 }],
    },
  }])
  mocks.details.mockResolvedValue({ id: 'shared-google', displayName: 'Provider name', location: { lat: 25, lng: 121 } })
  const result = await new RouteCalculatorService().loadTripMarkers('shared-trip')
  expect(result.markers).toEqual([expect.objectContaining({
    name: 'Shared park', googlePlaceId: 'shared-google', dates: ['2026-10-20'],
  })])
  expect(mocks.items).not.toHaveBeenCalled()
  expect(mocks.getById).not.toHaveBeenCalled()
})

it('reads all saved places through the existing repository without filtering by trip region', async () => {
  expect(await new RouteCalculatorService().listPlaces()).toEqual([saved])
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith()
})

it('supports mixed endpoint sources and reuses coordinates from an already selected Google result', async () => {
  const result = await new RouteCalculatorService().calculate(input)
  expect(result).toMatchObject({
    durationMinutes: 12, distanceMeters: 800, transport: 'WALKING',
    origin: { googlePlaceId: 'station', name: saved.name },
    destination: { googlePlaceId: 'cafe', name: google.displayName, position: google.location },
  })
  expect(mocks.details).toHaveBeenCalledExactlyOnceWith('station')
  expect(mocks.estimate).toHaveBeenCalledExactlyOnceWith('station', 'cafe', 'WALKING')
})

it('supports two freely searched endpoints without database lookup or detail refetches', async () => {
  const other: GooglePlaceDetails = { id: 'other', displayName: '終點', location: { lat: 24, lng: 121 } }
  await new RouteCalculatorService().calculate({
    origin: { source: 'google', place: google },
    destination: { source: 'google', place: other },
    transport: 'TRANSIT',
  })
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.estimate).toHaveBeenCalledWith('cafe', 'other', 'TRANSIT')
})

it('supports two saved endpoints through current repository data', async () => {
  mocks.getById.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, id: 'second', googlePlaceId: 'second-google' })
  mocks.details.mockImplementation(async (id: string) => ({ id, location: { lat: 25, lng: 121 } }))
  await new RouteCalculatorService().calculate({
    ...input, destination: { source: 'saved', placeId: 'second' },
  })
  expect(mocks.estimate).toHaveBeenCalledWith('station', 'second-google', 'WALKING')
})

it('does not request a route for a deleted saved place', async () => {
  mocks.getById.mockResolvedValue(undefined)
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow()
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('explains why custom-URL-only places cannot be used', async () => {
  mocks.getById.mockResolvedValue({ ...saved, googlePlaceId: undefined, mapsUrl: 'https://maps.google.com/' })
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('請改用 Google 搜尋')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it.each(['', 'FLYING', 'driving'])('rejects unsupported transport %s before external lookups', async (transport) => {
  await expect(new RouteCalculatorService().calculate({ ...input, transport })).rejects.toThrow('交通方式')
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('rejects a selected place without usable coordinates', async () => {
  mocks.details.mockResolvedValue({ id: 'station', location: { lat: NaN, lng: 121 } })
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('地圖位置')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('surfaces provider failures instead of returning a successful-looking estimate', async () => {
  mocks.estimate.mockRejectedValue(new Error('no route'))
  await expect(new RouteCalculatorService().calculate(input)).rejects.toThrow('no route')
})

it('resolves marker endpoints without reading or writing saved places', async () => {
  await new RouteCalculatorService().calculate({ ...input, origin: { source: 'google', place: { ...google, id: 'marker' } } })
  expect(mocks.getById).not.toHaveBeenCalled()
  expect(mocks.details).not.toHaveBeenCalled()
  expect(mocks.estimate).toHaveBeenCalledWith('marker', 'cafe', 'WALKING')
})

it('rejects the same Google location across different endpoint sources before requesting routes', async () => {
  await expect(new RouteCalculatorService().calculate({
    ...input, origin: { source: 'google', place: google },
  })).rejects.toThrow('起點與終點相同')
  expect(mocks.estimate).not.toHaveBeenCalled()
})

it('loads only scheduled places and reports unavailable locations explicitly', async () => {
  mocks.items.mockResolvedValue([
    { placeId: 'saved', date: '2026-10-19' },
    { placeId: 'saved', date: '2026-10-18' },
    { placeId: 'custom', date: '2026-10-18' },
  ])
  mocks.getById.mockImplementation(async (id: string) => id === 'saved' ? saved : { ...saved, id, name: '自訂地點', googlePlaceId: undefined })
  const data = await new RouteCalculatorService().loadTripMarkers('trip')
  expect(mocks.items).toHaveBeenCalledExactlyOnceWith('trip')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(data.dates).toEqual(['2026-10-18', '2026-10-19'])
  expect(data.markers).toHaveLength(1)
  expect(data.markers[0].dates).toEqual(['2026-10-19', '2026-10-18'])
  expect(data.unavailable).toHaveLength(1)
  expect(data.unavailable[0]).toContain('自訂地點')
})

it('shares detail requests only within a service instance and retries failed requests', async () => {
  const service = new RouteCalculatorService()
  await Promise.all([service.resolveEndpoint(input.origin), service.resolveEndpoint(input.origin)])
  expect(mocks.details).toHaveBeenCalledTimes(1)
  await new RouteCalculatorService().resolveEndpoint(input.origin)
  expect(mocks.details).toHaveBeenCalledTimes(2)
  const other = new RouteCalculatorService()
  mocks.details.mockRejectedValueOnce(new Error('temporary'))
  await expect(other.resolveEndpoint(input.origin)).rejects.toThrow('temporary')
  await expect(other.resolveEndpoint(input.origin)).resolves.toMatchObject({ googlePlaceId: 'station' })
})

it('surfaces trip repository failures rather than returning empty success', async () => {
  mocks.items.mockRejectedValue(new Error('read failed'))
  await expect(new RouteCalculatorService().loadTripMarkers('trip')).rejects.toThrow('read failed')
})

it('reads trips through the existing facade', async () => {
  mocks.trips.mockResolvedValue([{ id: 'trip', name: '旅行' }])
  expect(await new RouteCalculatorService().listTrips()).toEqual([{ id: 'trip', name: '旅行' }])
})

it('reuses the trip map and creates a linked map only when one does not exist', async () => {
  const existing = { id: 'existing-map', name: 'Trip map', tripId: 'trip', transport: 'WALKING' }
  mocks.routeMapFindByTrip.mockResolvedValueOnce(existing).mockResolvedValueOnce(undefined)
  mocks.trips.mockResolvedValue([{ id: 'trip', name: '旅行' }])

  await expect(new RouteCalculatorService().getOrCreateRouteMap('trip')).resolves.toEqual(existing)
  expect(mocks.routeMapCreate).not.toHaveBeenCalled()

  mocks.routeMapCreate.mockResolvedValueOnce('new-map')
  mocks.routeMapGet.mockResolvedValueOnce({ id: 'new-map', name: '旅行 路程試算', tripId: 'trip', transport: 'DRIVING' })
  await expect(new RouteCalculatorService().getOrCreateRouteMap('trip')).resolves.toMatchObject({
    tripId: 'trip', name: '旅行 路程試算',
  })
  expect(mocks.routeMapCreate).toHaveBeenCalledWith({
    name: '旅行 路程試算', tripId: 'trip', transport: 'DRIVING',
  })
})

it('restores an unambiguous map when no device-local active map is available', async () => {
  const standalone = { id: 'standalone', name: 'Independent map', transport: 'DRIVING' }
  mocks.routeMapList.mockResolvedValueOnce([standalone, { id: 'trip-map', name: 'Trip', tripId: 'trip', transport: 'WALKING' }])
  await expect(new RouteCalculatorService().getInitialRouteMap()).resolves.toEqual(standalone)

  mocks.routeMapList.mockResolvedValueOnce([
    { id: 'trip-a', name: 'Trip A', tripId: 'a', transport: 'DRIVING' },
    { id: 'trip-b', name: 'Trip B', tripId: 'b', transport: 'DRIVING' },
  ])
  await expect(new RouteCalculatorService().getInitialRouteMap()).resolves.toBeUndefined()
})

it('persists only a Google place ID for an added route-map marker and loads its location on demand', async () => {
  const map = { id: 'map-id', name: 'Map', transport: 'DRIVING' }
  mocks.routeMapGet.mockResolvedValue(map)
  mocks.routeMapPlaceFind.mockResolvedValueOnce([])
  await new RouteCalculatorService().addRouteMapPlace('map-id', 'station')
  expect(mocks.routeMapPlaceCreate).toHaveBeenCalledWith({ routeMapId: 'map-id', googlePlaceId: 'station' })

  mocks.routeMapPlaceFind.mockResolvedValue([{ id: 'marker-id', routeMapId: 'map-id', googlePlaceId: 'station' }])
  const service = new RouteCalculatorService()
  const loaded = await service.loadRouteMap('map-id')
  expect(loaded.map).toEqual(map)
  expect(loaded.markers).toMatchObject([{ googlePlaceId: 'station', name: saved.name, position: { lat: 25.04, lng: 121.55 } }])
  expect(mocks.details).toHaveBeenCalledWith('station')
})

it('limits concurrent Google detail requests when loading a large trip', async () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ placeId: `p${index}`, date: '2026-10-18' }))
  mocks.items.mockResolvedValue(items)
  mocks.getById.mockImplementation(async (id: string) => ({ ...saved, id, googlePlaceId: id }))
  let active = 0
  let maximum = 0
  mocks.details.mockImplementation(async (id: string) => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 0))
    active -= 1
    return { id, location: { lat: 25, lng: 121 } }
  })
  const data = await new RouteCalculatorService().loadTripMarkers('trip')
  expect(data.markers).toHaveLength(8)
  expect(maximum).toBeLessThanOrEqual(3)
})
