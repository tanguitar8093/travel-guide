# Quick Tunnel 啟動捷徑

在終端機執行，或在檔案管理員選擇「在終端機執行」。請勿同時啟動兩種模式。

無密碼：

```bash
/home/ubuntu/workspace/Travel/tunnel/start-no-password.sh
```

有密碼（啟動時詢問帳號與密碼；密碼留空會產生並顯示隨機密碼）：

```bash
/home/ubuntu/workspace/Travel/tunnel/start-with-password.sh
```

兩者都會啟動專案到 `127.0.0.1:5173`，然後啟動 cloudflared。
有密碼模式透過 `127.0.0.1:15173` 驗證後轉送到 5173。
密碼不寫入檔案。無密碼模式知道網址的人都能存取。

Vite 與 cloudflared 的 stdout/stderr 原樣顯示在終端機，公開網址會出現在 Cloudflare log。
按 `Ctrl+C` 停止本次啟動的所有服務。若 5173 或保護入口已被使用，啟動會失敗，
不會改用其他連接埠，也不會關閉你原有的服務。
Quick Tunnel 是暫時預覽，每次啟動網址可能不同，環境或程序停止就無法存取。

cloudflared 預設位置：`~/.local/bin/cloudflared`。如安裝位置不同：

```bash
CLOUDFLARED_BIN=/usr/local/bin/cloudflared ./tunnel/start-no-password.sh
```

若想同時把終端機輸出存檔：

```bash
set -o pipefail
./tunnel/start-no-password.sh 2>&1 | tee tunnel/preview.log
```

log 可能包含網址；有密碼模式若自動產生密碼，log 也會包含該密碼，請妥善保存。

## 找公開網址

啟動後會用醒目區塊顯示公開網址；log 太多時，直接在啟動的終端機按 **Enter** 再次顯示。
也可在另一個終端機執行：

```bash
cat /home/ubuntu/workspace/Travel/tunnel/url.txt
```

`url.txt` 是最近一次啟動產生的網址，服務停止後該網址即失效。
Cloudflare 原始 log 同時顯示在終端機並存到 `tunnel/cloudflared.log`，每次啟動會覆寫。
