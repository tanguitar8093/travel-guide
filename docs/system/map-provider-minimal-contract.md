# 地圖共用最小契約：第一階段

日期：2026-10-23。第一階段契約型別檢查已通過；第二階段新增隔離 renderer 核心與 PoC，驗證狀態見文末。未接持久化或正式 UI。

依據已核准的今日 [核心計畫](map-provider-poc-plan.md) 與 [資料整合規劃](map-provider-data-integration-plan.md)。本文件細化第一階段，不代表已批准後續資料庫格式、migration、provider 設定保存或正式功能切換。

## 1. 第一階段交付與不變範圍

- [contracts.ts](../../src/geo/contracts.ts)：純型別契約。
- [index.ts](../../src/geo/index.ts)：第一階段為 type exports；第二階段另公開 renderer factories 與 MapView。
- 不 import database、React、Google／MapLibre SDK 或既有模組。
- 不新增全域 singleton、SDK loader、網路請求、localStorage 或環境設定。
- 不修改既有 Google 型別、服務、controller、頁面、路由、資料模型、索引、同步、備份或分享。
- 正式模組尚未引用新契約，三種資料模式的既有入口保持原狀；沒有新增未同步的 local-only 寫入。

這是刻意新增的底層跨模組契約，不是新的產品頁面模組，因此不新增 module controller／service 或 App route。

## 2. 座標與三種身分

| 契約 | 規則 |
|---|---|
| `Coordinate` | WGS84，latitude／longitude；adapter 才轉 lat/lng 或 `[longitude, latitude]` |
| `Bounds` | north／south／east／west；允許跨日期變更線時 west > east，adapter 須正確處理 |
| 專案 UUID | Place、共享地點、額外 marker、inline endpoint 的正式實體身分 |
| `ProviderReference` | Google ID 或完整 OSM `node/…`、`way/…`、`relation/…`；不是專案主鍵 |
| 搜尋 `key` | 當次候選集合內唯一的 UI key；不可當收藏 UUID 或跨搜尋的永久識別 |

型別不保證數值範圍與字串內容。後續 adapter 邊界／repository 驗證必須拒絕 NaN、Infinity、越界座標、空 ID、非法 OSM reference；OSM suffix 必須是合法正整數 ID。沒有用型別斷言假裝已完成執行期驗證。

## 3. 可保存與即時資料分離

`StoredLocation` 由 `LocationMetadata` 加 coordinate 組成：

| source | 內容 | 保存前提 |
|---|---|---|
| `user` | 獨立輸入／選位的座標與 kind | 不是將 Google 回傳值改標成 user |
| `osm` | 座標、kind、必填 OSM reference、optional datasetVersion | adapter 核對來源、資料格式與必要 attribution |
| `legacy-user` | 舊有使用者位置及 kind | 必須確認來源，不因欄位存在便自動分類 |

`GoogleRuntimeLocation` 是另一型別，固定 source google、Google reference 與即時座標；不能直接賦值給 `StoredLocation`。Google 搜尋名稱／地址與即時 resolution 不代表可持久保存或在 OSM 使用。

`LocationResolution` 包含位置、coverage（inside／outside／unknown）及 warnings。coverage 是目前 resolver／dataset 的判斷，不是地點本身永久屬性；Google 或範圍未知不能硬寫 inside。

本階段的 `StoredLocation` 只是保存候選契約，尚未加入資料庫模型。TypeScript 分流不是授權驗證，仍需後續 source validation、明確欄位投影及 provider 條款檢查。

## 4. Renderer 與生命週期

| 方法／事件 | 必須遵守的語意 |
|---|---|
| `mount` | 非同步建立；成功才回 handle；失敗拒絕並清理部分資源 |
| `setMarkers` | 整批替換；id 為 consumer 提供的唯一實體 key；不得隱性 fit 或寫資料 |
| `focus` | 聚焦明確座標，可指定 zoom |
| `fitBounds` | 調整明確範圍，不變更資料所屬地圖 |
| `fitMarkers` | 針對當前標記；空集合維持視野 |
| `destroy` | 可重複呼叫；釋放 markers、事件、observer 與 renderer 資源；之後 handle 操作不再修改畫面 |
| `onSelect` | 只回 marker ID，不執行新增行程或儲存 |
| `onError` | 掛載成功後發生的 renderer 錯誤；不把服務失敗當成成功 |

