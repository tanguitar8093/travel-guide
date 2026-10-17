import { useSyncExternalStore } from 'react'
import { getHybridStatus, subscribeHybridStatus } from './hybrid.runtime'

export function useHybridStatus() {
  return useSyncExternalStore(subscribeHybridStatus, getHybridStatus, getHybridStatus)
}
