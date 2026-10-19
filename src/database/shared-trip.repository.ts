import { liveQuery } from 'dexie'
import { EntityNotFoundError, ValidationError } from './errors'
import { getDatabaseMode } from './runtime'
import { requireHybridStore, runHybridTask } from './hybrid.runtime'
import { syncHybridManually } from './sync-engine'
import { cancelSharedTripCloud, sharedTripCloud } from './shared-trip.cloud'
import { SharedTripLocal } from './shared-trip.local'
import { sharedTripEditingEnabled } from './shared-trip.types'
import type { SharedTripDocument, SharedTripSnapshot } from './shared-trip.types'

export class SharedTripRepository {
  async list(): Promise<SharedTripSnapshot[]> {
    if (!sharedTripEditingEnabled || getDatabaseMode() === 'indexeddb') return []
    return getDatabaseMode() === 'hybrid'
      ? new SharedTripLocal(requireHybridStore()).list()
      : sharedTripCloud.list()
  }

  async refresh(): Promise<SharedTripSnapshot[]> {
    if (getDatabaseMode() === 'hybrid') await syncHybridManually(requireHybridStore())
    return this.list()
  }

  async enable(tripId: string): Promise<void> {
    if (getDatabaseMode() === 'indexeddb') throw new ValidationError('單機模式不能啟用共同編輯，請先明確同步行程到雲端。')
    if (getDatabaseMode() === 'hybrid' && (await requireHybridStore().listTasks()).length) {
      throw new ValidationError('請先完成所有待同步操作，再啟用共同編輯，避免採用過期的雲端行程。')
    }
    await sharedTripCloud.enable(tripId)
  }

  async cancel(tripId: string): Promise<void> {
    if (getDatabaseMode() === 'indexeddb') throw new ValidationError('單機模式沒有雲端共享可取消。')
    const store = getDatabaseMode() === 'hybrid' ? requireHybridStore() : undefined
    const assertCurrent = store?.captureAccount()
    if (store && (await store.listTasks()).length) {
      throw new ValidationError('請先完成所有待同步操作，再取消共享；尚未變更共享權限或內容。')
    }
    const snapshot = (await sharedTripCloud.list()).find((row) => row.id === tripId)
    assertCurrent?.()
    if (!snapshot?.document || snapshot.document.trip.access !== 'owner') {
      throw new ValidationError('只有擁有者可以取消已啟用的共享行程，請重新載入。')
    }
    await cancelSharedTripCloud(tripId, crypto.randomUUID(), snapshot.version)
    assertCurrent?.()
    if (store) {
      try {
        await syncHybridManually(store)
      } catch (cause) {
        throw new ValidationError(`雲端已取消共享並保留最新行程，但本機尚未完成同步：${cause instanceof Error ? cause.message : '請重新連線並同步。'}`)
      }
    }
  }

  async save(before: SharedTripSnapshot, document: SharedTripDocument): Promise<SharedTripSnapshot> {
    if (getDatabaseMode() === 'indexeddb') throw new ValidationError('單機模式不支援共同編輯。')
    if (getDatabaseMode() === 'hybrid') {
      return runHybridTask(async (store) => {
        const local = new SharedTripLocal(store)
        await local.queue(before, document)
        const after = (await local.list()).find((row) => row.id === before.id)
        if (!after) throw new EntityNotFoundError('Shared trip', before.id)
        return after
      })
    }
    const result = await sharedTripCloud.save(before.id, crypto.randomUUID(), before.version, document)
    if (result.status === 'conflict') throw new ValidationError('其他人已修改行程，未覆蓋雲端內容。請先匯出草稿，再重新載入。')
    return result.snapshot
  }

  async tasks() {
    if (getDatabaseMode() !== 'hybrid') return []
    return new SharedTripLocal(requireHybridStore()).tasks()
  }

  async resolve(tripId: string, expected: SharedTripSnapshot, choice: 'local' | 'cloud'): Promise<void> {
    const latest = (await sharedTripCloud.list()).find((row) => row.id === tripId)
    if (!latest) throw new ValidationError('雲端沒有此行程的授權紀錄，不能安全解決衝突。')
    await runHybridTask((store) => new SharedTripLocal(store).resolve(tripId, expected, latest, choice))
  }

  subscribe(onChange: () => void, onError: (error: unknown) => void): () => void {
    if (getDatabaseMode() !== 'hybrid') return () => {}
    const local = new SharedTripLocal(requireHybridStore())
    const subscription = liveQuery(async () => [await local.list(), await local.tasks()]).subscribe({
      next: onChange, error: onError,
    })
    return () => subscription.unsubscribe()
  }
}

export const sharedTrips = new SharedTripRepository()
