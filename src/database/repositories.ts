import Dexie from 'dexie'
import { database, type TravelDatabase } from './database'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import { findDuplicatePlace, sameStoredLocation } from './location.validation'
import { placeDuplicateMessage } from '../geo/place-duplicate'
import { clearRouteEndpointReferences } from './route-endpoint'
import type {
  ItineraryItem,
  ItineraryItemChanges,
  NewItineraryItem,
  NewPlace,
  NewRegion,
  NewTrip,
  Place,
  PlaceChanges,
  Region,
  RegionChanges,
  Trip,
  TripChanges,
} from './models'
import {
  validateItineraryItem,
  validatePlace,
  validateRegion,
  validatePlaceRegionProviders,
  validateTrip,
} from './validation'

function createId(): string {
  return crypto.randomUUID()
}

function required<T>(value: T | undefined, entity: string, id: string): T {
  if (value === undefined) {
    throw new EntityNotFoundError(entity, id)
  }
  return value
}

async function requireRegions(storage: TravelDatabase, ids: string[]): Promise<void> {
  const found = await storage.regions.bulkGet(ids)
  const missing = ids.filter((_, index) => found[index] === undefined)
  if (missing.length) {
    throw new EntityNotFoundError('Region', missing[0])
  }
}

async function requireLabels(storage: TravelDatabase, ids: string[]): Promise<void> {
  const found = await storage.labels.bulkGet(ids)
  const missing = ids.filter((_, index) => found[index] === undefined)
  if (missing.length) {
    throw new EntityNotFoundError('Label', missing[0])
  }
}

export class RegionRepository {
  private readonly database: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.database = storage
  }

  async create(input: NewRegion): Promise<string> {
    validateRegion(input)
    const id = createId()
    await this.database.regions.add({ ...input, id })
    return id
  }

  async update(id: string, changes: RegionChanges): Promise<void> {
    await this.database.transaction('rw', this.database.regions, async () => {
      const current = required(await this.database.regions.get(id), 'Region', id)
      const next = { ...current, ...changes }
      validateRegion(next)
      await this.database.regions.put(next)
    })
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.regions,
      this.database.places,
      this.database.trips,
      async () => {
        required(await this.database.regions.get(id), 'Region', id)
        const [placeCount, tripCount] = await Promise.all([
          this.database.places.where('regionIds').equals(id).count(),
          this.database.trips.where('regionId').equals(id).count(),
        ])
        if (placeCount || tripCount) {
          throw new EntityInUseError(
            'Region',
            id,
            '仍有地點或行程使用此區域。',
          )
        }
        await this.database.regions.delete(id)
      },
    )
  }

  getById(id: string): Promise<Region | undefined> {
    return this.database.regions.get(id)
  }

  list(): Promise<Region[]> {
    return this.database.regions.orderBy('name').toArray()
  }
}

