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
  RouteMap as RouteMapRecord,
  RouteMapChanges,
} from '../../database'
import { isGoogleTravelMode } from '../../common/route-estimate'
import { sharedTripEditingEnabled } from '../../database/shared-trip.types'
import { sharedTrips } from '../../database/shared-trip.repository'
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
  googlePlaceId: string
  name: string
  position: GoogleMapPosition
}

export interface RouteCalculationInput {
  origin: RouteEndpoint
  destination: RouteEndpoint
  transport: string
}

export interface RouteCalculationResult extends GoogleRouteEstimate {
  origin: ResolvedRouteEndpoint
  destination: ResolvedRouteEndpoint
  transport: GoogleTravelMode
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

  constructor(
    placeRepository: Pick<typeof places, 'list' | 'getById'> = places,
    fetchDetails = getGooglePlaceDetails,
    estimateRoute = getGoogleRouteEstimate,
    tripRepository: Pick<typeof trips, 'list'> = trips,
    itemRepository: Pick<typeof itineraryItems, 'findByTripId'> = itineraryItems,
    routeMapRepository: Pick<typeof routeMaps, 'create' | 'update' | 'getById' | 'list' | 'findByTripId'> = routeMaps,
    routeMapPlaceRepository: Pick<typeof routeMapPlaces, 'create' | 'delete' | 'findByRouteMapId'> = routeMapPlaces,
  ) {
    this.placeRepository = placeRepository
    this.fetchDetails = fetchDetails
    this.estimateRoute = estimateRoute
    this.tripRepository = tripRepository
    this.itemRepository = itemRepository
    this.routeMapRepository = routeMapRepository
    this.routeMapPlaceRepository = routeMapPlaceRepository
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
    const [map, savedMarkers] = await Promise.all([
      this.getRouteMap(id),
      this.routeMapPlaceRepository.findByRouteMapId(id),
    ])
    const savedPlaces = savedMarkers.length ? await this.placeRepository.list() : []
    const markers: RouteMapPlace[] = []
    const unavailable: string[] = []
    let cursor = 0
    const work = async () => {
      while (cursor < savedMarkers.length) {
        const savedMarker = savedMarkers[cursor++]
        const place = savedPlaces.find((candidate) => candidate.googlePlaceId === savedMarker.googlePlaceId)
        try {
          const resolved = place
            ? await this.resolveEndpoint({ source: 'saved', placeId: place.id })
            : await this.resolveEndpoint({
              source: 'google',
              place: { id: savedMarker.googlePlaceId },
            })
          markers.push({
            ...resolved,
            ...(savedMarker.name ? { name: savedMarker.name } : {}),
          })
        } catch (cause) {
          unavailable.push(`${savedMarker.name ?? savedMarker.googlePlaceId}：${cause instanceof Error ? cause.message : '無法取得地圖位置'}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, savedMarkers.length) }, work))
    return { map, markers, unavailable }
  }

  async addRouteMapPlace(routeMapId: string, googlePlaceId: string): Promise<void> {
    const existing = await this.routeMapPlaceRepository.findByRouteMapId(routeMapId)
    if (existing.some((place) => place.googlePlaceId === googlePlaceId)) return
    await this.routeMapPlaceRepository.create({ routeMapId, googlePlaceId })
  }

  async removeRouteMapPlace(routeMapId: string, googlePlaceId: string): Promise<void> {
    const existing = await this.routeMapPlaceRepository.findByRouteMapId(routeMapId)
    const marker = existing.find((place) => place.googlePlaceId === googlePlaceId)
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
          const resolved = shared
            ? place.googlePlaceId
              ? await this.resolveEndpoint({ source: 'google', place: { id: place.googlePlaceId } })
              : undefined
            : await this.resolveEndpoint({ source: 'saved', placeId: place.id })
          if (!resolved) { unavailable.push(`${place.name}：只有自訂地圖網址，無法取得試算圖釘位置。`); continue }
          markers.push({ ...resolved, ...(shared ? { name: place.name } : {}), dates: items.filter((item) => item.placeId === id).map((item) => item.date) })
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

  async resolveEndpoint(endpoint: RouteEndpoint): Promise<RouteMapPlace> {
    let details: GooglePlaceDetails
    let name: string | undefined
    if (endpoint.source === 'saved') {
      const place = await this.placeRepository.getById(endpoint.placeId)
      if (!place) throw new EntityNotFoundError('Place', endpoint.placeId)
      if (!place.googlePlaceId) {
        throw new ValidationError(`「${place.name}」沒有 Google 地點資訊，請改用 Google 搜尋選擇。`)
      }
      details = await this.details(place.googlePlaceId)
      name = place.name
    } else {
      if (!endpoint.place.id.trim()) throw new ValidationError('請從 Google 搜尋結果選擇地點。')
      details = endpoint.place.location
        ? endpoint.place
        : await this.details(endpoint.place.id)
    }
    const position = details.location
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng) ||
        Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
      this.detailsCache.delete(details.id)
      throw new ValidationError('地點缺少有效的地圖位置，請重新選擇。')
    }
    return {
      googlePlaceId: details.id,
      name: name ?? details.displayName ?? details.formattedAddress ?? 'Google 地點',
      position,
      address: details.formattedAddress,
    }
  }

  async calculate(input: RouteCalculationInput): Promise<RouteCalculationResult> {
    if (!isGoogleTravelMode(input.transport)) throw new ValidationError('請選擇有效的交通方式。')
    const [origin, destination] = await Promise.all([
      this.resolveEndpoint(input.origin),
      this.resolveEndpoint(input.destination),
    ])
    if (origin.googlePlaceId === destination.googlePlaceId) {
      throw new ValidationError('起點與終點相同，請選擇不同的地點。')
    }
    const estimate = await this.estimateRoute(origin.googlePlaceId, destination.googlePlaceId, input.transport)
    return { ...estimate, origin, destination, transport: input.transport }
  }
}
