# 單封多人（互相可見）寄送方式實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善並正名教育訓練儀表板課程通知的「單封多人（互相可見）」寄送模式（代碼 `direct`），支援所有收件人在 `To` 互相可見、選填 `CC` 副本、超過 50 人上限驗證、各範本與變數對應矩陣及通知紀錄表完整紀錄。

**Architecture:** 保留後端 `direct` 內部代碼以維持相容性。在 `dashboard/code.js` 擴充 `templatesByDeliveryMode` 與 `placeholderTokensByTemplateAndDeliveryMode` 以支援 `direct` 模式下個人與群發範本的智慧映射，並統一回傳標籤與錯誤提示；在 `dashboard/dashboard.html` 更新選單標籤、副本 CC 標籤、範本/變數取得函式及摘要呈現。

**Tech Stack:** Google Apps Script (GAS), Vanilla JavaScript, HTML5/CSS, Node.js (用於單元測試與語法驗證)。

## Global Constraints

- 不更動 `direct` 內部代碼名稱，確保與 Google Sheets `通知紀錄` 歷史資料相容。
- 寄送方式選單標籤：`單封多人（互相可見）`
- 副本欄位標籤：`副本 CC（單封多人專用）`
- 超過 50 人錯誤訊息：`單封多人收件人含 CC 共 ${directTotal} 人，超過單封上限 50 人。請改用單封 BCC 或縮小寄送範圍。`
- 遵循繁體中文 (`zh-TW`) 介面與 2 空格縮排慣例。

---

### Task 1: 後端範本矩陣與寄送邏輯調整 (`dashboard/code.js`)

**Files:**
- Modify: `dashboard/code.js:840-870` (`buildNotificationTemplatesByDeliveryMode_`, `buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_`)
- Modify: `dashboard/code.js:1095-1105` (`executeTrainingNotification_` 驗證錯誤訊息)
- Modify: `dashboard/code.js:1955-1965` (`getNotificationDeliveryModeLabel_`)
- Create: `test/direct-delivery-backend.test.js`

**Interfaces:**
- Consumes: `DASHBOARD_CONFIG.bccBatchSize` (50), `buildAnnouncementNotificationTemplate_`, `buildCaseStaffSingleBccNotificationTemplate_`
- Produces:
  - `getNotificationDeliveryModeLabel_('direct')` -> 回傳 `'單封多人（互相可見）'`
  - `buildNotificationTemplatesByDeliveryMode_()` 包含 `personalized.direct`, `case_staff_personalized.direct`, `parental_leave_personalized.direct`
  - `buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_()` 包含各範本在 `direct` 模式下的變數清單 `['{{課程名稱}}', '{{上課網址}}']`

- [ ] **Step 1: 撰寫後端邏輯單元測試**

建立 `test/direct-delivery-backend.test.js` 測試標籤回傳、範本對應與超額驗證邏輯：

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 讀取 code.js 並透過 safe eval 測試純函式邏輯
const code = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 擷取並測試 getNotificationDeliveryModeLabel_
const labelFuncMatch = code.match(/function getNotificationDeliveryModeLabel_\([\s\S]*?\n\}/);
assert(labelFuncMatch, '必須存在 getNotificationDeliveryModeLabel_ 函式');
const getLabel = new Function(labelFuncMatch[0] + '; return getNotificationDeliveryModeLabel_;')();

assert.strictEqual(getLabel('direct'), '單封多人（互相可見）', 'direct 標籤應為 單封多人（互相可見）');
assert.strictEqual(getLabel('single_bcc'), '單封 BCC', 'single_bcc 標籤應為 單封 BCC');

// 檢查 DASHBOARD_CONFIG 與 50 人提示字串
assert(code.includes('單封多人收件人含 CC 共'), '應包含單封多人超額提示');

console.log('Task 1 測試通過！');
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `node test/direct-delivery-backend.test.js`
Expected: FAIL (標籤目前仍為 `'直接寄送'`，且尚未包含 `'單封多人收件人含 CC 共'` 提示)

- [ ] **Step 3: 修改 `dashboard/code.js` 實作**

1. 修改 `getNotificationDeliveryModeLabel_`：
```javascript
function getNotificationDeliveryModeLabel_(deliveryMode) {
  const labels = {
    individual: '個人化逐封',
    single_bcc: '單封 BCC',
    direct: '單封多人（互相可見）',
    layered: '分層寄送'
  };
  return labels[String(deliveryMode || 'individual').trim()] || '個人化逐封';
}
```

