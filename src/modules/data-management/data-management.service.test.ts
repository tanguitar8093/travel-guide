import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataManagementCloudAdapter } from './data-management.cloud-adapter'

const repositories = vi.hoisted(() => ({
  mode: 'supabase' as 'supabase' | 'indexeddb' | 'hybrid',
  local: { exportAll: vi.fn(), replaceAll: vi.fn(), clearAllData: vi.fn() },
}))

const cloudAdapter = vi.hoisted(() => ({
  previewReplace: vi.fn(),
  applyReplace: vi.fn(),
  previewClearAllData: vi.fn(),
  applyClearAllData: vi.fn(),
  previewLocalToCloudTransfer: vi.fn(),
  transferLocalToCloud: vi.fn(),
  transferCloudToLocal: vi.fn(),
}))

vi.mock('../../database', async () => {
  return {
    getDatabaseMode: () => repositories.mode,
    setDatabaseMode: vi.fn(),
    indexedBackupRepository: repositories.local,
    backupRepository: {
      replaceAll: (value: unknown) => repositories.local.replaceAll(value),
      clearAllData: () => repositories.local.clearAllData(),
    },
  }
})

import { DataManagementService } from './data-management.service'

beforeEach(() => { vi.clearAllMocks(); repositories.mode = 'supabase' })

function createService() {
  return new DataManagementService(cloudAdapter as unknown as DataManagementCloudAdapter)
}

describe('safe data management', () => {
  it('blocks cloud transfer and replacement in hybrid before any API call', async () => {
    repositories.mode = 'hybrid'
    const service = createService()
    await expect(service.previewLocalToSupabaseTransfer()).rejects.toThrow('尚未開放')
    await expect(service.transferSupabaseToLocal()).rejects.toThrow('尚未開放')
    await expect(service.applySupabaseClearAllData('token')).rejects.toThrow('尚未開放')
    expect(cloudAdapter.previewLocalToCloudTransfer).not.toHaveBeenCalled()
    expect(cloudAdapter.transferCloudToLocal).not.toHaveBeenCalled()
    expect(cloudAdapter.applyClearAllData).not.toHaveBeenCalled()
  })
  it('restores local-to-cloud transfer with preview token flow', async () => {
    const backup = { data: 'local-backup' }
    cloudAdapter.previewLocalToCloudTransfer.mockResolvedValue({
      backup,
      preview: {
        token: 'token-1',
        current: { regions: 1, places: 1, labels: 1, trips: 1, itineraryItems: 1 },
        incoming: { regions: 2, places: 2, labels: 2, trips: 2, itineraryItems: 2 },
      },
    })
    cloudAdapter.transferLocalToCloud.mockResolvedValue({
      regions: 2,
      places: 2,
      labels: 2,
      trips: 2,
      itineraryItems: 2,
    })

    const service = createService()
    const prepared = await service.previewLocalToSupabaseTransfer()
    expect(prepared.backup).toEqual(backup)
    expect(prepared.preview.token).toBe('token-1')
    const counts = await service.transferLocalToSupabase(backup as never, prepared.preview.token)

    expect(cloudAdapter.previewLocalToCloudTransfer).toHaveBeenCalledOnce()
    expect(cloudAdapter.transferLocalToCloud).toHaveBeenCalledWith(backup, 'token-1')
    expect(counts).toEqual({
      regions: 2,
      places: 2,
      labels: 2,
      trips: 2,
      itineraryItems: 2,
    })
  })

  it('retains cloud-to-local transfer', async () => {
    cloudAdapter.transferCloudToLocal.mockResolvedValue({ trips: 1 })
    await expect(createService().transferSupabaseToLocal()).resolves.toEqual({ trips: 1 })
    expect(cloudAdapter.transferCloudToLocal).toHaveBeenCalledOnce()
    expect(repositories.local.replaceAll).not.toHaveBeenCalled()
  })

  it('supports cloud clear with preview token flow', async () => {
    cloudAdapter.previewClearAllData.mockResolvedValue({
      token: 'token-clear',
      current: { regions: 3, places: 3, labels: 3, trips: 3, itineraryItems: 3 },
      incoming: { regions: 0, places: 0, labels: 0, trips: 0, itineraryItems: 0 },
    })
    cloudAdapter.applyClearAllData.mockResolvedValue({
      regions: 3,
      places: 3,
      labels: 3,
      trips: 3,
      itineraryItems: 3,
    })

    const service = createService()
    const preview = await service.previewSupabaseClearAllData()
    const counts = await service.applySupabaseClearAllData(preview.token)

    expect(cloudAdapter.previewClearAllData).toHaveBeenCalledOnce()
    expect(cloudAdapter.applyClearAllData).toHaveBeenCalledWith('token-clear')
    expect(counts).toEqual({
      regions: 3,
      places: 3,
      labels: 3,
      trips: 3,
      itineraryItems: 3,
    })
  })

  it('retains local clear', async () => {
    repositories.local.clearAllData.mockResolvedValue(undefined)
    await createService().clearAllData()
    expect(repositories.local.clearAllData).toHaveBeenCalledOnce()
    expect(cloudAdapter.applyClearAllData).not.toHaveBeenCalled()
  })

  it('supports cloud replace preview and apply', async () => {
    const backup = { data: 'replace' }
    cloudAdapter.previewReplace.mockResolvedValue({
      token: 'token-1',
      current: { regions: 1, places: 1, labels: 1, trips: 1, itineraryItems: 1 },
      incoming: { regions: 2, places: 2, labels: 2, trips: 2, itineraryItems: 2 },
    })
    cloudAdapter.applyReplace.mockResolvedValue({
      regions: 2,
      places: 2,
      labels: 2,
      trips: 2,
      itineraryItems: 2,
    })

    const service = createService()
    const preview = await service.previewSupabaseReplace(backup as never)
    const counts = await service.applySupabaseReplace(backup as never, preview.token)

    expect(cloudAdapter.previewReplace).toHaveBeenCalledWith(backup)
    expect(cloudAdapter.applyReplace).toHaveBeenCalledWith(backup, 'token-1')
    expect(counts).toEqual({
      regions: 2,
      places: 2,
      labels: 2,
      trips: 2,
      itineraryItems: 2,
    })
  })

})
