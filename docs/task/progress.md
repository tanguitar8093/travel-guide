# 目前進度與文件入口

更新日期：2026-10-20。以下區分程式實作、隔離驗證、線上結構與使用者驗收，
不代表目前工作區已提交或已部署至網站。

| 項目 | 已完成 | 未完成／限制 |
| --- | --- | --- |
| 共享行程刪除 | 增量 SQL 已備份、演練與安裝；4 檔 49 tests 通過；使用者先前回報手動流程成功 | 最新提供的 E2E 有失敗及收尾錯誤，不能視為持續通過或保證無測試殘留 |
| 共享衝突與私人同步 | 已隔離有衝突的共享行程，保留草稿；7 檔 96 tests 通過 | 不代表真實跨裝置 UI 通過 |
| 取消、撤權與重試 | 有界同請求取消確認、撤權更新順序與帳號檢查已補強；7 檔 90 tests、型別檢查通過 | 本輪未跑 build／lint／E2E，也未做線上業務操作 |
| 線上資料庫與版本一致 | 前次唯讀盤點完成；本輪 A／B 增量 SQL、catalog 盤點與隔離測試程式已寫 | 未測、未安裝、未人工驗收；default ACL 精確修補／反向權限尚待新盤點；C～E 與部署版本仍未確認 |

## 接續工作

1. 依[線上資料庫收斂計畫](../database/database-version-convergence.md)覆核已寫的 A／B 增量與回歸程式；取得批准後先跑針對性隔離測試及型別檢查。
2. 另取 catalog 唯讀批准，查明 default ACL 建立者／grantor／全域與 schema 來源，才準備精確修補與反向權限。現有 migration 會阻擋未批准 defaults，不代表已修復。
3. 線上修改仍需新備份、隔離還原演練與精確安裝授權；本輪沒有執行測試、Git 檢查、線上存取或部署。
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
