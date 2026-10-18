import { fetchCurrentSession, subscribeSessionChange } from '../auth/auth.gateway'
import { requireHybridStore } from '../database/hybrid.runtime'
import { getDatabaseMode, subscribeDatabaseMode } from '../database/runtime'

export interface BulkOperationResult {
  succeededIds: string[]
  failures: Array<{ id: string; name: string; message: string }>
}

/** Sequential best effort, not an atomic batch. In-flight writes cannot be cancelled. */
export async function bulkOperation<T extends { id: string; name: string }>(options: {
  ids: string[]
  operation: '刪除' | '更新'
  load: () => Promise<T[]>
  apply: (id: string) => Promise<void>
  failureMessage: (name: string, cause: unknown) => string
  order?: (ids: string[], records: T[]) => string[]
}): Promise<BulkOperationResult> {
  const result: BulkOperationResult = { succeededIds: [], failures: [] }
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
    result.failures.push({ id, name, message: options.failureMessage(name, cause) })
  }

  try {
    const store = mode === 'hybrid' ? requireHybridStore() : undefined
    const assertCurrent = () => {
      if (contextChanged || getDatabaseMode() !== mode ||
          (store && requireHybridStore() !== store)) {
        throw new Error(`帳號或資料庫模式已變更，已停止後續${options.operation}，請重新載入資料。`)
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
      if (!session) throw new Error(`尚未登入，無法${options.operation}資料。`)
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
        await options.apply(id)
        result.succeededIds.push(id)
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
