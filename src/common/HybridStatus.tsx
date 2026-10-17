import { useDatabaseMode } from '../database/useDatabaseMode'
import { useHybridStatus } from '../database/useHybridStatus'

export function HybridStatus() {
  const mode = useDatabaseMode()
  const status = useHybridStatus()
  if (mode !== 'hybrid') return null
  return <div role="status" style={{ padding: '12px 24px', background: '#fff4d5', color: '#493300' }}>
    混合測試：操作先儲存本機，需到資料管理手動同步雲端。
    {!status.ready ? ' 正在準備帳號資料。' : ` 待同步 ${status.summary?.pendingCount ?? 0} 筆操作。`}
    {` 失敗 ${status.summary?.failedCount ?? 0} 筆、衝突 ${status.summary?.conflictCount ?? 0} 筆操作。`}
    {status.summary?.lastSyncedAt && ` 最近完整同步：${new Date(status.summary.lastSyncedAt).toLocaleString()}。`}
    {status.lastOperationMs !== undefined && ` 最近儲存 ${status.lastOperationMs.toFixed(1)} ms。`}
    {status.error && ` ${status.error}`}
  </div>
}
