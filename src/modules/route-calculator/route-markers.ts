import type { RouteMapPlace, TripMapData } from './route-calculator.service'

export function isTripMarker(id: string, trip: TripMapData | undefined): boolean {
  return trip?.markers.some((marker) => marker.googlePlaceId === id) ?? false
}

export const routeMarkerColors = { trip: '#6d91ad', added: '#b96522' } as const

export function visibleRouteMarkers(
  personal: RouteMapPlace[], trip: TripMapData | undefined, date: string, hidden: string[],
): RouteMapPlace[] {
  const merged = new Map<string, RouteMapPlace>()
  for (const marker of trip?.markers ?? []) {
    if (!date || marker.dates.includes(date)) merged.set(marker.googlePlaceId, marker)
  }
  for (const marker of personal) merged.set(marker.googlePlaceId, marker)
  return [...merged.values()].filter((marker) => !hidden.includes(marker.googlePlaceId))
}

export function markerEndpoint(marker: RouteMapPlace) {
  return {
    source: 'marker' as const,
    place: {
      id: marker.googlePlaceId, displayName: marker.name,
      formattedAddress: marker.address, location: marker.position,
    },
  }
}
