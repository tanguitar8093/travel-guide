import Dexie, { type Transaction } from 'dexie'
import { ValidationError } from './errors'
import { BackupRepository } from './backup.repository'
import type { CloudSyncRecord } from './sync-cloud.adapter'
import { LabelRepository } from './label.repository'
import { ItineraryItemRepository, PlaceRepository, RegionRepository, TripRepository } from './repositories'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import type {
  LocalSyncSummary, SyncChange, SyncEntityName, SyncMetadata, SyncRecord, SyncTask,
} from './sync.types'

const entityNames: SyncEntityName[] = ['regions', 'places', 'labels', 'trips', 'itineraryItems']

interface TrackedMutation {
  assertCurrent: () => void
  touched: Map<string, { entity: SyncEntityName; id: string; before?: SyncRecord }>
}

export class LocalSyncStore {
  private readonly database: SyncDatabase
  private readonly context: SyncAccountContext
  private readonly mutations = new WeakMap<Transaction, TrackedMutation>()
  private readonly remoteTransactions = new WeakSet<Transaction>()
  private readonly repositories: {
    regions: RegionRepository
    places: PlaceRepository
    labels: LabelRepository
    trips: TripRepository
    itineraryItems: ItineraryItemRepository
  }

  constructor(database: SyncDatabase, context: SyncAccountContext) {
    this.database = database
    this.context = context
    this.repositories = {
      regions: new RegionRepository(database),
      places: new PlaceRepository(database),
      labels: new LabelRepository(database),
      trips: new TripRepository(database),
      itineraryItems: new ItineraryItemRepository(database),
    }
    for (const entity of entityNames) {
      const table = database.table<SyncRecord, string>(entity)
      table.hook('creating', (id, record, transaction) => {
        this.track(transaction, entity, id ?? record.id)
      })
      table.hook('updating', (_changes, id, record, transaction) => {
        this.track(transaction, entity, id, record)
      })
      table.hook('deleting', (id, record, transaction) => {
        this.track(transaction, entity, id, record)
      })
    }
  }

  async prepareLocal(): Promise<SyncMetadata> {
    const assertCurrent = this.context.capture(this.database.account)
    return this.database.transaction('rw', this.database.syncMetadata, async () => {
      assertCurrent()
      let metadata = await this.database.syncMetadata.get('workspace')
      if (!metadata) {
        metadata = {
          id: 'workspace', account: this.database.account,
          deviceId: crypto.randomUUID(), initialized: false,
        }
        await this.database.syncMetadata.add(metadata)
      }
      assertCurrent()
      return metadata
    })
  }

  async mutate<Result>(
    operation: string,
    work: (repositories: LocalSyncStore['repositories']) => Promise<Result>,
  ): Promise<Result> {
    if (!operation.trim()) throw new ValidationError('Sync operation must not be empty.')
    if (Dexie.currentTransaction?.db === this.database) {
      throw new ValidationError('A local sync operation cannot be nested in another transaction.')
    }
    const assertCurrent = this.context.capture(this.database.account)
    return this.database.transaction('rw', this.database.tables, async (transaction) => {
      assertCurrent()
      const metadata = await this.database.syncMetadata.get('workspace')
      if (!metadata) throw new ValidationError('Prepare the local workspace before editing.')
      const mutation: TrackedMutation = { assertCurrent, touched: new Map() }
      this.mutations.set(transaction, mutation)
      try {
        const result = await work(this.repositories)
        const changes: SyncChange[] = []
        const queued = await this.database.outbox.toArray()
        for (const touched of mutation.touched.values()) {
          const after = await this.database.table<SyncRecord, string>(touched.entity).get(touched.id)
          if (!touched.before && !after) continue
          const baseline = await this.database.syncBaselines.get([touched.entity, touched.id])
          const predecessor = queued.findLast((task) => task.changes.some(
            (change) => change.entity === touched.entity && change.id === touched.id,
          ))
          changes.push({
            ...touched, after, kind: after ? 'put' : 'delete',
            baseVersion: baseline ? baseline.version : !touched.before && !predecessor ? null : undefined,
            predecessorOperationId: predecessor?.operationId,
          })
        }
        if (changes.length) {
          await this.database.outbox.add({
            operationId: crypto.randomUUID(), account: this.database.account,
            deviceId: metadata.deviceId, protocolVersion: 1, operation,
            createdAt: new Date().toISOString(), changes, status: 'pending', attempts: 0,
          })
        }
        assertCurrent()
        return result
      } finally {
        this.mutations.delete(transaction)
      }
    })
  }

