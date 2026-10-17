export type DatabaseMode = 'indexeddb' | 'supabase' | 'hybrid'

const DATABASE_MODE_STORAGE_KEY = 'travel-planner-database-mode'

export function readDatabaseModePreference(): DatabaseMode {
  if (typeof window === 'undefined' || !window.localStorage) return 'supabase'
  const storedMode = window.localStorage.getItem(DATABASE_MODE_STORAGE_KEY)
  if (storedMode === 'hybrid') return 'hybrid'
  return storedMode === 'indexeddb' ? 'indexeddb' : 'supabase'
}

export function writeDatabaseModePreference(mode: DatabaseMode): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(DATABASE_MODE_STORAGE_KEY, mode)
}
