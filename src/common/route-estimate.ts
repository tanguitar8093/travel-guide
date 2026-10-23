import type { GoogleTravelMode } from '../modules/place/google-places.service'
import type { GeoProvider } from '../geo/contracts'

export const transportOptions: ReadonlyArray<{ value: GoogleTravelMode; label: string }> = [
  { value: 'DRIVING', label: '開車' },
  { value: 'TRANSIT', label: '大眾運輸' },
  { value: 'WALKING', label: '步行' },
  { value: 'BICYCLING', label: '單車' },
  { value: 'TWO_WHEELER', label: '機車／二輪車' },
]

export function transportOptionsForProvider(provider: GeoProvider | undefined): typeof transportOptions {
  if (provider === 'google') return transportOptions
  if (provider === 'osm') {
    return transportOptions.filter(option =>
      option.value === 'DRIVING' || option.value === 'WALKING' || option.value === 'BICYCLING')
  }
  return []
}

export function isGoogleTravelMode(value: string): value is GoogleTravelMode {
  return transportOptions.some((option) => option.value === value)
}

export function formatTravelDistance(meters: number): string {
  return meters < 1000
    ? `${meters} 公尺`
    : `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(meters / 1000)} 公里`
}
