# 公開行程 UI 設計稿

- 本版核准與保存日期：2026-10-21（Asia/Taipei）。使用者確認「這 ui 可以，先把這版更新至設計稿」。
- 初版核准日期：2026-10-20；本版取代先前更新／下架待確認的保存稿。
- 設計稿：[public-itinerary-sharing-workflow.html](./public-itinerary-sharing-workflow.html)。
- 實作來源：[POC UI](../public-itinerary-sharing/ui.ts)、專案現有模組 CSS 與 [POC 專用樣式](../public-itinerary-sharing/ui.css)。
- 依據：[POC 流程準則](../../.agents/skills/poc.md)、[開發計畫](../../docs/develop/public-itinerary-sharing-plan.md)。

設計稿將本次核准版本的樣式、程式及京都三日／台北兩日範例內嵌於同一 HTML，可直接以瀏覽器開啟，無須啟動 Vite、登入或下載外部資源。使用與實作版相同的核心操作，保存時凍結當前程式與專案 CSS，之後來源變更不會自動更動這份設計稿。

本版包含：

1. 公開列表的名稱／地圖搜尋、篩選、新增與更新日期、跨日唯讀預覽與套用通知。
2. 行程標題下拉切換，以及「行程操作」中的編輯、發佈、更新、下架與確認／取消。
3. 套用時複製獨立地圖與地點：地圖名稱為 `<地圖名稱>(分享)`，新建標籤名稱為 `<公開行程名稱>(分享)`，從專案標籤色盤隨機選色，標示全部複製地點。每次套用各自建立標籤與副本。
4. 對齊正式 UI 的地圖左右欄、地點清單與詳細資料、標籤分類列／色點與地點預覽，供查看分享資料。
5. 更新／下架不影響已套用副本；公開快照不含來源私人標籤與地點備註。

本設計稿使用獨立 IndexedDB `travel-guide-design-public-itinerary-sharing-20261021`，與實作版 POC 及正式資料分開；在相同瀏覽器及 origin 重新整理會保留變更，不重複初始化。直接開啟本機檔案時，資料儲存是否可用取決於瀏覽器對檔案來源的支援；若受限制，可用既有 `npm run dev`，開啟 `/poc/ui/public-itinerary-sharing-workflow.html`。地圖沿用路線示意。

建議先套用京都行程，再由側欄確認地圖與標籤及 9 個地點；於行程標題下拉自行選取副本。修改原始京都行程後確認公開預覽仍是舊版，接著檢視更新取消／確認、下架取消／確認及重新發佈。

PoC 省略的既有新增、刪除、批次管理與協作功能，正式整合仍沿用現有模組、controller 與 repository；省略控制項不代表移除功能。行程刪除與分享資料保留的邊界詳見 [POC 說明](../public-itinerary-sharing/README.md)。

此次確認為 UI 外觀／流程核准及設計稿保存；未據此宣告完整手動 E2E、E2E 程式或正式 UI 整合完成。
