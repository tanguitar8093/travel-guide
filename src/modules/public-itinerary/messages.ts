import { SharingError } from './models'
export function sharingErrorMessage(cause: unknown) {
  if (cause instanceof SharingError) {
    const messages = {
      PUBLIC_NOT_FOUND: '此公開行程已下架或不存在。', SOURCE_NOT_FOUND: '來源行程已刪除，無法發佈或更新。',
      SOURCE_MISMATCH: '公開版本與來源行程不符，請重新選擇。', ALREADY_PUBLISHED: '此行程已有公開版本，請使用更新。',
      INVALID_SOURCE: '來源行程缺少必要的區域或地點，請先修正資料。', NOT_IMPLEMENTED: '此操作尚未提供。',
    }
    return messages[cause.code]
  }
  return cause instanceof Error ? cause.message : '操作失敗，請重試。'
}
