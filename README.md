# Atlas · 沖繩 2D 行程地圖

沖繩本島的 OSM 地圖、多地點標記、行程排序，以及汽車 / 步行 / 自行車的本機道路時間估算。不需要 API key；資料下載後地圖與路線均可離線使用。

## 啟動

此工作目錄已安裝套件與沖繩資料，直接：

```bash
npm start
```

開啟 http://localhost:3000。預設行程為那霸機場 → 國際通 → 首里城，可加入美國村、萬座毛、美麗海水族館、古宇利海灘，或點擊地圖加入自訂地點（最多 10 站）。可上下移動、移除地點、清空行程。行程保存在目前瀏覽器的 localStorage。

全新環境需要 Node.js 22+、Python 3.10+：

```bash
npm ci
npm run setup
npm start
```

setup 優先使用 Overpass 下載沖繩道路與海岸線。若 Overpass 服務拒絕或逾時，可以使用 Geofabrik fallback：

```bash
python3 -m venv /tmp/okinawa-venv
/tmp/okinawa-venv/bin/pip install osmium
curl -fL https://download.geofabrik.de/asia/japan/kyushu-latest.osm.pbf -o /tmp/kyushu.osm.pbf
/tmp/okinawa-venv/bin/python scripts/extract-okinawa.py /tmp/kyushu.osm.pbf
npm run setup
```

下載的九州區域約 301 MB；只保留沖繩本島範圍道路、海岸線與水域。原始區域資料可以刪除。`scripts/prepare-okinawa.py` 產生本機 2D GeoJSON，無需 3D 或圖磚服務。地圖以海岸線、道路與景點為主。搜尋另外使用31,510 個具名稱的 OSM 節點與區域，包含餐廳、商店、住宿與景點；支援部分名稱與日文／英文／OSM 中文名稱及常用中文別名。不是完整門牌地址搜尋。

## 道路與交通時間

`routing.py` 建立三種交通方式各自可通行的 OSM 道路圖，以 A* 計算各段最快估算路徑，再加總整份行程。不是以直線距離換算三種速度。支援主要 access 標籤、汽車/自行車單行道、步行反向通行，以及 motorway/motorroad 的模式限制。

- 汽車：依道路類型預設 10–75 km/h（市區通常 25–40、高速公路 75），數值 `maxspeed` 作為上限。
- 步行：一般道路 4.5 km/h、階梯 3 km/h。
- 自行車：一般道路 15 km/h，小徑等 10 km/h。
- 時间為靜態 demo 估算，未含塞車、坡度、紅綠燈、停車、休息、景點停留、轉彎限制、條件式或時段通行限制，不適合直接導航。
- 座標吸附到附近連通道路節點（最多 800 公尺），道路外接駁距離顯示於各段，**未計入**道路時間。大型資料圖會略過小於 1,000 節點的孤立道路區塊，避免吸附到不連通的停車場小徑；因此小型獨立區域可能不支援。道路不連通會顯示錯誤，不以直線替代。
- 目前依使用者指定順序，不自動最佳化行程。不含公車、單軌、渡輪與其他離島。

正式服務可將 `/api/route` 換成自架 Valhalla / GraphHopper / OSRM 的合適 profiles，以支援更完整交通規則與道路吸附。若需要大眾運輸，需要另外取得適用的 GTFS 班次資料並接入 OpenTripPlanner 等服務。

## API / Docker

- `GET /api/search?q=中本天婦羅`：本機 OSM 名稱搜尋，最多回傳 30 筆，含地址（若有）、類別與 OSM 來源連結。「波上城」會明確提示是否指波上宮。
- `GET /api/health`：資料時間、道路數、範圍。
- `GET /data/{land,water,roads}.geojson`：沖繩本機 2D 地圖。
- `POST /api/route`：`{"points":[[127.6843,26.2144],[127.7192,26.2170]],"mode":"car"}`。mode 可為 `car`、`walk`、`bike`；回傳各段 GeoJSON、秒數、公尺數與吸附距離。

靜態文字資源（包含地圖 GeoJSON）支援 gzip 傳輸、ETag 驗證與一小時瀏覽器快取；API 回應不快取。gzip 可減少遠端首次下載的資料量，重訪時則可沿用瀏覽器快取。

