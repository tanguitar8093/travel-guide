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

  it('defaults to hybrid without writing a preference when nothing is stored', async () => {
    const preference = await import('./database-mode-preference')

    expect(preference.readDatabaseModePreference()).toBe('hybrid')
    expect(window.localStorage.getItem('travel-planner-database-mode')).toBeNull()
  })

  it.each(['indexeddb', 'supabase', 'hybrid'] as const)('preserves the saved %s preference after reloading', async (mode) => {
    const preference = await import('./database-mode-preference')
    preference.writeDatabaseModePreference(mode)

    vi.resetModules()
    const restored = await import('./database-mode-preference')
    expect(restored.readDatabaseModePreference()).toBe(mode)
    expect(window.localStorage.getItem('travel-planner-database-mode')).toBe(mode)
  })

  it('defaults to hybrid for an invalid stored mode without overwriting storage', async () => {
    window.localStorage.setItem('travel-planner-database-mode', 'invalid')
    const preference = await import('./database-mode-preference')

    expect(preference.readDatabaseModePreference()).toBe('hybrid')
    expect(window.localStorage.getItem('travel-planner-database-mode')).toBe('invalid')
  })

  it('defaults to hybrid when browser storage is unavailable', async () => {
    vi.stubGlobal('window', undefined)
    const preference = await import('./database-mode-preference')

    expect(preference.readDatabaseModePreference()).toBe('hybrid')
  })

  it('reads and writes indexeddb preference', async () => {
    const preference = await import('./database-mode-preference')

    preference.writeDatabaseModePreference('indexeddb')

    expect(window.localStorage.getItem('travel-planner-database-mode')).toBe('indexeddb')
    expect(preference.readDatabaseModePreference()).toBe('indexeddb')
  })

  it('defaults sync mode to auto without writing a preference and persists the choice', async () => {
    expect(readSyncModePreference()).toBe('auto')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBeNull()

    writeSyncModePreference('auto')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe('auto')
    expect(readSyncModePreference()).toBe('auto')

    writeSyncModePreference('manual')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe('manual')
    expect(readSyncModePreference()).toBe('manual')
  })

  it.each(['manual', 'auto'] as const)('restores saved %s sync mode after reloading', async (mode) => {
    writeSyncModePreference(mode)
    vi.resetModules()
    const restored = await import('./sync-mode-preference')

    expect(restored.readSyncModePreference()).toBe(mode)
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe(mode)
  })
})
