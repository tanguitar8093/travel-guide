import { liveQuery } from 'dexie'
import { createPublicItineraryCore } from './core'
import { PublicItineraryDatabase, seedDemoDatabase } from './database'
import { createDemoDataset } from './fixtures'
import { SharingError, type ItineraryItem, type Label, type Place, type PublicItinerary,
  type PublicPlace, type Region, type Trip } from './models'
// Import the production styles directly; only new sharing UI lives in ui.css.
import '../../src/index.css'
import '../../src/modules/label/LabelModule.css'
import '../../src/modules/place/PlaceModule.css'
import '../../src/modules/region/RegionModule.css'
import '../../src/modules/itinerary/ItineraryModule.css'
import '../../src/common/WorkspaceLayout.css'
import './ui.css'

interface ViewRow {
  id?: string
  sourceTripId?: string
  createdAt?: string
  updatedAt?: string | null
  trip: Trip
  region: Region
  places: (PublicPlace & Partial<Pick<Place, 'labelIds' | 'notes'>>)[]
  items: ItineraryItem[]
  labels: Label[]
}
type Modal = { type: 'preview' | 'publish' | 'update' | 'withdraw' | 'edit'
  row: ViewRow; published?: ViewRow; item?: ItineraryItem }
const db = new PublicItineraryDatabase()
const core = createPublicItineraryCore(db)
let personal: ViewRow[] = [], publicTrips: ViewRow[] = []
let personalRegions: Region[] = [], personalPlaces: Place[] = [], personalLabels: Label[] = []
let managementRegionId = '', managementLabelId = ''
let selectedRegionId = '', selectedLabelId = '', selectedPlaceId = ''
let section = 'public', selectedId = '', selectedDay = 0, sidebarOpen = false
let search = '', regionFilter = '', notice = '', errorMessage = ''
let modal: Modal | null = null, modalDay = 0, previousFocus: HTMLElement | null = null
let busy = false
const app = document.getElementById('app')!
const layers = document.getElementById('layers')!
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const days = (row: ViewRow) => Math.round((Date.parse(row.trip.endDate)-Date.parse(row.trip.startDate))/86400000)+1
function dateAt(row: ViewRow, day: number) {
  const date = new Date(row.trip.startDate+'T00:00:00Z')
  date.setUTCDate(date.getUTCDate()+day)
  return date.toISOString().slice(0,10)
}
function displayDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(value))
}
function action(name: string, text: string, classes = 'itinerary-secondary', attributes = '') {
  return '<button type="button" class="'+classes+'" data-action="'+name+'" '+attributes+'>'+text+'</button>'
}
function travelDetails(item: ItineraryItem) {
  const transport: Record<string, string> = { WALKING: '步行', DRIVING: '開車', TRANSIT: '大眾運輸', BICYCLING: '自行車' }
  return (item.transport !== undefined ? '<span>'+escapeHtml(transport[item.transport] ?? item.transport)+'</span>' : '')
    + (item.travelDurationMinutes !== undefined ? '<span>路程約 '+item.travelDurationMinutes+' 分鐘</span>' : '')
    + (item.travelDistanceMeters !== undefined ? '<span>'+item.travelDistanceMeters / 1000+' 公里</span>' : '')
}

