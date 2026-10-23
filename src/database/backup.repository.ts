import { database, type TravelDatabase } from './database'
import { ValidationError } from './errors'
import type { ItineraryItem, Label, Place, Region, Trip, RouteMap, RouteMapPlace } from './models'
import { getRouteMapEndpoint } from './route-endpoint'
import { hasGeoFormatFields } from './geo-format'
import {
  validateItineraryItem,
  validateLabel,
  validatePlace,
  validateRegion,
  validateTrip,
  validateRouteMap,
  validateRouteMapPlace,
  validatePlaceRegionProviders,
} from './validation'

export interface TravelBackup {
  format: 'travel-planner-backup'
  version: 1 | 2 | 3
  exportedAt: string
  data: {
    regions: Region[]
    places: Place[]
    labels: Label[]
    trips: Trip[]
    itineraryItems: ItineraryItem[]
    routeMaps?: RouteMap[]
    routeMapPlaces?: RouteMapPlace[]
  }
}

export interface NormalizedTravelBackup extends TravelBackup {
  data: TravelBackup['data'] & { routeMaps: RouteMap[]; routeMapPlaces: RouteMapPlace[] }
}

export interface BackupCounts {
  regions: number
  places: number
  labels: number
  trips: number
  itineraryItems: number
  routeMaps?: number
  routeMapPlaces?: number
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

function validateReferences(backup: NormalizedTravelBackup): void {
  const regionIds = new Set(backup.data.regions.map((region) => region.id))
  const placeIds = new Set(backup.data.places.map((place) => place.id))
  const labelById = new Map(backup.data.labels.map((label) => [label.id, label]))
  const tripById = new Map(backup.data.trips.map((trip) => [trip.id, trip]))
  const mapIds = new Set(backup.data.routeMaps.map((map) => map.id))
  const markersById = new Map(backup.data.routeMapPlaces.map(marker => [marker.id, marker]))
  for (const place of backup.data.places) {
    const linkedRegions = backup.data.regions.filter(region => place.regionIds.includes(region.id))
    validatePlaceRegionProviders(place, linkedRegions)
  }
  const mapTrips = new Set<string>()
  for (const map of backup.data.routeMaps) {
    for (const side of ['origin', 'destination'] as const) {
      const endpoint = getRouteMapEndpoint(map, side)
      if (endpoint?.kind === 'shared-place') {
        throw new ValidationError('私人備份不包含共享文件；請先移除共享地點端點或改選私人位置。')
      }
      if (endpoint?.kind === 'place' && !placeIds.has(endpoint.placeId)) {
        throw new ValidationError('Route endpoint references a missing place.')
      }
      if (endpoint?.kind === 'route-map-place' && markersById.get(endpoint.routeMapPlaceId)?.routeMapId !== map.id) {
        throw new ValidationError('Route endpoint marker is missing or belongs to another map.')
      }
    }
    if (!map.tripId) continue
    if (!tripById.has(map.tripId)) throw new ValidationError(`Route map "${map.id}" references a missing trip.`)
    if (mapTrips.has(map.tripId)) throw new ValidationError('A trip cannot have multiple route maps.')
    mapTrips.add(map.tripId)
  }
  const mapPlaces = new Set<string>()
  for (const place of backup.data.routeMapPlaces) {
    if (!mapIds.has(place.routeMapId)) throw new ValidationError(`Route map place "${place.id}" references a missing map.`)
    const references: [string, string][] = []
    if (place.googlePlaceId !== undefined) references.push(['google', place.googlePlaceId])
    if (place.location?.source === 'osm') references.push(['osm', place.location.reference.id])
    for (const [provider, reference] of references) {
      const key = JSON.stringify([place.routeMapId, provider, reference])
      if (mapPlaces.has(key)) throw new ValidationError('Duplicate route map provider reference.')
      mapPlaces.add(key)
    }
  }

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

function validateBackup(value: unknown): NormalizedTravelBackup {
  const root = requireRecord(value, 'Backup')
  requireExactKeys(root, backupKeys)
  if (root.format !== 'travel-planner-backup' || (root.version !== 1 && root.version !== 2 && root.version !== 3)) {
    throw new ValidationError('Unsupported backup format or version.')
  }
  requireString(root.exportedAt, 'Backup exportedAt')
  if (!Number.isFinite(Date.parse(root.exportedAt))) {
    throw new ValidationError('Backup exportedAt must be a valid date.')
  }

  const data = requireRecord(root.data, 'Backup data')
  const geo = root.version === 3
  const keys = root.version !== 1 ? [...dataKeys, 'routeMaps', 'routeMapPlaces'] : dataKeys
  requireExactKeys(data, keys)
  for (const key of keys) {
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
      ['center', 'googlePlaceId', ...(geo ? ['centerMetadata', 'mapProvider'] : [])],
      validateRegion,
    )
  })
  const places = (data.places as unknown[]).map((record) =>
    validateRecord<Place>(
      record,
      'Place',
      ['name', 'regionIds', 'labelIds'],
      ['icon', 'mapsUrl', 'googlePlaceId', 'notes', ...(geo ? ['location'] : [])],
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
      ['arrivalTime', 'durationMinutes', 'transport', 'travelDurationMinutes', 'travelDistanceMeters', 'note'],
      validateItineraryItem,
    ),
  )
  const routeMaps = ((data.routeMaps ?? []) as unknown[]).map((record) =>
    validateRecord<RouteMap>(record, 'Route map', ['name', 'transport'],
      ['tripId', 'selectedDate', 'originGooglePlaceId', 'destinationGooglePlaceId', ...(geo ? ['origin', 'destination'] : [])], validateRouteMap))
  const routeMapPlaces = ((data.routeMapPlaces ?? []) as unknown[]).map((record) =>
    validateRecord<RouteMapPlace>(record, 'Route map place',
      geo ? ['routeMapId'] : ['routeMapId', 'googlePlaceId'],
      geo ? ['name', 'googlePlaceId', 'location'] : ['name'], validateRouteMapPlace))
  validateUniqueIds(regions, 'region')
  validateUniqueIds(places, 'place')
  validateUniqueIds(labels, 'label')
  validateUniqueIds(trips, 'trip')
  validateUniqueIds(itineraryItems, 'itinerary item')
  validateUniqueIds(routeMaps, 'route map')
  validateUniqueIds(routeMapPlaces, 'route map place')

