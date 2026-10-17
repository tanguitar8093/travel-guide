# 第三階段：混合模式本地操作 Review

狀態：第三階段已實作，待使用者 review；未授權第四階段。

## 這次改了什麼

- 開發環境的「資料」頁新增「混合測試（僅本地，未上傳）」選項。
- 接上實際登入帳號：member／admin 的本地資料依專案與帳號分開保存，basic 不能使用。
- 原有區域、地點、標籤及行程畫面沿用，混合模式的資料操作改寫本地並記錄待同步任務。
- 每個工作區畫面上方顯示「尚未上傳」、待同步操作數及最近一次本地儲存時間。
- 切換模式重新載入畫面；登出／切換帳號立即隔離本地入口，原帳號資料與佇列保留。
- 混合模式保留匯出；隱藏並阻擋覆蓋、清空與雲端搬移，避免測試操作影響正式資料。
- 現有預設仍是 Supabase；正式 production build 不開放混合模式。

沒有雲端初始化、資料搬移、上傳、下載或背景同步。第一次進混合模式看到空白是預期結果，不表示雲端資料不見。原單機 `travel-planner` 和雲端資料保持獨立。

## 五分鐘畫面 Review

1. 執行 `npm run dev`，以 member 或 admin 登入。
2. 到「資料」頁，選擇「混合測試（僅本地，未上傳）」。應看到黃色提示與待同步數量。
3. 到「區域」新增一筆測試資料，再修改名稱。列表應立即反映操作，待同步數增加，顯示最近儲存毫秒數。
4. 到「標籤」建立標籤；到「地點」新增地點，選取剛建立的區域／標籤；再建立行程與項目。既有必填、參照與刪除限制仍應生效。
5. 重新整理頁面：混合模式偏好、本地測試資料與待同步清單應保留。重新登入需要網路確認權限。
6. 登出，換另一帳號登入：混合資料應是另一份，不應看到第一個帳號的測試資料。回原帳號後資料仍在。
7. 切回 Supabase：應看到原雲端資料，混合模式新增的測試資料不會出現在雲端。
8. 在混合模式「資料」頁確認可以匯出備份，沒有覆蓋／搬移／清空按鈕。

待同步數量是操作群組數，不是資料筆數；刪除一個行程及其項目可記為一個操作。黃色提示的毫秒數只量測本地交易與佇列保存，不包含表單處理、畫面繪製或 Google API。

## 驗證與限制

針對性測試涵蓋五種實體、資料 facade 本地 CRUD 不發送網路請求、帳號切換與佇列保留、basic 拒絕、production 停用、待同步通知、覆蓋保護及舊模式偏好。

```bash
npm run test:run -- src/database/hybrid.backend.test.ts src/database/local-sync.store.test.ts src/database/runtime.test.ts src/database/database-mode-preference.test.ts src/database/index.test.ts src/modules/data-management/data-management.service.test.ts src/auth/AuthGate.test.tsx
npm run build
npm run lint
```

登入及角色驗證仍需 Supabase；「本地 CRUD 不發送請求」不表示登入、Google Maps／Places／Routes 或其他外部功能不需要網路。admin 混合測試只保存自己本地建立的資料；管理其他人資料使用原雲端模式。

本次不套用 SQL、不搬移真實資料、不執行全套測試。實際登入瀏覽器、跨分頁與實際雲端需由上述 review 確認，不以本地測試結果替代。

本次驗證結果：7 個相關測試檔共 40 項通過；production build 通過；lint 無錯誤，保留既有 `ItineraryModule.tsx:404` warning；build 保留主 bundle 大小提示；兩份架構 skill 格式與 diff 空白檢查通過。

## 修改位置與回退

新增 `hybrid.runtime.ts`、`hybrid.backend.ts`、`useHybridStatus.ts`、`HybridStatus.tsx` 和相關測試。修改 database facade／mode preference／runtime、LocalSyncStore 讀取交易、AuthProvider、App 模式切換、WorkspaceLayout、資料管理 UI／service 及架構文件。

回退：在資料頁切回 Supabase 或單機；原混合資料及佇列保留。正式 build 自動排除混合模式選項。第三階段通過後仍要明確授權第四階段，才會開始雲端同步 API／migration。
