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
  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('window', {
      localStorage: createLocalStorageMock(),
    })
    const access = await import('./mode-access')
    access.setDatabaseModeRole('admin')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to hybrid when no mode is stored', async () => {
    const runtime = await import('./runtime')

    expect(runtime.getDatabaseMode()).toBe('hybrid')
    expect(runtime.getDatabaseModeLabel()).toBe('混合模式（本機優先）')
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

  it('defaults to auto sync and remembers explicit manual and auto choices', async () => {
    const runtime = await import('./runtime')

    expect(runtime.getSyncMode()).toBe('auto')
    expect(runtime.getSyncModeLabel()).toBe('自動同步')
    expect(runtime.setSyncMode('manual')).toBe('manual')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe('manual')
    expect(runtime.getSyncModeLabel()).toBe('手動同步')
    expect(runtime.setSyncMode('auto')).toBe('auto')
    expect(runtime.getSyncMode()).toBe('auto')
    expect(runtime.getSyncModeLabel()).toBe('自動同步')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe('auto')
  })

  it('locks members to hybrid and auto without overwriting admin debug preferences', async () => {
    window.localStorage.setItem('travel-planner-database-mode', 'supabase')
    window.localStorage.setItem('travel-planner-sync-mode', 'manual')
    const runtime = await import('./runtime')
    const access = await import('./mode-access')
    const onMode = vi.fn()
    const onSync = vi.fn()
    const unsubscribeMode = runtime.subscribeDatabaseMode(onMode)
    const unsubscribeSync = runtime.subscribeSyncMode(onSync)

    access.setDatabaseModeRole('member')
    expect(runtime.getDatabaseMode()).toBe('hybrid')
    expect(runtime.getSyncMode()).toBe('auto')
    expect(access.readEffectiveSyncMode()).toBe('auto')
    expect(onMode).toHaveBeenLastCalledWith('hybrid')
    expect(onSync).toHaveBeenLastCalledWith('auto')
    expect(() => runtime.setDatabaseMode('supabase')).toThrow('只有管理員')
    expect(() => runtime.setSyncMode('manual')).toThrow('只有管理員')
    expect(window.localStorage.getItem('travel-planner-database-mode')).toBe('supabase')
    expect(window.localStorage.getItem('travel-planner-sync-mode')).toBe('manual')

    access.setDatabaseModeRole('admin')
    expect(runtime.getDatabaseMode()).toBe('supabase')
    expect(runtime.getSyncMode()).toBe('manual')
    expect(access.readEffectiveSyncMode()).toBe('manual')
    expect(onMode).toHaveBeenLastCalledWith('supabase')
    expect(onSync).toHaveBeenLastCalledWith('manual')
    expect(onMode).toHaveBeenCalledTimes(2)
    expect(onSync).toHaveBeenCalledTimes(2)
    unsubscribeMode()
    unsubscribeSync()
    access.setDatabaseModeRole('member')
    expect(onMode).toHaveBeenCalledTimes(2)
    expect(onSync).toHaveBeenCalledTimes(2)
  })

  it.each([null, 'basic'] as const)('does not permit mode overrides with role %s', async (role) => {
    const runtime = await import('./runtime')
    const access = await import('./mode-access')
    access.setDatabaseModeRole(role)
    expect(runtime.getDatabaseMode()).toBe('hybrid')
    expect(runtime.getSyncMode()).toBe('auto')
    expect(() => runtime.setDatabaseMode('indexeddb')).toThrow('只有管理員')
    expect(() => runtime.setSyncMode('manual')).toThrow('只有管理員')
  })
})