export class PlaceRepository {
  private readonly database: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.database = storage
  }

  async create(input: NewPlace): Promise<string> {
    validatePlace(input)
    const id = createId()
    await this.database.transaction(
      'rw',
      this.database.places,
      this.database.regions,
      this.database.labels,
      async () => {
        await requireRegions(this.database, input.regionIds)
        await requireLabels(this.database, input.labelIds)
        const linkedRegions = (await this.database.regions.bulkGet(input.regionIds))
          .filter((region): region is Region => region !== undefined)
        validatePlaceRegionProviders(input, linkedRegions)
        if (input.location) {
          const duplicate = findDuplicatePlace(await this.database.places.toArray(), input, undefined, await this.database.regions.toArray())
          if (duplicate) throw new ValidationError(placeDuplicateMessage(duplicate.place.name, duplicate.reason))
        }
        await this.database.places.add({ ...input, id })
      },
    )
    return id
  }

  async update(id: string, changes: PlaceChanges): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.places,
      this.database.regions,
      this.database.labels,
      this.database.itineraryItems,
      async () => {
        const current = required(await this.database.places.get(id), 'Place', id)
        const next = { ...current, ...changes }
        validatePlace(next)
        await requireRegions(this.database, next.regionIds)
        await requireLabels(this.database, next.labelIds)
        const linkedRegions = (await this.database.regions.bulkGet(next.regionIds))
          .filter((region): region is Region => region !== undefined)
        validatePlaceRegionProviders(next, linkedRegions)
        if (next.location && (current.name !== next.name || !current.location ||
            current.location.coordinate.latitude !== next.location.coordinate.latitude ||
            current.location.coordinate.longitude !== next.location.coordinate.longitude)) {
          const duplicate = findDuplicatePlace(await this.database.places.toArray(), next, id, await this.database.regions.toArray())
          if (duplicate) throw new ValidationError(placeDuplicateMessage(duplicate.place.name, duplicate.reason))
        }
        await this.database.places.put(next)

        if (current.googlePlaceId !== next.googlePlaceId || !sameStoredLocation(current.location, next.location)) {
          const scheduledItems = await this.database.itineraryItems.where('placeId').equals(id).toArray()
          const staleEstimateIds = new Set(scheduledItems.map((item) => item.id))
          for (const item of scheduledItems) {
            const dayItems = await this.database.itineraryItems
              .where('[tripId+date+order]')
              .between(
                [item.tripId, item.date, Dexie.minKey],
                [item.tripId, item.date, Dexie.maxKey],
              )
              .toArray()
            const nextIndex = dayItems.findIndex((candidate) => candidate.id === item.id)
            const nextItem = dayItems[nextIndex + 1]
            if (nextItem) staleEstimateIds.add(nextItem.id)
          }
          for (const itemId of staleEstimateIds) {
            await this.database.itineraryItems.update(itemId, { travelDurationMinutes: undefined, travelDistanceMeters: undefined })
          }
        }
      },
    )
  }

  async addLabel(id: string, labelId: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.places,
      this.database.labels,
      async () => {
        const place = required(await this.database.places.get(id), 'Place', id)
        required(await this.database.labels.get(labelId), 'Label', labelId)
        if (!place.labelIds.includes(labelId)) {
          await this.database.places.put({
            ...place,
            labelIds: [...place.labelIds, labelId],
          })
        }
      },
    )
  }

  async removeLabel(id: string, labelId: string): Promise<void> {
    await this.database.transaction('rw', this.database.places, async () => {
      const place = required(await this.database.places.get(id), 'Place', id)
      if (place.labelIds.includes(labelId)) {
        await this.database.places.put({
          ...place,
          labelIds: place.labelIds.filter((currentId) => currentId !== labelId),
        })
      }
    })
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.places,
      this.database.itineraryItems,
      this.database.routeMaps,
      async () => {
        required(await this.database.places.get(id), 'Place', id)
        const itemCount = await this.database.itineraryItems.where('placeId').equals(id).count()
        if (itemCount) {
          throw new EntityInUseError(
            'Place',
            id,
            '請先移除使用此地點的行程項目，再刪除此地點。',
          )
        }
        await clearRouteEndpointReferences(this.database, endpoint => endpoint.kind === 'place' && endpoint.placeId === id)
        await this.database.places.delete(id)
      },
    )
  }

  getById(id: string): Promise<Place | undefined> {
    return this.database.places.get(id)
  }

  list(): Promise<Place[]> {
    return this.database.places.orderBy('name').toArray()
  }

  findByRegionId(regionId: string): Promise<Place[]> {
    return this.database.places.where('regionIds').equals(regionId).toArray()
  }

  async findByLabelIds(labelIds: string[]): Promise<Place[]> {
    if (!labelIds.length) {
      return []
    }
    return this.database.places.where('labelIds').anyOf(labelIds).distinct().toArray()
  }
}

