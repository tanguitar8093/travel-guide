import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
}))
vi.mock('./supabase.client', () => ({ supabase: cloud }))
import { SupabaseBackupRepository } from './supabase.repositories'

beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cloud bulk-write safety', () => {
  it('requires preview token before apply operations', async () => {
    const repository = new SupabaseBackupRepository()
    await expect(repository.replaceAll({})).rejects.toThrow('先完成預覽')
    await expect(repository.clearAllData()).rejects.toThrow('先完成預覽')
    expect(cloud.from).not.toHaveBeenCalled()
    expect(cloud.auth.getUser).not.toHaveBeenCalled()
    expect(cloud.rpc).not.toHaveBeenCalled()
  })

  it('routes preview and apply calls through RPC endpoints', async () => {
    const repository = new SupabaseBackupRepository()

    cloud.rpc
      .mockResolvedValueOnce({
        data: {
          token: 'preview-token',
          current: { regions: 1, places: 1, labels: 1, trips: 1, itineraryItems: 1 },
          incoming: { regions: 2, places: 2, labels: 2, trips: 2, itineraryItems: 2 },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { regions: 2, places: 2, labels: 2, trips: 2, itineraryItems: 2 },
        error: null,
      })

    const backup = {
      format: 'travel-planner-backup' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      data: {
        regions: [],
        places: [],
        labels: [],
        trips: [],
        itineraryItems: [],
      },
    }

    const preview = await repository.previewReplaceAll(backup)
    const counts = await repository.replaceAll(backup, preview.token)

    expect(cloud.rpc).toHaveBeenNthCalledWith(1, 'app_backup_preview_replace', {
      p_backup: backup,
    })
    expect(cloud.rpc).toHaveBeenNthCalledWith(2, 'app_backup_apply_replace', {
      p_backup: backup,
      p_token: 'preview-token',
    })
    expect(counts).toEqual({ regions: 2, places: 2, labels: 2, trips: 2, itineraryItems: 2 })
  })
})
