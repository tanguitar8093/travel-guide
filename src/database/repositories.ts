import Dexie from 'dexie'
import { database } from './database'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
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

async function requireRegions(ids: string[]): Promise<void> {
  const found = await database.regions.bulkGet(ids)
  const missing = ids.filter((_, index) => found[index] === undefined)
  if (missing.length) {
    throw new EntityNotFoundError('Region', missing[0])
  }
}

async function requireLabels(ids: string[]): Promise<void> {
  const found = await database.labels.bulkGet(ids)
  const missing = ids.filter((_, index) => found[index] === undefined)
  if (missing.length) {
    throw new EntityNotFoundError('Label', missing[0])
  }
}

export class RegionRepository {
  async create(input: NewRegion): Promise<string> {
    validateRegion(input)
    const id = createId()
    await database.regions.add({ ...input, id })
    return id
  }

  async update(id: string, changes: RegionChanges): Promise<void> {
    const current = required(await database.regions.get(id), 'Region', id)
    const next = { ...current, ...changes }
    validateRegion(next)
    await database.regions.put(next)
  }

  async delete(id: string): Promise<void> {
    await database.transaction(
      'rw',
      database.regions,
      database.places,
      database.trips,
      async () => {
        required(await database.regions.get(id), 'Region', id)
        const [placeCount, tripCount] = await Promise.all([
          database.places.where('regionIds').equals(id).count(),
          database.trips.where('regionId').equals(id).count(),
        ])
        if (placeCount || tripCount) {
          throw new EntityInUseError(
            'Region',
            id,
            'one or more places or trips still reference it.',
          )
        }
        await database.regions.delete(id)
      },
    )
  }

  getById(id: string): Promise<Region | undefined> {
    return database.regions.get(id)
  }

  list(): Promise<Region[]> {
    return database.regions.orderBy('name').toArray()
  }
}

export class PlaceRepository {
  async create(input: NewPlace): Promise<string> {
    validatePlace(input)
    const id = createId()
    await database.transaction(
      'rw',
      database.places,
      database.regions,
      database.labels,
      async () => {
        await requireRegions(input.regionIds)
        await requireLabels(input.labelIds)
        await database.places.add({ ...input, id })
      },
    )
    return id
  }

  async update(id: string, changes: PlaceChanges): Promise<void> {
    await database.transaction(
      'rw',
      database.places,
      database.regions,
      database.labels,
      database.itineraryItems,
      async () => {
        const current = required(await database.places.get(id), 'Place', id)
        const next = { ...current, ...changes }
        validatePlace(next)
        await requireRegions(next.regionIds)
        await requireLabels(next.labelIds)
        await database.places.put(next)

        if (current.googlePlaceId !== next.googlePlaceId) {
          const scheduledItems = await database.itineraryItems.where('placeId').equals(id).toArray()
          const staleEstimateIds = new Set(scheduledItems.map((item) => item.id))
          for (const item of scheduledItems) {
            const dayItems = await database.itineraryItems
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
            await database.itineraryItems.update(itemId, { travelDurationMinutes: undefined })
          }
        }
      },
    )
  }

  async addLabel(id: string, labelId: string): Promise<void> {
    await database.transaction(
      'rw',
      database.places,
      database.labels,
      async () => {
        const place = required(await database.places.get(id), 'Place', id)
        required(await database.labels.get(labelId), 'Label', labelId)
        if (!place.labelIds.includes(labelId)) {
          await database.places.put({
            ...place,
            labelIds: [...place.labelIds, labelId],
          })
        }
      },
    )
  }

  async removeLabel(id: string, labelId: string): Promise<void> {
    await database.transaction('rw', database.places, async () => {
      const place = required(await database.places.get(id), 'Place', id)
      if (place.labelIds.includes(labelId)) {
        await database.places.put({
          ...place,
          labelIds: place.labelIds.filter((currentId) => currentId !== labelId),
        })
      }
    })
  }

  async delete(id: string): Promise<void> {
    await database.transaction(
      'rw',
      database.places,
      database.itineraryItems,
      async () => {
        required(await database.places.get(id), 'Place', id)
        const itemCount = await database.itineraryItems.where('placeId').equals(id).count()
        if (itemCount) {
          throw new EntityInUseError(
            'Place',
            id,
            'remove its itinerary items before deleting it.',
          )
        }
        await database.places.delete(id)
      },
    )
  }

  getById(id: string): Promise<Place | undefined> {
    return database.places.get(id)
  }

  list(): Promise<Place[]> {
    return database.places.orderBy('name').toArray()
  }

  findByRegionId(regionId: string): Promise<Place[]> {
    return database.places.where('regionIds').equals(regionId).toArray()
  }

  async findByLabelIds(labelIds: string[]): Promise<Place[]> {
    if (!labelIds.length) {
      return []
    }
    return database.places.where('labelIds').anyOf(labelIds).distinct().toArray()
  }
}

export class TripRepository {
  async create(input: NewTrip): Promise<string> {
    validateTrip(input)
    const id = createId()
    await database.transaction(
      'rw',
      database.trips,
      database.regions,
      async () => {
        required(await database.regions.get(input.regionId), 'Region', input.regionId)
        await database.trips.add({ ...input, id })
      },
    )
    return id
  }

