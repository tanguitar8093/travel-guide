import { BackupRepository, type TravelBackup } from './backup.repository'
import { ValidationError } from './errors'
import type { LocalSyncStore } from './local-sync.store'
import { syncCloudAdapter, type CloudSyncSnapshot } from './sync-cloud.adapter'
import { browserSyncLock, type SyncLock } from './sync-engine'
import type { SyncChange, SyncConflictReview, SyncEntityName, SyncRecord } from './sync.types'

const entities: SyncEntityName[] = ['regions', 'labels', 'places', 'trips', 'itineraryItems']
const keyFor = (entity: SyncEntityName, id: string) => JSON.stringify([entity, id])

function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function validateRecords(records: Array<{ entity: SyncEntityName; record: SyncRecord | null }>): TravelBackup {
  const data = { regions: [], labels: [], places: [], trips: [], itineraryItems: [] } as Record<SyncEntityName, SyncRecord[]>
  for (const row of records) {
    if (!entities.includes(row.entity)) throw new ValidationError('雲端資料種類不正確。')
    if (row.record) data[row.entity].push(row.record)
  }
  return new BackupRepository().validateImport({ format: 'travel-planner-backup', version: 1, exportedAt: new Date().toISOString(), data })
}

function cloudFingerprint(snapshot: CloudSyncSnapshot): string {
  return fingerprint({ ...snapshot, records: [...snapshot.records].sort((first, second) => keyFor(first.entity, first.id).localeCompare(keyFor(second.entity, second.id))) })
}

function orderChanges(changes: SyncChange[]): SyncChange[] {
  const puts = changes.filter((change) => change.kind === 'put')
  const result: SyncChange[] = []
  for (const entity of entities) {
    const waiting = puts.filter((change) => change.entity === entity)
    while (waiting.length) {
      const index = waiting.findIndex((change) => entity !== 'labels' || !change.after
        || !('parentId' in change.after) || !waiting.some((parent) => parent.id === (change.after as { parentId?: string }).parentId))
      if (index < 0) throw new ValidationError('標籤階層無法安全排序。')
      result.push(...waiting.splice(index, 1))
    }
  }
  const deletes = changes.filter((change) => change.kind === 'delete')
  for (const entity of [...entities].reverse()) {
    const waiting = deletes.filter((change) => change.entity === entity)
    while (waiting.length) {
      const index = waiting.findIndex((change) => entity !== 'labels' || !waiting.some((child) => child.before && 'parentId' in child.before && child.before.parentId === change.id))
      if (index < 0) throw new ValidationError('標籤刪除順序無法安全排序。')
      result.push(...waiting.splice(index, 1))
    }
  }
  return result
}

export async function getSavedConflictReview(store: LocalSyncStore): Promise<SyncConflictReview | undefined> {
  return store.syncTransaction((database) => database.syncConflicts.get('workspace'))
}

export async function prepareConflictReview(
  store: LocalSyncStore,
  cloud: typeof syncCloudAdapter = syncCloudAdapter,
  lock: SyncLock = browserSyncLock,
): Promise<SyncConflictReview> {
  const assertCurrent = store.captureAccount()
  let review: SyncConflictReview | undefined
  await lock(store.getSyncLockName(), async () => {
    const state = await store.inspectSyncState()
    if (!state.tasks.some((task) => task.status === 'conflict')) throw new ValidationError('目前沒有需要處理的衝突。')
    if (state.tasks.some((task) => task.uploadChanges && task.status !== 'conflict')) {
      throw new ValidationError('有上傳結果未確認的操作，請先重試同步，不可放棄或改寫該操作。')
    }
    assertCurrent()
    const snapshot = await cloud.snapshot()
    assertCurrent()
    if (!/^\d+$/.test(snapshot.cursor)) throw new ValidationError('雲端快照游標不正確。')
    for (const row of snapshot.records) {
      if (!row.record || row.record.id !== row.id || typeof row.version !== 'string' || !row.version) throw new ValidationError('雲端快照資料不正確。')
    }
    validateRecords(snapshot.records)
    const remote = new Map(snapshot.records.map((row) => [keyFor(row.entity, row.id), row]))
    const touched = new Map(state.tasks.flatMap((task) => task.changes.map((change) => [keyFor(change.entity, change.id), change] as const)))
    const missing = new Set([...touched.keys()].filter((key) => !remote.has(key)))
    if (missing.size) {
      let cursor = '0'
      for (let page = 0; page < 1000 && BigInt(cursor) < BigInt(snapshot.cursor); page += 1) {
        assertCurrent()
        const pulled = await cloud.pull(cursor, 500)
        assertCurrent()
        if (!/^\d+$/.test(pulled.cursor) || BigInt(pulled.cursor) <= BigInt(cursor)) throw new ValidationError('無法取得刪除資料的安全版本，請重新整理衝突。')
        for (const row of pulled.changes) {
          if (!row.sequence || !/^\d+$/.test(row.sequence) || !row.version) throw new ValidationError('雲端歷史變更格式不正確。')
          if (BigInt(row.sequence) <= BigInt(snapshot.cursor) && missing.has(keyFor(row.entity, row.id))) remote.set(keyFor(row.entity, row.id), row)
        }
        cursor = pulled.cursor
      }
      if (BigInt(cursor) < BigInt(snapshot.cursor)) throw new ValidationError('雲端歷史資料較多，尚不能安全解決衝突。')
    }
    const local = new Map(state.records.flatMap(({ entity, records }) => records.map((record) => [keyFor(entity, record.id), record] as const)))
    const rows: SyncConflictReview['rows'] = []
    const changes: SyncChange[] = []
    for (const [key, change] of touched) {
      const own = local.get(key) ?? null
      const other = remote.get(key)
      rows.push({ entity: change.entity, id: change.id, local: own, cloud: other?.record ?? null })
      if (fingerprint(own) !== fingerprint(other?.record ?? null)) {
        changes.push({ entity: change.entity, id: change.id, kind: own ? 'put' : 'delete', before: other?.record ?? undefined, after: own ?? undefined, baseVersion: other?.version ?? null })
      }
    }
    const ordered = orderChanges(changes)
    review = {
      id: 'workspace', token: crypto.randomUUID(), createdAt: new Date().toISOString(),
      localFingerprint: fingerprint(state), cloudFingerprint: cloudFingerprint(snapshot), cursor: snapshot.cursor,
      pendingOperations: state.tasks.length, rows, cloudRecords: [...remote.values()], localChoiceChanges: ordered,
      localNames: state.records.flatMap(({ entity, records }) => records.flatMap((record) =>
        'name' in record ? [{ entity, id: record.id, name: record.name }] : [])),
    }
    await store.syncTransaction(async (database) => {
      if (fingerprint(await store.inspectSyncState()) !== review!.localFingerprint) throw new ValidationError('本機資料已改變，請重新檢視衝突。')
      await database.syncConflicts.put(review!)
    })
  })
  return review!
}

