import { ValidationError } from './errors'
import { supabase } from './supabase.client'
import { withSupabaseTimeout } from './supabase.utils'
import { sharedTripEditingEnabled } from './shared-trip.types'
import type { SharedTripDocument, SharedTripSaveResult, SharedTripSnapshot } from './shared-trip.types'
import { parseSharedTripSnapshot } from './shared-trip.validation'

export class SharedTripPermissionError extends ValidationError {}

class SharedTripRequestUncertainError extends ValidationError {
  readonly userId: string

  constructor(userId: string, message: string) {
    super(message)
    this.userId = userId
  }
}

async function call(
  action: string, tripId?: string, payload: Record<string, unknown> = {},
  rpc = 'app_shared_trip', expectedUserId?: string,
): Promise<unknown> {
  if (!sharedTripEditingEnabled) throw new ValidationError('共同編輯尚未啟用。')
  const session = await supabase.auth.getSession()
  if (session.error) throw new ValidationError(session.error.message)
  const uid = session.data.session?.user.id
  if (!uid) throw new ValidationError('請先登入後使用共同編輯。')
  if (expectedUserId && uid !== expectedUserId) throw new ValidationError('帳號已變更，未重試原帳號的共同編輯請求。')
  const result = await withSupabaseTimeout(Promise.resolve(supabase.rpc(rpc, {
    p_action: action, p_trip_id: tripId ?? null, p_payload: payload,
  })), 'shared trip').catch((cause: unknown) => {
    throw new SharedTripRequestUncertainError(uid, cause instanceof Error ? cause.message : String(cause))
  })
  const current = await supabase.auth.getSession()
  if (current.error) throw new ValidationError(current.error.message)
  if (current.data.session?.user.id !== uid) throw new ValidationError('帳號已變更，未套用共同編輯回應。')
  if (result.error) {
    if (result.error.code === 'PGRST202' || result.error.code === '42883') {
      if (rpc === 'app_cancel_shared_trip') throw new ValidationError('取消共享的資料庫更新尚未安裝，尚未取消或變更行程。')
      throw new ValidationError('共同編輯資料庫更新尚未安裝。請停用共同編輯開關，原有同步不需更動。')
    }

    if (result.error.code === '42501') throw new SharedTripPermissionError(result.error.message)
    if (!result.error.code) throw new SharedTripRequestUncertainError(uid, result.error.message)
    throw new ValidationError(result.error.message)
  }
  return result.data
}

export async function cancelSharedTripCloud(tripId: string, operationId: string, baseVersion: string): Promise<void> {
  const payload = { operationId, baseVersion }
  let value: unknown
  try {
    value = await call('cancel', tripId, payload, 'app_cancel_shared_trip')
  } catch (cause) {
    if (!(cause instanceof SharedTripRequestUncertainError)) throw cause
    try {
      value = await call('cancel', tripId, payload, 'app_cancel_shared_trip', cause.userId)
    } catch (retryCause) {
      throw new ValidationError(`取消共享的結果尚未確認，可能已完成；請重新載入並同步確認，不要重新啟用：${retryCause instanceof Error ? retryCause.message : String(retryCause)}`)
    }
  }
  if (!value || typeof value !== 'object' || !('cancelled' in value) || value.cancelled !== true) {
    throw new ValidationError('取消共享的結果尚未確認，請重新載入確認；不要重複啟用。')
  }
}

export const sharedTripCloud = {
  async list(): Promise<SharedTripSnapshot[]> {
    const value = await call('snapshot')
    if (!Array.isArray(value)) throw new ValidationError('共享行程清單格式不正確。')
    return value.map(parseSharedTripSnapshot)
  },
  async enable(tripId: string): Promise<void> {
    const value = await call('enable', tripId)
    if (!value || typeof value !== 'object' || !('enabled' in value) || value.enabled !== true) {
      throw new ValidationError('共同編輯啟用結果尚未確認，請重新載入。')
    }
  },
  async save(tripId: string, operationId: string, baseVersion: string, document: SharedTripDocument): Promise<SharedTripSaveResult> {
    const value = await call('save', tripId, { operationId, baseVersion, places: document.places, items: document.items })
    if (!value || typeof value !== 'object' || !('status' in value) || !('snapshot' in value)) {
      throw new ValidationError('共同編輯儲存回應不完整，請重新載入確認。')
    }
    const snapshot = parseSharedTripSnapshot(value.snapshot)
    if (snapshot.id !== tripId) throw new ValidationError('共同編輯回應的行程不符。')
    if (value.status === 'conflict') return { status: 'conflict', snapshot }
    if (value.status !== 'applied' || !('operationId' in value) || value.operationId !== operationId || !snapshot.document) {
      throw new ValidationError('共同編輯儲存結果尚未確認，請重新載入確認。')
    }
    return { status: 'applied', operationId, snapshot }
  },
}
