# 公開行程 POC：UI、核心操作與 IndexedDB

- 日期：2026-10-21（Asia/Taipei）。
- 依據：[開發計畫](../../docs/develop/public-itinerary-sharing-plan.md)、[UI 設計稿](../ui/public-itinerary-sharing-workflow.html)、[POC 流程準則](../../.agents/skills/poc.md)。
- 依使用者 2026-10-21「開始實作 UI 和核心內容」的要求，已完成核心操作及獨立 POC UI；目前交付手動 E2E 驗收。
- `core.ts` 已實作完整操作；`index.html` / `ui.ts` 接入本 POC IndexedDB。UI 設計稿已更新為 2026-10-21 使用者核准版本，內嵌當前 UI、核心與 CSS，使用獨立設計稿資料庫。

## 執行與階段狀態

在專案根目錄執行：

```bash
npm run dev:poc:public-itinerary
# 開啟 http://localhost:5174/

npm run build:poc:public-itinerary
npm run typecheck:poc:public-itinerary
npm run test:poc:public-itinerary:db
npm run test:poc:public-itinerary
```

| 指令 | 實作階段結果 |
|---|---|
| typecheck | 通過；POC 使用獨立 strict TypeScript 設定 |
| db | 6 項通過，驗證結構、初始化、持久性與回滾 |
| 完整 POC 測試 | 29 項通過（核心 21、資料庫 6、既有刪除相容性 2） |
| build | 通過；輸出至 `dist/public-itinerary-sharing/` |

`core.contract.ts` 使用獨立設定納入測試，不加入專案既有 `npm run test:run`。設定 `envDir: false`，只載入本機 POC 測項，不載入專案環境變數或雲端測項。

## 檔案分工

| 檔案 | 用途 |
|---|---|
| [models.ts](./models.ts) | 個人欄位沿用現有型別；定義公開快照、記錄、API 與錯誤碼 |
| [database.ts](./database.ts) | 獨立 Dexie schema、原子且只執行一次的範例初始化 |
| [fixtures.ts](./fixtures.ts) | 京都三日與台北兩日固定範例，每次取得新物件 |
| [core.ts](./core.ts) | 完整發佈、更新、下架、套用與公開查詢；交易成功後才回傳 |
| [core.contract.ts](./core.contract.ts) | 21 項商業邏輯契約，已轉 GREEN |
| [index.html](./index.html)、[ui.ts](./ui.ts)、[ui.css](./ui.css) | 沿用設計稿版面，接入本機資料與異步操作 |
| [vite.config.ts](./vite.config.ts) | 獨立開發／建置入口，不載入專案環境變數 |
| [database.test.ts](./database.test.ts) | 6 項 fake-indexeddb 測試 |
| [deletion-compatibility.test.ts](./deletion-compatibility.test.ts) | 呼叫正式 TripRepository 驗證來源／分享副本的刪除與路線清理邊界 |

## 資料庫及 object stores

資料庫名稱 `travel-guide-poc-public-itinerary-sharing`，版本 `1`。只在呼叫端 `new PublicItineraryDatabase()` 時建立實例；沒有全域自動開啟或自動 seed。與正式 `travel-planner` 資料庫分離，不搬移、不變更正式資料。

| Store | Key path | 索引（Dexie 定義） | 內容 |
|---|---|---|---|
| regions | id | `&id, name` | 個人區域 |
| places | id | `&id, name, *regionIds, *labelIds` | 個人地點，可保留私人資料 |
| labels | id | `&id, name, parentId` | 個人標籤，不包含在公開快照 |
| trips | id | `&id, regionId, name, startDate, endDate` | 個人來源與套用副本 |
| itineraryItems | id | `&id, tripId, placeId, date, [tripId+date+order]` | 個人每日安排 |
| publicItineraries | id | `&id, &sourceTripId, createdAt, updatedAt` | 單筆記錄內嵌完整快照 |
| metadata | key | `&key` | 已初始化標記 |

`&` 為唯一索引，`*` 為多值索引；複合日期排序索引不限制相同 order。必填 `sourceTripId` 的唯一索引是來源唯一性的最後防線，商業邏輯仍須驗證欄位存在並將重複發佈轉為 `ALREADY_PUBLISHED`。

