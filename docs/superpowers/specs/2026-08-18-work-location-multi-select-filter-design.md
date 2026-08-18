# 學員訓練儀表板：工作地點多選/單選篩選與明細整合設計規格書

- **日期**：2026-08-18
- **狀態**：Approved by User
- **模組**：學員訓練儀表板篩選系統與學員明細表格（Dashboard Filter & Learner Details Table）

---

## 1. 概述 (Overview)

在組織管理中，「工作地點」（人員主檔 H 欄）與「所屬組別/單位」（組織架構與職務配置）為兩個相互獨立的維度。為了讓管理員能夠依照地理位置（如南港總部、各駐站等）進行受訓進度追蹤，本設計於學員訓練儀表板新增工作地點的多選/單選篩選功能，並在學員明細與搜尋中深度整合。

本設計涵蓋：
1. **後端資料層**：從「人員主檔」H 欄位（index 7）萃取 `location` 屬性。
2. **前端多選下拉元件**：提供「全部地點」與各地點 Checkbox 勾選，支援單選與多選，按鈕即時動態顯示選取摘要。
3. **篩選與搜尋整合**：過濾核心支援 `state.filters.locations` 多選陣列過濾，關鍵字搜尋支援地點比對。
4. **學員明細表格標註**：於學員表格的單位職務欄標示地點標籤（如 `📍 南港總部`）。

---

## 2. 資料結構與後端擴充 (Data Structure & Backend Extension)

在 `dashboard/code.js` 的 `buildDashboardContext_()` 中讀取人員主檔 H 欄：

```javascript
  for (let i = 1; i < personnelRows.length; i += 1) {
    const email = normalizeEmail_(personnelRows[i][0]);
    if (!email) continue;
    const name = String(personnelRows[i][1] || '').trim();
    const personnelStatus = String(personnelRows[i][2] || '').trim();
    if (isExcludedPersonnelStatus_(personnelStatus)) continue;
    const location = String(personnelRows[i][7] || '').trim();
    // ...
    learners.push({
      email,
      name,
      location,
      // ...
    });
  }
```

---

## 3. 前端多選元件與篩選邏輯 (Frontend Multi-select & Filtering)

### 3.1 狀態定義
```javascript
state.filters = {
  search: '',
  status: '',
  unit: '',
  locations: [], // 空陣列代表全部/不限，有值時代表選取的地點清單
  incompleteOnly: false,
  excludeEgc: true
};
```

### 3.2 HTML 元件結構
於篩選列「單位」欄位旁加入：
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

### 3.3 動態選項生成與摘要 (`populateLocationFilter`)
1. 從 `learners` 萃取不重複且非空之 `location` 字串並排序。
2. 渲染 Checkbox 選項清單。
3. 勾選/反選時更新 `state.filters.locations`，更新按鈕文字（如 `全部地點`、`南港總部`、`南港總部、台大 (2)`），並觸發 `renderDashboard()`。
4. 點擊畫面外部區域時自動收合選單。

### 3.4 篩選邏輯整合 (`applyFilters`)
```javascript
function applyFilters(learners) {
  return learners.filter((learner) => {
    if (state.filters.excludeEgc && state.filters.unit !== '倫理委員會' && isEgcMember(learner)) return false;
    if (state.filters.locations.length > 0 && !state.filters.locations.includes(learner.location)) return false;

    const searchHaystack = [
      learner.name,
      learner.email,
      learner.location,
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

### 3.5 清除篩選連動 (`resetFilters`)
重置時：
- `state.filters.locations = [];`
- 勾選清單全數取消勾選。
- 按鈕摘要文字還原為 `全部地點`。

---

## 4. 學員明細表格呈現 (Learner Table Presentation)

在 `renderLearnerTable` 渲染每列學員的「單位職務」單元格時，若存在 `learner.location`，於次行附加地點標籤：
```javascript
const locationHtml = learner.location
  ? `<div class="cell-location small muted" style="margin-top: 2px;">📍 ${escapeHtml(learner.location)}</div>`
  : '';
```

---

## 5. 驗收與測試標準 (Verification & Testing Plan)

1. **後端資料讀取單元測試**：
   - 驗證 `buildDashboardContext_` 正確從 `personnelRows` 第 8 欄（index 7）讀取 `location` 並存入 `learner.location`。
2. **多選篩選單元測試**：
   - 單選地點時，僅顯示該地點學員。
   - 多選地點時，聯集顯示所有選中地點學員。
   - 未選取（空陣列）時，顯示全部學員。
3. **關鍵字搜尋測試**：
   - 輸入地點關鍵字時，`searchHaystack` 能正確命中學員。
4. **重置篩選測試**：
   - 點擊「清除篩選」後，地點篩選恢復為全部，按鈕文字還原為「全部地點」。
