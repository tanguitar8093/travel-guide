# 第四階段：雲端同步 API Review

狀態：同步 API 與隔離測試已完成，待 review。未套用實際 Supabase，未啟用畫面同步，未授權第五階段。

## 給不寫程式的使用者

- 雲端新增「取得完整資料」「取得後續變更」「送出本地操作」三個同步入口。
- 每份資料有伺服器版本；版本過期時回報衝突，不直接覆蓋。
- 同一個操作重送不會重複新增，重送內容不同則拒絕。
- 一批操作一起成功或一起取消；地點與區域／標籤關聯一起處理。
- 刪除也留下紀錄，之後另一台裝置才知道哪些資料要移除。
- 原有 Supabase 操作、排序、覆蓋匯入與清空也會被追蹤。
- member、admin、basic 的原權限保留；同步入口限目前帳號自己的資料。

這次是雲端程式的準備，尚未安裝到真正雲端。現在瀏覽器的混合測試仍只在本機操作，畫面還沒有同步按鈕。第五階段才串接初始化、雙向同步及衝突畫面。

## 快速 Review

在專案終端執行：

```bash
npm run test:run -- src/database/sync-cloud.test.ts src/database/sync-cloud.adapter.test.ts src/database/owner-isolation.test.ts
```

使用記憶體內 PostgreSQL（PGlite），不需要密鑰、不觸碰真實雲端。檢查包含：穩定 ID、重送、防覆蓋衝突、不同帳號拒絕、admin 同步自己的資料、basic／匿名拒絕、部分失敗整批取消、地點關聯、行程排序、連帶刪除、分頁保留完整交易、舊覆蓋／清空追蹤與原權限回歸。

目前已通過 25 項相關檢查。這是隔離資料庫的證據；實際網路、PostgREST、並行 PostgreSQL 連線與 Supabase advisors 尚未驗證，不宣稱已部署或完成跨裝置同步。

## Migration 與套用邊界

| 檔案 | 用途 |
| --- | --- |
| `supabase/migrations/20261017153621_repository_baseline.sql` | 從目前四份 docs SQL 建立可重現基線；適合空資料庫，或既有資料已歸屬 owner 的環境 |
| `supabase/migrations/20261017153641_local_first_sync.sql` | 新增同步內部表、觸發器與三個 RPC；在基線之後執行一次 |
| `src/database/sync-cloud.adapter.ts` | 同步資料層 API，尚未接入 runtime 或畫面 |
| `src/database/sync-cloud.test.ts` | 基線、SQL 同步與權限整合測試 |
| `src/database/sync-cloud.adapter.test.ts` | API 參數、未知版本拒絕、重送 payload 穩定及回傳檢查 |

基線保留舊資料 owner／角色，不寫入帳號或環境資訊；存在未歸屬資料時明確拒絕，須先按既有 owner 遷移處理。基線來源為 repository SQL，並非實際 Supabase schema dump。

對既有雲端，不可以直接執行所有 migration 或自動標記已套用。正式套用前必須另獲使用者批准：備份、只讀比對 effective schema／policy／constraint／function 與基線、確認 `itinerary_items_trip_id_date_sort_order_key`，再決定基線歷史對齊與同步 migration 套用方式。需要在測試 Supabase 先驗證 PostgREST RPC、advisors 和兩條並行連線的提交／回滾；通過後才準備正式套用。

## 同步協定

- `app_sync_snapshot()`：傳回自己全部現存記錄、版本與 cursor。既有資料會在同步 migration 時建立初始版本；不重生 UUID。
- `app_sync_pull(p_cursor, p_limit)`：只傳自己 cursor 後的事件。limit 為 1～500，遇到交易邊界會延長該頁以包含整筆交易，因此實際事件數可超過 limit。
- `app_sync_push(p_task)`：一次原子操作群組，最多 500 筆變更、1 MiB JSON。UUID／版本以字串傳輸；kind 為 put／delete，put 為完整業務記錄。
- 新記錄 `baseVersion:null`；修改／刪除需最新版本；缺少版本拒絕。前序本地任務版本接續由第五階段引擎處理，本 API 不擅自替未知版本套值。
- Push 的帳號 UID 必須符合 auth.uid()。owner、role、ACL 等欄位不允許出現在業務記錄；外鍵強制同 owner 參照。
- 去重內容只包含協定版本、操作 ID、帳號及 changes，不含會改變的 attempts／status／時間。
- Push 回應成功後 cursor 不得直接當成本地已拉取水位：成功回應只包含本次操作事件，其他裝置先前提交的變更仍需從原 cursor 拉取。
- 變更事件帶 transaction ID。同一交易的同實體可有中間事件，第五階段須在本地原子套用時收斂至該交易最終結果，再檢查參照與更新 cursor。
- 操作內順序保留；建立父資料須早於子資料，受 restrict 保護的刪除先處理子參照。排序 unique constraint 改為可延後檢查，最後強制驗證後才回傳成功。

## 權限與交易鎖

同步事件、版本及收據放在不公開的 `sync_private` schema，啟用 RLS 並撤銷 anon／authenticated schema 存取。內部函式不授予客戶端執行權。

三個公開 RPC 使用 `SECURITY DEFINER`，原因是客戶端不得直接讀寫或偽造同步事件／收據，且必須原子操作多表。這些函式會繞過 RLS，因此自身嚴格驗證 `auth.uid()`、伺服器角色、現有記錄 owner、允許欄位與資料庫同-owner 外鍵；使用空 search_path。同步 admin 不取得他人的 snapshot，原直接雲端 admin 管理權限不變。

所有七表的寫入在 statement trigger 先取得同一個 transaction advisory lock。snapshot／pull／push 也取得該鎖；因此寫入交易提交或回滾以前，另一同步請求不能跨越其序號。sequence 是傳輸順序，版本是 UUID；不用裝置時間或單獨 updated_at。

這是刻意採用的簡單一致性策略：會序列化不同帳號的雲端寫入與同步讀取，可能降低高併發吞吐量，且長時間交易會延後其他同步請求。先適用此小型專案；若量測顯示瓶頸，再另行 review 每帳號鎖或 CDC 方案。本地互動不受該雲端鎖直接阻塞。

PGlite 驗證交易回滾後序號有空洞也不漏後续提交。真正跨連線「晚提交」鎖等待測試尚未執行，不把單連線測試當作併發證據。

## 保留與回退

第一版不自動清理事件、刪除版本及收據，避免離線裝置漏刪或重送重複。cursor 超過伺服器已提交水位時拒絕，要求受控重新初始化。成長量、清理窗口與過期裝置政策須在加入清理前另外 review。

同步 migration 建立一次，不設計重複手動執行。未套用雲端時直接停止即可回退；套用後可停止呼叫同步 API，但不要自動刪除記錄／觸發器／收據。SQL 回退與已上傳資料恢復需要另外備份及核准。

## 驗證紀錄

- 25 項同步 API／adapter／既有 owner-isolation 測試通過。
- Production build 通過；同步 adapter 尚未被正式資料入口呼叫。
- Lint 無錯誤；保留既有 `ItineraryModule.tsx:404` warning 與 build bundle 大小提示。
- 未執行全套測試、實際 Supabase query／advisors、並行連線及雲端部署。

本階段交付後停止。Review 通過不等於授權套用實際雲端；第五階段與實際 SQL 套用需分別明確指示。
