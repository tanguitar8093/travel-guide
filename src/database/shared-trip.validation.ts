import { BackupRepository } from './backup.repository'
import { ValidationError } from './errors'
import { hasGeoFormatFields } from './geo-format'
import type { SharedTripDocument, SharedTripSnapshot } from './shared-trip.types'
import type { SharedTripItem, SharedTripPlace } from './trip-collaboration.types'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('共享行程資料格式不正確。')
  return value as Record<string, unknown>
}

function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError('共享行程 ID 格式不正確。')
  }
}

export function parseSharedTripDocument(value: unknown): SharedTripDocument {
  const row = object(value)
  const trip = object(row.trip)
  if (trip.access !== 'owner' && trip.access !== 'editor' && trip.access !== 'viewer') throw new ValidationError('共享權限格式不正確。')
  uuid(trip.id)
  uuid(trip.ownerUid)
  if (typeof trip.aclVersion !== 'string' || !/^\d+$/.test(trip.aclVersion)) throw new ValidationError('共享權限版本不正確。')
  if (!Array.isArray(row.places) || !Array.isArray(row.items)) throw new ValidationError('共享行程缺少地點或每日安排。')
  if (row.places.length > 1000 || row.items.length > 1000 ||
    new TextEncoder().encode(JSON.stringify(value)).length > 850000) {
    throw new ValidationError('共享行程超過安全同步大小，未寫入本機或雲端。')
  }
  for (const place of row.places) uuid(object(place).id)
  for (const item of row.items) {
    const fields = object(item)
    uuid(fields.id)
    for (const name of ['order', 'durationMinutes', 'travelDurationMinutes']) {
      if (typeof fields[name] === 'number' && fields[name] > 2147483647) throw new ValidationError('共享行程的順序或分鐘數超過資料庫範圍。')
    }
  }
  const backup = new BackupRepository().validateImport({
    format: 'travel-planner-backup',
    version: [object(row.region), ...row.places.map(object)].some(hasGeoFormatFields) ? 3 : 2,
    exportedAt: new Date().toISOString(),
    data: {
      regions: [row.region], labels: [], routeMaps: [], routeMapPlaces: [],
      trips: [{ id: trip.id, name: trip.name, regionId: trip.regionId, startDate: trip.startDate, endDate: trip.endDate }],
      places: row.places.map((place: unknown) => ({ ...object(place), regionIds: [trip.regionId], labelIds: [] })),
      itineraryItems: row.items.map((item: unknown) => ({ ...object(item), tripId: trip.id })),
    },
  })
  const normalized = backup.data.trips[0]
  return {
    trip: { ...normalized, ownerUid: trip.ownerUid, access: trip.access, aclVersion: trip.aclVersion },
    region: backup.data.regions[0],
    places: backup.data.places.map(({ regionIds: _regions, labelIds: _labels, ...place }): SharedTripPlace => place),
    items: backup.data.itineraryItems.map(({ tripId: _tripId, ...item }): SharedTripItem => item),
  }
}

export function parseSharedTripSnapshot(value: unknown): SharedTripSnapshot {
  const row = object(value)
  uuid(row.id)
  if (typeof row.version !== 'string' || !/^\d+$/.test(row.version)) throw new ValidationError('共享內容版本不正確。')
  const document = row.document === null ? null : parseSharedTripDocument(row.document)
  if (document && document.trip.id !== row.id) throw new ValidationError('共享行程識別資料不一致。')
  return { id: row.id, version: row.version, document }
}

export function clearSharedEstimates(document: SharedTripDocument): SharedTripDocument {
  return {
    ...document,
    items: document.items.map(({ travelDurationMinutes: _time, travelDistanceMeters: _distance, ...item }) => item),
  }
}
