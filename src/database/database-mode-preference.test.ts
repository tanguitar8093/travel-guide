import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readSyncModePreference, writeSyncModePreference } from './sync-mode-preference'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
}

describe('database mode preference', () => {
  it('restores hybrid in development and production', async () => {
    const preference = await import('./database-mode-preference')
    preference.writeDatabaseModePreference('hybrid')
    vi.stubEnv('DEV', true)
    expect(preference.readDatabaseModePreference()).toBe('hybrid')
    vi.stubEnv('DEV', false)
    expect(preference.readDatabaseModePreference()).toBe('hybrid')
    vi.unstubAllEnvs()
  })
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('window', {
      localStorage: createLocalStorageMock(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to supabase when nothing is stored', async () => {
    const preference = await import('./database-mode-preference')

    expect(preference.readDatabaseModePreference()).toBe('supabase')
  })

  it('reads and writes indexeddb preference', async () => {
    const preference = await import('./database-mode-preference')

    preference.writeDatabaseModePreference('indexeddb')

    expect(window.localStorage.getItem('travel-planner-database-mode')).toBe('indexeddb')
    expect(preference.readDatabaseModePreference()).toBe('indexeddb')
  })

  it('defaults sync mode to manual and persists the choice', async () => {
    expect(readSyncModePreference()).toBe('manual')

    writeSyncModePreference('auto')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe('auto')
    expect(readSyncModePreference()).toBe('auto')

    writeSyncModePreference('manual')
    expect(readSyncModePreference()).toBe('manual')
  })
})
