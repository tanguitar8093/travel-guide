import {
  EntityNotFoundError,
  ValidationError,
  places,
  trips,
  itineraryItems,
  routeMaps,
  routeMapPlaces,
} from '../../database'
import type {
  Place,
  RouteMap as RouteMapRecord,
  RouteMapChanges,
} from '../../database'
import { isGoogleTravelMode } from '../../common/route-estimate'
import { sharedTripEditingEnabled } from '../../database/shared-trip.types'
import { sharedTrips } from '../../database/shared-trip.repository'
import type { GeoProvider, RouteEndpointSelection, StoredLocation } from '../../geo/contracts'
import { getMapProvider } from '../../geo/provider-preference'
import { routeOsmLocations } from '../../geo/osm-service'
import type { OsmLocationCandidate } from '../../geo/osm-service'
import { validateStoredLocation } from '../../database/location.validation'
import { markerKey } from './route-markers'
export { markerKey, storedEndpoint } from './route-markers'
import {
  getGooglePlaceDetails,
  getGoogleRouteEstimate,
  isGooglePlacesConfigured,
  mountPlaceAutocomplete,
} from '../place/google-places.service'
import type {
  GoogleMapPosition,
  GooglePlaceDetails,
  GoogleRouteEstimate,
  GoogleTravelMode,
} from '../place/google-places.service'

export type RouteEndpoint =
  | { source: 'saved'; placeId: string }
  | { source: 'google'; place: GooglePlaceDetails }
  | { source: 'osm'; place: OsmLocationCandidate }
  | { source: 'selection'; selection: RouteEndpointSelection; name?: string }

export interface RouteMapPlace extends ResolvedRouteEndpoint {
  address?: string
}

export interface TripMapData {
  dates: string[]
  markers: (RouteMapPlace & { dates: string[] })[]
  unavailable: string[]
}

export interface RouteMapData {
  map: RouteMapRecord
  markers: RouteMapPlace[]
  unavailable: string[]
}

export interface ResolvedRouteEndpoint {
  id?: string
  googlePlaceId?: string
  location?: StoredLocation
  selection?: RouteEndpointSelection
  name: string
  position: GoogleMapPosition
}

export interface RouteCalculationInput {
  origin: RouteEndpoint
  destination: RouteEndpoint
  transport: string
  provider?: GeoProvider
}

export interface RouteCalculationResult extends GoogleRouteEstimate {
  origin: ResolvedRouteEndpoint
  destination: ResolvedRouteEndpoint
  transport: GoogleTravelMode
  provider?: GeoProvider
}

export class RouteCalculatorService {
  private readonly detailsCache = new Map<string, Promise<GooglePlaceDetails>>()
  private readonly placeRepository: Pick<typeof places, 'list' | 'getById'>
  private readonly fetchDetails: typeof getGooglePlaceDetails
  private readonly estimateRoute: typeof getGoogleRouteEstimate
  private readonly tripRepository: Pick<typeof trips, 'list'>
  private readonly itemRepository: Pick<typeof itineraryItems, 'findByTripId'>
  private readonly routeMapRepository: Pick<typeof routeMaps, 'create' | 'update' | 'getById' | 'list' | 'findByTripId'>
  private readonly routeMapPlaceRepository: Pick<typeof routeMapPlaces, 'create' | 'delete' | 'findByRouteMapId'>
  private readonly estimateOsmRoute: typeof routeOsmLocations

  constructor(
    placeRepository: Pick<typeof places, 'list' | 'getById'> = places,
    fetchDetails = getGooglePlaceDetails,
    estimateRoute = getGoogleRouteEstimate,
    tripRepository: Pick<typeof trips, 'list'> = trips,
    itemRepository: Pick<typeof itineraryItems, 'findByTripId'> = itineraryItems,
    routeMapRepository: Pick<typeof routeMaps, 'create' | 'update' | 'getById' | 'list' | 'findByTripId'> = routeMaps,
    routeMapPlaceRepository: Pick<typeof routeMapPlaces, 'create' | 'delete' | 'findByRouteMapId'> = routeMapPlaces,
    estimateOsmRoute: typeof routeOsmLocations = routeOsmLocations,
  ) {
    this.placeRepository = placeRepository
    this.fetchDetails = fetchDetails
    this.estimateRoute = estimateRoute
    this.tripRepository = tripRepository
    this.itemRepository = itemRepository
    this.routeMapRepository = routeMapRepository
    this.routeMapPlaceRepository = routeMapPlaceRepository
    this.estimateOsmRoute = estimateOsmRoute
  }

