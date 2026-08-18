# 課程通知：單封多人（互相可見）寄送方式設計規格書

- **日期**：2026-08-18
- **狀態**：Approved by User
- **模組**：學員訓練儀表板課程通知（Dashboard Notification System）

---

## 1. 概述 (Overview)

目前教育訓練儀表板支援「個人化逐封 (`individual`)」、「單封 BCC (`single_bcc`)」與「分層寄送 (`layered`)」三種主要的通知發送方式。為了滿足內部發信需要讓所有收件人清楚知道此信件寄給哪些同仁之情境，本設計完善並正名「**單封多人（互相可見）**」（內部代碼 `direct`）寄送模式。

在此模式下：
1. 篩選出的所有收件人 Email 均放入信件的 `To` 欄位（以逗號分隔）。
2. 提供選填的 `CC`（副本）欄位，可加入特定人員或外部 Email。
3. 信件僅發送一封，收件人彼此均可見完整的收件人清單與副本清單。

---

## 2. 介面與顯示規格 (UI & Labels)

### 2.1 寄送方式下拉選單 (`#notify-delivery-mode`)
選項清單與標籤如下：
- `individual`：個人化逐封
- `single_bcc`：單封 BCC
- `direct`：**單封多人（互相可見）**
- `layered`：分層寄送

### 2.2 副本 CC 欄位 (`#notify-cc-field`)
- **欄位標籤**：`副本 CC（單封多人專用）`
- **顯示規則**：僅在寄送方式選取「單封多人（互相可見）」時顯示，選取其他寄送方式時隱藏。
- **送出重置**：切換為非單封多人模式時，送出的 payload 中 `cc` 一律為空陣列 `[]`。
- **輸入互動**：支援從既有人員清單選取，或直接輸入任何合格 Email（支援 Enter / 逗號新增 Chip，並可點擊 `×` 個別移除）。

### 2.3 預覽摘要與提示文字
- 預覽條件摘要及寄送完成確認訊息中，寄送方式標籤顯示為 `單封多人（互相可見）`。
- 若有設定 CC，條件摘要中附加 ` / CC X 位`。
- 人數超額提示（當 To + CC 超過 50 人時）：
  > 「單封多人收件人含 CC 共 X 人，超過單封上限 50 人。請改用單封 BCC 或縮小寄送範圍。」

---

## 3. 範本與變數對應矩陣 (Template & Placeholder Resolution)

由於單封郵件為多人共用，無法帶入個別收件人的專屬變數（如 `{{姓名}}`、`{{單位}}`、`{{職稱}}`、`{{訓練狀態}}`）。系統依管理員選取之範本類型進行對應：

| 範本類型 (`templateType`) | 預設寄送模式 | 切換至「單封多人」時的套用範本 | 可用變數提示 | 說明 |
| :--- | :--- | :--- | :--- | :--- |
| **公告版** (`announcement`) | `single_bcc` | 公告版內文 | `{{課程名稱}}`、`{{上課網址}}` | 保留標準公告文案 |
| **組別版** (`group_announcement`) | `single_bcc` | 組別版內文 | `{{組別稱呼}}`、`{{課程名稱}}`、`{{上課網址}}` | 保留組別專屬文案與組別稱呼變數 |
| **駐站管理員版** (`station_manager_announcement`) | `single_bcc` | 駐站管理員版內文 | `{{駐站管理稱呼}}`、`{{課程名稱}}`、`{{上課網址}}` | 保留駐站管理專屬文案與稱呼變數 |
| **長官主管摘要版** (`leadership_announcement_summary`) | `single_bcc` | 長官主管摘要版內文 | `{{課程名稱}}`、`{{上課網址}}` | 保留主管摘要專屬文案 |
| **長官主管完整版** (`leadership_announcement`) | `single_bcc` | 長官主管完整版內文 | `{{課程名稱}}`、`{{上課網址}}` | 保留主管完整專屬文案 |
| **個人化版** (`personalized`) | `individual` | 自動轉換為「通用公告文案」 | `{{課程名稱}}`、`{{上課網址}}` | 避免群發信件出現個別姓名變數 |
| **育嬰假版** (`parental_leave_personalized`) | `individual` | 自動轉換為「通用公告文案」 | `{{課程名稱}}`、`{{上課網址}}` | 避免群發信件出現個別姓名變數 |
| **收案人員版** (`case_staff_personalized`) | `individual` | 自動轉換為「收案人員公告文案」 | `{{課程名稱}}`、`{{上課網址}}` | 自動切換為收案通用群發格式 |
| **收案分層提醒** (`case_staff_layered_reminder`) | `layered` | （不支援單封多人） | — | 僅限分層寄送，選單會自動鎖定 |