IndexedDB 不提供外鍵；`sourceTripId` 是管理識別值，不能作為預覽／套用時的資料讀取依據，也不能建立來源刪除連帶刪除公開資料的行為。公開快照不分拆到個人 stores；更新使用一筆記錄覆蓋，下架刪除一筆記錄，不留下歷史。

## 欄位契約

| 類型 | 必填 | 選填 | 規則 |
|---|---|---|---|
| Region | id、name、zoom | center `{latitude, longitude}`、googlePlaceId | 快照／套用重建 id，保留地圖欄位；套用的個人區域名稱加上 `(分享)` |
| 個人 Place | id、name、regionIds、labelIds | icon、mapsUrl、googlePlaceId、notes | 發佈只取行程引用的地點；同一地點只 clone 一次 |
| 公開 PublicPlace | id、name、regionIds | icon、mapsUrl、googlePlaceId | 完全移除 notes、labelIds；regionIds 僅包含新快照所屬區域 |
| Label | id、name、color | parentId | 私人資料，不 clone 到公開快照；每次套用建立獨立的「公開行程名稱(分享)」標籤，隨機選色 |
| Trip | id、regionId、name、startDate、endDate | 無 | 日期 `YYYY-MM-DD`；套用沿用日期，重建 id／regionId |
| ItineraryItem | id、tripId、placeId、date、order | arrivalTime、durationMinutes、transport、travelDurationMinutes、travelDistanceMeters、note | 重建所有 ID 引用，其餘欄位原值保留，包括 0 與空字串；抵達時間 `HH:mm`，日期 `YYYY-MM-DD` |
| PublicSnapshot | schemaVersion、region、trip、places、items | 無 | schemaVersion 固定為 1；一個行程、一個所屬區域，不含 labels |
| PublicItinerary | id、sourceTripId、createdAt、updatedAt、snapshot | 無 | updatedAt 初次發佈為 null；更新後為 UTC ISO 字串 |
| SeedMarker | key、version | 無 | `{key: 'demo-v1', version: 1}` |

記錄時間以 UTC ISO 8601 保存，例如 `2026-10-19T00:00:00.000Z`，UI 以 Asia/Taipei 顯示日期。`createdAt` 初次發佈產生；更新僅改 `updatedAt`，不重設 `createdAt`。重發重新取得當下時間；同一毫秒內操作可有相同時間值，身份仍必須不同。

clone 的 ID 使用新 UUID；public id、快照內 trip／region／place／item id 與來源的 ID 不得混用。API 邊界需驗證來源區域與所有被引用的地點存在；缺失時整次拒絕，不產生不完整快照。其餘型別沿用 [正式模型](../../src/database/models.ts)，POC 僅匯入型別，不匯入正式資料庫。

## 範例 key-value

初始化後個人資料為京都三日：1 個區域、1 個標籤、9 個地點、1 個行程、9 個項目。公開記錄為京都三日及台北兩日兩筆；台北來源不存在於個人 stores，示範公開內容不依賴來源。完整內容可透過 `createDemoDataset()` 取得，不另存容易與程式分歧的 JSON 副本。

以下是實際範例的部分 key-value（省略欄位不代表完整 schema）：

| Store / Key | Value |
|---|---|
| regions / demo-kyoto | `{"id":"demo-kyoto","name":"日本・京都","zoom":13}` |
| labels / demo-private | `{"id":"demo-private","name":"我的必訪清單","color":"#bd9670"}` |
| trips / demo-personal-kyoto | `{"id":"demo-personal-kyoto","name":"京都慢旅・寺院與咖啡三日","regionId":"demo-kyoto","startDate":"2026-11-06","endDate":"2026-11-08"}` |
| places / demo-personal-kyoto-place-0-0 | `{"id":"demo-personal-kyoto-place-0-0","name":"清水寺","icon":"⛩️","regionIds":["demo-kyoto"],"labelIds":["demo-private"],"notes":"私人收藏備註，不應公開"}`；另有 mapsUrl |
| itineraryItems / demo-personal-kyoto-item-0-0 | `{"id":"demo-personal-kyoto-item-0-0","tripId":"demo-personal-kyoto","placeId":"demo-personal-kyoto-place-0-0","date":"2026-11-06","arrivalTime":"09:00","durationMinutes":90,"note":"從清水坂上山，早上避開人潮。","order":0}` |
| metadata / demo-v1 | `{"key":"demo-v1","version":1}` |

