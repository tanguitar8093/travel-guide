# 地圖抽換工作接續紀錄

更新：2026-10-23。這是對話接續紀錄，尚未開始功能實作。

## 2026-10-23 UI 試作修正（最新使用者指示）

- 使用者要求 **Google 地圖能力抽換為 OSM，UI 和操作邏輯都沿用 Travel 現有專案**。maps 專案僅參考地圖、搜尋、圖釘與路程能力，不搬其產品介面。
- 曾錯誤產出重新設計的 `poc/osm-ui/index.html` 與靜態 SVG，使用者已明確否決並授權刪除；兩者已刪除／替換。不能再沿用該設計，也不能由「做一版 UI」推定重新設計產品。
- 新 `poc/osm-ui` 直接載入正式路程試算 React 元件和 CSS，以預覽專用 Vite 插件替換地圖／controller 接線，正式 src 尚未修改。底圖使用 maps 現有 MapLibre 和 GeoJSON；搜尋／路程只呼叫本機服務，不用假數字。
- 此版是 UI 階段試作，不是 A–F 計畫的正式實作；僅路程試算頁面，其他頁面與正式資料接線尚未完成。詳見 `../../poc/osm-ui/README.md`。
- 使用者已同意啟動新版 UI 預覽，Vite 已啟動於 `http://127.0.0.1:5174/`。尚未執行測試、build、typecheck、lint 或瀏覽器驗證，也未啟動 maps 服務；其他執行前先取得同意的限制仍保留。
- 後續使用者回報空白頁，已修正 MapLibre 控制項位置 `right` → `top-right`，等待底圖完成後才返回 handle，並在直接開 HTML 時提供預覽服務連結。本機 Chromium 診斷確認底圖與 3 個圖釘顯示、起點對話框可開啟、無頁面 JS 錯誤；未執行測試套件、build、typecheck 或 lint。
- 使用者指出缺少行程／地點頁後，已補 `/itinerary`（亦為預覽首頁）、`/places` 與原側欄切換，直接載入原 `ItineraryModule.tsx`／`PlaceModule.tsx` 與 CSS。共用記憶體範例地點；正式 src／資料庫無修改。本機 Chromium 確認行程 4 個圖釘、第二天切換、側欄前往地點頁及原編輯表單開啟，無頁面 JS 錯誤。協作／公開／區域／標籤頁未接線；搜尋與路程仍依賴尚未啟動的 maps 服務。

## 使用者目標與優先順序

- 試算「新地點搜尋」新增必填自行命名欄位與「使用此地點」確認：座標無名稱時需使用者輸入，選取結果不立刻關閉；390 px Chromium 確認空名稱禁止提交，確認後端點顯示自行命名名稱。

- 最新 UI 調整：底圖 OSM，所有地點導航連結仍用 Google Maps（座標目的地／無座標用名稱搜尋），不要再將導航改成 OSM。地點頁標題「地點搜尋」與問號說明；試算搜尋「新地點搜尋」共用同一輸入與說明。支援名稱、Google 連結、緯度,經度；網址選填，唯一區域自選。預覽已接線，座標／含座標完整 URL 本機解析，名稱搜尋與短 URL 解析仍需 maps 服務。

- 行程空白地圖已另修正 MapLibre CSS 覆蓋 absolute host 導致高度 0 的衝突，加入預覽專用定位 CSS 與 resize observer。1908 × 900 Chromium 實際截圖確認底圖／圖釘可見，host 和 canvas 高度皆 700 px；先前僅 DOM 圖釘計數不能作為可見性證據。

- Travel 使用 React／TypeScript／Vite，想讓 Google Maps 與本機 OSM 可以抽換，沿用現有 UI 框架與資料庫。
- OSM 參考專案：`/home/tanguitar/workspaces/maps`。不沿用其 UI／行程邏輯；目前只需沖繩圖資。
- 使用者想法在根目錄 `maybedo.md`，作為設計參考，不直接當完整實作規格。
- **框架清楚比共用重要。** 若需要到處判斷 Google／OSM，或兩套流程互相遷就，使用者寧願獨立兩套。
- 最新排序：**共用方法 → Google／OSM 同批接線 → 共用搜尋／路程 → 正式資料與頁面整合 → 額外功能最後。**
- 額外功能包括網址／短網址解析、座標文字輸入、點圖新增、圖釘快捷動作、路線繪製；不得阻塞核心抽換。

## 使用者明確限制

- **不要跑任何測試；每次須先取得使用者同意。** 所有未執行驗證的判断，只能標示為程式碼分析。
- 已承諾也不自行執行 build、typecheck、lint、啟動服務、安裝依賴或圖資重建；需先確認再執行。
- 目前授權工作是架構評估與具體計畫，不能把「存 session」當成開始實作的指示。
- 持續提供簡短進度；使用者曾因長時間沒有說明而打斷工作。
- 不自行派子代理，除非使用者或適用規則明確要求。

## 文件

1. [初步評估](map-provider-assessment.md)：Travel 的 Google 耦合、資料庫與座標現況。
2. [整合決策](osm-integration-decision.md)：對照 maps、取捨與轉為獨立版本的條件。
3. **[第一階段具體計畫](map-provider-poc-plan.md)**：最新執行順序、介面草案、預計檔案與驗收；後續以這份為主。
4. [使用者想法](../../maybedo.md)：使用者自己編輯，不覆盖或改寫。

