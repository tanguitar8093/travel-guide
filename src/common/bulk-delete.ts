import { fetchCurrentSession, subscribeSessionChange } from '../auth/auth.gateway'
import { EntityInUseError, EntityNotFoundError } from '../database/errors'
import { requireHybridStore } from '../database/hybrid.runtime'
import { getDatabaseMode, subscribeDatabaseMode } from '../database/runtime'

export interface BulkDeleteResult {
  deletedIds: string[]
  failures: Array<{ id: string; name: string; message: string }>
}

type NamedRecord = { id: string; name: string }

function failureMessage(entity: '標籤' | '地點', name: string, cause: unknown): string {
  const subject = `${entity}「${name}」`
  if (cause instanceof EntityInUseError) {
    return entity === '標籤'
      ? `${subject}仍有子標籤或已套用至地點，請先移除子標籤及地點關聯後再刪除。`
      : `${subject}仍被行程項目引用，請先移除行程中的地點後再刪除。`
  }
  if (cause instanceof EntityNotFoundError) return `${subject}不存在或已被刪除。`
  const reason = cause instanceof Error ? cause.message.trim() : typeof cause === 'string' ? cause.trim() : ''
  return `${subject}刪除失敗：${reason || '發生未知錯誤，請稍後重試。'}`
}

/** Sequential best effort, NOT an atomic batch. Completed deletes are never rolled back.
 * Guards stop later requests; they cannot cancel an already in-flight cloud request.
 */
export async function bulkDelete<T extends NamedRecord>(options: {
  ids: string[]
  entity: '標籤' | '地點'
  load: () => Promise<T[]>
  deleteOne: (id: string) => Promise<void>
  order?: (ids: string[], records: T[]) => string[]
}): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deletedIds: [], failures: [] }
  const ids = [...new Set(options.ids)]
  if (ids.length === 0) return result

  const mode = getDatabaseMode()
  let contextChanged = false
  const unsubscribeMode = subscribeDatabaseMode(() => { contextChanged = true })
  let unsubscribeAccount = () => {}
  let records: T[] = []
  let pendingIds = ids
  const fail = (id: string, cause: unknown) => {
    const name = records.find((record) => record.id === id)?.name || id
    result.failures.push({ id, name, message: failureMessage(options.entity, name, cause) })
  }

  try {
    const store = mode === 'hybrid' ? requireHybridStore() : undefined
    const assertCurrent = () => {
      if (contextChanged || getDatabaseMode() !== mode ||
          (store && requireHybridStore() !== store)) {
        throw new Error('帳號或資料庫模式已變更，已停止後續刪除，請重新載入資料。')
      }
    }
    if (mode === 'supabase') {
      let userId: string | undefined
      const observedUsers: Array<string | undefined> = []
      let captured = false
      unsubscribeAccount = subscribeSessionChange((session) => {
        const nextUser = session?.user.id
        if (captured && nextUser !== userId) contextChanged = true
        observedUsers.push(nextUser)
      })
      const { session, error } = await fetchCurrentSession()
      if (error) throw error
      if (!session) throw new Error('尚未登入，無法刪除資料。')
      userId = session.user.id
      captured = true
      if (observedUsers.some((id) => id !== userId)) contextChanged = true
    }
    assertCurrent()
    records = await options.load()
    assertCurrent()
    pendingIds = options.order ? options.order(ids, records) : ids

    for (let index = 0; index < pendingIds.length; index += 1) {
      try {
        assertCurrent()
      } catch (cause) {
        pendingIds.slice(index).forEach((id) => fail(id, cause))
        break
      }
      const id = pendingIds[index]
      try {
        await options.deleteOne(id)
        result.deletedIds.push(id)
      } catch (cause) {
        fail(id, cause)
      }
    }
  } catch (cause) {
    pendingIds.forEach((id) => fail(id, cause))
  } finally {
    unsubscribeAccount()
    unsubscribeMode()
  }
  return result
}