公開京都的完整外層結構如下，places/items 陣列各有 9 筆，此處只展開第一筆：

```json
{
  "id": "demo-public-kyoto",
  "sourceTripId": "demo-personal-kyoto",
  "createdAt": "2026-10-19T00:00:00.000Z",
  "updatedAt": null,
  "snapshot": {
    "schemaVersion": 1,
    "region": { "id": "demo-public-kyoto-region", "name": "日本・京都", "zoom": 13 },
    "trip": {
      "id": "demo-public-kyoto-trip",
      "name": "京都慢旅・寺院與咖啡三日",
      "regionId": "demo-public-kyoto-region",
      "startDate": "2026-11-06",
      "endDate": "2026-11-08"
    },
    "places": [{
      "id": "demo-public-kyoto-place-0",
      "name": "清水寺",
      "icon": "⛩️",
      "mapsUrl": "https://www.google.com/maps/search/?api=1&query=%E6%B8%85%E6%B0%B4%E5%AF%BA",
      "regionIds": ["demo-public-kyoto-region"]
    }],
    "items": [{
      "id": "demo-public-kyoto-item-0",
      "tripId": "demo-public-kyoto-trip",
      "placeId": "demo-public-kyoto-place-0",
      "date": "2026-11-06",
      "arrivalTime": "09:00",
      "durationMinutes": 90,
      "note": "從清水坂上山，早上避開人潮。",
      "order": 0
    }]
  }
}
```

第二筆公開 key 為 `demo-public-taipei`，sourceTripId `demo-source-taipei`，createdAt `2026-10-18T00:00:00.000Z`，日期 `2026-11-14` 至 `2026-11-15`，區域「台灣・台北」，6 個地點、6 個項目。範例 ID 是固定可辨識字串，實際發佈／套用產生 UUID。

## 核心操作與原子邊界

| 操作 | 輸入 → 回傳 | 必要行為與交易範圍 |
|---|---|---|
| list | query? → PublicItinerary[] | 只讀公開 store；createdAt 降冪，同時以 id 升冪穩定排序；搜尋 trim 且不分大小寫，比對行程或區域名；regionName 完全匹配，與搜尋取交集 |
| readSnapshot | publicId → PublicSnapshot | 只讀公開 store；不存在拒絕；傳回獨立物件 |
| findBySource | sourceTripId → 記錄或 undefined | 使用唯一索引；不需要來源仍存在 |
| publish | sourceTripId → PublicItinerary | rw：trips、regions、places、itineraryItems、publicItineraries；一致讀取來源、驗證及 clone，再新增 |
| update | publicId、sourceTripId → PublicItinerary | 同 publish 交易範圍；先查公開 ID 及來源是否相符，再讀來源重建完整快照並 put；來源名稱未變也照常覆蓋 |
| withdraw | publicId、sourceTripId → void | rw：publicItineraries；查存在、核對來源、刪除；不需要來源還存在 |
| apply | publicId → 新個人 Trip | rw：publicItineraries、regions、places、labels、trips、itineraryItems；只讀快照，重建引用，建立完整個人圖；不讀來源、不合併資料 |

所有操作成功僅能在交易完成後 resolve；錯誤 reject，UI 之後才能依 resolve 顯示成功。不得吞掉 bulkAdd／交易錯誤。交易內不等待網路、計時器或 UI 互動；確認視窗在呼叫 API 前完成。

套用後的區域名稱為 `<公開區域名稱>(分享)`；新增標籤名稱為 `<公開行程名稱>(分享)`，從預設色盤隨機選一個顏色。所有複製地點為 `labelIds: [新標籤 ID]`，不包含 notes。每次套用建立獨立區域、地點與標籤，即使名稱相同也不合併。名稱使用第一個未被占用的「原名（副本）」「原名（副本 2）」等名稱；不以 `startsWith` 數量估算，以免刪除／改名後撞名。套用不切換 UI 當前選取的行程，由使用者自行選取。