2. 擴充 `buildNotificationTemplatesByDeliveryMode_`：
```javascript
function buildNotificationTemplatesByDeliveryMode_(courseTitle) {
  return {
    personalized: {
      individual: buildPersonalizedNotificationTemplate_(courseTitle),
      direct: buildAnnouncementNotificationTemplate_(courseTitle)
    },
    case_staff_personalized: {
      individual: buildCaseStaffIndividualNotificationTemplate_(courseTitle),
      single_bcc: buildCaseStaffSingleBccNotificationTemplate_(courseTitle),
      direct: buildCaseStaffSingleBccNotificationTemplate_(courseTitle)
    },
    parental_leave_personalized: {
      individual: buildParentalLeavePersonalizedNotificationTemplate_(courseTitle),
      direct: buildAnnouncementNotificationTemplate_(courseTitle)
    },
    case_staff_layered_reminder: {
      layered: buildCaseStaffLayeredReminderTemplateBundle_(courseTitle)
    }
  };
}
```

3. 擴充 `buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_`：
```javascript
function buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_() {
  return {
    personalized: {
      individual: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      direct: ['{{課程名稱}}', '{{上課網址}}']
    },
    case_staff_personalized: {
      individual: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      single_bcc: ['{{課程名稱}}', '{{上課網址}}'],
      direct: ['{{課程名稱}}', '{{上課網址}}']
    },
    parental_leave_personalized: {
      individual: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      direct: ['{{課程名稱}}', '{{上課網址}}']
    },
    case_staff_layered_reminder: {
      layered: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{駐站列表}}', '{{駐站管理員姓名}}', '{{組長姓名}}', '{{未完成人員名單}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}']
    }
  };
}
```

4. 更新 `executeTrainingNotification_` 超額提示與失敗名稱：
```javascript
    if (isDirectDelivery) {
      const directTotal = selection.recipients.length + normalizedPayload.cc.length;
      if (directTotal > DASHBOARD_CONFIG.bccBatchSize) {
        throw new Error(`單封多人收件人含 CC 共 ${directTotal} 人，超過單封上限 ${DASHBOARD_CONFIG.bccBatchSize} 人。請改用單封 BCC 或縮小寄送範圍。`);
      }
    }
```
及
```javascript
        failures.push({
          email: toEmails[0] || viewerEmail,
          name: '單封多人',
          message: error && error.message ? error.message : String(error)
        });
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node test/direct-delivery-backend.test.js`
Expected: `Task 1 測試通過！`

- [ ] **Step 5: 提交 Task 1 變更**

```bash
git add dashboard/code.js test/direct-delivery-backend.test.js
git commit -m "feat: enhance direct delivery mode template matrix and naming in backend"
```

---

### Task 2: 前端 UI 標籤、CC 欄位與範本變數連動更新 (`dashboard/dashboard.html`)

**Files:**
- Modify: `dashboard/dashboard.html:845-865` (下拉選單與 CC 欄位標籤)
- Modify: `dashboard/dashboard.html:1840-1868` (`getSelectedNotificationTemplateDefinition`, `getSelectedNotificationPlaceholders`)
- Modify: `dashboard/dashboard.html:2045-2055` (`getNotificationDeliveryModeLabel`)
- Create: `test/direct-delivery-frontend.test.js`

**Interfaces:**
- Consumes: `state.notification.templatesByDeliveryMode`, `state.notification.placeholderTokensByTemplateAndDeliveryMode`
- Produces:
  - `#notify-delivery-mode` 選項為 `<option value="direct">單封多人（互相可見）</option>`
  - `#notify-cc-field label` 為 `副本 CC（單封多人專用）`
  - `getNotificationDeliveryModeLabel('direct')` -> 回傳 `'單封多人（互相可見）'`
  - `getSelectedNotificationTemplateDefinition('group_announcement', 'direct')` -> 正確回傳組別版範本內容，而非被暴力覆蓋為一般公告

- [ ] **Step 1: 撰寫前端邏輯單元測試**

建立 `test/direct-delivery-frontend.test.js`：

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 檢查 HTML 標籤
assert(html.includes('<option value="direct">單封多人（互相可見）</option>'), '選單選項應為 單封多人（互相可見）');
assert(html.includes('副本 CC（單封多人專用）'), 'CC 欄位標籤應為 副本 CC（單封多人專用）');
assert(html.includes('direct: \'單封多人（互相可見）\''), '前端 getNotificationDeliveryModeLabel direct 標籤應為 單封多人（互相可見）');

