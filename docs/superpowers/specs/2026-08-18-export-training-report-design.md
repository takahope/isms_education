# 匯出教育訓練報告功能設計規格書 (Export Training Report Design Spec)

## 1. 概述 (Overview)

本功能為企業資訊安全教育訓練系統（ISMS Education System）之管理儀表板（Dashboard）新增「匯出教育訓練報告」功能。管理員可依據儀表板當前設定的篩選範圍（包含搜尋關鍵字、訓練狀態、單位、工作地點、未完成篩選、排除倫理委員會等），將篩選後的教育訓練統計概況與學員明細資料匯出為結構化、多分頁的 Excel 試算表（`.xlsx`）。

---

## 2. 目標與非目標 (Goals & Non-Goals)

### 目標 (Goals)
1. **即時性與零伺服器負載**：利用前端 SheetJS CDN 於瀏覽器端直接解析當前篩選數據並產生 `.xlsx` 檔案下載，無後端延遲與 Apps Script 執行配額負擔。
2. **多分頁結構**：
   - **工作表 1（訓練統計摘要）**：包含報表基本資訊、當前篩選條件說明、核心 KPI 指標（應訓人數、已完成、待測驗、進行中、未開始、整體完成率）及各單位完成概況表格。
   - **工作表 2（學員明細清單）**：包含符合當前篩選條件的所有學員 15 個完整明細欄位。
3. **優雅易讀的排版**：提供適應內容長度的自動欄寬計算，數字欄位保持數字型態以利 Excel 彙算，空值友善顯示（如 `-` 或 `無紀錄`）。
4. **防呆與例外保護**：篩選後無資料（0 筆）時提示管理者並中斷產出；檔名安全過濾非法字元；若 CDN 載入異常提供優雅降級提醒。

### 非目標 (Non-Goals)
- 不變更 Google Sheets 後端儲存結構。
- 不提供伺服器端定時排程自動發送報表（維持由使用者手動於儀表板觸發匯出）。

---

## 3. UI 與操作流程 (User Interface & Flow)

### 3.1 按鈕位置與樣式
* **位置**：`dashboard/dashboard.html` 之篩選面板（`.filters-panel`）操作按鈕區，緊鄰「清除篩選」按鈕。
* **DOM 結構**：
  ```html
  <button id="export-report-btn" class="filter-reset export-btn" type="button">
    📊 匯出報告
  </button>
  ```
* **樣式**：與現有儀表板按鈕風格一致，滑鼠懸停時具有微凸起或顏色加深反饋。

### 3.2 檔案命名規則
* 檔案名稱格式：
  `教育訓練報告_{課程名稱}_{YYYYMMDD_HHmm}.xlsx`
* 範例：`教育訓練報告_113年下半年資通安全教育訓練_20260818_2322.xlsx`
* 課程名稱若包含 `\ / : * ? " < > |` 等特殊字元，自動替換為底線 `_`。

### 3.3 互動與狀態回饋
1. 使用者點擊「📊 匯出報告」。
2. 若 `filteredLearners.length === 0`，跳出 SweetAlert 警告：「目前篩選範圍內無學員資料可供匯出，請調整篩選條件。」並終止流程。
3. 按鈕文字暫時切換為「產出中...」並禁用。
4. 產生工作簿並透過 `XLSX.writeFile` 觸發下載。
5. 按鈕復原為「📊 匯出報告」，並以 SweetAlert2 Toast 提示「已成功匯出教育訓練報告！」。

---

## 4. Excel 工作表與欄位規格 (Worksheet & Column Schema)

### 4.1 工作表 1：`訓練統計摘要`

| 區塊 | 欄位/項目 | 內容範例 / 說明 |
| :--- | :--- | :--- |
| **報表資訊** | 課程名稱 | 113年下半年資通安全教育訓練 |
| | 匯出時間 | 2026-08-18 23:22:00 |
| | 操作人員 | admin@example.com |
| **套用篩選條件** | 關鍵字搜尋 | 全部 / "關鍵字" |
| | 訓練狀態 | 全部 / 已完成 / 待測驗 / 進行中 / 未開始 |
| | 所屬單位 | 全部 / 研發部 |
| | 工作地點 | 全部 / 台北、台中 |
| | 僅顯示未完成 | 否 / 是 |
| | 排除倫理委員會 | 是 / 否 |
| **整體 KPI 指標** | 應訓總人數 | 120 (數值型) |
| | 已完成人數 | 95 (數值型) |
| | 待測驗人數 | 10 (數值型) |
| | 進行中人數 | 10 (數值型) |
| | 未開始人數 | 5 (數值型) |
| | 近 7 日活躍人數 | 32 (數值型) |
| | 整體完成率 | 79.2% (字串或百分比格式) |
| **各單位完成概況** | `單位名稱` | 研發部、業務部、管理部... |
| (表格) | `應訓人數` | 單位總人數 (數值型) |
| | `已完成人數` | 單位已完成人數 (數值型) |
| | `未完成人數` | 單位未完成人數 (數值型) |
| | `單位完成率` | 如 `85.0%` |

