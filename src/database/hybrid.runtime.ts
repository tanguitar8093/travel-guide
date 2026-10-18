import { liveQuery } from 'dexie'
import { ValidationError } from './errors'
import { LocalSyncStore } from './local-sync.store'
import { readEffectiveSyncMode as readSyncModePreference } from './mode-access'
import { SyncAccountContext } from './sync-account-context'
import { SyncDatabase } from './sync.database'
import { checkHybridOnLogin, syncHybridManually } from './sync-engine'
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
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null
let autoSyncSafetyTimer: ReturnType<typeof setTimeout> | null = null
let foregroundPollTimer: ReturnType<typeof setTimeout> | null = null
let autoSyncGeneration = 0
let autoSyncRetryCount = 0
let syncingStore: LocalSyncStore | null = null
let lifecycleListenersInstalled = false
let onOnlineListener: (() => void) | null = null
let onVisibilityChangeListener: (() => void) | null = null

function publish(next: HybridStatus): void {
  const becameReady = !status.ready && next.ready
  const resolvedConflict = (status.summary?.conflictCount ?? 0) > 0 && (next.summary?.conflictCount ?? 0) === 0
  const hasConflict = Boolean(next.summary && next.summary.conflictCount > 0)
  status = hasConflict
    ? { ...next, error: next.error ?? '同步發現衝突，已暫停自動同步。' }
    : next
  if (hasConflict) {
    stopHybridAutoSync()
  } else if (status.ready && (becameReady || resolvedConflict) && readSyncModePreference() === 'auto' && !autoSyncTimer && !autoSyncSafetyTimer && !foregroundPollTimer) {
    scheduleHybridAutoSync()
  }
  for (const listener of listeners) listener()
}

function clearAutoSyncTimers(): void {
  if (autoSyncTimer !== null) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
  }
  if (autoSyncSafetyTimer !== null) {
    clearTimeout(autoSyncSafetyTimer)
    autoSyncSafetyTimer = null
  }
  if (foregroundPollTimer !== null) {
    clearTimeout(foregroundPollTimer)
    foregroundPollTimer = null
  }
}

function computeRetryDelayMs(): number {
  const base = Math.min(30000, 1000 * 2 ** autoSyncRetryCount)
  return base + Math.floor(Math.random() * 500)
}

export function scheduleForegroundPoll(): void {
  if (!activeStore || readSyncModePreference() !== 'auto') return
  if ((status.summary?.conflictCount ?? 0) > 0) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  // Polling must not cancel a queued mutation or failure retry.
  if (foregroundPollTimer !== null) clearTimeout(foregroundPollTimer)
  foregroundPollTimer = setTimeout(() => {
    foregroundPollTimer = null
    if (readSyncModePreference() === 'auto' && activeStore && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
      void triggerAutoSync()
    }
  }, 4 * 60 * 1000)
}

async function triggerAutoSync(): Promise<void> {
  const store = activeStore
  if (!store || readSyncModePreference() !== 'auto') return
  if ((status.summary?.conflictCount ?? 0) > 0) return
  if (syncingStore === store) {
    scheduleHybridAutoSync()
    return
  }
  clearAutoSyncTimers()
  const generation = autoSyncGeneration
  syncingStore = store
  try {
    await syncHybridManually(store)
    if (generation === autoSyncGeneration && activeStore === store) {
      autoSyncRetryCount = 0
      publish({ ...status, summary: await store.getSummary(), error: undefined })
    }
  } catch (error) {
    if (generation === autoSyncGeneration && activeStore === store) {
      const message = error instanceof Error ? error.message : String(error)
      publish({
        ...status,
        summary: await store.getSummary(),
        error: message,
      })
      if ((status.summary?.conflictCount ?? 0) > 0) return
      autoSyncRetryCount += 1
      const retryDelay = computeRetryDelayMs()
      autoSyncTimer = setTimeout(() => {
        autoSyncTimer = null
        if (readSyncModePreference() === 'auto' && activeStore === store) {
          void triggerAutoSync()
        }
      }, retryDelay)
    }
  } finally {
    if (syncingStore === store) syncingStore = null
    if (generation === autoSyncGeneration && activeStore === store) {
      scheduleForegroundPoll()
    }
  }
}