export class TripRepository {
  private readonly database: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.database = storage
  }

  async create(input: NewTrip): Promise<string> {
    validateTrip(input)
    const id = createId()
    await this.database.transaction(
      'rw',
      this.database.trips,
      this.database.regions,
      async () => {
        required(await this.database.regions.get(input.regionId), 'Region', input.regionId)
        await this.database.trips.add({ ...input, id })
      },
    )
    return id
  }

  async update(id: string, changes: TripChanges): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.trips,
      this.database.regions,
      this.database.itineraryItems,
      this.database.places,
      async () => {
        const current = required(await this.database.trips.get(id), 'Trip', id)
        const next = { ...current, ...changes }
        validateTrip(next)
        const nextRegion = required(await this.database.regions.get(next.regionId), 'Region', next.regionId)
        const items = await this.database.itineraryItems.where('tripId').equals(id).toArray()
        if (items.some((item) => item.date < next.startDate || item.date > next.endDate)) {
          throw new ValidationError('行程日期必須涵蓋所有既有的行程項目。')
        }
        if (nextRegion.mapProvider === 'osm' && next.regionId !== current.regionId) {
          for (const item of items) {
            const place = await this.database.places.get(item.placeId)
            if (place?.location && !place.regionIds.includes(next.regionId)) throw new ValidationError('行程內仍有其他區域的地點，無法切換區域。')
          }
        }
        await this.database.trips.put(next)
      },
    )
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.trips,
      this.database.itineraryItems,
      this.database.routeMaps,
      this.database.routeMapPlaces,
      async () => {
        required(await this.database.trips.get(id), 'Trip', id)
        const maps = await this.database.routeMaps.where('tripId').equals(id).toArray()
        for (const map of maps) {
          await this.database.routeMapPlaces.where('routeMapId').equals(map.id).delete()
          await this.database.routeMaps.delete(map.id)
        }
        await this.database.itineraryItems.where('tripId').equals(id).delete()
        await this.database.trips.delete(id)
      },
    )
  }

  getById(id: string): Promise<Trip | undefined> {
    return this.database.trips.get(id)
  }

  list(): Promise<Trip[]> {
    return this.database.trips.orderBy('startDate').toArray()
  }
}

