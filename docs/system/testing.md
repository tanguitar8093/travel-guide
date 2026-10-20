# 測試方式、證據與限制

更新日期：2026-10-20。測試計畫見 [test-plan.md](test-plan.md)，
新對話交接與線上差異見 [database-version-convergence.md](database-version-convergence.md)。

## 授權與工具

- 實作完成後先列出針對性範圍，取得批准再執行。
  不預設每次必跑 lint、Git diff/check、build 或 Playwright。
- Vitest 負責單元／整合，PGlite 跑隔離 PostgreSQL/RLS，
  fake-indexeddb/Dexie 跑持久佇列與本機交易；Playwright 跑使用者可見流程。
- `npm run build` 包含 TypeScript 與 Vite 打包；`npx --no-install tsc -b`
  只做型別／project 檢查，不等於 production build。
- 套件與命令以 [package.json](../package.json) 為準。存在命令不表示獲准執行。
- 本輪 A／B 增量與測試程式已寫，沒有執行新測試、型別檢查、build、lint、Git 或 live DB 檢查。

## 收斂 A／B：待批准的針對性驗證

新增 [privilege-convergence-cloud.test.ts](../../src/database/privilege-convergence-cloud.test.ts)
及 [itinerary-reorder-cloud.test.ts](../../src/database/itinerary-reorder-cloud.test.ts)，
均使用 synthetic PGlite 與目前排序的 migration 鏈，不使用線上連線。
**測試程式已寫，結果尚不存在。**

建議本輪批准範圍：上述兩檔，以及既有
[auto-sync.integration.test.ts](../../src/database/auto-sync.integration.test.ts)、
[shared-trip.integration.test.ts](../../src/database/shared-trip.integration.test.ts)、
[shared-trip.service.test.ts](../../src/modules/itinerary/shared-trip.service.test.ts)、
[hybrid.backend.test.ts](../../src/database/hybrid.backend.test.ts)，另加 `tsc -b`。
既有套件仍依其 fixture 載入 SQL；新增兩檔才是本輪 A／B migration 的直接證據。
這不是 full suite、build、lint、Playwright、Git 或任何線上存取的授權。

default ACL 修補未完成，權限 migration 刻意阻擋未批准 defaults；
synthetic 通過仍不代表實際線上可安裝。多連線競爭、備份還原演練與安裝各需新批准。

獲准後可使用：

```bash
# 指定當次批准的測試檔；省略選擇器會變成整套，不能擅自擴大範圍
npm run test:run -- <approved-test-files>

# 僅在型別檢查也獲批准時
npx --no-install tsc -b
```

同步相關歷次針對性測試使用：

```bash
VITE_TRIP_COLLABORATION_ENABLED=false \
VITE_TRIP_SHARED_EDITING_ENABLED=false \
NODE_OPTIONS=--experimental-websocket \
npm run test:run -- <approved-test-files>
```

共享 SQL 整合會自行注入隔離 adapter；停用 flags 是避免私人回歸測試
意外呼叫真實 Supabase，不表示沒有測共享 SQL。
Node.js 20 曾用上述 websocket 選項；實際 runtime／工具相容性需按環境確認，
不能直接把缺工具視為測試通過。

## 已有測試範圍

| 範圍 | 代表檔案 |
| --- | --- |
| facade／模式偏好 | [index](../src/database/index.test.ts)、[runtime](../src/database/runtime.test.ts)、[preference](../src/database/database-mode-preference.test.ts) |
| 本機交易／帳號／排程 | [store](../src/database/local-sync.store.test.ts)、[hybrid backend](../src/database/hybrid.backend.test.ts) |
| 個人同步／重試／衝突 | [engine](../src/database/sync-engine.test.ts)、[conflicts](../src/database/sync-conflicts.test.ts)、[automatic SQL integration](../src/database/auto-sync.integration.test.ts) |
| 資料隔離／備份 | [owner isolation](../src/database/owner-isolation.test.ts)、[backup safety](../src/database/supabase-backup-safety.test.ts)、[data service](../src/modules/data-management/data-management.service.test.ts) |
| 地圖／cascade | [route-map repository](../src/database/route-map.repository.test.ts)、[route-map SQL](../src/database/route-maps-cloud.test.ts) |
| 共享生命週期 | [shared SQL integration](../src/database/shared-trip.integration.test.ts)、[shared cloud](../src/database/shared-trip.cloud.test.ts)、[shared repository](../src/database/shared-trip.repository.test.ts) |
| 邀請與協作操作 | [collaboration SQL](../src/database/trip-collaboration-cloud.test.ts)、[collaborative service](../src/modules/itinerary/collaborative-itinerary.service.test.ts) |
| 全站提示 | [HybridStatus](../src/common/HybridStatus.test.tsx) |

標籤批次改色已使用逐筆 facade 更新、顯示成功／失敗並保留失敗選擇；
不是整批原子更新。對應程式是
[BulkColorToolbar](../src/modules/label/BulkColorToolbar.tsx)、
[label service](../src/modules/label/label.service.ts)及
[bulk-operation](../src/common/bulk-operation.ts)。
目前不引用不存在的 BulkColorToolbar/bulk-operation 測試檔，也不聲稱其已驗證。

## 已跑結果（每批範圍分開）

| 階段 | 結果 | 不代表 |
| --- | --- | --- |
| 共享刪除修正 | 4 檔 49 tests 通過；精確 SQL 另經備份、隔離 PostgreSQL 17 演練並安裝 | 當次沒有 live 業務刪除／瀏覽器驗收 |
| 共享衝突隔離 | 7 檔 96 tests 通過 | 當次未跑型別／build／lint／E2E／live DB |
| 取消、撤權與重試補強 | 7 檔 90 tests，`tsc -b` 通過；測試 helper 型別修正後 29 項共享整合再通過 | 未跑 build／lint／E2E，沒有本階段線上業務操作 |
| 線上版本盤點 | 唯讀 catalog：共享核心相符，另有基礎權限／結構差異 | 不是測試套件、不是前端部署比對、不是差異已修正 |

