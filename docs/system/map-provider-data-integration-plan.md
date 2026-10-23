# Google／OSM 共用轉換層與資料整合規劃

日期：2026-10-23（Asia/Taipei）。

狀態：**第三階段 A／B 的本機相容層已完成限定驗證：IndexedDB v11、marker／端點、備份 v3 與同步版本防護。** 未部署雲端、未啟用正式 OSM 寫入。A 的紀錄見第 13.8–13.10 節；本次 B 的實作與使用者確認的雲端邊界見第 13.11 節，驗證結果見第 13.12 節。

## 1. 範圍與結論

本次僅參考使用者核准、今天新增的四份專案文件：[初步評估](map-provider-assessment.md)、[整合決策](osm-integration-decision.md)、[第一階段計畫](map-provider-poc-plan.md)、[接續紀錄](map-provider-session.md)。沒有讀取未勾選的 `maybedo.md`，也沒有沿文件連結擴大閱讀其他專案 Markdown。概念以這四份已核准文件中的記載為準。

另對照目前正式程式、checked-in migrations 及兩個 UI demo。沒有連線檢查實際 Supabase schema、資料筆數或各裝置的 IndexedDB，也未重新盤點 maps 專案；其圖資／服務能力採今天文件記錄，實作前仍需確認。

**建議維持單一 Travel 專案、一份業務資料與操作流程，加上輕量 geo 轉換層，分批實作 Google／OSM adapters。**

- 地圖供應商與資料庫來源是兩個獨立設定，不是 Google 對雲端、OSM 對本機。
- UI 設計通過，不等於雙 renderer 或中立資料契約已驗證。
- 真正的大改動是位置、試算端點，以及同步／備份／共享／公開的資料契約，不是下拉選單。
- 保留現有 UUID、行程、標籤、關聯與 database facade；不建立 Google／OSM 兩份收藏資料。
- 先完成真正的雙 provider 核心驗證，再遷移正式資料與逐頁接線；額外功能最後。

### 現有 demo 能證明什麼

| 項目 | 目前狀態 | 不能據此推定 |
|---|---|---|
| [OSM UI](../../poc/osm-ui/main.tsx) | 用預覽插件替換正式元件的 controller／renderer；範例資料在記憶體 | 正式 facade、業務驗證、同步或雙 provider 已整合 |
| [設定 UI](../../poc/map-provider-settings/MapProviderSettingsDemo.tsx) | React 下拉選單切換 SVG 地圖風格；不儲存、不呼叫地圖服務 | Google／MapLibre 真實 renderer 可在正式資料上切換 |
| [靜態設計稿](../../poc/ui/map-provider-osm.html) | 保存 UI 外觀與流程 | 搜尋、路線、儲存或部署可用 |
| 共用 geo 模組 | 後續已實作中立契約、Google／MapLibre renderer 及隔離 PoC | 正式資料／UI、搜尋與路線已接線 |

## 2. 現有程式對資料設計的約束

| 實際入口 | 已確認現況 | 必須改動的原因 |
|---|---|---|
| [models.ts](../../src/database/models.ts) | Place 無座標；Region 有 center；試算端點／額外地點綁 Google ID | OSM 無法從 Google ID 離線還原位置 |
| [validation.ts](../../src/database/validation.ts) | Place 必須 ID 或網址；試算額外地點必須 Google ID | 要接受有效的中立位置，不要求為座標製造 Google ID |
| [database.ts](../../src/database/database.ts)／[sync.database.ts](../../src/database/sync.database.ts) | 基底最高版本 10；繼承類別另有 5／6／8／9；Google 複合唯一索引 | 下一版須同時考慮 standalone 與各帳號 hybrid DB |
| [itinerary-map.service.ts](../../src/modules/itinerary/itinerary-map.service.ts) | 按 Google ID 取位置；有 center 的 Region 也會先嘗試 Google | OSM 模式不能由舊流程偷偷觸發 Google 查詢 |
| [route-calculator.service.ts](../../src/modules/route-calculator/route-calculator.service.ts) | resolve、端點相同判斷、移除標記均使用 Google ID | 顯示、實體身分與 provider reference 必須分離 |
| [repositories.ts](../../src/database/repositories.ts)／[supabase.repositories.ts](../../src/database/supabase.repositories.ts) | Google ID 改變才清除受影響路程；雲端更新與清除分多個請求 | 座標變動也要失效；雲端不能半成功留下舊估算 |
| [hybrid.runtime.ts](../../src/database/hybrid.runtime.ts) | 已有自動同步排程、重試、前景輪詢與衝突停止 | 不採舊 skill 中「自動同步未實作」敘述 |
| [backup.repository.ts](../../src/database/backup.repository.ts) | 接受備份 1／2，欄位白名單與跨實體驗證 | 新欄位不能直接塞入舊備份或當作原版本透明擴充 |
| [shared-trip.validation.ts](../../src/database/shared-trip.validation.ts) | 共享文件借用 backup v2 驗證 | 個人資料模型升級會連動共享，不是只改私人 CRUD |
| [公開 models](../../src/modules/public-itinerary/models.ts)／[core.ts](../../src/modules/public-itinerary/core.ts) | snapshot v1；地點採手動白名單；套用會重建 UUID | 位置、來源與新欄位須明確序列化，不能靠型別自動傳遞 |

## 3. 共用轉換層：共用方法，不共用 provider 原生資料

```text
資料／偏好設定 → GeoProvider 設定與組合入口
                         │
Travel UI → controller → service → geo 中立契約
                         │           ├ Google adapter
                         │           └ OSM／MapLibre／本機服務 adapter
                         │
                         └ database facade → IndexedDB／Supabase／hybrid
```

### 3.1 建議責任

| 區塊 | 中立接面／輸出 | 不應承擔 |
|---|---|---|
| contracts | WGS84 Coordinate、Bounds、Marker、候選、路線、錯誤、能力 | React、Dexie、Supabase、Google／MapLibre SDK 型別 |
| renderer／MapHandle | mount、setMarkers、focus、fitBounds、fitMarkers、destroy | 查地點、寫資料、改行程順序、權限判斷 |
| MapView | host／loading／error、非同步建立與釋放 | provider 分支、資料遷移、業務 state |
| search／resolver | 搜尋候選、依 reference 解析位置；區分即時資料與可保存資料 | 把 Google details 一律標成可保存 |
| routing | 中立起終點、交通方式 → 分鐘／公尺／來源／警告 | 用汽車假裝替代機車或大眾運輸 |
| navigation | 建立外連 Google Maps URL | 決定 renderer 或儲存 provider 回傳網址 |
| 組合入口 | 依選項建立一組 renderer／search／routing／capabilities | 在每個頁面散布 Google／OSM 條件 |

初期一個下拉選單選一組 provider 能力，不新增三個分開選的產品設定；但內部 renderer、search、routing 仍是三個小接面。dataset 是 OSM 的配置，不是第三種 provider。導航維持 Google Maps 外連，不等於使用 Google SDK。

沿用第一階段計畫中的方法，不新增大型 plugin framework。後續已實作 geo contracts、MapView 與兩組 renderer adapters；搜尋／resolve／routing 與正式應用組合仍待接線。

### 3.2 必須修正的 Google 邊界

現有 [google-places.service.ts](../../src/modules/place/google-places.service.ts) 把地圖、搜尋與路線都接到 Places loader。共用化時應拆出按需 SDK loader，避免「畫地圖也必須先拿 Places」成為中立接面的前提。

- Google renderer 可先包裝現有 marker 實作，補 focus／視野及完整 cleanup。
- Google search 的 DOM autocomplete widget 不能直接當成 `search(): candidates`。需另外評估目前 SDK 的資料式 autocomplete／details 接面與 session token，兩 provider 一起接共用搜尋 UI；不是替換型別名稱便完成。
- Google routing 現在只接受 Google ID。要增補合法座標端點，才能估算使用者／OSM 位置；實作時核對實際 Routes SDK 接面、限制及條款，不能假設任意字串 ID 均可。
- OSM renderer／搜尋／路線走自架服務；保留 source、datasetVersion、覆蓋及不支援的交通方式。
- 開始即選 OSM 時不載入或呼叫 Google；已用過 Google 再切 OSM，只能承諾停止應用端新的 Google 操作，不能宣稱已載入 SDK 的所有背景連線都能安全卸除。若需嚴格零 Google 網路，提供重新載入到 OSM 的路徑並驗證。

### 3.3 切換行為

1. 保留旅行資料、UUID、日期、選取、起終點與自行命名；關閉／取消尚未確認的搜尋候選。
2. 取消舊 provider 的請求；以 generation／AbortSignal 隔離遲到結果，卸載後不得更新畫面。
3. 清理舊 renderer、markers、events、ResizeObserver，建立新 renderer，再套中立 markers 與合法視野。
4. 不因 OSM 範圍限制覆寫 Region 或地點，不把範圍外資料搬到沖繩。
5. 新 provider 失敗時保留使用者選擇與資料，提供重試／明確切回；不得暗中 fallback 或顯示舊底圖卻標成新 provider。
6. 清除未儲存的試算結果；已保存的估算保留並顯示來源，不因切換設定批次清空行程。

