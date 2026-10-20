# 目前進度與文件入口

更新日期：2026-10-20。以下區分程式實作、隔離驗證、線上結構與使用者驗收，
不代表目前工作區已提交或已部署至網站。

## 最新：核准縮限收斂已實作，NEW VERSION WRITTEN／NOT TESTED／NOT INSTALLED

本節優先於下方所有舊「等待縮限批准／必須先平台支援／postgres 缺 CREATE／合成演練」描述。
已批准並實作只清 postgres public defaults、既有 10 表／11 函式指定 ACL 與 reorder RPC；
supabase_admin 精確完整 defaults 保留（PG17 24 cells；無平台 rows 的 standalone 亦可），
部分矩陣、未知 source／grantee／權限／grant option／global／PUBLIC／繼承來源拒絕。
平台 raw／semantic defaults 不變，不需要平台 USAGE／SET，不改 memberships。
未來平台建立物件仍需逐物件 ACL 審查；內建 PUBLIC EXECUTE 仍由各 RPC 顯式撤除。

擷取／復原 v2 新增完整 migration／rollback／tooling 雜湊清單與 DATABASE owner、
資料庫原始／語意 ACL、連線屬性、database／pg_database_owner／public 有效權限守門。
正式 postgres 確為資料庫 owner 並有 public CREATE；舊隔離環境漏還原 DATABASE owner，
所以 CREATE 缺口及「完整等效」結論不適用。新流程先恢復 database owner，再比較；
只讓等效 postgres 執行全部 migration 與精確 recovery，不再使用合成 superuser 遷移或臨時 CREATE。
Recovery 僅恢復變更過的 postgres defaults／原物件 ACL，精確守住平台 defaults、
reorder source／owner／ACL、版本與 schema／column ACL；reorder 重裝拒絕未知 grants。
舊私人備份／凍結 recovery 未觸碰，不重產；缺新 metadata 的舊 capture 必須拒絕。

**本輪沒有任何測試／檢查（含 node --check／型別）、Git／build／lint／Playwright、
連線／線上讀寫／安裝／新備份或隔離演練。舊 51 tests 與合成演練不是本版驗證。**
local／cloud／hybrid 應用與自動同步路徑未變；已撰寫精確平台保留、部分矩陣拒絕、
無平台授權、舊 metadata 拒絕與 postgres-only recovery 案例，及 reorder／auto-sync 回歸情境。
下一步：先批准聚焦離線測試及必要語法／型別檢查；新鮮擷取／備份、修正 owner 後隔離演練、
線上安裝各另取批准。詳見[最新範圍與風險](../database/database-version-convergence.md)。

| 項目 | 已完成 | 未完成／限制 |
| --- | --- | --- |
| 共享行程刪除 | 增量 SQL 已備份、演練與安裝；4 檔 49 tests 通過；使用者先前回報手動流程成功 | 最新提供的 E2E 有失敗及收尾錯誤，不能視為持續通過或保證無測試殘留 |
| 共享衝突與私人同步 | 已隔離有衝突的共享行程，保留草稿；7 檔 96 tests 通過 | 不代表真實跨裝置 UI 通過 |
| 取消、撤權與重試 | 有界同請求取消確認、撤權更新順序與帳號檢查已補強；7 檔 90 tests、型別檢查通過 | 本輪未跑 build／lint／E2E，也未做線上業務操作 |
| 線上資料庫與版本一致 | 核准縮限已實作：保留平台 defaults、收斂 postgres defaults／既有 ACL／reorder；擷取及 recovery 補資料庫 owner 與有效權限 | 最新原始碼未測／未演練／未安裝；需新批准；舊合成結果不適用；C～E 與部署版本未確認 |

## 接續工作

1. 先批准四份 default／privilege／reorder／auto-sync 聚焦回歸、新 capture fixture 與語法／型別檢查。
2. 通過後另取新鮮唯讀 capture／一致快照備份批准；舊快照缺 v2 metadata，不補值或重產冒充。
3. 另准無網路隔離演練：先重現 database owner／ACL，三份 migration 與凍結 recovery
   全由等效 NOSUPERUSER postgres 執行，不加平台 membership 或臨時 CREATE。
4. 演練與完整守門通過後才另取精確線上安裝批准；不重播 baseline、不變動 outbox。

### 以下為歷史接續紀錄，不是目前必要前置

**最新更正（優先於下方歷史阻擋）**：正式 psql 唯讀重查確認 postgres 是資料庫 owner，
經 pg_database_owner **確有 public CREATE**；10 張目標表／11 個函式亦全由 postgres 擁有。
舊隔離環境漏重現 database owner，導致 CREATE 權限誤判；需補工具與重演練，不能沿用
舊「正式等效權限完全重現」結論。真正不可改的是 supabase_admin creator defaults。
可選「保留精確盤點的平台 defaults，只收斂 postgres defaults／應用 ACL／新增 RPC」，
但屬範圍變更，待使用者批准後才改 migration／guards。支援單不是此候選方案的必要前置。
本輪兩次唯讀 catalog 查詢，沒有線上寫入、權限變更、安裝或測試。

