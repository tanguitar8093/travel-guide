export type DatabaseMode = 'indexeddb' | 'supabase'

const DATABASE_MODE_STORAGE_KEY = 'travel-planner-database-mode'

const databaseModeLabels: Record<DatabaseMode, string> = {
  indexeddb: 'Dexie/IndexedDB (單機)',
  supabase: 'Supabase (雲端)',
}

type DatabaseModeListener = (mode: DatabaseMode) => void

const listeners = new Set<DatabaseModeListener>()

function readStoredDatabaseMode(): DatabaseMode {
  const storedMode = window.localStorage.getItem(DATABASE_MODE_STORAGE_KEY)
  return storedMode === 'supabase' ? 'supabase' : 'indexeddb'
}

let currentDatabaseMode = readStoredDatabaseMode()

export function getDatabaseMode(): DatabaseMode {
  return currentDatabaseMode
}

export function getDatabaseModeLabel(mode: DatabaseMode = currentDatabaseMode): string {
  return databaseModeLabels[mode]
}

export function setDatabaseMode(mode: DatabaseMode): DatabaseMode {
  if (currentDatabaseMode === mode) {
    return currentDatabaseMode
  }

  currentDatabaseMode = mode
  window.localStorage.setItem(DATABASE_MODE_STORAGE_KEY, mode)
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
