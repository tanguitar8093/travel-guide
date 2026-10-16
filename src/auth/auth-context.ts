import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  errorMessage: string | null
  signInWithPassword(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  clearError(): void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)