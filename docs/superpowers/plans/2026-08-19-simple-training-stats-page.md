# 簡易教育訓練即時統計頁面實作計畫 (Simple Training Stats Page Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立獨立簡易教育訓練即時統計頁面 (`stats.html`) 與後端資料管線，精準統計在勤與育嬰假人員完訓情況並保護同仁個人分數隱私。

**Architecture:** 在 `code.js` 的 `doGet(e)` 透過 `page=stats` 分流至 `stats.html`。後端 `getSimpleTrainingStats()` 讀取「人員主檔」篩選在勤/育嬰假且非 outside 人員，關聯「訓練紀錄」判定通過/未通過/未受訓狀態，完全過濾 E 欄分數。前端使用 Bootstrap 5 呈現 4 大 KPI 卡片、進度條、即時時鐘與焦點切換表格。

**Tech Stack:** Google Apps Script (JavaScript), HTML5, Bootstrap 5, FontAwesome 6, Node.js (for local unit tests)

## Global Constraints

- **人員主檔條件**：C 欄（index 2）必須為 `'在勤'` 或 `'育嬰假'`；H 欄（index 7）工作地點必須排除 `'outside'`（不分大小寫與空白）。
- **訓練紀錄關聯**：以 `使用者信箱`（A 欄 index 0 對應訓練紀錄 C 欄 index 2）為比對依據，檢查 F 欄（index 5）測驗結果。
- **隱私安全鐵則**：嚴格排除 E 欄（index 4）測驗分數，後端 Payload 與前端 DOM 均不得出現任何人的個人分數。
- **零侵入路由**：預設 `doGet({})` 必須維持載入 `index.html`，僅在 `e.parameter.page === 'stats'` 時載入 `stats.html`。

---

### Task 1: 後端資料管線與統計比對邏輯 (`code.js`)

**Files:**
- Create: `test/simple-stats-backend.test.js`
- Modify: `code.js`

**Interfaces:**
- Produces: `getSimpleTrainingStats()` 回傳 `{ success, generatedAt, courseTitle, summary, learners }` 物件，其中 `learners` 每筆資料格式為 `{ name, email, status, location, trainingStatus, trainingStatusLabel }`，不含 `score`。

- [ ] **Step 1: 撰寫後端資料管線與隱私防護單元測試**