```bash
docker compose up --build -d
```

先下載資料再啟動，`./data` 以唯讀 volume 掛載。Python HTTP server 適合本機 demo；公開環境需專用部署、TLS、限流與容量規劃。Docker 設定未實測。

## 驗證

```bash
python3 scripts/test-routing.py
python3 scripts/test-search.py
npx playwright install chromium
npm test
```

服務需先啟動。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定既有 Chromium。測試涵蓋道路 access / 單行道差異、各段加總、API 座標驗證、三種交通方式、增刪排序、自訂地點、保存行程、2D 樣式與手機畫面，輸出 `artifacts/okinawa-desktop.png` / `okinawa-mobile.png`。

## 來源與授權

- OSM 道路與海岸線：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，ODbL；從 [Geofabrik 九州 extract](https://download.geofabrik.de/asia/japan/kyushu.html) 擷取沖繩，或 Overpass 查詢取得。資料時間顯示在服務資訊。再散布需遵守 ODbL。
- 中文介面字型：Google Fonts Noto Sans TC 完整字型，SIL OFL 1.1。setup 下載到本機，支援動態地點名稱。
- MapLibre GL JS：BSD-3-Clause。保留畫面 OSM attribution。
- 不使用或批次抓取 OSM 公共圖磚。首次 setup 需網路，運行中不需要遠端地圖/路線 API。

搜尋資料由 `scripts/extract-places.py` 從 Geofabrik PBF 擷取。OSM 店家可能未收錄、名稱不全或重複；已支援可由成員定位的 relations；無法定位或位於資料範圍外的紀錄不加入。中文別名涵蓋常用城跡、海岬、博物館、主題園區與連鎖餐飲，只擴充查詢詞，不新增未驗證座標。空白搜尋顯示 7 個推薦地點，輸入關鍵字後搜尋完整本機地點資料庫。區域 way 使用節點平均座標作為近似中心，並非入口位置。

可額外執行 `node scripts/check-search.mjs` 驗證中本天婦羅、波上宮的搜尋、來源連結與加入行程；同樣需要啟動服務與 Playwright Chromium。新環境 setup 若缺地點檔案會下載 Geofabrik 區域檔，並暫時安裝 osmium 進行擷取（需 Python pip）。

地點 catalog schema v2 保留所有 name/alt_name/official_name/short_name/loc_name/old_name/brand 語言欄位；具名 OSM 道路、站點等均納入。保留地址、OSM 聯絡資訊與開放時間（若有），不保證即時有效。relations 優先使用 label/admin_centre，否則以範圍內可定位成員的平均位置近似；不是入口或精確面中心。這個版本仍採本島 bounding box，含附近小島，不代表整個沖繩縣或所有現實店家。`npm run setup` 會自動重建舊版 catalog，已是 v2 時跳過。

目前 catalog：31,510 筆（nodes 15,618 / ways 14,676 / relations 1,216），JSON 約 12.60 MiB。含具名道路、設施、站點，筆數不等於店家數或去重後的景點數。中文別名是人工常用名稱補充，並非所有日文名稱的翻譯；範圍與資料更新時間可從 catalog metadata 核對。

下載保留的 `data/kyushu.osm.pbf` 約 302 MiB 是重建用原始區域檔，並非沖繩 runtime 必需資料。刪除後仍可離線使用；下次重建 catalog 需再下載。

## Google 地圖網址解析

搜尋框可貼上 Google 地圖長網址或 `maps.app.goo.gl` / `goo.gl/maps` 短網址，按 Enter 或等待自動解析。解析沿用 `sp2.py` 的座標優先順序，經 `/api/parse-map-url` 回傳。

有座標且位於沖繩資料範圍內會顯示標記並移動地圖，可加入行程；無名稱時加入會開啟空白名稱欄位。超出範圍顯示警告，不加入地圖或行程。無座標顯示「無法取得地址」。僅有 `@lat,lng` 時標示為地圖中心點，請自行核對是否為店家位置。

長網址本機解析；短網址需要網路連到 Google 展開。這項功能不下載 Google 圖磚或店家資料庫。新增後須重新啟動 `npm start` 才能使用新的後端 API。
