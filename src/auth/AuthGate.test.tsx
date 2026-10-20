import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthGate } from './AuthGate'
import type { AuthContextValue } from './auth-context'

const mockAuth = vi.hoisted(() => ({
  value: {
    status: 'unauthenticated',
    session: null,
    user: null,
    userRole: null,
    hasWorkspaceAccess: false,
    errorMessage: null,
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
    expect(html).toContain('class="auth-guide"')
    expect(html).toContain('class="auth-guide-flag"')
    expect(html).not.toContain('<h1>正在確認登入狀態</h1>')
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
