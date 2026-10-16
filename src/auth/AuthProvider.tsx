import { useEffect, useState, type ReactNode } from 'react'
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

  useEffect(() => {
    let active = true

    async function applySession(nextSession: AuthContextValue['session']) {
      if (!active) return

      setSession(nextSession)
      if (!nextSession) {
        setUserRole(null)
        setHasWorkspaceAccess(false)
        setStatus('unauthenticated')
        return
      }

      setStatus('loading')
      const { role, error } = await fetchUserRole(nextSession.user.id)

      if (!active) return

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
      setHasWorkspaceAccess(role === 'member' || role === 'admin')
      setStatus('authenticated')
    }

    void fetchCurrentSession().then(({ session: currentSession, error }) => {
      if (!active) return
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
      unsubscribe()
    }
  }, [])

  function clearLocalAuthState() {
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