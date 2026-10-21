import { ItineraryService } from '../itinerary/itinerary.service'
import { ItineraryMapService } from '../itinerary/itinerary-map.service'
import type { PublicSnapshot } from './models'

// The production itinerary renderer receives a snapshot-only, mutation-rejecting service.
export class SnapshotItineraryService extends ItineraryService {
  constructor(privateSnapshot: PublicSnapshot) { super(); this.snapshot = structuredClone(privateSnapshot) }
  private readonly snapshot: PublicSnapshot
  override getAccess() { return 'viewer' as const }
  override async loadWorkspace() {
    return { trips: [this.snapshot.trip], regions: [this.snapshot.region],
      places: this.snapshot.places.map(place => ({ ...place, labelIds: [] })) }
  }
  override async listItems() { return structuredClone(this.snapshot.items) }
  override async loadMapData() {
    return new ItineraryMapService().loadRecords(this.snapshot.region,
      this.snapshot.places.map(place => ({ ...place, labelIds: [] })))
  }
  private reject(): Promise<never> { return Promise.reject(new Error('公開預覽為唯讀。')) }
  override createTrip() { return this.reject() }
  override updateTrip() { return this.reject() }
  override deleteTrip() { return this.reject() }
  override addItem() { return this.reject() }
  override updateItem() { return this.reject() }
  override deleteItem() { return this.reject() }
  override reorderItems() { return this.reject() }
  override calculateTravelDuration() { return this.reject() }
}
