import type { RouteEndpointSelection } from '../geo/contracts'
import type { TravelDatabase } from './database'
import { EntityNotFoundError, ValidationError } from './errors'
import { validateStoredLocation } from './location.validation'
import type { RouteMap } from './models'
import type { SharedTripSnapshot } from './shared-trip.types'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('路線端點必須是物件。')
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new ValidationError('路線端點缺少必要欄位，或包含不支援的欄位。')
  }
}

function text(value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('路線端點的識別碼與名稱不可空白。')
}

export function validateRouteEndpoint(value: unknown): asserts value is RouteEndpointSelection {
  const endpoint = object(value)
  switch (endpoint.kind) {
    case 'place':
      keys(endpoint, ['kind', 'placeId'])
      text(endpoint.placeId)
      break
    case 'shared-place':
      keys(endpoint, ['kind', 'tripId', 'placeId'])
      text(endpoint.tripId)
      text(endpoint.placeId)
      break
    case 'route-map-place':
      keys(endpoint, ['kind', 'routeMapPlaceId'])
      text(endpoint.routeMapPlaceId)
      break
    case 'location': {
      keys(endpoint, ['kind', 'id', 'value'])
      text(endpoint.id)
      const location = object(endpoint.value)
      if (location.kind === 'stored') {
        keys(location, ['kind', 'name', 'location'])
        text(location.name)
        validateStoredLocation(location.location)
      } else if (location.kind === 'google') {
        keys(location, ['kind', 'reference'], ['name'])
        if (location.name !== undefined) text(location.name)
        const reference = object(location.reference)
        keys(reference, ['provider', 'id'])
        if (reference.provider !== 'google') throw new ValidationError('Google 路線端點需要 Google 地點參照。')
        text(reference.id)
      } else throw new ValidationError('路線端點的位置類型無效。')
      break
    }
    default: throw new ValidationError('路線端點類型無效。')
  }
}

export function routeEndpointKey(endpoint: RouteEndpointSelection): string {
  switch (endpoint.kind) {
    case 'place': return JSON.stringify(['place', endpoint.placeId])
    case 'shared-place': return JSON.stringify(['shared-place', endpoint.tripId, endpoint.placeId])
    case 'route-map-place': return JSON.stringify(['route-map-place', endpoint.routeMapPlaceId])
    case 'location':
      if (endpoint.value.kind === 'google') return JSON.stringify(['google', endpoint.value.reference.id])
      if (endpoint.value.location.source === 'osm') return JSON.stringify(['osm', endpoint.value.location.reference.id])
      return JSON.stringify(['location', endpoint.id])
  }
}

export function getRouteMapEndpoint(
  map: Pick<RouteMap, 'id' | 'origin' | 'destination' | 'originGooglePlaceId' | 'destinationGooglePlaceId'>,
  side: 'origin' | 'destination',
): RouteEndpointSelection | undefined {
  const endpoint = map[side]
  const googlePlaceId = side === 'origin' ? map.originGooglePlaceId : map.destinationGooglePlaceId
  if (endpoint !== undefined) {
    validateRouteEndpoint(endpoint)
    if (googlePlaceId !== undefined &&
        (endpoint.kind !== 'location' || endpoint.value.kind !== 'google' || endpoint.value.reference.id !== googlePlaceId)) {
      throw new ValidationError('舊版路線端點與新版端點資料不一致。')
    }
    return endpoint
  }
  if (googlePlaceId !== undefined) text(googlePlaceId)
  return googlePlaceId === undefined ? undefined : {
    kind: 'location', id: `${map.id}:${side}`,
    value: { kind: 'google', reference: { provider: 'google', id: googlePlaceId } },
  }
}

export async function assertRouteEndpointReference(
  storage: TravelDatabase, mapId: string, endpoint: RouteEndpointSelection,
): Promise<void> {
  if (endpoint.kind === 'place' && !await storage.places.get(endpoint.placeId)) {
    throw new EntityNotFoundError('Place', endpoint.placeId)
  }
  if (endpoint.kind === 'route-map-place') {
    const marker = await storage.routeMapPlaces.get(endpoint.routeMapPlaceId)
    if (!marker) throw new EntityNotFoundError('Route map place', endpoint.routeMapPlaceId)
    if (marker.routeMapId !== mapId) throw new ValidationError('路線端點的標記屬於另一張地圖。')
  }
  if (endpoint.kind === 'shared-place') {
    if (!storage.tables.some(table => table.name === 'sharedItineraries')) {
      throw new ValidationError('共享路線端點需要使用目前帳號的共享工作區。')
    }
    const snapshot = await storage.table<SharedTripSnapshot, string>('sharedItineraries').get(endpoint.tripId)
    if (!snapshot?.document || snapshot.document.trip.id !== endpoint.tripId ||
        !['owner', 'editor', 'viewer'].includes(snapshot.document.trip.access) ||
        !snapshot.document.places.some(place => place.id === endpoint.placeId)) {
      throw new ValidationError('共享路線端點無法使用，請選擇有權限存取的地點。')
    }
  }
}

export async function clearRouteEndpointReferences(
  storage: TravelDatabase, matches: (endpoint: RouteEndpointSelection) => boolean,
): Promise<void> {
  for (const map of await storage.routeMaps.toArray()) {
    let changed = false
    for (const side of ['origin', 'destination'] as const) {
      const endpoint = map[side]
      if (endpoint && matches(endpoint)) {
        delete map[side]
        if (side === 'origin') delete map.originGooglePlaceId
        else delete map.destinationGooglePlaceId
        changed = true
      }
    }
    if (changed) await storage.routeMaps.put(map)
  }
}
