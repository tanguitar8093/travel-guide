# 地圖抽換第一階段實作計畫

狀態：**僅完成程式碼分析與計畫，尚未實作或執行驗證。**

依據：[初步評估](map-provider-assessment.md)、[整合決策](osm-integration-decision.md)、[maybedo 想法](../../maybedo.md) 與 maps 核心程式。優先保留 Travel 框架；共用造成廣泛特例時，選擇獨立 OSM 版本。

使用者限制：測試須另外取得同意；本階段也不自行執行 build、typecheck、lint、啟動服務、安裝依賴或重建圖資。下列執行驗收只是待批准的計畫，不表示已通過。

實作優先順序：**多個地圖共用方法 → 兩個 provider 接線 → 共用搜尋／路程 → 正式資料與頁面接線 → 額外功能。** 額外功能不列入核心完成條件，不為 OSM 特有功能擴大共用介面。

## 1. 本階段要解決的問題

先確認一套小型 TypeScript 接面，能否讓 Google／OSM 使用相同的建立地圖、更新標記、選取圖釘、聚焦、調整視野與銷毀方法，而不搬進第二套行程邏輯。兩個 renderer 必須在同一批次接線，不能先完成一套完整 OSM 功能再回頭考慮 Google。

先用記憶體中的固定座標與搜尋候選，建立獨立試作入口。第一階段不接正式資料庫、不補舊座標、不改正式頁面，也不決定完整上線方案。

成功後只能得出「adapter 邊界具體可行」，不能直接宣稱資料同步、分享及正式 UI 已相容。後者必須另開第二階段計畫。

## 2. 範圍與檔案

下列皆是**預計**新增／調整，這次只新增本文件。

| 檔案／位置 | 工作內容 | 邊界 |
|---|---|---|
| `src/geo/contracts.ts` | 座標、標記、搜尋、路線、錯誤及能力契約 | 不 import database、React、Google 或 MapLibre |
| `src/geo/create-geo-services.ts` | 組合 renderer、search、routing；集中注入 | 不以全域 mutable singleton 切換 provider |
| `src/geo/input-classifier.ts` | 最後的額外功能：分類座標、長網址／短網址 | 不在核心批次新增；名稱搜尋先用共用接面 |
| `src/geo/adapters/osm/okinawa-dataset.ts` | 覆蓋、預設中心、zoom、版本與圖層需求 | 地圖資料配置與 provider 分開 |
| `src/geo/adapters/osm/maplibre-renderer.ts` | map 生命週期、markers、focus、fit、圖釘選取 | 點圖新增最後再加；不儲存地點、不處理行程排序 |
| `src/geo/adapters/osm/okinawa-style.ts` | 移植 maps 四圖層 style，補 TS 型別 | 只參考底圖 style，不搬原 UI CSS／版面 |
| `src/geo/adapters/osm/local-map-client.ts` | 先 health／TileJSON，再 search／route；URL 解析最後加入 | 檢查 unknown 回應與錯誤；有取消與逾時 |
| `src/geo/adapters/osm/local-search.ts` | 將名稱搜尋結果轉成中立 candidates | 與 Google 搜尋契約一起整理；保留來源與近似位置資訊 |
| `src/geo/adapters/osm/local-routing.ts` | mode 映射、座標轉換、秒轉分鐘 | 不默認把機車／大眾運輸當汽車 |
| `src/geo/adapters/google/google-renderer.ts` | 包裝既有 Google 地圖能力 | 動態載入；選 OSM 不載入 Google 模組 |
| `src/geo/MapView.tsx` | 共用 React host、建立／銷毀、ready／error | 無收藏、行程、登入或權限邏輯 |
| `poc/map-provider/{index.html,main.tsx,fixtures.ts,vite.config.ts,tsconfig.json,README.md}` | 獨立雙 provider 試作；記憶體點位／選取／結果 | 不加正式路由，不 import App／database／Auth |
| `src/modules/place/google-places.service.ts` | 僅在雙底圖比對步驟補 handle 的 focus／視野操作 | 保留既有呼叫方式；不在此階段替換業務服務 |
| `package.json` 與現有 lockfile | 經准許安裝後固定 MapLibre 版本、增加獨立 PoC script | 不升級其他套件；不在文件階段執行 |

