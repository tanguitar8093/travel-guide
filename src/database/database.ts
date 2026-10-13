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

    this.version(2).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds, googlePlaceId',
      labels: '&id, name, parentId',
      trips: '&id, regionId, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
    })

    this.version(3)
      .stores({
        regions: '&id, name',
        places: '&id, name, *regionIds, *labelIds, googlePlaceId',
        labels: '&id, name, parentId',
        trips: '&id, regionId, startDate, endDate',
        itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
      })
      .upgrade((transaction) =>
        transaction.table('places').toCollection().modify((place) => {
          const legacyPlace = place as Place & { latitude?: number; longitude?: number }
          if (!legacyPlace.googlePlaceId && !legacyPlace.mapsUrl) {
            const query =
              Number.isFinite(legacyPlace.latitude) && Number.isFinite(legacyPlace.longitude)
                ? `${legacyPlace.latitude},${legacyPlace.longitude}`
                : legacyPlace.name
            legacyPlace.mapsUrl =
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
          }
          delete legacyPlace.latitude
          delete legacyPlace.longitude
        }),
      )

    this.version(4).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds, googlePlaceId',
      labels: '&id, name, parentId',
      trips: '&id, regionId, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
    })
  }
}

export const database = new TravelDatabase()
