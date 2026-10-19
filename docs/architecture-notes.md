# 現行架構與圖例

更新日期：2026-10-20。以目前工作區程式碼為基準，不宣稱已提交／已部署。
全局圖見 [architecture-current.mmd](architecture-current.mmd)，
類別圖見 [architecture.mmd](architecture.mmd)，資料边界見
[database.mmd](database.mmd)、[view.mmd](view.mmd)。

## 架構重點

- React/TypeScript/Vite 的 client app；`App`、routes、RouterLink 組合模組。
  Email/password Supabase Auth 與角色 gate 限 member/admin 進工作區。
- UI → controller → service → database facade；資料驗證、owner、交易、關聯與刪除由資料層負責。
- facade 選 standalone IndexedDB、direct Supabase 或 account/project hybrid，
  不是只有兩套 repository，也不是完全無後端。
- member 實際用 hybrid/auto；admin 可選來源／同步模式，預設 hybrid/auto。
- hybrid 個人與共享修改先進本機交易／持久 outbox，
  共用同步 engine、Web Lock、version/receipt/帳號 guard 與自動排程。
  shared 任務用獨立 typed envelope，不是對別人私人資料直接上傳。
- 私人衝突暫停 auto；確認共享衝突只隔離該 trip，草稿不丟棄。
  凍結且結果不明的請求仍原樣重試，不能被當作衝突略過。
- 協作 ACL、啟用及取消是在線 server 操作。
  shared 原行程 UI 是一份 workspace 的共同編輯，不是每個人 clone 後再合併。
- Supabase grants/RLS/RPC 才是授權邊界；前端 disabled 與 IndexedDB 分庫不取代 server。

## 類別圖例

| ID | 現行成員與責任 |
| --- | --- |
| N1 | `App`、`usePathname`、routes：依路徑選行程、地點、區域、標籤、資料管理、路程試算。 |
| N2 | `AuthProvider`／gateway：session、Email/password sign-in/sign-up/sign-out、role gate、hybrid account activation/deactivation；`AuthGate`、`WorkspaceLayout`、`RouterLink`：工作區外殼。 |
| N3 | `LabelModule` → `LabelController` → `LabelService`：樹、搜尋、地點關聯與批次操作。 |
| N4 | `PlaceModule` → controller/service；Google Places adapter：私人 place/region/label 查詢與 Maps/Places 即時解析，不持久化 provider 座標。 |
| N5 | `RegionModule` → controller/service：region 與引用檢查；Google 搜尋及 legacy center。 |
| N6 | `ItineraryEntry` → 原 `ItineraryModule` → `ItineraryController` → `CollaborativeItineraryService`：同 UI 選私人／shared trip；私人走 `ItineraryService`/facade，共享走 `SharedTripService`/repository。`ItineraryMapService` 解析地圖。 |
| N7 | `DataManagementModule` → controller/service：個人 JSON、cloud preview/token/apply、明確 overwrite transfer、個人 conflict review；不是增量同步或完整 DB backup。 |
| N8 | `database/index.ts`／runtime：三路 facade；`TravelDatabase` standalone version 7，`SyncDatabase` account/project version 9（含 outbox/baselines/conflicts/shared cache）。 |
| N9 | `RouteCalculatorModule` → controller/service → facade 的 `routeMaps`/`routeMapPlaces`：兩點試算、保存端點／額外標記、trip 連動 map；不是 shared saved-map 編輯。 |
| N10 | `TripCollaborationPanel`／controller/service／repository：Email 邀請、接受、角色、撤權／退出；`SharedTripRepository`：snapshot、draft/save、enable/cancel、resolve。 |
| N11 | `LocalSyncStore`、`sync-engine`、`hybrid.runtime`、cloud adapter：本機交易與佇列、凍結重試、拉推、帳號 guard、自動排程；`HybridStatus` 區分私人／共享問題。 |

## 資料邊界與限制

- 個人領域型別：Region、Place、Label、Trip、ItineraryItem、RouteMap、RouteMapPlace。
  個人 JSON 不攜帶授權，不備份完整 shared workspace／members／deliveries／receipts。
- 啟用共同編輯只複製排入地點的公開欄位与項目，私人筆記／標籤不分享；
  original items 保留但受 legacy guard，取消將最新內容转回 owner 私人行程。
- region/place 在 shared 行程工作區合成顯示，不是插入協作者私人 collection。
- 行程刪除原子清除項目與連動 map/markers；不刪其他私人 place。
  Hybrid cloud trip-delete 順序修正已安装。
- 無冷啟動離線登入、即時 push、通用 undo/redo 或全域共享收藏承諾。

## 證據與下一步

當前共享 core SQL 與 live catalog 一致，但其他基礎 grants/schema/legacy 仍有漂移；
新對話接續 [database-version-convergence.md](database-version-convergence.md)。
測試批次、最新 E2E 失敗與部署未確認限制見 [testing.md](testing.md)；
架構圖顯示接線，不表示每個控制項已通過實際瀏覽器驗收。