### 3.4 設定保存建議

**第一版建議為裝置／瀏覽器偏好，不加入業務資料庫與同步。** 預設 Google 維持正式產品既有行為；OSM 是否可用由部署能力決定，不靠 Google key 控制。

- 三種資料模式使用同一偏好，不因切換資料庫來源改變。
- 使用獨立 preference key 與訂閱事件；讀寫失敗明確顯示，不能宣稱保存成功。
- 不匯出到旅行備份、不推入 outbox、不覆寫同帳號其他裝置的選擇。
- 若要帳號跨裝置同步設定，另做 settings entity／RLS／sync；不是此建議的隱含功能。

此為待產品確認的建議，不是已獲核准的持久化決策。

## 4. 中立資料模型：建議定稿方向

### 4.1 可保存位置與即時位置分開

已完成的中立契約以 [contracts.ts](../../src/geo/contracts.ts) 為準，資料層直接引用型別，不另造平行版本：

```ts
type Coordinate = { latitude: number; longitude: number };
type LocationKind = 'point' | 'approximate-center' | 'map-center' | 'user-picked';
type LocationMetadata =
  | { source: 'user' | 'legacy-user'; kind: LocationKind }
  | {
      source: 'osm';
      kind: LocationKind;
      reference: { provider: 'osm'; id: `node/${string}` | `way/${string}` | `relation/${string}` };
      datasetVersion?: string;
    };
type StoredLocation = LocationMetadata & { coordinate: Coordinate };
```

- 地點名稱仍是使用者名稱，不把 provider 的 displayName／地址當成可以直接永久保存的欄位。
- Google reference 先沿用既有 `googlePlaceId`，由 mapper 轉成中立 runtime reference；本次不為改名全面搬欄位。
- Google details 的座標／地址／viewport 只在受允許的 Google runtime 使用，不寫入 `StoredLocation`，也不自動拿到 OSM 畫圖。
- `source: user` 代表真正獨立輸入／選位，不是把 Google 回傳結果按「確認」就換標籤規避來源限制。
- 區域沿用 `center`，新增 `centerMetadata?: LocationMetadata`，避免另存一份相同位置。舊 center 可標 `legacy-user`，但批次轉換前仍需確認其實際來源。
- `reference.id` 不含 datasetVersion 作為身分；資料更新不應使同一 OSM feature 變成另一個收藏。執行期另驗證正整數 ID，不能只靠 TypeScript template literal。

