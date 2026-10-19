import { useEffect } from 'react'
import { RouterLink } from '../router'
import { routes } from '../routes'
import { useDatabaseMode } from '../database/useDatabaseMode'
import { useSyncMode } from '../database/useSyncMode'
import { useHybridStatus } from '../database/useHybridStatus'
import { useAdminSyncInfo } from './useAdminSyncInfo'

export function HybridStatus() {
  const mode = useDatabaseMode()
  const syncMode = useSyncMode()
  const status = useHybridStatus()
  const { visible } = useAdminSyncInfo()
  const hasConflicts = (status.summary?.conflictCount ?? 0) > 0
  const hasPersonalConflicts = (status.summary?.personalConflictCount ?? 0) > 0
  const hasSharedConflicts = (status.summary?.sharedConflictCount ?? 0) > 0
  const hasPending = (status.summary?.pendingCount ?? 0) > 0
  const syncLabel = syncMode === 'auto' ? '自動同步' : '手動同步'

  useEffect(() => {
    if (mode !== 'hybrid' || (!hasConflicts && !hasPending)) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [mode, hasConflicts, hasPending])

  if (mode !== 'hybrid') return null

  const sharedNotice = hasSharedConflicts && <span>
    共享行程有待處理衝突，本機草稿仍保留。
    {!hasPersonalConflicts && !status.error && !status.summary?.failedCount && '其餘私人資料仍可同步。'}
    {' '}<RouterLink to={routes.itinerary}>前往行程處理共享衝突</RouterLink>
  </span>

  if (!visible) {
    if (!status.error && !hasConflicts && !status.summary?.failedCount) return null
    return <div role="alert" style={{ padding: '12px 24px', background: '#fff4d5', color: '#493300' }}>
      {(hasPersonalConflicts || status.error || Boolean(status.summary?.failedCount)) && <span>
        {hasPersonalConflicts ? '資料同步發生衝突，本機變更仍保留。' : '資料同步未完成，本機變更仍保留。'}
        {' '}<RouterLink to={routes.dataManagement}>前往資料管理處理同步問題</RouterLink>
      </span>}
      {sharedNotice}
    </div>
  }

  return <div role="status" style={{ padding: '12px 24px', background: '#fff4d5', color: '#493300' }}>
    <div>混合模式：操作先儲存本機，{syncMode === 'auto' ? '變更將自動同步至雲端' : '請到資料管理手動同步雲端'}。同步模式：{syncLabel}。</div>
    {!status.ready ? ' 正在準備帳號資料。' : ` 待同步 ${status.summary?.pendingCount ?? 0} 筆操作。`}
    {` 失敗 ${status.summary?.failedCount ?? 0} 筆、衝突 ${status.summary?.conflictCount ?? 0} 筆操作。`}
    {hasConflicts && `（個人 ${status.summary?.personalConflictCount ?? 0} 筆、共享 ${status.summary?.sharedConflictCount ?? 0} 筆）`}
    {status.summary?.lastSyncedAt && ` 最近完整同步：${new Date(status.summary.lastSyncedAt).toLocaleString()}。`}
    {status.lastOperationMs !== undefined && ` 最近儲存 ${status.lastOperationMs.toFixed(1)} ms。`}
    {status.error && ` ${status.error}`}
    {(hasPersonalConflicts || status.error) && (
      <span style={{ display: 'inline-block', marginLeft: '12px' }}>
        <RouterLink to={routes.dataManagement} style={{ color: '#493300', fontWeight: 600 }}>
          {hasPersonalConflicts ? '前往資料管理處理衝突' : '前往資料管理重試同步'}
        </RouterLink>
      </span>
    )}
    {sharedNotice}
  </div>
}
