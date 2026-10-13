import Dexie, { type Table } from 'dexie'
import type { ItineraryItem, Label, Place, Region, Trip } from './models'

export class TravelDatabase extends Dexie {
  regions!: Table<Region, string>
  places!: Table<Place, string>
  labels!: Table<Label, string>
  trips!: Table<Trip, string>
  itineraryItems!: Table<ItineraryItem, string>

  constructor() {
    super('travel-planner')

    this.version(1).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds',
      labels: '&id, name, parentId',
      trips: '&id, regionId, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
    })
  }
}

export const database = new TravelDatabase()