  listTrips() {
    return this.tripRepository.list()
  }

  async getRouteMap(id: string): Promise<RouteMapRecord> {
    const map = await this.routeMapRepository.getById(id)
    if (!map) throw new EntityNotFoundError('Route map', id)
    return map
  }

  async getInitialRouteMap(): Promise<RouteMapRecord | undefined> {
    const maps = await this.routeMapRepository.list()
    if (maps.length === 1) return maps[0]
    const standaloneMaps = maps.filter((map) => !map.tripId)
    return standaloneMaps.length === 1 ? standaloneMaps[0] : undefined
  }

  async getOrCreateRouteMap(tripId?: string): Promise<RouteMapRecord> {
    if (tripId) {
      const existing = await this.routeMapRepository.findByTripId(tripId)
      if (existing) return existing
    } else {
      const existing = (await this.routeMapRepository.list()).find((map) => !map.tripId)
      if (existing) return existing
    }
    const trip = tripId ? (await this.tripRepository.list()).find((record) => record.id === tripId) : undefined
    if (tripId && !trip) throw new EntityNotFoundError('Trip', tripId)
    const id = await this.routeMapRepository.create({
      name: trip ? `${trip.name} 路程試算` : '路程試算',
      ...(tripId ? { tripId } : {}),
      transport: 'DRIVING',
    })
    return this.getRouteMap(id)
  }

  updateRouteMap(id: string, changes: RouteMapChanges): Promise<void> {
    return this.routeMapRepository.update(id, changes)
  }

  async loadRouteMap(id: string): Promise<RouteMapData> {
    const provider = getMapProvider()
    const [map, savedMarkers] = await Promise.all([
      this.getRouteMap(id),
      this.routeMapPlaceRepository.findByRouteMapId(id),
    ])
    const savedPlaces = savedMarkers.some(marker => !marker.location && marker.googlePlaceId)
      ? await this.placeRepository.list() : []
    const markers: RouteMapPlace[] = []
    const unavailable: string[] = []
    let cursor = 0
    const work = async () => {
      while (cursor < savedMarkers.length) {
        const savedMarker = savedMarkers[cursor++]
        try {
          if (savedMarker.location) {
            markers.push(this.storedMarker(savedMarker.id, savedMarker.name ?? '地點', savedMarker.location, { kind: 'route-map-place', routeMapPlaceId: savedMarker.id }))
            continue
          }
          if (!savedMarker.googlePlaceId) throw new ValidationError('缺少地圖位置。')
          const place = savedPlaces.find((candidate) => candidate.googlePlaceId === savedMarker.googlePlaceId)
          const resolved = place
            ? await this.resolveSavedPlace(place, provider)
            : await this.resolveEndpoint({
              source: 'google',
              place: { id: savedMarker.googlePlaceId },
            }, provider)
          markers.push({
            ...resolved,
            selection: { kind: 'route-map-place', routeMapPlaceId: savedMarker.id },
            ...(savedMarker.name ? { name: savedMarker.name } : {}),
          })
        } catch (cause) {
          unavailable.push(`${savedMarker.name ?? savedMarker.googlePlaceId ?? savedMarker.id}：${cause instanceof Error ? cause.message : '無法取得地圖位置'}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, savedMarkers.length) }, work))
    return { map, markers, unavailable }
  }

  async addRouteMapPlace(routeMapId: string, value: string | RouteMapPlace): Promise<void> {
    const googlePlaceId = typeof value === 'string' ? value : value.googlePlaceId
    const existing = await this.routeMapPlaceRepository.findByRouteMapId(routeMapId)
    if (googlePlaceId) {
      if (existing.some((place) => place.googlePlaceId === googlePlaceId)) return
      await this.routeMapPlaceRepository.create({ routeMapId, googlePlaceId })
      return
    }
    if (typeof value === 'string' || !value.location) throw new ValidationError('地點缺少可儲存的位置。')
    if (existing.some((place) => place.location && this.locationKey(place.location) === this.locationKey(value.location!))) return
    await this.routeMapPlaceRepository.create({ routeMapId, name: value.name, location: value.location })
  }

  async removeRouteMapPlace(routeMapId: string, googlePlaceId: string): Promise<void> {
    const existing = await this.routeMapPlaceRepository.findByRouteMapId(routeMapId)
    const marker = existing.find((place) => place.googlePlaceId === googlePlaceId || place.id === googlePlaceId || (place.location && this.locationKey(place.location) === googlePlaceId))
    if (!marker) throw new EntityNotFoundError('Route map place', googlePlaceId)
    await this.routeMapPlaceRepository.delete(marker.id)
  }

  private details(id: string) {
    let request = this.detailsCache.get(id)
    if (!request) {
      request = this.fetchDetails(id).catch((error: unknown) => {
        this.detailsCache.delete(id)
        throw error
      })
      this.detailsCache.set(id, request)
    }
    return request
  }

  async loadTripMarkers(tripId: string): Promise<TripMapData> {
    const provider = getMapProvider()
    const shared = sharedTripEditingEnabled ? (await sharedTrips.list()).find((row) => row.id === tripId)?.document : undefined
    const items = shared?.items ?? await this.itemRepository.findByTripId(tripId)
    const dates = [...new Set(items.map((item) => item.date))].sort()
    const placeIds = [...new Set(items.map((item) => item.placeId))]
    const markers: TripMapData['markers'] = []
    const unavailable: string[] = []
    let cursor = 0
    const work = async () => {
      while (cursor < placeIds.length) {
        const id = placeIds[cursor++]
        const place = shared ? shared.places.find((row) => row.id === id) : await this.placeRepository.getById(id)
        if (!place) { unavailable.push(`已不存在的地點（${id}）`); continue }
        try {
          const sharedLocation = shared ? this.sharedPlaceLocation(place) : undefined
          const resolved = shared
            ? sharedLocation
              ? this.storedMarker(place.id, place.name, sharedLocation, { kind: 'shared-place', tripId, placeId: place.id })
              : place.googlePlaceId
              ? await this.resolveEndpoint({ source: 'google', place: { id: place.googlePlaceId } }, provider)
              : undefined
            : await this.resolveSavedPlace(place, provider)
          if (!resolved) { unavailable.push(`${place.name}：只有自訂地圖網址，無法取得試算圖釘位置。`); continue }
          markers.push({ ...resolved, selection: shared ? { kind: 'shared-place', tripId, placeId: id } : { kind: 'place', placeId: id }, ...(shared ? { name: place.name } : {}), dates: items.filter((item) => item.placeId === id).map((item) => item.date) })
        } catch (cause) {
          unavailable.push(`${place.name}：${cause instanceof Error ? cause.message : '無法取得地圖位置'}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, placeIds.length) }, work))
    return { dates, markers, unavailable }
  }

