import type { ItineraryItemChanges, NewTrip, TripChanges } from '../../database'
import type { NewScheduledItem } from './itinerary.service'
import { ItineraryService } from './itinerary.service'

export class ItineraryController {
  private readonly service: ItineraryService

  constructor(service = new ItineraryService()) {
    this.service = service
  }

  loadWorkspace() {
    return this.service.loadWorkspace()
  }

  createTrip(input: NewTrip) {
    return this.service.createTrip(input)
  }

  updateTrip(id: string, changes: TripChanges) {
    return this.service.updateTrip(id, changes)
  }

  deleteTrip(id: string) {
    return this.service.deleteTrip(id)
  }

  getTripRouteMapSummary(tripId: string) {
    return this.service.getTripRouteMapSummary(tripId)
  }

  listItems(tripId: string) {
    return this.service.listItems(tripId)
  }

  loadMapData(regionId: string) {
    return this.service.loadMapData(regionId)
  }

  addItem(input: NewScheduledItem) {
    return this.service.addItem(input)
  }

  updateItem(id: string, changes: ItineraryItemChanges) {
    return this.service.updateItem(id, changes)
  }

  calculateTravelDuration(itemId: string) {
    return this.service.calculateTravelDuration(itemId)
  }

  deleteItem(id: string) {
    return this.service.deleteItem(id)
  }

  reorderItems(tripId: string, date: string, orderedIds: string[]) {
    return this.service.reorderItems(tripId, date, orderedIds)
  }
}

export const itineraryController = new ItineraryController()
