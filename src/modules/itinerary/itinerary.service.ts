import { itineraryItems, places, regions, trips } from '../../database'
import type {
  ItineraryItem,
  ItineraryItemChanges,
  NewItineraryItem,
  NewTrip,
  Place,
  Region,
  Trip,
  TripChanges,
} from '../../database'

export interface ItineraryWorkspace {
  trips: Trip[]
  regions: Region[]
  places: Place[]
}

export type NewScheduledItem = Omit<NewItineraryItem, 'order'>

export class ItineraryService {
  async loadWorkspace(): Promise<ItineraryWorkspace> {
    const [tripRecords, regionRecords, placeRecords] = await Promise.all([
      trips.list(),
      regions.list(),
      places.list(),
    ])
    return { trips: tripRecords, regions: regionRecords, places: placeRecords }
  }

  createTrip(input: NewTrip): Promise<string> {
    return trips.create(input)
  }

  updateTrip(id: string, changes: TripChanges): Promise<void> {
    return trips.update(id, changes)
  }

  deleteTrip(id: string): Promise<void> {
    return trips.delete(id)
  }

  listItems(tripId: string): Promise<ItineraryItem[]> {
    return itineraryItems.findByTripId(tripId)
  }

  async addItem(input: NewScheduledItem): Promise<string> {
    const dayItems = await itineraryItems.findByTripAndDate(input.tripId, input.date)
    const order = dayItems.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
    return itineraryItems.create({ ...input, order })
  }

  updateItem(id: string, changes: ItineraryItemChanges): Promise<void> {
    return itineraryItems.update(id, changes)
  }

  deleteItem(id: string): Promise<void> {
    return itineraryItems.delete(id)
  }

  reorderItems(tripId: string, date: string, orderedIds: string[]): Promise<void> {
    return itineraryItems.reorderForDate(tripId, date, orderedIds)
  }
}
