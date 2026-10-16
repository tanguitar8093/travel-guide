import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  AuthContext,
  type AuthStatus,
} from './auth-context'
import {
  supabase,
  supabaseAuthCodeVerifierKey,
  supabaseAuthStorageKey,
} from '../database/supabase.client'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    function applySession(nextSession: Session | null) {
      if (!active) return
      setSession(nextSession)
      setStatus(nextSession ? 'authenticated' : 'unauthenticated')
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setErrorMessage('無法讀取登入狀態，請重新整理頁面。')
        setSession(null)
        setStatus('unauthenticated')
        return
      }
      setErrorMessage(null)
      applySession(data.session ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setErrorMessage(null)
      applySession(nextSession)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  function clearLocalAuthState() {
    setSession(null)
    setStatus('unauthenticated')
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
        errorMessage,
        signInWithPassword,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}