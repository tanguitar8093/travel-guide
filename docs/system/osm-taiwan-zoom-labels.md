# 台灣縮放標籤

2026-10-25，延用沖繩試作的向量標籤與軌跡層次。

- 城市 z7 起、鄉鎮／聚落 z10 起；行政區／街區 z12 起；鄰里與一般街道名稱 z15 起。幹道路名 z12 起。
- 台灣名稱優先 `name:zh-Hant` → `name:zh` → `name`，道路無名稱時使用 `ref`。未命名道路不虛構名稱。
- 行政區使用 OSM `place` 節點標籤，沒有新增行政區界線。圖磚最高維持 z14，近景文字依畫面倍率顯示。
- 軌跡插在第一個 symbol 圖層之前，順序為底圖／道路 → 行程軌跡 → 城市及路名；景點 DOM markers 仍可點擊。
- 舊台灣圖磚缺少 label 圖層時仍可顯示原底圖。日本標籤未啟用，沖繩樣式維持原設定。

`prepare-taiwan-labels.py` 從台灣 PBF 串流擷取名稱及道路幾何，用暫存磁碟 location index，不載入整份地點目錄或變更路由／搜尋資料。依共用 coverage 篩選，保留全道路幾何。本次共 304,375 段 named/ref 道路 ways、2,746 個 place 節點，無無效道路幾何。

重建與驗證：

```sh
npm run osm:build:tiles -- --dataset taiwan
# 自訂來源可加 --pbf /path/to/taiwan.osm.pbf
python3 -B osm/scripts/write-manifest.py --dataset taiwan
# 重啟 OSM 服務，並開啟 Vite 開發伺服器
OSM_LABEL_DATASET=taiwan node scripts/check-okinawa-labels.mjs
```

預覽：`http://localhost:5173/poc/osm-ui/zoom-labels.html?dataset=taiwan`。

本機圖磚從 81.6367 → 89.75 MiB，增加 8.1133 MiB／9.94%。包含 PBF 標籤擷取的重建耗時 3 分 33 秒，time -v 最大 RSS 476,240 KiB（約 465 MiB），是建置指標而非服務 RAM。

台北中心 121.517,25.047，Chromium headless、1280×900，依序 z10 → z13 → z16，等待文字可繪製後強制 GC，以 CDP Runtime.getHeapUsage 比較頁面 V8 heap。一次樣本約增加 4.1–4.4 MiB；**不含 workers、GPU、原生配置與伺服器，不能當作整體 RAM 增幅或手機保證**。原始報告及截圖在 `/tmp/travel-taiwan-labels/`，原版資料在 `/tmp/travel-taiwan-before-labels.mbtiles`。

驗證包含 32 項相關前端測試、10 項 Python 圖磚測試、新增 PBF fixture（繁中名稱、座標、coverage、未命名道路略過及失敗保留產物）、production build、變更檔案 lint，及台灣／沖繩瀏覽器縮放與實際 renderer 軌跡層次。Taiwan 圖資及 manifest 仍依既有規則不納入 Git，部署時需另外攜帶新版產物。
