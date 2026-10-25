# 線上資料庫與版本一致：收斂計畫

更新日期：2026-10-20（UTC+8）

## 最新核准範圍已實作：NEW VERSION WRITTEN／NOT TESTED／NOT INSTALLED

**本節取代下方舊「待批准縮限」、「必須平台支援才能繼續」、「正式 postgres 無 CREATE」
及「合成平台演練可作本版依據」結論。舊紀錄僅保留作歷史，不是本版驗證。**

使用者已批准保留內部 supabase_admin defaults，只收斂 postgres 自身 public defaults、
10 張既有應用表／11 個既有函式的指定 ACL，及安裝私人 itinerary reorder RPC。
本輪僅編輯原始碼、回歸案例與文件；**沒有執行任何測試或檢查（含 Node 語法／型別）、
Git、build、lint、Playwright、連線、線上讀寫、安裝或新備份／隔離演練。**

- 兩份權限 migration 嚴格接受 supabase_admin 在 public 的完整已盤點矩陣，或完全沒有
  該 schema 的平台 default rows；部分矩陣不接受。PG17 為 24 cells／3 個 catalog rows
  （分 client/type 為 6 組），較早引擎不含 MAINTAIN 為 22 cells。
  建立者／grantor 均為 supabase_admin，直接 anon／authenticated，無 grant option；
  tables 為 8 種、sequences 為 USAGE／SELECT／UPDATE、functions 為 EXECUTE。
  不 blanket skip creator；額外 grantee／權限／來源／global／PUBLIC／繼承來源仍阻擋。
  無平台角色或 defaults 的 standalone baseline 仍可接受；postgres 稀疏 defaults 可收斂。
- 平台所有 defaults 的原始 catalog rows 與語意保持不變；不要求或新增平台 USAGE／SET。
  只修改有合法自身 USAGE／SET 授權的 postgres defaults，不改角色、membership、schema ACL、
  RLS 或業務資料，不擴張既有物件撤權範圍。內建 PUBLIC function EXECUTE 不做全域撤除，
  仍由每個 RPC 明確 REVOKE PUBLIC。將來平台建立的 public 物件仍可能有 client 權限，
  **必須逐物件 ACL 審查，不宣稱整個平台或未來物件已完全收斂。**
- 擷取 v2 加入範圍版本、資料庫 owner／operator ownership、原始／語意資料庫 ACL、
  allow-connections／connection-limit、有效 database CREATE／CONNECT／TEMPORARY、
  pg_database_owner USAGE／SET、public USAGE／CREATE，不輸出資料庫名稱／專案識別。
  migration、rollback 及完整擷取／演練來源清單納入凍結雜湊；缺檔／清單缺項亦拒絕。
  舊 capture 缺上述證據或來源／範圍不符，一律 fail closed，須另准新鮮擷取，不能猜測補值。
- 隔離還原在建立角色後、比對前恢復 captured DATABASE owner。修正事實是 postgres
  NOSUPERUSER 擁有正式資料庫，public owner 為 pg_database_owner，因此確有 public CREATE。
  原隔離 bootstrap owner 遺漏造成的 CREATE 缺口不是正式權限問題。
  合成 superuser 只供 bootstrap／還原，不再執行 migration／recovery 或臨時 GRANT CREATE。
  新演練要求三份 migration 及凍結 recovery 全由實際等效 postgres 成功執行，並比對
  database ownership、有效權限、角色／memberships、平台 raw defaults、既有函式與資料指紋。
- 新 recovery 僅重授被撤的 postgres defaults 與捕獲到的既有物件 ACL；不產生修改／還原
  未變平台 defaults 的命令。執行前守住原角色圖、executor／owner／schema 權限、平台 raw／
  semantic defaults、既有 ACL 與新 reorder 的 source／owner／config／signature／ACL。
  同時守住 server version、database ACL／屬性、schema owner／ACL 與既有欄位 ACL；
  reorder 重裝亦拒絕額外 grantee／grantor／grant option，交易完整回滾。
  **舊私人凍結 archive、候選 recovery 與 attestation 完全未觸碰或重產**，不適用新範圍。
- local IndexedDB、direct cloud 及 hybrid automatic-sync/outbox 的應用路徑未改；
  回歸案例涵蓋保留平台矩陣下的 reorder 與真實 hybrid engine→SQL RPC 路徑。