### 4.2 工作表 2：`學員明細清單`

表頭順序共 15 個欄位：

| 欄位序號 | 欄位名稱 | 資料來源屬性 | 格式/處理規則 |
| :---: | :--- | :--- | :--- |
| 1 | **姓名** | `learner.name` | 字串 |
| 2 | **電子郵件** | `learner.email` | 字串 |
| 3 | **工作地點** | `learner.location` | 字串（若無顯示 `-`） |
| 4 | **所屬單位** | `learner.assignmentOrgName` | 字串（若無顯示 `未設定單位`） |
| 5 | **職務名稱** | `learner.assignmentTitle` | 字串（若無顯示 `-`） |
| 6 | **人員狀態** | `learner.personnelStatus` | 字串（若無顯示 `-`） |
| 7 | **觀看進度** | `learner.watchedPercent` | 字串，例如 `100%` 或 `45%` |
| 8 | **累計觀看秒數** | `learner.watchedSecondsCount` | 數字型態（秒） |
| 9 | **影片觀看合格** | `learner.watchCompleted` | 是 / 否 |
| 10 | **測驗最佳分數** | `learner.bestScore` | 數字型態；未測驗者顯示 `-` |
| 11 | **測驗最新分數** | `learner.latestScore` | 數字型態；未測驗者顯示 `-` |
| 12 | **測驗最新結果** | `learner.latestResult` | 通過 / 未通過 / 未作答 |
| 13 | **測驗測驗次數** | `learner.attemptCount` | 數字型態 |
| 14 | **最終訓練狀態** | `learner.statusLabel` | 已完成 / 待測驗 / 進行中 / 未開始 |
| 15 | **最後活動時間** | `learner.lastActivityAt` | YYYY-MM-DD HH:mm:ss；無活動顯示 `無紀錄` |

---

## 5. 技術架構與前端實作 (Architecture & Implementation)

### 5.1 相依庫
在 `dashboard/dashboard.html` 的 `<head>` 區段引入 SheetJS：
```html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
```

### 5.2 核心前端函式
1. `buildExportWorkbook(learners, kpis, unitSummary, filters, state)`:
   - 彙整工作表 1（二維陣列 AOA）及工作表 2（結構化陣列）。
   - 透過 `XLSX.utils.aoa_to_sheet()` 轉換為 Sheet 物件。
   - 計算各欄文字寬度，動態設定 `ws['!cols']`。
   - 建立 Workbook 並加入兩張工作表。
2. `formatFiltersSummary(filters)`:
   - 將當前 `state.filters` 轉為清晰易讀的中文摘要陣列。
3. `exportTrainingReport()`:
   - 取得 `const learners = applyFilters(state.allLearners)`。
   - 防呆檢查 `learners.length === 0`。
   - 計算 `const { kpis, units } = computeClientMetrics(learners)`。
   - 產生 Workbook 並下載。

---

## 6. 測試驗證方案 (Testing Plan)

### 6.1 自動化測試
* **`test/export-report-frontend.test.js`**：
  - 驗證 CDN 引入標籤。
  - 驗證匯出按鈕 DOM 結構與點擊事件。
  - 驗證核心函式存在與宣告。
* **`test/export-report-logic.test.js`**：
  - 模擬完整學員清單與不同篩選狀態。
  - 驗證工作表 1 結構、KPI 計算正確性與單位統計資料。
  - 驗證工作表 2 欄位對應（15 欄名稱、數值型別轉換、空值格式化）。
  - 驗證空資料防護邏輯與檔名過濾邏輯。
* **全套回歸測試**：
  - 執行 `node test/*.test.js` 確保所有測試案例全數通過。

### 6.2 手動驗證
* 於部署環境中測試不同篩選組合（如：單一單位、複選地點、未完成篩選），點擊匯出並用 Microsoft Excel 或 Google 試算表開啟，確認工作表切換、欄寬適配、無亂碼及數值無誤。
