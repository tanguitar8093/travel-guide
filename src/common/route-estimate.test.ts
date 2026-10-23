import { expect, it } from 'vitest'
import { formatTravelDistance, isGoogleTravelMode, transportOptions, transportOptionsForProvider } from './route-estimate'

it.each([
  [0, '0 公尺'], [650, '650 公尺'], [999, '999 公尺'],
  [1000, '1 公里'], [12300, '12.3 公里'], [12650, '12.7 公里'],
])('formats %s meters consistently for itinerary and calculator', (meters, expected) => {
  expect(formatTravelDistance(meters)).toBe(expected)
})

it('only offers transit and two-wheelers when Google is selected', () => {
  expect(transportOptionsForProvider('google')).toBe(transportOptions)
  expect(transportOptionsForProvider('osm').map(option => option.value))
    .toEqual(['DRIVING', 'WALKING', 'BICYCLING'])
  expect(transportOptionsForProvider(undefined)).toEqual([])
  expect(transportOptions).toHaveLength(5)
})

it('keeps the same five transport options across route tools', () => {
  expect(transportOptions.map((option) => option.value))
    .toEqual(['DRIVING', 'TRANSIT', 'WALKING', 'BICYCLING', 'TWO_WHEELER'])
  for (const option of transportOptions) expect(isGoogleTravelMode(option.value)).toBe(true)
  expect(isGoogleTravelMode('FLYING')).toBe(false)
})
