# 設計模式適用性分析

這份紀錄只整理目前這個專案中，真的有機會帶來結構收益的地方。重點不是把每個地方都硬套模式，而是找出「現在的架構已經有模式雛形」或「未來演進時，模式會明顯降低耦合」的區域。

## 整理表格

| 模式 | 適用位置 | 為什麼適合 | 預期收益 | 建議優先度 |
| --- | --- | --- | --- | --- |
| Strategy | `src/database/index.ts`、`src/database/runtime.ts` | 已經有 IndexedDB / Supabase 兩套同介面後端 | 降低資料來源切換成本，新增後端較容易 | 最高 |
| Observer | `src/database/runtime.ts` | `subscribeDatabaseMode` 已具備訂閱模型 | 模式變更可同步到多處，不用手動輪詢 | 高 |
| Composite | `src/modules/label/label.service.ts` | Label 本身就是樹狀結構 | 樹節點與子樹操作更一致，方便階層功能擴充 | 中 |
| Command | `src/modules/data-management/data-management.service.ts` | 匯出、匯入、覆蓋、清空都是明確動作 | 方便加確認、記錄、重做/復原或背景執行 | 中 |
| Adapter | `src/modules/place/google-places.service.ts`、`src/modules/itinerary/itinerary-map.service.ts` | 外部地圖供應商已直接耦合到上層功能 | 未來替換供應商時可減少上層改動 | 中低 |

## 優先候選

### 1. Strategy：資料庫後端切換

適用位置：`src/database/index.ts`、`src/database/runtime.ts`

原因：
- 專案已經有兩套實作，IndexedDB 與 Supabase，對外提供相同的 repository 介面。
- 上層模組不需要知道資料來源細節，只要呼叫同一組方法即可。
- 這種「相同介面、不同演算法或後端實作」非常符合 Strategy。

適用效益：
- 未來如果再加離線快取、測試假資料後端，擴充成本會比較低。
- 切換資料來源時不需要到處改業務模組。
- 目前的條件分支可以更有結構地收斂到單一選擇點。

結論：這是最值得正式化的模式，因為專案現在已經在這條路上。

### 2. Observer：資料庫模式與全域狀態變化

適用位置：`src/database/runtime.ts`

原因：
- `subscribeDatabaseMode` 已經是觀察者模式的核心行為。
- 資料庫模式變更屬於全域事件，理論上會影響多個畫面與操作流程。
- 登入狀態、主題、工作區模式這類全域狀態也適合同樣思路。

適用效益：
- 避免各處自己輪詢或手動同步狀態。
- 狀態變更時，影響面可以由訂閱者自行處理。
- 對 UI 反應式更新會更自然。

結論：目前已有雛形，不一定要大改，但很適合沿著這個方向整理。

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
- 現在是 service 直接執行，簡單可行，但職責偏向「動作集合」。

適用效益：
- 之後若要加操作歷史、重做/復原、批次排程或背景任務，Command 會很方便。
- UI 只需要發出命令，不必知道內部如何執行。
- 可把「確認執行」與「實際執行」拆開。

結論：如果資料管理功能會持續擴張，這是很值得考慮的模式。

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

1. 先把資料庫後端切換視為 Strategy 正式整理。
2. 再觀察資料庫模式切換與其他全域狀態要不要收斂成 Observer。
3. 如果之後要強化樹狀操作，再把 Label 領域往 Composite 的方向整理。
4. 若資料搬移與同步功能繼續長大，再導入 Command。
5. 若外部地圖供應商可能更換，再抽 Adapter。

## 結論

這個專案目前最值得處理的不是「全部都套模式」，而是三個已經有清楚方向的區域：資料庫後端切換、標籤樹、資料管理操作。其他地方先保持簡單，會比過早抽象更穩定。
