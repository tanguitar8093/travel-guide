# 第二階段：本地同步基礎 Review

狀態：本地基礎已實作，等待使用者 review；不自動進入第三階段。

## 完成內容

給不寫程式的使用者：這次完成的是「混用資料庫的基礎準備」。

- 每個帳號有自己的本地資料空間：避免切換帳號後混到別人的資料。
- 新增待同步清單：記住新增、修改與刪除，留待之後同步到雲端。
- 資料與清單一起保存：其中一個失敗就全部取消，避免漏記待同步資料。
- 連帶修改也會記錄：例如刪除行程時，其行程項目也一起列入。
- 重新開啟後清單仍保留：切換帳號不會清掉原帳號的待同步內容。
- 原有本機操作、雲端操作與 Supabase 權限保留。

目前還沒有正式畫面上的混合模式／同步按鈕、上傳／下載／自動同步，也尚未接上實際登入帳號。原單機 IndexedDB 沒有使用者資料權限；新混合資料庫是按帳號分開保存，真正的雲端授權仍由 Supabase RLS 執行。

保留既有單機及直接 Supabase 行為。新增的本地同步基礎尚未接入正式資料庫入口、AuthProvider 或畫面，沒有雲端同步請求，也沒有變更實際資料庫。

| 檔案 | 變更 |
| --- | --- |
| `src/database/database.ts` | 資料庫名稱可注入，原預設 `travel-planner` 與 version 4 保留 |
| `src/database/repositories.ts`、`label.repository.ts` | 注入資料庫實例，既有單例仍使用原資料庫，沿用原業務驗證 |
| `src/database/sync-account-context.ts` | 專案＋帳號命名、帳號啟用／停用與世代檢查 |
| `src/database/sync.database.ts` | 獨立 hybrid 資料庫；version 5 包含 outbox、metadata、baseline 表 |
| `src/database/sync.types.ts` | 同步任務、變更、基準版本與本地狀態型別 |
| `src/database/local-sync.store.ts` | 本地交易、連帶變更追蹤、任務排序及狀態讀取 |
| `src/database/local-sync.store.test.ts` | 真正 Dexie 操作的本地整合測試 |
| `package.json`、`package-lock.json` | 新增固定版本 `fake-indexeddb` 開發測試依賴 |
| `docs/local-first-sync-design.md` | 記錄第二階段授權與交付位置 |

## 本地操作流程

1. 建立 `SyncAccountContext`，啟用已確認的專案＋帳號。
2. 建立該帳號的 `SyncDatabase` 與一個 `LocalSyncStore`。
3. 呼叫 `prepareLocal()`，保存 device ID；此步驟不代表已從雲端初始化。
4. 透過 `store.mutate(operation, repositories => ...)` 操作注入的 repositories。
5. 一個外層 Dexie transaction 同時保存所有業務變更與一筆 outbox 任務。
6. `listTasks()` 查看順序與內容，`getSummary()` 查看待處理數量。

新增任務保存穩定 UUID、操作 ID、帳號、device ID、版本、順序、重試狀態，以及每筆資料第一次修改前與最終修改後的內容。地點關聯包含在 Place 記錄中；行程刪除、排序與估時清除的連帶變更也一起記錄。

新資料的 `baseVersion: null` 表示新建；既有資料但尚未取得基準時是 `undefined`，不誤判為雲端不存在。後續修改會記錄同資料的前一個待同步操作 ID，實際上傳版本銜接屬於後續同步引擎。

資料變更 hook 只收集受影響的記錄，不掃描所有業務資料。第一版每次建立任務會讀取目前佇列尋找前序任務，長佇列效能可在第三階段量測後調整。

## Review 與驗證

### 三分鐘眼見為憑

第二階段還沒有產品操作畫面，因此原畫面看不出差異。以下在瀏覽器實際 IndexedDB 建立兩個「review 測試帳號」，不讀取你的正式資料，也不連雲端。

1. 在專案終端執行 `npm run dev`，開啟終端顯示的本機網址。
2. 按 F12 開啟開發者工具，切到 Console（主控台），貼上以下整段並執行。若瀏覽器阻擋貼上，先依其提示確認貼上。
3. 主控台會顯示結果表，所有項目應為「通過」。
4. 切到 Application → IndexedDB，按重新整理資料庫清單，找到名稱含 `phase2-review` 的 A／B 資料庫。A 的 `regions`、`outbox` 應各有一筆，B 應為空。
5. 重新整理網頁，再查看 A 的兩張表，資料應仍保留。這才是真實瀏覽器刷新驗證。

