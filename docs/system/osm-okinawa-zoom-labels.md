# 沖繩縮放標籤試作

2026-10-25。正式地圖樣式在 dataset=okinawa 且 TileJSON 宣告標籤圖層時啟用；舊版沖繩與台灣／日本圖資仍可使用。這次只重建沖繩 MBTiles。

- Zoom 7 起城市、10 起町村；12 起街區及主要道路；15 起鄰里與一般街道。
- 城市／街區優先 name:zh-Hant → name:zh → name；道路優先 name:ja → name → ref。缺少名稱與編號不產生道路標籤。
- 使用 OSM place 節點作城市／町村／街區定位標籤，並非新建行政區邊界或宣稱涵蓋所有行政區。
- 城市、道路文字採 symbol 圖層的預設避讓；行程 DOM markers 與 symbol 避讓不是同一套系統，密集行程仍需目視確認。
- 標籤圖磚最高仍為 z14；一般街名與鄰里資料保留在 z14，於畫面 z15 才顯示。更高倍率沿用 z14 幾何。
- 依 bundled MapLibre 6.15 的本機字形繪製能力，以 sans-serif 顯示，未新增外部字形服務；字體外觀及缺字行為仍取決於裝置字型。
- road_labels 為獨立線幾何，只收名稱或編號可用的道路；place_labels 為點。低縮放層級在建置時就篩掉不需要的標籤。

## 重建與預覽

```sh
npm run osm:build:tiles
# 重啟本機 OSM 服務，讓 SQLite snapshot 指向新版檔案
npm run dev
# 開啟 http://localhost:5173/poc/osm-ui/zoom-labels.html
node scripts/check-okinawa-labels.mjs
```

`prepare-okinawa-labels.py` 從 bundled legacy Okinawa tagged extract 及 places catalog 建立可丟棄的 GeoJSONL。重新 setup 產生 compact extract 時，從已保留名稱的 display roads 讀取。標籤中間檔不必部署，MBTiles 已包含所有顯示資料。

## 本機結果

圖磚 9,240,576 → 9,891,840 bytes（8.81 → 9.43 MiB），增加 0.62 MiB／7.05%。包含 6,836 個道路標籤 ways、1,147 個 place nodes。完整沖繩圖磚重建含標籤準備約 14 秒，time -v 回報最大 RSS 約 513 MiB；此為建置程序指標，不是服務 RAM。

Chromium headless、1280×900、那霸相同中心點，依序 z10 → z13 → z16。各倍率載入後等待 700ms，強制 GC，再以 CDP Runtime.getHeapUsage 量測頁面 V8 heap：

| Zoom | 原版 MiB | 試作 MiB | 差額 MiB |
| --- | ---: | ---: | ---: |
| 10 | 16.85 | 19.67 | +2.82 |
| 13 | 16.94 | 20.13 | +3.19 |
| 16 | 17.03 | 20.46 | +3.43 |

這是一次固定路徑樣本，**不包含 workers、GPU、原生配置與伺服器，不能當作整體 RAM 增幅**，也不是手機效能保證。基準以替換圖資前的 MBTiles 在獨立本機 HTTP 服務讀取；`OSM_LABEL_BASELINE_URL` 可指定該服務，`OSM_LABEL_OUTPUT` 指定報告與截圖目錄。

瀏覽器檢查三種視角的實際 rendered features：z10 無路名、z13 有主要路名但無一般街名、z16 有一般街名；無頁面／console errors。截圖與原始報告位於 `/tmp/travel-okinawa-labels/`。另通過 29 項相關前端測試、10 項 Python 圖磚測試、production build 與變更檔案 lint。全專案 lint 完成但仍有既有警告。
