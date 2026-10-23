export const OKINAWA_OSM_BOUNDS = {
  west: 127.58,
  south: 25.98,
  east: 128.36,
  north: 26.9,
} as const

export function isInsideOkinawaOsmCoverage(coordinate: unknown): boolean {
  if (typeof coordinate !== 'object' || coordinate === null ||
      !('latitude' in coordinate) || !('longitude' in coordinate) ||
      typeof coordinate.latitude !== 'number' || typeof coordinate.longitude !== 'number') return false
  return coordinate.longitude >= OKINAWA_OSM_BOUNDS.west &&
    coordinate.longitude <= OKINAWA_OSM_BOUNDS.east &&
    coordinate.latitude >= OKINAWA_OSM_BOUNDS.south &&
    coordinate.latitude <= OKINAWA_OSM_BOUNDS.north
}

export const DEFAULT_OSM_REGION: Omit<import('../database/models').Region, 'id'> = {
  name: '沖繩',
  mapProvider: 'osm',
  center: { latitude: 26.44, longitude: 127.97 },
  centerMetadata: { source: 'user', kind: 'approximate-center' },
  zoom: 8,
}

export const DEFAULT_OSM_REGION_ID = '00000000-0000-4000-8000-000000000001'
