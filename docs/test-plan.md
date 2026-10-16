# 測項清單

這份清單只列目前最值得先測的關鍵路徑，目標是先守住架構切換、資料安全與最容易出錯的核心邏輯。

## 優先級 A：先做

| 模組 | 測項 | 要驗證的行為 | 為什麼先測 |
| --- | --- | --- | --- |
| `src/database/index.ts` | 資料庫策略切換 | `indexeddb` 與 `supabase` 兩種模式下，`regions / places / labels / trips / itineraryItems / backupRepository` 都會走到對應實作 | 這是 Strategy 的核心，壞掉會直接影響整個資料層 |
| `src/database/index.ts` | 資料庫門面匯出 | 公開 API 可正常從 barrel 匯入，避免 `runtime` 或 repository export 漏掉 | 可以提早抓到像這次 `useDatabaseMode` / 型別匯出缺失這類回歸 |
| `src/database/runtime.ts` | 模式觀察與通知 | `setDatabaseMode()` 會更新目前模式、寫入 `localStorage`，且 `subscribeDatabaseMode()` 會收到通知 | 這是 Observer 的核心，會影響資料管理頁與所有依賴模式狀態的畫面 |
| `src/modules/data-management/data-management.service.ts` | 備份解析與資料搬移 | `parseBackup()` 會拒絕非法 JSON；`replaceAllData()`、`transferLocalToSupabase()`、`transferSupabaseToLocal()` 會回傳正確 counts | 這是資料救援與同步功能，資料損壞成本最高 |

## 優先級 B：再補

| 模組 | 測項 | 要驗證的行為 | 為什麼排後面 |
| --- | --- | --- | --- |
| `src/modules/label/label.service.ts` | 樹狀標籤與查詢 | `listTree()` 會正確組樹；`findPlaces()` 會依是否包含子標籤回傳正確地點 | 這是標籤階層的核心，但通常不會像資料切換那麼全面地影響系統 |
| `src/modules/itinerary/itinerary.service.ts` | 行程排序與路線計算 | `addItem()` 會排到正確順序；`calculateTravelDuration()` 會先檢查前置條件，再更新 `travelDurationMinutes` | 這是使用者最常碰到的功能，且容易因順序或資料不一致而出錯 |

## 建議的最小測試順序

1. 先測資料庫策略切換。
2. 再測模式觀察通知。
3. 接著測資料匯入匯出與搬移。
4. 最後補標籤樹與行程邏輯。

## 備註

目前專案尚未安裝正式測試框架，所以這份是測項規劃，不是已實作的測試碼。若要落地，建議先從 Vitest + React Testing Library 開始。