  async listTasks(): Promise<SyncTask[]> {
    const assertCurrent = this.context.capture(this.database.account)
    const tasks = await this.database.outbox.orderBy('sequence').toArray()
    assertCurrent()
    return tasks
  }

  captureAccount(): () => void {
    return this.context.capture(this.database.account)
  }

  getSyncLockName(): string {
    this.captureAccount()()
    return this.database.name
  }

  async getSyncMetadata(): Promise<SyncMetadata> {
    const assertCurrent = this.captureAccount()
    const metadata = await this.database.syncMetadata.get('workspace')
    assertCurrent()
    if (!metadata) throw new ValidationError('本機資料尚未準備好。')
    return metadata
  }

  async prepareUpload(): Promise<SyncTask | undefined> {
    const assertCurrent = this.captureAccount()
    return this.database.transaction('rw', this.database.outbox, async () => {
      assertCurrent()
      const task = await this.database.outbox.orderBy('sequence').first()
      if (!task) return undefined
      if (task.status === 'conflict') throw new ValidationError('有待處理的衝突；已停止同步，本機資料仍保留。')
      const changes = task.uploadChanges ?? task.changes
      if (changes.some((change) => change.baseVersion === undefined || change.predecessorOperationId)) {
        throw new ValidationError('缺少安全基準或前序操作尚未完成，不能上傳。')
      }
      task.uploadChanges = structuredClone(changes)
      task.attempts += 1
      await this.database.outbox.put(task)
      assertCurrent()
      return { ...task, changes: task.uploadChanges }
    })
  }

  async markUpload(task: SyncTask, status: 'failed' | 'conflict', error: string): Promise<void> {
    const assertCurrent = this.captureAccount()
    await this.database.transaction('rw', this.database.outbox, async () => {
      assertCurrent()
      const current = await this.database.outbox.get(task.sequence!)
      if (current?.operationId === task.operationId) {
        await this.database.outbox.update(task.sequence!, { status, error })
      }
      assertCurrent()
    })
  }

  async syncTransaction<Result>(work: (database: SyncDatabase) => Promise<Result>): Promise<Result> {
    const assertCurrent = this.captureAccount()
    return this.database.transaction('rw', this.database.tables, async (transaction) => {
      assertCurrent()
      this.remoteTransactions.add(transaction)
      try {
        const result = await work(this.database)
        assertCurrent()
        return result
      } finally {
        this.remoteTransactions.delete(transaction)
      }
    })
  }

  async recordPushConflict(task: SyncTask, records: SyncTask['conflictRecords']): Promise<void> {
    await this.syncTransaction(async (database) => {
      const current = await database.outbox.get(task.sequence!)
      if (current?.operationId !== task.operationId) throw new ValidationError('待同步操作已改變。')
      await database.outbox.update(task.sequence!, {
        status: 'conflict', error: '雲端版本已改變，未覆蓋資料。', conflictRecords: records,
      })
      await database.syncConflicts.clear()
    })
  }

