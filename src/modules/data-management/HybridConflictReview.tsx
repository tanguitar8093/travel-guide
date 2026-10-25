import { useEffect, useState } from 'react'
import { dataManagementController } from './data-management.controller'
import type { SyncConflictReview } from '../../database/sync.types'
import { ConflictRecordValue, ConflictRecordTitle } from './ConflictRecordValue'

const names = { regions: '地圖', labels: '標籤', places: '地點', trips: '行程', itineraryItems: '行程項目', routeMaps: '試算地圖', routeMapPlaces: '試算後加地點' }
const routeFields: Record<string, string> = {
  routeMapId: '所屬試算地圖', selectedDate: '日期篩選',
  originGooglePlaceId: '出發點 Google 地點 ID', destinationGooglePlaceId: '目的地 Google 地點 ID',
}
const fields: Record<string, string> = { name: '名稱', id: '資料 ID', zoom: '地圖縮放', googlePlaceId: 'Google 地點 ID', center: '中心位置', color: '顏色', parentId: '上層標籤', icon: '圖示', mapsUrl: '地圖網址', notes: '備註', regionIds: '關聯地圖', labelIds: '關聯標籤', regionId: '行程地圖', startDate: '開始日期', endDate: '結束日期', tripId: '所屬行程', placeId: '地點', date: '日期', order: '順序', arrivalTime: '抵達時間', durationMinutes: '停留分鐘', transport: '交通方式', travelDurationMinutes: '交通分鐘', note: '備註' }

export function HybridConflictReview({ disabled }: { disabled: boolean }) {
  const [review, setReview] = useState<SyncConflictReview>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void dataManagementController.getSavedConflictReview().then((saved) => { if (active) setReview(saved) }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : '無法載入衝突預覽。')
    })
    return () => { active = false }
  }, [])

  async function refresh() {
    setBusy(true)
    setError('')
    setNotice('')
    try { setReview(await dataManagementController.prepareConflictReview()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法檢視衝突。') }
    finally { setBusy(false) }
  }

  async function resolve(choice: 'local' | 'cloud') {
    if (!review || !window.confirm(choice === 'cloud'
      ? `將放棄這個帳號目前全部 ${review.pendingOperations} 筆待同步操作，並採用已預覽的雲端資料。請先匯出備份。確定繼續？`
      : `將保留這個帳號全部待同步資料的本機最終版本，整併成新的待同步操作。這次不會上傳，之後需再按手動同步。確定繼續？`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await dataManagementController.resolveConflictReview(review.token, choice)
      setReview(undefined)
      setNotice(choice === 'local' ? '已保留本機版本；請再按手動同步上傳，雲端若又改變仍會停止。' : '已採用雲端版本，放棄預覽涵蓋的全部待同步操作。請重新進入資料頁查看。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '處理失敗，未放棄本機操作。') }
    finally { setBusy(false) }
  }

  return <section aria-label="衝突處理">
    <h3>衝突處理</h3>
    <p>為保護關聯資料，本階段按整批處理：選擇涵蓋目前帳號全部待同步操作，不是只改一筆。請先匯出備份。</p>
    <button type="button" disabled={disabled || busy} onClick={() => { void refresh() }}>檢視／更新衝突內容</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {review && <div>
      <p>預覽時間：{new Date(review.createdAt).toLocaleString()}。影響 {review.pendingOperations} 筆操作、{review.rows.length} 筆資料。兩邊又有修改時必須重新預覽。</p>
      {review.rows.map((row) => <details key={`${row.entity}:${row.id}`}>
        <summary>{names[row.entity]}：<ConflictRecordTitle review={review} row={row} /></summary>
        <p>本機：{row.local ? '資料存在' : '已刪除／不存在'}；雲端：{row.cloud ? '資料存在' : '已刪除／不存在'}</p>
        <table><thead><tr><th>欄位</th><th>本機</th><th>雲端</th></tr></thead><tbody>
          {[...new Set([...Object.keys(row.local ?? {}), ...Object.keys(row.cloud ?? {})])].map((field) => <tr key={field}>
            <td>{field === 'id' ? '資料' : fields[field] ?? routeFields[field] ?? field}</td>
            <td><ConflictRecordValue review={review} row={row} side="local" field={field} /></td>
            <td><ConflictRecordValue review={review} row={row} side="cloud" field={field} /></td>
          </tr>)}
        </tbody></table>
      </details>)}
      <button type="button" disabled={disabled || busy} onClick={() => { void resolve('local') }}>整批保留本機版本（之後再同步）</button>
      <button type="button" disabled={disabled || busy} onClick={() => { void resolve('cloud') }}>整批採用雲端版本（放棄待同步操作）</button>
    </div>}
  </section>
}
