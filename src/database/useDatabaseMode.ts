import { useSyncExternalStore } from 'react'

import { getDatabaseMode, subscribeDatabaseMode } from './runtime'
import type { DatabaseMode } from './runtime'

export function useDatabaseMode(): DatabaseMode {
  return useSyncExternalStore(subscribeDatabaseMode, getDatabaseMode, () => 'supabase')
}
