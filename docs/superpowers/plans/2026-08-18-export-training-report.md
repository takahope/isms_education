# 匯出教育訓練報告功能實作計畫 (Export Training Report Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為管理儀表板（Dashboard）新增依據當前篩選範圍產生並下載包含「訓練統計摘要」與「學員明細清單」雙工作表之 Excel (`.xlsx`) 報告功能。

**Architecture:** 於 `dashboard.html` 中透過 CDN 引入 SheetJS (`xlsx.full.min.js`)，在瀏覽器端提取當前篩選後的學員資料（`filteredLearners`）與計算指標（`kpis`、`unitSummary`），組織為結構化 AOA 二維陣列並進行自動欄寬適配，最後調用 `XLSX.writeFile` 觸發下載，全程於前端完成、無後端負載。

**Tech Stack:** HTML5, Vanilla JavaScript, SheetJS (xlsx CDN), SweetAlert2, Node.js (Assert for testing).

## Global Constraints

- **前端框架/語言**：維持 Vanilla JavaScript，符合 GAS 單頁應用規範。
- **檔案命名格式**：`教育訓練報告_{課程名稱}_{YYYYMMDD_HHmm}.xlsx`，特殊字元過濾為 `_`。
- **工作表名稱**：工作表 1 為 `訓練統計摘要`，工作表 2 為 `學員明細清單`。
- **學員明細欄位順序**：共 15 欄（姓名、電子郵件、工作地點、所屬單位、職務名稱、人員狀態、觀看進度、累計觀看秒數、影片觀看合格、測驗最佳分數、測驗最新分數、測驗最新結果、測驗測驗次數、最終訓練狀態、最後活動時間）。
- **依賴引入**：使用 CDN `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`。

---

### Task 1: SheetJS CDN 引入與 UI 匯出按鈕結構 (CDN Script & UI Export Button)

**Files:**
- Modify: `dashboard/dashboard.html`
- Create: `test/export-report-frontend.test.js`

**Interfaces:**
- Produces:
  - `<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>` in `<head>`
  - `<button id="export-report-btn" class="filter-reset export-btn" type="button">📊 匯出報告</button>` inside `.filters-panel`
  - DOM Event binding in `bindEvents()` for `export-report-btn`

- [ ] **Step 1: Write the failing frontend test**

Create `test/export-report-frontend.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查 SheetJS CDN 引入
assert(
  html.includes('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'),
  '必須在 head 引入 SheetJS CDN'
);

// 2. 檢查匯出報告按鈕結構與 ID
assert(html.includes('id="export-report-btn"'), '必須包含 id="export-report-btn" 按鈕');
assert(html.includes('匯出報告'), '按鈕文字需包含 匯出報告');

// 3. 檢查事件綁定
assert(
  html.includes("document.getElementById('export-report-btn').addEventListener('click'") ||
  html.includes("document.getElementById('export-report-btn')?.addEventListener('click'"),
  'bindEvents 需綁定 export-report-btn 點擊事件'
);

console.log('Task 1 測試通過：SheetJS CDN 與匯出按鈕結構正確！');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/export-report-frontend.test.js`
Expected: FAIL with assertion error (e.g. `必須在 head 引入 SheetJS CDN`).

- [ ] **Step 3: Implement CDN script and button in `dashboard/dashboard.html`**

In `dashboard/dashboard.html`:
1. In `<head>`, add SheetJS CDN script tag:
```html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
```
2. In `.filters-panel` (near `#reset-filters-btn`), add:
```html
<button id="export-report-btn" class="filter-reset export-btn" type="button">📊 匯出報告</button>
```
3. Add CSS styling for `.export-btn` if needed (e.g. matching existing filter reset styles or slight accent).
4. In `bindEvents()`, add event listener:
```javascript
document.getElementById('export-report-btn').addEventListener('click', exportTrainingReport);
```
5. Add stub function for `exportTrainingReport`:
```javascript
function exportTrainingReport() {
  // To be implemented in Task 3
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/export-report-frontend.test.js`
Expected: `Task 1 測試通過：SheetJS CDN 與匯出按鈕結構正確！`

- [ ] **Step 5: Commit changes**

```bash
git add test/export-report-frontend.test.js dashboard/dashboard.html
git commit -m "feat: add sheetjs cdn and export button to dashboard"
```

---

