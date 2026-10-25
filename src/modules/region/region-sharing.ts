import type { Region, Trip } from '../../database/models'
import type { PublicItinerary } from '../public-itinerary/models'
import type { SharedTripSnapshot } from '../../database/shared-trip.types'
import { getRegionMapProvider } from '../../geo/region-provider'
import { regionOsmDataset } from '../../geo/osm-datasets'

function sameMap(left: Region, right: Region): boolean {
  const provider = getRegionMapProvider(left)
  return provider === getRegionMapProvider(right) && (provider === 'osm'
    ? regionOsmDataset(left) === regionOsmDataset(right)
    : left.id === right.id)
}

export function regionSharingCounts(regions: Region[], trips: Trip[], publications: PublicItinerary[], collaborations: SharedTripSnapshot[]) {
  return new Map(regions.map(region => [region.id, {
    published: publications.filter(publication => {
      const source = trips.find(trip => trip.id === publication.sourceTripId)
      // Published snapshots regenerate IDs; OSM ownership is determined by dataset.
      if (getRegionMapProvider(publication.snapshot.region) === 'osm') return sameMap(region, publication.snapshot.region)
      return source ? source.regionId === region.id : sameMap(region, publication.snapshot.region)
    }).length,
    collaborative: collaborations.filter(row => row.document && sameMap(region, row.document.region)).length,
  }]))
}
