import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncDatabase } from './sync.database'
import { hybridBackend } from './hybrid.backend'
import {
  activateHybridAccount, deactivateHybridAccount, getHybridStatus, requireHybridStore,
} from './hybrid.runtime'
import { setSyncMode } from './runtime'
import * as syncEngine from './sync-engine'
import { setDatabaseModeRole } from './mode-access'

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

describe('hybrid development backend', () => {
  const accounts: { projectId: string; userId: string }[] = []

  beforeEach(() => {
    setDatabaseModeRole('admin')
    const noOpListener = () => {}
    vi.stubGlobal('window', {
      localStorage: createLocalStorageMock(),
      addEventListener: noOpListener,
      removeEventListener: noOpListener,
    })
    Object.defineProperty(globalThis, 'document', {
      value: {
        visibilityState: 'visible',
        addEventListener: noOpListener,
        removeEventListener: noOpListener,
      },
      configurable: true,
      writable: true,
    })
    vi.stubEnv('DEV', true)
    accounts.length = 0
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.clearAllTimers()
    deactivateHybridAccount()
    setDatabaseModeRole(null)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    for (const account of accounts) await new SyncDatabase(account).delete()
  })

  async function login(userId = 'member-a', role = 'member') {
    const account = { projectId: accounts[0]?.projectId ?? crypto.randomUUID(), userId }
    accounts.push(account)
    await activateHybridAccount(account, role)
    return account
  }

  it('waits for the login cloud check before exposing the local workspace', async () => {
    setSyncMode('manual')
    window.localStorage.setItem('travel-planner-sync-mode', 'manual')
    const account = { projectId: crypto.randomUUID(), userId: 'login-check' }
    accounts.push(account)
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })
    const check = vi.spyOn(syncEngine, 'checkHybridOnLogin').mockReturnValue(pending)
    try {
      const activation = activateHybridAccount(account, 'member', { checkCloudOnLogin: true })
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1))
      expect(getHybridStatus().ready).toBe(false)
      expect(() => requireHybridStore()).toThrow('尚未準備好')
      release()
      await activation
      expect(getHybridStatus().ready).toBe(true)
    } finally {
      release()
      check.mockRestore()
    }
  })

  it('reports a failed login check while preserving access to local recovery tools', async () => {
    setSyncMode('manual')
    window.localStorage.setItem('travel-planner-sync-mode', 'manual')
    const account = { projectId: crypto.randomUUID(), userId: 'login-offline' }
    accounts.push(account)
    const check = vi.spyOn(syncEngine, 'checkHybridOnLogin').mockRejectedValue(new Error('offline'))
    try {
      await activateHybridAccount(account, 'member', { checkCloudOnLogin: true })
      expect(getHybridStatus()).toMatchObject({ ready: true, error: 'offline' })
      expect(requireHybridStore()).toBeDefined()
    } finally {
      check.mockRestore()
    }
  })

  it('syncs immediately at login and waits for updated local records before returning', async () => {
    const account = { projectId: crypto.randomUUID(), userId: 'fresh-login' }
    accounts.push(account)
    window.localStorage.setItem('travel-planner-sync-mode', 'auto')
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })
    const sync = vi.spyOn(syncEngine, 'syncHybridManually').mockImplementation(async (store) => {
      await pending
      await store.syncTransaction(async (database) => {
        await database.regions.put({ id: crypto.randomUUID(), name: 'Cloud latest', zoom: 12, googlePlaceId: 'kyoto' })
      })
    })
    try {
      let returned = false
      const activation = activateHybridAccount(account, 'member', { checkCloudOnLogin: true })
        .then(() => { returned = true })
      await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce())
      expect(returned).toBe(false)
      expect(getHybridStatus().syncing).toBe(true)
      release()
      await activation
      expect((await hybridBackend.regions.list())[0].name).toBe('Cloud latest')
      expect(getHybridStatus()).toMatchObject({ syncing: false, dataRevision: 1 })
    } finally {
      release()
      sync.mockRestore()
    }
  })

  it('releases login at exactly three seconds and finishes the same sync in the background', async () => {
    const account = { projectId: crypto.randomUUID(), userId: 'slow-login' }
    accounts.push(account)
    window.localStorage.setItem('travel-planner-sync-mode', 'auto')
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })
    let started: () => void = () => {}
    const syncStarted = new Promise<void>((resolve) => { started = resolve })
    const sync = vi.spyOn(syncEngine, 'syncHybridManually').mockImplementation(() => {
      started()
      return pending
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let returned = false
      const activation = activateHybridAccount(account, 'member', { checkCloudOnLogin: true })
        .then(() => { returned = true })
      await syncStarted
      expect(sync).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(2999)
      expect(returned).toBe(false)
      expect(getHybridStatus().startupSyncTimedOut).not.toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      await activation
      expect(getHybridStatus()).toMatchObject({ ready: true, syncing: true, startupSyncTimedOut: true })
      expect(requireHybridStore()).toBeDefined()
      release()
      await vi.waitFor(() => expect(getHybridStatus().syncing).toBe(false))
      expect(getHybridStatus().startupSyncTimedOut).toBe(false)
      expect(getHybridStatus().dataRevision).toBe(1)
      expect(sync).toHaveBeenCalledOnce()
    } finally {
      release()
      sync.mockRestore()
    }
  })

  it('reports startup sync failure without blocking local access', async () => {
    const account = { projectId: crypto.randomUUID(), userId: 'auto-offline' }
    accounts.push(account)
    window.localStorage.setItem('travel-planner-sync-mode', 'auto')
    const sync = vi.spyOn(syncEngine, 'syncHybridManually').mockRejectedValue(new Error('offline'))
    try {
      await activateHybridAccount(account, 'member', { checkCloudOnLogin: true })
      expect(getHybridStatus()).toMatchObject({ ready: true, syncing: false, error: 'offline' })
      expect(requireHybridStore()).toBeDefined()
    } finally {
      sync.mockRestore()
    }
  })

  it('does not publish an old login sync into a different account', async () => {
    const account = { projectId: crypto.randomUUID(), userId: 'old-login' }
    accounts.push(account)
    window.localStorage.setItem('travel-planner-sync-mode', 'auto')
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })
    const sync = vi.spyOn(syncEngine, 'syncHybridManually').mockReturnValue(pending)
    try {
      const activation = activateHybridAccount(account, 'member', { checkCloudOnLogin: true })
      await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce())
      await login('new-login')
      release()
      await activation
      expect(getHybridStatus().dataRevision).toBeUndefined()
      expect(getHybridStatus().error).toBeUndefined()
    } finally {
      release()
      sync.mockRestore()
    }
  })

  it('routes domain CRUD and backup reads through local repositories and records tasks', async () => {
    await login()
    const regionId = await hybridBackend.regions.create({ name: 'Region', zoom: 12, googlePlaceId: 'region' })
    const labelId = await hybridBackend.labels.create({ name: 'Food', color: '#ff0000' })
    const placeId = await hybridBackend.places.create({ name: 'Cafe', regionIds: [regionId], labelIds: [labelId], googlePlaceId: 'cafe' })
    const tripId = await hybridBackend.trips.create({ name: 'Trip', regionId, startDate: '2026-10-17', endDate: '2026-10-18' })
    const itemId = await hybridBackend.itineraryItems.create({ tripId, placeId, date: '2026-10-17', order: 0 })
    await hybridBackend.itineraryItems.update(itemId, { note: 'Local edit' })
    const backup = await hybridBackend.backupRepository.exportAll()
    expect(backup.data.itineraryItems[0].note).toBe('Local edit')
    expect(await requireHybridStore().listTasks()).toHaveLength(6)
    expect(getHybridStatus().lastOperationMs).toBeGreaterThanOrEqual(0)
    await hybridBackend.trips.delete(tripId)
    expect(await hybridBackend.itineraryItems.findByTripId(tripId)).toEqual([])
  })

  it('separates accounts and retains local data after sign-out and reactivation', async () => {
    const account = await login()
    await hybridBackend.regions.create({ name: 'A only', zoom: 12, googlePlaceId: 'a' })
    await login('member-b')
    expect(await hybridBackend.regions.list()).toEqual([])
    deactivateHybridAccount()
    expect(() => requireHybridStore()).toThrow('尚未準備好')
    await activateHybridAccount(account, 'member')
    expect((await hybridBackend.regions.list())[0].name).toBe('A only')
    expect(await requireHybridStore().listTasks()).toHaveLength(1)
  })

  it('rejects basic accounts but allows members in production', async () => {
    await expect(login('basic', 'basic')).rejects.toThrow('沒有混合模式權限')
    vi.stubEnv('DEV', false)
    await activateHybridAccount({ projectId: 'unused', userId: 'unused' }, 'member')
    expect(getHybridStatus().ready).toBe(true)
    expect(requireHybridStore()).toBeDefined()
    deactivateHybridAccount()
    await new SyncDatabase({ projectId: 'unused', userId: 'unused' }).delete()
  })

  it('rejects destructive backup APIs', async () => {
    await login()
    await expect(hybridBackend.backupRepository.replaceAll()).rejects.toThrow('暫不支援')
    await expect(hybridBackend.backupRepository.clearAllData()).rejects.toThrow('暫不支援')
  })

  it('publishes queue counts as local mutations commit', async () => {
    await login()
    await hybridBackend.regions.create({ name: 'Local', zoom: 12, googlePlaceId: 'local' })
    await vi.waitFor(() => expect(getHybridStatus().summary?.pendingCount).toBe(1))
  })

  it('uses the application facade without sending network requests for hybrid operations', async () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
    } })
    const network = vi.fn(() => { throw new Error('Unexpected cloud request') })
    vi.stubGlobal('fetch', network)
    await login()
    const facade = await import('./index')
    expect(facade.getDatabaseMode()).toBe('hybrid')
    facade.setDatabaseMode('hybrid')
    const id = await facade.regions.create({ name: 'Facade local', zoom: 12, googlePlaceId: 'facade' })
    await facade.regions.update(id, { name: 'Updated' })
    expect((await facade.regions.list())[0].name).toBe('Updated')
    await facade.regions.delete(id)
    expect(network).not.toHaveBeenCalled()
    expect(await requireHybridStore().listTasks()).toHaveLength(3)
    facade.setDatabaseMode('supabase')
  })

  it('runs auto sync after the debounce window but not in manual mode', async () => {
    const syncSpy = vi.spyOn(syncEngine, 'syncHybridManually').mockResolvedValue()

    await login()
    setSyncMode('manual')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setSyncMode('auto')

    await vi.advanceTimersByTimeAsync(1999)
    expect(syncSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(syncSpy).toHaveBeenCalledTimes(1)

    setSyncMode('manual')
    await hybridBackend.regions.create({ name: 'Manual only', zoom: 12, googlePlaceId: 'manual-1' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(syncSpy).toHaveBeenCalledTimes(1)

    syncSpy.mockRestore()
  })

  it('still pauses automatic sync when personal data has an unresolved conflict', async () => {
    const syncSpy = vi.spyOn(syncEngine, 'syncHybridManually').mockResolvedValue()
    try {
      await login()
      setSyncMode('manual')
      await hybridBackend.regions.create({ name: 'Private draft', zoom: 12, googlePlaceId: 'private' })
      const store = requireHybridStore()
      await store.syncTransaction((database) => database.outbox.toCollection().modify({ status: 'conflict' }))
      await vi.waitFor(() => expect(getHybridStatus().summary?.personalConflictCount).toBe(1))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      setSyncMode('auto')
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 2000)
      expect(syncSpy).not.toHaveBeenCalled()
      expect(getHybridStatus().error).toContain('已暫停自動同步')
    } finally {
      syncSpy.mockRestore()
    }
  })

  it('re-syncs when the tab becomes visible again in auto mode', async () => {
    const syncSpy = vi.spyOn(syncEngine, 'syncHybridManually').mockResolvedValue()
    const handlers = new Map<string, Set<() => void>>()
    const addListener = (type: string, handler: () => void) => {
      const current = handlers.get(type) ?? new Set<() => void>()
      current.add(handler)
      handlers.set(type, current)
    }
    const documentState = { visibilityState: 'hidden' }
    vi.stubGlobal('window', {
      localStorage: createLocalStorageMock(),
      addEventListener: addListener,
      removeEventListener: (type: string, handler: () => void) => handlers.get(type)?.delete(handler),
    })
    Object.defineProperty(globalThis, 'document', {
      value: {
        get visibilityState() {
          return documentState.visibilityState
        },
        set visibilityState(value: string) {
          documentState.visibilityState = value
        },
        addEventListener: addListener,
        removeEventListener: (type: string, handler: () => void) => handlers.get(type)?.delete(handler),
      },
      configurable: true,
      writable: true,
    })

    await login()
    setSyncMode('auto')
    documentState.visibilityState = 'visible'

    const visibilityHandler = [...(handlers.get('visibilitychange') ?? [])][0]
    expect(visibilityHandler).toBeDefined()
    visibilityHandler()
    await Promise.resolve()
    expect(syncSpy).toHaveBeenCalledTimes(1)
    syncSpy.mockRestore()
  })
})
