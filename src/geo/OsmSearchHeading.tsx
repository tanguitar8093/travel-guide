import { useRef } from 'react'
import './osm-search.css'

export function OsmSearchHeading({ title = '地點搜尋' }: { title?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return <span className="osm-search-heading">
    <span>{title}</span>
    <button ref={trigger} type="button" className="osm-search-help" aria-label={`${title}說明`} onClick={() => dialog.current?.showModal()}>?</button>
    <dialog ref={dialog} className="osm-search-dialog" aria-label="地點搜尋說明" onClose={() => trigger.current?.focus()} onClick={event => {
      if (event.target === event.currentTarget) dialog.current?.close()
    }}>
      <div className="osm-search-dialog-heading"><strong>地點搜尋</strong><button type="button" aria-label="關閉搜尋說明" autoFocus onClick={() => dialog.current?.close()}>×</button></div>
      <p>輸入一種格式，再選取結果。</p>
      <dl><dt>地點名稱</dt><dd>首里城</dd><dt>緯度, 經度</dt><dd>26.2170, 127.7195</dd><dt>Google 地圖連結</dt><dd>可貼在地圖網址欄保留導航；不擷取 Google 座標。請以 OSM 搜尋或自行確認的位置定位。</dd></dl>
      <p>名稱搜尋限現有沖繩圖資；區域／建物可能回傳代表中心，請確認實際入口。路線是靜態道路估算，不含即時路況。</p>
    </dialog>
  </span>
}
