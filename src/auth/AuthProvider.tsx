import { useEffect, useRef, useState, type ReactNode } from 'react'
import { activateHybridAccount, deactivateHybridAccount } from '../database/hybrid.runtime'
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

  useEffect(() => {
    let active = true

    async function applySession(nextSession: AuthContextValue['session']) {
      if (!active) return
      const generation = ++sessionGeneration.current
      deactivateHybridAccount()

      setSession(nextSession)
      if (!nextSession) {
        setUserRole(null)
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
        setHasWorkspaceAccess(false)
        setStatus('authenticated')
        return
      }

      if (!role) {
        setErrorMessage('無法讀取使用者權限，請稍後再試。')
        setUserRole(null)
        setHasWorkspaceAccess(false)
        setStatus('authenticated')
        return
      }

      setUserRole(role)
      if (import.meta.env.DEV && (role === 'member' || role === 'admin')) {
        try {
          await activateHybridAccount({
            projectId: new URL(import.meta.env.VITE_SUPABASE_URL ?? '').origin,
            userId: nextSession.user.id,
          }, role)
        } catch {
          if (active && generation === sessionGeneration.current) setErrorMessage('本地混合模式準備失敗；仍可使用原有模式。')
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

    const unsubscribe = subscribeSessionChange((nextSession) => {
      setErrorMessage(null)
      void applySession(nextSession)
    })

    return () => {
      active = false
      sessionGeneration.current += 1
      deactivateHybridAccount()
      unsubscribe()
    }
  }, [])

  function clearLocalAuthState() {
    sessionGeneration.current += 1
    deactivateHybridAccount()
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
