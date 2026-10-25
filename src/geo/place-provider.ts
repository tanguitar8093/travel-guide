import { getOsmDataset } from './osm-dataset-preference'
import { isInsideOsmCoverage, regionOsmDataset, type OsmDatasetId } from './osm-datasets'
import type { Place, Region } from '../database/models'
import type { GeoProvider } from './contracts'

// Labels are shared; a Google Place ID makes the place Google-only.
export function placesForMapProvider(places: readonly Place[], provider: GeoProvider | undefined, regions?: readonly Region[], dataset?: OsmDatasetId): Place[] {
  if (!provider) return []
  if (provider !== 'osm') return [...places]
  const selectedDataset = dataset ?? getOsmDataset()
  const regionIds = regions && new Set(regions.filter(region => region.mapProvider === 'osm' && regionOsmDataset(region) === selectedDataset).map(region => region.id))
  return places.filter(place => !place.googlePlaceId && (!regionIds || place.regionIds.some(id => regionIds.has(id))) && (!place.location || isInsideOsmCoverage(place.location.coordinate, selectedDataset)))
}