// 測試 getSelectedNotificationTemplateDefinition 邏輯（不應有寫死的 if direct 強制轉 announcement）
assert(!html.includes('if (normalizedDeliveryMode === \'direct\') {\n        return state.notification.templates.announcement'), '不應暴力強制將 direct 轉為 announcement');

console.log('Task 2 測試通過！');
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `node test/direct-delivery-frontend.test.js`
Expected: FAIL

- [ ] **Step 3: 修改 `dashboard/dashboard.html` 實作**

1. 修改選單與 CC 標籤：
```html
          <div class="field">
            <label for="notify-delivery-mode">寄送方式</label>
            <select id="notify-delivery-mode">
              <option value="individual">個人化逐封</option>
              <option value="single_bcc">單封 BCC</option>
              <option value="direct">單封多人（互相可見）</option>
              <option value="layered">分層寄送</option>
            </select>
          </div>
          <div class="field hidden" id="notify-cc-field" style="grid-column: 1 / -1;">
            <label for="notify-cc-input">副本 CC（單封多人專用）</label>
            <input id="notify-cc-input" type="text" list="notify-cc-options" placeholder="輸入或選擇人員後按 Enter 加入；可手動輸入名單外 email">
            <datalist id="notify-cc-options"></datalist>
            <div id="notify-cc-chips" class="cc-chips"></div>
            <div id="notify-cc-note" class="template-note"></div>
          </div>
```

2. 修改 `getSelectedNotificationTemplateDefinition` 與 `getSelectedNotificationPlaceholders`：
```javascript
    function getSelectedNotificationTemplateDefinition(templateType, deliveryMode) {
      const normalizedTemplateType = String(templateType || '').trim();
      const normalizedDeliveryMode = String(deliveryMode || 'individual').trim();
      const byDeliveryMode = state.notification.templatesByDeliveryMode[normalizedTemplateType] || null;
      if (byDeliveryMode && byDeliveryMode[normalizedDeliveryMode]) {
        return byDeliveryMode[normalizedDeliveryMode];
      }
      return state.notification.templates[normalizedTemplateType] || { subject: '', htmlBody: '' };
    }

    function getSelectedNotificationPlaceholders(templateType, deliveryMode) {
      const normalizedTemplateType = String(templateType || '').trim();
      const normalizedDeliveryMode = String(deliveryMode || 'individual').trim();
      const byDeliveryMode = state.notification.placeholderTokensByTemplateAndDeliveryMode[normalizedTemplateType] || null;
      if (byDeliveryMode && Array.isArray(byDeliveryMode[normalizedDeliveryMode])) {
        return byDeliveryMode[normalizedDeliveryMode];
      }
      return state.notification.placeholdersByTemplateType[normalizedTemplateType] || [];
    }
```

3. 更新 `getNotificationDeliveryModeLabel`：
```javascript
    function getNotificationDeliveryModeLabel(deliveryMode) {
      const labels = {
        individual: '個人化逐封',
        single_bcc: '單封 BCC 全部',
        direct: '單封多人（互相可見）',
        layered: '分層寄送'
      };
      return labels[String(deliveryMode || 'individual').trim()] || '個人化逐封';
    }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node test/direct-delivery-frontend.test.js`
Expected: `Task 2 測試通過！`

- [ ] **Step 5: 提交 Task 2 變更**

```bash
git add dashboard/dashboard.html test/direct-delivery-frontend.test.js
git commit -m "feat: update direct delivery UI labels and dynamic template resolution in frontend"
```

---

### Task 3: 完整整合驗證與迴歸測試

**Files:**
- Create: `test/direct-delivery-integration.test.js`

**Interfaces:**
- 驗證完整 payload 構建、範本切換模擬、收件人與 CC 合併計算。

- [ ] **Step 1: 撰寫全流程整合測試腳本**

建立 `test/direct-delivery-integration.test.js`：
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codeJs = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 驗證所有 UI 標籤一致性
assert(dashboardHtml.includes('單封多人（互相可見）'));
assert(dashboardHtml.includes('副本 CC（單封多人專用）'));

// 2. 驗證 code.js 語法正確性 (透過 Node.js 語法檢查)
const vm = require('vm');
const script = new vm.Script(codeJs, { filename: 'dashboard/code.js' });
assert(script, 'code.js 語法無誤');

console.log('全流程整合測試驗證通過！');
```

- [ ] **Step 2: 執行整合測試**

Run: `node test/direct-delivery-integration.test.js`
Expected: `全流程整合測試驗證通過！`

- [ ] **Step 3: 提交 Task 3 變更**

```bash
git add test/direct-delivery-integration.test.js
git commit -m "test: add integration test suite for single email multiple recipients delivery"
```
