# 工作地點多選/單選篩選與明細整合實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在學員訓練儀表板後端讀取人員主檔 H 欄位「工作地點」（`location`），並在前端實作多選下拉篩選元件、搜尋整合與學員表格地點標註，支援單選、多選與重設還原。

**Architecture:** 在 `dashboard/code.js` 的 `buildDashboardContext_` 萃取 `personnelRows[i][7]` 存入 `learner.location`；在 `dashboard/dashboard.html` 建立多選下拉元件（`#location-multiselect-container`），支援 Checkbox 清單與動態摘要標籤；在 `applyFilters` 支援 `locations` 多選陣列比對與關鍵字搜尋；在學員表格呈現地點次標籤。

**Tech Stack:** Google Apps Script (GAS), Vanilla JavaScript, HTML5/CSS, Node.js (用於測試驗證)。

## Global Constraints

- 人員主檔 H 欄位對應 0-based 索引 7 (`personnelRows[i][7]`)。
- 篩選支援：不選（全部地點）、單選（單一地點）、多選（多個地點聯集）。
- 遵循繁體中文 (`zh-TW`) 介面與 2 空格縮排慣例。

---

### Task 1: 後端人員主檔 H 欄位工作地點讀取與封裝 (`dashboard/code.js`)

**Files:**
- Modify: `dashboard/code.js:370-415` (`buildDashboardContext_` 人員資料封裝)
- Create: `test/work-location-backend.test.js`

**Interfaces:**
- Consumes: `personnelRows[i][7]` (人員主檔 H 欄工作地點)
- Produces: `learner.location` 字串屬性

- [ ] **Step 1: 撰寫後端工作地點讀取單元測試**

建立 `test/work-location-backend.test.js`：

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 檢查 buildDashboardContext_ 是否有讀取 personnelRows[i][7]
assert(code.includes('personnelRows[i][7]'), 'buildDashboardContext_ 必須讀取 personnelRows[i][7] (H 欄)');
assert(code.includes('location,'), 'learners 陣列物件中必須包含 location 屬性');

console.log('Task 1 測試通過！');
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `node test/work-location-backend.test.js`
Expected: FAIL

- [ ] **Step 3: 修改 `dashboard/code.js` 實作**

在 `buildDashboardContext_` 迴圈中加入：
```javascript
    const location = String(personnelRows[i][7] || '').trim();
```
並在 `learners.push({ ... })` 物件中加入：
```javascript
      location,
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node test/work-location-backend.test.js`
Expected: `Task 1 測試通過！`

- [ ] **Step 5: 提交 Task 1 變更**

```bash
git add dashboard/code.js test/work-location-backend.test.js
git commit -m "feat: extract work location from personnel sheet column H in backend"
```

---

### Task 2: 前端多選下拉元件、篩選與表格整合 (`dashboard/dashboard.html`)

**Files:**
- Modify: `dashboard/dashboard.html:450-550` (新增多選下拉 CSS 樣式)
- Modify: `dashboard/dashboard.html:1030-1045` (新增工作地點多選 HTML 結構)
- Modify: `dashboard/dashboard.html:1130-1140` (`state.filters` 加入 `locations: []`)
- Modify: `dashboard/dashboard.html:1300-1370` (`populateLocationFilter`、`applyFilters`、`renderLearnerTable`)
- Create: `test/work-location-frontend.test.js`

**Interfaces:**
- Consumes: `learner.location`
- Produces:
  - `#location-multiselect-container` UI 元件
  - `state.filters.locations`
  - `populateLocationFilter(learners)`

- [ ] **Step 1: 撰寫前端多選元件單元測試**

建立 `test/work-location-frontend.test.js`：

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查 HTML 結構
assert(html.includes('id="location-multiselect-container"'), '必須包含 location-multiselect-container');
assert(html.includes('id="location-selected-summary"'), '必須包含 location-selected-summary');
assert(html.includes('locations: []'), 'state.filters 預設 locations 必須為空陣列');

