import type { PublicItinerary } from '../modules/public-itinerary/models'
import Dexie, { type Table } from 'dexie'
import type { ItineraryItem, Label, Place, Region, Trip, RouteMap, RouteMapPlace } from './models'
import { DEFAULT_OSM_REGION, DEFAULT_OSM_REGION_ID, isInsideOkinawaOsmCoverage } from '../geo/osm-coverage'

export class TravelDatabase extends Dexie {
  regions!: Table<Region, string>
  places!: Table<Place, string>
  labels!: Table<Label, string>
  trips!: Table<Trip, string>
  itineraryItems!: Table<ItineraryItem, string>
  routeMaps!: Table<RouteMap, string>
  routeMapPlaces!: Table<RouteMapPlace, string>
  publicItineraries!: Table<PublicItinerary, string>

  constructor(name = 'travel-planner') {
    super(name)

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
    this.version(10).stores({
      publicItineraries: '&id, &sourceTripId, createdAt, updatedAt',
    })
    this.version(7).stores({
      routeMaps: '&id, &tripId',
      routeMapPlaces: '&id, routeMapId, &[routeMapId+googlePlaceId]',
    })
    this.version(11).stores({
      routeMapPlaces: '&id, routeMapId, &[routeMapId+googlePlaceId], &[routeMapId+location.reference.id]',
    })
    this.version(12).stores({}).upgrade(async transaction => {
      if (this.name !== 'travel-planner') return
      const regions = transaction.table('regions')
      const existing = await regions.get(DEFAULT_OSM_REGION_ID)
      if (!existing) await regions.add({ ...DEFAULT_OSM_REGION, id: DEFAULT_OSM_REGION_ID })

      const places = transaction.table('places')
      const movableOsmPlaceIds = new Set<string>()
      for (const place of await places.toArray() as Place[]) {
        if (!place.location || !isInsideOkinawaOsmCoverage(place.location.coordinate)) continue
        movableOsmPlaceIds.add(place.id)
        await places.put({ ...place, regionIds: [DEFAULT_OSM_REGION_ID] })
      }

      const trips = transaction.table('trips')
      const itineraryItems = transaction.table('itineraryItems')
      for (const trip of await trips.toArray() as Trip[]) {
        const items = await itineraryItems.where('tripId').equals(trip.id).toArray() as ItineraryItem[]
        if (items.length && items.every(item => movableOsmPlaceIds.has(item.placeId))) {
          await trips.put({ ...trip, regionId: DEFAULT_OSM_REGION_ID })
        }
      }
    })
  }
}

export const database = new TravelDatabase()
