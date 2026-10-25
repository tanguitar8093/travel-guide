import type { NewRegion, RegionChanges } from '../../database'
import { RegionService } from './region.service'
import type { GooglePlaceDetails } from '../place/google-places.service'

export class RegionController {
  private readonly service: RegionService

  constructor(service = new RegionService()) {
    this.service = service
  }

  loadWorkspace() {
    return this.service.loadWorkspace()
  }

  loadSharing(ownerId: string) {
    return this.service.loadSharing(ownerId)
  }

  isGooglePlacesConfigured() {
    return this.service.isGooglePlacesConfigured()
  }

  mountOsmAutocomplete(...args: Parameters<RegionService['mountOsmAutocomplete']>) {
    return this.service.mountOsmAutocomplete(...args)
  }

  mountPlaceAutocomplete(
    container: HTMLElement,
    onSelect: (details: GooglePlaceDetails, query: string) => void,
    onError: (error: Error) => void,
  ) {
    return this.service.mountPlaceAutocomplete(container, onSelect, onError)
  }

  getGooglePlaceDetails(placeId: string) {
    return this.service.getGooglePlaceDetails(placeId)
  }

  create(input: NewRegion) {
    return this.service.create(input)
  }

  update(id: string, changes: RegionChanges) {
    return this.service.update(id, changes)
  }

  delete(id: string) {
    return this.service.delete(id)
  }
}

export const regionController = new RegionController()