  const backup: NormalizedTravelBackup = {
    format: 'travel-planner-backup',
    version: geo ? 3 : 2,
    exportedAt: root.exportedAt,
    data: { regions, places, labels, trips, itineraryItems, routeMaps, routeMapPlaces },
  }
  validateReferences(backup)
  return backup
}

export class BackupRepository {
  private readonly storage: TravelDatabase

  constructor(storage: TravelDatabase = database) {
    this.storage = storage
  }

  async exportAll(): Promise<NormalizedTravelBackup> {
    const database = this.storage
    return database.transaction(
      'r',
      database.tables,
      async () => {
        const [regions, places, labels, trips, itineraryItems, routeMaps, routeMapPlaces] = await Promise.all([
          database.regions.toArray(),
          database.places.toArray(),
          database.labels.toArray(),
          database.trips.toArray(),
          database.itineraryItems.toArray(),
          database.routeMaps.toArray(),
          database.routeMapPlaces.toArray(),
        ])
        const data = { regions, places, labels, trips, itineraryItems, routeMaps, routeMapPlaces }
        const geo = [...regions, ...places, ...routeMaps, ...routeMapPlaces].some(hasGeoFormatFields)
        return validateBackup({
          format: 'travel-planner-backup',
          version: geo ? 3 : 2,
          exportedAt: new Date().toISOString(),
          data,
        })
      },
    )
  }

  validateImport(value: unknown): NormalizedTravelBackup {
    return validateBackup(value)
  }

  async replaceAll(value: unknown): Promise<BackupCounts> {
    this.assertStandaloneReplacement()
    const backup = validateBackup(value)
    const database = this.storage
    const { regions, places, labels, trips, itineraryItems, routeMaps, routeMapPlaces } = backup.data
    await database.transaction(
      'rw',
      database.tables,
      async () => {
        await database.routeMapPlaces.clear()
        await database.routeMaps.clear()
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
        await database.routeMaps.bulkAdd(routeMaps)
        await database.routeMapPlaces.bulkAdd(routeMapPlaces)
      },
    )
    return {
      regions: regions.length,
      places: places.length,
      labels: labels.length,
      trips: trips.length,
      itineraryItems: itineraryItems.length,
      routeMaps: routeMaps.length,
      routeMapPlaces: routeMapPlaces.length,
    }
  }

  async clearAllData(): Promise<void> {
    this.assertStandaloneReplacement()
    const database = this.storage
    await database.transaction(
      'rw',
      database.tables,
      async () => {
        await database.publicItineraries.clear()
        await database.routeMapPlaces.clear()
        await database.routeMaps.clear()
        await database.itineraryItems.clear()
        await database.trips.clear()
        await database.places.clear()
        await database.labels.clear()
        await database.regions.clear()
      },
    )
  }

  private assertStandaloneReplacement(): void {
    if (this.storage.tables.some(table => table.name === 'outbox')) {
      throw new ValidationError('帳號同步資料庫不能直接覆蓋或清空；必須保留待同步任務並使用既有同步流程。')
    }
  }
}

export const backupRepository = new BackupRepository()
