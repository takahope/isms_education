# 簡易教育訓練即時統計頁面設計規格書 (Simple Training Stats Page Design Spec)

- **日期**：2026-08-19
- **狀態**：Pending User Review
- **模組**：教育訓練簡易統計頁面與路由（Simple Training Stats & Web Routing）
- **參考範本**：`docs/教育訓練追蹤/index.html`

---

## 1. 概述 (Overview)

為了讓管理同仁與主管能一目了然掌握全體在勤人員的資安教育訓練完成情況，並即時追蹤「尚有哪些人員未通過課程」，本模組在 Google Apps Script (GAS) 既有架構下新增獨立的簡易統計頁面 (`stats.html`) 與路由支援 (`?page=stats`)。

本設計具備以下核心特色：
1. **精準人員範疇過濾**：僅統計「人員主檔」中 C 欄在勤狀態為「在勤」與「育嬰假」，且 H 欄工作地點排除「outside」的人員。
2. **訓練成果自動比對**：由後端關聯「訓練紀錄」工作表，依信箱比對測驗結果（通過／未通過／未受訓）。
3. **個人隱私保護**：此頁面為公開統計頁面，後端 API 與前端介面**完全排除 E 欄（測驗分數）**，僅呈現測驗結果狀態標籤，保護個人隱私。
4. **直覺高效 UI**：採用 Bootstrap 5 與大字體 KPI 卡片設計，預設聚焦「待完成名單」，並支援「全部應訓名單」Tab 切換、即時關鍵字搜尋與動態時鐘。
5. **零侵入路由分流**：於 `code.js` 的 `doGet(e)` 透過 URL 參數 `page=stats` 分流，完全不影響既有學員上課與作答入口。

---

## 2. 系統架構與資料流 (System Architecture & Data Flow)

```mermaid
flowchart TD
    A[使用者訪問 Web App] --> B{URL 參數檢查 e.parameter.page}
    B -- page === 'stats' --> C[回傳 stats.html 統計頁面]
    B -- default --> D[回傳 index.html 既有上課首頁]
    
    C --> E[前端 stats.html 載入]
    E --> F[呼叫 google.script.run.getSimpleTrainingStats]
    
    F --> G[後端 getSimpleTrainingStats]
    G --> H[讀取 人員主檔]
    G --> I[讀取 訓練紀錄]
    
    H --> J[篩選: C 欄 ∈ 在勤/育嬰假 且 H 欄 !== outside]
    I --> K[依 Email 比對測驗結果 通過/未通過/未受訓]
    
    J & K --> L[組裝 KPI 與去識別化名單 (排除 E 欄分數)]
    L --> M[回傳 JSON Payload 至前端]
    M --> N[前端渲染 KPI 卡片、進度條與人員表格]
```

---

## 3. 後端邏輯與資料契約 (Backend Logic & Data Contract)

