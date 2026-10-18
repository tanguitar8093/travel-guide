export type SyncMode = 'manual' | 'auto'

const SYNC_MODE_STORAGE_KEY = 'travel-planner-sync-mode'

export function readSyncModePreference(): SyncMode {
  if (typeof window === 'undefined' || !window.localStorage) return 'auto'
  const storedMode = window.localStorage.getItem(SYNC_MODE_STORAGE_KEY)
  if (storedMode === 'manual' || storedMode === 'auto') return storedMode
  return 'auto'
}

export function writeSyncModePreference(mode: SyncMode): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(SYNC_MODE_STORAGE_KEY, mode)
}
