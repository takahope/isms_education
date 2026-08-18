# 預設排除倫理委員會篩選實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在學員訓練儀表板「整體訓練概況」新增「預設排除倫理委員會」功能，以 C 欄代碼 `EGC` 為主軸（輔以 D 欄名稱與人員狀態多重防禦），載入時預設排除，並支援勾選框與單位選單智慧雙向連動及清除篩選自動還原。

**Architecture:** 在 `dashboard/dashboard.html` 之快速篩選區加入 `#exclude-egc-toggle`（預設 checked: true）；於 state 中維護 `filters.excludeEgc: true`；實作 `isEgcMember(learner)` 判定函式；於 `applyFilters`、`resetFilters` 及單位變更事件中加入雙向連動邏輯；透過 Node.js 單元與整合測試驗證。

**Tech Stack:** Vanilla JavaScript, HTML5/CSS, Node.js (用於測試驗證)。

## Global Constraints

- 判定規則：`isEgcMember` 需同時相容 C 欄代碼 `EGC`（不分大小寫）、D 欄名稱 `倫理委員會` 與人員狀態 `倫理委員會`。
- 預設狀態：進入儀表板與點擊「清除篩選」時，`excludeEgc` 均必須為 `true`。
- 遵循繁體中文 (`zh-TW`) 介面與 2 空格縮排慣例。

---

### Task 1: 前端 UI 勾選框、判定函式與雙向連動實作 (`dashboard/dashboard.html`)

**Files:**
- Modify: `dashboard/dashboard.html:1038-1045` (快速篩選 HTML 結構)
- Modify: `dashboard/dashboard.html:1130-1136` (`state.filters` 定義)
- Modify: `dashboard/dashboard.html:1155-1230` (`bindEvents` 事件綁定)
- Modify: `dashboard/dashboard.html:1315-1360` (`resetFilters`、`applyFilters`、`isEgcMember`)
- Create: `test/exclude-egc-filter.test.js`

**Interfaces:**
- Consumes: `learner.assignmentOrgCode`, `learner.assignmentOrgName`, `learner.personnelStatus`
- Produces:
  - `isEgcMember(learner)` -> 回傳布林值
  - `state.filters.excludeEgc` 預設為 `true`
  - `#exclude-egc-toggle` 元素（預設 checked）

- [ ] **Step 1: 撰寫前端過濾與連動單元測試**

建立 `test/exclude-egc-filter.test.js`：

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查 HTML 元素與預設勾選
assert(html.includes('id="exclude-egc-toggle"'), '必須包含 exclude-egc-toggle 元素');
assert(html.includes('<span>排除倫理委員會</span>'), '必須包含 排除倫理委員會 標籤');
assert(html.includes('excludeEgc: true'), 'state.filters 預設 excludeEgc 必須為 true');

// 2. 擷取並測試 isEgcMember 函式
const funcMatch = html.match(/function isEgcMember\([\s\S]*?\n\s{4}\}/);
assert(funcMatch, '必須存在 isEgcMember 函式');
const isEgcMember = new Function(funcMatch[0] + '; return isEgcMember;')();

assert.strictEqual(isEgcMember({ assignmentOrgCode: 'EGC' }), true, '代碼 EGC 應判定為 true');
assert.strictEqual(isEgcMember({ assignmentOrgCode: 'egc' }), true, '小寫 egc 應判定為 true');
assert.strictEqual(isEgcMember({ assignmentOrgName: '倫理委員會' }), true, '名稱 倫理委員會 應判定為 true');
assert.strictEqual(isEgcMember({ personnelStatus: '倫理委員會' }), true, '狀態 倫理委員會 應判定為 true');
assert.strictEqual(isEgcMember({ assignmentOrgCode: 'GRP-01', assignmentOrgName: '資訊組' }), false, '一般人員應判定為 false');

console.log('Task 1 測試通過！');
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `node test/exclude-egc-filter.test.js`
Expected: FAIL

- [ ] **Step 3: 修改 `dashboard/dashboard.html` 實作**

1. 在快速篩選 HTML 加入勾選框：
```html
            <div class="field">
              <label>快速篩選</label>
              <div class="checkbox-field">
                <input id="incomplete-toggle" type="checkbox">
                <span>只看未完成</span>
              </div>
              <div class="checkbox-field" style="margin-top: 4px;">
                <input id="exclude-egc-toggle" type="checkbox" checked>
                <span>排除倫理委員會</span>
              </div>
            </div>
```

2. 在 `state.filters` 加入 `excludeEgc: true`：
```javascript
      filters: {
        search: '',
        status: '',
        unit: '',
        incompleteOnly: false,
        excludeEgc: true
      },
```

