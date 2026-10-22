import type { MapMarker, MapMountOptions } from '../../src/geo/contracts'

export const mapOptions: Omit<MapMountOptions, 'events' | 'signal'> = {
  center: { latitude: 26.43, longitude: 127.9 },
  zoom: 9,
  maxZoom: 17,
  bounds: { north: 26.9, south: 25.98, east: 128.36, west: 127.58 },
}

// Manually supplied fixtures, not coordinates fetched from Google.
export const fixtures: readonly MapMarker[] = [
  { id: 'fixture-airport', name: '那霸機場（固定範例）', coordinate: { latitude: 26.1958, longitude: 127.6459 }, sequence: 1 },
  { id: 'fixture-market', name: '牧志市場（固定範例）', coordinate: { latitude: 26.2147, longitude: 127.6868 }, sequence: 2, color: '#b57e48' },
  { id: 'fixture-aquarium', name: '美麗海水族館（固定範例）', coordinate: { latitude: 26.6944, longitude: 127.8779 }, sequence: 3, color: '#567f9e' },
]