export async function resolveConflictReview(
  store: LocalSyncStore,
  token: string,
  choice: 'local' | 'cloud',
  cloud: typeof syncCloudAdapter = syncCloudAdapter,
  lock: SyncLock = browserSyncLock,
): Promise<void> {
  if (choice !== 'local' && choice !== 'cloud') throw new ValidationError('衝突選擇不正確。')
  const assertCurrent = store.captureAccount()
  await lock(store.getSyncLockName(), async () => {
    const review = await getSavedConflictReview(store)
    if (!review || review.token !== token) throw new ValidationError('衝突預覽已失效，請重新檢視。')
    const snapshot = await cloud.snapshot()
    assertCurrent()
    if (cloudFingerprint(snapshot) !== review.cloudFingerprint) throw new ValidationError('雲端資料已改變，請重新檢視衝突後再選擇。')
    await store.syncTransaction(async (database) => {
      const saved = await database.syncConflicts.get('workspace')
      if (saved?.token !== token || fingerprint(await store.inspectSyncState()) !== review.localFingerprint) {
        throw new ValidationError('本機操作或衝突預覽已改變，請重新檢視。')
      }
      const metadata = await database.syncMetadata.get('workspace')
      if (!metadata) throw new ValidationError('帳號本機資料未準備好。')
      const records = new Map(snapshot.records.map((row) => [keyFor(row.entity, row.id), { entity: row.entity, record: row.record }]))
      if (choice === 'local') {
        for (const row of review.rows) {
          const key = keyFor(row.entity, row.id)
          if (row.local) records.set(key, { entity: row.entity, record: row.local })
          else records.delete(key)
        }
      }
      const backup = validateRecords([...records.values()])
      if (choice === 'local' && (review.localChoiceChanges.length > 500 || new TextEncoder().encode(JSON.stringify(review.localChoiceChanges)).length > 900000)) {
        throw new ValidationError('這批本機變更超過安全上傳上限，未變更資料；請先匯出備份。')
      }
      for (const entity of entities) {
        await database.table(entity).clear()
        await database.table(entity).bulkPut(backup.data[entity])
      }
      await database.syncBaselines.clear()
      for (const row of review.cloudRecords) {
        await database.syncBaselines.put({ entity: row.entity, id: row.id, version: row.version, record: row.record ?? undefined, sequence: review.cursor })
      }
      await database.outbox.clear()
      if (choice === 'local' && review.localChoiceChanges.length) {
        await database.outbox.add({ operationId: crypto.randomUUID(), account: database.account, deviceId: metadata.deviceId,
          protocolVersion: 1, operation: 'conflict.keep-local', createdAt: new Date().toISOString(), changes: review.localChoiceChanges, status: 'pending', attempts: 0 })
      }
      await database.syncMetadata.put({ ...metadata, initialized: true, cursor: review.cursor })
      await database.syncConflicts.clear()
    })
  })
}