Create `test/simple-stats-backend.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 載入 code.js 程式碼進行測試
const codePath = path.resolve(__dirname, '../code.js');
const code = fs.readFileSync(codePath, 'utf8');

// 建立模擬環境與待測函式執行環境
const sandbox = {
  console,
  Math,
  Date,
  Set,
  Map,
  Array,
  String,
  Number,
  Boolean,
  RegExp
};

// 提取並包裝待測核心函式
const evalContext = new Function(
  'sandbox',
  `with (sandbox) {
    ${code}
    return {
      normalizeEmail_,
      isEligiblePersonnelStatus_,
      isExcludedLocation_,
      buildSimpleTrainingStatsFromData_,
      resolveSimpleLearnerTrainingStatus_
    };
  }`
);

const {
  normalizeEmail_,
  isEligiblePersonnelStatus_,
  isExcludedLocation_,
  buildSimpleTrainingStatsFromData_,
  resolveSimpleLearnerTrainingStatus_
} = evalContext(sandbox);

// 1. 測試在勤狀態過濾
assert.strictEqual(isEligiblePersonnelStatus_('在勤'), true, '「在勤」應判定為符合資格');
assert.strictEqual(isEligiblePersonnelStatus_('育嬰假'), true, '「育嬰假」應判定為符合資格');
assert.strictEqual(isEligiblePersonnelStatus_(' 在勤 '), true, '帶空白的「在勤」應判定為符合資格');
assert.strictEqual(isEligiblePersonnelStatus_('離職'), false, '「離職」應排除');
assert.strictEqual(isEligiblePersonnelStatus_('委外廠商'), false, '「委外廠商」應排除');
assert.strictEqual(isEligiblePersonnelStatus_('合作'), false, '「合作」應排除');
assert.strictEqual(isEligiblePersonnelStatus_('留職停薪'), false, '「留職停薪」應排除');

// 2. 測試地點排除
assert.strictEqual(isExcludedLocation_('outside'), true, '「outside」應排除');
assert.strictEqual(isExcludedLocation_('Outside'), true, '大小寫「Outside」應排除');
assert.strictEqual(isExcludedLocation_(' OUTSIDE '), true, '帶空白大寫「OUTSIDE」應排除');
assert.strictEqual(isExcludedLocation_('南港總部'), false, '「南港總部」不應排除');
assert.strictEqual(isExcludedLocation_('台中駐站'), false, '「台中駐站」不應排除');
assert.strictEqual(isExcludedLocation_(''), false, '空白地點不應排除');

// 3. 測試測驗狀態判定
assert.strictEqual(resolveSimpleLearnerTrainingStatus_(true, 1), 'passed');
assert.strictEqual(resolveSimpleLearnerTrainingStatus_(false, 1), 'failed');
assert.strictEqual(resolveSimpleLearnerTrainingStatus_(false, 0), 'unattempted');

// 4. 測試整體統計與去識別化資料生成
const mockPersonnelRows = [
  ['使用者信箱', '姓名', '在勤狀態', '欄位D', '欄位E', '欄位F', '欄位G', '工作地點'],
  ['ming@example.com', '王小明', '在勤', '', '', '', '', '南港總部'],
  ['hua@example.com', '李小華', '育嬰假', '', '', '', '', '台中駐站'],
  ['outside_user@example.com', '陳外員', '在勤', '', '', '', '', 'outside'],
  ['resigned@example.com', '趙離職', '離職', '', '', '', '', '南港總部'],
  ['tong@example.com', '陳大同', '在勤', '', '', '', '', '高雄駐站'],
  ['failed_user@example.com', '林不及格', '在勤', '', '', '', '', '南港總部']
];

const mockTrainingRows = [
  ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  ['2026-08-18 10:00:00', '王小明', 'ming@example.com', '資安教育訓練', '90', '通過', 'BATCH-1', '10', '70'],
  ['2026-08-18 11:00:00', '林不及格', 'failed_user@example.com', '資安教育訓練', '60', '未通過', 'BATCH-2', '10', '70']
];

const result = buildSimpleTrainingStatsFromData_(mockPersonnelRows, mockTrainingRows);

assert.strictEqual(result.summary.totalEligible, 4, '符合條件應訓總人數應為 4 (排除 outside 與離職)');
assert.strictEqual(result.summary.passedCount, 1, '已通過人數應為 1 (王小明)');
assert.strictEqual(result.summary.failedCount, 1, '未通過人數應為 1 (林不及格)');
assert.strictEqual(result.summary.unattemptedCount, 2, '未受訓人數應為 2 (李小華, 陳大同)');
assert.strictEqual(result.summary.incompleteCount, 2, '未完成人數應為 3 (failedCount 1 + unattemptedCount 2 = 3)');
assert.strictEqual(result.summary.completionRate, '25.0%', '完成率應為 25.0% (1/4)');

// 5. 驗證隱私安全：所有 learner 均不含 score 欄位
result.learners.forEach((learner) => {
  assert.strictEqual(learner.hasOwnProperty('score'), false, `學員 ${learner.name} 不得包含 score 欄位`);
});

console.log('✓ 後端資料管線與隱私防護單元測試全數通過！');
```

- [ ] **Step 2: 執行測試並驗證失敗（TDD）**

Run:
```bash
node test/simple-stats-backend.test.js
```
Expected: FAIL（提示 `isEligiblePersonnelStatus_ is not a function` 或未定義）

