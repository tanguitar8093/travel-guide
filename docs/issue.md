# 產品議題與尚未解決的驗收

更新日期：2026-10-20。議題不是已批准的變更規格。

## 1. 共享行程與私人模組重用

原問題：協作者沒有作者的私人區域，新增地點可能受私人區域篩選限制。
目前 [CollaborativeItineraryService](../src/modules/itinerary/collaborative-itinerary.service.ts)
會在共享行程工作區合成共享區域／地點，並讓 editor 的私人候選地點在該工作區可選。
這是工作區投影，**沒有替 B 的私人區域模組建立一筆作者區域**，
也沒有讓 B 存取作者整個私人 place/label/region 收藏。

是否需要獨立匯入共享區域／地點、跨行程重用或新的共享資料庫，仍是產品決策。
獨立 clone 與持續編輯同一 shared workspace 不同，不能為繞過 UI 篩選自行擴大 owner 權限。
現行契約見[協作紀錄](trip-collaboration-rollout.md)。

## 2. 最新單視窗 E2E

使用者先前手動成功，但最新附件顯示 B 找不到本輪共享行程，
收尾時 page/context/browser 已關閉。根因及該輪清理結果未確認。
不能僅從附件斷定是資料庫版本、同步等待或測試腳本問題。
待辦見[測試計畫](test-plan.md)；不自動重跑、skip 或刪除未知資料。

## 3. 線上版本差異

核心共享函式已對齊，權限、缺少排序 RPC、基礎結構／歷史物件及版本追蹤尚待收斂。
詳細下一步與新對話交接見[收斂計畫](database-version-convergence.md)。
