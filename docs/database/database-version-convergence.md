# 線上資料庫與版本一致：收斂計畫

更新日期：2026-10-20（UTC+8）

## 新對話接手入口

使用者要休息並關閉原對話。本文件必須能獨立交接，
不要依賴原對話 context、session 私有檔案或未版控的備份位置。

### 可直接貼給下一個對話

> 請接續「線上資料庫與版本一致」的收斂工作。
> 請先載入專案 development workflow 與 Supabase architecture skills。
> 我允許你查閱 docs/database/database-version-convergence.md、docs/task/progress.md、
> docs/database/database-psql-operations.md、docs/system/trip-collaboration-rollout.md、
> docs/system/testing.md、docs/system/test-plan.md，以及相關程式碼／migration／測試。
> 先完整讀收斂計畫，從 A「權限收斂」與 B「雲端原子排序 API」開始：
> 增量 migration 與隔離回歸測試程式已寫但未測、未安裝；先核對本輪新增檔案，
> 不要重寫既有成果。權限 migration 會阻擋未批准的 default／繼承授權，
> 必須另行批准 catalog 盤點後才能準備建立者專屬 default ACL 修補及精確回復 SQL。
> 不要重新設計共享，也不要重播 baseline 或清除 outbox。
> 不預設舊會話授權仍適用；任何新線上存取、Git 檢查、測試／型別檢查、
> build／lint／Playwright 與部署都先列出範圍並取得本輪授權。
> 完成實作後停下來請我授權針對性驗證。
> 沒有精確的備份、隔離還原演練與安裝批准，不得寫線上 DB。
> 報告先講結論，使用繁體中文，區分「已寫、已測、已安裝、已人工驗收」。

### 接手時先確認

1. A／B 的增量 SQL、隔離測試程式與盤點入口已寫；**未測、未安裝**。
  A 的 default ACL 修補與精確反向權限 SQL 尚待新盤點及批准；C～E 尚未實作。
2. 先看[目前進度](../task/progress.md)與本文件，不把舊測試通過當作這一階段已驗證。
3. 使用者已允許本次整理全部 docs 文字文件，但歷史 SQL 僅查閱、不修改。
   新對話如需其他文件，仍遵守專案文件授權規則。
4. 不假設工作區乾淨、已提交或新對話仍有舊 session 檔案。
   本輪未獲 Git 檢查批准；需要確認 revision／工作區時另問，勿覆蓋他人變更。
5. 現有連線由不版控的 `.env.local` 提供，入口是
   [db-psql wrapper](../scripts/db-psql.mjs)；檔案存在不表示可以直接執行線上查詢。
6. 舊備份與當時比對原始 catalog 沒有放入 repository。
   本文件保存的是盤點摘要；操作前應重新取得批准、對帳及新備份，
   不能把找不到舊 session 備份當成略過還原演練的理由。
7. 最新 E2E 失敗另列於文末；不要順手修／跑它，更不能自動登入真實帳號。

## 結論與目前進度

**A／B 增量實作與測試程式已寫，尚未執行驗證或安裝；線上差異仍未收斂。**

本輪僅閱讀獲准文件／程式並修改工作區，沒有 Git 檢查、測試／型別檢查、
build／lint／Playwright、線上連線、備份、演練或部署。
「已寫」不等於已測、已安裝或已人工驗收。

共享編輯、邀請、取消共享及共享行程刪除所需的核心資料庫函式，已與目前工作區 SQL 一致。
剩餘工作是基礎權限、缺少的排序 API、歷史結構差異與版本追蹤，
不是重新安裝共享功能，也不是重播整套 schema。

- 優先項：權限收斂、排序 API，連同備份／演練／核准後安裝，估 **2～4 小時**。
- 全部項目：連同欄位、限制、歷史物件及版本追蹤，估 **4～8 小時**。
- 以上是工作時間估計，不含等待核准、人工驗收；若既有資料不符合新限制，需重新估時。
- 本計畫不是修改線上資料庫、跑測試或部署的授權。

## 盤點基準與限制

2026-10-20 04:52（UTC+8）的唯讀檢查，將
[目前 migrations](../supabase/migrations/) 在隔離 PGlite 重建的 catalog，
與線上 PostgreSQL 17 的 `public`、`sync_private`、`collaboration_private` 比對。
另外比對註冊角色的指定 auth trigger；沒有讀取業務或帳號內容。