function shell(content: string, itinerary = false) {
 const items = [['◎','區域','regions'],['⌖','地點','places'],['◈','標籤','labels'],['▤','行程','itinerary'],['◉','公開行程','public'],['↔','路程試算'],['⇅','資料']];
 return '<div class="workspace-layout '+(section === 'regions' ? 'region-app-shell' : section === 'places' ? 'place-app-shell' : section === 'labels' ? 'app-shell' : 'itinerary-app-shell')+'" data-sidebar-open="'+sidebarOpen+'"><aside id="workspace-sidebar" class="workspace-sidebar" aria-label="工作區側欄" '+(!sidebarOpen?'inert':'')+'><div class="workspace-brand"><span><strong>行程規劃</strong><small>TRAVEL PLANNER</small></span></div><div class="workspace-nav-caption">工作區</div><nav class="workspace-nav" aria-label="主要導覽">'+items.map(([icon,label,target])=>target?'<a href="#" class="workspace-nav-item" data-action="navigate" data-section="'+target+'" '+(section===target?'aria-current="page"':'')+'><span class="workspace-nav-icon">'+icon+'</span><span>'+label+'</span></a>':'<span class="workspace-nav-item" aria-disabled="true"><span class="workspace-nav-icon">'+icon+'</span>'+label+'</span>').join('')+'</nav><div class="workspace-sidebar-foot"><div class="workspace-session-card"><div class="workspace-session-status">本機行程</div><strong>公開分享功能</strong><p class="archive-side-note">行程與操作結果儲存在此瀏覽器。<br>重新整理後可繼續使用。</p></div></div></aside>'+action('sidebar','☰','workspace-sidebar-toggle','aria-label="切換工作區側欄" aria-expanded="'+sidebarOpen+'" aria-controls="workspace-sidebar"')+'<main class="workspace-main '+(itinerary?'itinerary-main':section==='regions'?'region-main':section==='places'||section==='labels'?'main-content':'public-itinerary-main')+'">'+content+'</main></div>';
}
function publicPage() {
 const term = search.trim().toLocaleLowerCase();
 const filtered = publicTrips.filter(row => (!regionFilter || row.region.name===regionFilter) && (!term || row.trip.name.toLocaleLowerCase().includes(term) || row.region.name.toLocaleLowerCase().includes(term)));
 return '<div class="public-itinerary-content"><header class="public-page-heading"><div class="workspace-page-heading-title"><span class="public-eyebrow">旅行靈感，從這裡開始</span><h1>公開行程</h1><p>看看別人的安排，把喜歡的行程變成下一趟旅行。</p></div>'+action('mine','我的行程 ↗','itinerary-secondary public-link-button')+'</header><div class="public-intro"><span class="public-intro-icon">◉</span><div><strong>預覽靈感，套用後自由調整</strong><p>公開行程提供區域、地點與每日安排。套用會複製區域與地點，並為地點建立分享標籤，方便統一管理。</p></div><span class="public-demo-badge">本機範例</span></div>'+noticeHtml()+'<section class="public-list-card" aria-label="公開行程列表"><div class="public-list-toolbar"><div><h2>探索行程 <span>'+publicTrips.length+'</span></h2><p>找到喜歡的路線，先預覽再加入你的行程。</p></div><div class="public-list-filters"><label><span class="public-sr-only">搜尋公開行程</span><input type="search" id="search" value="'+escapeHtml(search)+'" placeholder="搜尋行程名稱或區域"></label><label><span class="public-sr-only">篩選區域</span><select id="region"><option value="">所有區域</option>'+[...new Set(publicTrips.map(row=>row.region.name))].map(name=>'<option '+(name===regionFilter?'selected':'')+'>'+escapeHtml(name)+'</option>').join('')+'</select></label></div></div><div class="public-table-scroll"><table class="public-trip-table"><thead><tr>'+['行程名稱','區域','新增日期','預覽','使用行程'].map(text=>'<th scope="col">'+text+'</th>').join('')+'</tr></thead><tbody>'+filtered.map(row=>'<tr><td><div class="public-trip-name"><span class="public-trip-symbol">▤</span><div><strong>'+escapeHtml(row.trip.name)+'</strong><small>'+days(row)+' 天 · '+row.places.length+' 個地點</small></div></div></td><td><span class="public-region-pill">'+escapeHtml(row.region.name)+'</span></td><td class="public-created-date">'+displayDate(row.createdAt!)+(row.updatedAt?'<small>更新日期 '+displayDate(row.updatedAt)+'</small>':'')+'</td><td>'+action('preview','預覽','itinerary-secondary','data-id="'+escapeHtml(row.id)+'" aria-label="預覽 '+escapeHtml(row.trip.name)+'"')+'</td><td>'+action('apply','使用行程','itinerary-primary','data-id="'+escapeHtml(row.id)+'" aria-label="使用行程 '+escapeHtml(row.trip.name)+'"')+'</td></tr>').join('')+'</tbody></table></div>'+(!filtered.length?'<div class="public-empty"><strong>找不到符合條件的行程</strong><p>試試其他名稱或區域。</p>'+action('clear','清除篩選')+'</div>':'')+'<footer class="public-list-footer">顯示 '+filtered.length+' 個行程<span>在「行程」按下「發佈」，即可分享你的安排。</span></footer></section><p class="public-demo-footnote">行程儲存在此瀏覽器；發佈、更新、下架與套用結果會在重新整理後保留。</p></div>';
}
function noticeHtml() { return notice || errorMessage?'<div class="public-apply-notice '+(errorMessage?'public-error-notice':'')+'" role="'+(errorMessage?'alert':'status')+'"><span>'+(errorMessage?'!':'✓')+'</span><p>'+escapeHtml(errorMessage || notice)+'</p>'+action('mine','前往行程 →')+action('dismiss','×','public-close','aria-label="關閉通知"')+'</div>':''; }
function map(row: ViewRow, items: ItineraryItem[]) {
 const positions = [[24,28],[58,48],[39,73]];
 return '<div class="demo-route-map" aria-label="'+escapeHtml(row.region.name)+'路線示意"><div class="demo-map-water"></div><div class="demo-map-park demo-map-park-one"></div><div class="demo-map-park demo-map-park-two"></div><span class="demo-map-region">'+escapeHtml(row.region.name)+'</span><svg class="demo-map-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M 24 28 L 58 48 L 39 73" fill="none" stroke="#648a74" stroke-width=".6" stroke-dasharray="1.3 1"/></svg>'+items.map((item,index)=>{const place=row.places.find(place=>place.id===item.placeId)!,[left,top]=positions[index%3];return '<div class="demo-map-stop" style="left:'+left+'%;top:'+top+'%"><span>'+(index+1)+'</span><strong>'+escapeHtml(place.icon)+' '+escapeHtml(place.name)+'</strong></div>';}).join('')+'<div class="demo-map-caption"><span>⌖</span> 當日行程路線示意 <small>地點順序依行程排列</small></div></div>';
}
function publicationActions(row: ViewRow) {
 const published = publicTrips.find(published => published.sourceTripId === row.trip.id);
 return published
  ? action('update-public','更新','')+action('withdraw-public','下架','itinerary-action-danger')
  : action('publish','發佈','');
}
function tripSwitcher(row: ViewRow) {
  return '<details class="itinerary-trip-switcher"><summary><h1>'+escapeHtml(row.trip.name)
    +'</h1><svg class="itinerary-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>'
    +'<div class="itinerary-dropdown itinerary-trip-options">'+personal.map(entry=>action('view-trip',
      '<span><strong>'+escapeHtml(entry.trip.name)+'</strong><small>'+entry.trip.startDate+' — '+entry.trip.endDate+'</small></span>',
      entry.trip.id===selectedId?'selected':'','data-id="'+escapeHtml(entry.trip.id)+'"')).join('')+'</div></details>'
}
function tripActionMenu(row: ViewRow) {
 return '<details class="itinerary-action-menu"><summary class="itinerary-secondary">行程操作<svg class="itinerary-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="itinerary-dropdown itinerary-action-options">'+action('edit-trip','編輯行程','')+'<hr>'+publicationActions(row)+'</div></details>';
}
function publicationDialog(type: 'publish' | 'update' | 'withdraw', row: ViewRow, published?: ViewRow) {
 const updating = type === 'update', withdrawing = type === 'withdraw';
 const title = withdrawing ? '下架公開行程' : updating ? '更新公開版本' : '發佈到公開行程';
 const summary = withdrawing ? published! : row;
 const copy = withdrawing
  ? '下架後，此行程不再出現在公開列表，無法預覽或套用。原始行程與已套用的個人副本都會保留。'
  : updating
   ? '將以目前行程的區域、地點與每日安排，完整覆蓋公開版本。原始行程與已套用的個人副本不受影響。'
   : '發佈當下會複製一份完整行程，其他人可以預覽或套用為自己的行程。之後修改原始行程，公開內容不會自動改變。';
 const details = withdrawing
  ? '<p><span>✓</span> 已套用的副本仍可自由編輯</p><p><span>↗</span> 再次發佈會建立新的公開記錄</p>'
  : '<p><span>✓</span> 公開內容：區域、'+new Set(row.items.map(item=>item.placeId)).size+' 個地點、每日行程安排與行程備註</p><p><span>⌑</span> 私人標籤與地點備註不會公開</p>'+(updating?'<p><span>✓</span> 保留新增日期，記錄本次更新日期</p>':'');
 return '<div class="public-dialog-heading"><div><span class="public-eyebrow">管理你的公開行程</span><h2 id="dialog-title">'+title+'</h2></div>'+action('close','×','public-close','aria-label="關閉'+title+'視窗"')+'</div><div class="public-publish-summary"><span>▤</span><div><strong>'+escapeHtml(summary.trip.name)+'</strong><p>'+escapeHtml(summary.region.name)+' · '+summary.trip.startDate+' — '+summary.trip.endDate+'</p></div></div><p class="public-dialog-copy">'+copy+'</p><div class="public-sharing-details">'+details+'</div><div class="public-dialog-actions">'+action('close','取消')+action(withdrawing?'confirm-withdraw':updating?'confirm-update':'confirm-publish',withdrawing?'確認下架':updating?'確認更新':'確認發佈',withdrawing?'itinerary-primary public-withdraw':'itinerary-primary')+'</div>';
}
function labelBadge(label: Label) {
  return '<span class="place-info-tag"><i style="background:'+escapeHtml(label.color)+'"></i>'+escapeHtml(label.name)+'</span>'
}
function linkedTripButtons(regionIds: string[]) {
  return personal.filter(row => regionIds.includes(row.trip.regionId)).map(row =>
    action('view-trip', escapeHtml(row.trip.name), 'region-secondary', 'data-id="'+escapeHtml(row.trip.id)+'"'),
  ).join(' ')
}
function placeListButton(place: Place, selected = false) {
  const labels = personalLabels.filter(label => place.labelIds.includes(label.id))
  return '<button type="button" class="place-list-item'+(selected?' active':'')+'" data-action="select-place" data-id="'
    +escapeHtml(place.id)+'"><span class="place-list-avatar">'+escapeHtml([...place.name][0])
    +'</span><span class="place-list-copy"><strong>'+escapeHtml(place.icon)+' '+escapeHtml(place.name)
    +'</strong><span>'+(place.googlePlaceId?'Google Maps 地點':'自訂地圖連結')+'</span><span class="place-list-tags">'
    +labels.map(label => '<i style="background:'+escapeHtml(label.color)+'" title="'+escapeHtml(label.name)+'"></i>').join('')
    +labels.length+' 個標籤</span></span><span class="list-chevron">›</span></button>'
}
function managementPage() {
  if (section === 'regions') {
    const region = personalRegions.find(region => region.id === selectedRegionId) ?? personalRegions[0]
    const places = personalPlaces.filter(place => place.regionIds.includes(region?.id ?? ''))
    return '<div class="region-content"><section class="region-heading"><div class="workspace-page-heading-title"><h1>區域</h1>'
      +'<p>建立行程使用的區域，也可將收藏地點歸入相同區域。</p></div></section>'+noticeHtml()
      +'<section class="region-workspace"><aside class="region-list-card"><div class="region-card-heading"><strong>已建立區域</strong><span>'
      +personalRegions.length+'</span></div>'+personalRegions.map(entry =>
        '<button type="button" class="region-list-item'+(entry.id===region?.id?' selected':'')+'" data-action="select-region" data-id="'
        +escapeHtml(entry.id)+'"><span class="region-list-icon">◎</span><span><strong>'+escapeHtml(entry.name)
        +'</strong><small>'+personal.filter(row=>row.trip.regionId===entry.id).length+' 個行程 · '
        +personalPlaces.filter(place=>place.regionIds.includes(entry.id)).length+' 個地點</small></span></button>',
      ).join('')+'</aside><section class="region-detail-card">'+(region?
        '<div class="region-detail-heading"><div><span>區域詳細資料</span><h2>'+escapeHtml(region.name)
        +'</h2></div></div><dl class="region-details-grid"><div><dt>所屬行程</dt><dd>'+linkedTripButtons([region.id])
        +'</dd></div><div><dt>收藏地點</dt><dd>'+places.length+' 個地點</dd></div></dl><section class="region-linked-section">'
        +'<div class="region-linked-heading"><h3>區域地點</h3><span>'+places.length+'</span></div><ul class="region-linked-list">'
        +places.map(place=>'<li><div><strong>'+escapeHtml(place.icon)+' '+escapeHtml(place.name)+'</strong><small>'
          +personalLabels.filter(label=>place.labelIds.includes(label.id)).map(label=>escapeHtml(label.name)).join('、')
          +'</small></div>'+action('select-place','查看地點','region-secondary','data-id="'+escapeHtml(place.id)+'"')+'</li>').join('')
        +'</ul></section>':'<p class="region-empty">目前還沒有區域。</p>')+'</section></section></div>'
  }
  if (section === 'labels') {
    const label = personalLabels.find(label => label.id === selectedLabelId) ?? personalLabels[0]
    const places = personalPlaces.filter(place => place.labelIds.includes(label?.id ?? ''))
    return '<div class="page-content"><section class="page-heading"><div class="workspace-page-heading-title"><h1>標籤</h1>'
      +'<p>建立分類層級，讓收藏的地點更容易整理與尋找。</p></div></section>'+noticeHtml()
      +'<section class="workspace-grid"><aside class="panel taxonomy-panel"><div class="panel-heading"><h2>標籤分類</h2></div>'
      +personalLabels.map(entry=>'<div class="tree-row parent-row'+(entry.id===label?.id?' selected':'')+'"><span class="chevron"></span>'
        +'<button type="button" class="tree-select" data-action="select-label" data-id="'+escapeHtml(entry.id)+'"><span class="color-dot" style="background:'
        +escapeHtml(entry.color)+'"></span><span class="tree-name">'+escapeHtml(entry.name)+'</span></button><span class="tree-count">'
        +personalPlaces.filter(place=>place.labelIds.includes(entry.id)).length+'</span></div>').join('')
      +'</aside><section class="panel full-preview-panel">'+(label?'<div class="preview-summary"><span class="large-color-dot" style="background:'
        +escapeHtml(label.color)+'"></span><div class="preview-summary-copy"><h2>'+escapeHtml(label.name)+'</h2><p>'
        +personal.filter(row=>places.some(place=>place.regionIds.includes(row.trip.regionId))).map(row=>escapeHtml(row.trip.name)).join('、')
        +'</p></div><span class="preview-count">'+places.length+' 個地點</span></div>'
        +places.map(place=>'<div class="full-place-preview"><span class="place-copy"><strong>'+escapeHtml(place.icon)+' '+escapeHtml(place.name)
          +'</strong><span>'+personalRegions.filter(region=>place.regionIds.includes(region.id)).map(region=>escapeHtml(region.name)).join('、')
          +'</span></span>'+action('select-place','查看地點','region-secondary','data-id="'+escapeHtml(place.id)+'"')+'</div>').join('')
        :'<p class="preview-empty">尚無標籤。</p>')+'</section></section></div>'
  }
  const places = personalPlaces.filter(place=>(!managementRegionId||place.regionIds.includes(managementRegionId))
    &&(!managementLabelId||place.labelIds.includes(managementLabelId)))
  const place = places.find(place=>place.id===selectedPlaceId) ?? places[0]
  const options = (entries: {id: string; name: string}[], selected: string) => entries.map(entry=>
    '<option value="'+escapeHtml(entry.id)+'" '+(entry.id===selected?'selected':'')+'>'+escapeHtml(entry.name)+'</option>',
  ).join('')
  return '<div class="page-content"><section class="page-heading"><div class="workspace-page-heading-title"><h1>地點</h1>'
    +'<p>收藏想去的地點，用標籤與區域整理旅行靈感。</p></div></section>'+noticeHtml()
    +'<section class="place-workspace"><aside class="panel place-browser-panel"><div class="panel-heading"><div><h2>已收藏地點</h2><p>共 '
    +personalPlaces.length+' 個地點</p></div></div><div class="place-filter-section"><div class="public-list-filters">'
    +'<label><span class="public-sr-only">地點區域</span><select id="management-region"><option value="">所有區域</option>'
    +options(personalRegions,managementRegionId)+'</select></label><label><span class="public-sr-only">地點標籤</span><select id="management-label">'
    +'<option value="">所有標籤</option>'+options(personalLabels,managementLabelId)+'</select></label>'+action('clear-management','清除篩選')
    +'</div></div><div class="place-list-heading"><span>搜尋結果</span><span>'+places.length+'</span></div><div class="place-list">'
    +places.map(entry=>placeListButton(entry,entry.id===place?.id)).join('')+'</div></aside><section class="panel place-detail-panel">'
    +(place?'<div class="place-readonly"><div class="place-detail-heading"><div><div class="section-kicker">地點詳細資料</div><h2>'
      +escapeHtml(place.icon)+' '+escapeHtml(place.name)+'</h2></div></div><div class="place-info-grid"><section class="place-info-section"><h3>區域</h3>'
      +'<div class="place-info-tags">'+personalRegions.filter(region=>place.regionIds.includes(region.id)).map(region=>
        '<span class="region-info-tag">'+escapeHtml(region.name)+'</span>').join('')+'</div></section><section class="place-info-section"><h3>標籤</h3>'
      +'<div class="place-info-tags">'+personalLabels.filter(label=>place.labelIds.includes(label.id)).map(labelBadge).join('')+'</div></section></div></div>'
      :'<div class="place-empty-detail"><h2>沒有符合條件的地點</h2></div>')+'</section></section></div>'
}
function itineraryPage(row: ViewRow, readonly = false, day = selectedDay) {
 const date = dateAt(row,day), items = row.items.filter(item=>item.date===date).sort((a,b)=>a.order-b.order);
 const formattedDate = new Intl.DateTimeFormat('zh-TW',{month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
 return '<div class="itinerary-content"><section class="itinerary-heading"><div class="workspace-page-heading-title">'+(readonly?'<h1>'+escapeHtml(row.trip.name)+'</h1>':tripSwitcher(row))+'<p>'+row.trip.startDate+' — '+row.trip.endDate+' <i></i> '+days(row)+' 天</p></div>'+(!readonly?'<div class="itinerary-heading-actions">'+tripActionMenu(row)+'</div>':'')+'</section>'+(!readonly?noticeHtml():'')+'<section class="itinerary-workspace"><aside class="itinerary-plan-card"><div class="itinerary-plan-title"><div><span>每日行程</span><strong>第 '+(day+1)+' 天 <small>・'+escapeHtml(row.region.name)+'</small></strong></div><span class="itinerary-day-count">'+formattedDate+' · '+days(row)+' 天</span></div><div class="itinerary-day-strip" aria-label="選擇行程日期">'+Array.from({length:days(row)},(_,index)=>{const d=dateAt(row,index);return action(readonly?'preview-day':'day','<small>'+new Intl.DateTimeFormat('zh-TW',{weekday:'short',timeZone:'UTC'}).format(new Date(d+'T00:00:00Z'))+'</small><strong>'+d.slice(8)+'</strong>',index===day?'selected':'','data-day="'+index+'" aria-pressed="'+(index===day)+'"');}).join('')+'</div><div class="itinerary-items-heading"><div><h3>當日安排</h3><span>'+items.length+' 個地點</span></div></div><div class="itinerary-items-scroll"><ol class="itinerary-item-list">'+items.map((item,index)=>{const place=row.places.find(place=>place.id===item.placeId)!;return '<li class="itinerary-item-row"><span class="itinerary-order">'+(index+1)+'</span><div class="itinerary-item-copy"><div class="itinerary-item-title"><strong><span class="itinerary-place-icon">'+escapeHtml(place.icon)+'</span>'+escapeHtml(place.name)+'</strong></div><div class="itinerary-item-meta"><span>預計抵達 '+escapeHtml(item.arrivalTime ?? '未設定')+'</span><span>'+(item.durationMinutes === undefined ? '停留未設定' : item.durationMinutes+' 分鐘')+'</span>'+travelDetails(item)+'</div>'+(!readonly && (place.labelIds?.length ?? 0)?'<div class="itinerary-item-labels" aria-label="地點標籤">'+row.labels.filter(label => place.labelIds?.includes(label.id)).map(label=>'<span class="itinerary-item-label"><i style="background:'+escapeHtml(label.color)+'"></i>'+escapeHtml(label.name)+'</span>').join('')+'</div>':'')+'<p>'+escapeHtml(item.note)+'</p></div>'+(!readonly?'<div class="itinerary-item-actions">'+action('edit-item','編輯','','data-id="'+escapeHtml(item.id)+'"')+'</div>':'')+'</li>';}).join('')+'</ol></div></aside><section class="itinerary-map-panel" aria-label="行程區域地圖"><div class="itinerary-map-heading"><div><span>旅行範圍</span><strong>'+escapeHtml(row.region.name)+'</strong></div><span class="itinerary-map-place-count">'+row.places.length+' 個收藏地點</span></div><div class="itinerary-map-canvas">'+map(row,items)+'</div><div class="itinerary-map-footer"><span><i class="itinerary-map-legend-dot numbered"></i> 當日行程順序</span><span>'+items.length+' 個行程地點 · 路線示意</span></div></section></section></div>';
}

function render() {
  const row = personal.find(row => row.trip.id === selectedId)
  const content = ['regions', 'places', 'labels'].includes(section) ? managementPage()
    : section === 'public' ? publicPage() : row ? itineraryPage(row)
    : '<div class="public-itinerary-content"><h1>我的行程</h1>'+noticeHtml()+'<p>尚無個人行程，請先從公開列表使用行程。</p>'+action('public','探索公開行程')+'</div>'
  app.innerHTML = shell(content, section === 'itinerary')
  app.inert = !!modal
  setBusyControls()
}
function setBusyControls() {
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    '#app button, #app input, #app select, #layers button, #layers input, #layers select, #layers textarea',
  ).forEach(control => { control.disabled = busy })
  layers.setAttribute('aria-busy', String(busy))
}
function openModal(next: Modal) {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  previousFocus = focused?.closest('.itinerary-action-menu')?.querySelector('summary') ?? focused
  modal = next
  modalDay = 0
  errorMessage = ''
  renderModal()
}
function closeModal() {
  if (busy) return
  modal = null
  layers.innerHTML = ''
  app.inert = false
  document.body.style.overflow = ''
  if (previousFocus?.isConnected) previousFocus.focus()
  else app.querySelector<HTMLElement>('.itinerary-action-menu summary, [data-action="mine"]')?.focus()
}
function renderModal() {
  if (!modal) return
  const { row, item } = modal
  let body = '', wide = false
  if (modal.type === 'preview') {
    wide = true
    body = '<div class="public-preview-bar"><div><span class="public-readonly-badge">⌑ 唯讀預覽</span><h2 id="dialog-title">'
      +escapeHtml(row.trip.name)+'</h2></div>'+action('close','關閉預覽 ×')
      +'</div><div class="archive-modal-itinerary itinerary-app-shell public-itinerary-readonly"><main class="itinerary-main">'
      +itineraryPage(row,true,modalDay)+'</main></div>'
  } else if (modal.type !== 'edit') {
    body = publicationDialog(modal.type,row,modal.published)
  } else {
    body = '<div class="public-dialog-heading"><h2 id="dialog-title">'+(item?'編輯行程地點':'編輯行程')
      +'</h2>'+action('close','×','public-close','aria-label="關閉編輯視窗"')
      +'</div><form id="edit-form" class="itinerary-trip-form">'
      +(item?'<label class="itinerary-field">預計抵達<input name="arrivalTime" type="time" value="'+escapeHtml(item.arrivalTime)
        +'"></label><label class="itinerary-field">行程備註<textarea name="note" rows="4">'+escapeHtml(item.note)+'</textarea></label>'
        :'<label class="itinerary-field">行程名稱<input name="name" value="'+escapeHtml(row.trip.name)+'" required maxlength="120"></label>')
      +'<div class="public-dialog-actions">'+action('close','取消')
      +'<button type="submit" class="itinerary-primary">儲存變更</button></div></form>'
  }
  layers.innerHTML = '<div class="public-demo-backdrop itinerary-app-shell"><div class="public-demo-dialog '
    +(wide?'public-demo-dialog-wide':'')+'" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1">'
    +body+'<div id="dialog-error" role="alert"></div></div></div>'
  app.inert = true
  document.body.style.overflow = 'hidden'
  layers.querySelector<HTMLElement>('[role="dialog"]')!.focus()
  setBusyControls()
}

function publicView(row: PublicItinerary): ViewRow {
  return { ...row.snapshot, id: row.id, sourceTripId: row.sourceTripId,
    createdAt: row.createdAt, updatedAt: row.updatedAt, labels: [] }
}
async function loadRows() {
  return db.transaction('r', db.tables, async () => {
    const [trips, regions, places, items, labels, publicRows] = await Promise.all([
      db.trips.toArray(), db.regions.toArray(), db.places.toArray(), db.itineraryItems.toArray(),
      db.labels.toArray(), core.list(),
    ])
    const personalRows: ViewRow[] = trips.flatMap(trip => {
      const region = regions.find(region => region.id === trip.regionId)
      return region ? [{ trip, region, places: places.filter(place => place.regionIds.includes(region.id)),
        items: items.filter(item => item.tripId === trip.id), labels }] : []
    })
    return { personalRows, publicRows: publicRows.map(publicView), regions, places, labels }
  })
}
function adoptRows(rows: Awaited<ReturnType<typeof loadRows>>) {
  personalRegions = rows.regions
  personalPlaces = rows.places
  personalLabels = rows.labels
  personal = rows.personalRows
  publicTrips = rows.publicRows
  if (!personal.some(row => row.trip.id === selectedId)) {
    selectedId = personal[0]?.trip.id ?? ''
    selectedDay = 0
  }
  const selected = personal.find(row => row.trip.id === selectedId)
  if (selected) selectedDay = Math.min(selectedDay, days(selected)-1)
  if (regionFilter && !publicTrips.some(row => row.region.name === regionFilter)) regionFilter = ''
  // Keep an open preview current, including withdrawal from another browser tab.
  if (modal?.type === 'preview') {
    const current = publicTrips.find(row => row.id === modal!.row.id)
    if (!current) {
      if (!busy) closeModal()
      errorMessage = '此公開行程已下架，無法繼續預覽或套用。'
    } else if (JSON.stringify(current) !== JSON.stringify(modal.row)) {
      modal.row = current
      modalDay = Math.min(modalDay, days(current)-1)
      renderModal()
    }
  }
  const focused = document.activeElement
  const searchFocused = focused instanceof HTMLInputElement && focused.id === 'search'
  const position = searchFocused ? focused.selectionStart : null
  render()
  if (searchFocused && !modal) {
    const input = document.getElementById('search') as HTMLInputElement
    input.focus()
    if (position !== null) {
      try { input.setSelectionRange(position, position) } catch { /* search inputs vary by browser */ }
    }
  }
}
const errorCopy: Partial<Record<SharingError['code'], string>> = {
  PUBLIC_NOT_FOUND: '此公開行程已下架或不存在，請重新選擇。',
  SOURCE_NOT_FOUND: '來源行程已不存在，無法發佈或更新。',
  SOURCE_MISMATCH: '公開版本與來源行程不符，請關閉視窗後重試。',
  ALREADY_PUBLISHED: '此來源已有公開版本，請使用更新公開版本。',
  INVALID_SOURCE: '來源行程缺少區域或地點，請先修正資料。',
}
function showError(error: unknown) {
  notice = ''
  errorMessage = error instanceof SharingError ? errorCopy[error.code] ?? '操作失敗，請重試。'
    : '無法完成操作，請確認此瀏覽器允許儲存本機資料後重試。'
  render()
  const target = document.getElementById('dialog-error')
  if (target) {
    target.textContent = errorMessage
    target.className = 'public-apply-notice public-error-notice'
  }
  console.error('Public itinerary operation failed', error)
}
async function write(operation: () => Promise<string>) {
  if (busy) return
  busy = true
  errorMessage = ''
  notice = ''
  setBusyControls()
  let message: string
  try {
    // Success is reported only after the core/database transaction commits.
    message = await operation()
  } catch (error) {
    busy = false
    if (error instanceof SharingError && error.code === 'PUBLIC_NOT_FOUND') closeModal()
    showError(error)
    // Refresh stale publication buttons without discarding a failed edit's form values.
    try { adoptRows(await loadRows()) } catch { /* retain the original error */ }
    setBusyControls()
    return
  }
  try {
    const rows = await loadRows()
    busy = false
    closeModal()
    notice = message
    adoptRows(rows)
  } catch (error) {
    busy = false
    closeModal()
    notice = message
    errorMessage = '操作已儲存，但無法重新載入列表。請重新整理頁面查看。'
    render()
    console.error('Public itinerary refresh failed', error)
  } finally {
    setBusyControls()
  }
}

document.addEventListener('click', event => {
  void handleClick(event).catch(showError)
})
async function handleClick(event: MouseEvent) {
  if (!(event.target instanceof Element) || busy) return
  if (event.target.classList.contains('public-demo-backdrop')) return closeModal()
  const button = event.target.closest<HTMLElement>('[data-action]')
  if (!button) return
  event.preventDefault()
  const menu = button.closest<HTMLDetailsElement>('.itinerary-action-menu, .itinerary-trip-switcher')
  if (menu) menu.open = false
  const name = button.dataset.action
  const row = personal.find(row => row.trip.id === selectedId)
  if (name === 'close') return closeModal()
  if (name === 'preview-day' && modal?.type === 'preview') {
    modalDay = Number(button.dataset.day)
    return renderModal()
  }
  if (name === 'preview') {
    const id = button.dataset.id!
    const snapshot = await core.readSnapshot(id)
    return openModal({ type: 'preview', row: { ...snapshot, id, labels: [] } })
  }
  if (row && ['publish','update-public','withdraw-public','edit-trip','edit-item'].includes(name ?? '')) {
    const published = publicTrips.find(published => published.sourceTripId === row.trip.id)
    if (name === 'update-public' || name === 'withdraw-public') {
      if (!published) throw new SharingError('PUBLIC_NOT_FOUND')
      return openModal({ type: name === 'update-public' ? 'update' : 'withdraw', row, published })
    }
    if (name === 'publish') return openModal({ type: 'publish', row })
    return openModal({ type: 'edit', row, item: name === 'edit-item'
      ? row.items.find(item => item.id === button.dataset.id) : undefined })
  }
  if (name === 'apply') {
    const publicRow = publicTrips.find(row => row.id === button.dataset.id)
    return write(async () => {
      const copy = await core.apply(button.dataset.id!)
      const region = await db.regions.get(copy.regionId)
      return '套用成功！「'+copy.name+'」已加入行程；已複製區域「'+region!.name+'」與所有地點，並建立「'+(publicRow?.trip.name ?? copy.name)+'(分享)」標籤。可從側欄的區域、地點、標籤查看。'
    })
  }
  if (modal && ['confirm-publish','confirm-update','confirm-withdraw'].includes(name ?? '')) {
    const current = modal
    return write(async () => {
      if (name === 'confirm-publish') {
        await core.publish(current.row.trip.id)
        return '「'+current.row.trip.name+'」已發佈至公開行程。'
      }
      if (name === 'confirm-update') {
        await core.update(current.published!.id!, current.row.trip.id)
        return '「'+current.row.trip.name+'」的公開版本已更新；已套用的個人副本不受影響。'
      }
      await core.withdraw(current.published!.id!, current.row.trip.id)
      return '「'+current.published!.trip.name+'」已下架；原始行程與已套用的個人副本已保留。'
    })
  }
  if (name === 'select-region') selectedRegionId = button.dataset.id!
  if (name === 'select-label') selectedLabelId = button.dataset.id!
  if (name === 'select-place') {
    selectedPlaceId = button.dataset.id!
    managementRegionId = ''; managementLabelId = ''
    section = 'places'
  }
  if (name === 'view-region') {
    managementRegionId = button.dataset.id!
    managementLabelId = ''
    section = 'places'
  }
  if (name === 'view-label') {
    managementLabelId = button.dataset.id!
    managementRegionId = ''
    section = 'places'
  }
  if (name === 'view-trip') {
    selectedId = button.dataset.id!
    selectedDay = 0
    section = 'itinerary'
  }
  if (name === 'clear-management') { managementRegionId = ''; managementLabelId = '' }
  if (name === 'retry') return initialize()
  if (name === 'sidebar') sidebarOpen = !sidebarOpen
  if (name && ['mine','public','navigate'].includes(name)) {
    section = name === 'navigate' ? button.dataset.section! : name === 'mine' ? 'itinerary' : 'public'
    sidebarOpen = false
  }
  if (name === 'dismiss') { notice = ''; errorMessage = '' }
  if (name === 'clear') { search = ''; regionFilter = '' }
  if (name === 'day') selectedDay = Number(button.dataset.day)
  render()
}
function searchInput(event: Event) {
  if (!(event.target instanceof HTMLInputElement) || event.target.id !== 'search' || busy) return
  if (event instanceof InputEvent && event.isComposing) return
  const position = event.target.selectionStart
  search = event.target.value
  render()
  const input = document.getElementById('search') as HTMLInputElement
  input.focus()
  if (position !== null) {
    try { input.setSelectionRange(position, position) } catch { /* search inputs vary by browser */ }
  }
}
document.addEventListener('input', searchInput)
document.addEventListener('compositionend', searchInput)
document.addEventListener('change', event => {
  if (!(event.target instanceof HTMLSelectElement) || busy) return
  if (event.target.id === 'region') regionFilter = event.target.value
  if (event.target.id === 'management-region') managementRegionId = event.target.value
  if (event.target.id === 'management-label') managementLabelId = event.target.value
  if (event.target.id === 'trip-select') {
    selectedId = event.target.value
    selectedDay = 0
    notice = ''
    errorMessage = ''
  }
  render()
})
document.addEventListener('submit', event => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'edit-form' || !modal || busy) return
  event.preventDefault()
  const data = new FormData(event.target)
  const current = modal
  const name = String(data.get('name') ?? '').trim()
  if (!current.item && !name) return
  void write(async () => {
    if (current.item) {
      await db.transaction('rw', db.itineraryItems, async () => {
        if (!await db.itineraryItems.update(current.item!.id, {
          arrivalTime: String(data.get('arrivalTime') ?? ''), note: String(data.get('note') ?? ''),
        })) throw new SharingError('INVALID_SOURCE')
      })
    } else {
      await db.transaction('rw', db.trips, async () => {
        if (!await db.trips.update(current.row.trip.id, { name })) throw new SharingError('SOURCE_NOT_FOUND')
      })
    }
    return '行程變更已儲存。'
  })
})
document.addEventListener('pointerdown', event => {
  document.querySelectorAll<HTMLDetailsElement>('.itinerary-action-menu[open], .itinerary-trip-switcher[open]').forEach(menu => {
    if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false
  })
})
document.addEventListener('keydown', event => {
  if (!modal) {
    if (event.key === 'Escape') {
      document.querySelectorAll<HTMLDetailsElement>('.itinerary-action-menu[open], .itinerary-trip-switcher[open]').forEach(menu => {
        menu.open = false
        menu.querySelector<HTMLElement>('summary')?.focus()
      })
      sidebarOpen = false
      render()
    }
    return
  }
  if (event.key === 'Escape') { event.preventDefault(); closeModal(); return }
  if (event.key !== 'Tab') return
  const dialog = layers.querySelector<HTMLElement>('[role="dialog"]')!
  const nodes = [...dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href]')]
    .filter(node => !node.hasAttribute('disabled') && node.getClientRects().length)
  const first = nodes[0], last = nodes.at(-1)
  if (!nodes.length) { event.preventDefault(); dialog.focus() }
  else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault(); first?.focus()
  }
})
async function initialize() {
  busy = true
  app.innerHTML = '<p class="poc-loading" role="status">正在載入行程…</p>'
  try {
    await seedDemoDatabase(db, createDemoDataset())
    const rows = await loadRows()
    busy = false
    adoptRows(rows)
    liveQuery(loadRows).subscribe({ next: adoptRows, error: showError })
  } catch (error) {
    busy = false
    app.innerHTML = '<div class="poc-loading" role="alert"><p>無法載入本機行程，請確認瀏覽器允許儲存本機資料後重試。</p>'
      +action('retry','重新載入')+'</div>'
    console.error('Public itinerary initialization failed', error)
  }
}
void initialize()
