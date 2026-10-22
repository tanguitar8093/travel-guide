import { useRef } from 'react'

export function PlaceSearchHeading({ title = '新地點搜尋' }: { title?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return <span className="route-search-heading">
    <span>{title}</span>
    <button ref={trigger} type="button" className="route-search-help" aria-label={`${title}說明`} onClick={() => dialog.current?.showModal()}>?</button>
    <dialog ref={dialog} className="route-search-dialog" aria-label="地點搜尋說明" onClose={() => trigger.current?.focus()} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
      <div className="route-search-dialog-heading"><strong>地點搜尋</strong><button type="button" aria-label="關閉搜尋說明" autoFocus onClick={() => dialog.current?.close()}>×</button></div>
      <p>輸入一種格式，再選取結果。</p>
      <dl><dt>地點名稱</dt><dd>首里城</dd><dt>Google 地圖連結</dt><dd>https://maps.app.goo.gl/…<br />https://www.google.com/maps?q=26.2170,127.7195</dd><dt>緯度, 經度</dt><dd>26.2170, 127.7195</dd></dl>
      <p>名稱搜尋限已設定的 OSM 圖資；短連結需連線。<br />地圖中心可能不是入口，請確認位置。</p>
    </dialog>
  </span>
}