下一步先取得離線驗證批准：四份既有聚焦 Vitest、新擷取／復原 fixture 測試、
Node 語法與 TypeScript 型別檢查（每項另依批准執行）。新鮮唯讀擷取／一致快照備份、
修正 owner 的無網路隔離還原／migration／recovery 演練、精確線上安裝均須分別批准。
先前 51 tests／型別通過與舊合成演練只屬舊版，不轉移為本版通過證據。

## 歷史更正：正式 psql 唯讀核對的有效權限（本輪未重查）

本節優先於下方所有「正式 postgres 缺 public CREATE」及「等效角色完全重現」敘述。
本輪使用既有 db-psql wrapper、READ ONLY 交易確認：

- 正式資料庫 owner 是 postgres；public schema owner 是 pg_database_owner。
  postgres 透過資料庫 owner 的隱含角色具備 public USAGE／CREATE，兩者皆 true。
  **先前說正式 postgres 缺 public CREATE 是錯誤判讀，不是新授權或線上變更。**
- 隔離工具以 supabase_admin 初始化叢集，卻未將還原目標資料庫 owner 重現為 postgres，
  因此遺漏 pg_database_owner 的隱含有效權限。先前角色屬性／membership 比對通過
  不足以證明 database ownership 與所有有效權限也相符。
  舊演練的 CREATE 缺口及暫時授權結論不適用正式環境；須補齊 database owner
  擷取／還原及有效 schema 權限守門後，重新批准演練才可作安裝依據。
- 10 張目標表與 11 個目標函式全部由 postgres 擁有，操作角色具 owner 權限。
  因此既有物件的精確 ACL 修補與建立新 RPC 並非因平台 defaults 而在 PostgreSQL 層面
  一概不可執行；仍須符合各 migration 的其他 guards、備份及批准門檻。
- postgres 對 supabase_admin 的 USAGE／SET 仍皆 false，無權修改該 creator 的 defaults。
  postgres 可調整自己的 defaults；兩個 creator 在 public 各有 24 個 client privilege cells。
  creator defaults 只作用於該角色未來建立的物件，不會重新授權既有物件。

當時的舊套件要求清空兩個 creator，因此不能由 postgres 安裝。此結論只適用舊版。
目前使用者已批准縮限，並已寫入精確平台 allowlist／漂移守門；詳見頂部最新範圍。
平台未來建立的 public 物件仍須逐物件審查。新版未測／未演練／未安裝。

本輪僅新執行兩次唯讀 catalog 查詢，未讀業務資料、未寫線上、未改權限、未安裝；
尚未重跑隔離演練或專案測試。支援單不是先行必需步驟；若要求平台 defaults 一併移除，
才需再確認平台合法執行途徑。

## 歷史：舊版隔離還原／遷移／復原演練（不適用新版）

本節只保留舊版結果；資料庫 owner 重現有缺漏，不能當作新版等效 operator 證據。
舊合成演練不是新版驗證；當時未寫線上、未安裝、未部署或人工驗收。

- 重用原 438,778-byte 四 schema custom archive，未重新連線、擷取或備份線上。
  archive SHA-256、capture SQL 與三份 migration 的封存來源雜湊均符合；
  修訂演練工具另存雜湊，每次使用新的 0700 私人子目錄、0600 證據檔，避免舊紀錄混淆。
- PG17 使用原始 `supabase_admin` 作為**合成**叢集 bootstrap，搭配明確 `GRANTED BY`，
  沒有額外 bootstrap membership。完整角色屬性／連線限制、25 筆 membership 的
  grantor／admin／inherit／set 選項及原操作角色限制精確一致，未放寬守門。
- 還原 47/47 表內容指紋一致；71 個 FK 實際資料檢查零違規，其中 11 個為多欄。
  檢查使用 catalog 的 parent-child 等值運算子並處理 MATCH FULL 部分 NULL；
  此快照沒有 MATCH FULL FK，因此不是該分支的獨立測試證據。
  owner、語意 ACL、全部 captured defaults、欄位、限制、索引、觸發器、RLS、函式均相符。
  範圍外 180 筆 defaults 仍是合成支架，**不是整個 Supabase 平台備份**。
- **正式等效操作角色：預期失敗。** 第一份 migration 因缺少 `supabase_admin`
  USAGE／SET 而停止；連線關閉後第一交易完整回滾，後續兩份未安裝。
  原 ACL／defaults／函式／角色及 47 表指紋比對通過。另確認原角色無 public CREATE，
  即使平台 defaults 獲處理，也不能假設此角色可建立排序 RPC。
