import { ValidationError } from './errors'
import type { SyncChange, SyncTask } from './sync.types'

export function hasGeoFormatFields(value: object): boolean {
  return ['location', 'centerMetadata', 'origin', 'destination'].some(key => Object.hasOwn(value, key))
}

export function assertLegacyGeoWrite(value: object): void {
  if (hasGeoFormatFields(value)) {
    throw new ValidationError('雲端尚未支援新位置／端點格式；未送出寫入，也未捨棄新欄位。')
  }
}

export function assertLegacySyncChanges(changes: readonly SyncChange[]): void {
  if (changes.some(change =>
    (change.before && hasGeoFormatFields(change.before)) || (change.after && hasGeoFormatFields(change.after)))) {
    throw new ValidationError('新位置／端點格式尚未支援雲端同步；本機資料與待同步清單仍保留，未送出或改寫任務。')
  }
}

export function assertLegacySyncTask(task: SyncTask): void {
  if (task.protocolVersion !== 1) throw new ValidationError('尚未支援此同步協定版本；任務仍保留。')
  assertLegacySyncChanges(task.changes)
  if (task.uploadChanges) assertLegacySyncChanges(task.uploadChanges)
  if (task.sharedTrip) {
    for (const document of [task.sharedTrip.before, task.sharedTrip.after]) {
      if (hasGeoFormatFields(document.region) || document.places.some(hasGeoFormatFields)) {
        throw new ValidationError('共享行程尚未支援新位置格式；未送出任務。')
      }
    }
  }
}
