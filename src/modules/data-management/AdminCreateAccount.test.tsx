import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { AdminCreateAccount } from './AdminCreateAccount'
const state = vi.hoisted(() => ({ visible: false }))
vi.mock('../../common/useAdminSyncInfo', () => ({ useAdminSyncInfo: () => state }))
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ signUpWithPassword: vi.fn() }) }))

it('only renders account creation when the admin information gate is visible', () => {
  state.visible = false
  expect(renderToStaticMarkup(<AdminCreateAccount />)).toBe('')
  state.visible = true
  const html = renderToStaticMarkup(<AdminCreateAccount />)
  expect(html).toContain('建立帳號')
  expect(html).toContain('確認密碼')
})
