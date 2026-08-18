# 學員訓練儀表板：後端資料層排除離職與廠商人員設計規格書

- **日期**：2026-08-18
- **狀態**：Approved by User
- **模組**：學員訓練儀表板後端核心資料管線（Dashboard Backend Core Data Pipeline）

---

## 1. 概述 (Overview)

依據 `~/.agents/ECOSYSTEM.md` 生態系資料契約與企業教育訓練管理需求，「人員主檔」C 欄位狀態為「離職」、「委外廠商」與「合作廠商」之人員非本庫常態在勤內部受訓對象。若將其納入儀表板統計與通知名單，會稀釋實際完成率並造成通知誤寄。

本設計在後端資料載入層（`buildDashboardContext_`）直接排除上述非在勤人員：
1. **常數集合與工具函式**：定義 `DASHBOARD_EXCLUDED_PERSONNEL_STATUSES` 集合，比對 `['離職', '委外', '委外廠商', '合作', '合作廠商']`。
2. **核心資料管線過濾**：在 `buildDashboardContext_` 讀取人員主檔時，直接略過排除狀態人員。
3. **通知選單同步過濾**：在 `collectPersonnelStatusOptions_` 中排除這些無效狀態選項。
4. **全站指標與通知發送保護**：全站 KPI、學員清單、單位完成概況與通知寄送名單全面排除該對象。

---

## 2. 判定邏輯與常數設計 (Data Layer Implementation)

在 `dashboard/code.js` 定義全域常數與判斷工具：

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

---

## 3. 資料管線整合 (Pipeline Integration)

### 3.1 `buildDashboardContext_` 學員清單建立
於巡訪 `personnelRows` 時進行過濾：
```javascript
  for (let i = 1; i < personnelRows.length; i += 1) {
    const email = normalizeEmail_(personnelRows[i][0]);
    if (!email) continue;
    const personnelStatus = String(personnelRows[i][2] || '').trim();
    if (isExcludedPersonnelStatus_(personnelStatus)) continue;
    // ...正常建立 learner
  }
```

### 3.2 `collectPersonnelStatusOptions_` 狀態選項收集
於收集人員狀態選項時進行過濾：
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

---

## 4. 影響範圍與安全性 (Impact & Safety)

1. **KPI 與完成率計算**：總應訓人數（total）僅計入內部在勤人員，使完成率（completionRate）真實反映內部執行成效。
2. **通知發送安全性**：通知預覽與正式寄送之名單直接由 `buildDashboardContext_` 生成，從根本防杜通知發送至離職人員或外部廠商信箱。
3. **生態系契約合規**：完全落實 `ECOSYSTEM.md` 中跨系統預設排除離職人員之鐵則。

---

## 5. 驗收與測試標準 (Verification & Testing Plan)

1. **狀態判定單元測試**：
   - 驗證 `isExcludedPersonnelStatus_('離職')`、`isExcludedPersonnelStatus_('委外廠商')`、`isExcludedPersonnelStatus_('委外')`、`isExcludedPersonnelStatus_('合作廠商')`、`isExcludedPersonnelStatus_('合作')` 均回傳 `true`。
   - 驗證一般狀態如 `'在勤'`、`'在職'`、`'育嬰假'`、`'休假'`、`'留職停薪'`、`'倫理委員會'` 均回傳 `false`。
2. **資料管線過濾測試**：
   - 模擬包含離職員工與廠商資料的 `personnelRows`，確認 `learners` 輸出陣列完全不含該等成員。
   - 確認 `collectPersonnelStatusOptions_` 回傳之選項陣列不包含排除狀態。
3. **全系統語法與迴歸測試**：
   - 執行所有專案既有測試套件，確認無迴歸異常。
