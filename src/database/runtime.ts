import {
  readDatabaseModePreference,
  type DatabaseMode,
  writeDatabaseModePreference,
} from './database-mode-preference'
import { getHybridStatus } from './hybrid.runtime'
import { ValidationError } from './errors'

export type { DatabaseMode } from './database-mode-preference'

const databaseModeLabels: Record<DatabaseMode, string> = {
  indexeddb: 'Dexie/IndexedDB (單機)',
  supabase: 'Supabase (雲端)',
  hybrid: '混合測試（本機優先，手動同步）',
}

type DatabaseModeListener = (mode: DatabaseMode) => void

const listeners = new Set<DatabaseModeListener>()

function readStoredDatabaseMode(): DatabaseMode {
  return readDatabaseModePreference()
}

let currentDatabaseMode = readStoredDatabaseMode()

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
  for (const listener of listeners) {
    listener(mode)
  }
  return currentDatabaseMode
}

export function subscribeDatabaseMode(listener: DatabaseModeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
