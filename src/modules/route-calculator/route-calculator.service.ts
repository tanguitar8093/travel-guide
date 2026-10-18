import { EntityNotFoundError, ValidationError, places } from '../../database'
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
  constructor(
    private readonly placeRepository = places,
    private readonly fetchDetails = getGooglePlaceDetails,
    private readonly estimateRoute = getGoogleRouteEstimate,
  ) {}

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

  private async resolveEndpoint(endpoint: RouteEndpoint): Promise<ResolvedRouteEndpoint> {
    let details: GooglePlaceDetails
    let name: string | undefined
    if (endpoint.source === 'saved') {
      const place = await this.placeRepository.getById(endpoint.placeId)
      if (!place) throw new EntityNotFoundError('Place', endpoint.placeId)
      if (!place.googlePlaceId) {
        throw new ValidationError(`「${place.name}」沒有 Google 地點資訊，請改用 Google 搜尋選擇。`)
      }
      details = await this.fetchDetails(place.googlePlaceId)
      name = place.name
    } else {
      if (!endpoint.place.id.trim()) throw new ValidationError('請從 Google 搜尋結果選擇地點。')
      details = endpoint.place.location
        ? endpoint.place
        : await this.fetchDetails(endpoint.place.id)
    }
    const position = details.location
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng) ||
        Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
      throw new ValidationError('地點缺少有效的地圖位置，請重新選擇。')
    }
    return {
      googlePlaceId: details.id,
      name: name ?? details.displayName ?? details.formattedAddress ?? 'Google 地點',
      position,
    }
  }

  async calculate(input: RouteCalculationInput): Promise<RouteCalculationResult> {
    if (!isGoogleTravelMode(input.transport)) throw new ValidationError('請選擇有效的交通方式。')
    const [origin, destination] = await Promise.all([
      this.resolveEndpoint(input.origin),
      this.resolveEndpoint(input.destination),
    ])
    const estimate = await this.estimateRoute(origin.googlePlaceId, destination.googlePlaceId, input.transport)
    return { ...estimate, origin, destination, transport: input.transport }
  }
}
