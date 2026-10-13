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
      async () => {
        const current = required(await database.places.get(id), 'Place', id)
        const next = { ...current, ...changes }
        validatePlace(next)
        await requireRegions(next.regionIds)
        await requireLabels(next.labelIds)
        await database.places.put(next)
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
        const itemCount = await database.itineraryItems.where('tripId').equals(id).count()
        if (itemCount) {
          throw new EntityInUseError(
            'Trip',
            id,
            'remove its itinerary items before deleting it.',
          )
        }
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
        const next = { ...current, ...changes }
        validateItineraryItem(next)
        await this.assertReferences(next)
        await database.itineraryItems.put(next)
      },
    )
  }

  async delete(id: string): Promise<void> {
    required(await database.itineraryItems.get(id), 'Itinerary item', id)
    await database.itineraryItems.delete(id)
  }

  getById(id: string): Promise<ItineraryItem | undefined> {
    return database.itineraryItems.get(id)
  }

  findByTripAndDate(tripId: string, date: string): Promise<ItineraryItem[]> {
    return database.itineraryItems
      .where('[tripId+date+order]')
      .between([tripId, date, Dexie.minKey], [tripId, date, Dexie.maxKey])
      .toArray()
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
