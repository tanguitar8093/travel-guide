export type SyncMode = 'manual' | 'auto'

const SYNC_MODE_STORAGE_KEY = 'travel-planner-sync-mode'

export function readSyncModePreference(): SyncMode {
  const storedMode = window.localStorage.getItem(SYNC_MODE_STORAGE_KEY)
  if (storedMode === 'auto') return 'auto'
  return 'manual'
}

export function writeSyncModePreference(mode: SyncMode): void {
  window.localStorage.setItem(SYNC_MODE_STORAGE_KEY, mode)
}
