import type { Coordinate, LocationMetadata, StoredLocation } from '../geo/contracts'
import { ValidationError } from './errors'
import type { Place } from './models'
import { placeDuplicateReason, type NamedLocation, type PlaceDuplicateReason } from '../geo/place-duplicate'

export function findDuplicatePlace(places: readonly Place[], candidate: NamedLocation, excludeId?: string): { place: Place; reason: PlaceDuplicateReason } | undefined {
  if (!candidate.location) return undefined
  for (const place of places) {
    if (place.id === excludeId) continue
    const reason = placeDuplicateReason(candidate, place)
    if (reason) return { place, reason }
  }
  return undefined
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${field}必須是物件。`)
  }
  return value as Record<string, unknown>
}

function requireKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) {
    throw new ValidationError('位置資料缺少必要欄位，或包含不支援的欄位。')
  }
}

export function validateCoordinatePair(latitude: unknown, longitude: unknown): void {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError('緯度必須介於 -90 與 90。')
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError('經度必須介於 -180 與 180。')
  }
}

function validateCoordinate(value: unknown): asserts value is Coordinate {
  const coordinate = requireRecord(value, '位置座標')
  requireKeys(coordinate, ['latitude', 'longitude'])
  validateCoordinatePair(coordinate.latitude, coordinate.longitude)
}

function validateMetadataFields(value: Record<string, unknown>): void {
  if (typeof value.kind !== 'string' ||
      !['point', 'approximate-center', 'map-center', 'user-picked'].includes(value.kind)) {
    throw new ValidationError('位置類型無效。')
  }
  if (value.source === 'osm') {
    const reference = requireRecord(value.reference, 'OSM 參照')
    requireKeys(reference, ['provider', 'id'])
    if (reference.provider !== 'osm' || typeof reference.id !== 'string' ||
        !/^(node|way|relation)\/[1-9][0-9]*$/.test(reference.id)) {
      throw new ValidationError('OSM 參照必須包含物件類型與正整數識別碼。')
    }
    if (Object.hasOwn(value, 'datasetVersion') &&
        (typeof value.datasetVersion !== 'string' || !value.datasetVersion.trim())) {
      throw new ValidationError('位置圖資版本不可空白。')
    }
  } else if (value.source !== 'user' && value.source !== 'legacy-user') {
    throw new ValidationError('位置來源必須是使用者輸入、舊版使用者資料或 OSM（user、legacy-user、osm）。')
  }
}

function requireLocationKeys(value: Record<string, unknown>, coordinate: boolean): void {
  requireKeys(
    value,
    ['source', 'kind', ...(coordinate ? ['coordinate'] : []), ...(value.source === 'osm' ? ['reference'] : [])],
    value.source === 'osm' ? ['datasetVersion'] : [],
  )
}

export function validateLocationMetadata(value: unknown): asserts value is LocationMetadata {
  const metadata = requireRecord(value, '位置來源資料')
  requireLocationKeys(metadata, false)
  validateMetadataFields(metadata)
}

export function validateStoredLocation(value: unknown): asserts value is StoredLocation {
  const location = requireRecord(value, '已儲存的位置')
  requireLocationKeys(location, true)
  validateMetadataFields(location)
  validateCoordinate(location.coordinate)
}

export function sameStoredLocation(left: StoredLocation | undefined, right: StoredLocation | undefined): boolean {
  if (!left || !right) return left === right
  return left.source === right.source && left.kind === right.kind &&
    left.coordinate.latitude === right.coordinate.latitude &&
    left.coordinate.longitude === right.coordinate.longitude &&
    (left.source === 'osm' ? left.reference.id : undefined) ===
      (right.source === 'osm' ? right.reference.id : undefined)
}
