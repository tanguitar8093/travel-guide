## 安裝必要環境: /init-install

1. 專案能 run 起來環境(紀錄指令)
2. vite test 測試環境
3. e2e 測試環境
4. psql

## 環境完善度測試 /core-check

以下個沒有 script 的話, 寫 script, 有的話跑 script

1. 測試專案能跑起來
2. 測試專案資料庫可連線 .env.local.VITE_SUPABASE_URL 可以連線
3. 測試 google api 能連線正常 (需寫獨立 script 驗證,讀取 .env.local. api key 內容 單獨執行, 不影響專案)
4. 測試 e2e 測試環境正常 (寫一個時間超短一定會過的 e2e 能跑起來就好)
5. 測試 psql 可連線 (需寫獨立 script, 讀寫 .env.local.SUPABASE_DB_URL 的資料庫資訊)


## 自動跑流程: /init-auto

依序執行: /init-install > /env-check > /core-check
