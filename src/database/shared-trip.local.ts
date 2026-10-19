import { ValidationError } from './errors'
import type { LocalSyncStore } from './local-sync.store'
import type { SharedTripDocument, SharedTripSaveResult, SharedTripSnapshot } from './shared-trip.types'
import { parseSharedTripDocument, parseSharedTripSnapshot } from './shared-trip.validation'
import type { SyncTask } from './sync.types'

export class SharedTripConflictError extends ValidationError {
  constructor() {
    super('共同編輯遇到版本衝突，草稿與待同步操作仍保留。')
    this.name = 'SharedTripConflictError'
  }
}

export class SharedTripLocal {
  private readonly store: LocalSyncStore

  constructor(store: LocalSyncStore) {
    this.store = store
  }

  list(): Promise<SharedTripSnapshot[]> {
    return this.store.listSharedTrips()
  }

  tasks(): Promise<SyncTask[]> {
    return this.store.listTasks().then((tasks) => tasks.filter((task) => task.sharedTrip))
  }

  async queue(before: SharedTripSnapshot, after: SharedTripDocument): Promise<void> {
    const valid = parseSharedTripDocument(after)
    await this.store.syncTransaction(async (database) => {
      const current = await database.sharedItineraries.get(before.id)
      if (!current?.document || current.document.trip.access === 'viewer') throw new ValidationError('此共享行程目前不可編輯。')
      if (JSON.stringify(current) !== JSON.stringify(before)) throw new ValidationError('共享行程已更新，請先重新載入；草稿尚未覆蓋。')
      if (JSON.stringify(valid.trip) !== JSON.stringify(current.document.trip) ||
        JSON.stringify(valid.region) !== JSON.stringify(current.document.region)) {
        throw new ValidationError('共同編輯不能變更行程基本資料或權限。')
      }
      const metadata = await database.syncMetadata.get('workspace')
      if (!metadata?.initialized) throw new ValidationError('請先完成個人工作區初始化，再編輯共享行程。')
      const queued = await database.outbox.orderBy('sequence').toArray()
      const sameTrip = queued.filter((task) => task.sharedTrip?.tripId === before.id)
      if (sameTrip.some((task) => task.status === 'conflict')) throw new ValidationError('此共享行程有待處理衝突，請先處理。')
      const predecessor = sameTrip.at(-1)
      await database.outbox.add({
        account: database.account, deviceId: metadata.deviceId, operationId: crypto.randomUUID(),
        protocolVersion: 1, operation: 'sharedTrip.save', createdAt: new Date().toISOString(),
        changes: [], status: 'pending', attempts: 0,
        sharedTrip: {
          tripId: before.id, baseVersion: before.version, before: current.document, after: valid,
          predecessorOperationId: predecessor?.operationId,
        },
      })
      await database.sharedItineraries.put({ ...current, document: valid })
    })
  }

  async download(incoming: SharedTripSnapshot[]): Promise<void> {
    const seen = new Set<string>()
    const snapshots = incoming.map((value) => {
      const snapshot = parseSharedTripSnapshot(value)
      if (seen.has(snapshot.id)) throw new ValidationError('共享行程清單包含重複資料。')
      seen.add(snapshot.id)
      return snapshot
    })
    await this.store.syncTransaction(async (database) => {
      const tasks = await database.outbox.toArray()
      for (const snapshot of snapshots) {
        const current = await database.sharedItineraries.get(snapshot.id)
        if (current && BigInt(snapshot.version) < BigInt(current.version)) continue
        const pending = tasks.filter((task) => task.sharedTrip?.tripId === snapshot.id)
        const conflict = pending.length > 0 && (pending[0].sharedTrip!.baseVersion !== snapshot.version ||
          !snapshot.document || snapshot.document.trip.access === 'viewer')
        if (conflict) {
          for (const task of pending) {
            task.status = 'conflict'
            task.error = snapshot.document
              ? '共享行程或權限已更新，請到行程模組處理；本機草稿仍保留。'
              : '共享存取權已撤銷；快取已移除，未上傳草稿保留於待同步清單。'
            task.sharedTrip!.conflict = snapshot
            await database.outbox.put(task)
          }
        }
        if (!pending.length || !snapshot.document || snapshot.document.trip.access === 'viewer') {
          await database.sharedItineraries.put(snapshot)
        }
      }
    })
  }

