import { useCallback, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/useAuth'
import type { AuthStatus, UserRole } from '../auth/auth-context'

const preferenceEvent = 'travel-planner-admin-layout-debug-change'

export function canConfigureLayoutDebug(status: AuthStatus, role: UserRole | null, hasWorkspaceAccess: boolean): boolean {
  return status === 'authenticated' && role === 'admin' && hasWorkspaceAccess
}

export function adminLayoutDebugKey(userId: string): string {
  return `travel-planner-admin-layout-debug:${new URL(import.meta.env.VITE_SUPABASE_URL ?? window.location.origin).origin}:${userId}`
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('storage', listener)
  window.addEventListener(preferenceEvent, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(preferenceEvent, listener)
  }
}

export function useAdminLayoutDebug() {
  const { status, userRole, hasWorkspaceAccess, user } = useAuth()
  const canConfigure = canConfigureLayoutDebug(status, userRole, hasWorkspaceAccess) && Boolean(user)
  const key = canConfigure && user ? adminLayoutDebugKey(user.id) : undefined
  const getSnapshot = useCallback(() => {
    if (!key) return null
    try {
      return window.localStorage.getItem(key)
    } catch (cause) {
      return `error:${cause instanceof Error ? cause.message : '無法讀取版型除錯設定。'}`
    }
  }, [key])
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => null)
  const error = stored?.startsWith('error:') ? stored.slice(6) : undefined

  function setEnabled(enabled: boolean) {
    if (!canConfigure || !key) throw new Error('只有管理員可設定版型除錯視窗。')
    window.localStorage.setItem(key, String(enabled))
    window.dispatchEvent(new Event(preferenceEvent))
  }

  return { canConfigure, enabled: canConfigure && stored === 'true', setEnabled, error }
}
