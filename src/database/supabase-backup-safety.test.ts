import { describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({ from: vi.fn(), auth: { getUser: vi.fn() } }))
vi.mock('./supabase.client', () => ({ supabase: cloud }))
import { SupabaseBackupRepository } from './supabase.repositories'

describe('cloud bulk-write safety', () => {
  it('rejects direct overwrite and clear without issuing any API calls', async () => {
    const repository = new SupabaseBackupRepository()
    await expect(repository.replaceAll({})).rejects.toThrow('暫停使用')
    await expect(repository.clearAllData()).rejects.toThrow('暫停使用')
    expect(cloud.from).not.toHaveBeenCalled()
    expect(cloud.auth.getUser).not.toHaveBeenCalled()
  })
})
