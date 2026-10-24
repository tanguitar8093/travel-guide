import definitions from '../../shared/geo/osm-datasets.json'
import type { Coordinate } from './contracts'
import type { Region } from '../database/models'

export type OsmDatasetId = keyof typeof definitions
export const osmDatasets = definitions
export const osmDatasetIds = Object.keys(definitions) as OsmDatasetId[]
export function isOsmDatasetId(value: unknown): value is OsmDatasetId {
  return typeof value === 'string' && Object.hasOwn(definitions, value)
}
export function regionOsmDataset(region: Pick<Region, 'osmDataset'>): OsmDatasetId {
  const id = region.osmDataset ?? 'okinawa'
  if (!isOsmDatasetId(id)) throw new Error('不支援此 OSM 區域圖資。')
  return id
}
function insideRing(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [previousX, previousY] = ring[j]
    const cross = (longitude - x) * (previousY - y) - (latitude - y) * (previousX - x)
    if (Math.abs(cross) < 1e-10 && longitude >= Math.min(x, previousX) && longitude <= Math.max(x, previousX) &&
      latitude >= Math.min(y, previousY) && latitude <= Math.max(y, previousY)) return true
    if ((y > latitude) !== (previousY > latitude) && longitude < (previousX - x) * (latitude - y) / (previousY - y) + x) inside = !inside
  }
  return inside
}
export function isInsideOsmCoverage(value: unknown, dataset: OsmDatasetId): value is Coordinate {
  if (!value || typeof value !== 'object' || !('latitude' in value) || !('longitude' in value) ||
    typeof value.latitude !== 'number' || typeof value.longitude !== 'number' ||
    !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return false
  return definitions[dataset].coverage.some(ring => insideRing(value.longitude as number, value.latitude as number, ring))
}
export function datasetForCoordinate(coordinate: Coordinate): OsmDatasetId | undefined {
  return osmDatasetIds.find(id => isInsideOsmCoverage(coordinate, id))
}
export function requireOsmCoverage(coordinate: Coordinate, dataset: OsmDatasetId): void {
  if (!isInsideOsmCoverage(coordinate, dataset)) throw new Error(`此位置超出${definitions[dataset].name}圖資範圍，請切換區域或選擇範圍內的地點。`)
}
export function osmRegion(dataset: OsmDatasetId): Omit<Region, 'id'> {
  const definition = definitions[dataset]
  return {
    name: definition.name, mapProvider: 'osm', ...(dataset === 'okinawa' ? {} : { osmDataset: dataset }),
    center: definition.center, centerMetadata: { source: 'user', kind: 'approximate-center' }, zoom: definition.zoom,
  }
}
export function localOsmRegionId(dataset: OsmDatasetId): string {
  return dataset === 'okinawa' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002'
}
