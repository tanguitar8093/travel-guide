import { expect, it, vi } from 'vitest'
import { adminLayoutDebugKey, canConfigureLayoutDebug } from './useAdminLayoutDebug'
import { adminSyncInfoKey } from './useAdminSyncInfo'

it('allows only authenticated admins with workspace access to configure layout debug', () => {
  expect(canConfigureLayoutDebug('authenticated', 'admin', true)).toBe(true)
  expect(canConfigureLayoutDebug('loading', 'admin', true)).toBe(false)
  expect(canConfigureLayoutDebug('unauthenticated', 'admin', true)).toBe(false)
  expect(canConfigureLayoutDebug('authenticated', 'admin', false)).toBe(false)
  for (const role of ['member', 'basic', null] as const) {
    expect(canConfigureLayoutDebug('authenticated', role, true)).toBe(false)
  }
})

it('isolates layout debug preferences by account and from sync info preferences', () => {
  vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
  try {
    expect(adminLayoutDebugKey('admin-a')).not.toBe(adminLayoutDebugKey('admin-b'))
    expect(adminLayoutDebugKey('admin-a')).not.toBe(adminSyncInfoKey('admin-a'))
  } finally {
    vi.unstubAllGlobals()
  }
})

it('isolates layout debug preferences by Supabase project', () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project-a.example.test')
  try {
    const firstKey = adminLayoutDebugKey('admin-a')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project-b.example.test')
    expect(adminLayoutDebugKey('admin-a')).not.toBe(firstKey)
  } finally {
    vi.unstubAllEnvs()
  }
})
