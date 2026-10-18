# 測試與推送門檻

這份文件說明目前專案的測試方向、執行方式，以及 `git push` 前的自動檢查。

## 目前已實作的測試項

| 測項 | 目標 | 重點 |
| --- | --- | --- |
| `src/database/index.ts` | 資料庫門面匯出 | 驗證公開 API 可正常從 barrel 匯入，避免 export 漏掉 |
| `src/database/runtime.ts` | 資料庫模式觀察 | 驗證 `setDatabaseMode()` 會更新模式並通知訂閱者，且未儲存偏好時預設為混合模式 |
| `src/database/database-mode-preference.ts` | 使用者資料庫偏好 | 未設定時預設混合模式，保留既存單機／雲端／混合模式偏好及重新載入後的記憶 |
| `src/database/backup.repository.ts` | 備份驗證 | 驗證 `validateImport()` 會接受合法備份並拒絕不合法資料 |
| `src/database/supabase-backup-safety.test.ts` | 雲端覆蓋安全檢查 | 驗證 preview/apply token 守門與 RPC 呼叫路徑 |
| `src/modules/data-management/data-management.service.test.ts` | Data Management 流程 | 驗證 Supabase replace/clear/transfer 的 preview->apply 流程 |
| `src/database/owner-isolation.test.ts` | owner isolation 與角色條件 | 驗證 owner 隔離與角色邊界 |
| `src/database/supabase-create-id.test.ts` | 建立資料時 UUID 行為 | 驗證建立路徑會補齊 id 避免 null insert |

實際測試檔：
- [src/database/database-mode-preference.test.ts](../src/database/database-mode-preference.test.ts)
- [src/database/index.test.ts](../src/database/index.test.ts)
- [src/database/runtime.test.ts](../src/database/runtime.test.ts)
- [src/database/backup.repository.test.ts](../src/database/backup.repository.test.ts)
- [src/database/supabase-backup-safety.test.ts](../src/database/supabase-backup-safety.test.ts)
- [src/modules/data-management/data-management.service.test.ts](../src/modules/data-management/data-management.service.test.ts)
- [src/database/owner-isolation.test.ts](../src/database/owner-isolation.test.ts)
- [src/database/supabase-create-id.test.ts](../src/database/supabase-create-id.test.ts)

## 執行方式

### 標籤批次更新顏色

- 標籤分類的「批次更新」與「批次刪除」並列；進入後可勾選、全選目前搜尋結果、清除選取及取消。
- 選擇預設色或自訂色，再按「套用顏色」。僅修改勾選標籤的顏色，不自動更新子標籤、不改名稱、階層或地點關聯。
- 搜尋隱藏的已選標籤仍會更新，工具列會顯示隱藏筆數；處理中停用選取及批次操作。
- 沿用資料庫 facade 的單筆更新，逐筆執行而非整批交易；顯示成功與失敗筆數及失敗原因，成功項目取消勾選、失敗項目保留以便重試。
- 帳號、資料庫模式或混合模式儲存區變更時停止後續操作；已送出的請求無法取消，已成功的更新不回復。
- focused tests：`npm run test:run -- src/modules/label/label.service.test.ts src/modules/label/BulkColorToolbar.test.tsx src/common/bulk-operation.test.ts src/common/bulk-delete.test.ts`

- 一般執行：`npm test`
- 單次執行：`npm run test:run`
- 靜態檢查：`npm run lint`
- 變更後最小檢查：`git diff --check` + `npm run lint`

## 推送前檢查

### 自動同步正向回歸（2026-10-18）

- 混合模式現已解除 DEV-only 限制：正式版也會在 member/admin 驗證後準備帳號隔離的本機資料庫，顯示混合模式選項並恢復既存偏好。
- 正向整合測試以 `DEV=false` 執行；另驗證正式環境 member 可初始化，basic 仍被拒絕。該次驗證時預設仍為 Supabase，後續預設值調整見下一項；自動同步仍需使用者自行選擇。
- 後續預設值調整：未儲存資料庫模式偏好時改用混合模式；已儲存的單機、雲端或混合模式選擇優先，不強制覆寫。同步模式的預設與記憶機制不變，亦不自動搬移或初始化雲端資料。
- 此次不變更正式資料庫 SQL、不自動搬移單機資料，亦不解除混合模式的覆蓋匯入／清空限制。發布後仍需驗證真實登入及跨裝置行為。

