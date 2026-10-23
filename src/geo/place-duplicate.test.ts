import { expect, it } from 'vitest'
import type { StoredLocation } from './contracts'
import { coordinateDistanceMeters, placeDuplicateMessage, placeDuplicateReason } from './place-duplicate'

const location: StoredLocation = {
  source: 'user', kind: 'user-picked',
  coordinate: { latitude: 26.33, longitude: 127.92 },
}

function north(meters: number): StoredLocation {
  return {
    ...location,
    coordinate: {
      ...location.coordinate,
      latitude: location.coordinate.latitude + meters / 6371008.8 * 180 / Math.PI,
    },
  }
}

it('matches different names below 50 meters but not above the threshold', () => {
  const original = { name: '原地點', location }
  expect(coordinateDistanceMeters(location.coordinate, north(49.99).coordinate)).toBeCloseTo(49.99, 6)
  expect(placeDuplicateReason(original, { name: '另一名稱', location: north(49.99) })).toBe('nearby')
  expect(placeDuplicateReason(original, { name: '另一名稱', location: north(50.01) })).toBeUndefined()
  expect(placeDuplicateReason(original, { name: '另一名稱', location: north(0) })).toBe('nearby')
})

it('matches equal names independently of distance and ignores blank names', () => {
  expect(placeDuplicateReason(
    { name: ' Cafe  A ', location },
    { name: 'cafe a', location: north(1000) },
  )).toBe('name')
  expect(placeDuplicateReason({ name: ' ' }, { name: '' })).toBeUndefined()
  expect(placeDuplicateReason({ name: '同名' }, { name: '同名', location })).toBe('name')
})

it('measures longitude correctly at high latitudes and across the date line', () => {
  expect(coordinateDistanceMeters(
    { latitude: 80, longitude: 0 },
    { latitude: 80, longitude: 0.002 },
  )).toBeLessThan(50)
  expect(coordinateDistanceMeters(
    { latitude: 0, longitude: 179.9999 },
    { latitude: 0, longitude: -179.9999 },
  )).toBeLessThan(50)
})

it('explains the matching reason and existing place name in Chinese', () => {
  expect(placeDuplicateMessage('原地點', 'nearby')).toBe('和「原地點」距離不到 50 公尺，請選用既有地點。')
  expect(placeDuplicateMessage('原地點', 'name')).toBe('和「原地點」名稱相同，請選用既有地點或修改名稱。')
})
