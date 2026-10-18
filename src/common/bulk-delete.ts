import { EntityInUseError, EntityNotFoundError } from '../database/errors'
import { bulkOperation } from './bulk-operation'

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
  const result = await bulkOperation({
    ids: options.ids,
    operation: '刪除',
    load: options.load,
    apply: options.deleteOne,
    order: options.order,
    failureMessage: (name, cause) => failureMessage(options.entity, name, cause),
  })
  return { deletedIds: result.succeededIds, failures: result.failures }
}