  listPlaces() {
    return this.placeRepository.list()
  }

  isGooglePlacesConfigured() {
    return isGooglePlacesConfigured()
  }

  mountAutocomplete(
    ...args: Parameters<typeof mountPlaceAutocomplete>
  ) {
    return mountPlaceAutocomplete(...args)
  }

  async resolveEndpoint(endpoint: RouteEndpoint, provider = getMapProvider()): Promise<RouteMapPlace> {
    if (endpoint.source === 'osm') return this.storedMarker(endpoint.place.id, endpoint.place.name, endpoint.place.location)
    if (endpoint.source === 'selection') return this.resolveSelection(endpoint.selection, provider)
    if (endpoint.source === 'saved') {
      const place = await this.placeRepository.getById(endpoint.placeId)
      if (!place) throw new EntityNotFoundError('Place', endpoint.placeId)
      return this.resolveSavedPlace(place, provider)
    }
    if (provider === 'osm') throw new ValidationError('此地點僅有 Google 資訊，請使用 OSM 搜尋或自行輸入座標。')
    if (!endpoint.place.id.trim()) throw new ValidationError('請從 Google 搜尋結果選擇地點。')
    const details = endpoint.place.location
      ? endpoint.place
      : await this.details(endpoint.place.id)
    const position = details.location
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng) ||
        Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
      this.detailsCache.delete(details.id)
      throw new ValidationError('地點缺少有效的地圖位置，請重新選擇。')
    }
    return {
      googlePlaceId: details.id,
      name: details.displayName ?? details.formattedAddress ?? 'Google 地點',
      position,
      address: details.formattedAddress,
    }
  }

  private async resolveSavedPlace(place: Pick<Place, 'id' | 'name' | 'googlePlaceId' | 'location'>, provider: GeoProvider): Promise<RouteMapPlace> {
    if (place.location && (provider === 'osm' || !place.googlePlaceId)) {
      return this.storedMarker(place.id, place.name, place.location, { kind: 'place', placeId: place.id })
    }
    if (!place.googlePlaceId) {
      throw new ValidationError(`「${place.name}」沒有 Google 地點資訊，請改用 Google 搜尋選擇。`)
    }
    const resolved = await this.resolveEndpoint({ source: 'google', place: { id: place.googlePlaceId } }, provider)
    return { ...resolved, name: place.name }
  }

  async calculate(input: RouteCalculationInput): Promise<RouteCalculationResult> {
    if (!isGoogleTravelMode(input.transport)) throw new ValidationError('請選擇有效的交通方式。')
    const provider = input.provider ?? getMapProvider()
    if (provider === 'osm' && !['DRIVING', 'WALKING', 'BICYCLING'].includes(input.transport)) throw new ValidationError('OSM 不支援此交通方式，不會自動切回 Google。')
    const [origin, destination] = await Promise.all([
      this.resolveEndpoint(input.origin, provider),
      this.resolveEndpoint(input.destination, provider),
    ])
    if (markerKey(origin) === markerKey(destination)) {
      throw new ValidationError('起點與終點相同，請選擇不同的地點。')
    }
    if (provider === 'osm') {
      if (!origin.location || !destination.location) throw new ValidationError('OSM 路線需要地圖座標；Google 地點不會傳送至 OSM。')
      const estimate = await this.estimateOsmRoute(origin.location.coordinate, destination.location.coordinate, input.transport)
      return { ...estimate, origin, destination, transport: input.transport, provider }
    }
    if (!origin.googlePlaceId || !destination.googlePlaceId) throw new ValidationError('Google 路線需要 Google 地點；請切換 OSM 或重新選擇。')
    const estimate = await this.estimateRoute(origin.googlePlaceId, destination.googlePlaceId, input.transport)
    return { ...estimate, origin, destination, transport: input.transport, provider }
  }

  private locationKey(location: StoredLocation): string {
    return location.source === 'osm' ? `osm:${location.reference.id}` : `coordinate:${location.coordinate.latitude},${location.coordinate.longitude}`
  }

  private storedMarker(_id: string, name: string, location: StoredLocation, selection?: RouteEndpointSelection): RouteMapPlace {
    validateStoredLocation(location)
    const { latitude, longitude } = location.coordinate
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new ValidationError('地點缺少有效的地圖位置，請重新選擇。')
    return { id: this.locationKey(location), name, location, position: { lat: latitude, lng: longitude }, selection }
  }

  private async resolveSelection(selection: RouteEndpointSelection, provider: GeoProvider): Promise<RouteMapPlace> {
    if (selection.kind === 'place') return this.resolveEndpoint({ source: 'saved', placeId: selection.placeId }, provider)
    if (selection.kind === 'shared-place') {
      if (!sharedTripEditingEnabled) throw new ValidationError('共同行程功能目前無法使用。')
      const shared = (await sharedTrips.list()).find((row) => row.id === selection.tripId)?.document
      const place = shared?.places.find((row) => row.id === selection.placeId)
      if (!place) throw new EntityNotFoundError('Shared place', selection.placeId)
      const sharedLocation = this.sharedPlaceLocation(place)
      if (sharedLocation && (provider === 'osm' || !place.googlePlaceId)) return this.storedMarker(place.id, place.name, sharedLocation, selection)
      if (place.googlePlaceId) return { ...await this.resolveEndpoint({ source: 'google', place: { id: place.googlePlaceId } }, provider), name: place.name, selection }
      throw new ValidationError('共同行程地點缺少地圖位置。')
    }
    if (selection.kind === 'route-map-place') {
      const maps = await this.routeMapRepository.list()
      for (const map of maps) {
        const place = (await this.routeMapPlaceRepository.findByRouteMapId(map.id)).find((row) => row.id === selection.routeMapPlaceId)
        if (!place) continue
        if (place.location) return this.storedMarker(place.id, place.name ?? '地點', place.location, selection)
        if (place.googlePlaceId) return { ...await this.resolveEndpoint({ source: 'google', place: { id: place.googlePlaceId } }, provider), selection }
      }
      throw new EntityNotFoundError('Route map place', selection.routeMapPlaceId)
    }
    if (selection.value.kind === 'stored') return this.storedMarker(selection.id, selection.value.name, selection.value.location, selection)
    return { ...await this.resolveEndpoint({ source: 'google', place: { id: selection.value.reference.id, displayName: selection.value.name } }, provider), selection }
  }

  private sharedPlaceLocation(value: unknown): StoredLocation | undefined {
    if (typeof value !== 'object' || value === null || !('location' in value)) return undefined
    const location = (value as { location?: unknown }).location
    if (!location) return undefined
    validateStoredLocation(location)
    return location
  }
}
