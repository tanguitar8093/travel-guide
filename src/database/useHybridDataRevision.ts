import { useDatabaseMode } from './useDatabaseMode'
import { useHybridStatus } from './useHybridStatus'

export function useHybridDataRevision(): number {
  const mode = useDatabaseMode()
  const status = useHybridStatus()
  return mode === 'hybrid' ? status.dataRevision ?? 0 : 0
}