`src/geo` 開始時沒有正式頁面 consumer；`poc/map-provider` 從獨立 Vite 入口匯入它。PoC 自己的 TypeScript 設定涵蓋必要 src 檔案，避免試作混入正式 router。接面保持可移植，有實際第二個 consumer 再包成 library。

maps 專案本階段不重構、不修改。缺失的沖繩圖磚留待批准後處理；先沿用其既有服务接面，不將 Python 改寫為 TypeScript。

## 3. 核心介面草案

以下名稱與責任可直接作為實作起點；不是已存在的 API。

```ts
type Coordinate = { latitude: number; longitude: number };
type Bounds = { north: number; south: number; east: number; west: number };
type TravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT' | 'TWO_WHEELER';
type ProviderReference = { provider: 'google' | 'osm'; id: string };

type Marker = {
  id: string; name: string; coordinate: Coordinate;
  sequence?: number; color?: string; selected?: boolean;
};
type MapEvents = {
  onSelect?: (markerId: string) => void;
  onError?: (error: GeoError) => void;
};
interface MapHandle {
  setMarkers(markers: readonly Marker[]): void;
  focus(coordinate: Coordinate, zoom?: number): void;
  fitBounds(bounds: Bounds): void;
  fitMarkers(): void;
  destroy(): void;
}
interface MapRenderer {
  mount(host: HTMLElement, options: {
    center: Coordinate; zoom: number; bounds?: Bounds;
    events: MapEvents; signal?: AbortSignal;
  }): Promise<MapHandle>;
}

type LocationCandidate = {
  key: string; name?: string; coordinate: Coordinate;
  reference?: ProviderReference; address?: string; sourceUrl?: string;
  locationKind: 'point' | 'approximate-center' | 'map-center' | 'user-picked';
  withinCoverage: boolean; warnings: string[];
};
type SearchResult = {
  kind: 'candidates' | 'no-results'; candidates: LocationCandidate[];
  total: number; suggestion?: string; dataVersion?: string;
};
interface LocationSearch {
  search(query: string, options?: { signal?: AbortSignal }): Promise<SearchResult>;
}

type RouteEndpoint = { coordinate: Coordinate; reference?: ProviderReference };
type RouteEstimate = {
  durationMinutes: number; distanceMeters: number;
  estimated: boolean; source: string; dataVersion?: string;
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
  snapDistancesMeters?: [number, number]; warnings: string[];
};
interface Routing {
  estimate(origin: RouteEndpoint, destination: RouteEndpoint, mode: TravelMode,
    options?: { signal?: AbortSignal }): Promise<RouteEstimate>;
}
type GeoErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_INPUT' | 'UNSUPPORTED_MODE'
  | 'OUTSIDE_COVERAGE' | 'NETWORK_REQUIRED' | 'SERVICE_UNAVAILABLE'
  | 'DATASET_MISMATCH' | 'NO_ROUTE' | 'CANCELLED';
type GeoError = Error & { code: GeoErrorCode };
```

契約補充：

- 所有 domain 座標是 WGS84，经纬范围及有限值先檢查；adapter 才轉 Google lat/lng 或 `[longitude,latitude]`。
- `MapHandle.destroy()` 可重複呼叫；清除 marker listeners、map events、renderer instance 與 host。非同步 mount 完成时 host 已卸載，立即 destroy。
- `fitMarkers()` 適用目前標記；無標記保持視野。沖繩全景由 consumer 呼叫 dataset.bounds 的 `fitBounds`，避免把「沖繩」寫死在通用 handle。
- `setMarkers()` 不自動改視野，由 consumer 明確 fit；點選不寫資料，僅回傳 marker ID。
- 候選 key 是搜尋結果身分，不當 Place 主鍵；收藏之後仍由 Travel 建立 UUID。沒有名稱的座標候選可存在，儲存前才要求輸入名稱。
- 有候選但超出範圍仍可回傳並標示；路線不支援時明确報錯。不能在圖資邊界外直接刪除正式地點資料。
- 空白／一般名稱查無結果是 `no-results`；非法網址、服務失敗與取消是不同錯誤，不用 false 全部合併。
- capabilities 與 dataset metadata 另由服務組合提供：支援模式、bounds、初始中心、zoom、attribution。初始化不依單一 API key 決定所有能力。選位與短網址能力最後才擴充。
- geometry 是預留的選用資料，本階段不新增路線繪製功能；Google 現有 estimate 不提供 geometry，不將兩者視為保證等價。

