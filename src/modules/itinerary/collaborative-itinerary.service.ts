import { EntityNotFoundError, ValidationError } from '../../database'
import type { ItineraryItemChanges, Place, TripChanges } from '../../database'
import { placeIcons } from '../../database/models'
import { sharedTrips } from '../../database/shared-trip.repository'
import type { SharedTripSnapshot } from '../../database/shared-trip.types'
import { sharedTripEditingEnabled } from '../../database/shared-trip.types'
import { ItineraryService } from './itinerary.service'
import type { NewScheduledItem } from './itinerary.service'
import { SharedTripService } from './shared-trip.service'
import { ItineraryMapService } from './itinerary-map.service'

export class CollaborativeItineraryService extends ItineraryService {
  private snapshots: SharedTripSnapshot[] = []
  private personalPlaces: Place[] = []
  private editBase?: SharedTripSnapshot
  private readonly shared = new SharedTripService()

  override async loadWorkspace(tripId?: string) {
    const [personal, snapshots] = await Promise.all([
      super.loadWorkspace(), sharedTripEditingEnabled ? sharedTrips.list() : Promise.resolve([]),
    ])
    this.snapshots = snapshots
    this.personalPlaces = personal.places
    const trips = new Map(personal.trips.map((trip) => [trip.id, trip]))
    const regions = new Map(personal.regions.map((region) => [region.id, region]))
    const places = new Map(personal.places.map((place) => [place.id, place]))
    for (const { document } of snapshots) {
      if (!document) continue
      trips.set(document.trip.id, document.trip)
      regions.set(document.region.id, document.region)
    }
    const selected = tripId && trips.has(tripId) ? tripId : trips.keys().next().value
    const document = snapshots.find((row) => row.id === selected)?.document
    if (document) {
      if (document.trip.access === 'editor') {
        for (const place of personal.places) {
          places.set(place.id, { ...place, regionIds: [...new Set([...place.regionIds, document.region.id])] })
        }
      }
      for (const place of document.places) {
        const own = places.get(place.id)
        places.set(place.id, {
          ...own, ...place, icon: placeIcons.find((icon) => icon === place.icon),
          regionIds: [...new Set([...(own?.regionIds ?? []), document.region.id])],
          labelIds: own?.labelIds ?? [],
        })
      }
    }
    return { trips: [...trips.values()], regions: [...regions.values()], places: [...places.values()] }
  }

  private snapshot(tripId: string) {
    return this.snapshots.find((row) => row.id === tripId && row.document)
  }

  override getAccess(tripId: string) {
    return this.snapshot(tripId)?.document?.trip.access ?? 'owner'
  }

  override beginEdit(tripId: string) {
    this.editBase = this.snapshot(tripId)
  }

  private base(tripId: string) {
    return this.editBase?.id === tripId ? this.editBase : this.snapshot(tripId)
  }

  private remember(snapshot: SharedTripSnapshot) {
    this.snapshots = this.snapshots.map((row) => row.id === snapshot.id ? snapshot : row)
    this.editBase = undefined
  }

  override async listItems(tripId: string) {
    const shared = this.snapshot(tripId)
    return shared?.document
      ? shared.document.items.map((item) => ({ ...item, tripId }))
      : super.listItems(tripId)
  }

  override async loadMapData(regionId: string, tripId?: string) {
    const document = tripId ? this.snapshot(tripId)?.document : undefined
    if (!document) return super.loadMapData(regionId)
    const own = this.personalPlaces.filter((place) => place.regionIds.includes(regionId))
    const mapPlaces = new Map(own.map((place) => [place.id, place]))
    for (const place of document.places) {
      mapPlaces.set(place.id, { ...mapPlaces.get(place.id), ...place, icon: placeIcons.find((icon) => icon === place.icon), regionIds: [regionId], labelIds: [] })
    }
    return new ItineraryMapService().loadRecords(document.region, [...mapPlaces.values()])
  }

  override async addItem(input: NewScheduledItem) {
    const base = this.base(input.tripId)
    if (!base?.document) return super.addItem(input)
    const id = crypto.randomUUID()
    const personal = !base.document.places.some((place) => place.id === input.placeId)
      ? this.personalPlaces.find((place) => place.id === input.placeId) : undefined
    if (!personal && !base.document.places.some((place) => place.id === input.placeId)) {
      throw new ValidationError('地點已變更，請重新選擇。')
    }
    this.remember(await this.shared.saveItem(base, { ...input, id, order: 0 }, personal))
    return id
  }

  private itemSnapshot(id: string) {
    if (this.editBase?.document?.items.some((item) => item.id === id)) return this.editBase
    const current = this.snapshots.find((row) => row.document?.items.some((item) => item.id === id))
    return current ? this.base(current.id) : undefined
  }

  override async updateItem(id: string, changes: ItineraryItemChanges) {
    const base = this.itemSnapshot(id)
    if (!base?.document) return super.updateItem(id, changes)
    const item = base.document.items.find((row) => row.id === id)
    if (!item) throw new EntityNotFoundError('Itinerary item', id)
    if (changes.tripId && changes.tripId !== base.id) throw new ValidationError('不能將項目移到另一趟行程。')
    const next = { ...item, ...changes, id }
    const personal = !base.document.places.some((place) => place.id === next.placeId)
      ? this.personalPlaces.find((place) => place.id === next.placeId) : undefined
    this.remember(await this.shared.saveItem(base, next, personal))
  }

  override async deleteItem(id: string) {
    const base = this.itemSnapshot(id)
    if (!base) return super.deleteItem(id)
    this.remember(await this.shared.deleteItem(base, id))
  }

  override async reorderItems(tripId: string, date: string, ids: string[]) {
    const base = this.base(tripId)
    if (!base) return super.reorderItems(tripId, date, ids)
    this.remember(await this.shared.reorder(base, date, ids))
  }

  override async calculateTravelDuration(id: string) {
    const base = this.itemSnapshot(id)
    if (!base) return super.calculateTravelDuration(id)
    const saved = await this.shared.calculateTravel(base, id)
    const item = saved.document?.items.find((row) => row.id === id)
    if (item?.travelDurationMinutes === undefined || item.travelDistanceMeters === undefined) {
      throw new ValidationError('路程計算結果不完整，請重新載入確認。')
    }
    this.remember(saved)
    return { durationMinutes: item.travelDurationMinutes, distanceMeters: item.travelDistanceMeters }
  }

  override async updateTrip(id: string, changes: TripChanges) {
    if (this.getAccess(id) !== 'owner') throw new ValidationError('只有擁有者可修改行程基本資料。')
    await super.updateTrip(id, changes)
  }

  override async deleteTrip(id: string) {
    if (this.getAccess(id) !== 'owner') throw new ValidationError('只有擁有者可刪除行程。')
    await super.deleteTrip(id)
  }
}
