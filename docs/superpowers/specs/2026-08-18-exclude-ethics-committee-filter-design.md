# 學員訓練儀表板：預設排除倫理委員會篩選設計規格書

- **日期**：2026-08-18
- **狀態**：Approved by User
- **模組**：學員訓練儀表板（Dashboard Overview & Filter System）

---

## 1. 概述 (Overview)

在學員訓練儀表板的「整體訓練概況」視圖中，倫理委員會成員（組織代碼 `EGC` / 名稱 `倫理委員會`）通常屬於外部審查委員或特殊組織編組，其教育訓練要求與一般常態在勤同仁有所區隔。若將其計入全庫整體概況，會影響全庫完成率與催辦名單之精準度。

本設計為儀表板新增「**預設排除倫理委員會**」功能：
1. 儀表板載入時預設排除所有倫理委員會成員，全站指標（KPI、完成率、圖表、學員表格、風險名單）均不計入。
2. 篩選列提供「排除倫理委員會」切換開關，保留管理員手動查看的彈性。
3. 採用「C 欄代碼 `EGC` 為主、D 欄名稱與人員狀態為輔」的多重防禦識別判定。
4. 提供單位選單與排除勾選框的智慧雙向連動。

---

## 2. 識別判定邏輯 (EGC Member Identification)

以 C 欄組織代碼 `EGC` 為主要判準，並聯集比對 D 欄名稱與人員狀態，確保跨表與登打差異時的最高防禦性：

```javascript
function isEgcMember(learner) {
  if (!learner) return false;
  const orgCode = String(learner.assignmentOrgCode || '').trim().toUpperCase();
  const orgName = String(learner.assignmentOrgName || '').trim();
  const status = String(learner.personnelStatus || '').trim();
  return orgCode === 'EGC' || orgName === '倫理委員會' || status === '倫理委員會';
}
```

---

## 3. 介面與互動規格 (UI & Interaction Flow)

### 3.1 篩選面板新增勾選框 (`#exclude-egc-toggle`)
- **位置**：位於「篩選與檢索」面板中快速篩選區（與「只看未完成」並排）。
- **標籤**：`排除倫理委員會`
- **預設狀態**：`checked = true`。
- **初始狀態物件**：
  ```javascript
  state.filters = {
    search: '',
    status: '',
    unit: '',
    incompleteOnly: false,
    excludeEgc: true
  };
  ```

### 3.2 雙向連動行為
1. **單位選單選取「倫理委員會」時**：
   - 使用者在 `#unit-filter` 選取 `'倫理委員會'`，系統自動將 `#exclude-egc-toggle` 取消勾選（`checked = false`），並將 `state.filters.excludeEgc = false`。
   - 畫面精準呈現倫理委員會同仁。
2. **手動重新勾選「排除倫理委員會」時**：
   - 若當前 `#unit-filter` 正處於 `'倫理委員會'`，自動將 `#unit-filter` 切回 `''`（全部單位），並將 `state.filters.unit = ''`。
3. **點擊「清除篩選」按鈕時 (`resetFilters`)**：
   - 搜尋框、狀態選單、單位選單、只看未完成均重置。
   - **`#exclude-egc-toggle` 恢復為預設勾選狀態（`checked = true`）**。

### 3.3 全頁連動計算範圍
過濾核心 `applyFilters` 於 `state.filters.excludeEgc === true` 且 `state.filters.unit !== '倫理委員會'` 時過濾掉所有 `isEgcMember(learner)`。
連動更新的畫面元素包含：
- **KPI 完成率卡片**（總人數、完成率、已完成、待補測、進行中、近 7 日活躍）
- **狀態分布條狀統計與圓餅圖**
- **學員明細表格**
- **風險名單清單**
- **單位完成概況列表**（不會出現倫理委員會條目）
- **篩選人數提示**（`目前顯示 X / Y 位學員`）

---

## 4. 邊界情況與錯誤處理 (Edge Cases & Error Handling)

1. **代碼大小寫與多餘空格**：`isEgcMember` 使用 `trim().toUpperCase()` 標準化，確保 `egc`、`EGC ` 等皆能被正確識別。
2. **資料欄位缺失**：若某學員無 `assignmentOrgCode` 或未指派職務，安全 fallback 為空字串，不會觸發 TypeError。
3. **單位篩選衝突**：透過雙向連動機制，防止出現「單位選倫理委員會」且「同時勾選排除倫理委員會」導致畫面空白的矛盾狀態。

---

## 5. 驗收與測試標準 (Verification & Testing Plan)

1. **預設狀態測試**：
   - 載入頁面時，`#exclude-egc-toggle` 應為勾選狀態。
   - 學員明細與單位概況中不應出現任何 `orgCode === 'EGC'` 或 `orgName === '倫理委員會'` 的學員。
2. **取消排除測試**：
   - 取消勾選 `#exclude-egc-toggle` 後，倫理委員會成員應正常出現在學員明細與單位列表中，KPI 總人數相應增加。
3. **單位選單連動測試**：
   - 在 `#unit-filter` 選擇「倫理委員會」時，`#exclude-egc-toggle` 應自動變為未勾選，且明細僅顯示倫理委員會成員。
4. **清除篩選測試**：
   - 變更各項篩選條件後點擊「清除篩選」，`#exclude-egc-toggle` 應正確恢復為勾選狀態。