- [ ] **Step 3: 在 `code.js` 實作資料管線與過濾函式**

Modify `code.js`:
新增 `isEligiblePersonnelStatus_`、`isExcludedLocation_`、`resolveSimpleLearnerTrainingStatus_`、`buildSimpleTrainingStatsFromData_` 以及公開的 `getSimpleTrainingStats()`。

```javascript
/**
 * 簡易統計頁面：在勤狀態白名單判斷
 */
const SIMPLE_STATS_ELIGIBLE_STATUSES = new Set(['在勤', '育嬰假']);

function isEligiblePersonnelStatus_(status) {
  return SIMPLE_STATS_ELIGIBLE_STATUSES.has(String(status || '').trim());
}

/**
 * 簡易統計頁面：工作地點排除判斷 (排除 outside)
 */
function isExcludedLocation_(location) {
  return String(location || '').trim().toLowerCase() === 'outside';
}

/**
 * 簡易統計頁面：學員測驗狀態判定
 */
function resolveSimpleLearnerTrainingStatus_(hasPassed, attemptCount) {
  if (hasPassed) return 'passed';
  if (attemptCount > 0) return 'failed';
  return 'unattempted';
}

function getSimpleLearnerStatusLabel_(status) {
  const labels = {
    passed: '通過',
    failed: '未通過',
    unattempted: '未受訓'
  };
  return labels[status] || '未受訓';
}

/**
 * 從人員主檔與訓練紀錄陣列計算簡易統計資料（不包含任何分數欄位）
 */
function buildSimpleTrainingStatsFromData_(personnelRows, trainingRows) {
  const quizByEmail = new Map();
  let defaultCourseTitle = '資安暨個資教育訓練';

  if (Array.isArray(trainingRows) && trainingRows.length > 1) {
    for (let i = 1; i < trainingRows.length; i += 1) {
      const email = normalizeEmail_(trainingRows[i][2]);
      if (!email) continue;
      const courseTitle = String(trainingRows[i][3] || '').trim();
      const result = String(trainingRows[i][5] || '').trim();
      if (courseTitle && !defaultCourseTitle) defaultCourseTitle = courseTitle;

      if (!quizByEmail.has(email)) {
        quizByEmail.set(email, {
          hasPassed: false,
          attemptCount: 0
        });
      }
      const record = quizByEmail.get(email);
      record.attemptCount += 1;
      if (result === '通過') {
        record.hasPassed = true;
      }
    }
  }

  const learners = [];
  let totalEligible = 0;
  let passedCount = 0;
  let failedCount = 0;
  let unattemptedCount = 0;

  if (Array.isArray(personnelRows) && personnelRows.length > 1) {
    for (let i = 1; i < personnelRows.length; i += 1) {
      const email = normalizeEmail_(personnelRows[i][0]);
      if (!email) continue;
      const name = String(personnelRows[i][1] || '').trim();
      const status = String(personnelRows[i][2] || '').trim();
      const location = String(personnelRows[i][7] || '').trim();

      // 篩選：C 欄為在勤/育嬰假 且 H 欄非 outside
      if (!isEligiblePersonnelStatus_(status)) continue;
      if (isExcludedLocation_(location)) continue;

      totalEligible += 1;
      const quiz = quizByEmail.get(email) || { hasPassed: false, attemptCount: 0 };
      const trainingStatus = resolveSimpleLearnerTrainingStatus_(quiz.hasPassed, quiz.attemptCount);
      const trainingStatusLabel = getSimpleLearnerStatusLabel_(trainingStatus);

      if (trainingStatus === 'passed') {
        passedCount += 1;
      } else if (trainingStatus === 'failed') {
        failedCount += 1;
      } else {
        unattemptedCount += 1;
      }

      learners.push({
        name,
        email,
        status,
        location,
        trainingStatus,
        trainingStatusLabel
      });
    }
  }

  // 排序：未完成優先 (failed -> unattempted -> passed)，同狀態依姓名排序
  const statusSortWeight = { failed: 1, unattempted: 2, passed: 3 };
  learners.sort((a, b) => {
    const weightA = statusSortWeight[a.trainingStatus] || 99;
    const weightB = statusSortWeight[b.trainingStatus] || 99;
    if (weightA !== weightB) return weightA - weightB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  });

  const incompleteCount = failedCount + unattemptedCount;
  const completionPercent = totalEligible > 0
    ? Math.round((passedCount / totalEligible) * 1000) / 10
    : 0;
  const completionRate = `${completionPercent.toFixed(1)}%`;

  return {
    success: true,
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'),
    courseTitle: defaultCourseTitle,
    summary: {
      totalEligible,
      passedCount,
      failedCount,
      unattemptedCount,
      incompleteCount,
      completionRate,
      completionPercent
    },
    learners
  };
}

/**
 * 前端 API：獲取簡易教育訓練即時統計數據
 */
function getSimpleTrainingStats() {
  try {
    const masterSS = getMasterSpreadsheet_();
    const personnelSheet = getRequiredSheet_(masterSS, '人員主檔');
    const trainingSheet = getRequiredSheet_(masterSS, QUIZ_CONFIG.trainingRecordSheetName);

    const personnelRows = personnelSheet.getDataRange().getDisplayValues();
    const trainingRows = trainingSheet.getDataRange().getDisplayValues();

    return buildSimpleTrainingStatsFromData_(personnelRows, trainingRows);
  } catch (error) {
    console.error('獲取簡易教育訓練統計失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法載入統計數據',
      summary: {
        totalEligible: 0,
        passedCount: 0,
        failedCount: 0,
        unattemptedCount: 0,
        incompleteCount: 0,
        completionRate: '0.0%',
        completionPercent: 0
      },
      learners: []
    };
  }
}
```

