# 測試與推送門檻

這份文件說明目前專案的測試方向、執行方式，以及 `git push` 前的自動檢查。

## 目前已實作的測試項

| 測項 | 目標 | 重點 |
| --- | --- | --- |
| `src/database/index.ts` | 資料庫門面匯出 | 驗證公開 API 可正常從 barrel 匯入，避免 export 漏掉 |
| `src/database/runtime.ts` | 資料庫模式觀察 | 驗證 `setDatabaseMode()` 會更新模式並通知訂閱者，且預設模式是 Supabase |
| `src/database/database-mode-preference.ts` | 使用者資料庫偏好 | 驗證會讀寫最後使用的資料庫模式 |
| `src/database/backup.repository.ts` | 備份驗證 | 驗證 `validateImport()` 會接受合法備份並拒絕不合法資料 |

實際測試檔：
- [src/database/database-mode-preference.test.ts](../src/database/database-mode-preference.test.ts)
- [src/database/index.test.ts](../src/database/index.test.ts)
- [src/database/runtime.test.ts](../src/database/runtime.test.ts)
- [src/database/backup.repository.test.ts](../src/database/backup.repository.test.ts)

## 執行方式

- 一般執行：`npm test`
- 單次執行：`npm run test:run`
- 靜態檢查：`npm run lint`

## 推送前檢查

專案已設定 `pre-push` hook。當你執行 `git push` 時，Git 會先跑 `npm run test:run` 和 `npm run build`。

- 如果測試通過，才會繼續 push。
- 如果測試失敗，push 會被中止。

## 後續擴充順序

1. 先補 `database/index.ts` 的策略切換測試。
2. 再補 `data-management` 的匯入與搬移流程。
3. 接著補 `label` 樹狀結構與 `itinerary` 排序邏輯。

## 備註

目前測試只挑最關鍵的核心路徑，避免一開始就鋪太多測項。之後可以再慢慢擴充，但先保住資料層與備份安全是最重要的。

## 雲端資料隔離

`src/database/owner-isolation.test.ts` 以 PGlite 執行 PostgreSQL RLS、遷移與外鍵驗證，不需要雲端連線。`supabase-backup-safety.test.ts` 和 `data-management.service.test.ts` 驗證雲端整批寫入停用、本機操作保留。部署步驟見 [owner-isolation.md](owner-isolation.md)。
