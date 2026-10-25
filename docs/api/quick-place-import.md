# 快捷新增地點 API

已部署：`POST https://dblpjzimucrlmmgwntiq.supabase.co/rest/v1/rpc/app_import_place`

此 RPC 使用呼叫者的 Supabase JWT、既有 RLS、`app_save_place` 與同步 triggers。
不使用 service-role、不信任傳入的 userId、不需要 Place ID。不依賴本機 Vite、OSM server 或 Quick Tunnel。

## Request

```http
POST /rest/v1/rpc/app_import_place
apikey: <公開 Supabase anon/publishable key>
Authorization: Bearer <使用者 Supabase access token>
Content-Type: application/json
```

```json
{
  "p_name": "海之驛站 彩橋館",
  "p_latitude": 26.3316539,
  "p_longitude": 127.927996,
  "p_operation_id": "c6e53f9e-1669-4ce5-bb68-f44f557abb8a",
  "p_source_url": "https://www.google.com/maps/place/海之驛站+彩橋館/data=!3d26.3316539!4d127.927996"
}
```

- `p_name`：必填，trim 後 1～300 字元。
- `p_latitude`／`p_longitude`：必填有限數值；目前依既有圖資限制於沖繩框內（25.98～26.9、127.58～128.36）。
- `p_operation_id`：必填 UUID，同一筆操作重試使用相同 UUID。新地點以此作為 ID；相同 ID 改送不同資料會被拒絕。
- `p_source_url`：選填 HTTPS 網址，不會在後端抓取此網址。
- 不接受 owner/user ID、Place ID、標籤或其他額外參數。歸屬由 JWT 決定，標籤快捷設定不在這一版。
- 僅已開通的 member／admin 可以呼叫；anon、basic 不可使用。

## Response

```json
{"status":"created","placeId":"...","name":"海之驛站 彩橋館","regionId":"..."}
```

同筆重試：`status: "already_imported"`。

與既有網站一致的去重（同使用者、無 Place ID 的座標地點）：
名稱 trim／空白正規化／不區分大小寫後相同，或座標距離小於 50 公尺，都不建立第二筆。

```json
{"status":"duplicate","placeId":"...","name":"既有地點名稱","reason":"nearby"}
```

`reason` 為 `nearby` 或 `name`。重複回應不會覆蓋原地點、標籤或座標。

權限問題回傳 SQLSTATE `42501`（HTTP 401／403）；資料不正確或範圍外回傳 `22023`（HTTP 400）。

## 儲存與同步

- 原子建立名稱、`source: user / kind: user-picked` 座標及所屬沖繩地圖關聯。
- 自動沿用／建立與網站相同的帳號專屬預設沖繩地圖，無 Google Place ID，OSM 模式可見。
- 新地點無預設標籤。
- 既有同步 trigger 會記錄版本；混合模式依既有自動／手動同步讀回本機。純本機模式不會自動取得雲端新增資料。
- 去重與新增使用現有同步／地點寫入鎖順序，避免併發點擊建立重複地點。

## 共用程式

- `shared/place-import/place-url.js`：網站與擴充套件共用完整地點網址解析。擴充建置時複製到其封裝內。
- 網站對未支援的網址格式／短網址仍沿用既有 Python 解析服務。
- `shared/place-import/payload.js`：快捷 API request 建構與前端輸入驗證。
- DB migration：`supabase/migrations/20261023203405_quick_place_import.sql`。
- 此專案的遠端 DB 原本沒有 Supabase CLI migration history table；此變更依現有方式透過 psql 部署並保留 SQL 檔，未額外建立 CLI history。

## 驗證

```bash
npm run test:run -- src/database/place-import.integration.test.ts src/geo/osm-service.test.ts
node --test shared/place-import/payload.check.mjs extensions/tripmap/place-url.check.mjs
node extensions/tripmap/check-browser.mjs
node --env-file=.env.local scripts/db-psql.mjs -f supabase/inspection/verify_quick_place_import.sql
```

最後一項使用既有 member 在交易內做新增、重試與同步驗證，最後 ROLLBACK，不留下測試地點。
瀏覽器驗證模擬 OAuth／Auth／新增 API，不會建立真實使用者或地點。