## 4. OSM 接線規格

PoC 設定一個 `serviceBaseUrl`，透過自己的 Vite proxy 前綴 `/local-map` 存取 maps；正式 Vite 設定與 `.env.local` 保持原樣。不在 browser 硬編碼每位訪客的 localhost 為正式部署方案。

| maps 接面 | adapter 轉換／檢查 |
|---|---|
| `GET /api/health` | 驗證 bounds／資料時間；固定沖繩配置與服務 metadata 不符時拒絕繼續，不只讀 ok |
| `GET /tiles.json` | 圖層必須含 land／water／coastline／roads；檢查 zoom、bounds；tiles 相對 URL 以服務 base 路由解析，不能依 Travel origin 直接拼出錯誤路徑 |
| `GET /api/search?q=...` | JSON unknown 驗證；coordinates → Coordinate；保留 total／suggestion／source／names／locationKind；OSM ID 與 UUID 分開 |
| `POST /api/route` | `{points:[[lng,lat],[lng,lat]],mode}`；car/walk/bike 對應三種支援模式；`Math.ceil(duration / 60)`、distance 公尺；取兩點唯一 leg 的 geometry／snapDistances |
| `POST /api/parse-map-url` | 最後才接入；保留 inBounds、locationKind、warning；不作為共用搜尋完成條件 |

現有服務主要回傳 400＋error 字串，沒有稳定 machine error code。client 先自行檢查格式、範圍與交通方式；剩餘錯誤以中立訊息表達，不用中文字串比對假裝精準區分 NO_ROUTE。若需要稳定錯誤分類，另列服務端增量改動，不改演算法。

底圖 tiles 由版本 URL 快取；API 回應不加入永久快取。搜尋取消與過期回應隔離在 consumer／client，切換 provider 後舊結果不能覆蓋新 state。MapLibre 依賴動態載入，僅在 OSM renderer 使用時初始化。

### 額外功能的輸入派送草案（最後才實作）

1. 明確識別支援的 Google URL；長網址走座標解析，短網址先檢查 allowNetworkExpansion。禁止展開時回 NETWORK_REQUIRED。
2. 明確座標文字（完整兩個數值）轉成候選，檢查範圍，不送名稱搜尋。
3. 非 URL 的一般文字送 OSM 名稱搜尋。看起來是 URL 但不支援的輸入回 UNSUPPORTED_INPUT，避免送成景點關鍵字。

PoC 可沿用 Python parser 作 URL 接面；未來純前端長網址解析是另外一項優化。短網址與本機 HTTP 請求不能混稱「完全不需要網路」。

## 5. Google 比對範圍

第一階段只要求兩底圖共用 **renderer 契約**。Google 搜尋 widget 与 Google routing 的中立化是第二階段，先列差異，不在本 PoC 假装已替換所有 Google 功能。

現有 `GoogleMapHandle` 只有 setMarkers／destroy。Google adapter 可將 Marker 映射到既有資料型別，但 focus、fitBounds 無法由外部取得底層 map 完成。

若執行雙底圖試作，預計只增補底層 GoogleMapInstance 型別与 handle 的 focus／fitBounds／fitMarkers；既有 mount 參數与 setMarkers 的使用方式保持相容。既有 destroy 也需實際檢查 map listeners 的清理。onPick 最後再做。若必須為此重寫 Place／Region／Itinerary／RouteCalculator，立即超出本階段範圍。

PoC 透過兩個 renderer factory 注入同一個 MapView，不讓 MapView 內部判斷 Google／OSM。Google key 配置缺少時明确顯示不可用；OSM 流程不因此停止。

## 6. 實作批次與交付

| 批次 | 具體工作 | 可讀碼審查的交付 | 執行前提 |
|---|---|---|---|
| A | 先定共用 renderer 方法、座標／ID、dataset、組合方式與 fixtures；搜尋／路程只定契約 | 方法逐項對照 Google／OSM 的底層實作位置；不含 classifier／pick／快捷動作 | 後續開始實作指示；不需執行命令驗證 |
| B | 同批實作 Google／MapLibre renderer、必要底層增補、tiles client、共用 MapView 與独立 PoC | 同一 fixtures、同一 consumer 使用兩個 adapter；先確認方法共用 | 安裝依賴、外部請求、服務啟動另取得同意 |
| C | 讀碼審查共用邊界；批准後執行核心驗收並記錄整合／獨立決策 | 無 provider 判斷散入頁面；每項記錄通過／失敗／未執行 | 所有測試、build／typecheck、服務啟動与圖資重建皆先取得同意 |

