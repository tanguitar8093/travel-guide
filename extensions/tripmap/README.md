# TripMap Chrome 擴充套件 v0.2

Google OAuth、帳號管理與 Google Maps 快捷入口。
地點依「名稱＋地點座標」判斷，不使用 Place ID、不限制沖繩範圍。
地點按鈕與右鍵選單尚未接上新增 API；點擊不會寫入地點。

## 安裝／更新

1. 解壓縮 `tripmap-extension-v0.2.0.zip`，或使用專案中的 `extensions/tripmap` 資料夾。
2. 電腦 Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」。
3. 點「載入未封裝項目」，選取內含 manifest.json 的 `tripmap` 資料夾。
4. 從 v0.1 首次更新：若舊版 ID 不同，請移除舊版再載入 v0.2，之後更新可用重新載入。
5. 更新後重新整理已開啟的 Google Maps 分頁。

此版 manifest 包含固定公開識別金鑰，同一份套件在不同路徑／電腦載入仍具有相同 ID：
`cpechdjdfbbngnaeecoijepoaekbcgda`。請勿移除或重產 manifest 的 key。
固定的是這份可載入套件的識別；未來首次上架商店時，需確認商店分配的 ID。

## Google 登入與 email

1. 點 Chrome 工具列的 TripMap 擴充套件圖示，或在 `chrome://extensions` → TripMap 詳細資料 →「擴充功能選項」。
2. 點「使用 Google 登入」，在 Google 視窗完成授權。
3. OAuth 正常經過 Google → Supabase；回到擴充套件專用網址時由 Chrome 接收結果。
4. 背景程序繼續交換授權碼、保存 session。若原本小面板關閉，重新開啟即可看到 email 與登出按鈕。

Supabase Authentication → URL Configuration → Redirect URLs 需要加入一次：

```text
https://cpechdjdfbbngnaeecoijepoaekbcgda.chromiumapp.org/oauth
```

保留網站原有的回跳網址。Google Console 中的 Supabase callback 不需改動。
帳號管理中的「OAuth 連線設定」也能查看、複製本機實際回跳網址。

- PKCE 流程的驗證碼只在背景程序交換。
- Supabase access token 與 refresh token 保存在擴充套件自己的 `chrome.storage.local`。
- 儲存空間限制為 TRUSTED_CONTEXTS；Google Maps 的 content script 無法直接讀取 token。
- 帳號介面只取得 email 與登入狀態，不顯示 token。Google provider token 不保留。
- 背景 alarm 定期檢查到期時間；開啟管理介面／背景程序喚醒也會檢查並更新。
- 登出使用 Supabase local scope，清除此擴充套件 session，不登出網站或其他裝置。

## 地點入口

- 支援 `google.com`、`google.com.tw`、`google.co.jp`、`google.co.uk` 的 Google Maps。
- 單一地點網址需包含 `/maps/place/名稱/` 及 `!3d緯度!4d經度`。
- TripMap 按鈕放在地點資訊卡、總覽／評論／簡介分頁列上方，水平置中。資訊卡尚未出現時等待其載入。
- 瀏覽器原生右鍵選單顯示「加入 TripMap 地點」。若地圖攔截右鍵，可在資訊面板的非連結空白處使用。
- 動態切換地點、上一頁／下一頁、分頁切換與資訊卡重建皆會更新入口。
- 只有地圖中心、搜尋列表、未展開短網址、缺少名稱／座標或多組不同地點座標時不顯示。
- 目前點擊只輸出解析結果到 Console，不會宣稱已新增成功。

## 開發／驗證

SDK 已包在 vendor/auth.js，可直接載入擴充套件，不需要 npm 或外部 CDN。
若修改 auth.js 或公開 Supabase 連線設定，在專案根目錄重新建置：

```bash
node extensions/tripmap/build.mjs
```

建置只讀取 VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY，不打包其他環境變數；拒絕 service-role／secret key。

```bash
node --test extensions/tripmap/place-url.check.mjs
node extensions/tripmap/check-browser.mjs
```

瀏覽器檢查會載入真實擴充套件，但使用模擬 OAuth 回跳與 Auth API 驗證 PKCE、email、session 保存、更新、登出及按鈕位置。
不會替你登入真實 Google 帳號，也不建立使用者或地點。