初始 bounds 優先於 center／zoom，maxZoom 必須被遵守。數值與重複 marker ID 等非法輸入使用 INVALID_INPUT，不默默略過。

signal 用於未完成的 mount 取消；若 SDK 無法真正取消，adapter 仍要丟棄結果並清理資源。mount 已成功之後由 owner 呼叫 destroy，不用假設 abort 會卸載已就緒地圖。

consumer 切換 provider 時負責 generation、清理舊 handle 與隔離遲到結果。MapView／renderer 不知道行程、權限或 repository。

MapMarker 只帶呈現用座標，不保存來源，因此「可否把某位置畫在此 provider」必須在建立 marker 前檢查；不能以 marker 沒有 source 為理由把 Google runtime content 送往 OSM。

必要的 Google／OSM 標示由 adapter 與資料呈現 consumer 各依責任處理，不得遮蔽 SDK attribution；本階段不宣告一個字串能代替全部 attribution 要求。

## 5. 搜尋與解析：不假設每筆候選已有座標

`LocationSearch.search` 處理名稱查詢，回傳：

- `candidates`：型別要求非空集合。
- `no-results`：空集合；空白名稱查詢也可回此狀態，不發送 API。
- optional total：只有服務提供可靠總量才填寫，不把 Google 建議筆數當作全資料總數。

候選必有 key 與 reference；name、address、resolution 可選。Google autocomplete 可以先回 prediction，使用者選取後再透過 `LocationResolver.resolve` 取得位置，不強迫對每筆建議發 details 請求。OSM 若搜尋已回位置，可直接附 resolution。

resolver 必須檢查 reference provider；OSM 不可解析 Google ID 後偷偷呼叫 Google。遇到缺座標、不可用 ID、服務失敗，拒絕並帶明確 GeoError；不回空座標或 (0,0)。

Google session token／候選 context 由後續 adapter 實作管理；尚未定稿為跨 provider 的公共 API。若現行 SDK 必須新增搜尋 session 生命週期，於第二階段先補契約，不以 global mutable token 或不必要的 details 預取掩蓋差異。

候選 key 不用於 `resolve`；解析用 provider reference。網址／短網址／座標文字分類、點圖新增不在這次契約內。

## 6. 路線與端點

交通方式保留既有五個字串，避免對資料列改名：DRIVING、WALKING、BICYCLING、TRANSIT、TWO_WHEELER。新 TravelMode 不依賴 Google service；本階段不改現有 common transportOptions 的 import，正式接線時才收斂來源，避免現在影響既有流程。

`RouteRequest` 接受兩個已解析端點及 mode。解析、名稱與實體身分由 operation 層提供，routing adapter 不查私人 repository。

- ResolvedRouteEndpoint.id 是 consumer 的實體 key，不是 Google ID。
- Routing 讀取 resolution 中的座標與可用 reference；Google runtime reference 不可交給 OSM 使用。
- 不支援模式回 UNSUPPORTED_MODE，不默默換成 DRIVING。
- `RouteEstimate` 回分鐘、公尺、provider、estimated、warnings 與 optional datasetVersion；不包含 provider 原生物件或永久保存許可。
- 分鐘為非負整數、秒向上取整；距離為有限非負公尺，是否格式化／四捨五入留給 UI，不為遷就現有整數 DB 偷改核心精度。
- geometry、吸附距離與路線繪製屬後續擴充，本次不預先要求兩 provider 提供。

### 操作層選取，不等於資料庫 schema

`RouteEndpointSelection` 區分：

1. place：私人 Place UUID。
2. shared-place：共享 trip UUID＋該文件中的 Place UUID。
3. route-map-place：額外 marker UUID；實際 scope 由目前 map 驗證。
4. location：獨立端點 UUID；value 分 stored（必填使用者名稱、StoredLocation）或 google（只保留 reference、optional 使用者名稱）。

