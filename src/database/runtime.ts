import {
  readDatabaseModePreference,
  type DatabaseMode,
  writeDatabaseModePreference,
} from './database-mode-preference'
import {
  readSyncModePreference,
  type SyncMode,
  writeSyncModePreference,
} from './sync-mode-preference'
import { getHybridStatus } from './hybrid.runtime'
import { ValidationError } from './errors'

export type { DatabaseMode } from './database-mode-preference'
export type { SyncMode } from './sync-mode-preference'

const databaseModeLabels: Record<DatabaseMode, string> = {
  indexeddb: 'Dexie/IndexedDB (單機)',
  supabase: 'Supabase (雲端)',
  hybrid: '混合測試（本機優先，手動同步）',
}

const syncModeLabels: Record<SyncMode, string> = {
  manual: '手動同步',
  auto: '自動同步（尚未開放）',
}

type DatabaseModeListener = (mode: DatabaseMode) => void
type SyncModeListener = (mode: SyncMode) => void

const databaseModeListeners = new Set<DatabaseModeListener>()
const syncModeListeners = new Set<SyncModeListener>()

function readStoredDatabaseMode(): DatabaseMode {
  return readDatabaseModePreference()
}

function readStoredSyncMode(): SyncMode {
  return readSyncModePreference()
}

let currentDatabaseMode = readStoredDatabaseMode()
let currentSyncMode = readStoredSyncMode()

export function getDatabaseMode(): DatabaseMode {
  return currentDatabaseMode
}

export function getDatabaseModeLabel(mode: DatabaseMode = currentDatabaseMode): string {
  return databaseModeLabels[mode]
}

export function setDatabaseMode(mode: DatabaseMode): DatabaseMode {
  if (mode === 'hybrid' && (!import.meta.env.DEV || !getHybridStatus().ready)) {
    throw new ValidationError('混合測試模式僅供開發環境且需完成帳號準備。')
  }
  if (currentDatabaseMode === mode) {
    return currentDatabaseMode
  }

  currentDatabaseMode = mode
  writeDatabaseModePreference(mode)
  for (const listener of databaseModeListeners) {
    listener(mode)
  }
  return currentDatabaseMode
}

export function subscribeDatabaseMode(listener: DatabaseModeListener): () => void {
  databaseModeListeners.add(listener)
  return () => {
    databaseModeListeners.delete(listener)
  }
}

export function getSyncMode(): SyncMode {
  return currentSyncMode
}

export function getSyncModeLabel(mode: SyncMode = currentSyncMode): string {
  return syncModeLabels[mode]
}

export function setSyncMode(mode: SyncMode): SyncMode {
  if (currentSyncMode === mode) {
    return currentSyncMode
  }

  currentSyncMode = mode
  writeSyncModePreference(mode)
  for (const listener of syncModeListeners) {
    listener(mode)
  }
  return currentSyncMode
}

export function subscribeSyncMode(listener: SyncModeListener): () => void {
  syncModeListeners.add(listener)
  return () => {
    syncModeListeners.delete(listener)
  }
}
