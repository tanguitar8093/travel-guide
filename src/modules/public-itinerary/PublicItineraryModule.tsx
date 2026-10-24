import { getRegionMapProvider } from '../../geo/region-provider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceLayout } from '../../common/WorkspaceLayout'
import { RouterLink } from '../../router'
import { routes } from '../../routes'
import { useDatabaseMode } from '../../database/useDatabaseMode'
import { useHybridStatus } from '../../database/useHybridStatus'
import ItineraryModule from '../itinerary/ItineraryModule'
import { ItineraryController } from '../itinerary/itinerary.controller'
import { SnapshotItineraryService } from './snapshot.service'
import { createPublicItineraryController, publicSharingAvailable } from './public-itinerary.controller'
import { SharingDialog } from './SharingDialog'
import { PublicationDialog } from './PublicationDialog'
import { sharingErrorMessage } from './messages'
import type { PublicItinerary } from './models'
import './PublicItineraryModule.css'
import { useAuth } from '../../auth/useAuth'
import { usePublicCatalogStatus, refreshPublicCatalog, acceptPublicCloudVersion } from './catalog-runtime'
import type { SharedPublicItinerary } from './shared-catalog'
import { useMapProvider } from '../../geo/provider-preference'

function days(row: PublicItinerary) {
  return Math.round((Date.parse(row.snapshot.trip.endDate)-Date.parse(row.snapshot.trip.startDate))/86400000)+1
}
function date(value: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(value))
}
function Preview({ row, onClose }: { row: PublicItinerary; onClose(): void }) {
  const controller = useMemo(() => new ItineraryController(new SnapshotItineraryService(row.snapshot)), [row])
  return <SharingDialog title={`唯讀預覽 · ${row.snapshot.trip.name}`} wide onClose={onClose}>
    <ItineraryModule readonly controller={controller} />
  </SharingDialog>
}
export function PublicItineraryModule() {
  const { user } = useAuth()
  const { provider } = useMapProvider()
  const publicItineraryController = useMemo(() => createPublicItineraryController(user?.id ?? ''), [user?.id])
  const sync = usePublicCatalogStatus()
  const mode = useDatabaseMode()
  const hybrid = useHybridStatus()
  const available = publicSharingAvailable()
  const ready = available && (mode !== 'hybrid' || hybrid.ready)
  const [rows, setRows] = useState<PublicItinerary[]>([])
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('')
  const [previewId, setPreviewId] = useState<string>()
  const [withdrawId, setWithdrawId] = useState<string>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  useEffect(() => {

    return publicItineraryController.subscribe(next => {
      setRows(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); setLoading(false)
    }, cause => { setError(sharingErrorMessage(cause)); setLoading(false) })
  }, [publicItineraryController])
  const preview = rows.find(row => row.id === previewId)
  const withdrawing = rows.find(row => row.id === withdrawId)
  const term = search.trim().toLocaleLowerCase()
  const filtered = rows.filter(({ snapshot }) => getRegionMapProvider(snapshot.region) === provider && ( !rows.some(row => row.snapshot.region.name === region) || snapshot.region.name === region)
    && (!term || snapshot.trip.name.toLocaleLowerCase().includes(term) || snapshot.region.name.toLocaleLowerCase().includes(term)))
  async function apply(id: string) {
    if (running.current) return
    running.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      const copy = await publicItineraryController.apply(id)
      setNotice(`套用成功！「${copy.name}」已加入行程。區域與地點已複製，並建立分享標籤；可從行程選單自行選取副本。`)
    } catch (cause) { setError(sharingErrorMessage(cause)) }
    finally { running.current = false; setBusy(false) }
  }
  return <WorkspaceLayout active="public-itinerary" shellClassName="itinerary-app-shell" mainClassName="public-itinerary-main">
    <div className="public-itinerary-content"><header className="public-page-heading"><div className="workspace-page-heading-title">
      <span className="public-eyebrow">旅行靈感，從這裡開始</span><h1>公開行程</h1><p>看看已分享的安排，把喜歡的行程變成下一趟旅行。</p>
    </div><RouterLink to={routes.itinerary} className="itinerary-secondary public-link-button">我的行程 ↗</RouterLink></header>
    <div className="public-intro"><span className="public-intro-icon">◉</span><div><strong>預覽靈感，套用後自由調整</strong>
      <p>套用會複製區域與地點，建立分享標籤，方便統一管理。公開內容同步至雲端後，所有帳號與裝置都能查看。</p></div></div>
    <div className="public-list-toolbar"><p role="status">{sync.syncing ? '正在同步公開行程…' : sync.pending ? `${sync.pending} 筆公開行程操作待同步` : '公開行程已同步'}{sync.error && ` · ${sync.error}`}</p><button className="itinerary-secondary" disabled={sync.syncing} onClick={() => void refreshPublicCatalog()}>同步公開行程</button></div>
    {sync.conflicts.map(conflict => <p key={conflict.id} className="itinerary-feedback itinerary-error" role="alert">「{conflict.name}」的雲端版本已變更，本機操作保留中。<button className="itinerary-secondary" disabled={sync.syncing} onClick={() => { if (window.confirm('放棄此公開行程的待同步操作，改用雲端版本？個人來源行程不受影響。')) void acceptPublicCloudVersion(conflict.id) }}>採用雲端版本</button></p>)}
    {!available && <p className="itinerary-feedback itinerary-error">請切換至本機工作區使用公開行程。</p>}
    {available && !ready && <p role="status">正在準備本機工作區…</p>}
    {error && <p className="itinerary-feedback itinerary-error" role="alert">{error}</p>}
    {notice && <div className="public-apply-notice" role="status"><p>{notice}</p><RouterLink to={routes.itinerary}>前往行程 →</RouterLink>
      <button type="button" aria-label="關閉通知" onClick={() => setNotice('')}>×</button></div>}
    {previewId && !preview && <p className="itinerary-feedback itinerary-error" role="alert">此公開行程已下架，無法繼續預覽或套用。</p>}
    {<section className="public-list-card" aria-label="公開行程列表"><div className="public-list-toolbar"><div><h2>探索行程 <span>{rows.length}</span></h2>
      <p>找到喜歡的路線，先預覽再加入你的行程。</p></div><div className="public-list-filters">
      <label><span className="public-sr-only">搜尋公開行程</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋行程名稱或區域" /></label>
      {<label><span className="public-sr-only">篩選區域</span><select value={rows.some(row => row.snapshot.region.name === region) ? region : ''} onChange={event => setRegion(event.target.value)}><option value="">所有區域</option>
        {[...new Set(rows.map(row => row.snapshot.region.name))].map(name => <option key={name}>{name}</option>)}
      </select></label>}</div></div><div className="public-table-scroll"><table className="public-trip-table"><thead><tr>
      {['行程名稱','區域','新增日期','預覽','使用行程','管理'].map(name => <th scope="col" key={name}>{name}</th>)}
    </tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><div className="public-trip-name"><span className="public-trip-symbol">▤</span><div>
      <strong>{row.snapshot.trip.name}</strong><small>{days(row)} 天 · {row.snapshot.places.length} 個地點</small></div></div></td>
      <td><span className="public-region-pill">{row.snapshot.region.name}</span></td><td className="public-created-date">{date(row.createdAt)}
        {row.updatedAt && <small>更新日期 {date(row.updatedAt)}</small>}</td>
      <td><button type="button" className="itinerary-secondary" disabled={busy} onClick={() => { setError(''); setPreviewId(row.id) }} aria-label={`預覽 ${row.snapshot.trip.name}`}>預覽</button></td>
      <td><button type="button" className="itinerary-primary" disabled={busy || !ready} onClick={() => void apply(row.id)} aria-label={`使用行程 ${row.snapshot.trip.name}`}>{busy ? '處理中…' : '使用行程'}</button></td>
      <td>{(row as SharedPublicItinerary).ownerId === user?.id && <button type="button" className="itinerary-delete" disabled={busy || !ready} onClick={() => setWithdrawId(row.id)}>下架</button>}</td>
    </tr>)}</tbody></table></div>{loading ? <p className="public-empty" role="status">正在載入行程…</p> : !filtered.length && <div className="public-empty">
      <strong>{rows.length ? '找不到符合條件的行程' : '尚無公開行程'}</strong><p>{rows.length ? '試試其他名稱或區域。' : '從行程操作選單發佈你的行程。'}</p>
      {rows.length > 0 && <button type="button" className="itinerary-secondary" onClick={() => { setSearch(''); setRegion('') }}>清除篩選</button>}
    </div>}<footer className="public-list-footer">顯示 {filtered.length} 個行程<span>來源刪除後，仍可在這裡下架已發佈版本。</span></footer></section>}
    </div>
    {preview && <Preview row={preview} onClose={() => setPreviewId(undefined)} />}
    {withdrawing && <PublicationDialog operation="withdraw" trip={{ ...withdrawing.snapshot.trip, id: withdrawing.sourceTripId }}
      regionName={withdrawing.snapshot.region.name} published={withdrawing} onClose={() => setWithdrawId(undefined)}
      onSuccess={message => { setWithdrawId(undefined); setPreviewId(undefined); setNotice(message) }} />}
  </WorkspaceLayout>
}