- **假設平台授權階段：三份 migration 成功提交。** 前兩份由合成平台 superuser 執行；
  排序函式由原 operator 建立，但僅此合成階段短暫給予 public CREATE，隨即撤除，
  完整 schema ACL 比對證明無殘留。未變更角色屬性、membership 或 migration 原始碼。
  這是明確增加合成平台權限的假設，**不代表正式操作角色有安裝權限**。
- **精確 recovery：成功。** 原凍結候選逐字執行，未重產、未覆寫 source／owner／config
  或 ACL poststate guards。復原交易提交後，47/47 表（含兩張收據表）指紋、原函式、
  物件與 schema 語意 ACL、所有 captured defaults、角色圖及受檢結構均恢復。
  原候選的 UNREHEARSED 檔名／註解保留不變；另有 SHA-256 attestation 證明本次演練，
  適用範圍僅此凍結快照與合成平台授權，不是正式執行批准或通用回復檔。
- 最新私人證據位於原備份目錄的 rehearsal-Pxui49 子目錄；以該次 rehearsal-status.json
  與 recovery-rehearsal-attestation.json 為準，不讀原目錄較早的 status 當最新結果。
  所有嘗試的叢集均已停止；無外部網路、無 TCP、無 sudo，使用 uid1000 私人 Unix socket。
- 本輪僅執行核准的 Node 語法檢查與隔離演練；未跑 Git、Vitest、型別檢查、build、lint、
  Playwright 或線上驗收。local／cloud／hybrid 應用路徑與 outbox 未修改。

當時的平台處理待辦已被核准縮限取代；postgres 的 public CREATE 缺口亦已更正。
現行下一步是批准離線驗證，再分別批准新鮮擷取／備份、等效 owner 演練與精確安裝。

## 歷史交接與舊支援草稿（非目前待辦）

### 歷史平台權限處理：官方文件核對與支援草稿

**以下保留舊雙 creator 方案的交接，不是可直接提交的現況描述。**
草稿內「正式角色無 public CREATE」已被證明錯誤；縮限方案已批准並寫入。
目前不以支援回覆為必要前置；只有另要求修改內部 creator defaults 才需另評估合法途徑。