- [ ] **Step 4: 重新執行單元測試驗證通過**

Run:
```bash
node test/simple-stats-backend.test.js
```
Expected: PASS (`✓ 後端資料管線與隱私防護單元測試全數通過！`)

- [ ] **Step 5: 提交程式碼**

```bash
git add test/simple-stats-backend.test.js code.js
git commit -m "feat: add backend data pipeline for simple training stats"
```

---

### Task 2: Web App 路由分流與整合測試 (`code.js` / `doGet`)

**Files:**
- Create: `test/simple-stats-routing.test.js`
- Modify: `code.js`

**Interfaces:**
- Produces: `doGet(e)` 支援 `e.parameter.page === 'stats'` 載入 `stats` 頁面模板；預設載入 `index` 頁面模板。

- [ ] **Step 1: 撰寫路由單元與整合測試**

Create `test/simple-stats-routing.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codePath = path.resolve(__dirname, '../code.js');
const code = fs.readFileSync(codePath, 'utf8');

// 檢查 doGet 邏輯
assert(code.includes("e.parameter.page") || code.includes("parameter.page"), 'doGet 必須檢查 e.parameter.page');
assert(code.includes("createTemplateFromFile('stats')"), '當 page 為 stats 時必須載入 stats.html 模板');
assert(code.includes("createTemplateFromFile('index')"), '預設情況下必須載入 index.html 模板');

console.log('✓ 路由分流規格檢查通過！');
```

- [ ] **Step 2: 執行測試確認需更新 `doGet`**

Run:
```bash
node test/simple-stats-routing.test.js
```

- [ ] **Step 3: 更新 `code.js` 中的 `doGet` 實作**

