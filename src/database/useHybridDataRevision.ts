import { useSyncExternalStore } from 'react'
import { getLocalDataRevision, subscribeLocalDataRevision } from './local-data-revision'
import { useDatabaseMode } from './useDatabaseMode'
import { useHybridStatus } from './useHybridStatus'

export function useHybridDataRevision(): number {
  const mode = useDatabaseMode()
  const status = useHybridStatus()
  const local = useSyncExternalStore(subscribeLocalDataRevision, getLocalDataRevision, () => 0)
  return mode === 'supabase' ? 0 : local + (mode === 'hybrid' ? status.dataRevision ?? 0 : 0)
}
