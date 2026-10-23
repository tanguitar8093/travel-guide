import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncTask } from './sync.types'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase.client', () => ({ supabase: { rpc } }))
import { syncCloudAdapter } from './sync-cloud.adapter'

beforeEach(() => {
  rpc.mockReset()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('sync cloud adapter', () => {
  it('explains an uninstalled sync API', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing function' } })
    await expect(syncCloudAdapter.snapshot()).rejects.toThrow('尚未安裝同步 API')
  })
  it('calls snapshot and paged pull with explicit parameters', async () => {
    rpc.mockResolvedValueOnce({ data: { protocolVersion: 1, cursor: '0', records: [] }, error: null })
    expect((await syncCloudAdapter.snapshot()).cursor).toBe('0')
    rpc.mockResolvedValueOnce({ data: { protocolVersion: 1, cursor: '4', hasMore: false, changes: [] }, error: null })
    await syncCloudAdapter.pull('0', 100)
    expect(rpc).toHaveBeenLastCalledWith('app_sync_pull', { p_cursor: '0', p_limit: 100 })
  })

  it('rejects unknown baseline before sending and excludes mutable retry fields from dedup payload', async () => {
    const task: SyncTask = {
      operationId: crypto.randomUUID(), account: { projectId: 'test', userId: 'member' }, deviceId: 'device',
      protocolVersion: 1, operation: 'region.create', createdAt: new Date().toISOString(), status: 'pending', attempts: 2,
      changes: [{ entity: 'regions', id: 'region', kind: 'delete' }],
    }
    await expect(syncCloudAdapter.push(task)).rejects.toThrow('基準版本')
    expect(rpc).not.toHaveBeenCalled()
    task.changes[0].baseVersion = null
    rpc.mockResolvedValueOnce({ data: { status: 'applied', operationId: task.operationId, cursor: '1', changes: [] }, error: null })
    await syncCloudAdapter.push(task)
    expect(rpc.mock.calls[0][1].p_task).not.toHaveProperty('attempts')
  })

  it('surfaces conflicts and API errors and rejects malformed responses', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null })
    await expect(syncCloudAdapter.snapshot()).rejects.toThrow('格式')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Permission denied' } })
    await expect(syncCloudAdapter.pull('0')).rejects.toThrow('Permission denied')
  })

  it('uploads new-format changes without modifying the frozen payload', async () => {
    const task: SyncTask = {
      operationId: 'new-geo', account: { projectId: 'test', userId: 'member' }, deviceId: 'device',
      protocolVersion: 1, operation: 'place.create', createdAt: new Date().toISOString(), status: 'pending', attempts: 0,
      changes: [{
        entity: 'places', id: 'place', kind: 'put', baseVersion: null,
        after: {
          id: 'place', name: 'User', regionIds: [], labelIds: [],
          location: { source: 'user', kind: 'user-picked', coordinate: { latitude: 0, longitude: 0 } },
        },
      }],
    }
    const before = structuredClone(task)
    rpc.mockResolvedValue({ data: { status: 'applied', operationId: task.operationId, cursor: '1', changes: [] }, error: null })
    await syncCloudAdapter.push(task)
    expect(task).toEqual(before)
    expect(rpc.mock.calls[0][1].p_task.changes).toEqual(task.changes)
    task.uploadChanges = structuredClone(task.changes)
    await syncCloudAdapter.push(task)
    expect(task.uploadChanges).toEqual(before.changes)
    const malformed = structuredClone(task)
    const record = malformed.uploadChanges?.[0].after
    if (!record || !('location' in record) || !record.location) throw new Error('Missing test location')
    Object.assign(record.location.coordinate, { latitude: 100 })
    await expect(syncCloudAdapter.push(malformed)).rejects.toThrow('緯度')
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