核心批次 A–C 後，後續順序固定為：

| 順序 | 工作 | 完成條件 |
|---|---|---|
| D：共用搜尋／路程 | 同時設計 Google 與 OSM 的名稱搜尋、位置解析及兩點估算 adapter；先不接網址 | 同一 consumer 使用中立名稱／座標與分鐘／公尺；provider 差異留在 adapter；不只完成 OSM 一邊 |
| E：正式整合 | 另定資料庫、同步／分享相容與逐頁接線計畫 | 正式 UI 使用共用方法；位置与端點資料可沿用；不引入第二套行程 state |
| F：額外功能（最後） | 網址／短網址解析、座標文字输入、點圖新增、圖釘快捷動作、路線繪製 | 依需要另定範圍；不阻塞 A–E，不把 provider 特有能力變成必填介面 |

本文件完成後，不自動開始實作。實作時每批維持可審查，發現界面無法隔離就先更新取捨，不為了 PoC 成功擴大正式頁面改動。D–F 是後續順序，須各自具體化；不能跳過共用方法與資料整合先開發額外功能。

## 7. 驗收與停止條件

### 純程式碼審查：可在不跑測試下判斷

- contracts 不依賴 provider、UI 與資料庫；adapter 不依賴正式 modules。
- 原 routes／App／Auth／database facade／資料模型／migration 無變更。
- 沒有移植 maps 的 trip array、localStorage、排序、十站 UI 限制。
- Google／MapLibre 判斷僅位於組合入口与 adapters；MapView 與候選清單共用中立資料。
- 所有 lat/lng 序列、秒／分鐘與資料來源轉換有明确位置。
- Google 原有服務改動僅為 renderer 底層能力增補，沒有順帶重寫业务流程。

### 執行驗收：等待批准後才有證據

| 場景 | 通過條件 |
|---|---|
| 同一個 fixture 切 Google／OSM | UUID、名稱與選取保持一致；無重新建檔 |
| 清單點選、圖釘點選、全程／全景 | 回傳同一 marker ID；focus／fit 行為符合接面 |
| 多次掛載／切換／卸載 | 無殘留圖釘／listener、舊 callback 或過期 state 更新 |
| D 批次：共用名稱搜尋 | Google／OSM 回傳同一候選型別；多筆、查無結果與錯誤分別表示 |
| D 批次：共用兩點估算 | 回傳中立分鐘／公尺、來源與静態估算提示；不將不支援模式替代為 car |
| 服務不可達／缺圖資／metadata 不符 | 可理解的失敗資訊；不回退到 Google |
| OSM 模式禁止外部地圖請求 | 核心底圖只使用批准的本機服務；D 批次再涵蓋名稱搜尋／道路估算；不接短網址 |
| typecheck／build | 批准後執行指定範圍，記錄命令與結果，不自行擴大測試 |

**停止並考慮獨立兩套：** 為 renderer PoC 就需要改多個正式頁面與 controller；共用搜尋要求長期保留兩套 UI state；同一行程服務被迫到處分 provider；OSM runtime 部署不符合產品使用方式；或使用者決定只要永久限定沖繩的獨立版本。

**允許進入第二階段：** 靜態依賴邊界清楚，且經批准的關鍵執行驗收通過。若只完成讀碼，結論只能是「具備實作條件、尚待運行驗證」。

## 8. 第二階段另需定稿的內容

若第一階段通過，再逐項列正式檔案 diff：Place 位置／來源、中立 RouteMap endpoint、Supabase 欄位／CHECK、repository 映射、同步 RPC 与舊 outbox、backup／shared／public snapshot，以及逐頁接線順序。

還需解決 Google 搜尋 widget 改共用搜尋資料接面、Google 路線座標與 optional reference 的使用、OSM readonly catalog 的按 ID resolve、位置變更造成路程失效，以及正式部署。這些不由第一階段 renderer 成功推定完成。

先不猜精確工期。核心批次 A–C 的實際 diff 與批准後驗收結果，才是估算後續共用搜尋／路程、全面整合或獨立 OSM 版本的依據。額外功能 F 最後再獨立估算。
