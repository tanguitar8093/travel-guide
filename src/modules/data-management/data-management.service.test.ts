import { beforeEach, describe, expect, it, vi } from 'vitest'

const repositories = vi.hoisted(() => ({
  mode: 'supabase' as 'supabase' | 'indexeddb',
  local: { exportAll: vi.fn(), replaceAll: vi.fn(), clearAllData: vi.fn() },
  cloud: { exportAll: vi.fn(), replaceAll: vi.fn(), clearAllData: vi.fn() },
}))

vi.mock('../../database', async () => {
  const { ValidationError } = await import('../../database/errors')
  return {
    ValidationError,
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
  it('blocks local-to-cloud before reading or overwriting either database', async () => {
    await expect(new DataManagementService().transferLocalToSupabase()).rejects.toThrow('暫停使用')
    expect(repositories.local.exportAll).not.toHaveBeenCalled()
    expect(repositories.cloud.replaceAll).not.toHaveBeenCalled()
  })

  it('retains cloud-to-local transfer', async () => {
    const backup = { data: 'readable cloud data' }
    repositories.cloud.exportAll.mockResolvedValue(backup)
    repositories.local.replaceAll.mockResolvedValue({ trips: 1 })
    await expect(new DataManagementService().transferSupabaseToLocal()).resolves.toEqual({ trips: 1 })
    expect(repositories.local.replaceAll).toHaveBeenCalledWith(backup)
    expect(repositories.cloud.replaceAll).not.toHaveBeenCalled()
  })

  it('retains local clear', async () => {
    repositories.mode = 'indexeddb'
    await new DataManagementService().clearAllData()
    expect(repositories.local.clearAllData).toHaveBeenCalledOnce()
    expect(repositories.cloud.clearAllData).not.toHaveBeenCalled()
  })
})