- 比對的是**當時工作區檔案**，沒有做 Git commit／分支／未提交狀態檢查。
- 沒有確認 Vercel 部署版本、部署環境變數或瀏覽器實際執行的前端版本。
- 結構存在、函式相符，不代表 HTTP/Auth、權限行為、跨裝置或 E2E 全部通過。
- PGlite 與線上 PostgreSQL 的 NOT NULL catalog 表達不同；
  115 筆此類表達差異不算遺失限制，欄位 `notNull` 另有比對。
- 不可僅憑本次結果認定差異由共享開發造成；缺少足以追溯每項歷史變更的證據。

## 已確認一致的範圍

| 範圍 | 結果 |
| --- | --- |
| 個人同步 | `app_sync_snapshot`、`app_sync_pull`、`app_sync_push` 定義與受檢執行權限一致，包含共享行程刪除順序修正 |
| 協作與 Email 邀請 | `app_trip_collaboration`、`app_trip_collaboration_v2` 一致 |
| 共享與取消 | `app_shared_trip`、`app_cancel_shared_trip` 一致 |
| 共同編輯保護 | `shared_legacy_guard`、`shared_size_guard` 一致 |
| 應用資料表 | 預期 20 張全部存在，不包含整個 Supabase 平台／auth 表數 |
| RLS policies | 13 項一致；**不代表額外 grants 也一致** |
| 索引／觸發器 | 50 個索引一致；55 個預期觸發器都存在且一致，另有 8 個額外舊觸發器 |

## 差異與處置清單

### A. 優先：權限收斂

**本輪已寫（未測、未安裝）**

- [catalog 唯讀盤點](../../supabase/inspection/privilege_convergence.sql)：
  表／欄位／函式原始 ACL、owner、grantor、grant option、PUBLIC／直接／繼承來源、
  角色成員關係及 default ACL 的建立者／全域／schema 範圍；不讀業務或帳號內容。
  檔案存在不是執行授權，本輪未執行。
- [增量權限 migration](../../supabase/migrations/20261020010000_privilege_convergence.sql)：
  交易、timeout、既有全域共用鎖；僅撤除列出的直接漂移。
  不改資料／角色／RLS／schema ACL，不遞迴撤除平台角色權限。
- [隔離回歸程式](../../src/database/privilege-convergence-cloud.test.ts)：
  重現直接／PUBLIC／繼承／欄位授權與 default ACL，檢查失敗回滾及平台權限保留；
  包含角色隔離、備份 token／共享守門、個人同步與共享撤權，但**尚未執行**。
- [權限回復範本](../../supabase/rollback/20261020010000_privilege_convergence.sql)
  刻意阻擋執行，不是可直接安裝的反向 migration。
  必須依安裝前精確 ACL 產生逐物件／grantor 回復 SQL，另行批准並演練；
  不盲目把危險 grants 加回去。

| 物件 | 預期保留／撤除（仍須新 catalog 核對） |
| --- | --- |
| 10 張指定表 | authenticated 保留 CRUD，撤 TRUNCATE／REFERENCES／TRIGGER；anon 不應有表或欄位存取 |
| 9 個備份／ACL 函式 | 保留既有 authenticated EXECUTE，撤 anon EXECUTE；不趁此改 API 契約 |
| 2 個 owner trigger 函式 | 撤 anon／authenticated EXECUTE；trigger 正常運作不需要呼叫者直接 EXECUTE |
| owner／service_role／其他平台角色 | 不改其直接 grants、grant option、角色成員關係或 schema 權限 |
| PUBLIC／繼承／額外 grant option | 若仍提供非預期存取，整份 migration 回滾，待逐項決策，不任意遞迴 REVOKE |
| default privileges | **未修復**；涉及 anon／authenticated／PUBLIC 的未批准全域或 public-schema defaults 會阻擋安裝 |

**尚缺的決策與證據**：舊摘要沒有精確 default ACL 建立者與 grantor。
不能猜測 `ALTER DEFAULT PRIVILEGES FOR ROLE ...`，也不能忽略全域與 schema ACL 的加總。
目前 gate 刻意保守，連顯式保留 PUBLIC EXECUTE 的 default ACL 也需單獨核准。
預期線上既有 defaults 會先阻擋本 migration；取得新的唯讀批准與結果後，
才準備精確建立者專屬修補／反向定義，未完成前不得稱 A 可安裝或已收斂。

**現況**

