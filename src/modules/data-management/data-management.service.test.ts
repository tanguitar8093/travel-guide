import { beforeEach, describe, expect, it, vi } from 'vitest'

const repositories = vi.hoisted(() => ({
  mode: 'supabase' as 'supabase' | 'indexeddb',
  local: { exportAll: vi.fn(), replaceAll: vi.fn(), clearAllData: vi.fn() },
  cloud: {
    exportAll: vi.fn(),
    replaceAll: vi.fn(),
    clearAllData: vi.fn(),
    previewReplaceAll: vi.fn(),
    previewClearAllData: vi.fn(),
  },
}))

vi.mock('../../database', async () => {
  return {
    getDatabaseMode: () => repositories.mode,
    setDatabaseMode: vi.fn(),
    indexedBackupRepository: repositories.local,
    supabaseBackupRepository: repositories.cloud,
    backupRepository: {
      replaceAll: (value: unknown) => repositories.mode === 'supabase' ? repositories.cloud.replaceAll(value) : repositories.local.replaceAll(value),
      clearAllData: () => repositories.mode === 'supabase' ? repositories.cloud.clearAllData() : repositories.local.clearAllData(),
    },
  }
})

import { DataManagementService } from './data-management.service'

beforeEach(() => { vi.clearAllMocks(); repositories.mode = 'supabase' })

describe('safe data management', () => {
  it('restores local-to-cloud transfer with preview token flow', async () => {
    const backup = { data: 'local-backup' }
    repositories.local.exportAll.mockResolvedValue(backup)
    repositories.cloud.previewReplaceAll.mockResolvedValue({
      token: 'token-1',
      current: { regions: 1, places: 1, labels: 1, trips: 1, itineraryItems: 1 },
      incoming: { regions: 2, places: 2, labels: 2, trips: 2, itineraryItems: 2 },
    })
    repositories.cloud.replaceAll.mockResolvedValue({
      regions: 2,
      places: 2,
      labels: 2,
      trips: 2,
      itineraryItems: 2,
    })

    const service = new DataManagementService()
    const prepared = await service.previewLocalToSupabaseTransfer()
    expect(prepared.backup).toEqual(backup)
    expect(prepared.preview.token).toBe('token-1')
    const counts = await service.transferLocalToSupabase(backup as never, prepared.preview.token)

    expect(repositories.local.exportAll).toHaveBeenCalledOnce()
    expect(repositories.cloud.previewReplaceAll).toHaveBeenCalledWith(backup)
    expect(repositories.cloud.replaceAll).toHaveBeenCalledWith(backup, 'token-1')
    expect(counts).toEqual({
      regions: 2,
      places: 2,
      labels: 2,
      trips: 2,
      itineraryItems: 2,
    })
  })

  it('retains cloud-to-local transfer', async () => {
    const backup = { data: 'readable cloud data' }
    repositories.cloud.exportAll.mockResolvedValue(backup)
    repositories.local.replaceAll.mockResolvedValue({ trips: 1 })
    await expect(new DataManagementService().transferSupabaseToLocal()).resolves.toEqual({ trips: 1 })
    expect(repositories.local.replaceAll).toHaveBeenCalledWith(backup)
    expect(repositories.cloud.replaceAll).not.toHaveBeenCalled()
  })

  it('supports cloud clear with preview token flow', async () => {
    repositories.cloud.previewClearAllData.mockResolvedValue({
      token: 'token-clear',
      current: { regions: 3, places: 3, labels: 3, trips: 3, itineraryItems: 3 },
      incoming: { regions: 0, places: 0, labels: 0, trips: 0, itineraryItems: 0 },
    })
    repositories.cloud.clearAllData.mockResolvedValue({
      regions: 3,
      places: 3,
      labels: 3,
      trips: 3,
      itineraryItems: 3,
    })

    const service = new DataManagementService()
    const preview = await service.previewSupabaseClearAllData()
    const counts = await service.applySupabaseClearAllData(preview.token)

    expect(repositories.cloud.previewClearAllData).toHaveBeenCalledOnce()
    expect(repositories.cloud.clearAllData).toHaveBeenCalledWith('token-clear')
    expect(counts).toEqual({
      regions: 3,
      places: 3,
      labels: 3,
      trips: 3,
      itineraryItems: 3,
    })
  })

  it('retains local clear', async () => {
    repositories.mode = 'indexeddb'
    await new DataManagementService().clearAllData()
    expect(repositories.local.clearAllData).toHaveBeenCalledOnce()
    expect(repositories.cloud.clearAllData).not.toHaveBeenCalled()
  })
})