```javascript
await (async () => {
  const { SyncDatabase } = await import('/src/database/sync.database.ts')
  const { SyncAccountContext } = await import('/src/database/sync-account-context.ts')
  const { LocalSyncStore } = await import('/src/database/local-sync.store.ts')
  const accountA = { projectId: 'phase2-review', userId: 'review-a' }
  const accountB = { projectId: 'phase2-review', userId: 'review-b' }
  const context = new SyncAccountContext()
  const databaseA = new SyncDatabase(accountA)
  const databaseB = new SyncDatabase(accountB)
  context.activate(accountA)
  const storeA = new LocalSyncStore(databaseA, context)
  await storeA.prepareLocal()
  const previous = await storeA.listTasks()
  if (!previous.length) {
    await storeA.mutate('review.create', repositories => repositories.regions.create({
      name: 'Review 測試區域', zoom: 12, googlePlaceId: 'review-only'
    }))
  }
  const countBefore = await databaseA.regions.count()
  const taskCountBefore = (await storeA.listTasks()).length
  const originalAdd = databaseA.outbox.add
  let rollbackRejected = false
  databaseA.outbox.add = async () => { throw new Error('Review：模擬清單保存失敗') }
  try {
    await storeA.mutate('review.rollback', repositories => repositories.regions.create({
      name: '這筆應被取消', zoom: 12, googlePlaceId: 'review-failure'
    }))
  } catch {
    rollbackRejected = true
  } finally {
    databaseA.outbox.add = originalAdd
  }
  context.activate(accountB)
  const storeB = new LocalSyncStore(databaseB, context)
  await storeB.prepareLocal()
  let oldAccountBlocked = false
  try { await storeA.listTasks() } catch { oldAccountBlocked = true }
  const isolated = await databaseB.regions.count() === 0 && (await storeB.listTasks()).length === 0
  context.activate(accountA)
  const retained = (await storeA.listTasks()).length === taskCountBefore
  const rollback = rollbackRejected && await databaseA.regions.count() === countBefore && retained
  databaseA.close()
  const reopened = new SyncDatabase(accountA)
  const reopenedStore = new LocalSyncStore(reopened, context)
  const persisted = await reopened.regions.count() === countBefore &&
    (await reopenedStore.listTasks()).length === taskCountBefore
  console.table([
    { 項目: '資料與待同步清單已保存', 結果: countBefore > 0 && taskCountBefore > 0 ? '通過' : '失敗' },
    { 項目: '清單保存失敗時，資料也取消', 結果: rollback ? '通過' : '失敗' },
    { 項目: 'B 看不到 A 的資料與清單', 結果: isolated ? '通過' : '失敗' },
    { 項目: '切換帳號後阻擋 A 的舊操作', 結果: oldAccountBlocked ? '通過' : '失敗' },
    { 項目: '回到 A，待同步清單仍保留', 結果: retained ? '通過' : '失敗' },
    { 項目: '重新開啟資料庫後仍保留', 結果: persisted ? '通過' : '失敗' }
  ])
  console.log('測試資料庫：', reopened.name, databaseB.name)
  reopened.close()
  databaseB.close()
})()
```

可重跑同一段，不會重複新增成功案例。測試完成後可在 Application 中只刪除名稱含 `phase2-review` 的兩個測試資料庫。這個檢查證明應用程式的帳號資料隔離，不代表 IndexedDB 具備 RLS 或真實登入已接線。

### 自動化檢查

執行：

```bash
npm run test:run -- src/database/local-sync.store.test.ts src/database/index.test.ts src/database/backup.repository.test.ts
npm run build
npm run lint
git diff --check
```

第一個指令可重跑以下 review 情境，不需要登入或雲端密鑰：

| 情境 | 預期結果 |
| --- | --- |
| 新增後再修改 | 業務資料更新，佇列新增兩筆有序任務，第二筆指向第一筆 |
| outbox 寫入失敗 | 業務資料與任務一起回滾 |
| 參照不存在／標籤循環 | 整個操作回滾，沒有半套資料或任務 |
| 關閉並重新建立 Dexie 實例 | 資料、device ID、佇列及順序保留 |
| 切換帳號／登出 | 原 context 操作被拒絕，執行中的寫入回滾；回原帳號仍可讀任務 |
| 不同帳號／專案 | 使用不同資料庫，查不到彼此的記錄 |
| 直接繞過 mutate 寫入 | 已安裝追蹤的同步資料庫拒絕該寫入 |
| 地點更換 Google place ID | 地點與所有受影響估時清除列在同一任務 |
| 刪除行程 | 行程與其所有項目刪除列在同一任務 |
| 一天排序／刪除項目 | 排序及連帶估時清除可追蹤 |
| 同筆資料多次修改／並行操作 | 保留原始 before 與最終 after，並行操作不遺失任務 |
| 空佇列／失敗／衝突 | 不假裝已同步，明確回傳對應狀態 |
| 舊單機 repository | 注入後仍可獨立操作，原公開資料入口與備份驗證保持可用 |

`fake-indexeddb` 模擬 IndexedDB API，使用實際 Dexie 交易邏輯。重新開啟測試是同一測試程序內重建資料庫實例，不等於已完成真實瀏覽器刷新、磁碟持久性或跨分頁驗證。

驗證結果：上述 focused tests 共 22 項通過（其中新增本地基礎 19 項）；build 通過；lint 無錯誤，但保留既有 `ItineraryModule.tsx:404` warning；diff 空白檢查通過。Build 仍提示既有主 bundle 超過 500 kB，這次未改拆包。

## 限制與回退

- 目前沒有正式 UI 可 review；第三階段才加入開發測試入口與混合模式。
- 沒有雲端 snapshot、pull、push、初始化授權、同步成功確認、衝突解決及背景 worker。
- 帳號 context 是資料層防誤用機制，不代替 Supabase Auth／RLS；正式登入、basic 權限與登出接線屬第三階段。
- 一個 `SyncDatabase` 實例建立一個 `LocalSyncStore`。原始資料庫物件屬內部資料層，不能交給 UI 繞過 context 讀取。
- 尚未雲端初始化的本地寫入只供第二／三階段隔離測試，不能正式上傳。
- 未提供刪除或確認 outbox 的 API，未同步資料不會因切換帳號被清空。
- 回退只需停止使用新增入口或撤回本階段程式；不必刪除原單機資料或套用任何雲端 SQL。保留 hybrid 資料庫供之後恢復。
- 全套測試、真實瀏覽器、跨分頁與實際雲端未執行。

## 下一階段範圍

取得使用者批准後，第三階段才新增 hybrid adapter、資料庫模式、必要 Auth 接線及開發測試畫面。仍不建立雲端同步 API，不改既有預設模式。
