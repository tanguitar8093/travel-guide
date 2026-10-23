import { useRef } from "react";
import "./osm-search.css";

export function OsmSearchHeading({ title = "地點搜尋" }: { title?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <span className="osm-search-heading">
      <span>{title}</span>
      <button
        ref={trigger}
        type="button"
        className="osm-search-help"
        aria-label={`${title}說明`}
        onClick={() => dialog.current?.showModal()}
      >
        ?
      </button>
      <dialog
        ref={dialog}
        className="osm-search-dialog"
        aria-label="地點搜尋說明"
        onClose={() => trigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="osm-search-dialog-heading">
          <strong>地點搜尋</strong>
          <button
            type="button"
            aria-label="關閉搜尋說明"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        <p>輸入一種格式，再選取結果。</p>
        <dl>
          <dt>地點名稱</dt>
          <dd>首里城</dd>
          <dt>緯度, 經度</dt>
          <dd>26.2170, 127.7195</dd>
          <dt>Google 地圖連結</dt>
          <dd>支援大部分的 google map 格式網址</dd>
        </dl>
      </dialog>
    </span>
  );
}
