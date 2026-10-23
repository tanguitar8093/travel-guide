import type { ResolvedRouteEndpoint, RouteEndpoint, RouteMapPlace, TripMapData } from './route-calculator.service'
import type { RouteEndpointSelection } from '../../geo/contracts'

export function markerKey(marker: ResolvedRouteEndpoint): string {
  return marker.id ?? marker.googlePlaceId ?? ''
}

export function storedEndpoint(endpoint: RouteEndpoint | null, marker?: RouteMapPlace): RouteEndpointSelection | undefined {
  if (!endpoint) return undefined
  if (endpoint.source === 'saved') return { kind: 'place', placeId: endpoint.placeId }
  if (endpoint.source === 'selection') return endpoint.selection
  if (endpoint.source === 'osm') return {
    kind: 'location', id: endpoint.place.location.source === 'osm'
      ? `osm:${endpoint.place.location.reference.id}`
      : `coordinate:${endpoint.place.location.coordinate.latitude},${endpoint.place.location.coordinate.longitude}`,
    value: { kind: 'stored', name: endpoint.place.name, location: endpoint.place.location },
  }
  return {
    kind: 'location', id: endpoint.place.id,
    value: { kind: 'google', name: marker?.name ?? endpoint.place.displayName, reference: { provider: 'google', id: endpoint.place.id } },
  }
}

export function isTripMarker(id: string, trip: TripMapData | undefined): boolean {
  return trip?.markers.some((marker) => markerKey(marker) === id) ?? false
}

export const routeMarkerColors = { trip: '#6d91ad', added: '#b96522' } as const

export function visibleRouteMarkers(
  personal: RouteMapPlace[], trip: TripMapData | undefined, date: string, hidden: string[],
): RouteMapPlace[] {
  const merged = new Map<string, RouteMapPlace>()
  for (const marker of trip?.markers ?? []) {
    if (!date || marker.dates.includes(date)) merged.set(markerKey(marker), marker)
  }
  for (const marker of personal) merged.set(markerKey(marker), marker)
  return [...merged.values()].filter((marker) => !hidden.includes(markerKey(marker)))
}

export function markerEndpoint(marker: RouteMapPlace) {
  if (marker.selection) return { source: 'selection' as const, selection: marker.selection, name: marker.name }
  if (marker.location) return {
    source: 'selection' as const,
    selection: storedEndpoint({ source: 'osm', place: { id: markerKey(marker), name: marker.name, location: marker.location } })!,
    name: marker.name,
  }
  return {
    source: 'google' as const,
    place: {
      id: marker.googlePlaceId!, displayName: marker.name,
      formattedAddress: marker.address, location: marker.position,
    },
  }
}
