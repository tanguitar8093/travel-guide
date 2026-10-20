# 開發計畫：Google Maps URL 解析與自動標記系統

## 1. 專案背景與目標

目前前端 React 應用程式已具備透過「關鍵字」搜尋並在 Google Maps 上標記地點的功能。
本計畫的目標是：擴充輸入功能，允許使用者貼上**任意格式的 Google Maps 網址**（包含長網址與短網址），系統能自動解析出「關鍵字」或「地點名稱」，並無縫串接原有的地圖標記功能。

## 2. 系統架構環境

- **前端框架**：React + TypeScript
- **後端服務**：Supabase (將使用 Edge Functions 處理跨域與重導向問題)
- **地圖服務**：Google Maps JavaScript API, Google Places API

## 3. 處理邏輯與資料流 (Data Flow)

使用者輸入文字 (字串) 後，依照以下流程判斷：

1.  **【短網址處理】**：檢查字串是否包含 `maps.app.goo.gl` 或 `goo.gl/maps`。
    - **Y**：呼叫 Supabase Edge Function，在伺服器端追蹤 HTTP Redirect，取得最終展開的長網址，再回傳給前端。
    - **N**：進入下一步。
2.  **【長網址處理】**：檢查字串是否包含 `google.com/maps`。
    - **Y**：前端使用 Regex 解析字串，擷取 `/place/` 或 `/search/` 後方的文字，並進行 `decodeURIComponent` 轉換為可讀關鍵字。
    - **N**：進入下一步。
3.  **【純文字處理】**：若皆不符合上述兩者，視為純文字關鍵字。
4.  **【執行標記】**：將最終取得的「關鍵字」傳遞給現有的 Google Places API 搜尋模組，完成地圖標記。

---

## 4. 實作任務拆解 (交由 Agent 執行的具體步驟)

### Task 1: 建立 Supabase Edge Function (處理短網址重導向)

- **目標**：解決瀏覽器 CORS 限制，自動追蹤短網址。
- **實作細節**：
  1.  建立名為 `parse-map-url` 的 Supabase Edge Function (Deno/TypeScript)。
  2.  設定 CORS Headers，允許前端 React 呼叫。
  3.  接收 `shortUrl` 參數。
  4.  使用 `fetch(shortUrl, { method: 'GET' })` 取得重導向後的 `response.url` (長網址)。
  5.  (Optional) 直接在 Edge Function 內以 Regex 抽取出關鍵字，或將長網址回傳交由前端解析。建議統一回傳 `{ originalUrl, expandedUrl, keyword }`。
  6.  處理錯誤機制 (如無效網址、Fetch 失敗)。

### Task 2: 建立前端網址解析工具 (Utility Function)

- **目標**：在 React 中建立一個純粹的 TypeScript Utility 負責字串判斷與 Regex 解析。
- **實作細節**：
  1.  建立 `mapUrlParser.ts`。
  2.  撰寫 function `extractKeywordFromUrl(url: string): string | null`。
  3.  實作 Regex 匹配 `/place/([^/?]+)` 與 `/search/([^/?]+)`。
  4.  處理字串解碼 (`decodeURIComponent`) 與空白字元替換 (`replace(/\+/g, ' ')`)。

### Task 3: 整合至 React UI 元件

- **目標**：串接現有輸入框與地圖搜尋功能。
- **實作細節**：
  1.  在處理輸入送出的函式 (e.g., `onSubmit` 或 `onPaste`) 中加入邏輯。
  2.  偵測到 `maps.app.goo.gl` 時，使用 Supabase Client 呼叫 `supabase.functions.invoke('parse-map-url', { body: { shortUrl } })`。
  3.  偵測到一般網址時，呼叫 Task 2 的 `extractKeywordFromUrl`。
  4.  取得最終 keyword 後，觸發原有的 Google Maps 搜尋標記 function。
  5.  增加 Loading 狀態（因為 Edge Function 解析需要時間）與錯誤提示 UI。

---

## 5. 測試案例 (Test Cases) 提供給 Agent 驗證

請確保完成的程式碼能正確處理以下三種輸入情境，並提取出正確關鍵字：

1.  **純關鍵字**
    - 輸入：`台北101`
    - 預期輸出：`台北101`
2.  **長網址 (Place URL / Search URL)**
    - 輸入 A：`https://www.google.com/maps/place/%E5%8F%B0%E5%8C%97101/@25.0339639,121.5644722,17z`
    - 預期輸出 A：`台北101`
    - 輸入 B：`https://www.google.com/maps/search/%E6%B2%96%E7%B9%A9%E7%B8%A3%E5%AE%87%E6%B5%81%E9%BA%BB%E5%B8%82%20%E4%B8%8E%E9%82%A3%E5%9F%8E%E5%B1%8B%E5%B9%B34`
    - 預期輸出 B：`沖縄県うるま市 与那城屋平4`
3.  **短網址 (Share Link)**
    - 輸入：`https://maps.app.goo.gl/xxxxxx` (請 Agent 自行替換有效短網址測試)
    - 預期流程：需先呼叫 Supabase Edge Function 取得長網址，再解析出對應的地點名稱。
