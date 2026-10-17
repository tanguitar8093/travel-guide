import { useEffect } from 'react'
import { RouterLink } from '../router'
import { routes } from '../routes'
import { useDatabaseMode } from '../database/useDatabaseMode'
import { useSyncMode } from '../database/useSyncMode'
import { useHybridStatus } from '../database/useHybridStatus'

export function HybridStatus() {
  const mode = useDatabaseMode()
  const syncMode = useSyncMode()
  const status = useHybridStatus()
  const hasConflicts = (status.summary?.conflictCount ?? 0) > 0
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

  return <div role="status" style={{ padding: '12px 24px', background: '#fff4d5', color: '#493300' }}>
    <div>混合測試：操作先儲存本機，需到資料管理同步雲端。同步模式：{syncLabel}。</div>
    {!status.ready ? ' 正在準備帳號資料。' : ` 待同步 ${status.summary?.pendingCount ?? 0} 筆操作。`}
    {` 失敗 ${status.summary?.failedCount ?? 0} 筆、衝突 ${status.summary?.conflictCount ?? 0} 筆操作。`}
    {status.summary?.lastSyncedAt && ` 最近完整同步：${new Date(status.summary.lastSyncedAt).toLocaleString()}。`}
    {status.lastOperationMs !== undefined && ` 最近儲存 ${status.lastOperationMs.toFixed(1)} ms。`}
    {status.error && ` ${status.error}`}
    {hasConflicts && (
      <span style={{ display: 'inline-block', marginLeft: '12px' }}>
        <RouterLink to={routes.dataManagement} style={{ color: '#493300', fontWeight: 600 }}>
          前往資料管理處理衝突
        </RouterLink>
      </span>
    )}
  </div>
}