- 10 張表有受檢 grant 差異：9 張業務表與 `user_roles`。
- authenticated 在這些表有超出基準 CRUD 的 `TRUNCATE`、`REFERENCES`、`TRIGGER` 權限。
- `user_roles` 的 anon grants 也比基準寬。
- 11 個既有函式存在執行權限差異，包含備份函式、owner 指派及 ACL helper；
  不是共享核心函式本文不同。
- 線上 public schema 的 default privileges 會給 anon/authenticated 額外權限，
  必須一起檢查，不能只修目前物件。

具體差異物件（接手後仍需重新核對當前 catalog）：

- 9 張業務表：`regions`、`labels`、`places`、`place_regions`、`place_labels`、
  `trips`、`itinerary_items`、`route_maps`、`route_map_places`；另有 `user_roles`。
- 函式：`app_backup_preview_clear()`、`app_backup_apply_clear(text)`、
  `app_backup_account_counts(uuid)`、`app_backup_has_shared_trip(uuid)`、
  `app_backup_account_signature(uuid)`、`app_backup_assert_payload(jsonb)`、
  `app_backup_preview_replace(jsonb)`、`app_backup_apply_replace(jsonb,text)`、
  `can_manage_trip_acl(uuid)` 的 anon execute 比基準寬；
  `assign_private_record_owner()`、`assign_route_map_record_owner()` 的
  anon/authenticated execute 比基準寬。
- 不直接對整個 public schema `REVOKE ALL`；根據各物件用途與授權來源收斂。

**待辦**

- [ ] 列出每個物件、角色、直接／繼承／PUBLIC 來源與應保留的最小權限。
- [ ] 分開評估表 grants、函式 execute、default privileges，保留 Supabase 平台必要權限。
- [ ] 在隔離環境驗證 anon/basic 拒絕、member 自有資料、admin 既有管理、
  備份守門、個人同步、共享讀寫與撤權。
- [ ] 準備只收斂明確差異的增量 migration 與反向權限定義。
- [ ] 經備份、演練與另行核准後才安裝；驗證資料與角色未被改寫。

目前僅確認 grant 漂移，沒有執行利用測試或完整安全稽核。
RLS 不應被當作所有表權限的替代品，也不應在沒有驗證前宣稱寬授權無影響。

### B. 優先：補齊雲端原子排序 API

**本輪已寫（未測、未安裝）**

- [原子排序增量 SQL](../../supabase/migrations/20261020020000_atomic_itinerary_reorder.sql)：
  `SECURITY DEFINER`、空 search path、member 與 owner/admin 檢查，
  使用既有全域共用鎖及行程／項目 row locks；拒絕 active shared workspace，含空白日。
- 嚴格驗證日期及完整單維 ID 集合；先保存原前驅地點，分成兩個獨立 UPDATE，
  不使用會對同一列重複更新的 data-modifying CTE。
  核對既有 deferrable 唯一限制後使用固定暫存區間，不以最大 sort_order 相加，
  避免整數溢位。僅清除前驅地點改變項目的時間／距離估計。
- 保留同步 triggers；兩階段資料、events、versions 一起提交或回滾。
  local／hybrid repository、outbox、自動同步與 activated shared API 均未修改；
  舊環境缺 RPC 時的前端 fallback 仍保留，未宣稱已切換線上流量。
- [隔離排序回歸程式](../../src/database/itinerary-reorder-cloud.test.ts)
  使用含 A／B 的排序 migration 鏈，涵蓋輸入／角色／共享拒絕、估計失效、
  最大整數、暫存碰撞與第二階段失敗的資料／同步事件回滾，尚未執行。
- [停用 rollback](../../supabase/rollback/20261020020000_atomic_itinerary_reorder.sql)
  只撤 RPC 權限，不還原已完成的排序、不刪資料；若替換原有 RPC，
  精確還原舊定義仍須安裝前保存及另行批准。

限制：PGlite 回歸不取代 PostgreSQL 多連線競爭演練；RPC 會將排序唯一限制
切回 immediate，外層交易若另有未完成 deferred 排序違規，也會被拒絕。

**現況**

前次唯讀盤點時線上缺少 `app_reorder_itinerary_items(uuid,date,uuid[])`，本輪未重查。
[雲端 repository](../src/database/supabase.repositories.ts) 遇到缺少 API 時，
會先改暫時順序、再逐筆寫最終順序；不是完全不能排序，但不是單一原子交易。

實作入口：