// 2. 檢查 applyFilters 與 searchHaystack 是否整合 location
assert(html.includes('state.filters.locations.includes(learner.location)'), 'applyFilters 需比對 locations');
assert(html.includes('learner.location'), 'searchHaystack 需包含 learner.location');

// 3. 檢查表格呈現是否包含地點標註
assert(html.includes('📍'), '學員明細表格需包含地點圖示標籤');

console.log('Task 2 測試通過！');
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `node test/work-location-frontend.test.js`
Expected: FAIL

- [ ] **Step 3: 修改 `dashboard/dashboard.html` 實作**

1. 在 `<style>` 中加入多選下拉元件樣式：
```css
    .custom-multiselect {
      position: relative;
    }
    .multiselect-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 40px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: #ffffff;
      cursor: pointer;
      font-size: 14px;
      user-select: none;
    }
    .multiselect-box:focus {
      outline: 2px solid var(--primary);
    }
    .multiselect-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 50;
      margin-top: 4px;
      max-height: 240px;
      overflow-y: auto;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      padding: 6px;
    }
    .multiselect-option-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .multiselect-option-item:hover {
      background: #f1f5f9;
    }
    .cell-location {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 1px 6px;
      background: #f1f5f9;
      border-radius: 4px;
      color: #475569;
      font-size: 12px;
      margin-top: 3px;
    }
```

2. 在 `.filters-grid` 加入 HTML 結構：
```html
            <div class="field custom-multiselect" id="location-multiselect-container">
              <label>工作地點</label>
              <div class="multiselect-box" id="location-dropdown-toggle" tabindex="0">
                <span class="multiselect-label" id="location-selected-summary">全部地點</span>
                <span class="multiselect-arrow">▾</span>
              </div>
              <div class="multiselect-dropdown hidden" id="location-dropdown-panel">
                <div class="multiselect-options" id="location-options-list"></div>
              </div>
            </div>
```

3. 更新 `state.filters`：
```javascript
      filters: {
        search: '',
        status: '',
        unit: '',
        locations: [],
        incompleteOnly: false,
        excludeEgc: true
      },
```

4. 實作 `populateLocationFilter` 與下拉事件邏輯：
```javascript
    function populateLocationFilter(learners) {
      const optionsList = document.getElementById('location-options-list');
      const uniqueLocations = Array.from(new Set(
        learners.map((l) => String(l.location || '').trim()).filter(Boolean)
      )).sort((a, b) => a.localeCompare(b, 'zh-Hant'));

      optionsList.innerHTML = '';
      uniqueLocations.forEach((loc) => {
        const item = document.createElement('label');
        item.className = 'multiselect-option-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = loc;
        checkbox.checked = state.filters.locations.includes(loc);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            if (!state.filters.locations.includes(loc)) state.filters.locations.push(loc);
          } else {
            state.filters.locations = state.filters.locations.filter((item) => item !== loc);
          }
          updateLocationSummaryLabel();
          renderDashboard();
        });
        item.appendChild(checkbox);
        item.appendChild(document.createTextNode(loc));
        optionsList.appendChild(item);
      });
      updateLocationSummaryLabel();
    }

    function updateLocationSummaryLabel() {
      const summaryEl = document.getElementById('location-selected-summary');
      const count = state.filters.locations.length;
      if (count === 0) {
        summaryEl.textContent = '全部地點';
      } else if (count === 1) {
        summaryEl.textContent = state.filters.locations[0];
      } else if (count === 2) {
        summaryEl.textContent = `${state.filters.locations[0]}、${state.filters.locations[1]} (${count})`;
      } else {
        summaryEl.textContent = `${state.filters.locations[0]}、${state.filters.locations[1]} +${count - 2} (${count})`;
      }
    }
```

