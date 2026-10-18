export type DatabaseMode = 'indexeddb' | 'supabase' | 'hybrid'

const DATABASE_MODE_STORAGE_KEY = 'travel-planner-database-mode'

export function readDatabaseModePreference(): DatabaseMode {
  if (typeof window === 'undefined' || !window.localStorage) return 'hybrid'
  const storedMode = window.localStorage.getItem(DATABASE_MODE_STORAGE_KEY)
  if (storedMode === 'hybrid' || storedMode === 'indexeddb' || storedMode === 'supabase') return storedMode
  return 'hybrid'
}

export function writeDatabaseModePreference(mode: DatabaseMode): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(DATABASE_MODE_STORAGE_KEY, mode)
}