value 的巢狀 discriminated union 避免把 Google 即時座標當作 inline 保存位置。Google 的 optional name 只代表使用者自行命名，不是 provider displayName 的保存許可。

這是後續資料設計共用的操作層形狀，尚未決定 IndexedDB 欄位布局或 JSON 格式；既有只有 Google 端點 ID 的記錄不在本階段轉換。

operation 層依資料庫模式／權限解析引用、驗證同 map／同 owner、處理刪除與未定位，geo 不接手這些責任。相同座標不代表相同實體；新端點 UUID 不代表地理位置必然不同，仍需依選取來源判斷同端點。

## 7. 能力、組合與錯誤

`GeoServices` 是可注入物件形狀，不是 factory 實作或全域 provider。提供 renderer、search、resolver、routing，及各能力的 available／reason、支援交通方式、optional dataset。

- 沒有 Google key 不能使 OSM 能力一併失效。
- capabilities 是目前配置快照，不是連線健康保證；呼叫仍可能失敗。
- 未支援的接面保留方法並拒絕，不能回成功形狀的空資料。
- dataset 是圖資版本、範圍與初始視野，和 provider 分離；更換 dataset 不能更換業務 UUID。
- GeoError 是標準 Error 加 code；本次不新增 error class 或執行期 helper。
- INVALID_INPUT、UNSUPPORTED_INPUT、UNSUPPORTED_MODE、OUTSIDE_COVERAGE、NETWORK_REQUIRED、SERVICE_UNAVAILABLE、DATASET_MISMATCH、LOCATION_UNAVAILABLE、PROVIDER_RESTRICTED、NO_ROUTE、CANCELLED 分別表達原因，不用 message 字串猜 code。
- 取消由 consumer 識別並忽略其過期 UI 更新，不冒充查無結果；真正服務錯誤顯示給使用者。

## 8. 第一階段完成邊界與後續驗證

本次完成契約落檔與公開 type exports，不宣稱 Google／OSM adapter、runtime validation、契約測試或 IndexedDB 相容已通過。

使用者授權後執行的最小型別檢查：

```bash
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution bundler --lib ES2023,DOM src/geo/index.ts
```

結果：exit code 0。最初未加 `--ignoreConfig` 時，TypeScript 6 以 TS5112 拒絕指定檔案與既有 tsconfig 並存的命令；加上明確忽略專案設定後，僅檢查此入口與其匯入的 contracts，沒有擴大驗證範圍。未執行 build、lint、Playwright、正式專案型別檢查或既有全套測試。後續核心實作再加入固定 fixtures 與針對兩 adapter 的行為驗收。

## 9. 第二階段：renderer 核心與隔離 PoC

已新增：

- [Google renderer](../../src/geo/adapters/google/google-renderer.ts)、[獨立 SDK loader](../../src/geo/adapters/google/google-sdk.ts)。只載入 maps／marker，不依賴 Places，不修改既有 Google 服務的來源檔或載入 callback；另鏈接 Google 官方 gm_authFailure hook，保留先前 handler，將授權錯誤送往本 loader 的 renderer subscribers。
- [MapLibre renderer](../../src/geo/adapters/osm/maplibre-renderer.ts)：注入 SDK 與 style，沒有硬編碼 maps 專案路徑或沖繩資料於核心。
- [MapView](../../src/geo/MapView.tsx)：共用 loading/error、取消、過期掛載清理與最新 markers／callback；options 的物件身分改變會重新建立地圖，consumer 應保持穩定。
- 共用數值／marker 驗證、跨日期變更線的最小圖釘範圍、marker DOM 呈現及事件清理。
- [隔離 PoC](../../poc/map-provider/main.tsx)：相同固定座標與 marker ID 切換兩 provider，清單／圖釘選取、聚焦、fitMarkers、fitBounds、重試；預設 OSM。
- [renderer 契約測試](../../src/geo/map-renderers.test.ts)：以注入的假 SDK 驗證兩 renderer，不會呼叫 Google 或 OSM。

