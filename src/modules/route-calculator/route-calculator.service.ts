import { EntityNotFoundError, ValidationError, places, trips, itineraryItems } from '../../database'
import { isGoogleTravelMode } from '../../common/route-estimate'
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

  constructor(
    private readonly placeRepository: Pick<typeof places, 'list' | 'getById'> = places,
    private readonly fetchDetails = getGooglePlaceDetails,
    private readonly estimateRoute = getGoogleRouteEstimate,
    private readonly tripRepository: Pick<typeof trips, 'list'> = trips,
    private readonly itemRepository: Pick<typeof itineraryItems, 'findByTripId'> = itineraryItems,
  ) {}

  listTrips() {
    return this.tripRepository.list()
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
    const items = await this.itemRepository.findByTripId(tripId)
    const dates = [...new Set(items.map((item) => item.date))].sort()
    const placeIds = [...new Set(items.map((item) => item.placeId))]
    const markers: TripMapData['markers'] = []
    const unavailable: string[] = []
    let cursor = 0
    const work = async () => {
      while (cursor < placeIds.length) {
        const id = placeIds[cursor++]
        const place = await this.placeRepository.getById(id)
        if (!place) { unavailable.push(`已不存在的地點（${id}）`); continue }
        try {
          const resolved = await this.resolveEndpoint({ source: 'saved', placeId: place.id })
          markers.push({ ...resolved, dates: items.filter((item) => item.placeId === id).map((item) => item.date) })
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
      throw new ValidationError('出發點與目的地相同，請選擇不同的地點。')
    }
    const estimate = await this.estimateRoute(origin.googlePlaceId, destination.googlePlaceId, input.transport)
    return { ...estimate, origin, destination, transport: input.transport }
  }
}
