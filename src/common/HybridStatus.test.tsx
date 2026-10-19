import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  visible: false,
  mode: 'hybrid',
  status: {
    ready: true,
    summary: {
      pendingCount: 2, failedCount: 0, conflictCount: 0, personalConflictCount: 0,
      sharedConflictCount: 0, lastSyncedAt: '2026-10-18T10:00:00Z',
    },
    lastOperationMs: 12,
    error: undefined as string | undefined,
  },
}))
vi.mock('../database/useDatabaseMode', () => ({ useDatabaseMode: () => state.mode }))
vi.mock('../database/useSyncMode', () => ({ useSyncMode: () => 'auto' }))
vi.mock('../database/useHybridStatus', () => ({ useHybridStatus: () => state.status }))
vi.mock('./useAdminSyncInfo', () => ({ useAdminSyncInfo: () => ({ visible: state.visible }) }))

import { HybridStatus } from './HybridStatus'

beforeEach(() => {
  state.visible = false
  state.mode = 'hybrid'
  state.status.error = undefined
  state.status.summary.conflictCount = 0
  state.status.summary.personalConflictCount = 0
  state.status.summary.sharedConflictCount = 0
})

it('hides diagnostic information when visibility is denied', () => {
  expect(renderToStaticMarkup(<HybridStatus />)).toBe('')
})

it('shows diagnostic information only when visibility is allowed', () => {
  state.visible = true
  const html = renderToStaticMarkup(<HybridStatus />)
  expect(html).toContain('待同步 2 筆操作')
  expect(html).toContain('12.0 ms')
  expect(html).toContain('變更將自動同步至雲端')
})

it('preserves actionable errors without exposing diagnostic details', () => {
  state.status.error = 'internal diagnostic message'
  const html = renderToStaticMarkup(<HybridStatus />)
  expect(html).toContain('role="alert"')
  expect(html).toContain('前往資料管理處理同步問題')
  expect(html).not.toContain('internal diagnostic message')
  expect(html).not.toContain('12.0 ms')
  expect(html).not.toContain('待同步 2')
})

it('preserves conflict notifications even when diagnostics are hidden', () => {
  state.status.summary.conflictCount = 1
  state.status.summary.personalConflictCount = 1
  expect(renderToStaticMarkup(<HybridStatus />)).toContain('資料同步發生衝突')
})

it('routes shared-only conflicts to the itinerary without claiming private sync is blocked', () => {
  state.status.summary.conflictCount = 2
  state.status.summary.sharedConflictCount = 2
  const html = renderToStaticMarkup(<HybridStatus />)
  expect(html).toContain('共享行程有待處理衝突')
  expect(html).toContain('其餘私人資料仍可同步')
  expect(html).toContain('href="/itinerary"')
  expect(html).not.toContain('href="/data"')
  expect(html).not.toContain('資料同步發生衝突')
})

it('shows both recovery destinations without promising private progress when personal sync is blocked', () => {
  state.status.summary.conflictCount = 2
  state.status.summary.sharedConflictCount = 1
  state.status.summary.personalConflictCount = 1
  const html = renderToStaticMarkup(<HybridStatus />)
  expect(html).toContain('href="/data"')
  expect(html).toContain('href="/itinerary"')
  expect(html).not.toContain('其餘私人資料仍可同步')
})

it('shows separate conflict counts in diagnostics and retains network-error warnings', () => {
  state.visible = true
  state.status.summary.conflictCount = 2
  state.status.summary.sharedConflictCount = 2
  state.status.error = 'offline'
  const html = renderToStaticMarkup(<HybridStatus />)
  expect(html).toContain('個人 0 筆、共享 2 筆')
  expect(html).toContain('offline')
  expect(html).toContain('前往資料管理重試同步')
  expect(html).not.toContain('其餘私人資料仍可同步')
})

it('never shows hybrid information in other database modes', () => {
  state.visible = true
  state.mode = 'supabase'
  expect(renderToStaticMarkup(<HybridStatus />)).toBe('')
})