export class ItineraryItemRepository {
  private readonly database: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.database = storage
  }

  async create(input: NewItineraryItem): Promise<string> {
    validateItineraryItem(input)
    const id = createId()
    await this.database.transaction(
      'rw',
      this.database.itineraryItems,
      this.database.trips,
      this.database.places,
      this.database.regions,
      async () => {
        await this.assertReferences(input)
        await this.database.itineraryItems.add({ ...input, id })
      },
    )
    return id
  }

  async update(id: string, changes: ItineraryItemChanges): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.itineraryItems,
      this.database.trips,
      this.database.places,
      this.database.regions,
      async () => {
        const current = required(await this.database.itineraryItems.get(id), 'Itinerary item', id)
        const routeChanged =
          changes.placeId !== undefined && changes.placeId !== current.placeId ||
          Object.hasOwn(changes, 'transport') && changes.transport !== current.transport ||
          changes.date !== undefined && changes.date !== current.date ||
          changes.order !== undefined && changes.order !== current.order
        const affectedDates = new Set([current.date])
        if (changes.date) affectedDates.add(changes.date)
        const beforeByDate = new Map<string, ItineraryItem[]>()
        if (routeChanged) {
          for (const date of affectedDates) {
            beforeByDate.set(date, await this.findByTripAndDate(current.tripId, date))
          }
        }

        const next = {
          ...current,
          ...changes,
          ...(routeChanged ? { travelDurationMinutes: undefined, travelDistanceMeters: undefined } : {}),
        }
        validateItineraryItem(next)
        await this.assertReferences(next)
        await this.database.itineraryItems.put(next)

        if (routeChanged) {
          for (const date of affectedDates) {
            const beforeItems = beforeByDate.get(date) ?? []
            const afterItems = await this.findByTripAndDate(current.tripId, date)
            const beforeIndex = beforeItems.findIndex((item) => item.id === id)
            const afterIndex = afterItems.findIndex((item) => item.id === id)
            const affectedIds = new Set<string>()
            if (beforeIndex >= 0 && beforeItems[beforeIndex + 1]) {
              affectedIds.add(beforeItems[beforeIndex + 1].id)
            }
            if (afterIndex >= 0 && afterItems[afterIndex + 1]) {
              affectedIds.add(afterItems[afterIndex + 1].id)
            }
            for (const affectedId of affectedIds) {
              await this.database.itineraryItems.update(affectedId, { travelDurationMinutes: undefined, travelDistanceMeters: undefined })
            }
          }
        }
      },
    )
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction('rw', this.database.itineraryItems, async () => {
      const current = required(await this.database.itineraryItems.get(id), 'Itinerary item', id)
      const dayItems = await this.findByTripAndDate(current.tripId, current.date)
      const index = dayItems.findIndex((item) => item.id === id)
      const successor = dayItems[index + 1]
      await this.database.itineraryItems.delete(id)
      if (successor) {
        await this.database.itineraryItems.update(successor.id, { travelDurationMinutes: undefined, travelDistanceMeters: undefined })
      }
    })
  }

  getById(id: string): Promise<ItineraryItem | undefined> {
    return this.database.itineraryItems.get(id)
  }

  findByTripId(tripId: string): Promise<ItineraryItem[]> {
    return this.database.itineraryItems.where('tripId').equals(tripId).sortBy('date')
      .then((items) => items.sort(
        (left, right) => left.date.localeCompare(right.date) || left.order - right.order,
      ))
  }

  findByTripAndDate(tripId: string, date: string): Promise<ItineraryItem[]> {
    return this.database.itineraryItems
      .where('[tripId+date+order]')
      .between([tripId, date, Dexie.minKey], [tripId, date, Dexie.maxKey])
      .toArray()
  }

  async reorderForDate(tripId: string, date: string, orderedIds: string[]): Promise<void> {
    await this.database.transaction('rw', this.database.itineraryItems, async () => {
      const currentItems = await this.findByTripAndDate(tripId, date)
      const currentIds = new Set(currentItems.map((item) => item.id))
      const nextIds = new Set(orderedIds)
      if (
        orderedIds.length !== currentItems.length ||
        nextIds.size !== orderedIds.length ||
        orderedIds.some((id) => !currentIds.has(id))
      ) {
        throw new ValidationError('排序清單與當日行程項目不一致，請重新載入後再試。')
      }

      const previousById = new Map<string, string | undefined>()
      const nextPreviousById = new Map<string, string | undefined>()
      for (let index = 0; index < currentItems.length; index += 1) {
        previousById.set(currentItems[index].id, currentItems[index - 1]?.placeId)
      }
      const nextItems = orderedIds.map((id) => {
        const item = currentItems.find((candidate) => candidate.id === id)
        if (!item) {
          throw new EntityNotFoundError('Itinerary item', id)
        }
        return item
      })
      for (let index = 0; index < nextItems.length; index += 1) {
        nextPreviousById.set(nextItems[index].id, nextItems[index - 1]?.placeId)
      }

      await this.database.itineraryItems.bulkPut(
        orderedIds.map((id, order) => {
          const item = currentItems.find((candidate) => candidate.id === id)
          if (!item) {
            throw new EntityNotFoundError('Itinerary item', id)
          }
          return {
            ...item,
            order,
            ...(previousById.get(id) !== nextPreviousById.get(id)
              ? { travelDurationMinutes: undefined, travelDistanceMeters: undefined }
              : {}),
          }
        }),
      )
    })
  }

  private async assertReferences(item: NewItineraryItem): Promise<void> {
    const [trip, place] = await Promise.all([
      this.database.trips.get(item.tripId),
      this.database.places.get(item.placeId),
    ])
    const tripRecord = required(trip, 'Trip', item.tripId)
    const placeRecord = required(place, 'Place', item.placeId)
    const region = await this.database.regions.get(tripRecord.regionId)
    if (region?.mapProvider === 'osm' && !placeRecord.regionIds.includes(tripRecord.regionId)) {
      throw new ValidationError('此地點不屬於行程區域，請選擇相同區域的地點。')
    }

    if (item.date < tripRecord.startDate || item.date > tripRecord.endDate) {
      throw new ValidationError('行程項目日期必須在行程起訖日期內。')
    }
  }
}

export const regions = new RegionRepository()
export const places = new PlaceRepository()
export const trips = new TripRepository()
export const itineraryItems = new ItineraryItemRepository()
