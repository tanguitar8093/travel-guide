import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('database runtime', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('window', {
      localStorage: createLocalStorageMock(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to supabase when no mode is stored', async () => {
    const runtime = await import('./runtime')

    expect(runtime.getDatabaseMode()).toBe('supabase')
    expect(runtime.getDatabaseModeLabel()).toBe('Supabase (雲端)')
  })

  it('stores and notifies when the mode changes', async () => {
    window.localStorage.setItem('travel-planner-database-mode', 'indexeddb')
    const runtime = await import('./runtime')
    const listener = vi.fn()
    const unsubscribe = runtime.subscribeDatabaseMode(listener)

    expect(runtime.setDatabaseMode('supabase')).toBe('supabase')
    expect(runtime.getDatabaseMode()).toBe('supabase')
    expect(runtime.getDatabaseModeLabel()).toBe('Supabase (雲端)')
    expect(listener).toHaveBeenCalledWith('supabase')
    expect(window.localStorage.getItem('travel-planner-database-mode')).toBe('supabase')

    unsubscribe()
  })

  it('exposes auto sync as an enabled mode', async () => {
    const runtime = await import('./runtime')

    expect(runtime.getSyncMode()).toBe('manual')
    expect(runtime.getSyncModeLabel()).toBe('手動同步')
    expect(runtime.setSyncMode('auto')).toBe('auto')
    expect(runtime.getSyncMode()).toBe('auto')
    expect(runtime.getSyncModeLabel()).toBe('自動同步')
  })
})
