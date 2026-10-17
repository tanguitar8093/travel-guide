import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncDatabase } from './sync.database'
import { hybridBackend } from './hybrid.backend'
import {
  activateHybridAccount, deactivateHybridAccount, getHybridStatus, requireHybridStore,
} from './hybrid.runtime'

describe('hybrid development backend', () => {
  const accounts: { projectId: string; userId: string }[] = []

  beforeEach(() => {
    vi.stubEnv('DEV', true)
    accounts.length = 0
  })

  afterEach(async () => {
    deactivateHybridAccount()
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

  it('rejects basic accounts and disables hybrid in production', async () => {
    await expect(login('basic', 'basic')).rejects.toThrow('沒有混合模式權限')
    vi.stubEnv('DEV', false)
    await activateHybridAccount({ projectId: 'unused', userId: 'unused' }, 'member')
    expect(getHybridStatus().ready).toBe(false)
    expect(() => requireHybridStore()).toThrow('尚未準備好')
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
    expect(facade.getDatabaseMode()).toBe('supabase')
    facade.setDatabaseMode('hybrid')
    const id = await facade.regions.create({ name: 'Facade local', zoom: 12, googlePlaceId: 'facade' })
    await facade.regions.update(id, { name: 'Updated' })
    expect((await facade.regions.list())[0].name).toBe('Updated')
    await facade.regions.delete(id)
    expect(network).not.toHaveBeenCalled()
    expect(await requireHybridStore().listTasks()).toHaveLength(3)
    facade.setDatabaseMode('supabase')
  })
})