已核對 [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)：
`supabase_admin` 是內部管理角色；Dashboard SQL Editor 的查詢以 `postgres` 執行，
不是以 `dashboard_user` 或平台 superuser 執行。因此換到 SQL Editor、使用組織 Owner
帳號或重設 postgres 密碼，都不能直接視為已解決目前資料庫角色權限。
[Dashboard 存取控制](https://supabase.com/docs/guides/platform/access-control)
與 PostgreSQL 角色權限是不同層次。

舊方案未取得可自行修改內部 creator defaults 的平台途徑；當時準備了
[Supabase 支援單](https://supabase.com/dashboard/support/new)草稿，尚未送出。
這不是現行縮限方案的必要前置。不可自行賦予內部角色 membership、修改系統 catalog、
重播 baseline，或拿 service_role API key 當成 SQL 管理權限。

#### 可提交的支援單草稿（不含連線資訊或原始資料）

主旨：Hosted PostgreSQL 17 — confirm supported creator default ACL convergence and RPC installation authority

我們準備在 Hosted PostgreSQL 17.11 進行限縮 client 授權與新增私人行程排序 RPC 的增量修補，
尚未在正式環境執行。唯讀盤點及凍結備份的無網路隔離演練顯示：

- 正式連線角色 postgres 非 superuser，沒有 supabase_admin USAGE／SET。
- public schema 中，postgres 與 supabase_admin 各有授予 anon／authenticated 的
  creator-specific defaults；兩個 creator 合計 48 個 privilege cells。
- 修補只移除已盤點的 public client defaults，不更動其他 schema、global defaults、
  非 client 授權或既有平台函式；既有物件授權由另一份 allowlist migration 處理。
- 正式角色另無 public CREATE，無法直接建立新 RPC。
- 等效角色演練如預期被 defaults 權限守門擋下，交易完全回滾。
  合成平台授權的三份增量及精確回復演練成功，但不構成正式執行權限。

請協助確認：

1. supabase_admin 的這些 public defaults 是否屬於平台必要設定，移除是否受支援？
   平台升級或自動化是否會重建？若必須保留，請指出原因與建議的應用隔離方式。
2. 若可移除，是否有官方支援的平台代執行或其他最小權限操作流程？
   不要求將內部角色或 superuser 權限授予應用／postgres。
3. public CREATE 的缺口應透過何種受支援方式處理？請確認 schema owner／grantor
   及新 RPC owner 可否維持既定 postgres，以符合已演練的 recovery guards。
4. 能否在正式變更前確認精確執行角色、執行來源、平台影響與回復途徑？

專案識別由管理者在支援單的專案選擇器提供，不將 URL、密碼、token、auth dump 或業務資料
放入本文。若支援要求 SQL，僅提供經審查的 migration 與去識別 catalog 摘要。

#### 收到回覆後的門檻

- 官方確認可執行：先確認實際 executor／owner／grantor 與已演練假設一致；
  有差異則更新精確回復及隔離演練，再取得新鮮線上對帳／備份與具體安裝批准。
- 官方要求保留平台 defaults：這會改變本計畫的收斂範圍，須由使用者明確批准例外或
  另行評估 schema 隔離；不可自動刪除守門、跳過 creator，或仍宣稱完全收斂。
- 未有平台答覆前：A／B 正式安裝維持阻擋。此次僅查閱公開文件及整理交接，
  未有新線上連線、測試、資料庫權限變更、安裝或部署。

使用者要休息並關閉原對話。本文件必須能獨立交接，
不要依賴原對話 context、session 私有檔案或未版控的備份位置。

### 舊交接提示（已失效，不可直接貼用）

> 請接續「線上資料庫與版本一致」的收斂工作。
> 請先載入專案 development workflow 與 Supabase architecture skills。
> 我允許你查閱 docs/database/database-version-convergence.md、docs/task/progress.md、
> docs/database/database-psql-operations.md、docs/system/trip-collaboration-rollout.md、
> docs/system/testing.md、docs/system/test-plan.md，以及相關程式碼／migration／測試。
> 先完整讀收斂計畫，從 A「權限收斂」與 B「雲端原子排序 API」開始：
> A／B 與建立者專屬 default ACL 增量已寫；最新 4 檔／51 項隔離測試及 tsc -b 通過，
> 但未安裝、未人工驗收；先核對新增檔案，不要重寫既有成果。
> catalog 已完成一次批准的唯讀盤點；精確可執行回復 SQL 仍未完成。
> 下一步先列出新備份／重新對帳、精確回復準備與隔離還原演練範圍，取得批准；
> 此階段已取得一次批准並嘗試：新唯讀對帳完成、精確回復候選已私存但未演練；
> 完整備份／還原被 PG17 工具不足及 supabase_admin 操作權限不足阻擋。
> 先處理下方環境與平台權限門檻，不能宣稱備份成功或用 superuser 演練冒充可安裝。
> 權限 migration 遇未批准 default／繼承來源或平台操作權限不足仍會停止。
> 不要重新設計共享，也不要重播 baseline 或清除 outbox。
> 不預設舊會話授權仍適用；任何新線上存取、Git 檢查、測試／型別檢查、
> build／lint／Playwright 與部署都先列出範圍並取得本輪授權。
> 完成實作後停下來請我授權針對性驗證。
> 沒有精確的備份、隔離還原演練與安裝批准，不得寫線上 DB。
> 報告先講結論，使用繁體中文，區分「已寫、已測、已安裝、已人工驗收」。

### 舊接手清單（只記錄當時狀態）

1. A／B 與 default ACL 增量已寫；最新 **4 檔／51 項隔離測試與型別檢查通過**，
  未安裝、未人工驗收。精確反向 SQL 與備份還原演練尚未完成；C～E 尚未實作。
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

## 歷史盤點與階段進度（最新結論以頂部為準）

### 最新備份／還原進展（優先於下方較早的環境不足紀錄）

- 已在使用者目錄準備 PostgreSQL 17.11 核心工具，官方 PGDG 簽章與套件 SHA-256
  驗證成功，未使用 sudo。無特權 network namespace／關閉 TCP／私人 Unix socket
  的隔離叢集可用；PG17 工具與隔離環境不足的阻擋已解除。
- 已取得 public／sync_private／collaboration_private／auth 四個 schema 的
  PG17 custom archive；438,778 bytes，archive 目錄可讀。
  dump、catalog 與資料指紋共用同一匯出快照；序列目前值不受 MVCC 保證。
  備份私存工作區外，目錄 0700、檔案 0600，未輸出原始資料、未異地複製。
- 隔離還原 **47/47 表內容指紋一致**，含收據；owner、語意 ACL、defaults、欄位、
  FK 定義、索引、觸發器、RLS 與函式比對通過。範圍外 defaults 使用 180 筆合成支架，
  不代表已備份／還原整個 Supabase 平台。
- **完整演練仍未通過**：25 筆角色 membership 的成員及權限選項一致，
  但 grantor 成為隔離 bootstrap 角色，精確角色重現守門因此停止。
  實際 FK 資料逐筆檢查、三份 migration 套件及 recovery 演練尚未執行。
  已依相同快照產生回復候選，但仍是 UNREHEARSED。
- 正式角色仍無 supabase_admin USAGE／SET；這項安裝權限阻擋**未解除**。
  不得用隔離 superuser 成功取代真實安裝角色證據，也不自動提權或略過 defaults。
- 新增 [私人備份工具](../../scripts/convergence-backup.mjs)，更新 capture 工具以共用快照。
  工具 JavaScript 語法檢查通過；未重新執行專案 Vitest／型別檢查。
  隔離 cluster 已停止，沒有正式寫入、安裝或部署。

下一步先修正隔離角色 grantor 重現，再做 FK 資料與修補／回復演練；
另需合法平台操作途徑解決正式權限。可讀 archive 與表指紋相符不是全部驗收。

**最新操作：授權的備份／還原準備已開始，但被環境與平台權限阻擋，未安裝。**

- 新鮮對帳以同一 repeatable-read READ ONLY 交易保存 catalog 與 47 張表資料指紋；
  未輸出業務資料。指紋可供比對，**不能還原資料，不是完整備份**。
- 已確認 authenticated 額外表權限 40 筆、anon user_roles 8 筆、
  相關 client default ACL 48 筆，保留 trips 4 個欄位 ACL；排序 RPC 仍不存在。
- 正式操作角色非 superuser，對 `supabase_admin` 的 USAGE、SET 皆為 false。
  現有合法操作途徑無權完成該建立者的 defaults 修補；不得提權或略過該段。
- 現有 PostgreSQL 客戶端 16.15、正式伺服器 17.11；Docker 為不可用的 WSL 入口，
  無 Podman，因此尚無可用的 PG17 dump／無網路還原環境。
- 已新增 [唯讀證據工具](../../scripts/convergence-capture.mjs)及
  [擷取 SQL](../../scripts/convergence-capture.sql)，保存 ACL／grantor／owner／函式定義，
  產生有前後狀態 guard 的精確回復候選；**候選未執行、未演練**，不是已驗證 rollback。
  私人檔案位於工作區外，目錄 0700、檔案 0600；未異地備份，不保證環境清除後仍存在。
- 下一步需可用 PG17 備份／隔離還原環境，及合法具平台建立者操作權限的途徑。
  條件具備後重新對帳、取得新鮮完整備份並演練，再另取精確線上安裝批准。
  本輪未寫正式資料庫、未部署；舊測試通過不消除上述阻擋。

**A／B 與 default ACL 增量已寫，最新隔離驗證通過；未安裝，線上差異仍未收斂。**

本輪獲批執行 4 檔／51 項 Vitest 與 `tsc -b`，均通過；沒有 Git 檢查、
build／lint／Playwright、新線上連線、備份、演練或部署。
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

### 本輪批准驗證與新盤點結果 — 2026-10-20

- 經批准執行 `tsc -b`，exit 0；不是 Vite build 或部署驗證。
- 前一步批准的 Vitest 為 48 檔／393 項通過；不代表線上 PostgreSQL 驗收。
- 本輪執行 catalog-only inventory，使用 repeatable-read READ ONLY 交易成功提交。
  不讀業務／auth 帳號內容，未安裝 SQL、備份或演練。完整原始 ACL 存於工作區外
  權限受限的私人暫存目錄；不是版控交接依據，也不是安裝前可永久沿用的備份。
- client `anon`／`authenticated` 無額外角色 membership，非 superuser、無 BYPASSRLS；
  受檢 11 函式的額外 EXECUTE 均是 `postgres` 直接授權。
- **新增確認 PostgreSQL 17 `MAINTAIN` 漂移**：10 表 authenticated 皆有此額外權限，
  `user_roles` anon 也有；現有 migration 未撤 MAINTAIN，因此仍不能直接安裝。
  其來源是原始 ACL，不是僅靠舊版七種權限的 effective-check 推論。
- 4 個欄位 ACL 均為 trips 的 authenticated UPDATE：region_id、name、start_date、end_date，
  無 grant option；與保留表 UPDATE 相容，不應順手撤除。
- public schema 對 anon／authenticated／service_role 均有 USAGE、無 CREATE，維持不變。
- 相關 default ACL 共 12 組：建立者為 `postgres` 與 `supabase_admin`，
  都限定 public schema，各對 anon／authenticated 授權三類新物件：
  tables 的全部 8 種權限（含 MAINTAIN）、sequences 的 USAGE／SELECT／UPDATE、
  functions 的 EXECUTE；grantor 各為該建立者，無 grant option。
  本次相關範圍未見全域 default ACL；其他 schema 不納入修補。

**下一個決策門檻（未批准寫線上）**：
建議對已確認的 10 表撤除指定 client MAINTAIN；對上述兩建立者的 public-schema
新物件撤除 anon／authenticated 自動授權，改由各 migration 明確 GRANT，
保留 owner／postgres／service_role 等其他 grantee 的預設權限。
`supabase_admin` 是平台建立者，需先評估其預設權限與操作權限，不能因查到就擅改。
此外 functions 的內建全域 PUBLIC EXECUTE 並不因撤 schema-local client defaults 消失；
需分開決定是否接受既有「每個 RPC 明確 REVOKE PUBLIC」的契約，
不得默默擴大成跨 schema 的全域 default ACL 修改。
決策確認後才準備精確修補、安裝前 guard 與反向 SQL，再批准新針對性測試；
備份、隔離還原演練與精確線上安裝仍另行批准。

### A. 優先：權限收斂

**歷史驗證 — 2026-10-20 09:44（環境時間；不涵蓋目前縮限版）**

經本輪批准，default／privilege／reorder／auto-sync 四檔 Vitest 共 **51 項全數通過**，
接著 `npx --no-install tsc -b` exit 0。測試覆寫 Supabase 位址為不可連線本機端點，
使用 synthetic key 與 PGlite，不讀寫線上。此結果涵蓋最新 default ACL 與 MAINTAIN 修補，
優先於下方較早的「未測」紀錄；不是 production build、實際平台角色權限或
PostgreSQL 多連線驗證。仍未備份／還原演練／安裝，精確可執行反向 SQL 尚缺。

**舊版原始碼狀態（已由頂部核准縮限取代）**

使用者已批准工作區修補方向，新增
[public default ACL 增量](../../supabase/migrations/20261020005000_public_default_privilege_convergence.sql)，
排序在物件撤權 migration 之前。僅撤 `postgres`／`supabase_admin` 在 public 的
已盤點 anon／authenticated 表、序列、函式 defaults，不改全域與其他 schema，
不改 owner／service_role 等其他 grantee。空白／稀疏基線可接受；
未知來源、PUBLIC、grant option、非自身 grantor 或操作權限不足會停止並回滾。
不建立角色、不提權、不默默略過平台建立者。

[物件撤權增量](../../supabase/migrations/20261020010000_privilege_convergence.sql)
已補 PG17+ 的 MAINTAIN 撤權及 effective check，保留舊版引擎相容分支；
亦拒絕 client 自身或可到達角色的 superuser／BYPASSRLS 能力。
兩個 migration 都使用交易、共用鎖與明確 timeout。

新增 [default ACL 隔離測試程式](../../src/database/default-privileges-cloud.test.ts)，
並擴充 [權限回歸](../../src/database/privilege-convergence-cloud.test.ts)：
雙建立者、稀疏 defaults、非 client／跨 schema 保留、新物件授權、冪等性、
合法 USAGE／SET 權限、拒絕未知漂移及回滾、MAINTAIN、角色屬性守門。
內建全域 PUBLIC function EXECUTE 不因修補消失；測試明確保留此語意，
正式 RPC 仍須各自 REVOKE PUBLIC，不宣稱未來函式會自動拒絕匿名。

[default ACL 回復檔](../../supabase/rollback/20261020005000_public_default_privilege_convergence.sql)
與物件回復檔都是**阻擋式範本**，不是已完成的精確可執行反向 migration。
新鮮安裝前 ACL、逐 grantor 的精確回復、隔離演練與批准仍不可略過。

**最新修改已經上述 4 檔／51 項與型別檢查驗證；未做任何本輪線上操作。**
前一版 48 檔／393 項是不同批次，不能與本批相加為不重複覆蓋總數。
PostgreSQL 16／17 多連線、實際平台角色權限與還原演練尚未驗證。

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
| 地圖縮放 | 線上 `regions.zoom` 是 numeric，基準是 integer；前端讀取會轉 number，變更型別前需檢查資料 |
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
| 1 | 權限與排序 API 修正、針對性測試 | 原估 1～2 小時 | 增量已寫；最新 4 檔／51 項與型別檢查通過；精確可執行反向 SQL 未完成 |
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
