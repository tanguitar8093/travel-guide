import { ValidationError } from './errors'
import type { LocalSyncStore } from './local-sync.store'
import { syncCloudAdapter } from './sync-cloud.adapter'

type SyncCloud = typeof syncCloudAdapter
export type SyncLock = (name: string, work: () => Promise<void>) => Promise<void>

export const browserSyncLock: SyncLock = async (name, work) => {
  if (!navigator.locks) throw new ValidationError('此瀏覽器不支援安全的跨分頁同步鎖，請使用新版瀏覽器。')
  await navigator.locks.request(`sync:${name}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new ValidationError('另一個分頁正在同步，請稍後再試。')
    await work()
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
        const response = await cloud.push(task)
        assertCurrent()
        if (response.status === 'conflict') {
          await store.recordPushConflict(task, response.conflicts)
          throw new ValidationError('同步遇到衝突，已停止；本機資料與待同步操作仍保留。')
        }
        await store.applyRemote(response.changes, { acknowledge: task })
      } catch (error) {
        assertCurrent()
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
        if (!response.hasMore) return
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