上述批次有重疊，不可加總成互不重複總測試數。
早期 distance、route-map、共享與 Email 更新的 build／测试紀錄，保留於
[資料庫操作](database-psql-operations.md)與[協作紀錄](trip-collaboration-rollout.md)，
只對當時版本與批准範圍有效。

## 現行自動同步契約

- 非管理員使用 hybrid/auto；管理員可切來源／同步模式，無偏好時預設 hybrid/auto。
  hybrid 不再限 DEV，登入會做帳號隔離準備；auto sync 可初始化／拉推資料。
  不自動搬移 standalone local 資料。
- 設定有 2 秒 debounce、10 秒 safety timer、前景 4 分鐘補拉、
  online/focus/visibility 恢復與退避 jitter；timer 存在不等於所有連續輸入情況都有硬性 10 秒上限。
- 網路重試延遲有上限，但總次數沒有硬上限；不能寫成有限次網路重試。
- 私人衝突暫停自動同步；確認的共享衝突只隔離該 trip 的整條依賴链。
  不確定成功／失敗的凍結請求仍須原請求重試，不可跳過或改 payload。
- 撤權快照在 retry preflight 之後、私人事件之前下載；
  私人衝突暫停 auto 時，使用者可明確重新載入／同步共享資料。
- 剩下任何 outbox 任務時不提前更新「最近完整同步」。
  瀏覽器關閉／休眠或冷啟動離線登入不保證背景同步。

## Playwright：可版控、單視窗、由使用者執行

目前設定見 [playwright.config.ts](../playwright.config.ts)。
Chromium 一個 worker、不自動 retry、5 分鐘案例 timeout，
單視窗依序登入 A/B。截圖、影片、HTML、步驟 heartbeat 與結果 JSON 留存。

### 安裝與命令

使用 repository 現有 lockfile 安裝依賴；Linux 系統依賴需要使用者的安裝權限。
新電腦可由使用者執行：

```bash
npm ci
npm run e2e:install
# Linux 若缺系統函式庫，再由有權限的使用者執行：
npm run e2e:install:linux
```

將 [.env.e2e.example](../.env.e2e.example) 複製為 ignored `.env.e2e.local`，
私下填寫兩個不同帳號；A 需 admin 以切換 `/data` 來源，B 要有可選的另一個私人地點。
連線仍使用 `.env.local`，不能使用 service-role/privileged browser key。
設定 `E2E_ALLOW_LIVE_WRITES=true` 代表案例將新增／分享／修改／刪除真實行程，
不是唯讀測試；不得把密碼寫入程式、文件或公開結果。

```bash
npm run e2e          # headless，不會跳出可見瀏覽器
npm run e2e:headed   # 在可用圖形環境顯示實際操作
npm run e2e:report   # 查看 HTML 報告與錄影
```

遠端環境的 headed 需要可用 display；不能僅憑 terminal 顯示啟動就說瀏覽器已可見。
AI 不自動跑此真實帳號案例。

### 現行 24 步情境摘要

[shared-trip-invitation.e2e.ts](../e2e/shared-trip-invitation.e2e.ts)：
A 登入 → 建立行程／第一個地點 → 邀請 B／可用時啟用共同編輯 → A 登出 →
B 登入接受 → 等 5 秒並觀察第一個地點 → B 加第二個地點、等 upload、退出、登出 →
A 登入切 cloud 觀察第二個地點（先記錄，不立即斷言） →
**切回 hybrid 才刪除本輪行程**、等待 matching cloud acknowledgement、重新整理確認 →
回 `/data` 保持 hybrid，完成清理／復歸後才斷言。

每步由[progress reporter](../e2e/progress-reporter.ts)顯示開始／完成／失敗／等待，
結果在 `test-results/`、`playwright-report/`、`e2e-logs/`；
都不是應提交的 source。沒有新增另一份雙視窗或路程試算驗證流程。

### 最新結果：未通過，根因待查

使用者先前回報手動成功，但最新分享的失敗附件為：

1. `B 找不到本輪共享行程；拒絕將測試地點加入其他行程。`
2. cleanup 的 `page.goto('/data')` 出現 `Target page, context or browser has been closed`。

目前沒有根因驗證，不能確認此輪已刪除測試行程／恢復模式。
cleanup 的獨立 timeout 不能保證已關閉 browser 還能操作。
下一次要保留該輪 trip 名稱／ID、step log、scenario-result、錯誤與錄影，
不自動刪除未知資料，不以延長等待／skip 代替原因調查。

## Cloud replace／clear 人工紀錄模板

仍需使用者核准並在指定環境驗證，PGlite 不代表 live 已過。

| 檢查 | 預期 | 實際／PASS/FAIL/未跑 |
| --- | --- | --- |
| Member replace | preview/apply 成功，counts 與 incoming 一致 | 未記錄 |
| Member clear | 成功且目前帳號受影響表為 0 | 未記錄 |
| stale token | preview 後資料變動，apply 被拒絕 | 未記錄 |
| shared/collaboration guard | replace/clear 被拒絕，其他資料不變 | 未記錄 |
| Admin account scope | 只影響目前帳號，不動其他 owner | 未記錄 |

另填日期、環境、批准範圍與資料復歸結果。舊 bootstrap／phase-2 SQL 不應直接重播；
現行操作要求見[資料庫規範](database-psql-operations.md)。
