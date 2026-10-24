# 靜態版 + OSM 代理

在專案根目錄執行：

```bash
npm run build:static
npm run serve:static
```

開啟 http://127.0.0.1:4173。Caddy 提供 dist、SPA fallback、壓縮與 /local-map 代理；沒有 Vite HMR。build:static 明確設定 OSM 服務及圖資為 /local-map，其他 Vite 環境設定依原本 .env 規則載入，修改後需重新 build。

另一個終端啟動 Quick Tunnel：

```bash
~/.local/bin/cloudflared tunnel --url http://127.0.0.1:4173 --http-host-header localhost:4173 --no-autoupdate
```

從 cloudflared log 取得新的 https://*.trycloudflare.com 網址。兩個終端保留所有 log，Ctrl+C 分別停止。現有 5173 與 tunnel 不受影響。每次建立 Quick Tunnel 網址可能不同；若 Supabase 尚未允許該 origin，需將新網址加入 Authentication → URL Configuration → Redirect URLs。PWA 安裝與登入儲存也依 origin 區分。

OSM 後端：健康檢查成功就沿用 127.0.0.1:3000，結束時不停止既有服務；沒啟動時會啟動 osm/server.py，僅清理由本腳本啟動的後端。圖資仍放在 osm/data 與 osm/vendor，不必複製進 dist。

可設定 STATIC_PORT（預設 4173）、OSM_UPSTREAM（預設 127.0.0.1:3000，必須自行啟動自訂後端）、CADDY_BIN（預設 ~/.local/bin/caddy）。Caddy 僅綁定 loopback，外部由 tunnel 進入。

本機已安裝官方 Caddy v2.11.7 linux_arm64 到 ~/.local/bin/caddy，下載檔已比對官方 SHA-512 checksum。部署到其他主機須另外安裝符合平台的 Caddy，或指定 CADDY_BIN。

普通 `npm run preview` 仍是 Vite preview，不含此部署代理，請使用 `npm run serve:static`。