### Task 2: 核心資料轉換與工作表建置邏輯 (Data Transformation & Workbook Construction)

**Files:**
- Modify: `dashboard/dashboard.html`
- Create: `test/export-report-logic.test.js`

**Interfaces:**
- Produces:
  - `formatFiltersSummary(filters): string[]` - 將篩選條件格式化為易讀字串列表
  - `formatExportDateTime(date): string` - 格式化匯出時間字串 (YYYY-MM-DD HH:mm:ss)
  - `buildSummarySheetAoa(meta, kpis, unitSummary, filtersTextList): Array<Array<any>>`
  - `buildLearnerDetailsSheetAoa(learners): Array<Array<any>>`
  - `calculateColWidths(aoa): Array<{ wch: number }>`
  - `buildExportWorkbook(learners, kpis, unitSummary, state): XLSX.WorkBook`

- [ ] **Step 1: Write the failing logic unit test**

Create `test/export-report-logic.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 驗證核心函式存在於 HTML 腳本中
assert(html.includes('function formatFiltersSummary('), '需定義 formatFiltersSummary 函式');
assert(html.includes('function buildSummarySheetAoa('), '需定義 buildSummarySheetAoa 函式');
assert(html.includes('function buildLearnerDetailsSheetAoa('), '需定義 buildLearnerDetailsSheetAoa 函式');
assert(html.includes('function calculateColWidths('), '需定義 calculateColWidths 函式');
assert(html.includes('function buildExportWorkbook('), '需定義 buildExportWorkbook 函式');

// 驗證 15 欄欄位定義完整
const expectedHeaders = [
  '姓名', '電子郵件', '工作地點', '所屬單位', '職務名稱',
  '人員狀態', '觀看進度', '累計觀看秒數', '影片觀看合格', '測驗最佳分數',
  '測驗最新分數', '測驗最新結果', '測驗測驗次數', '最終訓練狀態', '最後活動時間'
];

for (const header of expectedHeaders) {
  assert(html.includes(`'${header}'`) || html.includes(`"${header}"`), `學員明細表頭需包含欄位: ${header}`);
}

console.log('Task 2 測試通過：匯出資料轉換與工作表建構邏輯齊全！');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/export-report-logic.test.js`
Expected: FAIL with assertion error (e.g. `需定義 formatFiltersSummary 函式`).

- [ ] **Step 3: Implement data transformation and workbook building functions in `dashboard/dashboard.html`**

In `<script>` of `dashboard/dashboard.html`, implement:

1. `formatFiltersSummary(filters)`:
   - 彙整關鍵字、狀態、單位、工作地點、未完成、排除倫理委員會為鍵值對陣列。
2. `formatExportDateTime(date)`:
   - 產出 `YYYY-MM-DD HH:mm:ss` 格式。
3. `buildSummarySheetAoa(meta, kpis, unitSummary, filtersSummaryList)`:
   - 建立包含「報表基本資訊」、「套用篩選條件」、「整體 KPI 總覽」、「各單位完成概況」的二維陣列（AOA）。
4. `buildLearnerDetailsSheetAoa(learners)`:
   - 包含 15 個欄位表頭，並依序 mapping 每位學員的資料（數值維持 number，空值格式化為 `-` 或 `無紀錄`）。
5. `calculateColWidths(aoa)`:
   - 遍歷 AOA 每欄計算最長字元（考量中文字元長度權重），產生 `[{ wch: width }, ...]`。
6. `buildExportWorkbook(learners, kpis, unitSummary, state)`:
   - 呼叫 `XLSX.utils.book_new()`。
   - 產生 `wsSummary` 與 `wsDetails`，設定 `!cols`。
   - `XLSX.utils.book_append_sheet(wb, wsSummary, '訓練統計摘要')`。
   - `XLSX.utils.book_append_sheet(wb, wsDetails, '學員明細清單')`。
   - 回傳 `wb` 物件。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/export-report-logic.test.js`
Expected: `Task 2 測試通過：匯出資料轉換與工作表建構邏輯齊全！`

- [ ] **Step 5: Commit changes**

```bash
git add test/export-report-logic.test.js dashboard/dashboard.html
git commit -m "feat: implement export workbook construction and data formatting"
```

---

### Task 3: 匯出事件處理、防呆驗證與下載觸發 (Export Handler, Empty Guard & Download Trigger)

**Files:**
- Modify: `dashboard/dashboard.html`
- Create: `test/export-report-integration.test.js`

**Interfaces:**
- Consumes:
  - `applyFilters(state.allLearners)`
  - `computeClientMetrics(filteredLearners)`
  - `buildExportWorkbook(learners, kpis, unitSummary, state)`
- Produces:
  - `exportTrainingReport()` complete execution logic
  - Safe filename generation `generateExportFileName(courseTitle, date)`

- [ ] **Step 1: Write the failing integration test**

Create `test/export-report-integration.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查防呆驗證與空資料提示
assert(html.includes('目前篩選範圍內無學員資料可供匯出'), '需包含空資料時的提示文字');