Modify `code.js`:
```javascript
// 1. 發佈為 Web App 時的進入點 (支援 ?page=stats 簡易統計頁面)
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

- [ ] **Step 4: 執行測試驗證通過**

Run:
```bash
node test/simple-stats-routing.test.js
```
Expected: PASS (`✓ 路由分流規格檢查通過！`)

- [ ] **Step 5: 提交程式碼**

```bash
git add test/simple-stats-routing.test.js code.js
git commit -m "feat: add stats route in doGet entry point"
```

---

### Task 3: 建立簡易統計前端介面 (`stats.html`) 與前端互動測試

**Files:**
- Create: `stats.html`
- Create: `test/simple-stats-frontend.test.js`

**Interfaces:**
- Produces: `stats.html` 單頁應用介面，提供即時時鐘、4 大 KPI 卡片、進度條、Tab 切換（待完成名單 / 全部名單）、即時關鍵字搜尋與定期自動更新。

- [ ] **Step 1: 建立前端靜態結構與互動邏輯測試**

Create `test/simple-stats-frontend.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '../stats.html');
assert(fs.existsSync(htmlPath), 'stats.html 檔案必須存在');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. 檢查關鍵 UI 元素
assert(html.includes('id="digital-clock"'), '必須包含即時時鐘容器 #digital-clock');
assert(html.includes('id="percentage-value"'), '必須包含完成率容器 #percentage-value');
assert(html.includes('id="progress-bar"'), '必須包含進度條 #progress-bar');
assert(html.includes('id="total-count"'), '必須包含應訓總人數容器 #total-count');
assert(html.includes('id="passed-count"'), '必須包含已通過人數容器 #passed-count');
assert(html.includes('id="incomplete-count"'), '必須包含待完成人數容器 #incomplete-count');
assert(html.includes('id="search-input"'), '必須包含關鍵字搜尋框 #search-input');
assert(html.includes('id="tab-incomplete"'), '必須包含待完成名單 Tab #tab-incomplete');
assert(html.includes('id="tab-all"'), '必須包含全部名單 Tab #tab-all');
assert(html.includes('id="learners-table-body"'), '必須包含人員清單 tbody #learners-table-body');
assert(html.includes('getSimpleTrainingStats'), '前端必須調用 google.script.run.getSimpleTrainingStats');

// 2. 驗證隱私安全：HTML 中不包含任何分數欄位標題
assert(!html.includes('<th>分數</th>') && !html.includes('<th>測驗分數</th>'), '表格標題不得包含分數欄位');

