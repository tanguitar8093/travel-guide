# Travel 原介面 OSM 預覽

最新調整：地圖導航連結用 Google Maps；底圖保持 OSM。地點頁「地點搜尋」、試算「新地點搜尋」共用輸入及問號說明，支援名稱、Google 地圖連結、緯度,經度。名稱查找與短連結解析需要 maps 服務；明確座標／含座標完整連結可直接解析，地圖中心會提醒確認入口。網址選填，新增時只有一張地圖自動選取。390 px 手機瀏覽器確認說明視窗無水平溢出、單一地圖選取、座標與完整連結選取；未驗證短連結服務或名稱搜尋服務。

試算的新地點搜尋下方加入「地點名稱（自行命名） *」。先選位置、再命名並按「使用此地點」；座標結果不自動填成名稱，空白名稱禁止確認。手機瀏覽器確認空名稱無法提交，命名後起點顯示自行命名的名稱，無頁面 JS 錯誤。

此版本取代已刪除的重新設計 HTML。需求是 Google 地圖能力抽換為 OSM，Travel 的 UI 與操作流程必須沿用。

## 預覽入口

```bash
npm run dev -- --config poc/osm-ui/vite.config.ts
```

網址 `http://127.0.0.1:5174`。2026-10-23 使用者同意後已啟動 Vite；尚未執行瀏覽器驗證。這版是 React／Vite 入口，不能直接用 `file://` 開啟 HTML。

## 直接沿用的內容

- 原 `RouteCalculatorModule.tsx`、`RouteEndpointField.tsx`、`RoutePreviewMap.tsx`、`WorkspaceLayout.tsx`、`SearchableSelect.tsx` 和既有 CSS。
- 行程與日期範圍、標記資訊／清單、取消選取／移除標記。
- 起終點對話框的已存地點／搜尋流程、交通 select、路程計算與結果 dialog。
- 原圖釘的顏色、起終點編號、選取放大、設為／移除起終點、恢復預設。

沒有獨立編排第二套版面，沒有搬入 maps 的行程 UI、十站限制或操作邏輯。正式 src 檔案無修改；Vite 預覽插件只在載入時替换地圖 renderer、controller、Google 搜尋／估算文案和必要的預覽狀態來源。這是試作替換方式，不是正式 adapter 架構。

## OSM 能力與依賴

底圖使用 maps 已有 MapLibre 6.15.0 和 land／water／roads GeoJSON，沿用其四圖層配色。GeoJSON 直接載入約 34 MiB，是缺圖磚時的預覽做法，不是正式圖磚效能方案。不安裝套件、不重建圖資。

預設 maps 專案位置 `/home/tanguitar/workspaces/maps`，可用 `OSM_PROJECT_DIR` 指定。透過預览服務讀取現有資源，不修改 maps 專案。

搜尋呼叫 `GET /api/search`；計算呼叫 `POST /api/route`；由 `/local-map` proxy 連到 `http://127.0.0.1:3000`，可用 `OSM_SERVICE_URL` 指定。沒有假搜尋或假路程 fallback，也不呼叫 Google。現有 maps 啟動程序要求 `okinawa.mbtiles`，先前讀檔發現缺失，搜尋／路程服務的啟動條件尚未解決；這不阻擋預覽底圖和原操作介面，但服務未運行時搜尋／計算會報錯。

交通選單沿用原選項；目前 maps 只支援開車／步行／單車，其餘選项提交时明确报错。未新增路線繪製、點圖新增、網址解析或圖釘彈窗等流程。

## 資料與範圍

四筆手動沖繩範例位置、兩天行程與地圖設定放在記憶體；不登入、不寫正式 IndexedDB／Supabase。預覽自己的 localStorage key 只記住目前預覽地圖。OSM ID 暫時透過既有 controller 型別傳遞，絕不寫入正式 `googlePlaceId` 欄位；正式整合仍需中立位置與 ID 契約。

預覽首頁與 `/itinerary` 直接載入原 `ItineraryModule.tsx`；`/places` 直接載入原 `PlaceModule.tsx`；`/route-calculator` 是原路程試算頁。沿用原側欄切換。三頁使用記憶體範例資料，正式地圖／標籤／協作／公開頁尚未接線，不能宣稱已完成全面 Google 抽換。行程頁仍以原圖釘點選流程開啟項目編輯，沒有另造選取流程。

行程與地點預覽 controller 提供既有 CRUD／排序／篩選／套用標籤的記憶體操作；地點查詢與路程計算呼叫本機 maps 服务。正式儲存、完整商業規則和跨分頁同步未整合。

使用者同意後已啟動 UI 預覽服務。2026-10-23 修復空白畫面：MapLibre control position 改為 `top-right`，等待底圖載入完成才解除載入提示；直接開 HTML 時提供預覽連結。以本機 Chromium 診斷確認底圖與 3 個圖釘顯示、起點對話框可開啟、無頁面 JavaScript 錯誤、直接開檔的連結可見。尚未執行測試套件、build、typecheck 或 lint，也未啟動 maps 服務。

後續補上行程與地點頁，本機 Chromium 確認行程頁 4 個圖釘、第二天項目切換、原側欄切換到地點頁及地點編輯表單開啟，無頁面 JS 錯誤；尚未驗證所有操作或 maps 搜尋／路程服務。

行程頁空白底圖後續修正：MapLibre CSS 將原 absolute host 改為 relative，造成 host 高度 0。預覽專用 `preview.css` 恢復原 host 定位／100% 高度；renderer 用 ResizeObserver 更新 canvas 尺寸並在 destroy 清理。以 1908 × 900 瀏覽器確認 host／canvas 高度皆 700 px，截圖可見沖繩海岸、道路與圖釘；日期切換後高度與 4 個標記維持，無頁面 JS 錯誤。先前僅計數 DOM 圖釘不足以證明地圖可見。
