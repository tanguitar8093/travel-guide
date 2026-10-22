import type { Coordinate, LocationMetadata, StoredLocation } from '../geo/contracts'
import { ValidationError } from './errors'

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object.`)
  }
  return value as Record<string, unknown>
}

function requireKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) {
    throw new ValidationError('Location has missing or unsupported fields.')
  }
}

export function validateCoordinatePair(latitude: unknown, longitude: unknown): void {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError('Latitude must be between -90 and 90.')
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError('Longitude must be between -180 and 180.')
  }
}

function validateCoordinate(value: unknown): asserts value is Coordinate {
  const coordinate = requireRecord(value, 'Location coordinate')
  requireKeys(coordinate, ['latitude', 'longitude'])
  validateCoordinatePair(coordinate.latitude, coordinate.longitude)
}

function validateMetadataFields(value: Record<string, unknown>): void {
  if (typeof value.kind !== 'string' ||
      !['point', 'approximate-center', 'map-center', 'user-picked'].includes(value.kind)) {
    throw new ValidationError('Location kind is invalid.')
  }
  if (value.source === 'osm') {
    const reference = requireRecord(value.reference, 'OSM reference')
    requireKeys(reference, ['provider', 'id'])
    if (reference.provider !== 'osm' || typeof reference.id !== 'string' ||
        !/^(node|way|relation)\/[1-9][0-9]*$/.test(reference.id)) {
      throw new ValidationError('OSM reference must contain a type and positive integer ID.')
    }
    if (Object.hasOwn(value, 'datasetVersion') &&
        (typeof value.datasetVersion !== 'string' || !value.datasetVersion.trim())) {
      throw new ValidationError('Location dataset version must not be empty.')
    }
  } else if (value.source !== 'user' && value.source !== 'legacy-user') {
    throw new ValidationError('Location source must be user, legacy-user or osm.')
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
  const metadata = requireRecord(value, 'Location metadata')
  requireLocationKeys(metadata, false)
  validateMetadataFields(metadata)
}

export function validateStoredLocation(value: unknown): asserts value is StoredLocation {
  const location = requireRecord(value, 'Stored location')
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