console.log('✓ 前端介面與互動結構測試通過！');
```

- [ ] **Step 2: 建立 `stats.html` 前端檔案**

Create `stats.html`:
```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>即時課程統計儀表板</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root {
      --primary-color: #0f766e;
      --primary-hover: #0d635d;
      --bg-color: #f8f9fa;
      --card-radius: 16px;
    }
    body {
      background-color: var(--bg-color);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans TC", Arial, sans-serif;
      color: #1e293b;
    }
    .card {
      border: none;
      border-radius: var(--card-radius);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .card-kpi {
      position: relative;
      overflow: hidden;
    }
    .card-icon {
      font-size: 2.8rem;
      opacity: 0.18;
      position: absolute;
      right: 18px;
      top: 18px;
    }
    .card-value {
      font-size: 2.2rem;
      font-weight: 800;
      line-height: 1.1;
      margin: 8px 0 0 0;
    }
    .progress-bar-custom {
      background-color: var(--primary-color);
    }
    .badge-status {
      font-size: 0.85rem;
      padding: 6px 12px;
      border-radius: 999px;
      font-weight: 600;
    }
    .btn-refresh {
      border-radius: 999px;
      padding: 6px 16px;
      font-weight: 600;
    }
    .nav-pills .nav-link {
      border-radius: 999px;
      padding: 8px 20px;
      font-weight: 600;
      color: #64748b;
    }
    .nav-pills .nav-link.active {
      background-color: var(--primary-color);
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="container py-4">
    <!-- Header -->
    <header class="pb-3 mb-4 border-bottom d-flex flex-wrap justify-content-between align-items-center gap-3">
      <div>
        <h1 class="h2 mb-1 fw-bold text-dark">
          <i class="fas fa-chart-line text-success me-2"></i>即時課程統計儀表板
        </h1>
        <p class="text-secondary small mb-0">臺灣人體生物資料庫 ｜ 在勤與育嬰假人員完訓追蹤</p>
      </div>
      <div class="d-flex align-items-center gap-3">
        <div id="digital-clock" class="fs-5 text-secondary fw-semibold">--:--:--</div>
        <button id="btn-refresh" class="btn btn-outline-secondary btn-refresh" onclick="updateDashboard()">
          <i class="fas fa-sync-alt me-1" id="refresh-icon"></i>重新整理
        </button>
      </div>
    </header>

    <!-- KPI Summary Row -->
    <div class="row g-3 mb-4">
      <!-- 課程完成率 -->
      <div class="col-12 col-sm-6 col-lg-3">
        <div class="card h-100 card-kpi bg-white p-3">
          <div class="card-body p-1 d-flex flex-column justify-content-between">
            <div>
              <span class="text-muted small fw-bold">課程完成率</span>
              <p class="card-value text-primary" id="percentage-value">--%</p>
            </div>
            <i class="fas fa-chart-pie card-icon text-primary"></i>
            <div class="progress mt-3" style="height: 10px;">
              <div id="progress-bar" class="progress-bar progress-bar-striped progress-bar-animated progress-bar-custom" role="progressbar" style="width: 0%;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 應訓總人數 -->
      <div class="col-12 col-sm-6 col-lg-3">
        <div class="card h-100 card-kpi bg-white p-3">
          <div class="card-body p-1">
            <span class="text-muted small fw-bold">應訓總人數</span>
            <p class="card-value text-dark" id="total-count">--</p>
            <i class="fas fa-users card-icon text-dark"></i>
            <p class="text-muted small mt-2 mb-0">排除 outside 地點同仁</p>
          </div>
        </div>
      </div>

      <!-- 已通過人數 -->
      <div class="col-12 col-sm-6 col-lg-3">
        <div class="card h-100 card-kpi bg-white p-3">
          <div class="card-body p-1">
            <span class="text-muted small fw-bold">已通過人數</span>
            <p class="card-value text-success" id="passed-count">--</p>
            <i class="fas fa-check-circle card-icon text-success"></i>
            <p class="text-muted small mt-2 mb-0">已達及格門檻</p>
          </div>
        </div>
      </div>

      <!-- 待完成人數 -->
      <div class="col-12 col-sm-6 col-lg-3">
        <div class="card h-100 card-kpi bg-white p-3">
          <div class="card-body p-1">
            <span class="text-muted small fw-bold">待完成人數</span>
            <p class="card-value text-danger" id="incomplete-count">--</p>
            <i class="fas fa-user-clock card-icon text-danger"></i>
            <p class="text-muted small mt-2 mb-0">包含未通過與未受訓</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Table Card -->
    <div class="card bg-white shadow-sm">
      <div class="card-header bg-white border-0 pt-4 pb-2 px-4">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
          <!-- Tabs -->
          <ul class="nav nav-pills" id="stats-tabs">
            <li class="nav-item">
              <button class="nav-link active" id="tab-incomplete" onclick="switchTab('incomplete')">
                <i class="fas fa-exclamation-circle me-1"></i>待完成名單 (<span id="tab-incomplete-badge">0</span>)
              </button>
            </li>
            <li class="nav-item">
              <button class="nav-link" id="tab-all" onclick="switchTab('all')">
                <i class="fas fa-list me-1"></i>全部應訓名單 (<span id="tab-all-badge">0</span>)
              </button>
            </li>
          </ul>

          <!-- Search Box -->
          <div class="input-group" style="max-width: 280px;">
            <span class="input-group-text bg-light border-end-0"><i class="fas fa-search text-muted"></i></span>
            <input type="text" id="search-input" class="form-control border-start-0 ps-0" placeholder="搜尋姓名、信箱、地點..." oninput="handleSearch()">
          </div>
        </div>
      </div>

      <div class="card-body px-4 pb-4">
        <div class="table-responsive mt-2">
          <table class="table table-hover align-middle">
            <thead class="table-light">
              <tr>
                <th scope="col" style="width: 60px;">#</th>
                <th scope="col">姓名</th>
                <th scope="col">使用者信箱</th>
                <th scope="col">在勤狀態</th>
                <th scope="col">工作地點</th>
                <th scope="col" class="text-center" style="width: 120px;">測驗結果</th>
              </tr>
            </thead>
            <tbody id="learners-table-body">
              <tr>
                <td colspan="6" class="text-center py-5 text-muted">
                  <div class="spinner-border text-primary spinner-border-sm me-2" role="status"></div>
                  正在載入最新統計數據...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <footer class="text-center text-muted small pt-4 pb-3">
      數據每 60 秒自動更新 ｜ 最後同步時間：<span id="last-updated-time">--</span>
    </footer>
  </div>

  <script>
    let state = {
      currentTab: 'incomplete', // 'incomplete' | 'all'
      searchKeyword: '',
      allLearners: [],
      summary: null,
      isLoading: false
    };

    function updateClock() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const formatted = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
      const clockEl = document.getElementById('digital-clock');
      if (clockEl) clockEl.textContent = formatted;
    }

    function switchTab(tab) {
      state.currentTab = tab;
      document.getElementById('tab-incomplete').classList.toggle('active', tab === 'incomplete');
      document.getElementById('tab-all').classList.toggle('active', tab === 'all');
      renderTable();
    }

    function handleSearch() {
      state.searchKeyword = (document.getElementById('search-input').value || '').trim().toLowerCase();
      renderTable();
    }

    function updateDashboard() {
      if (state.isLoading) return;
      state.isLoading = true;
      const refreshIcon = document.getElementById('refresh-icon');
      if (refreshIcon) refreshIcon.classList.add('fa-spin');

      google.script.run
        .withSuccessHandler(handleDataSuccess)
        .withFailureHandler(handleDataError)
        .getSimpleTrainingStats();
    }

    function handleDataSuccess(res) {
      state.isLoading = false;
      const refreshIcon = document.getElementById('refresh-icon');
      if (refreshIcon) refreshIcon.classList.remove('fa-spin');

      if (!res || !res.success) {
        handleDataError(res || { message: '無法取得統計數據' });
        return;
      }

      state.allLearners = res.learners || [];
      state.summary = res.summary || {};

      // 1. 更新 KPI
      document.getElementById('percentage-value').textContent = state.summary.completionRate || '0.0%';
      const progressBar = document.getElementById('progress-bar');
      const percentVal = state.summary.completionPercent || 0;
      progressBar.style.width = percentVal + '%';
      progressBar.setAttribute('aria-valuenow', percentVal);

      document.getElementById('total-count').textContent = state.summary.totalEligible || 0;
      document.getElementById('passed-count').textContent = state.summary.passedCount || 0;
      document.getElementById('incomplete-count').textContent = state.summary.incompleteCount || 0;

      // 2. 更新 Tab Badge 數字
      const incompleteCount = state.allLearners.filter(l => l.trainingStatus !== 'passed').length;
      document.getElementById('tab-incomplete-badge').textContent = incompleteCount;
      document.getElementById('tab-all-badge').textContent = state.allLearners.length;
      document.getElementById('last-updated-time').textContent = res.generatedAt || '--';

      // 3. 渲染表格
      renderTable();
    }

    function handleDataError(error) {
      state.isLoading = false;
      const refreshIcon = document.getElementById('refresh-icon');
      if (refreshIcon) refreshIcon.classList.remove('fa-spin');

      const tbody = document.getElementById('learners-table-body');
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">
        <i class="fas fa-exclamation-triangle me-2"></i>載入失敗：${escapeHtml(error && error.message ? error.message : String(error))}
      </td></tr>`;
    }

    function renderTable() {
      const tbody = document.getElementById('learners-table-body');
      let filtered = state.allLearners.slice();

      // Tab 過濾
      if (state.currentTab === 'incomplete') {
        filtered = filtered.filter(l => l.trainingStatus !== 'passed');
      }

      // 關鍵字搜尋
      if (state.searchKeyword) {
        filtered = filtered.filter(l => {
          const haystack = `${l.name} ${l.email} ${l.location} ${l.status}`.toLowerCase();
          return haystack.includes(state.searchKeyword);
        });
      }

      if (filtered.length === 0) {
        if (state.currentTab === 'incomplete' && !state.searchKeyword) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center text-success py-5">
            <i class="fas fa-award fa-2x mb-2 d-block"></i>
            <strong>太棒了！所有應訓人員皆已順利通過課程！</strong>
          </td></tr>`;
        } else {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">查無符合條件之人員</td></tr>`;
        }
        return;
      }

      let html = '';
      filtered.forEach((learner, index) => {
        let badgeHtml = '';
        if (learner.trainingStatus === 'passed') {
          badgeHtml = '<span class="badge bg-success badge-status"><i class="fas fa-check me-1"></i>通過</span>';
        } else if (learner.trainingStatus === 'failed') {
          badgeHtml = '<span class="badge bg-danger badge-status"><i class="fas fa-times me-1"></i>未通過</span>';
        } else {
          badgeHtml = '<span class="badge bg-secondary badge-status"><i class="fas fa-minus me-1"></i>未受訓</span>';
        }

        html += `<tr>
          <th scope="row" class="text-muted small">${index + 1}</th>
          <td class="fw-semibold">${escapeHtml(learner.name)}</td>
          <td class="text-secondary small">${escapeHtml(learner.email)}</td>
          <td><span class="badge bg-light text-dark border">${escapeHtml(learner.status)}</span></td>
          <td><span class="text-muted small"><i class="fas fa-map-marker-alt text-danger me-1"></i>${escapeHtml(learner.location || '未標註')}</span></td>
          <td class="text-center">${badgeHtml}</td>
        </tr>`;
      });

      tbody.innerHTML = html;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    document.addEventListener('DOMContentLoaded', () => {
      updateClock();
      setInterval(updateClock, 1000);
      updateDashboard();
      // 每 60 秒自動更新
      setInterval(updateDashboard, 60000);
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: 執行前端介面與結構測試**

Run:
```bash
node test/simple-stats-frontend.test.js
```
Expected: PASS (`✓ 前端介面與互動結構測試通過！`)

- [ ] **Step 4: 提交程式碼**

```bash
git add stats.html test/simple-stats-frontend.test.js
git commit -m "feat: add stats.html simple training statistics dashboard"
```

---

### Task 4: 全系統整合驗證與既有測試回歸測試

**Files:**
- Test all: `test/*.test.js`

- [ ] **Step 1: 執行所有既有與新增測試套件**

Run:
```bash
node test/simple-stats-backend.test.js
node test/simple-stats-routing.test.js
node test/simple-stats-frontend.test.js
node test/exclude-resigned-vendor-backend.test.js
node test/exclude-resigned-vendor-integration.test.js
node test/work-location-backend.test.js
node test/work-location-frontend.test.js
node test/work-location-integration.test.js
node test/direct-delivery-backend.test.js
node test/direct-delivery-frontend.test.js
node test/direct-delivery-integration.test.js
node test/export-report-frontend.test.js
node test/export-report-integration.test.js
node test/export-report-logic.test.js
```
Expected: ALL PASS with exit code 0.

- [ ] **Step 2: 檢查 git status 與 diff**

Run:
```bash
git status --short
```
Expected: 工作目錄乾淨無未追蹤或未提交的檔案。