- [baseline 中的舊排序函式](../supabase/migrations/20261017153621_repository_baseline.sql)：
  作為比較參考，不重播整檔。
- [distance extension](../supabase/migrations/20261018220000_itinerary_travel_distance.sql)：
  舊排序函式只在存在時才被此 migration 更新；新 API 要納入距離／時間失效規則。
- [雲端排序呼叫與 fallback](../src/database/supabase.repositories.ts)、
  [共享排序 service](../src/modules/itinerary/shared-trip.service.ts)。
- [現有 SQL 測試基礎](../src/database/sync-cloud.test.ts)、
  [共享 SQL／Dexie 整合](../src/database/shared-trip.integration.test.ts)及
  [雲端 route-map SQL 測試](../src/database/route-maps-cloud.test.ts)可參考既有 fixture 模式。

**待辦**

- [ ] 依目前日期、owner、共享 guard、路程估算與排序約束設計增量 API。
- [ ] 不直接從舊 baseline 盲目複製；檢查是否與已安裝的 distance／shared 修正相容。
- [ ] 驗證完整排序、非法／重複／漏項 ID、跨行程／日期、跨帳號拒絕及中途失敗回滾。
- [ ] 驗證 local／hybrid 原有 repository/outbox 路徑不變，activated shared 排序仍走共享 API。
- [ ] 核准安裝後確認前端實際走到新 RPC，不再依賴缺少 API 的 fallback。

### C. 次階段：欄位與資料驗證

| 差異 | 現況／待決定 |
| --- | --- |
| 關聯表時間欄位 | `place_labels.created_at`、`place_regions.created_at` 未存在；先確認是否需要，不為外觀一致而強行回填 |
| UUID 預設 | trips／labels／places／itinerary_items 的 id 沒有基準中的資料庫預設；目前前端會傳 UUID，仍需評估其他寫入入口 |
| 區域縮放 | 線上 `regions.zoom` 是 numeric，基準是 integer；前端讀取會轉 number，變更型別前需檢查資料 |
| 地圖來源限制 | places／regions 的空白來源驗證比基準寬，places 缺少 `places_maps_url_check` |
| 舊中心座標 | regions 的 center 只檢查 object，沒有基準中的鍵與經緯度範圍限制 |
| 等價／額外限制 | 名稱／顏色非空檢查有不同寫法，另有 trips／places 限制；逐項分辨等價與真正行為差異 |

- [ ] 經授權後以只回傳違規筆數的資料檢查評估影響；本次尚未讀取或驗證既有資料。
- [ ] 每項決定「更新線上」或「修正版控基準」，不要預設工作區 baseline 一定較正確。
- [ ] 不默默修剪使用者資料、不無條件新增 NOT NULL／轉型／刪欄。
- [ ] 核准測試、演練後分批處理，不和權限修正綁成一個難以回復的大變更。

### D. 次階段：歷史函式／觸發器

- 4 個額外函式：`touch_updated_at`、`prevent_trip_date_exclusion`、
  `validate_itinerary_item_date`、`set_trip_editors`。
- 8 個額外觸發器：舊 updated-at、標籤循環及日期檢查等。
- 目前應用沒有搜尋到 `set_trip_editors` 呼叫，但不能因此斷言沒有其他使用者。

- [ ] 逐項查依賴、功能重疊與外部使用可能性。
- [ ] 決定保留並納入基準，或先停用／撤 execute 再移除；需另行核准。
- [ ] 確保不移除仍被引用的規則，也不破壞已開啟共享行程的 legacy guard。

### E. 版本追蹤與部署一致性

線上沒有 `supabase_migrations` schema，不能靠 migration 表還原實際安裝歷史。
這不代表 migrations 沒有安裝；本次是直接比對目前 catalog。

- [ ] 決定往後使用 Supabase migration history 或專案專用的結構指紋／安裝紀錄。
- [ ] 不把所有檔名直接寫入「已套用」，不捏造過去的安裝時間。
- [ ] 分開記錄工作區／Git revision、資料庫結構指紋、前端 deployment revision 與 build-time flags。
- [ ] 取得 Git／部署查閱授權後，確認實際發布版本，而非把本機修正當成已上線。
- [ ] 每次變更留存批准範圍、來源、備份、演練、安裝與驗證結果。

## 執行順序與時間

