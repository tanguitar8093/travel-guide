import { createClient } from '@supabase/supabase-js'
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

async function readAuthWithin<T>(operation: PromiseLike<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 15000) }),
    ])
  } finally { clearTimeout(timer) }
}

export async function fetchCurrentSession(): Promise<{ session: Session | null; error: Error | null }> {
  try {
    const { data, error } = await readAuthWithin(supabase.auth.getSession(), '讀取登入狀態逾時，請重新整理後再試。')
    return { session: data.session ?? null, error: error ?? null }
  } catch (cause) {
    return { session: null, error: cause instanceof Error ? cause : new Error('讀取登入狀態失敗。') }
  }
}

export function subscribeSessionChange(
  onChange: (session: Session | null, event: AuthChangeEvent) => void,
): () => void {
  let active = true
  const pending = new Set<ReturnType<typeof setTimeout>>()
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    // Supabase callbacks must finish before consumers start other SDK queries.
    const timer = setTimeout(() => {
      pending.delete(timer)
      if (active) onChange(session, event)
    }, 0)
    pending.add(timer)
  })
  return () => {
    active = false
    for (const timer of pending) clearTimeout(timer)
    pending.clear()
    subscription.unsubscribe()
  }
}

export async function fetchUserRole(userId: string): Promise<{ role: UserRole | null; error: Error | null }> {
  try {
    const { data, error } = await readAuthWithin(supabase.from('user_roles').select('role').eq('user_id', userId)
      .abortSignal(AbortSignal.timeout(15000)).maybeSingle(), '讀取使用者權限逾時，請重新整理後再試。')
    if (error) return { role: null, error }
    return { role: normalizeRole(data?.role), error: null }
  } catch (cause) {
    return { role: null, error: cause instanceof Error ? cause : new Error('讀取使用者權限失敗。') }
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
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('缺少 Supabase 設定。')
  // Creating an account must never replace the signed-in administrator's session.
  const registrationClient = createClient(
    url,
    key,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
  const { data, error } = await registrationClient.auth.signUp({
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

export { signInWithGoogle } from './google-popup'
