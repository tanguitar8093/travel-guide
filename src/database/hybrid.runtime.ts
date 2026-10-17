import { liveQuery } from 'dexie'
import { ValidationError } from './errors'
import { LocalSyncStore } from './local-sync.store'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import type { LocalSyncSummary, SyncAccount } from './sync.types'

type LocalRepositories = Parameters<Parameters<LocalSyncStore['mutate']>[1]>[0]

const context = new SyncAccountContext()
let activeStore: LocalSyncStore | null = null
let activeDatabase: SyncDatabase | null = null
let generation = 0
let subscription: { unsubscribe(): void } | null = null
const listeners = new Set<() => void>()

export interface HybridStatus {
  ready: boolean
  summary?: LocalSyncSummary
  error?: string
  lastOperationMs?: number
}

let status: HybridStatus = { ready: false }

function publish(next: HybridStatus): void {
  status = next
  for (const listener of listeners) listener()
}

export function getHybridStatus(): HybridStatus {
  return status
}

export function subscribeHybridStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function deactivateHybridAccount(): void {
  generation += 1
  context.deactivate()
  subscription?.unsubscribe()
  subscription = null
  activeDatabase?.close()
  activeDatabase = null
  activeStore = null
  publish({ ready: false })
}

export async function activateHybridAccount(account: SyncAccount, role: string): Promise<void> {
  deactivateHybridAccount()
  if (!import.meta.env.DEV) return
  if (role !== 'member' && role !== 'admin') throw new ValidationError('目前帳號沒有混合模式權限。')
  const currentGeneration = generation
  context.activate(account)
  const database = new SyncDatabase(account)
  const store = new LocalSyncStore(database, context)
  activeDatabase = database
  try {
    await store.prepareLocal()
    if (generation !== currentGeneration) return
    activeStore = store
    const summary = await store.getSummary()
    if (generation !== currentGeneration) return
    publish({ ready: true, summary })
    subscription = liveQuery(() => store.getSummary()).subscribe({
      next: (summary) => {
        if (generation === currentGeneration) publish({ ...status, summary })
      },
      error: (error: unknown) => {
        if (generation === currentGeneration) publish({ ...status, error: String(error) })
      },
    })
  } catch (error) {
    if (generation === currentGeneration) {
      deactivateHybridAccount()
      publish({ ready: false, error: error instanceof Error ? error.message : String(error) })
    }
    throw error
  }
}

export function requireHybridStore(): LocalSyncStore {
  if (!import.meta.env.DEV || !activeStore) throw new ValidationError('混合測試模式尚未準備好，請確認登入狀態。')
  return activeStore
}

export async function runHybridMutation<Result>(
  operation: string,
  work: (repositories: LocalRepositories) => Promise<Result>,
): Promise<Result> {
  const store = requireHybridStore()
  const currentGeneration = generation
  const started = performance.now()
  const result = await store.mutate(operation, work)
  if (generation === currentGeneration) publish({ ...status, lastOperationMs: performance.now() - started })
  return result
}
