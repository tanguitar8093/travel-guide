import { isOsmDatasetId, osmRegion } from '../geo/osm-datasets'
import type { SyncTask } from './sync.types'
import type { CloudSyncRecord } from './sync-cloud.adapter'

export function comparableSyncRecord(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparableSyncRecord).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => {
      const field = record[key]
      const normalized = (key === 'regionIds' || key === 'labelIds') && Array.isArray(field) ? [...field].sort() : field
      return `${JSON.stringify(key)}:${comparableSyncRecord(normalized)}`
    }).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

// Only system-created fixed regions may converge without a user conflict decision.
// Ordinary same-ID creations and edited regions still use the normal conflict flow.
export function matchingOsmRegionPreparation(task: SyncTask, row: Pick<CloudSyncRecord, 'entity' | 'id' | 'record'>): boolean {
  if (task.operation !== 'regions.prepareOsm' || task.changes.length !== 1 || row.entity !== 'regions' || !row.record) return false
  const change = task.changes[0]
  if (change.entity !== 'regions' || change.id !== row.id || change.baseVersion !== null || !change.after) return false
  if (!('mapProvider' in change.after) || change.after.mapProvider !== 'osm') return false
  const dataset = ('osmDataset' in change.after ? change.after.osmDataset : undefined) ?? 'okinawa'
  if (!isOsmDatasetId(dataset)) return false
  const expected = { ...osmRegion(dataset), id: row.id }
  return comparableSyncRecord(change.after) === comparableSyncRecord(expected) &&
    comparableSyncRecord(row.record) === comparableSyncRecord(expected)
}
