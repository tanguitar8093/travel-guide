import { useState } from 'react'
import { dataManagementController } from './data-management.controller'
import type { SyncPreview } from '../../database/sync-preview'
import { useHybridStatus } from '../../database/useHybridStatus'
import { HybridConflictReview } from './HybridConflictReview'
import { sharedTripEditingEnabled } from '../../database/shared-trip.types'

const entityLabels = { regions: '地圖', places: '地點', labels: '標籤', trips: '行程', itineraryItems: '行程項目', routeMaps: '試算地圖', routeMapPlaces: '試算後加地點' }
const differenceLabels = { 'local-only': '僅本機有', 'cloud-only': '僅雲端有', different: '內容不同', same: '內容相同／兩邊皆已刪除' }

export function HybridSyncPreview() {
  const [preview, setPreview] = useState<SyncPreview>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const status = useHybridStatus()

  async function synchronize() {
    if (!window.confirm('將下載目前帳號的雲端資料，並上傳本機待同步操作。若有版本衝突會停止，不直接覆蓋。是否繼續？')) return
    setBusy(true)
    setPreview(undefined)
    setError('')
    setNotice('')
    try {
      await dataManagementController.syncHybridManually()
      setNotice('本次同步流程完成；請查看待同步與失敗／衝突數。同步期間的新修改可能留待下一次同步。離開此頁後重新開啟資料畫面查看下載結果。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '同步未完成；未確認成功的操作仍保留。')
    } finally {
      setBusy(false)
    }
  }

  async function compare() {
    setBusy(true)
    setPreview(undefined)
    setError('')
    setNotice('')
    try {
      setPreview(await dataManagementController.previewHybridSync())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '比對失敗，未變更資料。')
    } finally {
      setBusy(false)
    }
  }

  return <section className="data-management-card" aria-label="同步前差異預覽">
    <h2>同步前差異預覽</h2>
    <p>只讀取目前帳號的雲端資料做比對，不會上傳、下載保存或覆蓋。此預覽不是同步結果。</p>
    {sharedTripEditingEnabled && <p>此處比對與衝突選擇只涵蓋個人資料。共同編輯與共享行程衝突處理請使用行程模組；手動同步仍會依序處理個人資料與共享行程操作。</p>}
    <button type="button" disabled={busy} onClick={() => { void compare() }}>
      {busy ? '正在比對…' : '比對本機與雲端'}
    </button>
    <p>手動同步會真正保存下載資料與上傳變更。首次會先初始化雲端基準；不會自動同步。</p>
    <button type="button" disabled={busy || !status.ready} onClick={() => { void synchronize() }}>
      {busy ? '處理中…' : status.summary?.initialized ? '手動雙向同步' : '初始化並手動同步'}
    </button>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <HybridConflictReview disabled={busy || !status.ready} />
    {preview && <div role="status">
      <p>比對時間：{new Date(preview.checkedAt).toLocaleString()}。待同步 {preview.pendingOperations} 筆操作；可能衝突 {preview.rows.filter((row) => row.conflict).length} 筆資料。</p>
      <p>本機獨有 {preview.rows.filter((row) => row.difference === 'local-only').length} 筆、雲端獨有 {preview.rows.filter((row) => row.difference === 'cloud-only').length} 筆、內容不同 {preview.rows.filter((row) => row.difference === 'different').length} 筆。</p>
      <ul>{preview.rows.filter((row) => row.difference !== 'same' || row.pending).map((row) => <li key={`${row.entity}:${row.id}`}>
        {entityLabels[row.entity]}：{row.name} — {differenceLabels[row.difference]}
        {row.pending && '；有待同步操作'}{row.conflict && '；可能衝突，不能直接覆蓋'}
      </li>)}</ul>
      <p>資料或雲端內容改變後請重新比對；後續真正同步仍須重新檢查版本。</p>
    </div>}
  </section>
}