早期文件仍有「先接 OSM 搜尋／路程」或較廣泛 PoC 的敘述；最新具體計畫已改為優先共用 renderer、兩 provider 同批接線。發生順序差異時以最新具體計畫與使用者要求為準。

## 已確認的 Travel 現況

- Google loader／Places 搜尋 widget／details／Routes／map／markers 集中在 `src/modules/place/google-places.service.ts`，約 417 行。
- `src/database/models.ts` 的 Place 沒有座標，只有 Google ID／mapsUrl 等；Region 有 optional center，但選 Google 搜尋結果時 UI 清空 center。
- `src/database/database.ts` version 3 曾移除 Place latitude／longitude，部分座標可能被轉成 mapsUrl。
- RouteMap 起終點與 RouteMapPlace 使用 Google ID；試算標記沒有持久座標。業務邏輯目前也以 Google ID 判斷位置變更／路程失效。
- `src/database/index.ts` 已有 IndexedDB／Supabase／hybrid facade，可保留。
- 資料庫須增量擴充位置與中立端點；同步 RPC、backup、共享 document、公開 snapshot 有白名單／手動欄位組裝，須一起改。尚未定稿 migration 或修改資料庫。
- TravelDatabase 已宣告 version 10，SyncDatabase 繼承後還宣告 5／6／8／9，不能依較舊文件的 7／9 選下個版本。
- `GoogleMapHandle` 只有 setMarkers／destroy；共用 focus／fit 操作需最小底層增補，不能在頁面偷拿原生 map。
- 文字盤點 35 個非測試／非 CSS src 檔案涉及 Google 相關型別或欄位，並非全部需大改。

## 已確認的 maps 現況

- MapLibre GL JS 6.15.0；Python `server.py` 提供圖磚、搜尋與路線。
- `search.py` 讀實際 `data/okinawa-places.json`，31,510 筆 named OSM features，schemaVersion 2；包含 nodes／ways／relations，不等於店家數。
- `routing.py` 讀約 71 MiB `okinawa-osm.json`，建圖與 A* 在 Python；car／walk／bike 靜態道路估算，沒有大眾運輸／機車、即時塞車与完整轉彎限制。
- bounds `[127.58,25.98,128.36,26.9]` 是本島 bounding box 含附近小島，不代表全沖繩縣；道路連通另有限制。
- 接面：GET `/api/health`、`/tiles.json`、`/api/search?q=...`，POST `/api/route`、`/api/parse-map-url`。
- route 輸入 `[longitude,latitude]`，mode car/walk/bike；回傳秒、公尺、legs geometry、snapDistances、estimated、dataTimestamp。
- 底圖 style 需 land／water／coastline／roads 四圖層；metadata／相對 tile URL 必須檢查並以服務 base 正確解析。
- **當時讀碼／檔案檢查發現 `data/okinawa.mbtiles` 缺失。** 唯一的 zurich.mbtiles 是瑞士 bounds 與 OpenMapTiles schema，不能直接替代。沖繩中間 GeoJSON 與 catalog／路網仍在。後續應重新讀檔確認，不能假設永遠缺失。
- `maps_urls.py`／`sp2.py` 可解析 Google URL；長網址本機解析，短網址展開仍需要 Google 網路。
- 現有 server 無跨域回應；开发 PoC 可用獨立 Vite proxy。Travel 有 Vercel SPA rewrite，正式常駐 Python 服務需另外部署，不可假設訪客 localhost 有服務。
- 不把全量图資／catalog／路網塞進每位使用者的 IndexedDB／Supabase；readonly dataset 留圖資服務，確認收藏後的名稱／座標／reference 才存 Travel。

## 測試歷史（注意時間先後）

在使用者提出「測試先同意」限制**之前**，曾執行 maps 既有 `test-routing.py` 與 `test-search.py`，皆通過。路線是小型 fixture，搜尋讀實際 catalog。這不代表大型路網、圖磚渲染、部署或 Travel 整合已驗證。

限制提出後沒有再跑測試、build、服務或重建圖資。不要自行重跑先前測試。

## 最新具體計畫摘要

- A：中立 renderer 契約、座標／ID、dataset、依賴注入與固定 fixtures。搜尋／路程只先定契約。
- B：Google 與 MapLibre adapters 同批接線，共用 `MapView` 与獨立 `poc/map-provider` 入口；不改正式 routes／App／Auth／database。
- C：讀碼審查邊界，取得同意後才執行驗收，決定繼續整合或獨立 OSM。
- D：兩 provider 共用名稱搜尋、位置解析與兩點路程估算。
- E：另列資料庫／同步／分享與正式頁面逐步接線計畫。
- F：額外功能最後。

`src/geo` 為預計共用模組位置，尚未建立。PoC 不搬 maps 的 localStorage／trip array／排序／十站 UI 限制。domain 使用 WGS84 latitude／longitude 和專案 UUID；provider reference 是補充資訊。

## 目前變更與下一步

- 本輪只新增／修改評估與計畫文件，沒有功能 code、環境設定、依賴、圖資或 DB 變更。
- 上次狀態：評估文件與 `maybedo.md` 為 untracked，未 commit；新對話應先看實際 git status，保留使用者變更，不自行 commit。
- 使用者下一步若要求實作，再依最新計畫從 A 開始；若只是問問題，繼續解釋，不能自動實作。
- 新對話可貼：**「請先讀 docs/system/map-provider-session.md，依最新計畫接續；測試与執行驗證須先問我。」**
