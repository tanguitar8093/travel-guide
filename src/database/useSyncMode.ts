import { useSyncExternalStore } from 'react'

import { getSyncMode, subscribeSyncMode } from './runtime'
import type { SyncMode } from './sync-mode-preference'

export function useSyncMode(): SyncMode {
  return useSyncExternalStore(subscribeSyncMode, getSyncMode, () => 'auto')
}
