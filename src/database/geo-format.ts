import { isOsmDatasetId } from '../geo/osm-datasets'
import { ValidationError } from './errors'
import type { SyncChange, SyncTask } from './sync.types'
import { validateRouteEndpoint } from './route-endpoint'
import { validateLocationMetadata, validateStoredLocation } from './location.validation'

export function hasGeoFormatFields(value: object): boolean {
  return ['location', 'centerMetadata', 'mapProvider', 'osmDataset', 'origin', 'destination'].some(key => Object.hasOwn(value, key))
}

function validateGeoFields(value: object): void {
  if ('location' in value && value.location !== undefined) validateStoredLocation(value.location)
  if ('centerMetadata' in value && value.centerMetadata !== undefined) validateLocationMetadata(value.centerMetadata)
  if ('mapProvider' in value && value.mapProvider !== undefined && value.mapProvider !== 'google' && value.mapProvider !== 'osm') {
    throw new ValidationError('區域的地圖供應商無效。')
  }
  if ('osmDataset' in value && value.osmDataset !== undefined && !isOsmDatasetId(value.osmDataset)) throw new ValidationError('區域的 OSM 圖資設定無效。')
  if ('origin' in value && value.origin !== undefined) validateRouteEndpoint(value.origin)
  if ('destination' in value && value.destination !== undefined) validateRouteEndpoint(value.destination)
}

function validateSyncChanges(changes: readonly SyncChange[]): void {
  for (const change of changes) {
    if (change.after) validateGeoFields(change.after)
  }
}

export function validateSyncTask(task: SyncTask): void {
  if (task.protocolVersion !== 1) throw new ValidationError('尚未支援此同步協定版本；任務仍保留。')
  validateSyncChanges(task.changes)
  if (task.uploadChanges) validateSyncChanges(task.uploadChanges)
  if (task.sharedTrip) {
    validateGeoFields(task.sharedTrip.after.region)
    task.sharedTrip.after.places.forEach(validateGeoFields)
  }
}
