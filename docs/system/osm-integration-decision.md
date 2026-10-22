# 沖繩 OSM 整合決策評估

依據：Travel 原始碼、[初步評估](map-provider-assessment.md)、[maybedo.md](../../maybedo.md)，以及 `/home/tanguitar/workspaces/maps` 的核心程式與實際資料。maybedo 的內容作為設計想法討論，不直接視為實作規格。本次僅評估，未修改兩個專案的執行程式或資料庫。

## 建議決策

**先在 Travel 內驗證小範圍地圖門面，沿用 maps 的搜尋／路線核心；不要先重構整個 maps 專案，也不要立刻全面改寫 Travel。若驗證需要大幅扭曲 Travel 的框架，再選擇獨立 OSM 版本。**

現況支持這條路的理由：Google SDK 操作已集中；Travel 的地點、行程、標籤與資料庫門面已分層；maps 的搜尋及路線是獨立 Python class，沒有依賴原 UI。因此不需要移植 maps 的行程管理或 localStorage 邏輯。

但 Travel 尚未具備中立的位置與端點模型，所以「只換一個底圖元件」並不可行。能否同時保留兩套 provider 且保持清楚，需要垂直驗證才能確認，不能只依模式名称或靜態分析承諾。

## maps 實際提供的能力

| 能力 | 核心 | 可替換程度／限制 |
|---|---|---|
| 底圖 | MapLibre GL JS 6.15.0、`tiles.py`、MBTiles、`public/style.js` | 可實作 Travel 的地圖 adapter；目前樣式是海岸／陸地／水域／道路，沒有 Google 同等豐富的底圖標籤 |
| 名稱搜尋 | `search.py`、`okinawa-places.json` | 31,510 筆實際 OSM named features；日／英／部分中文與人工別名；不是完整地址搜尋或 Google 店家覆蓋 |
| 地點資訊 | catalog 的 names、address、tags、source、locationKind | 部分聯絡資訊／開放時間可能存在；不是 Google 即時 details，沒有現成按 ID 查詢 API 或反向地址查詢 |
| 圖釘／聚焦／全程視野 | MapLibre Marker、flyTo、fitBounds | 可由新的 adapter 支援，沿用 Travel 清單與事件，不搬原 UI |
| 道路距離／時間 | `routing.py`、`okinawa-osm.json`，A* | 汽車／步行／單車；回傳秒、公尺、geometry、吸附距離；靜態估算，不含即時交通、轉彎限制或完整條件式通行規則 |
| 大眾運輸／機車 | 無對應 profile | 無法等價替換 Travel 的 TRANSIT／TWO_WHEELER，不能默默以汽車結果替代 |
| Google 網址匯入 | `maps_urls.py`、`sp2.py` | 長網址座標本機解析；短網址展開仍連 Google，需明確區分離線可用性 |
| 地理覆蓋 | bounds `[127.58,25.98,128.36,26.9]` | 沖繩本島 bounding box 與附近小島；不代表全沖繩縣，路線還受道路連通性限制 |

實際檢查發現：程式啟動要求 `data/okinawa.mbtiles`，目前檔案缺失；只有約 34 MiB 的 `zurich.mbtiles`，其 bounds 在瑞士且使用 OpenMapTiles 圖層，不能直接套用沖繩四圖層樣式。沖繩中間 GeoJSON、約 71 MiB 路網、約 13 MiB catalog 仍存在。後續可用現有資料重建沖繩圖磚，這次沒有重建或啟動服務。

已執行既有 `test-routing.py` 與 `test-search.py`，皆通過；前者是小型路網 fixture，後者讀實際 catalog。尚未驗證真實大型路網路線品質、前後端整合、底圖渲染或部署。

## 為什麼不能只搬資料進 React

目前搜尋、路網圖建立與 A* 在 Python 執行。只複製 MBTiles／JSON 到 Travel，瀏覽器不會因此取得同樣能力：MBTiles 需要圖磚讀取服務或轉換格式，Python routing 也需要保留運算端或另外重寫成 JS／WASM。

將整份路網載入每個瀏覽器還會增加下載、記憶體與冷啟動成本。因此建議保留本機／自架運算服務，Travel 用 TS adapter 接入；「不用外部付費 API」可以成立，「完全沒有 HTTP 接面」與目前實作不符。

maps 現有 `server.py` 可先作驗證服務，之後只保留 tiles／search／route／必要的 URL 解析入口，去掉 demo 靜態頁面。正式環境可形成独立服務或隨產品部署的 sidecar，核心 Python 演算法先不重寫。

Travel 目前是 Vite 前端，且有 Vercel SPA rewrite。Vercel 的靜態前端不能直接執行這套常駐 Python 服務。開發可用同源 proxy；正式部署需可達的自架服務與明確路由。現有 server 未設定跨域回應，分 origin 直連不能假設成功。若只在自己電腦使用，本機服務最直接；若要對外分享網站，不能把每位訪客的 localhost 當成共同服務。

## 維持 Travel 框架的邊界

```text
Travel 現有頁面／controller／行程邏輯
        │
        ├── 既有 database facade → IndexedDB／Supabase／hybrid
        │
        └── 中立地圖接面
             ├── MapRenderer → Google 或 MapLibre
             ├── LocationResolver／Search → Google 或本機 catalog
             └── Routing → Google 或 Python 路線服務
```