錯誤碼：公開 ID 不存在 `PUBLIC_NOT_FOUND`；ID 存在但來源不符 `SOURCE_MISMATCH`；來源行程不存在 `SOURCE_NOT_FOUND`；來源缺少必要引用 `INVALID_SOURCE`；來源已有公開記錄 `ALREADY_PUBLISHED`。先確認公開記錄與來源身份，更新失敗不能自動變成新增。底層寫入錯誤直接 reject 並完整回滾。

初始化 `seedDemoDatabase(db, createDemoDataset())` 在涵蓋全部 stores 的 rw 交易中，先讀 marker，再使用 bulkAdd 及新增 marker；回傳 true 表示此次初始化、false 表示已初始化。失敗包含 marker 全部回滾，可再次重試。重新開啟不補回已刪除的範例，不覆寫使用者變更；若要完整重置，需由後續明確的重置操作刪除此 POC DB，不能在頁面開啟時重置。

## 測項與後續驗收

| 覆蓋面 | 自動測項 |
|---|---|
| 發佈與讀取（7 項） | 完整欄位與新 ID、重複地點只 clone 一次、排除未用地點及私人資料、來源唯一及併發發佈、缺失引用拒絕、來源刪改不影響快照、讀取結果不洩漏可變參照、搜尋與來源查詢 |
| 更新／下架／重發（5 項） | 完整覆蓋與舊地點移除、保留公開 id／createdAt、updatedAt、新快照 ID、錯誤身份拒絕、來源刪除後更新拒絕但可下架、下架移除所有公開入口、保留副本、重新發佈 |
| 套用與交易（9 項） | 每次產生獨立區域／地點／行程／項目、引用及日期／備註／路程欄位保留、不合併、不撞副本名稱、四種寫入操作失敗拒絕並完整回滾、地圖欄位／零值保留、併發套用及第一個空缺名稱 |
| IndexedDB（6 項） | reopen 持久化、併發 seed 只執行一次且不復活刪除資料、唯一來源索引、初始化晚期失敗回滾與重試、來源刪除不連帶公開、固定範例引用完整且無私人欄位 |

UI 已串接，下列交付使用者手動驗收，尚未執行瀏覽器 E2E，不宣告為已通過的自動測試：

1. 未發佈顯示「發佈」；已有公開版本顯示「更新」及「下架」。
2. 確認視窗呈現來源名稱／區域與影響說明；取消發佈、更新或下架均不呼叫寫入 API，不改資料或顯示成功。
3. 更新不做差異比對；列表新增日期保留，更新日期以台北時區顯示；套用副本保持原內容。
4. 下架後列表移除、按鈕回到發佈；重新發佈建立新記錄。已開啟的預覽也應關閉或顯示已下架，不能繼續套用已刪記錄。
5. 搜尋／區域篩選、跨日唯讀預覽、套用通知及自行選取副本沿用設計稿；公開畫面不呈現私人標籤／地點備註。
6. 寫入失敗顯示錯誤，資料未變，不顯示成功；重新整理／重開瀏覽器後資料仍保留，範例不重複。

實作入口需透過 Vite 開啟；不可直接以 `file://` 開啟 TypeScript。也可用專案既有 `npm run dev`，瀏覽 `/poc/public-itinerary-sharing/`。兩種入口的埠不同，IndexedDB 依 origin 隔離，驗收請固定使用 `http://localhost:5174/`。

建議先套用京都行程，再進入我的行程修改原始京都名稱、抵達時間及備註，確認公開預覽仍為舊內容；接著驗收更新取消／確認、下架取消／確認、再次發佈、副本自行選取及重新整理後保留資料。搜尋可試 ` 京都 `、`寺院`，搭配不同區域篩選；預覽日期可切換三日。更新日期以 Asia/Taipei 顯示。