export function scheduleHybridAutoSync(): void {
  if (!activeStore || readSyncModePreference() !== 'auto') return
  if ((status.summary?.conflictCount ?? 0) > 0) return
  const generation = ++autoSyncGeneration
  clearAutoSyncTimers()

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null
    void (async () => {
      if (generation !== autoSyncGeneration) return
      await triggerAutoSync()
    })()
  }, 2000)

  autoSyncSafetyTimer = setTimeout(() => {
    autoSyncSafetyTimer = null
    if (generation !== autoSyncGeneration) return
    void triggerAutoSync()
  }, 10000)

  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    scheduleForegroundPoll()
  }
}

export function stopHybridAutoSync(): void {
  autoSyncGeneration += 1
  autoSyncRetryCount = 0
  clearAutoSyncTimers()
}

export function getHybridStatus(): HybridStatus {
  return status
}

export function subscribeHybridStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function installLifecycleListeners(): void {
  if (lifecycleListenersInstalled || typeof window === 'undefined') return
  onOnlineListener = () => {
    if (readSyncModePreference() !== 'auto' || !activeStore) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    void triggerAutoSync()
  }
  onVisibilityChangeListener = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      onOnlineListener?.()
    }
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', onOnlineListener)
    window.addEventListener('focus', onOnlineListener)
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibilityChangeListener)
  }
  lifecycleListenersInstalled = true
}

function uninstallLifecycleListeners(): void {
  if (!lifecycleListenersInstalled || typeof window === 'undefined') return
  if (onOnlineListener && typeof window.removeEventListener === 'function') {
    window.removeEventListener('online', onOnlineListener)
    window.removeEventListener('focus', onOnlineListener)
  }
  if (onVisibilityChangeListener && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    document.removeEventListener('visibilitychange', onVisibilityChangeListener)
  }
  onOnlineListener = null
  onVisibilityChangeListener = null
  lifecycleListenersInstalled = false
}

export function deactivateHybridAccount(): void {
  generation += 1
  autoSyncGeneration += 1
  context.deactivate()
  subscription?.unsubscribe()
  subscription = null
  clearAutoSyncTimers()
  activeDatabase?.close()
  activeDatabase = null
  activeStore = null
  uninstallLifecycleListeners()
  publish({ ready: false })
}

export async function activateHybridAccount(
  account: SyncAccount,
  role: string,
  options: { checkCloudOnLogin?: boolean } = {},
): Promise<void> {
  deactivateHybridAccount()
  if (role !== 'member' && role !== 'admin') throw new ValidationError('目前帳號沒有混合模式權限。')
  const currentGeneration = generation
  context.activate(account)
  const database = new SyncDatabase(account)
  const store = new LocalSyncStore(database, context)
  activeDatabase = database
  try {
    await store.prepareLocal()
    if (generation !== currentGeneration) return
    let startupError: string | undefined
    if (options.checkCloudOnLogin) {
      try {
        await checkHybridOnLogin(store)
      } catch (error) {
        if (generation !== currentGeneration) return
        startupError = error instanceof Error ? error.message : String(error)
      }
    }
    if (generation !== currentGeneration) return
    activeStore = store
    const summary = await store.getSummary()
    if (generation !== currentGeneration) return
    installLifecycleListeners()
    publish({ ready: true, summary, error: startupError })
    if (readSyncModePreference() === 'auto') {
      scheduleHybridAutoSync()
    }
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
  if (!activeStore) throw new ValidationError('混合模式尚未準備好，請確認登入狀態。')
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
  if (generation === currentGeneration) {
    publish({ ...status, lastOperationMs: performance.now() - started })
    if (readSyncModePreference() === 'auto') {
      scheduleHybridAutoSync()
    }
  }
  return result
}