目前已查閱 [Google Places 政策](https://developers.google.com/maps/documentation/places/web-service/policies)：place ID 有保存例外，但一般 Places content 的儲存及跨非 Google 地圖呈現受限制。正式 Google SDK 路徑、區域條款與 Routes 結果保存仍須實作前核對；本文件不是完整授權或法律判定。

### 4.2 實體改動

| 實體 | 建議新增／變更 | 保留不動 |
|---|---|---|
| Place | `location?: StoredLocation`；新增可只用有效 location 儲存的路徑 | UUID、使用者名稱、筆記、icon、區域／標籤、mapsUrl、googlePlaceId |
| Region | `centerMetadata?`；搜尋 OSM 後保存合法 center 及來源；Google-only region 保持未補位置狀態 | center 的既有名稱／格式、zoom、UUID、googlePlaceId |
| RouteMapPlace | `googlePlaceId` 改 optional；新增 `location?`；新 OSM／使用者地點必須有位置與自行命名 | UUID、routeMapId、舊 Google marker 與名稱 |
| RouteMap | 新增 `origin?`／`destination?` 中立端點；舊 Google 端點欄位留相容讀取 | UUID、tripId、selectedDate、transport、既有一行程一地圖規則 |
| ItineraryItem | 建議新增 optional `travelEstimateContext`，記來源／交通／位置指紋／datasetVersion | 原分鐘、公尺、planned arrival、順序與地點引用 |
| Trip／Label／關聯表 | 無地圖專屬新欄位 | 既有關聯與規則 |

Place 驗證改為「有效 location、有效 Google ID、有效 mapsUrl 至少一項」。舊未定位資料仍可編輯筆記，不要求先補座標；新 UI 中的 OSM／使用者選位若未完成，不得靠空網址假裝成功。

`travelEstimateContext` 是小型來源物件，不存 Google 原生 response 或路線 geometry。舊無 metadata 的估算顯示「既有估算／來源未記錄」，不推測來源；Google 結果是否可持久保存的條款確認為正式路線接線的前置，不能把現況當作新功能的授權依據。

### 4.3 試算端點：建議使用明確 union

建議保存四種端點，而非將所有來源強迫變成收藏地點：

| kind | 保存內容 | 使用方式 |
|---|---|---|
| `place` | 私人 Place UUID | 當下從既有 repository 讀位置／使用者名稱 |
| `shared-place` | 共享 trip UUID＋共享文件內的 Place UUID | 依共享文件解析，不假設私人 places 表有此 ID |
| `route-map-place` | RouteMapPlace UUID | 必須屬於此 RouteMap |
| `location` | 端點自己的 UUID、自行命名、可保存 location 或 legacy Google ID | 搜尋結果直接當端點，不強迫加入收藏或額外 marker 清單 |

`location` variant 的欄位要逐一白名單驗證；只有 Google ID 的舊端點允許無名稱／無永久座標。新使用者／OSM 端點需非空自行命名。Google 搜尋結果仍只保存允許的 ID，名稱由使用者填寫或留 runtime。

相同端點不能再只比較 Google ID：引用型用 kind＋scope＋UUID；inline 候選以完整 provider reference／明確選取身分判斷。相同座標不是實體主鍵，也不能拿不同 provider 的相同字串 ID 當成同一地點。

引用型端點要檢查同 owner／同 map／共享存取及刪除後處理。建議引用目標被刪除時，同交易清空受影響端點，不刪地圖或其他資料；共享取消、撤權時則顯示不可用並要求重選，不能繞過權限從私人表查找。

這是本次新增的具體建議，實作前需確認端點 union；不是既有 schema。

## 5. IndexedDB 具體改動

| 項目 | 工作內容 |
|---|---|
| domain／validation | 新增位置與來源驗證；新舊端點 normalize；保留未定位舊資料 |
| Dexie schema | 建議基底下一版 11；需先核對開工時最高版本，且同時演練 standalone、帳號 DB 的升級路徑 |
| routeMapPlaces 索引 | 保留既有 Google 複合唯一索引供有 ID 的舊資料使用；Google ID 變 optional，不再視為每筆必有 |
| OSM 去重 | 建議增 unique compound `[routeMapId+location.reference.id]`；無 reference 的座標地點不以座標硬去重 |
| Region／Place 新欄位 | 非索引欄位不需要單獨為每欄升版；統一隨此批 schema 發布，不加沒有查詢需求的座標索引 |
| repository | 建立／修改／刪除端點引用驗證；位置變動與路程失效置於同交易 |
| shared cache | 共享文件及 before／after／conflict 都能讀取新版位置 |
| public catalog | 其 DB 目前最高版本 2；snapshot 升版不代表索引一定變更，只有需資料 upgrade 時才新增其下一版 |

OSM reference 索引以完整 `node/…`／`way/…`／`relation/…` 字串為鍵，實作時以 Dexie 的 nested key path 能力驗證；不新增會漏進 sync payload 的衍生私有欄位。若一筆含 Google ID 與 OSM reference，兩個唯一約束都生效。先盤點重複資料，不靠清空 DB 讓 upgrade 成功。

**升級交易不得呼叫 Google、HTTP 或路線服務。** 不在 Dexie upgrade 裡批次改寫 queued task、baseline 或 receipt 對應 payload。schema upgrade 只做可重跑的結構／必要索引資料處理；需改變業務內容的中立化，另經 repository 與 hybrid mutation 保存。

## 6. Supabase 具體改動

### 6.1 建議欄位與約束

| table | 建議變更 | CHECK／索引／交易要求 |
|---|---|---|
| `places` | 加 nullable `location jsonb` | 嚴格驗證 shape、來源、有限範圍座標；原 ID／URL CHECK 加 location 分支 |
| `regions` | 加 nullable `center_metadata jsonb`，沿用 `center` | metadata 必須對應有效 center；無 center 的 Google-only 舊資料仍合法 |
| `route_map_places` | 加 nullable `location jsonb`；`google_place_id` 允許 NULL | 至少有效位置或非空 Google ID；保留 Google unique；新增 OSM reference 的部分唯一 expression index |
| `route_maps` | 加 nullable `origin jsonb`、`destination jsonb` | 驗證 endpoint union、同 owner／同 map 引用；保留舊欄位至兼容窗口結束 |
| `itinerary_items` | 建議加 nullable `travel_estimate_context jsonb` | context 與分鐘／公尺一致；位置改變時清除三者 |
| 其他業務表 | 不增地圖欄位 | 不因換地圖改 owner、ACL、UUID 或標籤／日期規則 |

選 JSONB 是因位置及 union 小而有固定 shape，與既有 Region.center 契約接近；不是任意 provider response 儲存區。validator 必須拒絕未知／授權欄位、缺一個座標、空字串、非數值或越界。CHECK 需明確拒絕缺值造成的 SQL NULL，不能因三值邏輯漏驗。

不需要 PostGIS、全量 OSM catalog、路網或圖磚進每位使用者資料庫。沒有範圍／半徑查詢需求，先不加空間或一般 GIN 索引。

端點引用若存在 JSONB，不會自動取得 FK 保護：需同 owner／同 map 的資料庫驗證，並以交易結束時檢查或等價的批次驗證處理「先存 map、後存新增 marker」順序；刪除目標時清空引用。實作時不能只做 UI 驗證或立即 trigger 導致合法同步批次被拒。

### 6.2 不可漏改的 SQL／repository 接面

| 接面 | 必要工作 |
|---|---|
| cloud repository 的 select／row／input／normalize | Region、Place、RouteMap、RouteMapPlace、ItineraryItem 新欄位全部往返 |
| `sync_private.record` | 輸出中立位置、metadata、端點與估算來源 |
| `app_sync_snapshot`／`app_sync_pull`／`app_sync_push` | 協定版本、新欄位白名單、完整 upsert、刪除引用清理、legacy payload 規則 |
| sync events／versions／receipts | 新版本事件相容、版本戳與重試 payload 保持一致；不改已發出事件與 receipt |
| `app_backup_assert_payload`／preview／apply replace／clear | 備份 v3、staging、新欄位、ID 重映射；失敗全回滾 |
| `app_backup_account_signature` | 新欄位也必須影響簽章；避免 preview 後位置改變仍接受舊 token |
| `collaboration_private.shared_document`／`app_shared_trip` | 共享位置、啟用時複製、整份文件驗證、來源去重及 topology 失效 |
| `app_cancel_shared_trip` | 共享轉私人保留位置與來源；不能只按 Google ID／URL 誤合併 |
| `public_itinerary_private.validate_snapshot`／`api` | 新 snapshot version、publish／update／apply 的欄位與 ID 映射 |

私人 Place 更新與路程清除，建議用聚焦的雲端原子操作完成，並讓 sync push 的位置變動規則一致；不要沿用多個 HTTP 請求保證「一定一致」。不順帶重寫無關 CRUD。

incremental migration 不修改／重播 baseline 或歷史 migration，也不先猜檔名。實作時依既有 CLI 工作流產生新 migration；部署前另取得授權、只讀核對 live schema、函式、grants 與版本，再套用新內容。

不擴權：私人 owner／admin 規則、共享角色及公開 snapshot 的既有公開讀取邊界各自保留。公開表現行可匿名讀取，不可誤套「所有資料都禁止 anon」而破壞公開功能；反之也不能把私人位置變成公開。若增 RPC，核對 EXECUTE grants、caller、owner、search_path；不以新增 SECURITY DEFINER 解決權限錯誤。

## 7. 三種資料模式與同步相容

| 操作 | standalone IndexedDB | Supabase direct | hybrid |
|---|---|---|---|
| 換地圖偏好 | 瀏覽器設定，不碰業務資料 | 同左 | 同左，不增加 outbox |
| 新增／補使用者或 OSM 位置 | repository 交易 | 原子 cloud 操作 | facade → LocalSyncStore.mutate → outbox → 現有 auto/manual sync |
| 修改位置、清路程 | 同交易修改相關 items | 同 DB 交易完成 | 同一任務包含位置與失效的 items |
| 未連線 | 已存位置可用；服務能力另判定 | 明確提示無法保存，不假裝本機成功 | 本機保存並留待上傳；帳號隔離不變 |
| 公開／共享 | 沿用各自現有可用範圍 | 沿用公開／共享 RPC | 沿用專屬共享／catalog queue，不強塞私人 outbox |

OSM 不是「整個產品完全離線」的承諾：本機圖資／搜尋／道路服務仍要可達；Auth、雲端與部分共享操作另需連線。

### 協定與舊客戶端：正式發布前的硬前置

現有私人 sync `protocolVersion: 1`，以整筆 `put` upsert；server receipt 對同 operation ID 會比對完整 payload。舊客戶端未認識新欄位，可能驗證失敗或上傳舊 record 清空新內容。

**建議私人 sync 升 protocol v2；新 client 保留 v1 佇列的精確重試能力。** 不只把白名單放寬然後期待安全。

1. 先定 server/client capability 與最低 writer 版本，讓舊 client 明確要求更新，不得靜默丟欄位。
2. 已凍結的 v1 任務保持原 operationId、protocol 與 payload，先詢問／重試原結果；不重新包成 v2。
3. 新 server 保留 v1 receipt 回傳路徑。對尚未套用的 legacy 任務，只有在能證明不覆寫新欄位時才接受；否則回明確版本／衝突錯誤並保留 queue。
4. legacy 任務清理／處理完，新的業務變更才產生 v2 任務；不直接編輯舊 task 冒充重試。
5. v1 事件仍可供 v2 client 正規化；v2 事件不能送給會拒收或刪欄位的舊 writer。cursor 不因換圖或升版歸零。
6. direct repositories、共享 RPC、公開 catalog 的寫入也要有對應版本防護；僅改私人 sync 不夠。增量加欄位階段可維持舊路徑，但在發出新資料前必須限制不安全的舊寫入。
7. 如果無法安全做並行版本，採明確維護／強制更新窗口；不能宣稱只靠前端 Vercel redeploy 就阻止所有舊分頁。

實作前需以 isolated DB 與真實舊 payload fixtures 決定版本路由／維護策略；這是主要風險與工作項，不是已完成的能力。

## 8. 備份、共享與公開格式

- **Backup：建議寫 v3，繼續讀 v1／v2。** 先 normalize 舊格式再驗證完整 graph。cloud replacement 會重建 UUID，必須重映射 `place`／`route-map-place` endpoints；inline 端點自己的 UUID 同樣重新配置。私人全備份不直接匯入共享文件引用；無法合法還原的共享端點明確清空／要求重選並告知，不靜默轉成他人資料。
- **Shared：增 location、Region metadata、estimate context。** 既有共享 `version` 是並行編輯版本，不等於 schema version；需要獨立格式辨識與讀寫能力協商。處理既有 snapshot、before／after、conflict、save receipts，不能借 backup 升版意外改掉共享相容性。
- **Public：建議 snapshot schemaVersion 2，繼續讀 v1。** publicPlace、snapshot validator、雲端發佈／套用、catalog tasks／baseline／receipt 及只讀地圖一起升級。不公開私人筆記、labelIds、owner／ACL、使用者身分等無關資訊。
- 已公開 snapshot 是獨立副本，不因私人補位置就背景改寫；由原擁有者明確更新發布。
- shared／public 保存的是位置及合法來源，不是全量 OSM tags 或 Google details。

## 9. 舊資料補位置與估算失效

### 9.1 補位置

1. 授權後做唯讀盤點，分 Region、Place、試算 marker／端點、shared、public；統計 Google-only、已有合法 center、含明確座標 URL、未定位各類。
2. 保留 UUID 與原 Google ID／網址。只有 Google ID 不能離線推導座標；OSM 模式列未定位原因並提供後續補位置入口。
3. Google URL 中的明確位置也只先當候選；`@lat,lng` 通常是視角中心。URL 的解析不代表永久保存或跨底圖使用已獲授權，須分清來源與確認位置。
4. 名稱匹配不能自動取第一筆或合併收藏；使用者選 OSM 候選或獨立輸入後，經正常 facade 儲存。
5. 可重跑、可取消、逐筆記錄結果；禁止在 schema upgrade、登入或換圖時隱性大量查詢。
6. 不用備份覆蓋／UUID remapping 當作增量遷移，更不清空 outbox 後重新下載。

### 9.2 失效規則

- 位置內容、Google reference、前站、目的地、交通、日期或順序變動，清除受影響 incoming leg 與下一站 leg 的分鐘、公尺、context。
- 相同位置僅改名稱／筆記／標籤，不清除估算；只切 provider 偏好也不改已存值。
- 非同步 estimate 回來前重新比對兩端位置指紋、交通與目前 provider generation，過期結果不得寫回。
- OSM dataset 更新後已存估算標示舊版本，待使用者重新要求計算，不背景覆寫行程。
- 本機、cloud、shared topology 驗證使用相同規則；實際座標不同但 Google ID 未變，也必須失效。

## 10. 分批實作與放行條件

依賴順序為 **P1 → P2 → P3 → P4 → P5**；概念定稿與離線 fixtures 可先準備，但正式資料寫入不得提前。

| 批次 | 具體交付 | 放行條件／停止點 |
|---|---|---|
| P1 真正雙 renderer | contracts、Google／MapLibre adapters、共用 MapView、獨立 PoC；同一批接兩邊 | 同 fixtures 切換、marker ID／視野／cleanup 可驗證；不接正式 DB |
| P2 搜尋／路線契約 | 兩 provider 的名稱搜尋、resolve、routing、能力與錯誤；Google 座標端點及資料保存邊界 | 同 consumer 能使用兩者；不支援模式明確拒絕；不保證 OSM 的 Google-only 資料可用 |
| P3 資料相容基礎 | 位置／端點模型、Dexie v11 建議、repository、SQL migration、協定／備份／共享／公開版本 fixtures | isolated DB 完整往返；既有資料與 queue 保留；先不啟用正式 UI 新寫入 |
| P4 受控部署與正式接線 | 先核對雲端、部署相容層／限制舊 writer，再啟用新 client；Region → Place → 私人行程 → 共享／公開 → 試算 → 設定入口 | 各模組 Google／OSM 與三種資料模式成立，不能有只支援 cloud 的新寫入；未接面的入口須 gate |
| P5 補舊位置與收斂 | 明確補位置流程、分批遷移、觀測；穩定後才討論移除 legacy 欄位 | 不自動覆蓋位置；確認舊 queue／client 退出後才考慮 cleanup migration |

P3 的 schema／協定修改可以先準備，但不推定已獲授權套用至雲端；P4 在新欄位流入任何舊 client 前需完成相容限制。新座標文字／網址解析、短網址、點圖新增、快捷操作與路線繪製仍屬額外批次，不阻塞核心；不因此刪除今天核准的 UI 設計。

### 範圍估量

| 工作 | 相對規模 | 主要變數 |
|---|---|---|
| 下拉設定與偏好 | 小 | 裝置或帳號範圍、失敗 UX |
| renderer 轉換層 | 中 | Google loader 拆分、生命週期、OSM 正式圖磚 |
| search／routing 共用 | 中至大 | Google 資料式搜尋、端點支援、OSM 服務與能力差異 |
| 模型／IndexedDB／cloud repositories | 大 | 試算端點、交易、舊資料與索引 |
| 同步／版本部署／backup／shared／public | 大，最高風險 | frozen retries、舊 writer、欄位白名單、快照獨立性 |

目前不足以給可靠人日；先以 P1/P2 的實際驗證結果估後續，而不是用「加下拉選單」估整合工期。

## 11. 待授權的驗收清單

本次沒有執行以下測試；這是後續實作的驗收規格，不是通過紀錄。

1. 同一 fixtures 切兩 provider 後 UUID、名稱、選取、日期、起終點保持；失敗不 fallback，多次切換無舊 callback。
2. OSM 冷啟動不發出 Google SDK／API 請求；既用過 Google 再切換的限制有明確說明。
3. 地點只有合法 location 可新增；NaN／Infinity／越界／缺一座標／偽造來源與 owner 欄位被拒。
4. standalone 與多個 project/user DB 從既有版本升級，資料／outbox／baseline／conflict 不丟；索引唯一規則一致。
5. IndexedDB、direct cloud、hybrid 完整新增／修改／讀回位置；hybrid 自動同步上傳後另一裝置可讀回。
6. legacy frozen task 精確重試、未知結果重試、v1/v2 混用、舊 writer 拒絕、cursor 前進與斷線恢復均不丟新欄位。
7. backup 1／2 能讀、3 往返及 ID 重映射；preview 後位置改變令舊 token 失效；非法備份完全不改資料。
8. 共享啟用／編輯／取消、公開發布／更新／套用都保留位置；舊 snapshot／queue 可讀，私人欄位不公開。
9. 修改位置時路程原子失效；名稱變動不失效；延遲估算不覆寫新位置／新 provider 狀態。
10. Google-only／範圍外地點明確列未定位／不支援，不刪資料、不錯配到同名第一筆、不改交通模式。
11. 匿名／basic 私人資料拒絕、member owner 限制、admin、共享 owner/editor/viewer、同 owner 引用及公開讀取邊界不變。
12. 批准後分別執行 geo、repositories、migration/RLS、sync、backup、shared/public 相關現有測試；build/typecheck、lint、瀏覽器與 live 驗證各依批准範圍執行。

## 12. 實作前需確認的決策

| 決策 | 本文建議 | 尚待確認 |
|---|---|---|
| 地圖偏好範圍 | 裝置／瀏覽器，不跨裝置同步 | 是否需要帳號偏好 |
| 下拉選項涵蓋範圍 | 一次切換 renderer／search／routing，導航仍 Google 外連 | 是否只要換底圖；若是，需重訂 Google content 邊界 |
| 永久位置來源 | 使用者／OSM；Google-only 保留未定位相容 | Google 資料保存／使用條款的實際適用範圍 |
| 試算端點 | 四種明確 union，不強迫把搜尋端點加入收藏 | 是否接受來源引用與 inline endpoint 的保存行為 |
| 舊 client 發布 | 版本能力防護；無法並行則維護／強制更新窗口 | 是否接受窗口與人工處理未送任務 |
| OSM 部署 | 可達的圖資／搜尋／routing 服務，不把訪客 localhost 當正式服務 | 沖繩圖磚、正式 host、可用性及容量 |

以上決策未核准前，不開始正式 schema／資料遷移。UI 設計稿與本規劃均不代表已取得測試、安裝、服務啟動或雲端寫入授權。

### 外部規範查核

本次僅查閱一般官方文件，未傳送專案內容或連線至專案資料庫：

- [Supabase changelog](https://supabase.com/changelog.md)：近期索引提及 TLS cipher 停用，屬連線相容性議題，非本次地圖 schema 需求；未據此修改環境。
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security.md)：確認 grants 與 RLS 是不同層，新增／修改 API 不能只靠前端 gate。
- [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)：確認 place ID 例外與一般 content 的保存／呈現限制；其他 Google SDK／Routes 的具體選型仍待實作階段核對。

## 13. 第三階段 IndexedDB 實作設計與測試先行

本節的「第三階段」指使用者確認的「最小共用契約 → renderer 核心 → IndexedDB 資料相容層」，不是第 10 節原評估表的整體 P3 全部內容。測試規格與開始設計已獲確認；後續另獲准執行第 13.8 節限定基準，**不修改正式 model／repository／schema、不連線雲端**。

### 13.1 不可破壞的相容邊界

1. 新欄位 optional；舊 Google-only、URL-only、Region.center、試算端點原欄位全部保留。缺少新欄位時走既有 Google 行為，不改原 SDK loader、key 讀取及正式頁面。
2. 不從 Google ID、Google details、地圖 URL 或名稱自動補座標；不把舊 center 擅自標成已驗證的 user 來源。來源不明的 legacy center 保持原樣，跨 provider 呈現另由 operation 層決定。
3. 不更換 UUID、不複製成兩套收藏、不改標籤、行程日期、順序、trip-region 關係或原刪除限制。切 renderer 不寫業務資料，也不清 outbox。
4. repository 接受的新增欄位必須真的驗證；「附帶有效 Google ID 所以忽略非法 location」不可接受。未知位置欄位也不能直接展開保存。
5. 瀏覽器 schema 能存不代表雲端可同步；正式 OSM 新寫入必須等整條資料路徑就緒，不能靠剝除 location 降級成成功。

### 13.2 型別、驗證及寫入安排

| 位置 | 設計 |
|---|---|
| [models.ts](../../src/database/models.ts) | Place 增 `location?: StoredLocation`；Region 增 `centerMetadata?: LocationMetadata`，繼續只有一份 center；型別從 geo contracts 以 type-only import 引入，不從含 renderer runtime 的 geo barrel 引入 |
| [validation.ts](../../src/database/validation.ts) | 抽共用位置／metadata validator；CRUD 與備份共用。座標須為有限 number，緯度 [-90,90]、經度 [-180,180]；不把 OSM dataset 覆蓋限制當作業務資料合法範圍 |
| 位置 shape | 拒絕 null、陣列、缺座標、未知 source／kind／欄位；OSM 必須有 `reference.provider = osm` 及完整 `node/…`、`way/…`、`relation/…` 正整數字串；不轉 number 以免 ID 精度流失；可選 datasetVersion 若提供須為非空字串 |
| 來源 | user／legacy-user 不接受偽造的 provider reference 或 datasetVersion；Google runtime location 不可寫入 StoredLocation。合法來源標籤是驗證條件，不是能證明輸入實際來源的授權機制 |
| Place 必要位置資訊 | googlePlaceId、mapsUrl、location 至少一項有效；每個「已提供」欄位仍須各自合法。舊 records 沒有 location 時不補預設值 |
| Region | 有 metadata 必須同時有合法 center；Google-only 無 center 仍合法；舊 center 無 metadata 仍可讀寫。不得因擴充提高舊資料保存門檻 |
| [repositories.ts](../../src/database/repositories.ts) | 在既有 Place update 交易內比對位置、寫 record、清除受影響估算；保留 injected DB 與 singleton 兩種使用方式，不新增第二套資料 API |

不在這個相容層保存 provider response、Google 地址／viewport、全量 OSM tags 或 routing geometry。Location 的更新採整個小物件取代，不把不完整 nested patch 合成不明來源資料。

### 13.3 位置變動與估算交易

- 保留現有 Google ID 變更的失效行為；加入 StoredLocation 的新增、移除及有效位置變更。
- 比對明確欄位，不靠物件 reference 或 JSON key 順序：Google ID、座標、source、kind、OSM reference。相同值重新傳入不算移動。
- name、notes、icon、labels 的變更不清估算；只更新 datasetVersion 不代表座標改變，不因此背景覆寫或重算。
- 對所有引用該 Place 的 itinerary items，各清「本站 incoming leg」與同 trip／date 排序的下一站；用 Set 去重，不跨天，不漏掉其他行程中的相同 Place。
- 同交易清 travelDurationMinutes／travelDistanceMeters，未來若有 estimate context 也一併清；arrivalTime、durationMinutes、note、order 不動。任一寫入失敗，Place 和所有 items 全部回滾。
- hybrid 仍透過既有 facade → LocalSyncStore.mutate；上述 Place 與 items 都必須出現在同一個 outbox task，不能只 queue Place。

`travelEstimateContext`、路線結果 stale guard、OSM routing 本身不在這批 IndexedDB 實作內；不為了地點可存而提前增加未接線的估算格式。

### 13.4 Dexie v11 與升級策略

開工時重新核對最高版本；目前基底與帳號庫最高為 10，預計下一版為 11：

```ts
this.version(11).stores({
  routeMapPlaces:
    '&id, routeMapId, &[routeMapId+googlePlaceId], &[routeMapId+location.reference.id]',
})
```

此為完整 route-map marker 擴充階段的目標 schema，不是已套用程式碼。Place／Region 的非索引欄位本身不需要改索引；若先實作這兩者而 marker 規格未定，不提前宣稱 v11 已完成。

- 保留所有原索引，OSM 複合唯一索引只為具有合法 reference 的 marker 建鍵。沒有 Google ID／OSM reference 的 user-picked marker 不用空字串占位，不以座標強制去重。
- `node/123` 與 `way/123` 是不同 reference；datasetVersion 不納入唯一鍵。一筆同時有 Google ID 和 OSM 位置時兩個唯一約束均成立。
- repository 查 Google 複合索引前判斷 ID 是否存在，避免 `[mapId, undefined]` 成為非法 IndexedDB key；OSM 查詢同理。
- TravelDatabase 的新版本由 SyncDatabase 繼承；不重宣告舊 5／6／8／9／10 版本，不新建另一個帳號資料庫名稱。
- upgrade 只調整 schema／必要索引；不改寫業務 records、frozen payload、operationId、baseline、cursor 或 conflict review，不呼叫網路。
- schema 升級失敗應明確報錯並保留舊資料；禁止刪庫重建。若需在後續對業務內容補來源，須走正常 repository／hybrid mutation。
- 升級後舊程式開庫可能收到 VersionError；「不影響 Google」不等於舊二進位可任意降版。多分頁 blocked／versionchange 提示與正式發布窗口需在接 UI 前驗證。

### 13.5 marker／端點與完整格式的接續工作

Place 與 Region 可先做相容型別及 isolated repository 實作；正式新增入口仍不啟用。RouteMapPlace 的 optional Google ID、OSM 唯一鍵、名稱規則，以及 RouteMap 的四種 endpoint union，需配套測試後再接入。

endpoint 保存格式沿用 [contracts.ts](../../src/geo/contracts.ts) 的 `RouteEndpointSelection`，不另外發明平行格式。讀取優先使用有效的新欄位，缺少才 normalize 舊 Google ID；新舊欄位衝突必須拒絕或由明確的相容 mapper 統一，不能兩個來源各自更新。引用刪除／跨 map／shared 撤權／備份 UUID remapping 的驗證尚未由本批測試覆蓋，因此不能認定端點儲存已放行。

Backup v3 是已確認的測試目標：保留可保存位置、繼續讀 v1／v2；新欄位不能偷塞進仍標 v2 的輸出。輸入驗證、完整匯出／替換往返、非法 graph 不改庫、各模式 UUID 重映射，都完成後才啟用正式新格式寫入。共享／公開格式另有獨立版本邊界，不跟著備份 validator 意外升級。

### 13.6 三模式放行與同步限制

| 模式 | 相容層開發期間 | 正式 OSM 寫入前置 |
|---|---|---|
| standalone | 舊 Google／URL 寫入照舊；新位置只在 isolated DB 測試 | repository、備份完整往返、刪除與端點規則通過 |
| direct cloud | 本階段不改雲端、不嘗試寫入新欄位 | schema／mapper／原子位置更新／新格式驗證及舊 writer 防護完成 |
| hybrid | 保留既有自動同步；不讓尚未支援的新 payload 流入正式佇列 | server／client 協定兼容完成，新位置及受影響 items 沿原 mutate → outbox → 自動同步路徑；不能改成只留本機或手動上傳 |

本批 hybrid 測試僅證明 isolated LocalSyncStore 可把新物件與 queue 原子保存，**不代表 protocol v1 或 live server 接受該 payload**。正式啟用需完成第 7 節版本協商／精確重試設計，保留未知上傳結果的 legacy tasks。此 gate 是尚未發布功能的依賴順序，不是已獲同意把產品降成 local-only。

### 13.7 已落地測試與尚未驗證項目

- [契約測試](../../poc/indexeddb-geo/indexeddb-geo.contract.ts)：Google 回歸、OSM 位置持久化與非法輸入、估算原子失效、舊 v10 schema 升級 fixture、hybrid queue 原子性，以及 backup v3 最小驗證目標。
- [獨立 Vitest 設定](../../poc/indexeddb-geo/vitest.config.ts)：只收 `.contract.ts`；不由一般預設 `.test`／`.spec` 收集，避免預期紅燈污染既有回歸。
- 舊庫 fixture 固定使用 pre-extension v10 的 store 定義，不以新 schema 反向建立「舊庫」。目前含原樣保留 queue／metadata／baseline／conflict 的斷言；不是合法 cloud payload 的精確重試驗證，也還沒有要求目標 verno 必須升到 11 的斷言。
- Google 回歸是應保留行為；OSM 組與 backup v3 是未實作的預期需求，現在可能失敗。寫了 assertion 不等於通過。
- 尚缺：Region metadata 專用案例、OSM marker CRUD／唯一索引、endpoint graph、跨行程／跨天完整失效矩陣、hybrid 失效 items 全部入 queue、帳號切換、新舊 writer／receipt 往返、完整備份替換、shared/public 及真實瀏覽器版本升級。
- 撰寫規格時未執行測試；後續限定基準結果見第 13.8 節。**未執行 typecheck、build、lint、瀏覽器或 live DB 驗證。** Google 實際 API 仍不重試；保持原 key 載入方式。

若使用者另行批准，最小驗證入口為 `vitest run --config poc/indexeddb-geo/vitest.config.ts`，並另跑相關既有 repository／sync／backup 回歸；未取得授權前不執行。第三階段實作完成仍需補齊對應缺項與正式 typecheck，不能把這份先行測試當作整合驗收完成。

### 13.8 首次紅／綠基準（2026-10-23）

使用者選擇先跑限定基準；沒有實作正式資料層，也沒有為了變綠改弱斷言。

| 執行範圍 | 結果 |
|---|---|
| `route-map.repository.test.ts`、`local-sync.store.test.ts`、`backup.repository.test.ts` | 3 個檔案、39 項全部通過 |
| `vitest run --config poc/indexeddb-geo/vitest.config.ts` | 29 項：8 通過、21 失敗 |

契約測試的 8 項通過為 Google 相容性 6 項，以及 standalone／hybrid 舊 v10 fixture 原資料保留 2 項。它們不代表 v11 索引已實作或升級驗收完成。

21 項失敗分類：

- 5 項被既有「Google ID 或 mapsUrl 必填」規則擋住：OSM-only 保存、使用者座標、關聯／刪除保護、名稱／筆記更新、hybrid queue。後三者的後段斷言尚未執行，不能宣稱交易／佇列／刪除規則已驗證。
- 13 項缺少新位置驗證：12 組非法 location 新增，以及 1 組非法 location 更新，目前未按新規格拒絕。
- 1 項座標變更未清估算；另 1 項預期的失效寫入未發生，因而未觸發回滾用的錯誤。
- 1 項 backup v3 尚不支援。

合計：既有必要欄位阻擋 5 項、位置驗證 13 項、失效／回滾 2 項、備份 1 項，共 21 項。

本次未出現測試載入、缺依賴或 API 名稱錯誤；Vitest 可執行不等於 TypeScript typecheck 通過。未執行 Google API、瀏覽器、live Supabase、build、lint 或其他未授權檢查。

### 13.9 第三階段 A 實作

使用者確認先完成 A：Place／Region 位置及 repository 相容層；marker／endpoint／v11 索引／backup v3／同步格式留在 B。本批不是完整第三階段或正式 UI 整合完成。

已編寫：

- [models.ts](../../src/database/models.ts)：以 type-only import 引入 geo 契約；新增 optional Place.location、Region.centerMetadata，不改 Google、URL 或 legacy center 欄位。
- [location.validation.ts](../../src/database/location.validation.ts)：有限範圍座標、來源／kind／reference／datasetVersion、nested 欄位白名單與位置等價比較。OSM ID 保留字串，避免大型 ID 失真。
- [validation.ts](../../src/database/validation.ts)：合法 location 可獨立滿足 Place 定位條件；有 Google ID 仍驗證提供的 location。Region metadata 必須搭配 center，舊 center 可維持無 metadata；null／非法 center 報 ValidationError。
- [repositories.ts](../../src/database/repositories.ts)：Location 新增／移除／內容變更與 Google ID 變更都在原 Place 交易內清除本站與同日下一站估算。datasetVersion-only、同值物件或名稱／筆記變更不清；Region update 也包在交易內。
- [index.ts](../../src/database/index.ts)：對全部資料模式明確拒絕含 location／centerMetadata 的新格式 create／update，包括明確傳 undefined 的移除操作。這是暫時的發布 gate，不剝除欄位、不改成 local-only 或手動同步；原 Google／URL 輸入照常派送。
- facade 之外的 injected repositories／LocalSyncStore 用於 isolated DB 驗證新格式；不從正式 UI 直接繞過 facade。既有自動同步、outbox 格式、frozen tasks 與 SDK loader 未修改。

補充測試：

- [IndexedDB 契約測試](../../poc/indexeddb-geo/indexeddb-geo.contract.ts)：更多非法 nested 格式、三種 OSM reference／大型 ID、Region 來源持久化與錯誤回滾、位置新增／移除／身分變更、相同位置／dataset-only 不失效、跨 trip／date 失效、hybrid Place 與受影響 items 同任務／queue 失敗全部回滾、帳號切換保留舊資料。
- [facade 測試](../../src/database/index.test.ts)：三種模式在派送前拒絕未發布格式，原 Google／URL 寫入保持傳遞。
- [契約 typecheck 設定](../../poc/indexeddb-geo/tsconfig.json)：沿用正式專案 compiler options，涵蓋原本位於 src 外的契約測試。

第 13.8 節的結果是實作前基準，不能當作本批通過證據；實作後另獲授權執行測試與 typecheck，結果見第 13.10 節。完整契約測試中 backup v3 仍是 B 的未實作需求，保留斷言且仍紅燈；不刪掉、不標成已完成。

下一次建議申請：完整契約測試、原三個回歸檔加 index.test.ts 及既有 Place service 測試、正式 app 與契約測試的 typecheck。build、lint、瀏覽器、Google API 與 live Supabase 不在此建議範圍。

### 13.10 第三階段 A 驗證結果（2026-10-23）

使用者另行授權上述測試及兩項 TypeScript 檢查：

| 範圍 | 結果 |
|---|---|
| `route-map.repository.test.ts`、`local-sync.store.test.ts`、`backup.repository.test.ts` | 39 項通過 |
| `index.test.ts`、`modules/place/place.service.test.ts` | 11 項通過 |
| 完整 IndexedDB 契約測試 | 63 項：62 通過、1 失敗；唯一失敗為未實作的 B 階段 backup v3 |
| `tsc -p tsconfig.app.json --noEmit` | 通過 |
| `tsc -p poc/indexeddb-geo/tsconfig.json --noEmit` | 通過 |

初次執行 facade 與 Place service 測試時，Node 20.19.4 沒有預設啟用 WebSocket，Supabase client 在模組載入階段報錯；不是資料操作斷言失敗。確認現有 Node 支援 `--experimental-websocket` 後，以 `NODE_OPTIONS=--experimental-websocket` 重跑這兩個檔案，11 項全部通過。沒有安裝套件、修改正式 client 或連線 live DB。

A 的位置持久化／非法輸入拒絕、Region provenance、相同位置保留估算、跨 trip／date 失效、失敗回滾、hybrid 原子 queue 及帳號隔離案例均在上述契約測試通過項目內。契約套件整體仍回傳非零，不宣稱全部綠燈；也不把 LocalSyncStore 測試當作雲端協定相容證明。

未執行 build、lint、瀏覽器、實際 Google API 或 live Supabase 驗證。未變更 Dexie schema 版本／索引、SDK key 載入方式、既有同步格式；正式 OSM 寫入仍被 facade gate 阻擋，等待 B 與雲端相容層接續。

### 13.11 第三階段 B：IndexedDB、端點與備份

使用者確認本批實作完整本機 B 及明確同步版本防護，**不準備或部署雲端 migration／v2 協定**。這不是新增第三個子階段；A／B 仍是 IndexedDB 相容層的兩批工作。雲端格式未就緒前，正式新格式寫入保持關閉，不宣稱整個產品可同步 OSM。

#### 儲存與身分

- [database.ts](../../src/database/database.ts) 新增 Dexie v11，保留原 Google 索引並增加唯一 `[routeMapId+location.reference.id]`，由 SyncDatabase 繼承。不重寫舊 records／queue／baseline／cursor／conflict，也不在 upgrade 呼叫網路。
- RouteMapPlace 的 Google ID 改 optional，可保存合法 location；有 location 必須有非空使用者名稱。無 reference 的 user-picked 位置不按座標硬去重；OSM 完整 reference 按 map 去重，datasetVersion 不作身分。
- [route-map.repository.ts](../../src/database/route-map.repository.ts) 只對存在的 provider ID 查複合鍵，避免 undefined key；一筆有兩種 reference 時同時套用兩種唯一約束。

#### 四種端點與引用

- RouteMap 新增 optional origin／destination，直接引用既有 `RouteEndpointSelection`，保留 originGooglePlaceId／destinationGooglePlaceId。
- [route-endpoint.ts](../../src/database/route-endpoint.ts) 負責 nested shape 白名單、身分 key、legacy Google 端點的 runtime normalize 及引用檢查。舊資料不為了 normalize 批次寫回；新舊欄位並存只接受相同 inline Google ID，否則明確拒絕。
- 私人 place 必須存在；marker 必須屬於同一 map；shared-place 只能引用帳號庫現有且可讀的共享快取，不從私人表 fallback。共享撤權／快取移除後，再檢查引用會回報不可用，保留端點供之後 UI 提示重選，不繞過權限。
- 相同引用／provider reference 不可當兩端；獨立 user-picked endpoint 使用選取 ID，不按座標判斷為同實體。
- 刪除私人 Place、刪除或移動 marker 時，在同一交易清空受影響 origin／destination；其他端點與 map 不動。原本 itinerary 使用中的 Place 仍禁止刪除。hybrid 的連帶 map 更新沿既有 mutation hooks 一起進 task。
- 原 Google 試算 service 對沒有 Google ID 的 marker 明確列為尚未接線，不把 undefined 當 Google ID；沒有提前改寫 renderer／搜尋／試算流程。

#### 備份 v3

- [BackupRepository](../../src/database/backup.repository.ts) 支援注入 isolated DB；繼續讀 v1／v2，新增 v3 的位置、Region metadata、marker 與端點完整 graph 驗證。
- 舊 Google-only 資料仍輸出 v2，含新欄位才輸出 v3；v2 不接受夾帶新欄位。v3 在本機完整替換保留 UUID，驗證全部通過後才清表，寫入失敗整體回滾。
- marker 去重按 provider＋完整 ID，不把所有無 Google ID 的 marker 當重複。
- 私人全備份不含共享文件。依使用者確認，遇 shared-place 端點明確拒絕匯出／匯入，不悄悄丟掉端點或跨 scope 解析。
- 帳號同步庫可備份匯出，但禁止透過注入的 BackupRepository 直接 replace／clear，避免業務資料被替換而 queue 留下不一致狀態。
- 正式 facade 的 replaceAll 仍阻擋 v3；新格式先用 isolated DB 驗證，不藉備份繞過發布 gate。

#### 同步／雲端版本防護

- [geo-format.ts](../../src/database/geo-format.ts) 共用新格式辨識及 legacy task 防護；目前仍維持 protocolVersion 1，不假裝已完成 v2。
- prepareUpload 在改 attempts／凍結 uploadChanges 之前拒絕未知 protocol、新格式 before／after、frozen payload 或共享文件。既有 legacy frozen task 保持原 operationId／protocol／payload 精確重試。
- RPC adapter 再檢查一次，防止繞過 prepareUpload 直接送出新格式；不修改舊 payload 為「可接受」形狀。
- facade 的 marker／端點 create／update 同樣 gate；雲端各相關 repository 直接入口也明確拒絕新欄位，不能 mapper 靜默丟掉 location 後回報成功。雲端備份 preview／replace 在 RPC 前拒絕 v3。
- 不變更自動同步排程、帳號授權、RLS、現行雲端 schema 或 cursor。Google／URL／legacy route map 寫入照舊；這些 client 防護不是 server 舊 writer 防護的替代品。

#### 新增驗證範圍

- [B 契約測試](../../poc/indexeddb-geo/route-map-geo.contract.ts)：marker 重開／雙唯一鍵、reference scope、端點 normalize／衝突／引用／刪除回滾、v3 完整替換往返／graph 錯誤不改庫、shared cache 撤權、hybrid 連帶清理 task、阻擋新格式上傳且 queue 不變、legacy frozen 精確重試。
- 原 v10 standalone／帳號 fixture 增加 verno 11 與新索引存在的斷言；保留原資料／佇列完全相等的檢查。
- [雲端邊界測試](../../src/database/geo-cloud-boundary.test.ts)、[RPC adapter 測試](../../src/database/sync-cloud.adapter.test.ts) 與 [facade 測試](../../src/database/index.test.ts)：未支援格式在任何寫入／RPC 前明確拒絕。
- 本批測試與 typecheck 在另獲授權後執行，結果見第 13.12 節；未跑 build、lint、瀏覽器或 live DB。A 的通過紀錄不能當作 B 已通過。尚未驗證真實瀏覽器的 blocked/versionchange UX 或線上 schema 相容性。

公開 snapshot／共享文件新格式與 cloud UUID remapping 不在這次確認的本機 B 範圍內，仍保留舊版並阻擋新格式進入。正式 UI 接線前須另外完成雲端相容實作／部署與發布 gate 移除，不應把「本機 B 程式完成」描述成「OSM 全模式產品完成」。

### 13.12 第三階段 B 驗證結果（2026-10-23）

使用者授權本批指定測試與兩項 TypeScript 檢查：

| 檢查 | 結果 |
|---|---|
| 完整 A＋B IndexedDB 契約套件 | 2 檔、99 項全部通過；包含原本未實作的 backup v3 案例 |
| route-map.repository、local-sync.store、backup.repository、index、sync-cloud.adapter、geo-cloud-boundary、hybrid.backend、place.service、route-calculator.service | 9 檔、94 項全部通過 |
| `tsc -p tsconfig.app.json --noEmit` | 通過 |
| `tsc -p poc/indexeddb-geo/tsconfig.json --noEmit` | 通過 |

首次契約執行有 1 項共享撤權 fixture 繞過帳號庫 tracked transaction 而被既有防護拒絕；改為透過 syncTransaction 模擬既有私人資料後，完整套件重跑 99 項通過，未放寬正式防護。首次 app 型別檢查指出衝突預覽標題仍假設 marker 必有 Google ID；已在 [ConflictRecordValue.tsx](../../src/modules/data-management/ConflictRecordValue.tsx) 補上 OSM reference／record ID 顯示，再跑兩項 typecheck 通過。沒有以空字串冒充 Google ID。

Vitest 在 Node 20 使用已確認可用的 `NODE_OPTIONS=--experimental-websocket`，未安裝依賴。未執行 build、lint、瀏覽器、Google API、live Supabase 或任何雲端部署。client 程式的 schema 宣告為 v11，實際升級驗證在 isolated DB 完成；未另開正式使用者庫做資料遷移。

**結論：本次確認的本機 B 與版本防護已通過限定驗證。** 正式寫入 gate 仍保留；雲端 v2／server writer 防護、共享／公開新格式、正式 UI 與真實瀏覽器 blocked/versionchange 驗證仍未完成，不在本次結果中冒充通過。

### 13.13 正式資料設定與行程地圖接線

使用者要求正式接入專案，嚴格以 [OSM 動態設計](../../poc/osm-ui/) 及 [設定設計](../../poc/map-provider-settings/MapProviderSettingsDemo.tsx) 為準，不再新增另一個 PoC。使用者確認本批範圍為正式資料設定與行程地圖；開發沿用同機 maps 專案圖資，正式部署須明確設定資產位置。本批是**讀取與顯示接線**，不是移除第三階段的寫入／同步 gate。

#### 正式 UI

- [DataManagementModule](../../src/modules/data-management/DataManagementModule.tsx) 在原 WorkspaceLayout 加入「資料搬移／偏好設定」分頁；原備份、資料庫來源與管理員操作保留於資料搬移。資料操作期間禁止切頁，避免進度與錯誤訊息被藏起來。
- [MapProviderSettings](../../src/modules/data-management/MapProviderSettings.tsx) 沿用設定稿的卡片、Google／OSM 下拉選單、SVG 示意、供應商 pill 與提示區；樣式限縮於該卡片，不匯入 demo 的全域 shell。進入偏好設定時聚焦供應商選單；示意圖明確標示不是實際底圖。
- [provider-preference](../../src/geo/provider-preference.ts) 以瀏覽器 `travel-planner:map-provider` 保存，未設定仍為 Google；同頁事件與跨分頁 storage 事件更新訂閱。讀寫失敗／無效值顯示錯誤，不假裝儲存成功或默默改回 Google。
- 偏好是裝置設定，不屬旅行業務資料；單機／雲端／混合模式共用，不改資料庫來源、backup、outbox、自動同步或帳號授權。

#### 真實行程資料與渲染

- [ItineraryMapService](../../src/modules/itinerary/itinerary-map.service.ts) 保留原 Google 解析、legacy center fallback 與明確失敗提示。OSM 僅使用通過既有驗證器的 StoredLocation，不查 Google details，不由名稱／地圖網址猜座標。
- OSM 的 Region.center 需有合法 centerMetadata；沒有已確認來源時顯示沖繩資料集概覽並明確警告，不能宣稱已定位到原區域。Google-only／URL-only／非法位置逐筆列為未定位，不為它們造圖釘。
- [workspace-map](../../src/geo/workspace-map.ts) 將正式行程既有 marker／handle 介面接至已完成的 neutral MapLibre renderer。Google 分支仍直接委派原 mountGoogleMap 與原 SDK/key 載入流程，沒有第二套 Google loader。
- [ItineraryModule](../../src/modules/itinerary/ItineraryModule.tsx) 在原版面掛載 renderer，保留圖釘身分、當日順序、點擊編輯、首次 fit、縮放及全螢幕。OSM marker 尺寸／配色依原設計限縮覆寫，不改其他 geo demo 的視覺。
- provider 切換立即遮蔽前一 provider 的資料，舊資料請求不回寫，OSM mount 可中止，過期 Google mount 完成後銷毀。載入／圖資失敗有明確提示與重試，不自動 fallback Google。
- OSM 行程內路線估算明確停用，不偷偷執行 Google Routes；原路程試算頁、搜尋、新增地點、區域編輯尚未切換，設定卡片如實說明。既有記錄可讀；沒有開啟新格式 create/update/import，也沒有新增雲端 migration。

#### 開發與正式圖資

- [osm-dev-assets](../../scripts/osm-dev-assets.ts) 僅在 Vite 開發伺服器提供固定白名單資產：land/water/roads GeoJSON、MapLibre CSS／ES module／worker／shared module；預設讀取同機 `/home/tanguitar/workspaces/maps`，可由啟動程序環境變數 `OSM_PROJECT_DIR` 指定。資產失敗記錄並回應 503，不代理任意路徑或公共圖磚服務。
- [osm-resources](../../src/geo/adapters/osm/osm-resources.ts) 共用既有設計稿的沖繩 GeoJSON style；原雙 renderer PoC 改為包裝此共用載入器，不複製另一套正式地圖邏輯。尚未做效能優化。
- 正式部署須設定 `VITE_OSM_ASSET_BASE_URL`（HTTP/S 基底路徑，包含 `osm-vendor/` 與 `osm-assets/` 子目錄）；可額外以 `VITE_OSM_STYLE_URL` 指定 style。跨來源服務須自行提供相容的 CORS／worker／資產設定。未設定基底時明確拒絕 OSM，不能假裝 Vercel 會讀到開發機的 maps 目錄。

#### 驗證狀態

新增 provider preference、正式 itinerary 解析、renderer bridge 與設定卡片測試；涵蓋預設 Google、不查 Google 的 OSM 路徑、位置來源、未定位原因、非法座標、非同步 provider 擷取、身分／callback／fit 轉接、取消、部署設定錯誤及靜態設計結構。

使用者另行授權聚焦測試與型別檢查後，本批結果：

| 檢查 | 結果 |
|---|---|
| provider-preference、workspace-map、map-renderers、MapProviderSettings、itinerary-map.service、itinerary.service、collaborative-itinerary.service、shared-trip.service、google-map-controls | 9 檔、63 項全部通過 |
| `tsc -p tsconfig.app.json --noEmit` | 通過 |
| `tsc -p tsconfig.node.json --noEmit` | 通過 |
| `tsc -p poc/map-provider/tsconfig.json --noEmit` | 通過 |

Vitest 使用現有 `NODE_OPTIONS=--experimental-websocket`，未安裝依賴。原 OSM UI 設計的 Vite preview-only 替換配合正式 import／mount 入口調整，仍維持原 mock Google-shaped 資料與 OSM 預覽 renderer；不把這些替換放進正式程式。

**未執行 build、lint、瀏覽器或 git 檢查。** 尚未實測正式站的登入後選單、鍵盤焦點、跨分頁／快速切換、實際圖資載入與版面視覺，不能把靜態 markup／mock renderer 測試當作瀏覽器驗證。Google API key 在此環境無法使用，不重試真實 Google API；不連 live Supabase、不部署雲端。前一批 A／B 通過結果也不替代本次 UI 驗證。

### 13.14 正式地點／區域／路程 OSM 流程接線

延續 13.13，本批將正式頁面的「新增／編輯地點、區域中心設定、路程試算」接上 OSM 路徑，不再停留在 Google-only 交互。範圍仍遵守既有資料邊界：地圖供應商由 [provider-preference](../../src/geo/provider-preference.ts) 決定，功能都經由 module service/controller 與 database facade，不直接在 UI 存取資料表。

#### 共用 OSM 服務

- 新增 [osm-service](../../src/geo/osm-service.ts) 與 [osm-search.css](../../src/geo/osm-search.css)，提供：
  - `searchOsmLocations`：名稱或 `緯度, 經度` 搜尋，回傳含 provenance 的 `StoredLocation`。
  - `mountOsmAutocomplete`：可重用的 autocomplete UI，含 loading/錯誤/重試與鍵盤行為。
  - `routeOsmLocations`：靜態道路估算（car/walk/bike），回傳分鐘與距離；不支援模式明確報錯，不 fallback Google。
  - `googleMapsNavigationUrl`：把已確認位置轉為 Google Maps 導航連結；底圖／位置資料使用 OSM，不把導航連結改成 OpenStreetMap 網址。
- OSM search 會把 `osm-node-123`/`osm-way-456` 正規化為 `node/123`/`way/456` reference，保留 datasetVersion。Google 連結不會被拿來擷取座標；可另存為導覽網址，但定位必須由 OSM 搜尋或使用者自行確認座標。
- Vite 增加 `/local-map` proxy；正式環境需 `VITE_OSM_SERVICE_URL`，未設定會明確失敗。

#### 地點與區域

- [PlaceModule](../../src/modules/place/PlaceModule.tsx) 與 [RegionModule](../../src/modules/region/RegionModule.tsx) 改為 provider-aware：
  - Google 模式保留原 autocomplete/summary。
  - OSM 模式啟用共用 autocomplete，選取結果寫入 `location`（地點）或 `center + centerMetadata`（區域）。
  - 建立/編輯表單依 provider 切換提示與必填邏輯（OSM 不強制 Google URL）。
  - OSM 模式顯示已選座標與來源；詳情區提供 OSM 開啟連結。
- 新增 [OsmSearchHeading](../../src/geo/OsmSearchHeading.tsx) 的說明對話框，將設計稿中的搜尋說明帶入正式 UI。

#### 路程試算

- [route-calculator.service](../../src/modules/route-calculator/route-calculator.service.ts) 新增 OSM endpoint 與計算邏輯：
  - 允許來源為 saved place / route-map marker / shared-place / OSM search location。
  - 以 `StoredLocation` 建立 marker identity（`osm:<ref>` 或 `coordinate:<lat,lng>`），不把 OSM ID 塞進 `googlePlaceId`。
  - OSM 模式只允許 DRIVING/WALKING/BICYCLING；其餘模式明確拒絕。
- [RouteEndpointField](../../src/modules/route-calculator/RouteEndpointField.tsx)、[NewPlaceSearch](../../src/modules/route-calculator/NewPlaceSearch.tsx)、[RoutePreviewMap](../../src/modules/route-calculator/RoutePreviewMap.tsx)、[RouteCalculatorModule](../../src/modules/route-calculator/RouteCalculatorModule.tsx) 已接上 provider-aware UI、OSM 搜尋流程與 map mount。
- [ItineraryService](../../src/modules/itinerary/itinerary.service.ts) 的行程內路程估算已接入 OSM：當前 provider 為 OSM 時，使用已儲存 location 計算，不會查 Google。

#### 寫入發布狀態

- [database/index.ts](../../src/database/index.ts) 的新格式發布 gate 調整為：
  - `indexeddb`：允許 OSM 新格式寫入（地點 location、區域 centerMetadata、route endpoints/markers）。
  - `supabase` / `hybrid`：仍阻擋，並回傳明確錯誤「雲端與混合模式整合尚未完成」。
- [MapProviderSettings](../../src/modules/data-management/MapProviderSettings.tsx) 的整合範圍文案同步更新，不再宣稱 OSM 流程完全未接線；改為標示「雲端/混合新格式同步仍在整合」。

#### 本批新增驗證

| 檢查 | 結果 |
|---|---|
| `osm-service`、`route-calculator.service`、`itinerary.service`、`itinerary-map.service`、`MapProviderSettings`、`workspace-map`、`provider-preference` 等聚焦測試 | 7 檔、71 項通過（另一次更大集合為 13 檔、121 項通過） |
| `tsc -p tsconfig.app.json --noEmit` | 通過 |
| `tsc -p tsconfig.node.json --noEmit` | 通過 |
| `tsc -p poc/map-provider/tsconfig.json --noEmit` | 通過 |

同樣未執行 build/lint/瀏覽器/live Supabase。`/local-map` 的 OSM backend 服務是否啟動，需由開發環境另行啟動檢查；本批僅完成前端接線與型別/單元測試驗證。

### 13.15 本機 OSM 服務與 Google Maps 網址修復

使用者回報正式開發站的 OSM 搜尋收到 HTTP 502，並要求搜尋欄支援設計稿中的 Google Maps 網址格式。本節記錄修復後狀態；13.14 中「Google 連結不會被拿來擷取座標」及「backend 需另行啟動」是前一批狀態，已由本節更新。

#### 修復內容

- [osm-dev-assets](../../scripts/osm-dev-assets.ts) 現在先檢查 `127.0.0.1:3000/api/health` 是否為沖繩 maps 服務；未就緒時才啟動同機 maps 專案的 `server.py`，等待健康檢查成功後再代理 `/local-map/*`。服務啟動失敗、回應逾時或非 JSON 錯誤會明確回傳 503 JSON，不再讓無服務的代理只呈現難辨識的 502。
- [maps server.py](../../../maps/server.py) 將沖繩 `okinawa.mbtiles` 改為可選啟動資源。搜尋、靜態路線與網址解析使用的本地 OSM 資料存在時可獨立啟動；未安裝 mbtiles 時，只有 vector tile API 明確回應 503。
- [osm-service](../../src/geo/osm-service.ts) 將 Google Maps URL 傳給 maps 專案既有的 allowlist／解析器，不在瀏覽器以單一座標 regex 猜測。解析涵蓋精確 pin、query 座標、embed 座標、視窗中心與短網址；短網址仍須能連線完成安全轉址。前端檢查回傳座標、範圍、解析後網址 host 與位置類型；範圍外會拒絕，視窗中心會提示使用者確認。
- 地點／區域表單在搜尋文字變更時清除舊位置、Google place ID 與地點的舊導覽網址；選取 Google Maps URL 後保存解析器回傳的安全網址，Google Places autocomplete 與既有 Google loader 未更動。
- OSM／自主位置的外部導航一律開啟 Google Maps：保留使用者提供且已解析的 Google Maps URL，沒有既存網址時依已確認座標建立 Google Maps directions URL。OSM 是底圖與位置來源，不是外部導航目的地網址。

#### 驗證結果

| 檢查 | 結果 |
|---|---|
| OSM service、provider preference、workspace map、place、itinerary、route-calculator 聚焦測試 | 6 檔、74 項通過 |
| `tsc -p tsconfig.app.json --noEmit` 與 `tsc -p tsconfig.node.json --noEmit` | 通過 |
| maps 專案 `server.py`、`maps_urls.py`、`sp2.py` Python 語法檢查 | 通過 |
| Vite 開發站實際 `/local-map/api/health` 與本地 OSM 搜尋 | 回傳沖繩資料集；搜尋 `Shuri Castle` 有結果 |
| maps 專案 parser 實際解析 | pin、query、embed、視窗中心 4 種長網址均回傳合法沖繩座標 |
| Vite 固定白名單圖資與 MapLibre module | land GeoJSON 與 MapLibre module HTTP 200 |

短網址的外網轉址未做 live 驗證；其格式已在 service 單元測試確認會傳至既有 parser。未跑 build、lint、瀏覽器或 Google API。雲端／Hybrid 新格式寫入 gate 仍保留，OSM 新格式資料仍只開放 standalone IndexedDB，不能據此宣稱跨裝置同步已完成。

### 13.16 IndexedDB 區域依地圖供應商隔離

使用者要求 OSM 區域與 Google 區域分開；現有 OSM 圖資與可儲存位置目前限沖繩。已實作：

- [Region](../../src/database/models.ts) 增加可選 `mapProvider` 歸屬；舊資料未標記時一律視為 Google，既有 Google Region／地點／行程不改寫供應商。
- IndexedDB v12 只在 standalone `travel-planner` 資料庫首次升級時建立獨立的預設「沖繩」OSM Region。遷移將沖繩範圍內、原先掛在 Google Region 的 OSM locations 移至 OSM Region；只有全部行程地點皆為可用沖繩 OSM location 的行程才一起改掛 OSM Region。混合行程維持原 Google Region，避免遷移改變混合行程的既有語意。
- Region／Place／Itinerary 的區域列表依目前 provider 過濾，不會在 OSM 模式顯示 Google Regions 或 Google-region trips。新建 OSM place 與選取 OSM location 時預設關聯目前列表第一個 OSM Region。
- IndexedDB repository 與 backup validation 防止 OSM location 關聯 Google Region、Google Place ID 關聯 OSM Region；OSM Region 中心與 OSM 儲存位置都驗證在目前沖繩資料 bounds 內。
- OSM Region/location 仍只允許 standalone IndexedDB 寫入；Supabase／Hybrid gate 未放寬。Account-scoped Hybrid 資料庫不會自行注入未排入 outbox 的 OSM Region。

驗證：區域遷移／provider 隔離、備份、database facade、route-map repository、place、itinerary 相關共 7 檔 49 項測試通過；app 與 node TypeScript 檢查通過。未執行 build、lint、瀏覽器或 live Supabase。
