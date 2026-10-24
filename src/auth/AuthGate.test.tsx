import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthGate, AuthLoadingPanel } from './AuthGate'
import type { AuthContextValue } from './auth-context'

const mockAuth = vi.hoisted(() => ({
  value: {
    loginWelcomeRequired: false,
    completeLoginWelcome: vi.fn(),
    status: 'unauthenticated',
    session: null,
    user: null,
    userRole: null,
    hasWorkspaceAccess: false,
    errorMessage: null,
    signInWithGoogle: vi.fn(async () => {}),
    signInWithPassword: vi.fn(async () => {}),
    signUpWithPassword: vi.fn(async () => ({ requiresEmailConfirmation: true })),
    signOut: vi.fn(async () => {}),
    clearError: vi.fn(),
  } as AuthContextValue,
}))

vi.mock('./useAuth', () => ({
  useAuth: () => mockAuth.value,
}))

function renderGate(children = <div>workspace content</div>) {
  return renderToStaticMarkup(<AuthGate>{children}</AuthGate>)
}

describe('AuthGate role access control', () => {
  it('shows loading state while auth is loading', () => {
    mockAuth.value = {
      ...mockAuth.value,
      status: 'loading',
      hasWorkspaceAccess: false,
      userRole: null,
    }

    const html = renderGate()
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="正在確認登入狀態"')
    expect(html).toContain('class="tour-guide"')
    expect(html).toContain('class="tour-guide-flag"')
    expect(html).toContain('載入中')
    expect(html).toContain('class="auth-loading-dots"')
    expect(html).not.toContain('<h1>正在確認登入狀態</h1>')
  })

  it('uses the shared guide instead of the sign-in heading and introduction', () => {
    mockAuth.value = {
      ...mockAuth.value,
      status: 'unauthenticated',
      hasWorkspaceAccess: false,
      userRole: null,
    }
    const html = renderGate()
    expect(html).not.toContain('登入後才能使用資料')
    expect(html).toContain('aria-label="登入"')
    expect(html).toContain('class="tour-guide"')
    expect(html).not.toContain('若你已經有帳號，請直接登入。')
    expect(html).not.toContain('class="auth-loading-caption"')
    expect(html).not.toContain('選擇登入方式')
    expect(html).toContain('Google 登入')
    expect(html).toContain('auth-google-logo')
    expect(html).not.toContain('即將開放')
    expect(html).not.toContain('帳號登入')
    expect(html).not.toContain('建立一個新帳號')
    expect(html).not.toContain('name="email"')
    expect(html).not.toContain('name="password"')
  })

  it('renders workspace for authenticated member/admin', () => {
    mockAuth.value = {
      ...mockAuth.value,
      status: 'authenticated',
      userRole: 'member',
      hasWorkspaceAccess: true,
    }

    const html = renderGate(<div>member workspace</div>)
    expect(html).toContain('member workspace')
    expect(html).not.toContain('等待開通工作區權限')
  })

  it('blocks authenticated basic users from workspace', () => {
    mockAuth.value = {
      ...mockAuth.value,
      status: 'authenticated',
      userRole: 'basic',
      hasWorkspaceAccess: false,
    }

    const html = renderGate(<div>should not show workspace</div>)
    expect(html).toContain('等待開通工作區權限')
    expect(html).toContain('目前角色：basic')
    expect(html).not.toContain('should not show workspace')
  })
})

it('keeps a new login behind the Okinawa welcome even after authentication succeeds', () => {
  mockAuth.value = { ...mockAuth.value, status: 'authenticated', hasWorkspaceAccess: true, loginWelcomeRequired: true }
  const html = renderGate()
  expect(html).toContain('Okinawa')
  expect(html).toContain('準備出發')
  expect(html).not.toContain('workspace content')
})

it('uses the normal loading icon after the login welcome is complete', () => {
  mockAuth.value = { ...mockAuth.value, status: 'loading', loginWelcomeRequired: false }
  const html = renderGate()
  expect(html).toContain('class="tour-guide"')
  expect(html).not.toContain('Okinawa')
})

it('keeps app-module loading inside the existing panel after auth is ready', () => {
  mockAuth.value = { ...mockAuth.value, status: 'authenticated', hasWorkspaceAccess: true, loginWelcomeRequired: false }
  const html = renderToStaticMarkup(<AuthGate pending><div>workspace</div></AuthGate>)
  expect(html).toContain('auth-panel-loading')
  expect(html).toContain('class="tour-guide"')
  expect(html).not.toContain('workspace')
})

it('does not replace Google login with module loading when signed out', () => {
  mockAuth.value = { ...mockAuth.value, status: 'unauthenticated', loginWelcomeRequired: false }
  const html = renderToStaticMarkup(<AuthGate pending><div>workspace</div></AuthGate>)
  expect(html).toContain('Google 登入')
  expect(html).not.toContain('auth-panel-loading')
})

it('renders the share receiving state inside the same animated loading panel without a heading', () => {
  const html = renderToStaticMarkup(<AuthLoadingPanel message="正在接收分享" />)
  expect(html).toContain('auth-panel-loading')
  expect(html).toContain('class="tour-guide"')
  expect(html).toContain('正在接收分享')
  expect(html).not.toContain('<h1')
})
