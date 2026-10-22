import { supabase } from './supabase.client'
import { ValidationError } from './errors'
import { assertLegacySyncTask } from './geo-format'
import { withSupabaseTimeout } from './supabase.utils'
import type { SyncRecord, SyncEntityName, SyncTask } from './sync.types'
import { sharedTripCloud } from './shared-trip.cloud'
import { sharedTripEditingEnabled } from './shared-trip.types'

export interface CloudSyncRecord {
  entity: SyncEntityName
  id: string
  version: string
  record: SyncRecord | null
  sequence?: string
  transactionId?: string
}

export interface CloudSyncSnapshot {
  protocolVersion: 1
  cursor: string
  records: CloudSyncRecord[]
}

export interface CloudSyncPull {
  protocolVersion: 1
  cursor: string
  hasMore: boolean
  changes: CloudSyncRecord[]
}

export type CloudSyncPush = {
  status: 'applied'
  operationId: string
  cursor: string
  changes: CloudSyncRecord[]
} | {
  status: 'conflict'
  conflicts: Array<Omit<CloudSyncRecord, 'version'> & { version: string | null }>
}

async function callSyncRpc(name: string, parameters?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await withSupabaseTimeout(Promise.resolve(supabase.rpc(name, parameters)), name)
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new ValidationError('雲端尚未安裝同步 API。需要先 review 並另行確認安裝第四階段 SQL；本機資料與待同步清單沒有改變。')
    }
    throw new ValidationError(error.message)
  }
  if (!data || typeof data !== 'object') throw new ValidationError('同步 API 回傳格式不正確。')
  return data
}

export const syncCloudAdapter = {
  shared: sharedTripEditingEnabled ? sharedTripCloud : undefined,
  async snapshot(): Promise<CloudSyncSnapshot> {
    const result = await callSyncRpc('app_sync_snapshot') as CloudSyncSnapshot
    if (result.protocolVersion !== 1 || typeof result.cursor !== 'string' || !Array.isArray(result.records)) throw new ValidationError('同步快照格式不正確。')
    return result
  },
  async pull(cursor: string, limit = 100): Promise<CloudSyncPull> {
    const result = await callSyncRpc('app_sync_pull', { p_cursor: cursor, p_limit: limit }) as CloudSyncPull
    if (result.protocolVersion !== 1 || typeof result.cursor !== 'string' || typeof result.hasMore !== 'boolean' || !Array.isArray(result.changes)) throw new ValidationError('同步變更格式不正確。')
    return result
  },
  async push(task: SyncTask): Promise<CloudSyncPush> {
    assertLegacySyncTask(task)
    if (task.changes.some((change) => change.baseVersion === undefined)) throw new ValidationError('缺少雲端基準版本，請先初始化或處理前序操作。')
    const payload = { protocolVersion: task.protocolVersion, operationId: task.operationId, account: task.account, changes: task.changes }
    const result = await callSyncRpc('app_sync_push', { p_task: payload }) as CloudSyncPush
    if (result.status === 'conflict' && Array.isArray(result.conflicts)) return result
    if (result.status === 'applied' && result.operationId === task.operationId && typeof result.cursor === 'string' && Array.isArray(result.changes)) return result
    throw new ValidationError('同步寫入結果格式不正確。')
  },
}