- 頁面不直接呼叫 Python API，也不操作 Google／MapLibre 原生物件。
- 地圖 provider 配置集中選擇，業務層與多個頁面不散布 `if google / if osm`。
- MapView 處理生命週期、標記及視野；圖釘點選回傳專案 ID，開編輯、加行程等動作由 Travel 決定。
- 行程排序、日期、協作、收藏與同步只維護一份邏輯；不搬 maps 的十站 UI 限制、localStorage 或行程 state。
- 區域／交通能力透過中立 metadata 判斷。OSM 範圍外的舊資料保留，只提示目前底圖／路線不支援；不清空或強迫改成沖繩。
- 使用者選用 OSM 時不偷偷載入 Google。顯示底圖、搜尋、路線與網址短連結的能力應明確分開。

## maybedo 想法的具體調整

1. **策略模式與依賴注入可用，但保持輕量。** TS interface 加 factory／物件已足夠，先不做大量 class、enum 或 plugin registry。Google／OSM 是 provider 策略；沖繩是 dataset 配置。兩者不要綁成同一個 enum。未來换區域需同时匹配圖層 schema、catalog、routing 覆蓋，不是換檔名而已。
2. **套用地圖回傳 handle。** 非同步 mount 成功後取得可 setMarkers、focus、showOverview、fitMarkers、destroy 的物件；失敗帶明確錯誤。只回 true／false 無法管理地圖生命週期或處理失敗。
3. **搜尋採輸入分類後派送。** 先判斷支援的長網址、短網址、座標文字或一般關鍵字，再呼叫對應 resolver。這比為三四類輸入建立責任鏈更容易追蹤。未來來源真的很多再擴充 handler registry；某個已識別的網址失敗，不應當作關鍵字繼續搜尋。
4. **搜尋回傳結果集合與狀態。** 同名多筆、無名稱座標、網址中心點、超出範圍、找不到或服務失敗是不同結果。回傳 candidates，保存 coordinate、name（可空）、reference、source、locationKind／warning；不以單一 false 隱藏差異。
5. **經緯度使用明確名稱。** domain 用 latitude／longitude，adapter 内轉 `[longitude,latitude]`；避免 x／y 與顯示投影混淆。
6. **圖釘模組只提供呈現與事件。** setMarkers、focus、fitMarkers、onSelect／onPick；圖釘快捷動作由 Travel 傳入事件或 action，不能把加行程、權限或資料儲存塞入 renderer。
7. **距離與時間由同一次 routing 計算回傳。** 不為各交通方式另寫互不一致的距離公式；用同一接面輸入兩點與 mode。保留 estimated、source、dataVersion 和吸附距離，Travel 顯示時知道這是靜態道路估算。

## 資料應放在哪裡

| 資料 | 建議管理位置 |
|---|---|
| MBTiles、路網、全量 OSM catalog、版本與覆蓋 | 本機／自架圖資服務的唯讀 dataset；製圖與資料更新另走 pipeline |
| 收藏地點、使用者名稱／筆記／標籤、座標、行程、試算標記 | 既有 Travel IndexedDB／Supabase／hybrid |
| OSM／Google reference 與座標來源 | 使用者地點的補充欄位，不當主鍵 |
| runtime 地圖與圖釘、未儲存的搜尋結果 | 記憶體與元件狀態 |

不需要為地圖上的每一個圖釘新增資料表，也不需要把 31,510 筆 catalog 和整套路網同步到每個使用者帳號。收藏某筆搜尋結果時，將確認的名稱、座標與 reference 存入既有 Place。資料庫仍需增量擴充位置與中立試算端點，細節見原評估。

## 單一專案與獨立兩套的取捨

| 方案 | 框架影響 | 成本與適用情況 |
|---|---|---|
| Travel 中立接面＋兩 adapter | 新增位置／端點模型，集中 provider 差異；外殼與資料門面沿用 | 最符合目前「同一 UI、可切換地圖」要求，但要驗證搜尋與路線邊界 |
| 独立 OSM 版本 | 可完全去掉 Google 特有流程，不需雙 provider 相容 | 適合產品永久限定沖繩與靜態道路估算；仍需改座標、部署運算服務及處理同步／分享 |
| 先把整个 maps 做成通用套件 | 增加跨專案協調和打包範圍 | 目前不是必要前置；有第二個实际 consumer 後再抽 package |
| 只搬資料並在 Travel 重寫搜尋／routing | 原 UI 可保留，但引入新算法、格式與載入流程 | 工作量和風險較大，現有 Python 核心通過測試，缺乏重寫理由 |

獨立兩套並不自動降低資料風險。若共用 Supabase，仍需要同一套相容 schema／RPC；若完全分開資料庫，则另有資料遷移与維護兩份協作功能的成本。這個選擇應由產品差異与框架接線決定。

## 先驗證，再決定是否全面抽換

建議下一階段只做可丟棄的小型垂直驗證：恢復沖繩圖磚，以固定座標接 MapLibre adapter；用同一套中立 marker／focus／fitBounds 接面跑 Google 與 OSM；接本機搜尋與兩點道路估算。這一步不遷移正式資料庫，也不全面改頁面。驗證架構可用後才進入資料相容與逐模組接線。

**繼續單一專案的條件：** provider 差異留在 adapter／配置；頁面只處理中立能力；同一份行程資料可以工作；圖資服務可部署；不搬第二套行程 state；沒有為共用增加大量特例。

**改採獨立 OSM 版本的條件：** 兩套產品的搜尋／路線與資料流程需要长期不同分支；頁面普遍需要 provider 判斷；OSM 的部署、區域限制与操作方式要求全面改應用流程；或確定永遠不要 Google 並接受独立維護。

目前靜態評估尚未看到需要推翻 Travel 框架的證據，但也尚未完成上述垂直驗證。因此推薦的是有退出條件的整合路徑，不是無條件共用或開始全面改寫。
