import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ visible: false }))
vi.mock('./useAdminSyncInfo', () => ({
  useAdminSyncInfo: () => ({ visible: state.visible }),
}))

import { AdminInfo } from './AdminInfo'

it('omits the entire supplied row when admin info is hidden', () => {
  state.visible = false
  const html = renderToStaticMarkup(
    <AdminInfo>
      <header>
        <span>工作區 / 地圖</span>
        <span>混合模式（本機優先）</span>
        <button title="資料儲存在混合模式">說明</button>
      </header>
    </AdminInfo>,
  )
  expect(html).toBe('')
})

it('renders mode information when the shared admin visibility policy allows it', () => {
  state.visible = true
  expect(renderToStaticMarkup(
    <AdminInfo><span>混合模式（本機優先）</span></AdminInfo>,
  )).toContain('混合模式（本機優先）')
})