**實作規範**：
1. 後端 `buildNotificationTemplatesByDeliveryMode_` 與 `buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_` 定義各個人範本在 `direct` 模式下的文案與變數。
2. 前端 `getSelectedNotificationTemplateDefinition` 與 `getSelectedNotificationPlaceholders` 在 `direct` 模式下優先讀取 deliveryMode 映射，若未定義則保留該範本原樣，而非強制覆蓋為 `announcement`。

---

## 4. 後端寄送邏輯與資料流 (Backend Delivery & Data Flow)

### 4.1 Payload 規格
```json
{
  "templateType": "group_announcement",
  "deliveryMode": "direct",
  "cc": ["auditor@example.com"],
  "target": {
    "orgType": "ALL",
    "level": 1,
    "orgCode": "GRP-01",
    "descendantMode": "self",
    "assignmentMatch": "primary_only"
  },
  "trainingStatus": "incomplete",
  "personnelStatus": "active",
  "template": {
    "subject": "【教育訓練通知】資訊安全暨個資保護教育訓練",
    "htmlBody": "<p>各組同仁好：...</p>"
  }
}
```

### 4.2 檢驗與寄送流程 (`executeTrainingNotification_`)
1. **權限檢查**：確認操作者具備儀表板與寄信權限。
2. **收件人與 CC 萃取**：
   - `toEmails = selection.recipients.map(r => r.email).filter(Boolean)`
   - `ccEmails = normalizedPayload.cc || []`
   - 若 `toEmails.length === 0`，拋出錯誤「目前沒有可寄送的收件人。」。
3. **人數限制檢驗**：
   - `directTotal = toEmails.length + ccEmails.length`
   - 若 `directTotal > DASHBOARD_CONFIG.bccBatchSize`（50 人），拋出錯誤：
     `單封多人收件人含 CC 共 ${directTotal} 人，超過單封上限 ${DASHBOARD_CONFIG.bccBatchSize} 人。請改用單封 BCC 或縮小寄送範圍。`
4. **樣板字串替換**：
   - 透過 `applyGenericNotificationTemplate_` 替換通用變數（`{{課程名稱}}`、`{{上課網址}}`、`{{組別稱呼}}`、`{{駐站管理稱呼}}`）。
5. **MailApp 調用**：
   ```javascript
   const mailOptions = {
     to: toEmails.join(','),
     subject: directSubject,
     htmlBody: directHtmlBody
   };
   if (ccEmails.length > 0) {
     mailOptions.cc = ccEmails.join(',');
   }
   MailApp.sendEmail(mailOptions);
   sentCount = 1;
   ```
6. **通知紀錄表 (`通知紀錄`) 寫入**：
   - 「寄送方式」欄位寫入：`單封多人（互相可見）`。
   - 「寄送條件摘要」欄位記錄條件並包含 ` / CC X 位`。
   - 記錄預計收件人數、寄出封數（1 封）與操作者資訊。

---

## 5. 邊界情況與錯誤處理 (Edge Cases & Error Handling)

1. **CC 名單重複或無效 Email**：
   - 前端輸入時即時檢查正則格式並防重複；後端 `normalizeNotificationCcList_` 再次過濾無效 Email 與去重。
2. **切換寄送方式時 CC 名單處理**：
   - 使用者由「單封多人」切換至「個人化逐封」或「單封 BCC」時，CC 欄位隱藏，發送時 `cc` 自動清空，避免非預期寄送。
3. **範本切換時的變數提示即時性**：
   - 每次切換「範本類型」或「寄送方式」時，立即刷新下方「可用變數：...」提示文字與編輯區內容。

---

## 6. 驗收與測試標準 (Verification & Testing Plan)

1. **UI 標籤檢查**：
   - 下拉選單顯示為 `單封多人（互相可見）`。
   - CC 欄位標籤為 `副本 CC（單封多人專用）`。
2. **範本切換驗證**：
   - 選取「個人化版」+「單封多人」：文案自動轉為通用公告文案，可用變數僅含 `{{課程名稱}}`、`{{上課網址}}`。
   - 選取「組別版」+「單封多人」：保留組別版文案與 `{{組別稱呼}}` 變數。
3. **CC 新增與移除**：
   - 輸入名單內與名單外 Email，確認正確渲染為 Chip 並能個別點選 `×` 刪除。
4. **上限驗證 (Dry-run & Send)**：
   - 當收件人 + CC 總數超過 50 人時，預覽與寄送均能正確阻擋並顯示中文錯誤訊息。
5. **寄送與記錄**：
   - 執行單封多人寄送後，收件人信箱之 `To` 欄位包含所有目標名單，`Cc` 包含指定副本。
   - Google Sheet `通知紀錄` 表中的寄送方式正確寫入「單封多人（互相可見）」。