**平台途徑已核對**：官方說明 SQL Editor 仍以 postgres 執行，切換 Dashboard 不會
自動取得 supabase_admin 權限。已在[收斂計畫的支援交接](../database/database-version-convergence.md#平台權限處理2026-10-20-官方文件核對與支援交接)
整理可提交的支援單草稿與回覆後門檻。下一步需專案管理者向 Supabase 確認內部 creator
defaults 是否可變更、受支援的代執行方式及 public CREATE／RPC owner；尚未送單。
本次沒有新線上連線、安裝或權限變更；不得將切換介面或組織 Owner 視為已解除 DB 限制。

**最新權威結果（優先於下方保留的歷史紀錄）**：重用原凍結 archive，雜湊守門通過，
無新線上連線。47/47 表指紋、25 筆完整 membership（含 grantor／全部選項）、角色屬性及
連線限制一致；71 個 FK（11 個多欄）實際資料零違規。正式等效角色第一份 migration
如預期權限失敗，交易完整回滾且後兩份未安裝。另行標示的**假設平台授權**階段三份
migration 成功，凍結 guarded recovery 原樣執行成功；復原後 ACL／defaults／函式／角色
及 47 表（含兩張收據表）指紋一致。合成階段暫時 public CREATE 已撤回，schema ACL
無殘留；未改正式角色或 migration。180 筆範圍外 defaults 是支架，非整平台備份。
最新私人證據為 rehearsal-Pxui49 子目錄的 status 與 recovery attestation；叢集已停止。
本輪只跑 Node 語法檢查與核准隔離演練，未跑 Git／Vitest／型別／build／lint／Playwright。
**安裝權限仍未解決**；下一步需合法平台途徑與另取新鮮線上對帳／備份／精確安裝批准，
不能將本次合成平台成功視為正式 operator 已具權限或正式 recovery 執行批准。

**最新進展（覆蓋下方舊阻擋紀錄）**：PG17.11 工具與無外部網路隔離環境已可用；
已完成共用快照的四 schema 私人 dump，隔離還原 47/47 表指紋及主要結構／ACL 相符。
但 25 筆 membership grantor 未精確重現，守門停止；FK 實際資料檢查及 migration／recovery
演練未執行。先修正隔離角色支架；正式角色無 supabase_admin USAGE／SET 仍是安裝阻擋。
回復候選仍未演練，沒有線上寫入、安裝或部署。

**最新阻擋**：已批准並完成新唯讀 catalog／47 表指紋擷取及精確回復候選準備，
但**未完成可還原備份或還原演練**。正式角色無 `supabase_admin` USAGE／SET；
本機僅 PG16 客戶端，無可用 PG17 容器環境。正式資料庫零寫入、未安裝。
先取得合法平台操作途徑與 PG17 備份／隔離環境，再重新備份及演練；
指紋不是備份，未演練回復候選不能視為已驗證 rollback。

1. 最新 default／privilege／reorder／auto-sync 四檔 51 項及型別檢查已通過；下一步列出重新對帳／新備份、精確回復與隔離還原演練範圍，取得批准後執行。
2. default ACL 修補只接受 postgres／supabase_admin 在 public 的已盤點 client 授權；權限不足或新漂移會停止。精確可執行反向 SQL 尚需新安裝前快照及批准，不把阻擋式範本當作完成回復演練。
3. 線上修改仍需新備份、隔離還原演練與精確安裝授權；本輪僅執行已批准隔離測試與型別檢查，沒有新線上存取、Git 檢查或部署。
4. 另行釐清最新 E2E「B 找不到本輪共享行程」與瀏覽器已關閉的收尾錯誤，
   確認該輪結果與殘留資料，不自動重跑或刪除。

## 文件索引

- [資料庫差異、工作清單、估時與驗收](../database/database-version-convergence.md)
- [協作現況、模式邊界與歷史安裝](../system/trip-collaboration-rollout.md)
- [架構與三種資料路徑](../system/architecture-notes.md)、[架構圖](../system/architecture-current.mmd)
- [測試方式、已跑結果與 E2E 限制](../system/testing.md)、[後續測試計畫](../system/test-plan.md)
- [資料庫連線、備份與增量安裝規範](../database/database-psql-operations.md)
- [私人資料與協作權限邊界](../system/owner-isolation.md)
- [目前待辦](../task/todo)、[產品議題](../task/issue.md)

`inital.md`、`record` 是原始需求；`20261018` 是舊工作準則紀錄。
歷史 SQL 的用途與禁用情況見[操作規範](../database/database-psql-operations.md)，
不要把舊 SQL 當成目前線上重建腳本。
