export type DatabaseMode = 'indexeddb' | 'supabase'

const DATABASE_MODE_STORAGE_KEY = 'travel-planner-database-mode'

export function readDatabaseModePreference(): DatabaseMode {
  const storedMode = window.localStorage.getItem(DATABASE_MODE_STORAGE_KEY)
  return storedMode === 'indexeddb' ? 'indexeddb' : 'supabase'
}

export function writeDatabaseModePreference(mode: DatabaseMode): void {
  window.localStorage.setItem(DATABASE_MODE_STORAGE_KEY, mode)
}
