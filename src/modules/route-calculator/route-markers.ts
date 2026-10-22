import type { RouteMapPlace, TripMapData } from './route-calculator.service'
import { markerKey, storedEndpoint } from './route-calculator.service'

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
