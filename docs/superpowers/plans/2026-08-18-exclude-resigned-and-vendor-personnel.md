# 後端資料層排除離職與廠商人員實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在學員訓練儀表板後端核心資料層（`dashboard/code.js`）全面排除狀態為「離職」、「委外廠商/委外」、「合作廠商/合作」之人員，確保全庫概況指標、學員清單與通知名單僅包含常態在勤受訓人員。

**Architecture:** 在 `dashboard/code.js` 定義 `DASHBOARD_EXCLUDED_PERSONNEL_STATUSES` 集合與 `isExcludedPersonnelStatus_` 檢查工具；在 `buildDashboardContext_` 與 `collectPersonnelStatusOptions_` 進行過濾；撰寫 Node.js 單元與整合測試驗證。

**Tech Stack:** Google Apps Script (GAS), Vanilla JavaScript, Node.js (用於測試驗證)。

## Global Constraints

- 排除狀態集合必須精準包含：`['離職', '委外', '委外廠商', '合作', '合作廠商']`。
- 不影響其他有效狀態（如 `在勤`、`在職`、`育嬰假`、`休假`、`留職停薪`、`外派人員`、`倫理委員會` 等）。
- 遵循繁體中文 (`zh-TW`) 介面與 2 空格縮排慣例。

---

### Task 1: 後端排除常數、檢查函式與資料載入管線過濾 (`dashboard/code.js`)

**Files:**
- Modify: `dashboard/code.js:10-30` (新增排除常數與 `isExcludedPersonnelStatus_` 函式)
- Modify: `dashboard/code.js:370-385` (`buildDashboardContext_` 人員迴圈過濾)
- Modify: `dashboard/code.js:435-450` (`collectPersonnelStatusOptions_` 選項過濾)
- Create: `test/exclude-resigned-vendor-backend.test.js`

**Interfaces:**
- Consumes: `personnelRows[i][2]` (人員主檔狀態)
- Produces:
  - `DASHBOARD_EXCLUDED_PERSONNEL_STATUSES` 常數集合
  - `isExcludedPersonnelStatus_(status)` -> 回傳布林值
  - `buildDashboardContext_()` 的 `learners` 與 `personnelStatusOptions` 不含排除狀態

- [ ] **Step 1: 撰寫後端狀態排除單元測試**

建立 `test/exclude-resigned-vendor-backend.test.js`：

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 1. 檢查常數與函式定義
assert(code.includes('DASHBOARD_EXCLUDED_PERSONNEL_STATUSES'), '必須定義 DASHBOARD_EXCLUDED_PERSONNEL_STATUSES');
const funcMatch = code.match(/function isExcludedPersonnelStatus_\([\s\S]*?\n\}/);
assert(funcMatch, '必須存在 isExcludedPersonnelStatus_ 函式');

const isExcluded = new Function(
  code.match(/const DASHBOARD_EXCLUDED_PERSONNEL_STATUSES = [\s\S]*?;\n/)[0] +
  funcMatch[0] +
  '; return isExcludedPersonnelStatus_;'
)();

// 2. 驗證排除狀態
const excludedCases = ['離職', '委外', '委外廠商', '合作', '合作廠商', ' 離職 ', '委外廠商 '];
excludedCases.forEach(st => {
  assert.strictEqual(isExcluded(st), true, `狀態 "${st}" 應被排除`);
});

// 3. 驗證保留狀態
const keepCases = ['在勤', '在職', '育嬰假', '休假', '留職停薪', '外派人員', '倫理委員會', ''];
keepCases.forEach(st => {
  assert.strictEqual(isExcluded(st), false, `狀態 "${st}" 應保留`);
});

console.log('Task 1 測試通過！');
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `node test/exclude-resigned-vendor-backend.test.js`
Expected: FAIL

- [ ] **Step 3: 修改 `dashboard/code.js` 實作**

1. 定義常數與檢查工具（置於 `dashboard/code.js` 常數區）：
```javascript
const DASHBOARD_EXCLUDED_PERSONNEL_STATUSES = new Set([
  '離職',
  '委外',
  '委外廠商',
  '合作',
  '合作廠商'
]);

function isExcludedPersonnelStatus_(status) {
  return DASHBOARD_EXCLUDED_PERSONNEL_STATUSES.has(String(status || '').trim());
}
```

