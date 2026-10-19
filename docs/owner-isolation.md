# 私人資料隔離與協作權限邊界

更新日期：2026-10-20。第一階段「不開放分享」已是歷史範圍，
目前已另外實作並安裝 trip-scoped 協作；私人資料表沒有因此改成全體可讀。

## 現行契約

- member 的私人業務資料限自己的 owner；admin 保留跨 owner 管理能力。
  basic／未登入不取得業務存取權，AuthGate 只讓 member/admin 進工作區。
- region／place／label／trip 的 owner、派生子資料 owner、同 owner 複合外鍵仍有效。
  admin 也不能任意建立跨 owner 關聯，更新不可轉移 owner。
- 跨帳號協作由受控 RPC、trip membership 與獨立 shared workspace 提供，
  不是單靠 `editor_uids` 或放寬私人表 RLS。
- viewer 唯讀；editor 可編輯已啟用共享的安排；成員不能管理作者私人收藏。
  作者私人筆記／標籤不在共享投影中，行程項目 note 是共享內容。
- 協作啟用時複製排入內容到一份共用 workspace，之後大家修改同一份共享資料。
  原私人項目保留但不是另一份可自由編輯的協作來源。
- 取消共享將**最新共享內容**轉回作者私人行程；撤銷所有成員／邀請。
  不還原啟用前內容，不移除其他私人收藏。
- 撤權在 server 阻擋新請求／收據重播；客戶端取得 revocation 後清除可讀快取，
  尚未同步草稿留在 outbox 供匯出或丟棄，不能強制抹除別人已看過的資料。

完整契約與安裝紀錄見[協作紀錄](trip-collaboration-rollout.md)。

## local／cloud／hybrid

- standalone local 是不分使用者的獨立 IndexedDB，不是 RLS 或加密隔離，不隱式上傳。
- cloud 由 Supabase grants/RLS/RPC 強制權限。
- hybrid 使用 project/user 分庫、帳號 guard、持久 outbox 與自動同步；
  這是應用程式快取隔離，不取代 server 授權。
- 非管理員使用 hybrid/auto；管理員可切資料來源／同步模式。
  Auth／角色確認與冷啟動離線登入限制仍存在。
- 個人衝突使用整批 review；已確認共享衝突隔離該行程，保留其他個人與健康共享同步。

## 備份與覆蓋現況

第一階段曾暫停 cloud replace/clear/local-to-cloud；第二階段已恢復
目前帳號範圍的 preview → token → apply 交易路徑。
有共享／協作資料的帳號仍受覆蓋／清空守門，不可把 trip 改 private 來繞過。
hybrid 的整批覆蓋／清空限制未解除，不能當作一般增量同步。
私人 JSON 備份不包含完整共享 workspace／邀請／授權／收據，
也不是完整 Supabase 還原備份。

## 2026-10-20 已知落差

13 項 RLS policies 與工作區一致，但部分 live grants/default privileges 較寬，
包含 `user_roles` 及備份等函式；不能將「RLS 一致」描述為所有權限已完全收斂。
目前只完成唯讀 catalog 比對，沒有新授權修正或完整權限行為稽核。
見[收斂計畫 A](database-version-convergence.md#a-優先權限收斂)。

## 歷史 SQL 的使用限制

`supabase-schema-from-indexeddb.sql`、`supabase-basic-role-rls.sql`、
`supabase-owner-isolation.sql` 是歷史 bootstrap／第一階段來源，
不是目前 live DB 的安裝順序。
既有 schema、sync、distance、maps、collaboration 與取消修改不能被舊檔覆寫。
新環境／既有環境均應先對照 [migrations](../supabase/migrations/)及 live catalog，
只在核准、備份與隔離演練後執行所需增量。

舊資料歸屬修復需要明確的目標帳號與 `app.legacy_owner_email` 設定，
不能在文件硬編個人帳號或不經審查批次改 owner。
相關流程見[資料庫操作規範](database-psql-operations.md)。

## 驗證證據邊界

[owner-isolation 測試](../src/database/owner-isolation.test.ts)使用 PGlite
驗證角色、私人 owner、跨帳號拒絕與關聯；
[共享整合測試](../src/database/shared-trip.integration.test.ts)補 shared scope、
revocation、cancel 與同步。測試存在／通過不取代 live 部署和真實帳號驗收。
目前具體結果與 E2E 未完成項見[測試紀錄](testing.md)。
