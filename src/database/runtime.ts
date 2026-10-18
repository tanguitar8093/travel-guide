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
import { getHybridStatus, scheduleHybridAutoSync, stopHybridAutoSync } from './hybrid.runtime'
import { ValidationError } from './errors'
import { canDebugDatabaseModes, readEffectiveSyncMode, subscribeDatabaseModeRole } from './mode-access'

export type { DatabaseMode } from './database-mode-preference'
export type { SyncMode } from './sync-mode-preference'

const databaseModeLabels: Record<DatabaseMode, string> = {
  indexeddb: 'Dexie/IndexedDB (單機)',
  supabase: 'Supabase (雲端)',
  hybrid: '混合模式（本機優先）',
}

const syncModeLabels: Record<SyncMode, string> = {
  manual: '手動同步',
  auto: '自動同步',
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
  return canDebugDatabaseModes() ? currentDatabaseMode : 'hybrid'
}

export function getDatabaseModeLabel(mode: DatabaseMode = getDatabaseMode()): string {
  return databaseModeLabels[mode]
}

export function setDatabaseMode(mode: DatabaseMode): DatabaseMode {
  if (!canDebugDatabaseModes()) throw new ValidationError('只有管理員可切換資料庫來源。')
  if (mode === 'hybrid' && !getHybridStatus().ready) {
    throw new ValidationError('混合模式需完成帳號準備。')
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
  return canDebugDatabaseModes() ? currentSyncMode : 'auto'
}

export function getSyncModeLabel(mode: SyncMode = getSyncMode()): string {
  return syncModeLabels[mode]
}

export function setSyncMode(mode: SyncMode): SyncMode {
  if (!canDebugDatabaseModes()) throw new ValidationError('只有管理員可切換同步模式。')
  if (currentSyncMode === mode) {
    return currentSyncMode
  }

  currentSyncMode = mode
  writeSyncModePreference(mode)
  if (mode === 'manual') {
    stopHybridAutoSync()
  } else if (getHybridStatus().ready) {
    scheduleHybridAutoSync()
  }
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

  subscribeDatabaseModeRole(() => {
    currentDatabaseMode = readStoredDatabaseMode()
    currentSyncMode = readStoredSyncMode()
    for (const listener of databaseModeListeners) listener(getDatabaseMode())
    for (const listener of syncModeListeners) listener(getSyncMode())
    if (readEffectiveSyncMode() === 'manual') stopHybridAutoSync()
    else if (getHybridStatus().ready) scheduleHybridAutoSync()
  })
}
