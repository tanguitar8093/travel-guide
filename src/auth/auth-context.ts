import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'
export type UserRole = 'basic' | 'member' | 'admin'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  userRole: UserRole | null
  hasWorkspaceAccess: boolean
  errorMessage: string | null
  signInWithPassword(email: string, password: string): Promise<void>
  signUpWithPassword(email: string, password: string): Promise<{ requiresEmailConfirmation: boolean }>
  signOut(): Promise<void>
  clearError(): void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)