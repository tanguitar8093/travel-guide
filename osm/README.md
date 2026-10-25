# Travel bundled OSM

Runtime code, multi-region OSM data, MapLibre 6.15.0 browser assets, and maintenance scripts live in this directory. No sibling maps checkout or its node_modules is required. Original source files remain untouched; copy-manifest.json records their checksums before integration edits.

## Run from the Travel root

- `npm run dev`: starts the local OSM service automatically when needed, using osm/server.py and osm/data. Close any old maps service on port 3000 to ensure this bundled service is used. Existing healthy services on that port are reused.
- `npm run osm:start`: start the Python service explicitly. Uses Python 3.10+ and its standard library; no pip/npm installation is required for the OSM runtime.
- Both osm-ui and map-provider PoCs share the same automatic service startup and proxy as the main app, and read bundled vendor and GeoJSON assets.
- `npm run osm:build:tiles`: rebuild osm/data/okinawa.mbtiles using system-installed tippecanoe; restart the OSM service afterwards.
- `npm run osm:setup`: prepare missing road, tile and place data. Needs network access, tippecanoe, and pip when the place catalog must be extracted. The supplied data already supports runtime without setup.
- `python3 -m pip install -r osm/requirements-build.txt`: optional PBF extraction dependency. The setup script can alternatively install it into a temporary directory.
- `npm run osm:test`: existing Python tests; place-extraction tests require osmium.

OSM_PROJECT_DIR optionally overrides this bundled directory and expects the same data/ and vendor/maplibre-gl/ layout. OSM_SERVICE_PORT chooses the automatically launched service port; OSM_SERVICE_URL selects an existing service. These are process environment variables, not browser VITE variables. HOST and PORT configure an explicitly started Python service.

## Production

