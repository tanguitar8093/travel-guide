import type { UserRole } from '../auth/auth-context'
import { readSyncModePreference } from './sync-mode-preference'

let role: UserRole | null = null
const listeners = new Set<() => void>()

export function canDebugDatabaseModes(): boolean {
  return role === 'admin'
}

export function setDatabaseModeRole(next: UserRole | null): void {
  if (role === next) return
  role = next
  for (const listener of listeners) listener()
}

export function subscribeDatabaseModeRole(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function readEffectiveSyncMode() {
  return canDebugDatabaseModes() ? readSyncModePreference() : 'auto'
}
