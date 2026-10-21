import { supabase } from '../../database/supabase.client'
import { withSupabaseTimeout } from '../../database/supabase.utils'
import type { CatalogCloud, CatalogRecord, CatalogTask } from './catalog-sync'

function record(value: unknown): CatalogRecord {
  if (!value || typeof value !== 'object') throw new Error('公開行程雲端資料不完整。')
  const row = value as CatalogRecord
  if (typeof row.id !== 'string' || typeof row.ownerId !== 'string' || typeof row.sourceTripId !== 'string'
    || typeof row.version !== 'string' || typeof row.sequence !== 'string' || typeof row.withdrawn !== 'boolean'
    || (!row.withdrawn && (!row.snapshot || row.snapshot.schemaVersion !== 1 || !Array.isArray(row.snapshot.places) || !Array.isArray(row.snapshot.items)))) throw new Error('公開行程雲端格式不正確。')
  return row
}
export function createCatalogCloud(ownerId: string): CatalogCloud & { call(action: string, payload: Record<string, unknown>): Promise<unknown> } {
  async function call(action: string, payload: Record<string, unknown>) {
    const assertAccount = async () => {
      const session = await supabase.auth.getSession()
      if (session.error) throw session.error
      if ((session.data.session?.user.id ?? '') !== ownerId) throw new Error('帳號已切換，公開行程待同步操作仍保留在原帳號。')
    }
    await assertAccount()
    const { data, error } = await withSupabaseTimeout(Promise.resolve(supabase.rpc('app_public_itinerary', { p_action: action, p_payload: payload })), 'public itinerary')
    await assertAccount()
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new Error('雲端尚未安裝公開行程同步 API；本機資料與待同步操作已保留。')
      throw new Error(error.message)
    }
    if (!data || typeof data !== 'object') throw new Error('公開行程同步回應格式不正確。')
    return data
  }
  return {
    call,
    async pull(cursor) {
      const data = await call('pull', { cursor, limit: 100 })
      if (!Array.isArray(data.records) || typeof data.cursor !== 'string' || typeof data.hasMore !== 'boolean') throw new Error('公開行程同步清單格式不正確。')
      return { records: data.records.map(record), cursor: data.cursor, hasMore: data.hasMore }
    },
    async push(task: CatalogTask) {
      const data = await call(task.action, { id: task.id, sourceTripId: task.sourceTripId, operationId: task.operationId,
        baseVersion: task.baseVersion, ...(task.snapshot && { snapshot: task.snapshot }) })
      if (data.status === 'conflict') return { status: 'conflict', record: data.record === null ? null : record(data.record) }
      if (data.status !== 'applied' || data.operationId !== task.operationId) throw new Error('公開行程寫入結果尚未確認；待同步操作已保留。')
      return { status: 'applied', operationId: data.operationId, record: record(data.record) }
    },
  }
}