5. 在 `bindEvents` 中綁定下拉收合與點擊外部關閉：
```javascript
      document.getElementById('location-dropdown-toggle').addEventListener('click', (event) => {
        event.stopPropagation();
        document.getElementById('location-dropdown-panel').classList.toggle('hidden');
      });
      document.addEventListener('click', (event) => {
        const container = document.getElementById('location-multiselect-container');
        if (container && !container.contains(event.target)) {
          document.getElementById('location-dropdown-panel').classList.add('hidden');
        }
      });
```

6. 更新 `applyFilters`、`resetFilters` 與 `renderLearnerTable`：
在 `applyFilters` 中：
```javascript
        if (state.filters.locations.length > 0 && !state.filters.locations.includes(learner.location)) return false;

        const searchHaystack = [
          learner.name,
          learner.email,
          learner.location,
          learner.assignmentOrgName,
          learner.assignmentTitle,
          learner.assignmentLabel
        ].join(' ').toLowerCase();
```
在 `resetFilters` 中：
```javascript
      state.filters.locations = [];
      const checkboxes = document.querySelectorAll('#location-options-list input[type="checkbox"]');
      checkboxes.forEach((cb) => { cb.checked = false; });
      updateLocationSummaryLabel();
```
在 `renderLearnerTable` 單位職務單元格中：
```javascript
        const locationBadge = learner.location
          ? `<div class="cell-location">📍 ${escapeHtml(learner.location)}</div>`
          : '';
```
並放入單元格模板中。

- [ ] **Step 4: 執行測試確認通過**

Run: `node test/work-location-frontend.test.js`
Expected: `Task 2 測試通過！`

- [ ] **Step 5: 提交 Task 2 變更**

```bash
git add dashboard/dashboard.html test/work-location-frontend.test.js
git commit -m "feat: add work location multi-select filter and table badge integration in frontend"
```

---

### Task 3: 全流程整合測試與全套件迴歸驗證

**Files:**
- Create: `test/work-location-integration.test.js`

- [ ] **Step 1: 撰寫全流程多選篩選整合測試腳本**

建立 `test/work-location-integration.test.js`：
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codeJs = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 語法安全驗證
const script = new vm.Script(codeJs, { filename: 'dashboard/code.js' });
assert(script, 'code.js 語法無誤');

// 2. 模擬多選篩選
const sampleLearners = [
  { name: '王大明', location: '南港總部', status: 'completed' },
  { name: '李小華', location: '台大醫院', status: 'in_progress' },
  { name: '張小美', location: '台中駐站', status: 'not_started' },
  { name: '陳大文', location: '高雄駐站', status: 'completed' }
];

// 單選南港總部
const filteredSingle = sampleLearners.filter(l => ['南港總部'].includes(l.location));
assert.strictEqual(filteredSingle.length, 1);

// 多選南港 + 台大
const filteredMulti = sampleLearners.filter(l => ['南港總部', '台大醫院'].includes(l.location));
assert.strictEqual(filteredMulti.length, 2);

// 不限（空陣列）
const filterLocations = [];
const filteredAll = sampleLearners.filter(l => filterLocations.length === 0 || filterLocations.includes(l.location));
assert.strictEqual(filteredAll.length, 4);

console.log('Task 3 整合測試驗證通過！');
```

- [ ] **Step 2: 執行整合測試**

Run: `node test/work-location-integration.test.js`
Expected: `Task 3 整合測試驗證通過！`

- [ ] **Step 3: 執行全部 9 個測試套件確保全系統無迴歸**

Run: `node test/direct-delivery-backend.test.js && node test/direct-delivery-frontend.test.js && node test/direct-delivery-integration.test.js && node test/exclude-egc-filter.test.js && node test/exclude-egc-integration.test.js && node test/exclude-resigned-vendor-backend.test.js && node test/exclude-resigned-vendor-integration.test.js && node test/work-location-backend.test.js && node test/work-location-frontend.test.js && node test/work-location-integration.test.js`
Expected: All tests pass.

- [ ] **Step 4: 提交 Task 3 變更**

```bash
git add test/work-location-integration.test.js
git commit -m "test: add integration test suite for work location multi-select filter"
```