  async update(id: string, changes: TripChanges): Promise<void> {
    await database.transaction(
      'rw',
      database.trips,
      database.regions,
      database.itineraryItems,
      async () => {
        const current = required(await database.trips.get(id), 'Trip', id)
        const next = { ...current, ...changes }
        validateTrip(next)
        required(await database.regions.get(next.regionId), 'Region', next.regionId)
        const items = await database.itineraryItems.where('tripId').equals(id).toArray()
        if (items.some((item) => item.date < next.startDate || item.date > next.endDate)) {
          throw new ValidationError('Trip dates cannot exclude an existing itinerary item.')
        }
        await database.trips.put(next)
      },
    )
  }

  async delete(id: string): Promise<void> {
    await database.transaction(
      'rw',
      database.trips,
      database.itineraryItems,
      async () => {
        required(await database.trips.get(id), 'Trip', id)
        await database.itineraryItems.where('tripId').equals(id).delete()
        await database.trips.delete(id)
      },
    )
  }

  getById(id: string): Promise<Trip | undefined> {
    return database.trips.get(id)
  }

  list(): Promise<Trip[]> {
    return database.trips.orderBy('startDate').toArray()
  }
}

export class ItineraryItemRepository {
  async create(input: NewItineraryItem): Promise<string> {
    validateItineraryItem(input)
    const id = createId()
    await database.transaction(
      'rw',
      database.itineraryItems,
      database.trips,
      database.places,
      async () => {
        await this.assertReferences(input)
        await database.itineraryItems.add({ ...input, id })
      },
    )
    return id
  }

  async update(id: string, changes: ItineraryItemChanges): Promise<void> {
    await database.transaction(
      'rw',
      database.itineraryItems,
      database.trips,
      database.places,
      async () => {
        const current = required(await database.itineraryItems.get(id), 'Itinerary item', id)
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
          ...(routeChanged ? { travelDurationMinutes: undefined } : {}),
        }
        validateItineraryItem(next)
        await this.assertReferences(next)
        await database.itineraryItems.put(next)

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
              await database.itineraryItems.update(affectedId, { travelDurationMinutes: undefined })
            }
          }
        }
      },
    )
  }

  async delete(id: string): Promise<void> {
    await database.transaction('rw', database.itineraryItems, async () => {
      const current = required(await database.itineraryItems.get(id), 'Itinerary item', id)
      const dayItems = await this.findByTripAndDate(current.tripId, current.date)
      const index = dayItems.findIndex((item) => item.id === id)
      const successor = dayItems[index + 1]
      await database.itineraryItems.delete(id)
      if (successor) {
        await database.itineraryItems.update(successor.id, { travelDurationMinutes: undefined })
      }
    })
  }

  getById(id: string): Promise<ItineraryItem | undefined> {
    return database.itineraryItems.get(id)
  }

  findByTripId(tripId: string): Promise<ItineraryItem[]> {
    return database.itineraryItems.where('tripId').equals(tripId).sortBy('date')
      .then((items) => items.sort(
        (left, right) => left.date.localeCompare(right.date) || left.order - right.order,
      ))
  }

  findByTripAndDate(tripId: string, date: string): Promise<ItineraryItem[]> {
    return database.itineraryItems
      .where('[tripId+date+order]')
      .between([tripId, date, Dexie.minKey], [tripId, date, Dexie.maxKey])
      .toArray()
  }

  async reorderForDate(tripId: string, date: string, orderedIds: string[]): Promise<void> {
    await database.transaction('rw', database.itineraryItems, async () => {
      const currentItems = await this.findByTripAndDate(tripId, date)
      const currentIds = new Set(currentItems.map((item) => item.id))
      const nextIds = new Set(orderedIds)
      if (
        orderedIds.length !== currentItems.length ||
        nextIds.size !== orderedIds.length ||
        orderedIds.some((id) => !currentIds.has(id))
      ) {
        throw new ValidationError('The reordered itinerary items do not match this trip day.')
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

      await database.itineraryItems.bulkPut(
        orderedIds.map((id, order) => {
          const item = currentItems.find((candidate) => candidate.id === id)
          if (!item) {
            throw new EntityNotFoundError('Itinerary item', id)
          }
          return {
            ...item,
            order,
            ...(previousById.get(id) !== nextPreviousById.get(id)
              ? { travelDurationMinutes: undefined }
              : {}),
          }
        }),
      )
    })
  }

  private async assertReferences(item: NewItineraryItem): Promise<void> {
    const [trip, place] = await Promise.all([
      database.trips.get(item.tripId),
      database.places.get(item.placeId),
    ])
    const tripRecord = required(trip, 'Trip', item.tripId)
    required(place, 'Place', item.placeId)

    if (item.date < tripRecord.startDate || item.date > tripRecord.endDate) {
      throw new ValidationError('Itinerary item date must be within the trip dates.')
    }
  }
}

export const regions = new RegionRepository()
export const places = new PlaceRepository()
export const trips = new TripRepository()
export const itineraryItems = new ItineraryItemRepository()