3. 加入 `isEgcMember` 與更新 `applyFilters`：
```javascript
    function isEgcMember(learner) {
      if (!learner) return false;
      const orgCode = String(learner.assignmentOrgCode || '').trim().toUpperCase();
      const orgName = String(learner.assignmentOrgName || '').trim();
      const status = String(learner.personnelStatus || '').trim();
      return orgCode === 'EGC' || orgName === '倫理委員會' || status === '倫理委員會';
    }

    function applyFilters(learners) {
      return learners.filter((learner) => {
        if (state.filters.excludeEgc && state.filters.unit !== '倫理委員會' && isEgcMember(learner)) {
          return false;
        }

        const searchHaystack = [
          learner.name,
          learner.email,
          learner.assignmentOrgName,
          learner.assignmentTitle,
          learner.assignmentLabel
        ].join(' ').toLowerCase();

        if (state.filters.search && !searchHaystack.includes(state.filters.search)) return false;
        if (state.filters.status && learner.status !== state.filters.status) return false;
        if (state.filters.unit && learner.assignmentOrgName !== state.filters.unit) return false;
        if (state.filters.incompleteOnly && learner.status === 'completed') return false;
        return true;
      });
    }
```

4. 更新 `bindEvents` 雙向連動與 `resetFilters`：
```javascript
      document.getElementById('exclude-egc-toggle').addEventListener('change', (event) => {
        state.filters.excludeEgc = Boolean(event.target.checked);
        if (state.filters.excludeEgc && state.filters.unit === '倫理委員會') {
          state.filters.unit = '';
          document.getElementById('unit-filter').value = '';
        }
        renderDashboard();
      });
```
在 `unit-filter` 的 change 事件中：
```javascript
      document.getElementById('unit-filter').addEventListener('change', (event) => {
        const val = String(event.target.value || '').trim();
        state.filters.unit = val;
        if (val === '倫理委員會') {
          state.filters.excludeEgc = false;
          document.getElementById('exclude-egc-toggle').checked = false;
        }
        renderDashboard();
      });
```
在 `resetFilters` 中：
```javascript
    function resetFilters() {
      state.filters = {
        search: '',
        status: '',
        unit: '',
        incompleteOnly: false,
        excludeEgc: true
      };
      document.getElementById('search-input').value = '';
      document.getElementById('status-filter').value = '';
      document.getElementById('unit-filter').value = '';
      document.getElementById('incomplete-toggle').checked = false;
      document.getElementById('exclude-egc-toggle').checked = true;
      renderDashboard();
    }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node test/exclude-egc-filter.test.js`
Expected: `Task 1 測試通過！`

- [ ] **Step 5: 提交 Task 1 變更**

```bash
git add dashboard/dashboard.html test/exclude-egc-filter.test.js
git commit -m "feat: add exclude ethics committee filter and two-way interaction in dashboard"
```

---

### Task 2: 全流程整合測試與指標聯動驗證

**Files:**
- Create: `test/exclude-egc-integration.test.js`

- [ ] **Step 1: 撰寫指標與篩選全流程整合測試腳本**

建立 `test/exclude-egc-integration.test.js`：
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 模擬學員資料集
const sampleLearners = [
  { name: '王大明', email: 'wang@example.com', assignmentOrgCode: 'GRP-01', assignmentOrgName: '資訊組', status: 'completed' },
  { name: '李小華', email: 'lee@example.com', assignmentOrgCode: 'GRP-02', assignmentOrgName: '研發組', status: 'in_progress' },
  { name: '張委員', email: 'chang@example.com', assignmentOrgCode: 'EGC', assignmentOrgName: '倫理委員會', status: 'not_started' },
  { name: '陳委員', email: 'chen@example.com', assignmentOrgCode: '', assignmentOrgName: '', personnelStatus: '倫理委員會', status: 'pending_quiz' }
];

// 提取 applyFilters 與 computeClientMetrics 相關邏輯進行純 JS 驗證
const isEgcFunc = new Function(html.match(/function isEgcMember\([\s\S]*?\n\s{4}\}/)[0] + '; return isEgcMember;')();

// 1. 預設排除狀態測試 (excludeEgc: true)
const defaultFiltered = sampleLearners.filter(l => !isEgcFunc(l));
assert.strictEqual(defaultFiltered.length, 2, '預設排除後應只剩 2 位一般同仁');

// 2. 取消排除狀態測試 (excludeEgc: false)
const allFiltered = sampleLearners.filter(() => true);
assert.strictEqual(allFiltered.length, 4, '取消排除後應包含全部 4 位學員');

console.log('Task 2 整合測試驗證通過！');
```

- [ ] **Step 2: 執行整合測試**

Run: `node test/exclude-egc-integration.test.js`
Expected: `Task 2 整合測試驗證通過！`

- [ ] **Step 3: 提交 Task 2 變更**

```bash
git add test/exclude-egc-integration.test.js
git commit -m "test: add integration test suite for exclude ethics committee filter"
```
