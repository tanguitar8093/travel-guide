import { ValidationError, places } from '../../database'
import type { Place } from '../../database'
import { sharedTrips } from '../../database/shared-trip.repository'
import type { SharedTripDocument, SharedTripSnapshot } from '../../database/shared-trip.types'
import type { SharedTripItem, SharedTripPlace } from '../../database/trip-collaboration.types'
import { clearSharedEstimates, parseSharedTripDocument } from '../../database/shared-trip.validation'
import { ItineraryMapService } from './itinerary-map.service'
import { getGoogleRouteEstimate } from '../place/google-places.service'
import { isGoogleTravelMode } from '../../common/route-estimate'

export class SharedTripService {
  list() { return sharedTrips.list() }
  refresh() { return sharedTrips.refresh() }
  enable(tripId: string) { return sharedTrips.enable(tripId) }
  cancel(tripId: string) { return sharedTrips.cancel(tripId) }
  listOwnPlaces() { return places.list() }
  tasks() { return sharedTrips.tasks() }
  subscribe(...args: Parameters<typeof sharedTrips.subscribe>) { return sharedTrips.subscribe(...args) }
  resolve(...args: Parameters<typeof sharedTrips.resolve>) { return sharedTrips.resolve(...args) }

  loadMap(document: SharedTripDocument) {
    return new ItineraryMapService().loadRecords(document.region, document.places.map((place) => ({
      ...place, icon: undefined, regionIds: [document.region.id], labelIds: [],
    })))
  }

  private editable(snapshot: SharedTripSnapshot): SharedTripDocument {
    if (!snapshot.document || snapshot.document.trip.access === 'viewer') throw new ValidationError('此行程目前僅供檢視或存取權已被撤銷。')
    return snapshot.document
  }

  saveItem(snapshot: SharedTripSnapshot, item: SharedTripItem, personalPlace?: Place): Promise<SharedTripSnapshot> {
    const before = this.editable(snapshot)
    let sharedPlace: SharedTripPlace | undefined
    let placeId = item.placeId
    if (personalPlace) {
      const existing = before.places.find((place) => personalPlace.googlePlaceId
        ? place.googlePlaceId === personalPlace.googlePlaceId
        : !place.googlePlaceId && place.mapsUrl === personalPlace.mapsUrl)
      placeId = existing?.id ?? crypto.randomUUID()
      if (!existing) {
        sharedPlace = {
          id: placeId, name: personalPlace.name, icon: personalPlace.icon,
          googlePlaceId: personalPlace.googlePlaceId, mapsUrl: personalPlace.mapsUrl,
        }
      }
    }
    const old = before.items.find((row) => row.id === item.id)
    const moved = old && old.date !== item.date
    const order = !old || moved
      ? before.items.filter((row) => row.date === item.date).reduce((maximum, row) => Math.max(maximum, row.order), -1) + 1
      : old.order
    const preserveEstimate = old && !moved && old.placeId === placeId && old.transport === item.transport
    let next: SharedTripDocument = {
      ...before, places: sharedPlace ? [...before.places, sharedPlace] : before.places,
      items: [...before.items.filter((row) => row.id !== item.id), {
        ...item, placeId, order,
        ...(preserveEstimate ? { travelDurationMinutes: old.travelDurationMinutes, travelDistanceMeters: old.travelDistanceMeters } : {}),
      }],
    }
    if (!old || moved || old.placeId !== placeId || old.transport !== item.transport) next = clearSharedEstimates(next)
    return sharedTrips.save(snapshot, parseSharedTripDocument(next))
  }

  deleteItem(snapshot: SharedTripSnapshot, itemId: string): Promise<SharedTripSnapshot> {
    const before = this.editable(snapshot)
    if (!before.items.some((item) => item.id === itemId)) throw new ValidationError('行程項目已不存在，請重新載入。')
    return sharedTrips.save(snapshot, clearSharedEstimates({ ...before, items: before.items.filter((item) => item.id !== itemId) }))
  }

  reorder(snapshot: SharedTripSnapshot, date: string, ids: string[]): Promise<SharedTripSnapshot> {
    const before = this.editable(snapshot)
    const day = before.items.filter((item) => item.date === date)
    if (ids.length !== day.length || new Set(ids).size !== ids.length || day.some((item) => !ids.includes(item.id))) {
      throw new ValidationError('每日安排已改變，請重新載入後排序。')
    }
    return sharedTrips.save(snapshot, clearSharedEstimates({
      ...before, items: before.items.map((item) => item.date === date ? { ...item, order: ids.indexOf(item.id) } : item),
    }))
  }

  async calculateTravel(snapshot: SharedTripSnapshot, itemId: string): Promise<SharedTripSnapshot> {
    const before = this.editable(snapshot)
    const item = before.items.find((row) => row.id === itemId)
    if (!item) throw new ValidationError('行程項目已不存在。')
    const day = before.items.filter((row) => row.date === item.date).sort((a, b) => a.order - b.order)
    const index = day.findIndex((row) => row.id === itemId)
    if (index <= 0) throw new ValidationError('第一站沒有上一站，不需要計算路程。')
    if (!item.transport || !isGoogleTravelMode(item.transport)) throw new ValidationError('請先選擇有效交通方式。')
    const origin = before.places.find((place) => place.id === day[index - 1].placeId)
    const destination = before.places.find((place) => place.id === item.placeId)
    if (!origin?.googlePlaceId || !destination?.googlePlaceId) throw new ValidationError('前後兩站都必須有 Google 地點，才能計算路程。')
    const estimate = await getGoogleRouteEstimate(origin.googlePlaceId, destination.googlePlaceId, item.transport)
    return sharedTrips.save(snapshot, {
      ...before, items: before.items.map((row) => row.id === item.id
        ? { ...row, travelDurationMinutes: estimate.durationMinutes, travelDistanceMeters: estimate.distanceMeters } : row),
    })
  }
}
