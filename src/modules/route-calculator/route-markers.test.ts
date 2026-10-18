import { expect, it } from 'vitest'
import { isTripMarker, markerEndpoint, visibleRouteMarkers } from './route-markers'
import type { RouteMapPlace, TripMapData } from './route-calculator.service'

const a: RouteMapPlace = { googlePlaceId: 'a', name: 'A', position: { lat: 25, lng: 121 }, address: '地址' }
const b: RouteMapPlace = { ...a, googlePlaceId: 'b', name: 'B' }
const trip: TripMapData = {
  dates: ['2026-10-18', '2026-10-19'],
  markers: [{ ...a, dates: ['2026-10-18'] }, { ...b, dates: ['2026-10-19'] }],
  unavailable: [],
}

it('classifies a searched duplicate as an original trip location regardless of date filtering', () => {
  const visible = visibleRouteMarkers([b], trip, '2026-10-18', [])
  expect(isTripMarker(visible[1].googlePlaceId, trip)).toBe(true)
  expect(isTripMarker('later-added', trip)).toBe(false)
  expect(isTripMarker('a', undefined)).toBe(false)
})

it('deduplicates saved/search and trip markers by Google place ID', () => {
  expect(visibleRouteMarkers([a], trip, '', [])).toEqual([a, trip.markers[1]])
})

it('filters trip dates but retains personal search markers', () => {
  expect(visibleRouteMarkers([b], trip, '2026-10-18', [])).toEqual([trip.markers[0], b])
})

it('removes a hidden location from both sources without mutating either dataset', () => {
  expect(visibleRouteMarkers([a], trip, '', ['a'])).toEqual([trip.markers[1]])
  expect(trip.markers).toHaveLength(2)
  expect(a.googlePlaceId).toBe('a')
})

it('switching off the trip preserves personal markers', () => {
  expect(visibleRouteMarkers([a], undefined, '', [])).toEqual([a])
})

it('keeps marker selection details transient and usable as an endpoint', () => {
  expect(markerEndpoint(a)).toEqual({
    source: 'marker', place: { id: 'a', displayName: 'A', formattedAddress: '地址', location: a.position },
  })
})