This is one repository with a browser frontend and a Python backend. Building the Vite frontend does not embed or start Python. Route /local-map/* to the Python service (removing /local-map), and configure VITE_OSM_SERVICE_URL=/local-map and VITE_OSM_ASSET_BASE_URL=/local-map before building. The Python service serves osm-vendor/, tiles.json, tiles/, search, routing and URL parsing. A same-origin reverse proxy avoids cross-origin worker and CORS configuration. Vercel SPA-only hosting still needs a reachable Python service or an additional suitable backend deployment.

From the Travel root: `docker compose -f osm/compose.yaml up --build -d`. This container serves the OSM backend only; deploy the frontend separately or use a reverse proxy. No image build, container startup or production deployment has been validated as part of the copy.

## Data and licensing

Six supplied Okinawa runtime/PoC data files total approximately 125.4 MiB. Keep osm/data when copying or packaging this repository; Vite dist alone is insufficient. The regional kyushu.osm.pbf source, Zurich tiles, demo screenshots and demo fonts are not runtime dependencies and were not copied. A future setup may download the regional PBF; .gitignore excludes that rebuild input. The original bundled Okinawa runtime data and vendor files are tracked. Generated Taiwan/Japan artifacts and disposable indexes are ignored; package them separately when deploying.

MapLibre's license is preserved in vendor/maplibre-gl/LICENSE.txt; version.json records its pinned source version. These prebuilt vendor files are committed assets, so there is no dependency on a sibling npm installation. Update all four assets, license and version metadata together when upgrading.

OSM data: © OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright . Original extraction sources include Overpass and Geofabrik Kyushu. Preserve attribution and the applicable data license when redistributing.

Historical project notes may still describe the earlier sibling maps arrangement. Active configuration now defaults to this directory. Database backup tools under scripts/convergence-* retain their separate ~/.local paths; they are maintenance tooling unrelated to this OSM integration. Supabase and Google services remain external network dependencies.


## Taiwan / multiple OSM datasets

Preferences select Google or OSM; the Regions page selects Okinawa or Taiwan. See
[implementation and acceptance notes](../docs/system/osm-taiwan-implementation.md).

Build Taiwan with `npm run osm:setup -- --dataset taiwan` (Python venv support and
system tippecanoe are required). This downloads Geofabrik's Taiwan PBF, checks MD5,
extracts named places/display layers, builds a compact SQLite road network and
MBTiles, and writes an artifact manifest. Reuse an existing PBF with
`--pbf osm/data/taiwan.osm.pbf`. Restart the map service after a complete build.

`/datasets/taiwan/tiles.json`, `/datasets/taiwan/api/search` and
`/datasets/taiwan/api/route` select Taiwan. Existing unprefixed endpoints select
Okinawa. Map tiles load independently of the large catalog and road graph.
The runtime requires only Python's standard library; pinned osmium/shapely
packages are build dependencies in `osm/.venv`.

Run all Python fixtures with `npm run osm:test`. The browser regression script is
`node scripts/check-osm-datasets.mjs`; it uses `.env.e2e.local`, a separate browser
context and local-only mutations. `OSM_CHECK_HYBRID=1` checks real account sync;
it may create the account's normal fixed OSM regions, but does not create test
places or trips in the cloud.

## Routing and Taiwan search indexes

Taiwan routing reads indexed edges on demand rather than rebuilding a nationwide
in-memory graph for every transport mode. Taiwan place search also uses a disk
index instead of retaining the complete JSON catalog in the HTTP process.
`osm:setup` and server startup prepare disposable indexes automatically; the first
preparation can take about a minute for both datasets of derived information.
Subsequent starts reuse them. Changed source files invalidate their indexes.

To prepare manually before starting the server:

```sh
python3 -B osm/scripts/prepare-routing-index.py osm/data/taiwan-routing.sqlite
python3 -B osm/scripts/prepare-search-index.py osm/data/taiwan-places.json
```

Caches live in ignored `data/.routing-cache/` and `data/.search-cache/` directories.
Keep the original SQLite/JSON inputs; restart after replacing them. See
[measurements and limits](../docs/system/routing-performance.md) for reproducible
benchmarks, resource bounds, first-build costs, and long-route limitations.

## Experimental streaming display extraction

`scripts/prepare-display-stream.py` extracts display-only GeoJSONL layers into a
new output directory. It uses a disk location index, streams road/water features,
and processes coastline topology after finishing way extraction. It does not register a new
dataset, build MBTiles, extract places, or prepare routing. Existing setup and
service paths continue to use their current implementations.

First use the optional native `osmium-tool` to retain display candidates and all
their referenced nodes (do not use `--omit-referenced`):

```sh
osmium tags-filter /path/to/input.osm.pbf \
  w/highway w/natural=coastline,water w/waterway=riverbank \
  -o /path/to/display-input.osm.pbf
osmium check-refs /path/to/display-input.osm.pbf
osm/.venv/bin/python -B osm/scripts/prepare-display-stream.py \
  /path/to/display-input.osm.pbf /path/to/new-output-directory --prefix japan
```

The output contains roads, water, land and coastline `.geojsonl` files plus a
checksum manifest. The input extent is used without production coverage clipping;
these intermediate layers are not a selectable Japan dataset. Run experiments
outside `osm/data`, with measured memory, disk and time limits. See the
[Japan feasibility and experiment log](../docs/system/osm-japan-feasibility.md).

### 日本全國（正式整合）

切換「區域 → OSM → 日本」使用全國底圖、磁碟地點搜尋與汽車／步行／單車路由。既有沖繩身分與座標快速匯入的沖繩優先政策保留，不加入輪渡／鐵路。台灣／日本 SQLite 共用跨區策略：精確搜尋達限後，使用有界道路估算，標示未保證最快／最短；不按地名特例或任意 200km 硬拒絕。台灣約 209km、東京–橫濱／靜岡等已實測，詳 C7。每階段仍限 5 萬展開／10 萬 states，整筆多路段搜尋共用 22 秒；資源不足回可重試 503，不再誤稱距離過大或快取 30 秒。沖繩原圖沿用 C6 的 4 秒／50 萬界限及連通接路修正。

重建需要原生 `osmium`（osmium-tool）、`tippecanoe`、Python venv，並預留至少 20 GiB 工作磁碟：

```bash
npm run osm:setup -- --dataset japan
# 或使用已下載的日本 PBF
npm run osm:setup -- --dataset japan --pbf /path/to/japan.osm.pbf
```

日本流程使用 `prepare-japan.py`：原生篩選 → 串流底圖 → SQLite 地點中間資料 → 外部排序道路引用 → SQLite 路網／搜尋索引 → MBTiles。**不會走舊的全國 Counter／flex_mem 建置路徑。** 工作資料在 `osm/data/japan-build/`，正式產物為 `japan.mbtiles`、`japan-places.json`、`japan-routing.sqlite`、`japan-manifest.json`；索引為可重建的隱藏 cache。重建時不可同時更新正在服務中的圖資，應停止服務後執行，完成再啟動。保留工作目錄可重試相同 PBF；換新 PBF 時使用新的工作目錄或先移走舊 `japan-build/`，避免沿用舊篩選檔。

coverage 來源、資源實測、限制及執行決策集中見 [日本全國整合紀錄](../docs/system/osm-japan-rollout.md)。更換 coverage 請用 `build-japan-coverage.py` 並同步產生新的資料庫 migration；不重寫既有 migration。

日本驗收工具（使用既有 admin 測試帳號登入，測試地點／行程只寫獨立瀏覽器 IndexedDB，結束恢復帳號原區域偏好）：

```bash
# 先啟動獨立 Vite，例如 npm run dev -- --port 4180
JAPAN_FULL_CHECK=1 node --env-file=.env.local --env-file=.env.e2e.local scripts/check-japan-app.mjs
```

需 `.env.e2e.local` 的 `E2E_A_EMAIL`／`E2E_A_PASSWORD`；工具不輸出憑證，封鎖雲端資料 mutation。完整版須三份日本資產及索引全部準備完成，包含真實名稱搜尋、行程路線繪製、三種路由模式及路程試算 UI。結果預設在 `/tmp/travel-japan-app/`；這是目前工作區的手動驗收工具，並非在缺圖資環境會通過的假測試。

圖磚內容版本會在建置／啟動前準備 `.tiles-cache`，避免第一次日本請求重新掃描整份 MBTiles；該目錄同樣可刪除重建。來源檔案大小、mtime 或 ctime 變更會使版本快取失效。不要只複製 Vite dist 而遺漏 OSM 資產。

沖繩實際行程回歸（需要既有 `okinawa-osm.json`）：

```bash
python3 -B osm/scripts/benchmark-okinawa.py --output /tmp/okinawa-routing-check.json
```

包含機場／租車行、奧武島、Oodomari／PARCO 等路段與正反向，以及既有三模式控制；不需要變更使用者行程或重建圖資。接路重試維持原 800m 限制，成本計入回傳距離／時間。模式圖首次初始化另計，避免初始化耗盡路由搜尋時間。`scripts/check-okinawa-routing.mjs` 可用本機私密同步副本在獨立 IndexedDB 重現兩天的軌跡與批次路程計算，封鎖雲端資料寫入。修正紀錄見上述文件 C6。

跨區共同回歸：

```bash
python3 -B osm/scripts/benchmark-regional-routing.py --output /tmp/regional-routing-check.json
```

可用 `--trip /path/to/private-synced-fixture.json` 納入實際前兩項；報告不輸出私人座標。`scripts/check-itinerary-routing.mjs` 支援三區的獨立 IndexedDB 頁面驗收，原沖繩工具入口繼續相容。
