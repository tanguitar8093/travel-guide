## input

- prompt 輸入需求,接下來跑 workflow and output

## workflow and output: 依序產出:

會依 prompt 需求看要停止在哪階段

- ui 設計 code:產出 demo workflow 畫面, 直接 hardcode 示意, 不需要資料串接, 但示意的內容要有邏輯合理的關聯性不能隨機無關, 可以先直接改 code, 
- ui code 核准後, 依需求產出設計稿放到 poc/ui/{模組-功能語意命名}.{可瀏覽網頁的副檔名}
- vite test 測項: 使用者驗證 ui workflow 符合預期, 開始寫 test 測項, 走 TDD
- IndexedDB:
  - 依功能需求所需要的資料料先定義好資料的核心 code, 和需要用的範例資料
  - 表單和範例 key value 值 說明 md
- 核心內容: 依測項規範, 產生操作/商業 邏輯 code
- ai 跑測項確認沒問題後, 交付給使用者手動 e2e 測試
- 產出 e2e 測試 code: 使用者手動測是沒問題後, 由 ai 寫 e2e 程式, 寫好後 ai 不要執行 ,讓使用者看到實際操作的畫面,
- e2e 測試通過後, poc 就算完成, 下一步會拿這個 poc 內容, 去評估 supabase 該如何設計
