import { expect, it, vi } from 'vitest'
import { adminSyncInfoKey, canConfigureSyncInfo } from './useAdminSyncInfo'

it('allows only authenticated admins with workspace access', () => {
  expect(canConfigureSyncInfo('authenticated', 'admin', true)).toBe(true)
  expect(canConfigureSyncInfo('loading', 'admin', true)).toBe(false)
  expect(canConfigureSyncInfo('unauthenticated', 'admin', true)).toBe(false)
  expect(canConfigureSyncInfo('authenticated', 'admin', false)).toBe(false)
  for (const role of ['member', 'basic', null] as const) {
    expect(canConfigureSyncInfo('authenticated', role, true)).toBe(false)
  }
})

it('isolates display preferences by account', () => {
  vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
  try {
    expect(adminSyncInfoKey('admin-a')).not.toBe(adminSyncInfoKey('admin-b'))
    expect(adminSyncInfoKey('admin-a')).not.toBe('travel-planner-sync-mode')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('denies access when the feature is disabled', async () => {
  vi.stubEnv('VITE_ADMIN_SYNC_INFO_ENABLED', 'false')
  vi.resetModules()
  try {
    const disabled = await import('./useAdminSyncInfo')
    expect(disabled.canConfigureSyncInfo('authenticated', 'admin', true)).toBe(false)
  } finally {
    vi.unstubAllEnvs()
    vi.resetModules()
  }
})
