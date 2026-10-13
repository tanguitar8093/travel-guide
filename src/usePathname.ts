import { useSyncExternalStore } from 'react'

function subscribeToLocation(callback: () => void): () => void {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

function getPathname(): string {
  return window.location.pathname
}

export function usePathname(): string {
  return useSyncExternalStore(subscribeToLocation, getPathname, () => '/')
}
