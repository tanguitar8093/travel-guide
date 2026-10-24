import { comparableSyncRecord as comparable, matchingOsmRegionPreparation } from './osm-region-sync'
import { validateSyncData } from './backup.repository'
import { ValidationError } from './errors'
import type { LocalSyncStore } from './local-sync.store'
import { syncCloudAdapter } from './sync-cloud.adapter'
import type { SyncEntityName } from './sync.types'
import { emptySyncData } from './sync.types'

export interface SyncPreviewRow {
  entity: SyncEntityName
  id: string
  name: string
  difference: 'local-only' | 'cloud-only' | 'different' | 'same'
  pending: boolean
  conflict: boolean
}

export interface SyncPreview {
  rows: SyncPreviewRow[]
  pendingOperations: number
  checkedAt: string
}

export async function previewHybridSync(
  store: LocalSyncStore,
  cloud: Pick<typeof syncCloudAdapter, 'snapshot'> = syncCloudAdapter,
): Promise<SyncPreview> {
  const assertCurrent = store.captureAccount()
  const local = await store.inspectSyncState()
  assertCurrent()
  const snapshot = await cloud.snapshot()
  assertCurrent()
  const data = emptySyncData()
  const remote = new Map<string, (typeof snapshot.records)[number]>()
  for (const row of snapshot.records) {
    if (!Object.hasOwn(data, row.entity) || !row.record || row.record.id !== row.id
      || typeof row.version !== 'string' || !row.version) {
      throw new ValidationError('雲端快照資料格式不正確，未變更任何資料。')
    }
    const key = JSON.stringify([row.entity, row.id])
    if (remote.has(key)) throw new ValidationError('雲端快照包含重複資料。')
    remote.set(key, row)
    data[row.entity].push(row.record)
  }
  validateSyncData(data)
  const current = await store.inspectSyncState()
  assertCurrent()
  if (comparable(local) !== comparable(current)) {
    throw new ValidationError('預覽期間本機資料已改變，請重新比對。')
  }
  const localRecords = new Map(local.records.flatMap(({ entity, records }) => records.map((record) => [
    JSON.stringify([entity, record.id]), { entity, record },
  ] as const)))
  const rows: SyncPreviewRow[] = []
  for (const key of new Set([...localRecords.keys(), ...remote.keys()])) {
    const own = localRecords.get(key)
    const other = remote.get(key)
    const entity = own?.entity ?? other!.entity
    const record = own?.record ?? other!.record!
    const task = local.tasks.find(task => task.changes.some(change => change.entity === entity && change.id === record.id))
    const change = task?.changes.find(change => change.entity === entity && change.id === record.id)
    const baseline = local.baselines.find((baseline) => baseline.entity === entity && baseline.id === record.id)
    const version = baseline?.version ?? change?.baseVersion
    rows.push({
      entity, id: record.id, name: 'name' in record && record.name ? record.name : record.id,
      difference: !own ? 'cloud-only' : !other ? 'local-only'
        : comparable(own.record) === comparable(other.record) ? 'same' : 'different',
      pending: Boolean(change),
      conflict: Boolean(change && (version === undefined || version !== (other?.version ?? null)) && !(task && other && matchingOsmRegionPreparation(task, other))),
    })
  }
  for (const task of local.tasks) {
    for (const change of task.changes) {
      const key = JSON.stringify([change.entity, change.id])
      if (localRecords.has(key) || remote.has(key) || rows.some((row) => row.entity === change.entity && row.id === change.id)) continue
      rows.push({ entity: change.entity, id: change.id, name: change.id, difference: 'same', pending: true, conflict: change.baseVersion !== null })
    }
  }
  return { rows, pendingOperations: local.tasks.length, checkedAt: new Date().toISOString() }
}
