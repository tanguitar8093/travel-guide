import type { Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({
  mode: 'indexeddb',
  onModeChange: (() => {}) as () => void,
  onSessionChange: ((_session: Session | null) => {}) as (session: Session | null) => void,
  unsubscribeMode: vi.fn(),
  unsubscribeAccount: vi.fn(),
  fetchSession: vi.fn(),
  store: {} as object,
}))

vi.mock('../database/runtime', () => ({
  getDatabaseMode: () => context.mode,
  subscribeDatabaseMode: (listener: () => void) => {
    context.onModeChange = listener
    return context.unsubscribeMode
  },
}))
vi.mock('../database/hybrid.runtime', () => ({ requireHybridStore: () => context.store }))
vi.mock('../auth/auth.gateway', () => ({
  fetchCurrentSession: context.fetchSession,
  subscribeSessionChange: (listener: (session: Session | null) => void) => {
    context.onSessionChange = listener
    return context.unsubscribeAccount
  },
}))

import { bulkDelete } from './bulk-delete'

const session = (id: string) => ({ user: { id } }) as Session
const records = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }]
const options = () => ({
  ids: ['a', 'b', 'c'], entity: '地點' as const,
  load: vi.fn().mockResolvedValue(records),
  deleteOne: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
})

beforeEach(() => {
  vi.resetAllMocks()
  context.mode = 'indexeddb'
  context.store = {}
  context.fetchSession.mockResolvedValue({ session: session('user-1'), error: null })
})

describe('sequential best-effort bulk delete', () => {
  it('does nothing for an empty selection', async () => {
    const input = { ...options(), ids: [] }
    expect(await bulkDelete(input)).toEqual({ deletedIds: [], failures: [] })
    expect(input.load).not.toHaveBeenCalled()
    expect(input.deleteOne).not.toHaveBeenCalled()
    expect(context.fetchSession).not.toHaveBeenCalled()
  })

  it('waits for each deletion, deduplicates IDs and retains completed successes', async () => {
    const input = options()
    input.ids = ['a', 'b', 'a', 'c']
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => { started = resolve })
    input.deleteOne.mockImplementationOnce(() => { started(); return first })
    input.deleteOne.mockRejectedValueOnce(new Error('網路中斷'))
    const pending = bulkDelete(input)
    await firstStarted
    expect(input.deleteOne.mock.calls).toEqual([['a']])
    release()

    expect(await pending).toEqual({
      deletedIds: ['a', 'c'],
      failures: [{ id: 'b', name: '乙', message: '地點「乙」刪除失敗：網路中斷' }],
    })
    expect(input.deleteOne.mock.calls).toEqual([['a'], ['b'], ['c']])
    expect(context.unsubscribeMode).toHaveBeenCalledOnce()
  })

  it('uses readable fallback messages for unknown thrown values', async () => {
    const input = options()
    input.deleteOne.mockRejectedValueOnce(null).mockRejectedValueOnce('權限不足')
    const result = await bulkDelete(input)
    expect(result.deletedIds).toEqual(['c'])
    expect(result.failures.map((failure) => failure.message)).toEqual([
      '地點「甲」刪除失敗：發生未知錯誤，請稍後重試。', '地點「乙」刪除失敗：權限不足',
    ])
  })

  it('reports list-loading failures per unique ID without attempting deletion', async () => {
    const input = options()
    input.ids = ['a', 'a', 'b']
    input.load.mockRejectedValue(new Error('讀取失敗'))
    const result = await bulkDelete(input)
    expect(result.deletedIds).toEqual([])
    expect(result.failures).toEqual([
      { id: 'a', name: 'a', message: '地點「a」刪除失敗：讀取失敗' },
      { id: 'b', name: 'b', message: '地點「b」刪除失敗：讀取失敗' },
    ])
    expect(input.deleteOne).not.toHaveBeenCalled()
    expect(context.unsubscribeMode).toHaveBeenCalledOnce()
  })

  it('stops after a mode changes away and back, without misreporting the completed delete', async () => {
    const input = options()
    input.deleteOne.mockImplementationOnce(async () => {
      context.mode = 'supabase'
      context.onModeChange()
      context.mode = 'indexeddb'
      context.onModeChange()
    })
    const result = await bulkDelete(input)
    expect(result.deletedIds).toEqual(['a'])
    expect(result.failures.map((failure) => failure.id)).toEqual(['b', 'c'])
    expect(result.failures[0].message).toContain('已停止後續刪除')
    expect(input.deleteOne).toHaveBeenCalledOnce()
  })

  it('stops before deleting if mode changes during list loading', async () => {
    const input = options()
    input.load.mockImplementation(async () => {
      context.mode = 'supabase'
      context.onModeChange()
      return records
    })
    const result = await bulkDelete(input)
    expect(result.failures.map((failure) => failure.name)).toEqual(['甲', '乙', '丙'])
    expect(input.deleteOne).not.toHaveBeenCalled()
  })

  it.each(['switch', 'signout', 'switch-back'])('stops later cloud deletes on account %s', async (change) => {
    context.mode = 'supabase'
    const input = options()
    input.deleteOne.mockImplementationOnce(async () => {
      context.onSessionChange(change === 'signout' ? null : session('user-2'))
      if (change === 'switch-back') context.onSessionChange(session('user-1'))
    })
    const result = await bulkDelete(input)
    expect(result.deletedIds).toEqual(['a'])
    expect(result.failures.map((failure) => failure.id)).toEqual(['b', 'c'])
    expect(input.deleteOne).toHaveBeenCalledOnce()
    expect(context.unsubscribeAccount).toHaveBeenCalledOnce()
  })

  it('does not treat same-user token refresh as an account change', async () => {
    context.mode = 'supabase'
    const input = options()
    input.deleteOne.mockImplementation(async () => { context.onSessionChange(session('user-1')) })
    expect(await bulkDelete(input)).toEqual({ deletedIds: ['a', 'b', 'c'], failures: [] })
    expect(context.unsubscribeAccount).toHaveBeenCalledOnce()
  })

  it('detects account changes while capturing the initial session', async () => {
    context.mode = 'supabase'
    context.fetchSession.mockImplementation(async () => {
      context.onSessionChange(session('user-2'))
      return { session: session('user-1'), error: null }
    })
    const input = options()
    expect((await bulkDelete(input)).failures).toHaveLength(3)
    expect(input.load).not.toHaveBeenCalled()
    expect(input.deleteOne).not.toHaveBeenCalled()
  })

  it('fails closed when no cloud session is available and releases subscriptions', async () => {
    context.mode = 'supabase'
    context.fetchSession.mockResolvedValue({ session: null, error: null })
    const input = options()
    expect((await bulkDelete(input)).failures[0].message).toContain('尚未登入')
    expect(input.deleteOne).not.toHaveBeenCalled()
    expect(context.unsubscribeAccount).toHaveBeenCalledOnce()
    expect(context.unsubscribeMode).toHaveBeenCalledOnce()
  })

  it('stops later hybrid deletes when the public active store changes', async () => {
    context.mode = 'hybrid'
    const input = options()
    input.deleteOne.mockImplementationOnce(async () => { context.store = {} })
    const result = await bulkDelete(input)
    expect(result.deletedIds).toEqual(['a'])
    expect(result.failures.map((failure) => failure.id)).toEqual(['b', 'c'])
    expect(input.deleteOne).toHaveBeenCalledOnce()
  })
})