# 設計模式適用性分析

這份紀錄只整理目前這個專案中，真的有機會帶來結構收益的地方。重點不是把每個地方都硬套模式，而是找出「現在的架構已經有模式雛形」或「未來演進時，模式會明顯降低耦合」的區域。

更新日期：2026-10-20。這是模式分析，不是新的重構批准。
現行架構見 [architecture-notes.md](architecture-notes.md)，
優先工作是[資料庫版本收斂](database-version-convergence.md)，不是再加一套 framework。

## 整理表格

| 模式      | 適用位置                                                                                       | 為什麼適合                                                           | 預期收益                                 | 建議優先度 |
| --------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- | ---------- |
| Strategy  | `src/database/index.ts`、`src/database/runtime.ts`                                             | 已有 IndexedDB / Supabase / hybrid 三條路徑與策略登錄表 | 保持來源切換與資料邊界一致 | 已落地，優先維護 |
| Observer  | `src/database/runtime.ts`                                                                      | `subscribeDatabaseMode` 已具備訂閱模型                               | 模式變更可同步到多處，不用手動輪詢       | 高         |
| Composite | `src/modules/label/label.service.ts`                                                           | Label 本身就是樹狀結構                                               | 樹節點與子樹操作更一致，方便階層功能擴充 | 中         |
| Command   | `src/database/local-sync.store.ts`、資料管理 service | hybrid 已持久化 operation/outbox；匯入覆蓋另有 token 交易 | 保留請求 identity、順序與重試安全，不代表通用 undo/redo | 維護既有，不增框架 |
| Adapter   | `src/modules/place/google-places.service.ts`、`src/modules/itinerary/itinerary-map.service.ts` | 外部地圖供應商已直接耦合到上層功能                                   | 未來替換供應商時可減少上層改動           | 中低       |

## 優先候選

### 1. Strategy：資料庫後端切換

適用位置：`src/database/index.ts`、`src/database/runtime.ts`

原因：

- 專案已有 standalone IndexedDB、direct Supabase 與帳號隔離 hybrid 路徑，對外沿用 facade。
- 上層模組不需要知道資料來源細節，只要呼叫同一組方法即可。
- 這種「相同介面、不同演算法或後端實作」非常符合 Strategy。

適用效益：

- hybrid 本機快取與 outbox 已實作；今後擴充須沿用同一安全邊界。
- 切換資料來源時不需要到處改業務模組。
- 目前的條件分支可以更有結構地收斂到單一選擇點。

結論：策略登錄表已落地；重點是維持三種模式與共享 adapter 的一致性，不再把 hybrid 當未來後端。

### 2. Observer：資料庫模式與全域狀態變化

適用位置：`src/database/runtime.ts`

原因：

- `subscribeDatabaseMode`、hybrid status 與 Dexie liveQuery 已是實際觀察者路徑。
- 資料庫模式變更屬於全域事件，理論上會影響多個畫面與操作流程。
- 登入狀態、主題、工作區模式這類全域狀態也適合同樣思路。

適用效益：

- 避免各處自己輪詢或手動同步狀態。
- 狀態變更時，影響面可以由訂閱者自行處理。
- 對 UI 反應式更新會更自然。

結論：已有實作；應維護帳號切換取消訂閱、狀態與未儲存草稿的邊界，不必增加全域事件框架。

### 3. Composite：標籤樹

適用位置：`src/modules/label/label.service.ts`

原因：

- Label 本質上就是樹狀結構。
- `listTree()` 已經在把扁平資料組成樹。
- `findPlaces()`、未來的階層搬移、批次刪除、批次套用操作，都會受益於同一種樹狀抽象。

適用效益：

- 樹節點與葉節點可以用相同概念處理。
- 層級相關的查詢與批次操作比較好擴充。
- 之後如果要做節點拖曳排序或子樹操作，模式會更明顯。

結論：現在不是一定要重構，但這個領域天生適合 Composite。

### 4. Command：資料管理操作

適用位置：`src/modules/data-management/data-management.service.ts`

原因：

- 匯出、匯入、覆蓋、清空、搬移資料，都是明確的使用者動作。
- 這些動作通常有副作用，且常常需要確認、記錄、回復或排程。
- 資料管理是 service 編排 preview/token/apply；hybrid 個人與共享修改另有持久 operation/outbox。
  兩者不是同一種資料搬移，也不能把整批 import 當成 incremental sync。

適用效益：

- 之後若要加操作歷史、重做/復原、批次排程或背景任務，Command 會很方便。
- UI 只需要發出命令，不必知道內部如何執行。
- 可把「確認執行」與「實際執行」拆開。

結論：已有命令式 operation 與凍結重試基礎，不支援通用復原／重做；
不要為套模式而破壞收據、依賴順序或新增平行佇列。

### 5. Adapter：Google Places 與地圖供應商

適用位置：`src/modules/place/google-places.service.ts`、`src/modules/itinerary/itinerary-map.service.ts`

原因：

- 目前上層功能已經直接依賴 Google 服務。
- 地點搜尋、地圖位置、路線時間這些能力本質上依賴外部供應商。
- 如果未來改用其他地圖 API，現在的耦合點會很明顯。

適用效益：

- 可以把不同供應商包成同一介面。
- 上層的 place 與 itinerary 邏輯不需要跟著換 API。
- 有助於隔離外部服務的差異與失敗模式。

結論：不是立刻必要，但若你預期會換供應商，Adapter 很實用。

## 暫不建議硬套

以下區域目前不建議為了模式而加模式：

- `LabelController`、`PlaceController`、`RegionController`、`ItineraryController`、`DataManagementController` 這類薄轉呼叫層。
- 一般 React 表單狀態與 `useState`、`useEffect` 流程。
- 僅僅為了抽象而抽象的 helper 函式。

原因很簡單：

- 這些地方的職責已經很單純。
- 若強行引入模式，反而會增加閱讀成本與檔案數量。
- 目前的問題不是模式不足，而是少數地方已經有足夠清楚的演進方向。

## 建議優先順序

1. 維護已存在的三路 Strategy，先處理已確認的線上版本與權限差異。
2. 維護既有 Observer/liveQuery 的帳號與 UI 草稿邊界。
3. 如果之後要強化樹狀操作，再把 Label 領域往 Composite 的方向整理。
4. 若資料搬移與同步功能繼續長大，再導入 Command。
5. 若外部地圖供應商可能更換，再抽 Adapter。

## 結論

這個專案目前最值得處理的不是「全部都套模式」，而是三個已經有清楚方向的區域：資料庫後端切換、標籤樹、資料管理操作。其他地方先保持簡單，會比過早抽象更穩定。
