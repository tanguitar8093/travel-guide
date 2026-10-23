import type { Place } from '../database/models'
import type { GeoProvider } from './contracts'

// Labels are shared; a Google Place ID makes the place Google-only.
export function placesForMapProvider(places: readonly Place[], provider: GeoProvider | undefined): Place[] {
  if (!provider) return []
  return provider === 'osm' ? places.filter(place => !place.googlePlaceId) : [...places]
}
