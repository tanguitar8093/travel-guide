import { ValidationError } from './errors'
import type { LocalSyncStore } from './local-sync.store'
import { syncCloudAdapter } from './sync-cloud.adapter'
import { previewHybridSync } from './sync-preview'
import { SharedTripLocal } from './shared-trip.local'
import { SharedTripPermissionError } from './shared-trip.cloud'
import type { sharedTripCloud } from './shared-trip.cloud'

export type SyncCloud = Pick<typeof syncCloudAdapter, 'snapshot' | 'pull' | 'push'> & { shared?: typeof sharedTripCloud }
export type SyncLock = (name: string, work: () => Promise<void>) => Promise<void>

export const browserSyncLock: SyncLock = async (name, work) => {
  if (!navigator.locks) throw new ValidationError('此瀏覽器不支援安全的跨分頁同步鎖，請使用新版瀏覽器。')
  await navigator.locks.request(`sync:${name}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new ValidationError('另一個分頁正在同步，請稍後再試。')
    await work()
  })
}

export async function checkHybridOnLogin(
  store: LocalSyncStore,
  cloud: Pick<SyncCloud, 'snapshot'> = syncCloudAdapter,
  lock: SyncLock = browserSyncLock,
): Promise<void> {
  const assertCurrent = store.captureAccount()
  await lock(store.getSyncLockName(), async () => {
    assertCurrent()
    const before = await store.inspectSyncState()
    const snapshot = await cloud.snapshot()
    assertCurrent()
    if (!/^\d+$/.test(snapshot.cursor)) {
      throw new ValidationError('雲端快照游標不正確，未變更任何資料。')
    }
    const preview = await previewHybridSync(store, { snapshot: async () => snapshot })
    const conflicts = preview.rows.filter((row) => row.conflict)
    await store.syncTransaction(async () => {
      const current = await store.inspectSyncState()
      if (JSON.stringify(before) !== JSON.stringify(current)) {
        throw new ValidationError('登入比對期間本機資料已改變，請到資料管理重新比對。')
      }
      if (conflicts.length) {
        // An uncertain upload must keep its frozen retry payload and status.
        if (current.tasks.some((task) => task.uploadChanges && task.status !== 'conflict')) {
          throw new ValidationError('有上傳結果尚未確認的操作，請到資料管理重試同步後再處理衝突。')
        }
        for (const task of current.tasks) {
          if (!conflicts.some((row) => task.changes.some(
            (change) => change.entity === row.entity && change.id === row.id,
          ))) continue
          await store.recordPushConflict(task, snapshot.records)
        }
        return
      }
      const empty = current.records.every(({ records }) => records.length === 0)
      if (empty && current.tasks.length === 0) {
        if (!await store.applyRemote(snapshot.records, { cursor: snapshot.cursor, initialize: true })) {
          throw new ValidationError('登入下載遇到衝突，請到資料管理處理。')
        }
        await store.finishSync()
      }
      assertCurrent()
    })
  })
}

export async function syncHybridManually(
  store: LocalSyncStore,
  cloud: SyncCloud = syncCloudAdapter,
  lock: SyncLock = browserSyncLock,
): Promise<void> {
  const assertCurrent = store.captureAccount()
  await lock(store.getSyncLockName(), async () => {
    assertCurrent()
    let metadata = await store.getSyncMetadata()
    if (!metadata.initialized) {
      const snapshot = await cloud.snapshot()
      assertCurrent()
      if (!await store.applyRemote(snapshot.records, { cursor: snapshot.cursor, initialize: true })) {
        throw new ValidationError('初始化遇到資料衝突，未覆蓋本機資料。請在資料管理檢視並處理衝突。')
      }
      metadata = await store.getSyncMetadata()
    }
    const upload = async () => {
      const task = await store.prepareUpload()
      if (!task) return false
      assertCurrent()
      try {
        if (task.sharedTrip) {
          if (!cloud.shared) throw new ValidationError('此帳號有共同編輯待同步操作，請啟用對應功能後重試；未移除任何操作。')
          const local = new SharedTripLocal(store)
          const response = await cloud.shared.save(task.sharedTrip.tripId, task.operationId, task.sharedTrip.baseVersion, task.sharedTrip.after)
          assertCurrent()
          await local.acknowledge(task, response)
          return true
        }
        const response = await cloud.push(task)
        assertCurrent()
        if (response.status === 'conflict') {
          await store.recordPushConflict(task, response.conflicts)
          throw new ValidationError('同步遇到衝突，已停止；本機資料與待同步操作仍保留。')
        }
        await store.applyRemote(response.changes, { acknowledge: task })
      } catch (error) {
        assertCurrent()
        if (task.sharedTrip && error instanceof SharedTripPermissionError && cloud.shared) {
          await new SharedTripLocal(store).download(await cloud.shared.list())
          assertCurrent()
        }
        if ((await store.listTasks()).find((current) => current.operationId === task.operationId)?.status !== 'conflict') {
          await store.markUpload(task, 'failed', error instanceof Error ? error.message : String(error))
        }
        throw error
      }
      return true
    }
    const first = (await store.listTasks())[0]
    if (first?.uploadChanges && first.status !== 'conflict') await upload()
    const download = async () => {
      let cursor = (await store.getSyncMetadata()).cursor ?? metadata.cursor ?? '0'
      for (let page = 0; page < 1000; page += 1) {
        assertCurrent()
        const response = await cloud.pull(cursor)
        assertCurrent()
        if (!/^\d+$/.test(response.cursor) || BigInt(response.cursor) < BigInt(cursor)
          || (response.hasMore && response.cursor === cursor)) throw new ValidationError('同步游標未前進，已停止。')
        if (!await store.applyRemote(response.changes, { cursor: response.cursor })) {
          throw new ValidationError('下載遇到衝突，未覆蓋本機資料。')
        }
        cursor = response.cursor
        if (!response.hasMore) {
          if (cloud.shared) {
            const snapshots = await cloud.shared.list()
            assertCurrent()
            await new SharedTripLocal(store).download(snapshots)
          }
          return
        }
      }
      throw new ValidationError('資料較多，請再按一次同步以繼續下載。')
    }
    await download()
    const budget = (await store.listTasks()).length
    for (let operation = 0; operation < budget; operation += 1) {
      if (!await upload()) break
    }
    await download()
    await store.finishSync()
    assertCurrent()
  })
}