2. 在 `buildDashboardContext_` 中過濾排除人員：
```javascript
  for (let i = 1; i < personnelRows.length; i += 1) {
    const email = normalizeEmail_(personnelRows[i][0]);
    if (!email) continue;
    const name = String(personnelRows[i][1] || '').trim();
    const personnelStatus = String(personnelRows[i][2] || '').trim();
    if (isExcludedPersonnelStatus_(personnelStatus)) continue;
    const assignment = assignmentSummaries.get(email) || createEmptyAssignmentSummary_();
```

3. 在 `collectPersonnelStatusOptions_` 中過濾排除狀態：
```javascript
function collectPersonnelStatusOptions_(personnelRows) {
  const seen = new Set();
  const options = [];
  for (let i = 1; i < personnelRows.length; i += 1) {
    const status = String(personnelRows[i][2] || '').trim();
    if (!status || isExcludedPersonnelStatus_(status) || seen.has(status)) continue;
    seen.add(status);
    options.push(status);
  }
  return options;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node test/exclude-resigned-vendor-backend.test.js`
Expected: `Task 1 測試通過！`

- [ ] **Step 5: 提交 Task 1 變更**

```bash
git add dashboard/code.js test/exclude-resigned-vendor-backend.test.js
git commit -m "feat: exclude resigned and vendor personnel from dashboard backend pipeline"
```

---

### Task 2: 全流程整合測試與全套件迴歸驗證

**Files:**
- Create: `test/exclude-resigned-vendor-integration.test.js`

- [ ] **Step 1: 撰寫資料管線整合測試腳本**

建立 `test/exclude-resigned-vendor-integration.test.js`：
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codeJs = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 1. 語法安全驗證
const script = new vm.Script(codeJs, { filename: 'dashboard/code.js' });
assert(script, 'code.js 語法無誤');

// 2. 模擬 collectPersonnelStatusOptions_
const collectFuncMatch = codeJs.match(/function collectPersonnelStatusOptions_\([\s\S]*?\n\}/);
const isExcludedMatch = codeJs.match(/function isExcludedPersonnelStatus_\([\s\S]*?\n\}/);
const constMatch = codeJs.match(/const DASHBOARD_EXCLUDED_PERSONNEL_STATUSES = [\s\S]*?;\n/);

const testScope = new Function(
  constMatch[0] +
  isExcludedMatch[0] +
  collectFuncMatch[0] +
  '; return { collectPersonnelStatusOptions_, isExcludedPersonnelStatus_ };'
)();

const mockRows = [
  ['信箱', '姓名', '狀態'],
  ['a@example.com', '在職員工', '在勤'],
  ['b@example.com', '育嬰同仁', '育嬰假'],
  ['c@example.com', '離職員工', '離職'],
  ['d@example.com', '委外人員', '委外廠商'],
  ['e@example.com', '合作人員', '合作']
];

const options = testScope.collectPersonnelStatusOptions_(mockRows);
assert.deepStrictEqual(options, ['在勤', '育嬰假'], '選項清單應排除離職、委外廠商與合作');

console.log('Task 2 整合測試驗證通過！');
```

- [ ] **Step 2: 執行整合測試與全套件驗證**

Run: `node test/exclude-resigned-vendor-integration.test.js`
Expected: `Task 2 整合測試驗證通過！`

- [ ] **Step 3: 執行全部 7 個測試套件確保無迴歸**

Run: `node test/direct-delivery-backend.test.js && node test/direct-delivery-frontend.test.js && node test/direct-delivery-integration.test.js && node test/exclude-egc-filter.test.js && node test/exclude-egc-integration.test.js && node test/exclude-resigned-vendor-backend.test.js && node test/exclude-resigned-vendor-integration.test.js`
Expected: All tests pass.

- [ ] **Step 4: 提交 Task 2 變更**

```bash
git add test/exclude-resigned-vendor-integration.test.js
git commit -m "test: add integration test suite for excluding resigned and vendor personnel"
```
