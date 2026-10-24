import { isOsmDatasetId, type OsmDatasetId } from './osm-datasets'

type Pending = { id: string; dataset: OsmDatasetId }
export interface DatasetSyncStore {
  get(): Pending | undefined
  set(value: Pending | undefined): void
}

/** Only explicit selections are uploaded. A device's old cache never becomes a write. */
interface DatasetSyncOptions {
  store: DatasetSyncStore
  read(): Promise<OsmDatasetId | undefined>
  write(dataset: OsmDatasetId): Promise<void>
  apply(dataset: OsmDatasetId): void
  report(error?: string): void
}

export class AccountDatasetSync {
  private stopped = false
  private running?: Promise<void>
  private rerun = false

  private readonly options: DatasetSyncOptions
  constructor(options: DatasetSyncOptions) { this.options = options }

  select(dataset: OsmDatasetId): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.options.store.set({ id: crypto.randomUUID(), dataset })
    return this.refresh()
  }

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) { this.rerun = true; return this.running }
    this.running = this.run().finally(() => { this.running = undefined })
    return this.running
  }

  private async run() {
    do {
      this.rerun = false
      const pending = this.options.store.get()
      try {
        if (pending) {
          await this.options.write(pending.dataset)
          if (this.stopped) return
          if (this.options.store.get()?.id === pending.id) this.options.store.set(undefined)
          if (!this.options.store.get()) this.options.apply(pending.dataset)
        } else {
          const dataset = await this.options.read()
          if (this.stopped) return
          // No cloud preference yet: use one shared default, never upload a stale cache.
          if (!this.options.store.get()) this.options.apply(dataset ?? 'okinawa')
        }
        this.options.report()
      } catch (cause) {
        if (this.stopped) return
        this.options.report(cause instanceof Error ? cause.message : '區域設定同步失敗，將自動重試。')
      }
    } while (!this.stopped && this.rerun)
  }

  stop() { this.stopped = true }
}

export function readPendingDataset(storage: Pick<Storage, 'getItem'>, key: string): Pending | undefined {
  const raw = storage.getItem(key)
  if (!raw) return
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' &&
      'dataset' in value && isOsmDatasetId(value.dataset)) return { id: value.id, dataset: value.dataset }
  } catch { /* An invalid local queue must not be uploaded. */ }
}
