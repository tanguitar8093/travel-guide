import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ visible: false }))
vi.mock('./useAdminSyncInfo', () => ({ useAdminSyncInfo: () => ({ visible: state.visible }) }))
vi.mock('../database/useDatabaseMode', () => ({ useDatabaseMode: () => 'hybrid' }))
vi.mock('../database/runtime', () => ({ getDatabaseModeLabel: () => '混合模式（本機優先）' }))

import { WorkspaceInfoBar } from './WorkspaceInfoBar'

it.each(['區域', '地點', '標籤', '行程', '資料'])('removes the entire %s row without leaving a wrapper', (section) => {
  state.visible = false
  expect(renderToStaticMarkup(<WorkspaceInfoBar section={section} />)).toBe('')
})

it.each(['區域', '地點', '標籤', '行程', '資料'])('renders the same shared structure for %s when allowed', (section) => {
  state.visible = true
  const html = renderToStaticMarkup(<WorkspaceInfoBar section={section} />)
  expect(html).toContain('class="workspace-info-bar"')
  expect(html).toContain('工作區')
  expect(html).toContain(`<strong>${section}</strong>`)
  expect(html).toContain('混合模式（本機優先）')
})
