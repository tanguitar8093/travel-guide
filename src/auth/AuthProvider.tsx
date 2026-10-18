import { useEffect, useRef, useState, type ReactNode } from 'react'
import { activateHybridAccount, deactivateHybridAccount } from '../database/hybrid.runtime'
import { setDatabaseModeRole } from '../database/mode-access'
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from './auth-context'
import {
  clearLocalAuthStorage,
  fetchCurrentSession,
  fetchUserRole,
  signInWithPassword as signInWithPasswordGateway,
  signOutLocally,
  signUpWithPassword as signUpWithPasswordGateway,
  subscribeSessionChange,
} from './auth.gateway'

const configuredEmailRedirectTo = import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_TO?.trim()

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<AuthContextValue['session']>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [userRole, setUserRole] = useState<AuthContextValue['userRole']>(null)
  const [hasWorkspaceAccess, setHasWorkspaceAccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const sessionGeneration = useRef(0)
  const currentUserId = useRef<string | null>(null)
  const currentUserRole = useRef<AuthContextValue['userRole']>(null)

  useEffect(() => {
    let active = true

    async function applySession(nextSession: AuthContextValue['session']) {
      if (!active) return
      const generation = ++sessionGeneration.current
      deactivateHybridAccount()
      setDatabaseModeRole(null)

      setSession(nextSession)
      if (currentUserId.current !== nextSession?.user.id) {
        currentUserRole.current = null
      }
      currentUserId.current = nextSession?.user.id ?? null
      if (!nextSession) {
        setUserRole(null)
        currentUserRole.current = null
        setHasWorkspaceAccess(false)
        setStatus('unauthenticated')
        return
      }

      setStatus('loading')
      const { role, error } = await fetchUserRole(nextSession.user.id)

      if (!active || generation !== sessionGeneration.current) return

      if (error) {
        setErrorMessage('無法讀取使用者權限，請稍後再試。')
        setUserRole(null)
        currentUserRole.current = null
        setHasWorkspaceAccess(false)
        setStatus('authenticated')
        return
      }

      if (!role) {
        setErrorMessage('無法讀取使用者權限，請稍後再試。')
        setUserRole(null)
        currentUserRole.current = null
        setHasWorkspaceAccess(false)
        setStatus('authenticated')
        return
      }

      setUserRole(role)
      currentUserRole.current = role
      setDatabaseModeRole(role)
      if (role === 'member' || role === 'admin') {
        try {
          await activateHybridAccount({
            projectId: new URL(import.meta.env.VITE_SUPABASE_URL ?? '').origin,
            userId: nextSession.user.id,
          }, role)
        } catch {
          if (active && generation === sessionGeneration.current) {
            setErrorMessage(role === 'admin' ? '本地混合模式準備失敗；仍可使用原有模式。' : '混合模式準備失敗，請重新登入或重新整理後再試。')
            if (role !== 'admin') {
              setHasWorkspaceAccess(false)
              setStatus('authenticated')
              return
            }
          }
        }
      }
      if (!active || generation !== sessionGeneration.current) return
      setHasWorkspaceAccess(role === 'member' || role === 'admin')
      setStatus('authenticated')
    }

    const initialGeneration = sessionGeneration.current
    void fetchCurrentSession().then(({ session: currentSession, error }) => {
      if (!active || initialGeneration !== sessionGeneration.current) return
      if (error) {
        setErrorMessage('無法讀取登入狀態，請重新整理頁面。')
        setSession(null)
        setUserRole(null)
        setHasWorkspaceAccess(false)
        setStatus('unauthenticated')
        return
      }
      setErrorMessage(null)
      void applySession(currentSession)
    })

    const unsubscribe = subscribeSessionChange((nextSession, event) => {
      setErrorMessage(null)
      if (
        nextSession &&
        currentUserId.current === nextSession.user.id &&
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')
      ) {
        setSession(nextSession)
        if (event === 'SIGNED_IN') {
          const generation = sessionGeneration.current
          void fetchUserRole(nextSession.user.id).then(({ role, error }) => {
            if (
              !active ||
              generation !== sessionGeneration.current ||
              currentUserId.current !== nextSession.user.id
            ) {
              return
            }
            if (error || !role) {
              setErrorMessage('無法重新確認使用者權限，請稍後再試。')
              return
            }
            if (role !== currentUserRole.current) {
              void applySession(nextSession)
            }
          })
        }
        return
      }
      void applySession(nextSession)
    })

    return () => {
      active = false
      sessionGeneration.current += 1
      deactivateHybridAccount()
      setDatabaseModeRole(null)
      unsubscribe()
    }
  }, [])

  function clearLocalAuthState() {
    sessionGeneration.current += 1
    deactivateHybridAccount()
    setDatabaseModeRole(null)
    setSession(null)
    setStatus('unauthenticated')
    setUserRole(null)
    setHasWorkspaceAccess(false)
    setErrorMessage(null)
    clearLocalAuthStorage()
  }

  async function signInWithPassword(email: string, password: string): Promise<void> {
    const error = await signInWithPasswordGateway(email, password)
    if (error) {
      setErrorMessage(error.message)
      throw error
    }
    setErrorMessage(null)
  }

  async function signUpWithPassword(
    email: string,
    password: string,
  ): Promise<{ requiresEmailConfirmation: boolean }> {
    const emailRedirectTo = configuredEmailRedirectTo || window.location.origin
    const { requiresEmailConfirmation, error } = await signUpWithPasswordGateway(
      email,
      password,
      emailRedirectTo,
    )
    if (error) {
      setErrorMessage(error.message)
      throw error
    }

    setErrorMessage(null)

    return {
      requiresEmailConfirmation,
    }
  }

  async function signOut(): Promise<void> {
    clearLocalAuthState()

    const error = await signOutLocally()
    if (error) {
      setErrorMessage(error.message)
    }
  }

  function clearError() {
    setErrorMessage(null)
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
        user: session?.user ?? null,
        userRole,
        hasWorkspaceAccess,
        errorMessage,
        signInWithPassword,
        signUpWithPassword,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
