import { places, regions, trips, prepareMapWorkspace } from '../../database'
import type { NewRegion, Place, Region, RegionChanges, Trip } from '../../database'
import {
  getGooglePlaceDetails,
  isGooglePlacesConfigured,
  mountPlaceAutocomplete,
} from '../place/google-places.service'
import type { GooglePlaceDetails } from '../place/google-places.service'
import { mountOsmAutocomplete } from '../../geo/osm-service'
import { publicCatalog } from '../public-itinerary/catalog-instance'
import { sharedTrips } from '../../database/shared-trip.repository'

export interface RegionWorkspace {
  regions: Region[]
  places: Place[]
  trips: Trip[]
}

export class RegionService {
  async loadSharing(ownerId: string) {
    const [publications, collaborations] = await Promise.all([
      publicCatalog.publicItineraries.where('ownerId').equals(ownerId).toArray(),
      sharedTrips.list(),
    ])
    return { publications, collaborations }
  }

  mountOsmAutocomplete(...args: Parameters<typeof mountOsmAutocomplete>) {
    return mountOsmAutocomplete(...args)
  }

  isGooglePlacesConfigured(): boolean {
    return isGooglePlacesConfigured()
  }

  mountPlaceAutocomplete(
    container: HTMLElement,
    onSelect: (details: GooglePlaceDetails, query: string) => void,
    onError: (error: Error) => void,
  ): Promise<() => void> {
    return mountPlaceAutocomplete(container, onSelect, onError)
  }

  getGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
    return getGooglePlaceDetails(placeId)
  }

  async loadWorkspace(): Promise<RegionWorkspace> {
    await prepareMapWorkspace()
    const [regionRecords, placeRecords, tripRecords] = await Promise.all([
      regions.list(),
      places.list(),
      trips.list(),
    ])
    return { regions: regionRecords, places: placeRecords, trips: tripRecords }
  }

  create(input: NewRegion): Promise<string> {
    return regions.create(input)
  }

  update(id: string, changes: RegionChanges): Promise<void> {
    return regions.update(id, changes)
  }

  delete(id: string): Promise<void> {
    return regions.delete(id)
  }
}
