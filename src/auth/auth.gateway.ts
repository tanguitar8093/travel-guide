import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import {
  supabase,
  supabaseAuthCodeVerifierKey,
  supabaseAuthStorageKey,
} from '../database/supabase.client'
import type { UserRole } from './auth-context'

function normalizeRole(role: unknown): UserRole {
  if (role === 'admin' || role === 'member') {
    return role
  }
  return 'basic'
}

export async function fetchCurrentSession(): Promise<{ session: Session | null; error: Error | null }> {
  const { data, error } = await supabase.auth.getSession()
  return {
    session: data.session ?? null,
    error: error ?? null,
  }
}

export function subscribeSessionChange(
  onChange: (session: Session | null, event: AuthChangeEvent) => void,
): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, nextSession) => {
    onChange(nextSession, event)
  })

  return () => {
    subscription.unsubscribe()
  }
}

export async function fetchUserRole(userId: string): Promise<{ role: UserRole | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return { role: null, error }
  }

  return {
    role: normalizeRole(data?.role),
    error: null,
  }
}

export async function signInWithPassword(email: string, password: string): Promise<Error | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error ?? null
}

export async function signUpWithPassword(
  email: string,
  password: string,
  emailRedirectTo: string,
): Promise<{ requiresEmailConfirmation: boolean; error: Error | null }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
    },
  })

  return {
    requiresEmailConfirmation: data?.session === null,
    error: error ?? null,
  }
}

export function clearLocalAuthStorage(): void {
  const storageKeys = [supabaseAuthStorageKey, supabaseAuthCodeVerifierKey]
  for (const storageKey of storageKeys) {
    window.localStorage.removeItem(storageKey)
    window.sessionStorage.removeItem(storageKey)
  }
}

export async function signOutLocally(): Promise<Error | null> {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  return error ?? null
}
