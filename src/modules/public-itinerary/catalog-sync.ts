import type { PublicSnapshot } from './models'
import type { PublicItineraryCatalog, SharedPublicItinerary } from './shared-catalog'

export interface CatalogRecord extends SharedPublicItinerary {
  version: string
  sequence: string
  withdrawn: boolean
}
export interface CatalogTask {
  operationId: string
  ownerId: string
  id: string
  sourceTripId: string
  action: 'publish' | 'update' | 'withdraw'
  snapshot?: PublicSnapshot
  baseVersion?: string | null
  createdAt: number
  conflict?: boolean
}
export interface CatalogCloud {
  pull(cursor: string): Promise<{ records: CatalogRecord[]; cursor: string; hasMore: boolean }>
  push(task: CatalogTask): Promise<{ status: 'applied'; operationId: string; record: CatalogRecord } | { status: 'conflict'; record: CatalogRecord | null }>
}

export async function queueCatalogTask(catalog: PublicItineraryCatalog, row: SharedPublicItinerary, action: CatalogTask['action']) {
  const prior = await catalog.syncTasks.where('id').equals(row.id).count()
  const baseline = await catalog.baselines.get(row.id)
  const last = await catalog.syncTasks.orderBy('createdAt').last()
  await catalog.syncTasks.add({ operationId: crypto.randomUUID(), id: row.id, sourceTripId: row.sourceTripId,
    ownerId: row.ownerId, action, ...(action !== 'withdraw' && { snapshot: row.snapshot }),
    ...(prior === 0 && { baseVersion: baseline?.version ?? null }), createdAt: Math.max(Date.now(), (last?.createdAt ?? 0) + 1) })
}

export async function syncPublicCatalog(catalog: PublicItineraryCatalog, cloud: CatalogCloud, ownerId: string, assertCurrent: () => void = () => {}) {
  async function pull() {
    let cursor = (await catalog.syncMetadata.get('cursor'))?.value ?? '0'
    for (;;) {
      assertCurrent()
      const result = await cloud.pull(cursor)
      assertCurrent()
      await catalog.transaction('rw', catalog.publicItineraries, catalog.baselines, catalog.syncTasks, catalog.syncMetadata, async () => {
        for (const row of result.records) {
          await catalog.baselines.put(row)
          if (await catalog.syncTasks.where('id').equals(row.id).count()) continue
          if (row.withdrawn) await catalog.publicItineraries.delete(row.id)
          else await catalog.publicItineraries.put(row)
        }
        await catalog.syncMetadata.put({ key: 'cursor', value: result.cursor })
      })
      if (!result.hasMore) break
      if (result.cursor === cursor) throw new Error('公開行程同步游標未前進。')
      cursor = result.cursor
    }
  }
  await pull()
  // Upload the existing browser catalog once; cloud tombstones were applied before this import.
  if (ownerId) await catalog.transaction('rw', catalog.publicItineraries, catalog.syncTasks, catalog.baselines, catalog.syncMetadata, async () => {
    for (const row of await catalog.publicItineraries.where('ownerId').equals(ownerId).toArray()) {
      if (!await catalog.baselines.get(row.id) && !await catalog.syncTasks.where('id').equals(row.id).count()) await queueCatalogTask(catalog, row, 'publish')
    }
  })
  const tasks = (await catalog.syncTasks.where('ownerId').equals(ownerId).sortBy('createdAt'))
  const blocked = new Set<string>()
  for (const queued of tasks) {
    assertCurrent()
    const task = await catalog.syncTasks.get(queued.operationId)
    if (!task) continue
    if (task.conflict || blocked.has(task.id)) { blocked.add(task.id); continue }
    if (task.baseVersion === undefined) {
      // Freeze the payload before the request; lost responses retry exactly this operation.
      task.baseVersion = (await catalog.baselines.get(task.id))?.version ?? null
      await catalog.syncTasks.put(task)
    }
    assertCurrent()
    const result = await cloud.push(task)
    assertCurrent()
    await catalog.transaction('rw', catalog.publicItineraries, catalog.baselines, catalog.syncTasks, async () => {
      if (result.status === 'conflict') {
        if (result.record) await catalog.baselines.put(result.record)
        await catalog.syncTasks.put({ ...task, conflict: true })
        blocked.add(task.id)
        return
      }
      if (result.operationId !== task.operationId || result.record.id !== task.id || result.record.ownerId !== ownerId) throw new Error('公開行程同步回應不符。')
      const baseline = await catalog.baselines.get(task.id)
      const latest = baseline && BigInt(baseline.sequence) > BigInt(result.record.sequence) ? baseline : result.record
      await catalog.baselines.put(latest)
      await catalog.syncTasks.delete(task.operationId)
      const remaining = await catalog.syncTasks.where('id').equals(task.id).sortBy('createdAt')
      if (remaining[0] && remaining[0].baseVersion === undefined) await catalog.syncTasks.put({ ...remaining[0], baseVersion: result.record.version })
      if (remaining.length === 0) {
        if (latest.withdrawn) await catalog.publicItineraries.delete(task.id)
        else await catalog.publicItineraries.put(latest)
      }
    })
  }
  await pull()
}

// Explicit choice: discard this account's pending publication edits and adopt the cloud baseline.
export async function discardCatalogConflict(catalog: PublicItineraryCatalog, ownerId: string, id: string) {
  await catalog.transaction('rw', catalog.publicItineraries, catalog.baselines, catalog.syncTasks, async () => {
    const tasks = await catalog.syncTasks.where('id').equals(id).toArray()
    if (!tasks.some(task => task.conflict) || tasks.some(task => task.ownerId !== ownerId)) throw new Error('沒有可處理的公開行程衝突。')
    await catalog.syncTasks.bulkDelete(tasks.map(task => task.operationId))
    const row = await catalog.baselines.get(id)
    if (!row || row.withdrawn) await catalog.publicItineraries.delete(id)
    else await catalog.publicItineraries.put(row)
  })
}
