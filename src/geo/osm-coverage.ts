import { isInsideOsmCoverage, osmDatasets, osmRegion, localOsmRegionId } from './osm-datasets'

// Compatibility exports for existing Okinawa data and migration code.
export const OKINAWA_OSM_BOUNDS = osmDatasets.okinawa.bounds
export function isInsideOkinawaOsmCoverage(coordinate: unknown): boolean {
  return isInsideOsmCoverage(coordinate, 'okinawa')
}
export const DEFAULT_OSM_REGION = osmRegion('okinawa')
export const DEFAULT_OSM_REGION_ID = localOsmRegionId('okinawa')

export async function accountOsmRegionId(ownerId: string, dataset: import('./osm-datasets').OsmDatasetId = 'okinawa'): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ownerId}:${dataset}-osm-region`))
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