跨分頁使用 Dexie liveQuery 更新列表；已開啟的預覽會同步更新或在下架後關閉。寫入期間鎖定操作，取消在 API 呼叫前完成；失敗保留編輯表單供重試。來源／公開資料不寫入正式資料庫，地圖延續設計稿的路線示意。

使用者手動 E2E 確認後才編寫 E2E 程式並由使用者執行。Supabase 設計留待 POC 完成後另行評估。

本次針對性 lint 通過。全專案 `npm run lint` 仍有既有錯誤：`e2e/shared-trip-invitation.e2e.ts:42` 的 `react-hooks(rules-of-hooks)`；不在本次變更範圍。


## 分享副本辨識與管理

依使用者修訂，新的套用操作會為區域加上 `(分享)`，並建立 `<公開行程名稱>(分享)` 標籤，隨機選色並標示所有複製地點。公開快照仍不包含來源私人標籤；這個標籤是在套用時新建的個人資料。區域、標籤與其他副本資料在同一交易建立，任何後續寫入失敗都會完整回滾。

手動驗收：重新整理後套用一次京都行程，開啟側欄「區域」確認新增「日本・京都(分享)」及 9 個地點；「標籤」確認新增「京都慢旅・寺院與咖啡三日(分享)」及色點。按「查看地點」確認全部地點都有該標籤。再套用一次，標籤列以所屬行程區分兩份副本，可各自篩選。我的行程切換到副本後，每個行程地點也顯示分享標籤。

本次規則適用更新後新套用的副本；先前已套用的資料保留原狀，驗收請再套用一次。


## UI 對齊與正式整合邊界

PoC 直接引用 `src/index.css`、`src/common/WorkspaceLayout.css`、`src/modules/{region,place,label,itinerary}` 的現有 CSS，使用原本的區域左右欄、地點瀏覽與詳細資料、標籤樹列／色點與地點預覽、行程標題切換下拉與操作選單。`ui.css` 只保留公開分享新增畫面、路線示意與 PoC 容器需要的樣式。此階段為縮小的流程畫面，省略既有新增、刪除、批次管理等控制項；省略不代表正式整合會移除這些功能。UI 外觀已於 2026-10-21 經使用者確認並保存設計稿；完整手動 E2E 仍待驗收。

正式整合時：

- 公開管理入口加入現有 `ItineraryModule.tsx` 的行程操作選單，保留既有編輯、刪除、新增、路線圖與協作權限邏輯。
- 區域、地點、標籤使用現有模組與 controller/repository；不以 PoC 的精簡畫面替換正式模組。套用產生的 Region、Place、Label、Trip、ItineraryItem 都沿用正式型別。
- 既有 `TripRepository.delete()` 刪除行程、項目、路線圖與路線圖附加地點；區域、地點、標籤留待既有管理功能清理。分享功能不將行程刪除改成連帶刪除區域、地點或標籤。
- 已發佈來源被刪除時，公開快照保持可讀／可套用；更新因來源不存在拒絕。正式整合需保留公開列表中的發佈者管理入口，讓失去來源的公開版本仍可明確下架，不連帶刪除。

`deletion-compatibility.test.ts` 用隔離的 TravelDatabase 呼叫正式 TripRepository，分別驗證原始來源與分享副本可正常刪除，含路線清理與管理資料保留，再驗證公開快照仍可讀與再次套用。這是刪除資料邊界的驗證；正式 UI 整合及完整回歸驗收尚未進行。


## 本版 UI 核准與設計稿保存

2026-10-21 使用者確認目前 UI 可接受，要求先更新設計稿。已將當前 UI、核心程式與專案 CSS 內嵌保存至 [public-itinerary-sharing-workflow.html](../ui/public-itinerary-sharing-workflow.html)。設計稿資料庫名稱獨立於本 POC，不變更本 POC 現存資料。本次核准不代表完整手動 E2E 通過或正式整合完成。


## 正式整合入口

公開行程已整合至真正專案：使用 `npm run dev` 的 `/public-itineraries` 與既有行程操作選單；詳見 [正式整合說明](../../src/modules/public-itinerary/README.md)。本 POC 的核心與型別改為引用正式實作，獨立 POC 資料庫與凍結的核准設計稿保留，不搬移範例至正式資料。
