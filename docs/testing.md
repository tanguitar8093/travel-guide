# 測試與推送門檻

這份文件說明目前專案的測試方向、執行方式，以及 `git push` 前的自動檢查。

## 目前已實作的測試項

| 測項 | 目標 | 重點 |
| --- | --- | --- |
| `src/database/index.ts` | 資料庫門面匯出 | 驗證公開 API 可正常從 barrel 匯入，避免 export 漏掉 |
| `src/database/runtime.ts` | 資料庫模式觀察 | 驗證 `setDatabaseMode()` 會更新模式並通知訂閱者，且預設模式是 Supabase |
| `src/database/database-mode-preference.ts` | 使用者資料庫偏好 | 驗證會讀寫最後使用的資料庫模式 |
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

- 一般執行：`npm test`
- 單次執行：`npm run test:run`
- 靜態檢查：`npm run lint`
- 變更後最小檢查：`git diff --check` + `npm run lint`

## 推送前檢查

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