既有正式模組、資料庫、Google service、正式 Vite 設定、package.json 與 lockfile 未因本階段修改。搜尋／resolve／routing 仍只有契約，沒有假實作，也沒有建立看似全功能的 GeoServices。

### 啟動與依賴

待獲准啟動後：

```bash
npm run dev -- --config poc/map-provider/vite.config.ts
```

入口 `http://127.0.0.1:5176/`，strictPort，不影響既有 5174／5175 demo。PoC 自己的 envDir 指向專案根目錄，因此可使用既有 VITE_GOOGLE_MAPS_API_KEY；不讀取／輸出其他秘密，不新增 key。

不安裝套件。PoC 透過 allowlist middleware 讀取 maps 專案現有 MapLibre 模組／worker／CSS 與三份 GeoJSON，預設 `/home/tanguitar/workspaces/maps`，可用 OSM_PROJECT_DIR 指定。只在這個開發服務暴露固定資源路徑，不把外部目錄加入一般任意檔案存取範圍。正式 adapter 的 SDK 由 consumer 注入，沒有依賴這條絕對路徑。

OSM 約 34 MiB GeoJSON 是現有預覽方案，不是正式 vector tiles、TileJSON／health metadata 驗證或可部署產品。這階段不啟動 Python、不重建圖磚、不聲稱解決既有圖資／服務部署限制。

Google 選項會真正載入 SDK，可能產生 API 使用量；必須取得使用者授權後才進行連線驗證。缺 key、SDK／底圖逾時、gm_authFailure 明確失敗，不回退 OSM；Google Maps 沒有公開等價 map.remove，因此移除 owned DOM、markers 與 instance listeners，不宣稱已卸載全域 SDK。授權失敗也可能觸發 idle，不能僅以 idle 判定 Google 可用。

先選 OSM 不呼叫 Google；曾用 Google 後切回 OSM 不宣稱所有 SDK 背景連線已停止，PoC 提示重新整理以開始乾淨 OSM 工作階段。

### 驗證狀態

使用者授權 PoC 專屬型別檢查、針對性單元測試、啟動服務與瀏覽器驗證後：

| 檢查 | 結果 |
|---|---|
| `tsc -p poc/map-provider/tsconfig.json` | 通過，包含共用核心與 PoC；不是正式專案全套 typecheck |
| `vitest run src/geo/map-renderers.test.ts src/modules/place/google-map-controls.test.ts` | 2 個檔案、25 個測試通過；包含既有 Google controls 與新增 Google 授權失敗測試 |
| OSM 真實瀏覽器 | 底圖及道路實際截圖可見、3 個圖釘；清單聚焦、圖釘選取、fitMarkers 可操作 |
| 390 px 手機 viewport | 無水平溢出；canvas 寬 349 px／高 478 px，非零尺寸 |
| 快速重新載入／取消 | 最終只有 1 個 renderer host、3 個 markers，無 pageerror；被取消的舊 GeoJSON 請求可能正常顯示 ERR_ABORTED |
| OSM 冷啟動 | 沒有 Google SDK script；沒有自動切 Google |
| Google 真實底圖 | 未通過／不再重試：現有 key 的 referrer 限制不允許 127.0.0.1:5176，回 RefererNotAllowedMapError；使用者確認是預期限制，不修改 key 或來源設定 |

Google 實測發現授權失敗也可能觸發 idle，因此新增 gm_authFailure 訂閱，並以單元測試驗證初始／延遲授權錯誤與清理。修正後未再次嘗試真實 Google API；不能宣稱 Google 真實切換／底圖已通過。key 沿用原 VITE_GOOGLE_MAPS_API_KEY 與根目錄 env 設定，正式 Google 載入方式未變。

PoC 元件與 createRoot 入口分檔，避免更新元件時重複 createRoot 的 HMR 提示；乾淨重新載入後無 pageerror。正式 build、lint、其他測試套件、真實資料庫與同步驗證未執行。隔離預覽服務運行於 5176，未啟動 Python 或修改 maps 專案。

renderer 核心已實作，不代表搜尋／routing adapters、正式圖磚、持久化與 IndexedDB＋UI 整合已完成。
