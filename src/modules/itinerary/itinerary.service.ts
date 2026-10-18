import { EntityNotFoundError, itineraryItems, places, regions, trips, ValidationError } from '../../database'
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
import { getGoogleRouteEstimate } from '../place/google-places.service'
import type { GoogleRouteEstimate } from '../place/google-places.service'
import { isGoogleTravelMode } from '../../common/route-estimate'
import { ItineraryMapService } from './itinerary-map.service'

export interface ItineraryWorkspace {
  trips: Trip[]
  regions: Region[]
  places: Place[]
}

export type NewScheduledItem = Omit<NewItineraryItem, 'order'>

export class ItineraryService {
  private readonly mapService: ItineraryMapService

  constructor(mapService = new ItineraryMapService()) {
    this.mapService = mapService
  }

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

  loadMapData(regionId: string) {
    return this.mapService.loadMapData(regionId)
  }

  async addItem(input: NewScheduledItem): Promise<string> {
    const dayItems = await itineraryItems.findByTripAndDate(input.tripId, input.date)
    const order = dayItems.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
    return itineraryItems.create({ ...input, order })
  }

  updateItem(id: string, changes: ItineraryItemChanges): Promise<void> {
    return itineraryItems.update(id, changes)
  }

  async calculateTravelDuration(itemId: string): Promise<GoogleRouteEstimate> {
    const item = await itineraryItems.getById(itemId)
    if (!item) throw new EntityNotFoundError('Itinerary item', itemId)

    const dayItems = (await itineraryItems.findByTripAndDate(item.tripId, item.date))
      .sort((left, right) => left.order - right.order)
    const itemIndex = dayItems.findIndex((candidate) => candidate.id === itemId)
    if (itemIndex <= 0) {
      throw new ValidationError('第一個地點沒有上一站，不需要計算路程。')
    }
    const travelMode = item.transport
    if (!travelMode || !isGoogleTravelMode(travelMode)) {
      throw new ValidationError('請先選擇有效的交通方式。')
    }

    const previousItem = dayItems[itemIndex - 1]
    const [originPlace, destinationPlace] = await Promise.all([
      places.getById(previousItem.placeId),
      places.getById(item.placeId),
    ])
    if (!originPlace) throw new EntityNotFoundError('Place', previousItem.placeId)
    if (!destinationPlace) throw new EntityNotFoundError('Place', item.placeId)
    if (!originPlace.googlePlaceId || !destinationPlace.googlePlaceId) {
      throw new ValidationError('上一站和這一站都需要先選取 Google Maps 搜尋結果，才能計算路程。')
    }

    const estimate = await getGoogleRouteEstimate(
      originPlace.googlePlaceId,
      destinationPlace.googlePlaceId,
      travelMode,
    )

    const currentDayItems = (await itineraryItems.findByTripAndDate(item.tripId, item.date))
      .sort((left, right) => left.order - right.order)
    const currentIndex = currentDayItems.findIndex((candidate) => candidate.id === itemId)
    if (
      currentIndex <= 0 ||
      currentDayItems[currentIndex - 1].id !== previousItem.id ||
      currentDayItems[currentIndex - 1].placeId !== previousItem.placeId ||
      currentDayItems[currentIndex].placeId !== item.placeId ||
      currentDayItems[currentIndex].transport !== item.transport
    ) {
      throw new ValidationError('行程順序或交通方式已變更，請重新計算路程。')
    }

    const [currentOrigin, currentDestination] = await Promise.all([
      places.getById(previousItem.placeId),
      places.getById(item.placeId),
    ])
    if (currentOrigin?.googlePlaceId !== originPlace.googlePlaceId ||
        currentDestination?.googlePlaceId !== destinationPlace.googlePlaceId) {
      throw new ValidationError('地點的 Google Maps 位置已變更，請重新計算路程。')
    }
    await itineraryItems.update(itemId, {
      travelDurationMinutes: estimate.durationMinutes,
      travelDistanceMeters: estimate.distanceMeters,
    })
    return estimate
  }

  deleteItem(id: string): Promise<void> {
    return itineraryItems.delete(id)
  }

  reorderItems(tripId: string, date: string, orderedIds: string[]): Promise<void> {
    return itineraryItems.reorderForDate(tripId, date, orderedIds)
  }
}
