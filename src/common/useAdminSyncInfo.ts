import { useCallback, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/useAuth'
import type { AuthStatus, UserRole } from '../auth/auth-context'

const preferenceEvent = 'travel-planner-admin-sync-info-change'
export const adminSyncInfoEnabled = import.meta.env.VITE_ADMIN_SYNC_INFO_ENABLED !== 'false'

export function canConfigureSyncInfo(status: AuthStatus, role: UserRole | null, hasWorkspaceAccess: boolean): boolean {
  return adminSyncInfoEnabled && status === 'authenticated' && role === 'admin' && hasWorkspaceAccess
}

export function adminSyncInfoKey(userId: string): string {
  return `travel-planner-admin-sync-info:${new URL(import.meta.env.VITE_SUPABASE_URL ?? window.location.origin).origin}:${userId}`
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('storage', listener)
  window.addEventListener(preferenceEvent, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(preferenceEvent, listener)
  }
}

export function useAdminSyncInfo() {
  const { status, userRole, hasWorkspaceAccess, user } = useAuth()
  const canConfigure = canConfigureSyncInfo(status, userRole, hasWorkspaceAccess) && Boolean(user)
  const key = canConfigure && user ? adminSyncInfoKey(user.id) : undefined
  const getSnapshot = useCallback(() => {
    if (!key) return null
    try {
      return window.localStorage.getItem(key)
    } catch (cause) {
      return `error:${cause instanceof Error ? cause.message : '無法讀取顯示設定。'}`
    }
  }, [key])
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => null)
  const error = stored?.startsWith('error:') ? stored.slice(6) : undefined

  function setVisible(visible: boolean) {
    if (!canConfigure || !key) throw new Error('只有管理員可設定同步資訊顯示。')
    window.localStorage.setItem(key, String(visible))
    window.dispatchEvent(new Event(preferenceEvent))
  }

  return { canConfigure, visible: canConfigure && stored === 'true', setVisible, error }
}
