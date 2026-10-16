import { places, supabaseRegions, trips } from '../../database'
import type { NewRegion, Place, Region, RegionChanges, Trip } from '../../database'
import {
  getGooglePlaceDetails,
  isGooglePlacesConfigured,
  mountPlaceAutocomplete,
} from '../place/google-places.service'
import type { GooglePlaceDetails } from '../place/google-places.service'

export interface RegionWorkspace {
  regions: Region[]
  places: Place[]
  trips: Trip[]
}

export class RegionService {
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
    const [regionRecords, placeRecords, tripRecords] = await Promise.all([
      supabaseRegions.list(),
      places.list(),
      trips.list(),
    ])
    return { regions: regionRecords, places: placeRecords, trips: tripRecords }
  }

  create(input: NewRegion): Promise<string> {
    return supabaseRegions.create(input)
  }

  update(id: string, changes: RegionChanges): Promise<void> {
    return supabaseRegions.update(id, changes)
  }

  delete(id: string): Promise<void> {
    return supabaseRegions.delete(id)
  }
}
