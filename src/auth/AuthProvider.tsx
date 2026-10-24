import { setDatasetPreferenceAccount } from '../geo/account-dataset-preference'
import { isGooglePopupPending } from './google-popup'
import { hasPendingLoginWelcome, requestLoginWelcome, clearLoginWelcome } from './login-welcome'
import { adminSyncInfoKey, canConfigureSyncInfo } from '../common/useAdminSyncInfo'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { setPublicCatalogAccount } from '../modules/public-itinerary/catalog-runtime'
import { activateHybridAccount, deactivateHybridAccount } from '../database/hybrid.runtime'
import { setDatabaseModeRole } from '../database/mode-access'
import { getDatabaseMode } from '../database/runtime'
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
  signInWithGoogle as signInWithGoogleGateway,
  signOutLocally,
  signUpWithPassword as signUpWithPasswordGateway,
  subscribeSessionChange,
} from './auth.gateway'

const configuredEmailRedirectTo = import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_TO?.trim()

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loginWelcomeRequired, setLoginWelcomeRequired] = useState(hasPendingLoginWelcome)
  const [session, setSession] = useState<AuthContextValue['session']>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [userRole, setUserRole] = useState<AuthContextValue['userRole']>(null)
  const [hasWorkspaceAccess, setHasWorkspaceAccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const sessionGeneration = useRef(0)
  const applySessionRef = useRef<((session: AuthContextValue['session']) => Promise<void>) | null>(null)
  const currentUserId = useRef<string | null>(null)
  const currentUserRole = useRef<AuthContextValue['userRole']>(null)

  useEffect(() => {
    let active = true
    let initialRoleReadPending = false

    async function applySession(nextSession: AuthContextValue['session']) {
      if (!active) return
      const generation = ++sessionGeneration.current
      deactivateHybridAccount()
      setPublicCatalogAccount(null)
      setDatabaseModeRole(null)

      setSession(nextSession)
      if (currentUserId.current !== nextSession?.user.id) {
        currentUserRole.current = null
      }
      currentUserId.current = nextSession?.user.id ?? null
      const datasetReady = setDatasetPreferenceAccount(nextSession?.user.id ?? null)
      if (!nextSession) {
        setUserRole(null)
        currentUserRole.current = null
        setHasWorkspaceAccess(false)
        setStatus('unauthenticated')
        return
      }

      setStatus('loading')
      initialRoleReadPending = true
      const [{ role, error }] = await Promise.all([fetchUserRole(nextSession.user.id), datasetReady])

      if (!active || generation !== sessionGeneration.current) return
      initialRoleReadPending = false

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
          }, role, { checkCloudOnLogin: getDatabaseMode() === 'hybrid' })
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
      setPublicCatalogAccount(nextSession.user.id)
      setHasWorkspaceAccess(role === 'member' || role === 'admin')
      setStatus('authenticated')
    }

    applySessionRef.current = applySession

    const initialGeneration = sessionGeneration.current
    void fetchCurrentSession().then(({ session: currentSession, error }) => {
      if (!active || initialGeneration !== sessionGeneration.current) return
      if (error) {
        setErrorMessage(error.message || '無法讀取登入狀態，請重新整理頁面。')
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
      if (nextSession && isGooglePopupPending()) return
      setErrorMessage(null)
      if (nextSession && event === 'SIGNED_IN' && !currentUserId.current) {
        requestLoginWelcome()
        setLoginWelcomeRequired(true)
      }
      if (
        nextSession &&
        currentUserId.current === nextSession.user.id &&
        (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')
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
            if (!initialRoleReadPending && role !== currentUserRole.current) {
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
      applySessionRef.current = null
      sessionGeneration.current += 1
      deactivateHybridAccount()
      void setDatasetPreferenceAccount(null)
      setPublicCatalogAccount(null)
      setDatabaseModeRole(null)
      unsubscribe()
    }
  }, [])

  function completeLoginWelcome() {
    clearLoginWelcome()
    setLoginWelcomeRequired(false)
  }

  function clearLocalAuthState() {
    completeLoginWelcome()
    sessionGeneration.current += 1
    deactivateHybridAccount()
    void setDatasetPreferenceAccount(null)
    setPublicCatalogAccount(null)
    setDatabaseModeRole(null)
    currentUserId.current = null
    currentUserRole.current = null
    setSession(null)
    setStatus('unauthenticated')
    setUserRole(null)
    setHasWorkspaceAccess(false)
    setErrorMessage(null)
    clearLocalAuthStorage()
  }

  async function signInWithGoogle(): Promise<void> {
    setErrorMessage(null)
    requestLoginWelcome()
    const { session: nextSession, error } = await signInWithGoogleGateway(window.location.origin)
    if (error) {
      clearLoginWelcome()
      setErrorMessage(error.message)
      throw error
    }
    setLoginWelcomeRequired(true)
    void applySessionRef.current?.(nextSession)
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
    if (!canConfigureSyncInfo(status, userRole, hasWorkspaceAccess) || !session?.user ||
      window.localStorage.getItem(adminSyncInfoKey(session.user.id)) !== 'true') {
      throw new Error('只有開啟管理員資訊顯示的管理員可以建立帳號。')
    }
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
        loginWelcomeRequired,
        completeLoginWelcome,
        session,
        user: session?.user ?? null,
        userRole,
        hasWorkspaceAccess,
        errorMessage,
        signInWithGoogle,
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