### 3.1 路由分流 (`code.js` / `doGet`)
```javascript
function doGet(e) {
  const page = e && e.parameter && e.parameter.page ? String(e.parameter.page).trim().toLowerCase() : '';
  if (page === 'stats') {
    return HtmlService.createTemplateFromFile('stats')
      .evaluate()
      .setTitle('即時課程統計儀表板')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('臺灣人體生物資料庫資安暨個資教育訓練')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

### 3.2 資料篩選與關聯計算 (`getSimpleTrainingStats`)
- **人員主檔篩選條件**：
  - A 欄 (index 0)：使用者信箱 (`email`，正規化轉小寫與去除空白)。
  - B 欄 (index 1)：姓名 (`name`)。
  - C 欄 (index 2)：在勤狀態 (`status`)，僅納入 `['在勤', '育嬰假']`。
  - H 欄 (index 7)：工作地點 (`location`)，排除 `location.toLowerCase().trim() === 'outside'`。
- **訓練紀錄比對條件**：
  - B 欄 (index 1)：姓名。
  - C 欄 (index 2)：使用者信箱 (`userEmail`)。
  - F 欄 (index 5)：測驗結果 (`result`)。
  - 狀態判定：
    - 若曾有任一筆 `result === '通過'`，判定為 `passed`（通過）。
    - 若無通過但有測驗紀錄，判定為 `failed`（未通過）。
    - 若無任何測驗紀錄，判定為 `unattempted`（未受訓）。
  - **隱私安全保護**：嚴格排除 E 欄（`score`），Payload 與前端均不得攜帶或顯示分數。

### 3.3 後端回傳 Payload 格式
```javascript
{
  success: true,
  generatedAt: "2026-08-19 13:00:00",
  courseTitle: "資安暨個資教育訓練",
  summary: {
    totalEligible: 120,       // 符合條件總人數
    passedCount: 95,          // 已通過人數
    failedCount: 5,           // 測驗未通過人數
    unattemptedCount: 20,     // 未受訓人數
    incompleteCount: 25,      // 待完成總人數 (failedCount + unattemptedCount)
    completionRate: "79.2%",  // 完成率字串
    completionPercent: 79.2   // 完成率數值
  },
  learners: [
    {
      name: "王小明",
      email: "ming@example.com",
      status: "在勤",
      location: "南港總部",
      trainingStatus: "passed",      // 'passed' | 'failed' | 'unattempted'
      trainingStatusLabel: "通過"    // '通過' | '未通過' | '未受訓'
    }
  ]
}
```

---

## 4. 前端介面與互動設計 (`stats.html`)

### 4.1 介面組件結構
1. **頁首 (Header)**：
   - 標題：`<i class="fas fa-chart-line me-2"></i>即時課程統計儀表板`
   - 副標：`臺灣人體生物資料庫 - 在勤與育嬰假人員完訓追蹤`
   - 右側：即時動態時鐘 (`YYYY/MM/DD HH:mm:ss`) +「🔄 立即重新整理」按鈕。
2. **KPI 統計卡片列 (Summary Cards)**：
   - **卡片 1（完成率）**：大字體百分比 + 視覺動畫進度條 (`progress-bar-striped`)。
   - **卡片 2（應訓總人數）**：顯示 `totalEligible`（符合 C 欄在勤/育嬰假 且 H 欄非 outside 之人數）。
   - **卡片 3（已通過人數）**：綠色大字體，顯示 `passedCount`。
   - **卡片 4（待完成人數）**：紅色大字體，顯示 `incompleteCount`（未通過 + 未受訓）。
3. **名單控制與搜尋列 (Controls & Search)**：
   - **頁籤 (Tabs)**：
     - `待完成名單 (預設)`：僅列出 `trainingStatus !== 'passed'` 之同仁。
     - `全部應訓名單`：列出所有符合條件之同仁。
   - **搜尋框**：即時關鍵字搜尋（姓名、信箱、工作地點）。
4. **人員明細表格 (Personnel Table)**：
   - 欄位：`# (序號)`、`姓名`、`使用者信箱`、`在勤狀態`、`工作地點`、`測驗結果`。
   - 狀態標籤（Badge）：
     - `通過`：綠色徽章 (`bg-success`)
     - `未通過`：紅色徽章 (`bg-danger`)
     - `未受訓`：灰色徽章 (`bg-secondary`)
   - 當名單為空時，顯示友善空狀態提示（例如「太棒了！所有應訓人員皆已完成課程！」）。
5. **自動更新機制**：
   - 頁面載入時自動非同步更新。
   - 支援手動點擊「重新整理」。
   - 設定定時器（每 60 秒自動背景輪詢更新）。

---

## 5. 隱私與安全性 (Privacy & Security)

1. **分數脫敏（Score Redaction）**：
   - 此統計頁面為團隊公開檢視使用，所有個人測驗分數（E 欄）皆在後端讀取階段過濾掉，完全不傳輸至前端，也不在任何 DOM 節點中呈現。
2. **防呆與容錯**：
   - 信箱與地點欄位自動做 `trim()` 與大小寫轉換比對，避免因輸入空白造成漏算或誤判。
   - 後端加入 `try...catch` 與工作表存在性驗證，若試算表異常能回傳清楚的錯誤訊息。

---

## 6. 驗收與測試標準 (Verification & Testing Plan)

### 6.1 自動化單元測試 (`test/simple-stats-logic.test.js`)
1. **人員篩選邏輯驗證**：
   - `C 欄 = '在勤'` 且 `H 欄 = '南港總部'` $\rightarrow$ **納入**。
   - `C 欄 = '育嬰假'` 且 `H 欄 = '台中駐站'` $\rightarrow$ **納入**。
   - `C 欄 = '在勤'` 且 `H 欄 = 'outside'`（含大小寫如 `Outside`、`OUTSIDE `） $\rightarrow$ **排除**。
   - `C 欄 = '離職'`、`'委外廠商'`、`'留職停薪'` $\rightarrow$ **排除**。
2. **測驗結果關聯驗證**：
   - 有通過紀錄者判定為 `passed`。
   - 僅有未通過紀錄者判定為 `failed`。
   - 無紀錄者判定為 `unattempted`。
3. **隱私安全性驗證**：
   - 斷言回傳 Payload 的所有 learner 物件均**不包含 `score` 欄位**。

### 6.2 路由與整合測試
1. 驗證 `doGet({ parameter: { page: 'stats' } })` 成功渲染 `stats.html`。
2. 驗證預設 `doGet({})` 保持渲染 `index.html`。
3. 驗證既有測試套件（`test/*.test.js`）全面通過無迴歸異常。
