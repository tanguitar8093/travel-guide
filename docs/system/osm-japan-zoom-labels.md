# 日本縮放標籤

2026-10-25，將沖繩／台灣的城市、街區及道路名稱顯示延伸至日本全國。

- 沿用 OSM place 類型與縮放規則：city z7 起、town/village z10 起、suburb/quarter z12 起、neighbourhood z15 起。幹道路名 z12、一般街名 z15 起。此分類不保證對應每一個行政建制的「市」。
- 城市／街區優先繁中、中文、日文及原名；道路優先 name:ja → name → ref。無名稱或編號不虛構標籤。
- 圖磚最高維持 z14，一般街名／鄰里在 z14 保留資料，再於畫面 z15 起顯示；路名位於行程軌跡上方，使用本機字型及 symbol 避讓。
- `prepare-region-labels.py` 共用台灣／日本串流擷取，保留各區 coverage 及名稱優先順序；`prepare-taiwan-labels.py` 保留舊 CLI 入口。新增 EmptyTagFilter 於 location indexing 後略過無標籤的參照節點，測試確認道路幾何完整。
- `prepare-japan.py` 完整 setup 自動將原始 PBF 傳給標籤產製。單獨重建底圖可指定既有 layers 與同日期 PBF；舊版圖磚沒有標籤圖層時仍可使用。

## 本次建置來源

日本來源快照 2026-10-23T20:20:51Z。PBF 為 `/home/ubuntu/workspace/Travel-experiments/osm-japan/input/japan-261023.osm.pbf`；既有底圖中間圖層為同目錄樹的 `display-stream-v1/`。程式無硬編碼此實驗路徑。

```sh
npm run osm:build:tiles -- --dataset japan --layers /path/to/japan-layers --pbf /path/to/japan.osm.pbf
python3 -B osm/scripts/write-manifest.py --dataset japan
# 重啟 OSM 服務，開啟 Vite 開發伺服器
OSM_LABEL_DATASET=japan node scripts/check-okinawa-labels.mjs
```

預覽：`http://localhost:5173/poc/osm-ui/zoom-labels.html?dataset=japan`。

量測與截圖目錄 `/tmp/travel-japan-labels/`；比較基線 `/tmp/travel-japan-before-labels.mbtiles`。頁面 heap 比較使用相同 Chromium headless、1280×900、東京中心 139.77,35.68，依序 z10 → z13 → z16，文字可繪製後強制 GC，再以 CDP Runtime.getHeapUsage 取樣。此指標不含 worker、GPU、原生配置與伺服器，不能當作整體 RAM 增幅。

正式日本 MBTiles、manifest 與標籤中間資料依既有規則不納入 Git，部署時需攜帶新版產物。

## 標籤與驗證

本次擷取 701,439 個可用名稱／編號的道路 ways、208,828 個 place 節點；無無效道路幾何。新增日本 PBF fixture 確認日文路名、道路編號、城市／街區名稱、無標籤參照節點的完整幾何及 dataset 隔離。台灣 fixture、10 項 Python 圖磚測試、34 項相關前端測試、production build、變更檔案 lint 均通過；沖繩／台灣瀏覽器縮放與軌跡層次回歸也通過。

日本東京三種視角與實際 renderer 的軌跡層次檢查通過，無頁面／console errors。道路標籤可見數 z10=0、z13 幹道=134／一般=0、z16 幹道=17／一般=52。

## 本機量測

- MBTiles：779.96 → 828.41 MiB，增加約 48.45 MiB／6.21%；manifest 已更新。
- 含原始 PBF 擷取及整份全國底圖重建：24 分 58 秒。`time -v` 最大 RSS 5,257,460 KiB，約 5.01 GiB；擷取時磁碟 location index 約 4.9 GiB 並使用檔案映射。這是建置程序指標，不能視為服務或每位使用者的 RAM 用量。
- 頁面 V8 heap，z10：17.62 → 20.21 MiB；z13：17.73 → 21.11 MiB；z16：17.85 → 21.20 MiB。一次固定路徑樣本約增加 2.6–3.4 MiB，不包含 worker、GPU、原生配置與伺服器，也不是手機效能保證。
