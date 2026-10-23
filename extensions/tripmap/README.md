# TripMap Chrome 擴充套件 v0.3.2

Google OAuth、帳號管理與 Google Maps 快捷入口。
地點依「名稱＋地點座標」判斷，不使用 Place ID、不限制沖繩範圍。
地點按鈕與右鍵選單已接上 Supabase 新增 API；登入已開通的帳號後可寫入雲端。

## 安裝／更新

1. 解壓縮 `tripmap-extension-v0.3.2.zip`，或使用專案中的 `extensions/tripmap` 資料夾。
2. 電腦 Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」。
3. 點「載入未封裝項目」，選取內含 manifest.json 的 `tripmap` 資料夾。
4. 從 v0.1 首次更新：若舊版 ID 不同，請移除舊版再載入 v0.3.1，之後更新可用重新載入。
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
- TripMap 按鈕為獨立最上層懸浮入口，固定在左上方（左 24px、上 88px，避開搜尋列），不再插入資訊卡。
- 入口右上角的 × 可關閉；同一地點即使網址裝飾參數改變也不會彈回，切換到另一個有效地點才重新顯示。關閉入口不影響右鍵加入，也不會取消已送出的新增。
- 瀏覽器原生右鍵選單顯示「加入 TripMap 地點」。若地圖攔截右鍵，可在資訊面板的非連結空白處使用。
- 動態切換地點、上一頁／下一頁、分頁切換與資訊卡重建皆會更新入口。
- 只有地圖中心、搜尋列表、未展開短網址、缺少名稱／座標或多組不同地點座標時不顯示。
- 點擊按鈕或右鍵「加入 TripMap 地點」後，直接使用擴充套件 session 呼叫雲端 API。
- 頁面右下角唯讀浮動視窗顯示「加入地點中…」、「成功」或「失敗」，並附上地點名稱／原因；右鍵與畫面按鈕共用回饋。成功保留 8 秒，失敗保留 15 秒，不阻擋操作。管理介面也可查看最近結果。
- API 目前沿用網站沖繩圖資範圍；範圍外會拒絕，不會假裝已加入。
- 名稱相同或距離小於 50 公尺時沿用既有網站去重規則，不建立第二筆。
- 不需開啟 TripMap 網頁；之後由既有雲端同步讀回資料。API 不依賴 Quick Tunnel。
- API 契約詳見專案 `docs/api/quick-place-import.md`。

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
不會替你登入真實 Google 帳號，也不建立真實使用者或地點。