// 2. 檢查檔名生成邏輯
assert(html.includes('generateExportFileName('), '需定義 generateExportFileName 函式');
assert(html.includes('教育訓練報告_'), '檔名需以 教育訓練報告_ 開頭');

// 3. 檢查 SheetJS 下載觸發與 SweetAlert 提示
assert(html.includes('XLSX.writeFile('), '需調用 XLSX.writeFile 觸發下載');
assert(html.includes('已成功匯出教育訓練報告'), '需包含成功匯出的提示訊息');

console.log('Task 3 測試通過：匯出整合處理、防呆與下載邏輯正確！');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/export-report-integration.test.js`
Expected: FAIL with assertion error.

- [ ] **Step 3: Implement export handler & file download logic in `dashboard/dashboard.html`**

In `dashboard/dashboard.html`:
1. Implement `generateExportFileName(courseTitle, date)`:
   - 取得格式化時間 `YYYYMMDD_HHmm`。
   - 清理 `courseTitle` 移除特殊字元 `/[\\/:*?"<>|]/g`。
   - 回傳 `教育訓練報告_${cleanCourseTitle}_${timeString}.xlsx`。
2. Implement complete `exportTrainingReport()`:
   - 檢查 `typeof XLSX === 'undefined'`，若未載入則彈出錯誤提示。
   - 取得當前篩選名單 `const learners = applyFilters(state.allLearners);`。
   - 若 `learners.length === 0`，使用 SweetAlert 顯示警告 `目前篩選範圍內無學員資料可供匯出，請調整篩選條件。` 並中斷。
   - 按鈕切換為 `產出中...` 並 `disabled = true`。
   - 計算 `const { kpis, units } = computeClientMetrics(learners);`。
   - 呼叫 `const wb = buildExportWorkbook(learners, kpis, units, state);`。
   - 產生檔名 `const filename = generateExportFileName(state.courseTitle, new Date());`。
   - 執行 `XLSX.writeFile(wb, filename);`。
   - 恢復按鈕狀態，並以 SweetAlert2 Toast 提示 `已成功匯出教育訓練報告！`。
   - 加上 `try ... catch` 捕獲意外錯誤並友善提示。

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/export-report-integration.test.js`
Expected: `Task 3 測試通過：匯出整合處理、防呆與下載邏輯正確！`

- [ ] **Step 5: Commit changes**

```bash
git add test/export-report-integration.test.js dashboard/dashboard.html
git commit -m "feat: complete export report handler with validation and download trigger"
```

---

### Task 4: 全套測試回歸與端到端驗證 (Full Regression & E2E Verification)

**Files:**
- Test: `test/*.test.js`

- [ ] **Step 1: Run all backend and frontend test suites**

Run:
```bash
node test/direct-delivery-backend.test.js
node test/direct-delivery-frontend.test.js
node test/direct-delivery-integration.test.js
node test/exclude-egc-filter.test.js
node test/exclude-egc-integration.test.js
node test/exclude-resigned-vendor-backend.test.js
node test/exclude-resigned-vendor-integration.test.js
node test/work-location-backend.test.js
node test/work-location-frontend.test.js
node test/work-location-integration.test.js
node test/work-location-ui-fix.test.js
node test/export-report-frontend.test.js
node test/export-report-logic.test.js
node test/export-report-integration.test.js
```
Expected: All test suites PASS with exit code 0.

- [ ] **Step 2: Verify git status and clean working tree**

Run: `git status --short`
Expected: Working tree clean.

- [ ] **Step 3: Commit final integration milestone**

```bash
git commit --allow-empty -m "chore: verify export training report feature passes all regression tests"
```
