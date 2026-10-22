import type { Bounds, Coordinate, MapMarker, MapMountOptions } from './contracts'
import { geoError } from './errors'

export function validateCoordinate(coordinate: Coordinate): void {
  if (!Number.isFinite(coordinate.latitude) || Math.abs(coordinate.latitude) > 90 ||
      !Number.isFinite(coordinate.longitude) || Math.abs(coordinate.longitude) > 180) {
    throw geoError('INVALID_INPUT', '地圖位置必須是有效的 WGS84 經緯度。')
  }
}

export function validateZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) {
    throw geoError('INVALID_INPUT', '地圖縮放必須介於 0 與 22。')
  }
}

export function validateBounds(bounds: Bounds): void {
  validateCoordinate({ latitude: bounds.north, longitude: bounds.east })
  validateCoordinate({ latitude: bounds.south, longitude: bounds.west })
  if (bounds.north < bounds.south) throw geoError('INVALID_INPUT', '地圖範圍的北界不得小於南界。')
}

export function validateMountOptions(options: MapMountOptions): void {
  validateCoordinate(options.center)
  validateZoom(options.zoom)
  if (options.maxZoom !== undefined) validateZoom(options.maxZoom)
  if (options.bounds) validateBounds(options.bounds)
}

export function validateMarkers(markers: readonly MapMarker[]): void {
  const ids = new Set<string>()
  for (const marker of markers) {
    if (!marker.id.trim() || ids.has(marker.id)) throw geoError('INVALID_INPUT', '圖釘 ID 不得空白或重複。')
    ids.add(marker.id)
    validateCoordinate(marker.coordinate)
    if (marker.sequence !== undefined && (!Number.isSafeInteger(marker.sequence) || marker.sequence < 0)) {
      throw geoError('INVALID_INPUT', '圖釘編號必須是非負整數。')
    }
  }
}

export function markerBounds(markers: readonly MapMarker[]): Bounds | undefined {
  if (!markers.length) return undefined
  const longitudes = markers.map(marker => marker.coordinate.longitude).sort((a, b) => a - b)
  let gap = -1
  let gapIndex = 0
  for (let index = 0; index < longitudes.length; index += 1) {
    const next = index + 1 < longitudes.length ? longitudes[index + 1] : longitudes[0] + 360
    if (next - longitudes[index] > gap) {
      gap = next - longitudes[index]
      gapIndex = index
    }
  }
  return {
    north: Math.max(...markers.map(marker => marker.coordinate.latitude)),
    south: Math.min(...markers.map(marker => marker.coordinate.latitude)),
    west: longitudes[(gapIndex + 1) % longitudes.length],
    east: longitudes[gapIndex],
  }
}
