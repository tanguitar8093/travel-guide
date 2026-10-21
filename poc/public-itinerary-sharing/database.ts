import Dexie, { type Table } from 'dexie'
import type {
  DemoDataset, ItineraryItem, Label, Place, PublicItinerary, Region, SeedMarker, Trip,
} from './models'

export const POC_DATABASE_NAME = 'travel-guide-poc-public-itinerary-sharing'
export const SEED_KEY = 'demo-v1'

export class PublicItineraryDatabase extends Dexie {
  regions!: Table<Region, string>
  places!: Table<Place, string>
  labels!: Table<Label, string>
  trips!: Table<Trip, string>
  itineraryItems!: Table<ItineraryItem, string>
  publicItineraries!: Table<PublicItinerary, string>
  metadata!: Table<SeedMarker, string>

  constructor(name = POC_DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      regions: '&id, name',
      places: '&id, name, *regionIds, *labelIds',
      labels: '&id, name, parentId',
      trips: '&id, regionId, name, startDate, endDate',
      itineraryItems: '&id, tripId, placeId, date, [tripId+date+order]',
      publicItineraries: '&id, &sourceTripId, createdAt, updatedAt',
      metadata: '&key',
    })
  }
}

// Explicit initialization, never automatic on open; the marker survives deletion of demo rows.
export async function seedDemoDatabase(db: PublicItineraryDatabase, dataset: DemoDataset): Promise<boolean> {
  return db.transaction('rw', db.tables, async () => {
    if (await db.metadata.get(SEED_KEY)) return false
    await db.regions.bulkAdd(structuredClone(dataset.regions))
    await db.places.bulkAdd(structuredClone(dataset.places))
    await db.labels.bulkAdd(structuredClone(dataset.labels))
    await db.trips.bulkAdd(structuredClone(dataset.trips))
    await db.itineraryItems.bulkAdd(structuredClone(dataset.items))
    await db.publicItineraries.bulkAdd(structuredClone(dataset.publicItineraries))
    await db.metadata.add({ key: SEED_KEY, version: 1 })
    return true
  })
}