  async applyRemote(
    incoming: CloudSyncRecord[],
    options: { cursor?: string; initialize?: boolean; acknowledge?: SyncTask } = {},
  ): Promise<boolean> {
    const assertCurrent = this.captureAccount()
    return this.database.transaction('rw', this.database.tables, async (transaction) => {
      assertCurrent()
      const metadata = await this.database.syncMetadata.get('workspace')
      if (!metadata) throw new ValidationError('本機資料尚未準備好。')
      if (options.cursor !== undefined && !/^\d+$/.test(options.cursor)) throw new ValidationError('同步游標格式不正確。')
      const final = new Map<string, CloudSyncRecord>()
      for (const row of incoming) {
        if (!entityNames.includes(row.entity) || typeof row.id !== 'string' || !row.id
          || typeof row.version !== 'string' || !row.version || (row.record !== null && row.record?.id !== row.id)
          || (row.sequence !== undefined && !/^\d+$/.test(row.sequence))) {
          throw new ValidationError('雲端同步資料格式不正確。')
        }
        const key = JSON.stringify([row.entity, row.id])
        if (options.initialize && (final.has(key) || row.record === null)) throw new ValidationError('初始化快照格式不正確。')
        final.set(key, row)
      }
      const tasks = await this.database.outbox.orderBy('sequence').toArray()
      const acknowledged = options.acknowledge
      if (acknowledged?.changes.some((change) => !final.has(JSON.stringify([change.entity, change.id])))) {
        throw new ValidationError('上傳回應不完整，待同步操作仍保留，請重試。')
      }
      if (acknowledged && !tasks.some((task) => task.operationId === acknowledged.operationId)) {
        throw new ValidationError('上傳操作已改變，不能套用回應。')
      }
      const remaining = tasks.filter((task) => task.operationId !== acknowledged?.operationId)
      const conflictTasks = new Set<number>()
      for (const row of final.values()) {
        const baseline = await this.database.syncBaselines.get([row.entity, row.id])
        if (!options.initialize && baseline?.sequence && row.sequence
          && BigInt(row.sequence) <= BigInt(baseline.sequence)) continue
        if (!acknowledged) {
          const first = remaining.find((task) => task.changes.some((change) => change.entity === row.entity && change.id === row.id))
          const change = first?.changes.find((change) => change.entity === row.entity && change.id === row.id)
          if (first && change?.baseVersion !== row.version) conflictTasks.add(first.sequence!)
        }
      }
      if (options.initialize) {
        for (const task of remaining) {
          if (task.changes.some((change) => change.baseVersion === undefined && !change.predecessorOperationId)) conflictTasks.add(task.sequence!)
        }
      }
      if (conflictTasks.size) {
        for (const sequence of conflictTasks) {
          await this.database.outbox.update(sequence, {
            status: 'conflict', error: '雲端與本機版本不同，未覆蓋任何資料。',
            conflictRecords: [...final.values()],
          })
        }
        await this.database.syncConflicts.clear()
        assertCurrent()
        return false
      }
      const data = { regions: [], places: [], labels: [], trips: [], itineraryItems: [] } as Record<SyncEntityName, SyncRecord[]>
      const local = new Map<string, SyncRecord>()
      for (const entity of entityNames) {
        for (const record of await this.database.table<SyncRecord, string>(entity).toArray()) {
          local.set(JSON.stringify([entity, record.id]), record)
        }
      }
      if (options.initialize) {
        for (const [key] of local) {
          const [entity, id] = JSON.parse(key) as [SyncEntityName, string]
          if (!final.has(key) && !remaining.some((task) => task.changes.some((change) => change.entity === entity && change.id === id))) {
            throw new ValidationError('本機有來源不明的資料，不能安全初始化。請先匯出備份。')
          }
        }
      }
      const applicable: CloudSyncRecord[] = []
      for (const row of final.values()) {
        const baseline = await this.database.syncBaselines.get([row.entity, row.id])
        if (!options.initialize && baseline?.sequence && row.sequence
          && BigInt(row.sequence) <= BigInt(baseline.sequence)) continue
        applicable.push(row)
        if (remaining.some((task) => task.changes.some((change) => change.entity === row.entity && change.id === row.id))) continue
        const key = JSON.stringify([row.entity, row.id])
        if (row.record) local.set(key, row.record)
        else local.delete(key)
      }
      for (const [key, record] of local) {
        const [entity] = JSON.parse(key) as [SyncEntityName, string]
        data[entity].push(record)
      }
      new BackupRepository().validateImport({ format: 'travel-planner-backup', version: 1, exportedAt: new Date().toISOString(), data })
      this.remoteTransactions.add(transaction)
      try {
        for (const row of applicable) {
          const pending = remaining.some((task) => task.changes.some((change) => change.entity === row.entity && change.id === row.id))
          if (!pending) {
            const table = this.database.table<SyncRecord, string>(row.entity)
            if (row.record) await table.put(row.record)
            else await table.delete(row.id)
          }
          await this.database.syncBaselines.put({ entity: row.entity, id: row.id, version: row.version, record: row.record ?? undefined, sequence: row.sequence ?? options.cursor })
        }
        if (acknowledged) {
          await this.database.outbox.delete(acknowledged.sequence!)
          for (const task of remaining) {
            let changed = false
            for (const change of task.changes) {
              if (change.predecessorOperationId !== acknowledged.operationId) continue
              const baseline = await this.database.syncBaselines.get([change.entity, change.id])
              if (!baseline) throw new ValidationError('上傳回應缺少版本，待同步清單仍保留。')
              change.baseVersion = baseline.version
              delete change.predecessorOperationId
              changed = true
            }
            if (changed) await this.database.outbox.put(task)
          }
        }
        if (options.initialize) metadata.initialized = true
        if (options.cursor !== undefined) metadata.cursor = options.cursor
        await this.database.syncMetadata.put(metadata)
        assertCurrent()
        return true
      } finally {
        this.remoteTransactions.delete(transaction)
      }
    })
  }