| 順序 | 工作 | 粗估 | 目前狀態 |
| --- | --- | --- | --- |
| 0 | catalog 唯讀盤點 | 已完成 | 尚未做資料／部署驗證 |
| 1 | 權限與排序 API 修正、針對性測試 | 原估 1～2 小時 | 增量與測試程式已寫；未測；default ACL 精確修補／反向定義待盤點 |
| 2 | 新備份、隔離還原與演練、核准後安裝及確認 | 再 1～2 小時 | 未授權／未執行 |
| 3 | 欄位、限制、舊物件及版本追蹤 | 再約 2～4 小時 | 逐項決策後實施 |

每階段均可停止，不以完成此文件表示可以直接進入線上安裝。

## 安全執行與驗收門檻

1. 確認本次精確改動及目標，另取修改／測試／線上操作授權。
2. 重新對帳 catalog，若基準改變先停止；備份與演練需足夠新。
3. 備份包含受影響應用、同步、協作與必要 auth 依賴；保存在私有儲存，不進 Git 或聊天附件。
4. 隔離還原後驗證指紋、owner、關聯、權限、收據及未同步請求相容性。
5. 安裝只執行增量 migration，交易、共用鎖、明確 timeout、失敗回滾；
   不重播 baseline、不停用共享 guard、不清使用者 outbox。
6. 驗證既有資料未改寫，權限符合決策；以角色行為測試補足 catalog 證據。
7. 記錄部署／前端版本與人工流程結果。完整備份還原可能丟失其後合法修改，不能當自動回退手段。

細節見[資料庫操作規範](database-psql-operations.md)、
[協作行為與歷史安裝紀錄](trip-collaboration-rollout.md)及[測試紀錄](testing.md)。

## 已完成修正的程式入口（不要重做）

| 主題 | 入口 | 已有證據 |
| --- | --- | --- |
| 混合模式刪除共享行程 | [刪除順序增量 SQL](../supabase/migrations/20261020000000_shared_trip_delete_order.sql) | 已演練／安裝；當次 49 tests |
| 共享衝突不阻擋私人同步 | [store](../src/database/local-sync.store.ts)、[engine](../src/database/sync-engine.ts)、[scheduler](../src/database/hybrid.runtime.ts)、[提示](../src/common/HybridStatus.tsx) | 當次 7 檔 96 tests；分開計數／跳過整條共享行程衝突鏈 |
| 原子取消共享 | [取消 SQL](../supabase/migrations/20261019090000_cancel_trip_sharing.sql) | 已安裝；不是回復啟用前資料 |
| 取消、撤權與重試補強 | [cloud adapter](../src/database/shared-trip.cloud.ts)、[repository](../src/database/shared-trip.repository.ts)、[engine](../src/database/sync-engine.ts) | 當次 7 檔 90 tests、`tsc -b`；改測試參數型別後 29 項共享整合重跑通過 |
| 單視窗 E2E | [scenario](../e2e/shared-trip-invitation.e2e.ts)、[設定](../playwright.config.ts)、[進度 log](../e2e/progress-reporter.ts) | 使用者曾手動成功，但最新附件失敗；不是目前持續通過的證據 |

上述測試批次範圍重疊，不能加總成互不重複的總覆蓋數。
最新型別檢查涵蓋當時工作區，不等於 production build／部署驗證。

## E2E 與共享收尾的獨立追蹤

使用者先前回報手動流程成功，但最新提供的 E2E 失敗附件包含：

- `B 找不到本輪共享行程；拒絕將測試地點加入其他行程。`
- 收尾時出現 `Target page, context or browser has been closed`。

因此目前不能標記整個 E2E 或本輪資料清理成功。
單憑這些錯誤不能判定是同步、UI 等待、權限、測試腳本或執行中斷造成，
也不能把它直接歸因於本次 catalog 差異。
後續需檢查該輪步驟日誌／結果／錄影、確認獨特測試行程是否殘留，
另行核准後才修正或重跑真實帳號流程；不自動刪除未知測試資料。

## 完成定義

- [ ] 優先權限差異已依批准決策收斂，角色行為驗證完成。
- [ ] 排序 API 安裝且原子性與相容性通過。
- [ ] 其餘差異均有明確處置或保留理由，不留下未解釋漂移。
- [ ] 有可重複的版本／指紋追蹤，且沒有偽造歷史。
- [ ] Git／前端部署與資料庫三者分開確認。
- [ ] E2E 失敗及清理結果已追蹤，未完成項明確揭露。
- [ ] 驗證證據與限制回寫到文件；不將單一測試或唯讀 catalog 當成全部驗收。
