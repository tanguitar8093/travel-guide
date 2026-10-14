import { database } from './database'
import { ValidationError } from './errors'
import type { ItineraryItem, Label, Place, Region, Trip } from './models'
import {
  validateItineraryItem,
  validateLabel,
  validatePlace,
  validateRegion,
  validateTrip,
} from './validation'

export interface TravelBackup {
  format: 'travel-planner-backup'
  version: 1
  exportedAt: string
  data: {
    regions: Region[]
    places: Place[]
    labels: Label[]
    trips: Trip[]
    itineraryItems: ItineraryItem[]
  }
}

export interface BackupCounts {
  regions: number
  places: number
  labels: number
  trips: number
  itineraryItems: number
}

const backupKeys = ['format', 'version', 'exportedAt', 'data']
const dataKeys = ['regions', 'places', 'labels', 'trips', 'itineraryItems']

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${name} must be an object.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(
  record: Record<string, unknown>,
  requiredKeys: string[],
  optionalKeys: string[] = [],
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  const missing = requiredKeys.filter((key) => !Object.hasOwn(record, key))
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ValidationError(
      `Backup object has missing or unsupported fields${missing.length ? `: ${missing.join(', ')}` : ''}${unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : ''}.`,
    )
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be text.`)
  }
}

function validateRecord<T extends { id: string }>(
  value: unknown,
  entity: string,
  requiredKeys: string[],
  optionalKeys: string[],
  validate: (record: Omit<T, 'id'>) => void,
): T {
  const record = requireRecord(value, entity)
  requireExactKeys(record, ['id', ...requiredKeys], optionalKeys)
  requireString(record.id, `${entity} ID`)
  if (!record.id.trim()) {
    throw new ValidationError(`${entity} ID must not be empty.`)
  }
  validate(record as Omit<T, 'id'>)
  return record as T
}

function validateUniqueIds<T extends { id: string }>(records: T[], entity: string): void {
  const ids = new Set<string>()
  for (const record of records) {
    if (ids.has(record.id)) throw new ValidationError(`Backup contains duplicate ${entity} ID "${record.id}".`)
    ids.add(record.id)
  }
}

function validateReferences(backup: TravelBackup): void {
  const regionIds = new Set(backup.data.regions.map((region) => region.id))
  const placeIds = new Set(backup.data.places.map((place) => place.id))
  const labelById = new Map(backup.data.labels.map((label) => [label.id, label]))
  const tripById = new Map(backup.data.trips.map((trip) => [trip.id, trip]))

  for (const place of backup.data.places) {
    for (const regionId of place.regionIds) {
      if (!regionIds.has(regionId)) {
        throw new ValidationError(`Place "${place.id}" references missing region "${regionId}".`)
      }
    }
    for (const labelId of place.labelIds) {
      if (!labelById.has(labelId)) {
        throw new ValidationError(`Place "${place.id}" references missing label "${labelId}".`)
      }
    }
  }

  for (const label of backup.data.labels) {
    if (label.parentId !== undefined && !labelById.has(label.parentId)) {
      throw new ValidationError(`Label "${label.id}" references missing parent "${label.parentId}".`)
    }
    const visited = new Set<string>([label.id])
    let parentId = label.parentId
    while (parentId !== undefined) {
      if (visited.has(parentId)) {
        throw new ValidationError(`Backup label hierarchy contains a cycle at "${label.id}".`)
      }
      visited.add(parentId)
      parentId = labelById.get(parentId)?.parentId
    }
  }

  for (const trip of backup.data.trips) {
    if (!regionIds.has(trip.regionId)) {
      throw new ValidationError(`Trip "${trip.id}" references missing region "${trip.regionId}".`)
    }
  }

  const ordersByTripDate = new Set<string>()
  for (const item of backup.data.itineraryItems) {
    const trip = tripById.get(item.tripId)
    if (!trip) {
      throw new ValidationError(`Itinerary item "${item.id}" references missing trip "${item.tripId}".`)
    }
    if (!placeIds.has(item.placeId)) {
      throw new ValidationError(`Itinerary item "${item.id}" references missing place "${item.placeId}".`)
    }
    if (item.date < trip.startDate || item.date > trip.endDate) {
      throw new ValidationError(`Itinerary item "${item.id}" is outside its trip dates.`)
    }
    const orderKey = `${item.tripId}\u0000${item.date}\u0000${item.order}`
    if (ordersByTripDate.has(orderKey)) {
      throw new ValidationError(`Backup has duplicate itinerary order ${item.order} for trip "${item.tripId}" on ${item.date}.`)
    }
    ordersByTripDate.add(orderKey)
  }
}

function validateBackup(value: unknown): TravelBackup {
  const root = requireRecord(value, 'Backup')
  requireExactKeys(root, backupKeys)
  if (root.format !== 'travel-planner-backup' || root.version !== 1) {
    throw new ValidationError('Unsupported backup format or version.')
  }
  requireString(root.exportedAt, 'Backup exportedAt')
  if (!Number.isFinite(Date.parse(root.exportedAt))) {
    throw new ValidationError('Backup exportedAt must be a valid date.')
  }

  const data = requireRecord(root.data, 'Backup data')
  requireExactKeys(data, dataKeys)
  for (const key of dataKeys) {
    if (!Array.isArray(data[key])) {
      throw new ValidationError(`Backup data "${key}" must be an array.`)
    }
  }

  const regions = (data.regions as unknown[]).map((record) => {
    const regionRecord = requireRecord(record, 'Region')
    if (Object.hasOwn(regionRecord, 'center')) {
      const center = requireRecord(regionRecord.center, 'Region center')
      requireExactKeys(center, ['latitude', 'longitude'])
    }
    return validateRecord<Region>(
      regionRecord,
      'Region',
      ['name', 'zoom'],
      ['center', 'googlePlaceId'],
      validateRegion,
    )
  })
  const places = (data.places as unknown[]).map((record) =>
    validateRecord<Place>(
      record,
      'Place',
      ['name', 'regionIds', 'labelIds'],
      ['icon', 'mapsUrl', 'googlePlaceId', 'notes'],
      validatePlace,
    ),
  )
  const labels = (data.labels as unknown[]).map((record) =>
    validateRecord<Label>(record, 'Label', ['name', 'color'], ['parentId'], validateLabel),
  )
  const trips = (data.trips as unknown[]).map((record) =>
    validateRecord<Trip>(record, 'Trip', ['regionId', 'name', 'startDate', 'endDate'], [], validateTrip),
  )
  const itineraryItems = (data.itineraryItems as unknown[]).map((record) =>
    validateRecord<ItineraryItem>(
      record,
      'Itinerary item',
      ['tripId', 'placeId', 'date', 'order'],
      ['arrivalTime', 'durationMinutes', 'transport', 'travelDurationMinutes', 'note'],
      validateItineraryItem,
    ),
  )
  validateUniqueIds(regions, 'region')
  validateUniqueIds(places, 'place')
  validateUniqueIds(labels, 'label')
  validateUniqueIds(trips, 'trip')
  validateUniqueIds(itineraryItems, 'itinerary item')

  const backup: TravelBackup = {
    format: 'travel-planner-backup',
    version: 1,
    exportedAt: root.exportedAt,
    data: { regions, places, labels, trips, itineraryItems },
  }
  validateReferences(backup)
  return backup
}

export class BackupRepository {
  async exportAll(): Promise<TravelBackup> {
    return database.transaction(
      'r',
      database.regions,
      database.places,
      database.labels,
      database.trips,
      database.itineraryItems,
      async () => {
        const [regions, places, labels, trips, itineraryItems] = await Promise.all([
          database.regions.toArray(),
          database.places.toArray(),
          database.labels.toArray(),
          database.trips.toArray(),
          database.itineraryItems.toArray(),
        ])
        return validateBackup({
          format: 'travel-planner-backup',
          version: 1,
          exportedAt: new Date().toISOString(),
          data: { regions, places, labels, trips, itineraryItems },
        })
      },
    )
  }

  validateImport(value: unknown): TravelBackup {
    return validateBackup(value)
  }

  async replaceAll(value: unknown): Promise<BackupCounts> {
    const backup = validateBackup(value)
    const { regions, places, labels, trips, itineraryItems } = backup.data
    await database.transaction(
      'rw',
      database.regions,
      database.places,
      database.labels,
      database.trips,
      database.itineraryItems,
      async () => {
        await database.itineraryItems.clear()
        await database.trips.clear()
        await database.places.clear()
        await database.labels.clear()
        await database.regions.clear()
        await database.regions.bulkAdd(regions)
        await database.places.bulkAdd(places)
        await database.labels.bulkAdd(labels)
        await database.trips.bulkAdd(trips)
        await database.itineraryItems.bulkAdd(itineraryItems)
      },
    )
    return {
      regions: regions.length,
      places: places.length,
      labels: labels.length,
      trips: trips.length,
      itineraryItems: itineraryItems.length,
    }
  }

  async clearAllData(): Promise<void> {
    await database.transaction(
      'rw',
      database.regions,
      database.places,
      database.labels,
      database.trips,
      database.itineraryItems,
      async () => {
        await database.itineraryItems.clear()
        await database.trips.clear()
        await database.places.clear()
        await database.labels.clear()
        await database.regions.clear()
      },
    )
  }
}

export const backupRepository = new BackupRepository()
