## 安裝必要環境: /init-install

1. 專案能 run 起來環境(紀錄指令)
2. vite test 測試環境
3. e2e 測試環境
4. psql

## 必要資料提示輸入 /env-check

1. 檢查 .env.local 和 .env.e2e, 提示使用者私人資訊要先設定好,若是 用一個 command line 讓使用者輸入, 自動建立 .env.local 帶入使用者輸入的值

## 環境完善度測試 /core-check

1. 測試專案能跑起來
2. 測試 google api 能連線正常 (需寫獨立 script 驗證,讀取 .env.local api key 內容 單獨執行, 不影響專案)
3. 測試 e2e 測試環境正常 (寫一個時間超短一定會過的 e2e 能跑起來就好)
4. 測試 psql 可連線 (需寫獨立 script, 讀寫 .env.local 的資料庫資訊)

## 自動跑流程: /init-auto

依序執行: /init-install > /env-check > /core-check
