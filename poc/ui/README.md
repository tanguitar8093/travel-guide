# 已核准 UI 設計稿

2026-10-23 使用者確認 OSM 地圖抽換 UI 符合預期，依 `.agents/skills/poc.md` 保存本階段靜態設計稿。

入口：`map-provider-osm.html`。直接用瀏覽器開啟，不需要 Vite、maps、Google API key 或資料庫。八個 HTML 畫面各自嵌入 CSS、表單狀態與地圖圖像，保留核准版面和手機 RWD；問號說明視窗可操作，部分導覽可切換各靜態畫面。沒有搜尋、儲存、導航估算或地圖操作引擎；Google 地點外連保留。OSM 地圖圖像保留來源 attribution。

核准內容：沿用 Travel 的行程／地點／路程試算介面；OSM 底圖和 Google 導航連結；共用名稱／Google 連結／緯度,經度搜尋與問號範例說明；地圖網址選填；唯一區域自動選取；試算新地點必填自行命名並按「使用此地點」確認。

來源：`poc/osm-ui` 預覽直接載入正式 React 元件及 CSS；匯出腳本為 `poc/osm-ui/export-ui.mjs`。匯出設計稿時擷取瀏覽器畫面，不執行測試套件、build、typecheck 或 lint。這次僅保存已核准 UI，未開始後續 TDD、IndexedDB 或正式核心接線。
