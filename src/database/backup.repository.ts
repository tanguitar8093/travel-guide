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
    throw new ValidationError(`${name}必須是物件。`)
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
      `備份物件缺少必要欄位，或包含不支援的欄位${missing.length ? `；缺少：${missing.join(', ')}` : ''}${unexpected.length ? `；不支援：${unexpected.join(', ')}` : ''}。`,
    )
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field}必須是文字。`)
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
  requireString(record.id, `${entity}識別碼`)
  if (!record.id.trim()) {
    throw new ValidationError(`${entity}識別碼不可空白。`)
  }
  validate(record as Omit<T, 'id'>)
  return record as T
}

function validateUniqueIds<T extends { id: string }>(records: T[], entity: string): void {
  const ids = new Set<string>()
  for (const record of records) {
    if (ids.has(record.id)) throw new ValidationError(`備份中的${entity}識別碼「${record.id}」重複。`)
    ids.add(record.id)
  }
}

function validateReferences(backup: NormalizedTravelBackup, allowSharedEndpoints = false): void {
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
      if (endpoint?.kind === 'shared-place' && !allowSharedEndpoints) {
        throw new ValidationError('私人備份不包含共享文件；請先移除共享地點端點或改選私人位置。')
      }
      if (endpoint?.kind === 'place' && !placeIds.has(endpoint.placeId)) {
        throw new ValidationError('路線端點使用的地點不存在。')
      }
      if (endpoint?.kind === 'route-map-place' && markersById.get(endpoint.routeMapPlaceId)?.routeMapId !== map.id) {
        throw new ValidationError('路線端點的標記不存在，或屬於另一張地圖。')
      }
    }
    if (!map.tripId) continue
    if (!tripById.has(map.tripId)) throw new ValidationError(`試算地圖「${map.id}」所屬的行程不存在。`)
    if (mapTrips.has(map.tripId)) throw new ValidationError('同一行程不可有多張試算地圖。')
    mapTrips.add(map.tripId)
  }
  const mapPlaces = new Set<string>()
  for (const place of backup.data.routeMapPlaces) {
    if (!mapIds.has(place.routeMapId)) throw new ValidationError(`試算地圖地點「${place.id}」所屬的地圖不存在。`)
    const references: [string, string][] = []
    if (place.googlePlaceId !== undefined) references.push(['google', place.googlePlaceId])
    if (place.location?.source === 'osm') references.push(['osm', place.location.reference.id])
    for (const [provider, reference] of references) {
      const key = JSON.stringify([place.routeMapId, provider, reference])
      if (mapPlaces.has(key)) throw new ValidationError('試算地圖包含重複的地圖供應商地點參照。')
      mapPlaces.add(key)
    }
  }

  for (const place of backup.data.places) {
    for (const regionId of place.regionIds) {
      if (!regionIds.has(regionId)) {
        throw new ValidationError(`地點「${place.id}」使用的地圖「${regionId}」不存在。`)
      }
    }
    for (const labelId of place.labelIds) {
      if (!labelById.has(labelId)) {
        throw new ValidationError(`地點「${place.id}」使用的標籤「${labelId}」不存在。`)
      }
    }
  }

  for (const label of backup.data.labels) {
    if (label.parentId !== undefined && !labelById.has(label.parentId)) {
      throw new ValidationError(`標籤「${label.id}」的上層標籤「${label.parentId}」不存在。`)
    }
    const visited = new Set<string>([label.id])
    let parentId = label.parentId
    while (parentId !== undefined) {
      if (visited.has(parentId)) {
        throw new ValidationError(`備份中的標籤「${label.id}」階層形成循環。`)
      }
      visited.add(parentId)
      parentId = labelById.get(parentId)?.parentId
    }
  }

  for (const trip of backup.data.trips) {
    if (!regionIds.has(trip.regionId)) {
      throw new ValidationError(`行程「${trip.id}」使用的地圖「${trip.regionId}」不存在。`)
    }
  }

  const ordersByTripDate = new Set<string>()
  for (const item of backup.data.itineraryItems) {
    const trip = tripById.get(item.tripId)
    if (!trip) {
      throw new ValidationError(`行程項目「${item.id}」所屬的行程「${item.tripId}」不存在。`)
    }
    if (!placeIds.has(item.placeId)) {
      throw new ValidationError(`行程項目「${item.id}」使用的地點「${item.placeId}」不存在。`)
    }
    const linkedPlace = backup.data.places.find(place => place.id === item.placeId)
    if (linkedPlace?.location && !linkedPlace.regionIds.includes(trip.regionId)) throw new ValidationError('行程地點不屬於行程地圖。')
    if (item.date < trip.startDate || item.date > trip.endDate) {
      throw new ValidationError(`行程項目「${item.id}」的日期超出行程起訖日期。`)
    }
    const orderKey = `${item.tripId}\u0000${item.date}\u0000${item.order}`
    if (ordersByTripDate.has(orderKey)) {
      throw new ValidationError(`備份中行程「${item.tripId}」在 ${item.date} 的排序 ${item.order} 重複。`)
    }
    ordersByTripDate.add(orderKey)
  }
}

function validateBackup(value: unknown, allowSharedEndpoints = false): NormalizedTravelBackup {
  const root = requireRecord(value, '備份')
  requireExactKeys(root, backupKeys)
  if (root.format !== 'travel-planner-backup' || (root.version !== 1 && root.version !== 2 && root.version !== 3)) {
    throw new ValidationError('不支援此備份格式或版本。')
  }
  requireString(root.exportedAt, '備份匯出時間')
  if (!Number.isFinite(Date.parse(root.exportedAt))) {
    throw new ValidationError('備份匯出時間必須是有效日期。')
  }

  const data = requireRecord(root.data, '備份資料')
  const geo = root.version === 3
  const keys = root.version !== 1 ? [...dataKeys, 'routeMaps', 'routeMapPlaces'] : dataKeys
  requireExactKeys(data, keys)
  for (const key of keys) {
    if (!Array.isArray(data[key])) {
      throw new ValidationError(`備份資料欄位「${key}」必須是陣列。`)
    }
  }

  const regions = (data.regions as unknown[]).map((record) => {
    const regionRecord = requireRecord(record, '地圖')
    if (Object.hasOwn(regionRecord, 'center')) {
      const center = requireRecord(regionRecord.center, '地圖中心')
      requireExactKeys(center, ['latitude', 'longitude'])
    }
    return validateRecord<Region>(
      regionRecord,
      '地圖',
      ['name', 'zoom'],
      ['center', 'googlePlaceId', ...(geo ? ['centerMetadata', 'mapProvider', 'osmDataset'] : [])],
      validateRegion,
    )
  })
  const places = (data.places as unknown[]).map((record) =>
    validateRecord<Place>(
      record,
      '地點',
      ['name', 'regionIds', 'labelIds'],
      ['icon', 'mapsUrl', 'googlePlaceId', 'notes', ...(geo ? ['location'] : [])],
      validatePlace,
    ),
  )
  const labels = (data.labels as unknown[]).map((record) =>
    validateRecord<Label>(record, '標籤', ['name', 'color'], ['parentId'], validateLabel),
  )
  const trips = (data.trips as unknown[]).map((record) =>
    validateRecord<Trip>(record, '行程', ['regionId', 'name', 'startDate', 'endDate'], [], validateTrip),
  )
  const itineraryItems = (data.itineraryItems as unknown[]).map((record) =>
    validateRecord<ItineraryItem>(
      record,
      '行程項目',
      ['tripId', 'placeId', 'date', 'order'],
      ['arrivalTime', 'durationMinutes', 'transport', 'travelDurationMinutes', 'travelDistanceMeters', 'note'],
      validateItineraryItem,
    ),
  )
  const routeMaps = ((data.routeMaps ?? []) as unknown[]).map((record) =>
    validateRecord<RouteMap>(record, '試算地圖', ['name', 'transport'],
      ['tripId', 'selectedDate', 'originGooglePlaceId', 'destinationGooglePlaceId', ...(geo ? ['origin', 'destination'] : [])], validateRouteMap))
  const routeMapPlaces = ((data.routeMapPlaces ?? []) as unknown[]).map((record) =>
    validateRecord<RouteMapPlace>(record, '試算地圖地點',
      geo ? ['routeMapId'] : ['routeMapId', 'googlePlaceId'],
      geo ? ['name', 'googlePlaceId', 'location'] : ['name'], validateRouteMapPlace))
  validateUniqueIds(regions, '地圖')
  validateUniqueIds(places, '地點')
  validateUniqueIds(labels, '標籤')
  validateUniqueIds(trips, '行程')
  validateUniqueIds(itineraryItems, '行程項目')
  validateUniqueIds(routeMaps, '試算地圖')
  validateUniqueIds(routeMapPlaces, '試算地圖地點')

  const backup: NormalizedTravelBackup = {
    format: 'travel-planner-backup',
    version: geo ? 3 : 2,
    exportedAt: root.exportedAt,
    data: { regions, places, labels, trips, itineraryItems, routeMaps, routeMapPlaces },
  }
  validateReferences(backup, allowSharedEndpoints)
  return backup
}

export function validateSyncData(data: Record<string, readonly object[]>): NormalizedTravelBackup {
  return validateBackup({
    format: 'travel-planner-backup',
    version: Object.values(data).flat().some(hasGeoFormatFields) ? 3 : 2,
    exportedAt: new Date().toISOString(),
    data,
  }, true)
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