  async finishSync(): Promise<void> {
    const assertCurrent = this.captureAccount()
    await this.database.transaction('rw', this.database.syncMetadata, this.database.outbox, async () => {
      assertCurrent()
      if (await this.database.outbox.count()) return
      await this.database.syncMetadata.update('workspace', { lastSyncedAt: new Date().toISOString() })
      assertCurrent()
    })
  }

  async inspectSyncState() {
    const assertCurrent = this.captureAccount()
    return this.database.transaction('r', this.database.tables, async () => {
      const records = await Promise.all(entityNames.map(async (entity) => ({
        entity, records: await this.database.table<SyncRecord, string>(entity).toArray(),
      })))
      const tasks = await this.database.outbox.orderBy('sequence').toArray()
      const baselines = await this.database.syncBaselines.toArray()
      assertCurrent()
      return { records, tasks, baselines }
    })
  }

  async read<Result>(work: (repositories: LocalSyncStore['repositories']) => Promise<Result>): Promise<Result> {
    const assertCurrent = this.context.capture(this.database.account)
    return this.database.transaction('r', this.database.tables, async () => {
      const result = await work(this.repositories)
      assertCurrent()
      return result
    })
  }

  async getSummary(): Promise<LocalSyncSummary> {
    const assertCurrent = this.context.capture(this.database.account)
    return this.database.transaction('r', this.database.syncMetadata, this.database.outbox, async () => {
      const metadata = await this.database.syncMetadata.get('workspace')
      const tasks = await this.database.outbox.toArray()
      const pendingCount = tasks.filter((task) => task.status === 'pending').length
      const failedCount = tasks.filter((task) => task.status === 'failed').length
      const conflictCount = tasks.filter((task) => task.status === 'conflict').length
      assertCurrent()
      return {
        initialized: metadata?.initialized ?? false,
        status: conflictCount ? 'conflict' : failedCount ? 'failed' : pendingCount ? 'pending'
          : metadata?.initialized ? 'local-only' : 'not-initialized',
        pendingCount, failedCount, conflictCount, lastSyncedAt: metadata?.lastSyncedAt,
      }
    })
  }

  private track(transaction: Transaction, entity: SyncEntityName, id: string, before?: SyncRecord): void {
    let root = transaction
    while (root.parent) root = root.parent
    if (this.remoteTransactions.has(root)) {
      this.captureAccount()()
      return
    }
    const mutation = this.mutations.get(root)
    if (!mutation || Dexie.currentTransaction?.db !== this.database) {
      throw new ValidationError('Local sync writes require a tracked transaction.')
    }
    mutation.assertCurrent()
    const key = JSON.stringify([entity, id])
    if (!mutation.touched.has(key)) {
      mutation.touched.set(key, { entity, id, before: before ? structuredClone(before) : undefined })
    }
  }
}