- 測試：`src/database/auto-sync.integration.test.ts`。
- 以 admin、可見頁面與 auto 模式，從應用程式資料庫 facade 新增區域、標籤、地點、行程與行程項目。
- 實際推進計時器：1999 ms 不呼叫 RPC，2000 ms 開始同步；驗證真實 Dexie outbox、同步引擎、cloud adapter 與 PGlite 中的正式 SQL RPC。
- 驗證 SQL 資料、owner、地點標籤關聯、行程項目，以及 outbox 清空、完整同步時間；再次修改地點後也會自動寫入，重新啟用本機帳號後資料仍保留。
- 僅替換 HTTP 傳輸與瀏覽器 Web Lock 邊界；未連線正式 Supabase，不能視為真實登入或跨裝置驗證。
- 舊 debounce 測試曾直接呼叫已取消的 timer callback，無法抓到排程被取消；已改用實際時鐘推進。前景輪詢只能清除自己的 timer，不能清除 debounce/retry。

專案建議採用「輕量 pre-push」策略，避免高成本阻塞：

- 預設先跑：`git diff --check`、`npm run lint`
- 當有資料層或同步流程改動，再補跑對應 focused tests
- 不把 `npm run build` 當成每次 push 的必要項

> 若你本機仍有舊的 pre-push hook 會強制跑 build，請同步更新 hook 設定，避免和目前流程不一致。

## Phase-2 雲端覆蓋/清空 驗證清單

SQL 腳本： [docs/supabase-phase2-safe-import.sql](supabase-phase2-safe-import.sql)

- [ ] Member：preview/apply replace 成功，結果筆數符合預覽 incoming。
- [ ] Member：preview/apply clear 成功，清空後各表筆數為 0。
- [ ] Member：token 過期防護生效（預覽後資料改變，apply 被拒絕）。
- [ ] Member：存在 shared/collab trip 時，replace/clear 都被拒絕。
- [ ] Admin：重跑上述 4 項，確認只影響自己的 owner 範圍。

### 手動驗證紀錄模板

日期：
環境：
帳號角色：

1. Replace
- 預期：
- 實際：
- 結果：PASS / FAIL

2. Clear
- 預期：
- 實際：
- 結果：PASS / FAIL

3. Token stale guard
- 預期：
- 實際：
- 結果：PASS / FAIL

4. Shared/Collab block
- 預期：
- 實際：
- 結果：PASS / FAIL

## 後續擴充順序

1. 先補 `database/index.ts` 的策略切換測試。
2. 再補 `data-management` 的匯入與搬移流程。
3. 接著補 `label` 樹狀結構與 `itinerary` 排序邏輯。

## 備註

目前測試只挑最關鍵的核心路徑，避免一開始就鋪太多測項。之後可以再慢慢擴充，但先保住資料層與備份安全是最重要的。

## 雲端資料隔離

`src/database/owner-isolation.test.ts` 以 PGlite 執行 PostgreSQL RLS、遷移與外鍵驗證，不需要雲端連線。`supabase-backup-safety.test.ts` 和 `data-management.service.test.ts` 驗證雲端整批寫入停用、本機操作保留。部署步驟見 [owner-isolation.md](owner-isolation.md)。

### SQL 執行順序（避免資料表被鎖死）

1. 先執行 `docs/supabase-schema-from-indexeddb.sql`。
2. 再執行 `docs/supabase-basic-role-rls.sql`（建立 user_roles 與角色函式）。
3. 接著執行 `docs/supabase-owner-isolation.sql`。
4. 最後再執行一次 `docs/supabase-basic-role-rls.sql`（重建 owner policy）。

執行 `docs/supabase-owner-isolation.sql` 前，先在同一個 SQL session 設定：

`set local app.legacy_owner_email = 'owner@example.com';`

如果缺少 `owner_uid` 欄位，`docs/supabase-basic-role-rls.sql` 會跳過業務表 policy 重建並提示先跑 owner-isolation；不會中斷 user_roles 與角色函式建立。
