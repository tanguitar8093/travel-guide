import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AuthContext,
  type AuthStatus,
  type UserRole,
} from './auth-context'
import {
  supabase,
  supabaseAuthCodeVerifierKey,
  supabaseAuthStorageKey,
} from '../database/supabase.client'

const configuredEmailRedirectTo = import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_TO?.trim()

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [hasWorkspaceAccess, setHasWorkspaceAccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    function normalizeRole(role: unknown): UserRole {
      if (role === 'admin' || role === 'member') {
        return role
      }
      return 'basic'
    }

    async function applySession(nextSession: Session | null) {
      if (!active) return

      setSession(nextSession)
      if (!nextSession) {
        setUserRole(null)
        setHasWorkspaceAccess(false)
        setStatus('unauthenticated')
        return
      }

      setStatus('loading')
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', nextSession.user.id)
        .maybeSingle()

      if (!active) return

      if (error) {
        setErrorMessage('無法讀取使用者權限，請稍後再試。')
        setUserRole(null)
        setHasWorkspaceAccess(false)
        setStatus('authenticated')
        return
      }

      const role = normalizeRole(data?.role)
      setUserRole(role)
      setHasWorkspaceAccess(role === 'member' || role === 'admin')
      setStatus('authenticated')
    }

    void supabase.auth.getSession().then(({ data, error }) => {
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
      void applySession(data.session ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setErrorMessage(null)
      void applySession(nextSession)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  function clearLocalAuthState() {
    setSession(null)
    setStatus('unauthenticated')
    setUserRole(null)
    setHasWorkspaceAccess(false)
    setErrorMessage(null)

    const storageKeys = [supabaseAuthStorageKey, supabaseAuthCodeVerifierKey]
    for (const storageKey of storageKeys) {
      window.localStorage.removeItem(storageKey)
      window.sessionStorage.removeItem(storageKey)
    }
  }

  async function signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
      },
    })
    if (error) {
      setErrorMessage(error.message)
      throw error
    }

    setErrorMessage(null)

    return {
      requiresEmailConfirmation: data.session === null,
    }
  }

  async function signOut(): Promise<void> {
    clearLocalAuthState()

    void supabase.auth.signOut({ scope: 'local' }).catch((error: Error) => {
      setErrorMessage(error.message)
    })
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