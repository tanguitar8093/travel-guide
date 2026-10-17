export type DatabaseMode = 'indexeddb' | 'supabase' | 'hybrid'

const DATABASE_MODE_STORAGE_KEY = 'travel-planner-database-mode'

export function readDatabaseModePreference(): DatabaseMode {
  const storedMode = window.localStorage.getItem(DATABASE_MODE_STORAGE_KEY)
  if (storedMode === 'hybrid' && import.meta.env.DEV) return 'hybrid'
  return storedMode === 'indexeddb' ? 'indexeddb' : 'supabase'
}

export function writeDatabaseModePreference(mode: DatabaseMode): void {
  window.localStorage.setItem(DATABASE_MODE_STORAGE_KEY, mode)
}
