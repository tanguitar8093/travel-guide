# 測試計畫與未驗收項

更新日期：2026-10-20。既有程式已涵蓋三種後端、同步及協作，
這不是「從零開始補兩種後端測試」的清單。
已執行結果見[測試紀錄](testing.md)，資料庫差異與交接見
[收斂計畫](database-version-convergence.md)。

## 執行規則

先完成實作，再列出針對性檔案／指令請使用者批准。
不自動跑 Vitest、型別檢查、build、lint、Git 檢查或 Playwright。
只跑獲准範圍；文件變更本身不需要 production build。

## 優先 A：資料庫權限與版本收斂（增量與測試程式已寫，未執行）

**NEW VERSION WRITTEN／NOT TESTED／NOT INSTALLED。** 已批准保留精確平台 defaults，
不是等待支援單才能繼續；postgres 確有 public CREATE（database owner 的隱含權限）。
本輪沒有任何測試／檢查／指令／連線或安裝，舊 51 tests 與合成演練非新版證據。

本輪新增 [權限回歸](../../src/database/privilege-convergence-cloud.test.ts)
及 [排序回歸](../../src/database/itinerary-reorder-cloud.test.ts)。
default ACL 現只清 postgres；保留完整 supabase_admin public 矩陣（PG17 24 cells／3 rows）
或接受全無平台 rows。部分矩陣／未知來源／grantor／grant option／PUBLIC／global／type
與繼承來源仍阻擋。精確 recovery generator 只恢復改過的 postgres defaults／app ACL，
守住平台 raw defaults、database context、原函式與新 RPC；仍須新鮮 capture 及獨立演練。

- 聚焦回歸：default／privilege／reorder／auto-sync 四檔，及
  [capture/recovery fixture](../../scripts/convergence-capture.test.mjs)；語法／型別檢查另含於批准範圍。
- v2 capture 必須含 database owner／ACL／連線屬性、有效 database／schema 權限及完整
  migration／rollback／tooling 雜湊；舊 capture 缺項即停，另請新鮮擷取批准，不猜值。
- 隔離還原先重現 database owner／既有 ACL，再比較角色圖與 pg_database_owner 隱含權限；
  三份 migration／凍結 recovery 全用等效 NOSUPERUSER postgres，不加平台角色或 CREATE。
- 平台 raw defaults、資料指紋、收據、原函式、schema／column ACL 與 owner 皆需前後守衛。

- 隔離重現 live catalog 的額外 grants/default privileges，確認增量修正只影響批准物件。
- anon/basic 拒絕、member 自有 CRUD、admin 既有管理、跨 owner 引用拒絕。
- 備份 preview/token/apply、共享守門、個人同步、共享編輯與撤權持續可用。
- 原子排序 API：完整／重複／缺少／跨日／跨 trip ID、跨帳號、
  路程時間與距離失效、中途出錯回滾。
- standalone local、cloud、hybrid 使用各自既有路徑，不繞過 outbox 或共享 guard。
- 先測結構與行為，再於核准的隔離還原環境演練；線上安裝與測試另行批准。

## 優先 B：釐清最新單視窗 E2E 失敗

最新附件顯示 B 找不到本輪共享行程，收尾時 browser/page 已關閉。
目前根因未知，也不能確認該輪已清理。先看該輪日誌與附件，
不要把失敗改成 skip，也不要把資料加入其他行程來讓測試通過。

- 等待條件應對準實際行程／授權／UI 就緒，不只看無關按鈕或延長固定等待。
- 只能操作該輪獨特 trip；確認帳號、模式與 exact trip ID。
- 不掩蓋原始錯誤；cleanup 失敗與 business assertion 分別記錄。
- 瀏覽器被關閉或網路失敗不保證清理，保留未完成結果供人工處理。
- 修正後由使用者決定執行 `npm run e2e:headed`；
  未另行授權不自動登入或操作真實資料。

## 既有回歸基線

| 範圍 | 參考測試 |
| --- | --- |
| facade／模式與帳號 | `index.test.ts`、`runtime.test.ts`、`database-mode-preference.test.ts`、`hybrid.backend.test.ts` |
| 個人同步／凍結重試／衝突 | `local-sync.store.test.ts`、`sync-engine.test.ts`、`sync-conflicts.test.ts`、`auto-sync.integration.test.ts` |
| SQL/RLS／備份 | `owner-isolation.test.ts`、`sync-cloud.test.ts`、`supabase-backup-safety.test.ts` |
| route-map／刪除 | `route-map.repository.test.ts`、`route-maps-cloud.test.ts` |
| 共享／撤權／取消 | `shared-trip.integration.test.ts`、`shared-trip.cloud.test.ts`、`shared-trip.repository.test.ts` |
| 協作 UI 操作層 | `collaborative-itinerary.service.test.ts`、`shared-trip.service.test.ts`、`trip-collaboration.service.test.ts` |
| 全站狀態 | `HybridStatus.test.tsx` |

資料庫測試位於 [src/database](../src/database/)，UI 操作層位於
[src/modules/itinerary](../src/modules/itinerary/)，
全站提示位於 [src/common](../src/common/)。
存在測試檔不表示最新版本已跑過；依實際修改選最小集合，避免每次全跑。

## 仍不能由隔離測試取代

- 真實 Supabase Auth／PostgREST、部署環境變數與 build-time feature flags。
- 真實 Google Maps/Routes、瀏覽器 Web Lock 與多裝置併發。
- 手動驗收 cloud replace/clear 的 token、共享守門、admin 帳號範圍。
- 登出／切帳號、離線草稿、取消成功但本機下載失敗、撤權後 export/discard。
- 本機 Git revision、前端 deployment revision 與 live DB catalog 的分開確認。