  async acknowledge(task: SyncTask, result: SharedTripSaveResult): Promise<void> {
    if (!task.sharedTrip) throw new ValidationError('缺少共享操作內容。')
    if (result.snapshot.id !== task.sharedTrip.tripId) throw new ValidationError('共同編輯回應的行程不符。')
    if (result.status === 'conflict') {
      await this.download([result.snapshot])
      throw new SharedTripConflictError()
    }
    if (result.operationId !== task.operationId || !result.snapshot.document) throw new ValidationError('共同編輯回應不完整。')
    await this.store.syncTransaction(async (database) => {
      const queued = await database.outbox.orderBy('sequence').toArray()
      const currentTask = queued.find((row) => row.operationId === task.operationId)
      if (!currentTask?.sharedTrip || currentTask.sequence !== task.sequence ||
        JSON.stringify(currentTask.sharedTrip) !== JSON.stringify(task.sharedTrip)) {
        throw new ValidationError('共享待同步操作已變更，未移除操作。')
      }
      const remaining = queued.filter((row) => row.sharedTrip?.tripId === task.sharedTrip!.tripId && row.operationId !== task.operationId)
      for (const next of remaining) {
        if (next.sharedTrip?.predecessorOperationId !== task.operationId) continue
        next.sharedTrip.baseVersion = result.snapshot.version
        delete next.sharedTrip.predecessorOperationId
        await database.outbox.put(next)
      }
      const cached = await database.sharedItineraries.get(task.sharedTrip!.tripId)
      await database.sharedItineraries.put({
        ...result.snapshot,
        document: remaining.length && cached?.document ? cached.document : result.snapshot.document,
      })
      await database.outbox.delete(currentTask.sequence!)
    })
  }

  async resolve(tripId: string, expected: SharedTripSnapshot, latest: SharedTripSnapshot, choice: 'local' | 'cloud'): Promise<void> {
    if (JSON.stringify(latest) !== JSON.stringify(expected)) throw new ValidationError('雲端行程又有更新，請重新載入衝突後再選擇。')
    await this.store.syncTransaction(async (database) => {
      const tasks = (await database.outbox.orderBy('sequence').toArray()).filter((task) => task.sharedTrip?.tripId === tripId)
      if (!tasks.length || tasks.some((task) => task.uploadChanges && task.status !== 'conflict')) {
        throw new ValidationError('尚有上傳結果未確認或衝突已改變，請先重試同步。')
      }
      if (tasks.some((task) => JSON.stringify(task.sharedTrip?.conflict) !== JSON.stringify(expected))) {
        throw new ValidationError('衝突內容已改變，請重新載入。')
      }
      if (choice === 'local' && (!latest.document || latest.document.trip.access === 'viewer')) {
        throw new ValidationError('權限已撤銷或改為唯讀，不能重新上傳草稿。')
      }
      const last = tasks.at(-1)!.sharedTrip!
      const kept = choice === 'local' && latest.document
        ? parseSharedTripDocument({ ...latest.document, places: last.after.places, items: last.after.items })
        : latest.document
      const metadata = await database.syncMetadata.get('workspace')
      if (!metadata) throw new ValidationError('本機工作區尚未準備好。')
      for (const task of tasks) await database.outbox.delete(task.sequence!)
      await database.sharedItineraries.put({ ...latest, document: kept })
      if (choice === 'local' && kept && latest.document) {
        await database.outbox.add({
          operationId: crypto.randomUUID(), account: database.account, deviceId: metadata.deviceId,
          protocolVersion: 1, operation: 'sharedTrip.keep-local', createdAt: new Date().toISOString(),
          changes: [], status: 'pending', attempts: 0,
          sharedTrip: { tripId, baseVersion: latest.version, before: latest.document, after: kept },
        })
      }
    })
  }
}
