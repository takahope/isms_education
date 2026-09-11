# Training Import Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected `mention.html` workflow that previews one selected course, places every newly qualified learner in one template-preserving XLSX worksheet, emails the single attachment to a configured recipient, and records each learner to prevent duplicate sends.

**Architecture:** Keep course qualification, row mapping, workbook mutation, preview assembly, and send-ledger transitions as separate backend units in `code.js`. The browser selects a backend-provided course and renders read-only preview data; the server remains authoritative for the recipient, workbook rows, names, message, hash, and attachment. The source XLSX stays in Drive and is modified at the OOXML worksheet level so the other workbook parts remain intact.

**Tech Stack:** Google Apps Script V8, HtmlService, SpreadsheetApp, DriveApp, Utilities ZIP/XML helpers, LockService, MailApp, vanilla JavaScript, SweetAlert2/Tailwind, Node.js `assert`/`vm` tests.

**Spec:** `docs/superpowers/specs/2026-09-11-training-import-email-design.md`

## Global Constraints

- One selected course produces one email with one XLSX attachment.
- Every pending qualified learner for that course is a separate row in the same first worksheet; never create one sheet or one file per learner.
- Qualification requires at least 3600 watched seconds and a passing quiz result or score of at least 70 for the exact same course title.
- Exclude resigned and vendor/partner-contractor personnel; include parental leave, outside, and ethics committee personnel when qualified.
- Preserve all three template worksheets and all non-data OOXML parts.
- Keep the 14-column A:N contract and the fixed values approved in the spec.
- Use `importtemplate_vYYYYMMDD.xlsx` in the `Asia/Taipei` time zone.
- Read the recipient and template only from `TRAINING_IMPORT_RECIPIENT_EMAIL` and `TRAINING_IMPORT_TEMPLATE_FILE_ID` Script Properties.
- Use the selected raw course title plus normalized learner email as the deduplication identity.
- Do not add an automatic-email disclaimer to the message.
- Preserve the existing notification and report-export behavior in `mention.html` and `code.js`.
- Follow two-space indentation and Traditional Chinese user-facing copy.

---

### Task 1: Course catalog, qualification, names, and 14-column row model

**Files:**
- Create: `test/training-import-domain.test.js`
- Modify: `code.js` after `getTrainingReportExportData()`

**Interfaces:**
- Produces: `buildTrainingImportCourseOptions_(trainingRows, progressRows)` returning `{ courseTitle, latestActivityAt, quizRecordCount, progressRecordCount }[]`.
- Produces: `extractTrainingImportGivenName_(fullName)` returning a Chinese given name or throwing a validation error.
- Produces: `buildTrainingImportUniqueKey_(courseTitle, email)` returning a stable lowercase key.
- Produces: `buildTrainingImportDataset_(input)` returning `{ courseTitle, importCourseTitle, rows, pendingLearners, alreadySent, preparing, retryableFailures, errors, recipientGivenName, senderGivenName, attachmentName, subject, htmlBody, textBody }`.
- Consumes: existing `normalizeEmail_()`, `isValidEmail_()`, `isVendorPersonnel_()`, `parseDashboardTimestampMs_()`, `escapeHtml_()`, `MENTION_CONFIG.requiredWatchSeconds`, and `MENTION_CONFIG.passingScore`.
- `buildTrainingImportDataset_()` input shape:

```javascript
{
  courseTitle: '115年度資訊安全暨個人資料保護教育訓練',
  personnelRows: [],
  trainingRows: [],
  progressRows: [],
  logRows: [],
  context: { learners: [], assignments: [], orgNodes: [], orgNodeMap: new Map() },
  recipientEmail: 'receiver@example.org',
  viewerEmail: 'operator@example.org',
  now: new Date('2026-09-11T08:00:00+08:00')
}
```

- [ ] **Step 1: Write the failing domain test**

Create `test/training-import-domain.test.js` with a VM harness that loads `code.js`, returns the four new functions, and asserts these concrete behaviors:

```javascript
const assert = require('assert');
const fs = require('fs');

const code = fs.readFileSync('code.js', 'utf8');
const load = new Function(`${code}; return {
  buildTrainingImportCourseOptions_,
  extractTrainingImportGivenName_,
  buildTrainingImportUniqueKey_,
  buildTrainingImportDataset_
};`);
const api = load();

const trainingRows = [
  ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果'],
  ['2026/09/08 09:00:00', '王小明', 'ming@example.org', '課程甲', '80', '通過'],
  ['2026/09/10 09:00:00', '李小華', 'hua@example.org', '只有測驗', '90', '通過']
];
const progressRows = [
  ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間'],
  ['ming@example.org', '課程甲', 'video-1', '', '3600', '', '2026/09/09 10:00:00'],
  ['other@example.org', '只有觀看', 'video-1', '', '3600', '', '2026/09/11 10:00:00']
];

assert.deepStrictEqual(
  api.buildTrainingImportCourseOptions_(trainingRows, progressRows).map((item) => item.courseTitle),
  ['課程甲']
);
assert.strictEqual(api.extractTrainingImportGivenName_('王小明'), '小明');
assert.throws(() => api.extractTrainingImportGivenName_('王'), /中文姓名/);
assert.strictEqual(
  api.buildTrainingImportUniqueKey_(' 課程甲 ', 'MING@EXAMPLE.ORG'),
  '課程甲\nming@example.org'
);
```

Add dataset fixtures for a normal learner, parental-leave learner, outside learner, ethics member, resigned learner, and vendor learner. Assert that the first four qualified learners are included, the last two are excluded, the completion date is the later of quiz/watch qualification times, and each output row is exactly:

```javascript
[
  '【資安通識】課程甲',
  522,
  '資通安全(通識)',
  '王小明',
  '生醫轉譯研究中心',
  3,
  '2026-09-09',
  2026,
  'ming',
  '',
  '臺灣人體生物資料庫研究人員',
  'ming@example.org',
  '本院自辦課程',
  ''
]
```

Also assert that:

```javascript
assert.strictEqual(dataset.rows.length, dataset.pendingLearners.length);
assert(dataset.rows.every((row) => row.length === 14));
assert(dataset.subject.includes('課程甲'));
assert(dataset.htmlBody.includes('小明您好：'));
assert(dataset.htmlBody.includes('小華 敬上'));
assert(!dataset.htmlBody.includes('自動發送'));
assert.strictEqual(dataset.attachmentName, 'importtemplate_v20260911.xlsx');
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
node test/training-import-domain.test.js
```

Expected: `ReferenceError` for `buildTrainingImportCourseOptions_` because the feature does not exist.

- [ ] **Step 3: Implement the minimal pure domain helpers**

Add constants and helpers after `getTrainingReportExportData()`:

```javascript
const TRAINING_IMPORT_HEADERS = [
  'course_title', 'category_id', 'category_title', 'name', 'instName',
  'certified_hour', 'certified_date', 'year', 'sso', 'tel', 'title',
  'mail', 'typez', 'certNo'
];

const TRAINING_IMPORT_LOG_HEADERS = [
  '批次ID', '唯一鍵', '課程名稱', '姓名', '使用者信箱', '完成日期',
  '收件人信箱', '附件檔名', '狀態', '操作者', '建立時間', '寄送時間',
  '最後更新時間', '錯誤訊息'
];

function extractTrainingImportGivenName_(fullName) {
  const compact = String(fullName || '').replace(/\s+/g, '');
  if (!/^[\u3400-\u9fff]{2,}$/.test(compact)) {
    throw new Error('無法解析中文姓名：姓名至少需要兩個中文字');
  }
  return compact.slice(1);
}

function buildTrainingImportUniqueKey_(courseTitle, email) {
  return String(courseTitle || '').trim() + '\n' + normalizeEmail_(email);
}
```

Implement `buildTrainingImportCourseOptions_()` with separate maps for quiz and progress courses, return only their intersection, and sort descending by the latest parseable timestamp.

Implement `buildTrainingImportDataset_()` with these exact rules:

```javascript
const passed = result === '通過' || score >= MENTION_CONFIG.passingScore;
const watched = watchedSeconds >= MENTION_CONFIG.requiredWatchSeconds;
const completedAtMs = Math.max(quizPassedAtMs, watchQualifiedAtMs);
const importCourseTitle = rawCourseTitle.startsWith('【資安通識】')
  ? rawCourseTitle
  : '【資安通識】' + rawCourseTitle;
```

Use the maximum watched seconds per learner/course, the earliest timestamp among rows that meet each qualification, and the later of those two timestamps for completion. Map names from personnel column B by normalized email in column A. Use `isVendorPersonnel_(learner, context)` in addition to the personnel-status check. Parse log rows by the published 14-column ledger contract: `已寄出` and `準備寄送` are excluded, while `寄送失敗` stays retryable.

Format the filename with `Utilities.formatDate(now, 'Asia/Taipei', 'yyyyMMdd')` when Utilities exists and a deterministic local fallback in Node. Generate the fixed read-only subject/body from the spec.

- [ ] **Step 4: Run the domain test and the closest existing data tests**

Run:

```bash
node test/training-import-domain.test.js
node test/mention-real-sheet-structure.test.js
node test/mention-export-report.test.js
```

Expected: all three pass.

- [ ] **Step 5: Commit the domain model**

```bash
git add code.js test/training-import-domain.test.js
git commit -m "Add training import data model"
```

---

### Task 2: Template-preserving OOXML mutation

**Files:**
- Create: `test/training-import-xlsx.test.js`
- Modify: `code.js` after the Task 1 helpers
- Read-only fixture: `docs/importtemplate_v20251226 (1).xlsx`

**Interfaces:**
- Consumes: `TRAINING_IMPORT_HEADERS` and the 14-element rows from `buildTrainingImportDataset_()`.
- Produces: `validateTrainingImportTemplateParts_(parts)` returning `{ sheetBlob, sheetXml }` or throwing.
- Produces: `populateTrainingImportSheetXml_(sheetXml, rows)` returning updated worksheet XML.
- Produces: `buildTrainingImportWorkbookBlob_(templateBlob, rows, filename)` returning an XLSX Blob.
- Produces: `verifyTrainingImportWorkbookBlob_(blob, expectedRows)` throwing on structural mismatch.

- [ ] **Step 1: Write the failing worksheet transformation test**

Create `test/training-import-xlsx.test.js`. Read the actual first worksheet XML without modifying the fixture:

```javascript
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');

const templatePath = 'docs/importtemplate_v20251226 (1).xlsx';
const originalXml = execFileSync('unzip', [
  '-p', templatePath, 'xl/worksheets/sheet1.xml'
], { encoding: 'utf8' });
const code = fs.readFileSync('code.js', 'utf8');
const load = new Function(`${code}; return {
  populateTrainingImportSheetXml_,
  validateTrainingImportTemplateParts_
};`);
const api = load();

const rows = [[
  '【資安通識】課程甲', 522, '資通安全(通識)', '王小明',
  '生醫轉譯研究中心', 3, '2026-09-09', 2026, 'ming', '',
  '臺灣人體生物資料庫研究人員', 'ming@example.org', '本院自辦課程', ''
]];
const updatedXml = api.populateTrainingImportSheetXml_(originalXml, rows);

assert(updatedXml.includes('<c r="A2"'));
assert(updatedXml.includes('【資安通識】課程甲'));
assert(updatedXml.includes('<v>522</v>'));
assert(updatedXml.includes('ming@example.org'));
assert(!updatedXml.includes('114年度TWB資安曁個資安全教育訓練課程'));
assert(updatedXml.includes('<autoFilter ref="$A$1:$M$1000"'));
assert(updatedXml.includes('<dataValidations'));
assert(updatedXml.includes('<row r="1000"'));
assert.throws(
  () => api.populateTrainingImportSheetXml_(originalXml, new Array(1000).fill(rows[0])),
  /999/
);
```

Mock Blob objects with `getName()`, `getContentType()`, `getDataAsString()`, `setName()`, and `setContentType()`. Assert `validateTrainingImportTemplateParts_()` rejects missing workbook/sheet parts, wrong worksheet names, and a wrong A1:N1 header.

- [ ] **Step 2: Run the XLSX test and verify it fails for the missing helper**

Run:

```bash
node test/training-import-xlsx.test.js
```

Expected: `ReferenceError` for `populateTrainingImportSheetXml_`.

- [ ] **Step 3: Implement XML-safe cell replacement and package rebuilding**

Add XML escaping and cell writers:

```javascript
function escapeTrainingImportXml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTrainingImportCellPayload_(value, isNumeric) {
  if (value === '') return '';
  if (isNumeric) return '<v>' + Number(value) + '</v>';
  return '<is><t xml:space="preserve">' + escapeTrainingImportXml_(value) + '</t></is>';
}
```

`populateTrainingImportSheetXml_()` must:

- Reject more than 999 rows.
- Preserve row 1 byte-for-byte.
- For rows 2:1000, preserve each existing `<row>` and `<c>` element attributes, remove existing `<v>`, `<is>`, and `<f>` children, set `t="inlineStr"` for text cells, remove `t` for numeric B/F/H cells, and insert the new payload.
- Clear A:N values in unused rows while retaining cells and styles.
- Preserve everything outside `<sheetData>` byte-for-byte.

`validateTrainingImportTemplateParts_()` must map ZIP parts by exact Blob name, parse `xl/workbook.xml` only for the three exact sheet names/order, and validate A1:N1 from `xl/sharedStrings.xml` plus `xl/worksheets/sheet1.xml`.

`buildTrainingImportWorkbookBlob_()` must use:

```javascript
const parts = Utilities.unzip(templateBlob);
const validated = validateTrainingImportTemplateParts_(parts);
const updatedXml = populateTrainingImportSheetXml_(validated.sheetXml, rows);
const updatedParts = parts.map((part) => part.getName() === 'xl/worksheets/sheet1.xml'
  ? Utilities.newBlob(updatedXml, 'application/xml', part.getName())
  : part);
return Utilities.zip(updatedParts, filename)
  .setName(filename)
  .setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
```

`verifyTrainingImportWorkbookBlob_()` must unzip the generated Blob and repeat workbook, header, row-count, and row-value checks before the Blob may be attached.

- [ ] **Step 4: Run the worksheet test and verify the original workbook fixture**

Run:

```bash
node test/training-import-xlsx.test.js
unzip -t "docs/importtemplate_v20251226 (1).xlsx"
```

Expected: the Node test passes and `unzip` reports no errors.

- [ ] **Step 5: Commit workbook generation**

```bash
git add code.js test/training-import-xlsx.test.js
git commit -m "Preserve import template workbook structure"
```

---

### Task 3: Protected course-list and preview APIs

**Files:**
- Create: `test/training-import-preview.test.js`
- Modify: `code.js` after the Task 2 helpers

**Interfaces:**
- Consumes: Task 1 domain helpers and Task 2 template validators.
- Produces: `getTrainingImportConfig_()` returning `{ recipientEmail, templateFileId }` or throwing with the missing property key.
- Produces: `readTrainingImportSource_()` returning `{ spreadsheet, personnelRows, assignmentRows, orgRows, trainingRows, progressRows, logRows, context }`.
- Produces: `buildTrainingImportPreviewHash_(snapshot)` returning lowercase SHA-256 hex.
- Produces: `buildAuthoritativeTrainingImportPreview_(courseTitle)` returning the complete server-owned preview snapshot used by both preview and execute RPCs, including internal-only `source`, `context`, and `templateBlob` references.
- Produces public RPC: `listTrainingImportCourses()`.
- Produces public RPC: `previewTrainingImportEmail(payload)`.

- [ ] **Step 1: Write failing access/config/preview tests**

Create `test/training-import-preview.test.js` with mocked `Session`, `PropertiesService`, `SpreadsheetApp`, `DriveApp`, and `Utilities`. Assert:

```javascript
assert.strictEqual(api.listTrainingImportCourses().success, false);
assert.match(api.listTrainingImportCourses().message, /權限不足/);

sandbox.currentEmail = 'admin@example.org';
const courses = api.listTrainingImportCourses();
assert.strictEqual(courses.success, true);
assert.deepStrictEqual(courses.courses.map((item) => item.courseTitle), ['課程甲']);

delete sandbox.properties.TRAINING_IMPORT_RECIPIENT_EMAIL;
const missingRecipient = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
assert.strictEqual(missingRecipient.success, false);
assert.match(missingRecipient.message, /TRAINING_IMPORT_RECIPIENT_EMAIL/);
```

Restore both properties and assert the successful preview has exactly one attachment dataset containing all pending learners:

```javascript
assert.strictEqual(preview.success, true);
assert.strictEqual(preview.courseTitle, '課程甲');
assert.strictEqual(preview.rows.length, 4);
assert(preview.rows.every((row) => row.length === 14));
assert.strictEqual(preview.recipientEmail, 'receiver@example.org');
assert.strictEqual(preview.attachmentName, 'importtemplate_v20260911.xlsx');
assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
assert.strictEqual(preview.canSend, true);
```

Add rejection assertions for an unlisted course, missing recipient/sender Chinese name, invalid template, one invalid candidate row, zero pending rows, and 1000 pending rows.

- [ ] **Step 2: Run the preview test and verify the missing public API failure**

Run:

```bash
node test/training-import-preview.test.js
```

Expected: `ReferenceError` for `listTrainingImportCourses`.

- [ ] **Step 3: Implement configuration, source reads, hashing, and public preview**

Extend `MENTION_CONFIG`:

```javascript
trainingImportRecipientPropertyKey: 'TRAINING_IMPORT_RECIPIENT_EMAIL',
trainingImportTemplatePropertyKey: 'TRAINING_IMPORT_TEMPLATE_FILE_ID',
trainingImportLogSheetName: '訓練匯出紀錄',
trainingImportMaxRows: 999,
trainingImportMaxAttachmentBytes: 20 * 1024 * 1024
```

`getTrainingImportConfig_()` must trim both properties, normalize and validate the recipient Email, and never return a client-supplied value.

`readTrainingImportSource_()` must use the same active/master bidirectional sheet lookup pattern as `buildMentionContext_()`. It must return display values for personnel, assignment, organization, training, progress, and existing export-log sheets; the log may be absent during preview.

Build the hash from a deterministic JSON array:

```javascript
const hashInput = JSON.stringify([
  snapshot.courseTitle,
  snapshot.recipientEmail,
  snapshot.attachmentName,
  snapshot.rows,
  snapshot.recipientGivenName,
  snapshot.senderGivenName
]);
const digest = Utilities.computeDigest(
  Utilities.DigestAlgorithm.SHA_256,
  hashInput,
  Utilities.Charset.UTF_8
);
return digest.map((byte) => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
```

`buildAuthoritativeTrainingImportPreview_()` must combine configuration, source reads, template validation, the Task 1 dataset, and the deterministic hash. Its internal result includes `source`, `context`, and `templateBlob`; `previewTrainingImportEmail()` must omit those three fields from the serializable response. Both public APIs must call `canAccessMention_(getCurrentUserEmail())` first and return `{ success: false, message }` from their catch blocks. Preview must validate the Drive template before setting `canSend: true`. It returns rows for the one selected course, never workbook bytes. Reject a source template or generated attachment larger than `trainingImportMaxAttachmentBytes`.

- [ ] **Step 4: Run preview, access-control, and report-export regressions**

Run:

```bash
node test/training-import-preview.test.js
node test/mention-access-control.test.js
node test/mention-export-report.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit the protected preview APIs**

```bash
git add code.js test/training-import-preview.test.js
git commit -m "Add training import preview APIs"
```

---

### Task 4: Idempotent ledger and single-attachment sending

**Files:**
- Create: `test/training-import-send.test.js`
- Modify: `code.js` after `previewTrainingImportEmail()`

**Interfaces:**
- Consumes: `TRAINING_IMPORT_LOG_HEADERS`, `buildTrainingImportUniqueKey_()`, `buildTrainingImportWorkbookBlob_()`, `verifyTrainingImportWorkbookBlob_()`, and the Task 3 preview snapshot/hash.
- Produces: `getOrCreateTrainingImportLogSheet_(spreadsheet)`.
- Produces: `reserveTrainingImportBatch_(sheet, snapshot, batchId, nowText)`.
- Produces: `updateTrainingImportBatchStatus_(sheet, batchId, status, values)`.
- Produces public RPC: `executeTrainingImportEmail(payload)` returning `{ success, batchId, sentCount, attachmentName, message }`.

- [ ] **Step 1: Write a failing send-state test**

Create a stateful sheet mock that records `appendRow`, `setValues`, and `SpreadsheetApp.flush()` calls. Create MailApp and LockService mocks that record ordering. Assert the successful path:

```javascript
const result = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: preview.previewHash
});

assert.strictEqual(result.success, true);
assert.strictEqual(result.sentCount, 4);
assert.strictEqual(sentMessages.length, 1);
assert.strictEqual(sentMessages[0].to, 'receiver@example.org');
assert.strictEqual(sentMessages[0].attachments.length, 1);
assert.strictEqual(sentMessages[0].attachments[0].getName(), 'importtemplate_v20260911.xlsx');
assert.strictEqual(snapshotRowsInAttachment.length, 4);
assert(eventOrder.indexOf('flush') < eventOrder.indexOf('sendEmail'));
assert(logRowsForBatch.every((row) => row[8] === '已寄出'));
assert.strictEqual(lockReleased, true);
```

Call execute again with a fresh preview and assert `sentMessages.length` remains `1` because every learner is already sent. Add cases for:

- A mismatched preview hash: no reservation and no mail.
- A concurrent `準備寄送` key: no duplicate learner row.
- A MailApp exception: every reserved row becomes `寄送失敗` and may appear in a later preview.
- A successful MailApp call followed by a log-update exception: rows remain `準備寄送` and are excluded from retry.
- Zero remaining quota: no reservation and no mail.
- `finally` always releases the script lock.

- [ ] **Step 2: Run the send test and verify the missing API failure**

Run:

```bash
node test/training-import-send.test.js
```

Expected: `ReferenceError` for `executeTrainingImportEmail`.

- [ ] **Step 3: Implement ledger transitions and one-email sending**

Create the ledger with the exact header row when absent, then flush. Reservation appends one row per pending learner with status `準備寄送` and the same batch ID.

Generate the batch ID with:

```javascript
const batchId = Utilities.getUuid();
```

Inside `executeTrainingImportEmail()`, resolve every authoritative value before reserving rows:

```javascript
const p = payload || {};
const viewerEmail = normalizeEmail_(getCurrentUserEmail());
if (!canAccessMention_(viewerEmail)) {
  return { success: false, message: '權限不足：您未被授權寄送教育訓練匯入檔。' };
}
const courseTitle = String(p.courseTitle || '').trim();
const previewHash = String(p.previewHash || '').trim().toLowerCase();
const lock = LockService.getScriptLock();
lock.waitLock(10000);
try {
  const snapshot = buildAuthoritativeTrainingImportPreview_(courseTitle);
  if (snapshot.previewHash !== previewHash) {
    throw new Error('預覽資料已變動，請重新預覽後再寄送。');
  }
  if (!snapshot.canSend || snapshot.rows.length === 0) {
    throw new Error('目前沒有可寄送的新完課資料。');
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('今日 MailApp 寄件配額不足。');
  }
  const logSheet = getOrCreateTrainingImportLogSheet_(snapshot.source.spreadsheet);
  const templateBlob = snapshot.templateBlob;
  const nowText = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
  const batchId = Utilities.getUuid();
  reserveTrainingImportBatch_(logSheet, snapshot, batchId, nowText);
  SpreadsheetApp.flush();
  const attachment = buildTrainingImportWorkbookBlob_(templateBlob, snapshot.rows, snapshot.attachmentName);
  verifyTrainingImportWorkbookBlob_(attachment, snapshot.rows);
  MailApp.sendEmail({
    to: snapshot.recipientEmail,
    subject: snapshot.subject,
    body: snapshot.textBody,
    htmlBody: snapshot.htmlBody,
    name: resolveDefaultMentionSenderName_(viewerEmail, snapshot.context),
    attachments: [attachment]
  });
  updateTrainingImportBatchStatus_(logSheet, batchId, '已寄出', {
    sentAt: nowText,
    updatedAt: nowText,
    error: ''
  });
  SpreadsheetApp.flush();
  return { success: true, batchId, sentCount: snapshot.rows.length, attachmentName: snapshot.attachmentName };
} finally {
  lock.releaseLock();
}
```

Track a local `mailAccepted` boolean initialized to `false` and set it to `true` immediately after `MailApp.sendEmail()` returns. Any workbook-build, verification, or MailApp error while `mailAccepted === false` changes all reserved rows to `寄送失敗`, because no email was accepted and retry is safe. If the later success-log update fails while `mailAccepted === true`, leave the rows as `準備寄送`; that is the duplicate-safe state required by the spec.

- [ ] **Step 4: Run send, existing mail, and authorization tests**

Run:

```bash
node test/training-import-send.test.js
node test/mention-sender-name.test.js
node test/authorize-mail-scope.test.js
node test/mention-group-selective-send.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit idempotent sending**

```bash
git add code.js test/training-import-send.test.js
git commit -m "Send deduplicated training import batches"
```

---

### Task 5: Course picker and read-only preview dialog

**Files:**
- Create: `test/training-import-frontend.test.js`
- Modify: `mention.html` in the header, before the existing notification preview modal, and in the inline script before the report-export section

**Interfaces:**
- Consumes RPCs: `listTrainingImportCourses()`, `previewTrainingImportEmail({ courseTitle })`, and `executeTrainingImportEmail({ courseTitle, previewHash })`.
- Produces DOM IDs: `training-import-btn`, `training-import-modal`, `training-import-course-select`, `training-import-recipient`, `training-import-subject`, `training-import-body`, `training-import-filename`, `training-import-summary`, `training-import-table-head`, `training-import-table-body`, `training-import-errors`, `training-import-cancel`, `training-import-confirm`.
- Produces frontend functions: `openTrainingImportModal()`, `loadTrainingImportPreview(courseTitle)`, `renderTrainingImportPreview(result)`, `confirmTrainingImportSend()`.

- [ ] **Step 1: Write a failing frontend structure and behavior test**

Create `test/training-import-frontend.test.js` and assert the static contract:

```javascript
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('mention.html', 'utf8');

[
  'training-import-btn',
  'training-import-modal',
  'training-import-course-select',
  'training-import-table-head',
  'training-import-table-body',
  'training-import-confirm'
].forEach((id) => assert(html.includes(`id="${id}"`), `缺少 #${id}`));

assert(html.includes('📨 寄送時數匯入檔'));
assert(html.includes('.listTrainingImportCourses()'));
assert(html.includes('.previewTrainingImportEmail({ courseTitle'));
assert(html.includes('.executeTrainingImportEmail({'));
assert(!html.includes('TRAINING_IMPORT_RECIPIENT_EMAIL ='));
```

Extract inline scripts into a VM with a mock DOM and mock `google.script.run`. Assert:

```javascript
sandbox.openTrainingImportModal();
assert.strictEqual(courseSelect.value, '');
assert.strictEqual(confirmButton.disabled, true);

courseSelect.value = '課程甲';
courseSelect.dispatchEvent({ type: 'change' });
assert.deepStrictEqual(previewCalls[0], { courseTitle: '課程甲' });

sandbox.renderTrainingImportPreview({
  success: true,
  canSend: true,
  courseTitle: '課程甲',
  previewHash: 'a'.repeat(64),
  rows: [new Array(14).fill('值')],
  headers: new Array(14).fill('欄位'),
  recipientEmail: 'receiver@example.org',
  subject: '主旨',
  htmlBody: '<p>內容</p>',
  attachmentName: 'importtemplate_v20260911.xlsx',
  counts: { pending: 1, sent: 0, preparing: 0, errors: 0 },
  errors: []
});
assert.strictEqual(tableBody.children.length, 1);
assert.strictEqual(confirmButton.disabled, false);

sandbox.confirmTrainingImportSend();
assert.deepStrictEqual(sendCalls[0], {
  courseTitle: '課程甲',
  previewHash: 'a'.repeat(64)
});
```

- [ ] **Step 2: Run the frontend test and verify missing markup/functions**

Run:

```bash
node test/training-import-frontend.test.js
```

Expected: assertion failure for missing `#training-import-btn`.

- [ ] **Step 3: Add the button, dedicated modal, and stateful RPC flow**

Place the new header button beside `#export-report-btn` and create a separate full-width modal so the existing `#preview-modal` stays untouched. The course select must start with:

```html
<option value="">請選擇要寄送的課程</option>
```

Maintain only server-returned preview state:

```javascript
const trainingImportState = {
  courseTitle: '',
  previewHash: '',
  canSend: false,
  loading: false
};
```

Escape every text cell before assigning HTML. Render the 14 headers and every returned row in one `<tbody>`; do not create per-learner tables. Keep the table inside `overflow-auto` with a sticky header. Assign only the server-provided HTML message to the read-only body preview.

On course change, clear `previewHash`, disable confirm, and request a fresh preview. `confirmTrainingImportSend()` must construct exactly:

```javascript
const payload = {
  courseTitle: trainingImportState.courseTitle,
  previewHash: trainingImportState.previewHash
};
```

Never include recipient, rows, subject, HTML body, names, filename, or counts in the execute payload. Disable close/confirm actions while sending, restore them on failure, and close the modal only after a successful response with `sentCount > 0`.

- [ ] **Step 4: Run frontend and existing page integration tests**

Run:

```bash
node test/training-import-frontend.test.js
node test/mention-frontend-ui.test.js
node test/mention-page-integration.test.js
node test/mention-export-report.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit the preview dialog**

```bash
git add mention.html test/training-import-frontend.test.js
git commit -m "Add training import preview dialog"
```

---

### Task 6: OAuth scope, deployment documentation, audit entry, and full verification

**Files:**
- Create: `test/training-import-deployment.test.js`
- Modify: `appsscript.json`
- Modify: `GEMINI.md`
- Modify: `AGENTS.md` under Event Log

**Interfaces:**
- Consumes: the two Script Property names and the Drive template requirement from Tasks 2–4.
- Produces: an explicit `drive.readonly` OAuth scope and operator setup instructions.

- [ ] **Step 1: Write the failing deployment-contract test**

Create `test/training-import-deployment.test.js`:

```javascript
const assert = require('assert');
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));
const docs = fs.readFileSync('GEMINI.md', 'utf8');
const code = fs.readFileSync('code.js', 'utf8');

assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.readonly'));
assert(code.includes("'TRAINING_IMPORT_RECIPIENT_EMAIL'"));
assert(code.includes("'TRAINING_IMPORT_TEMPLATE_FILE_ID'"));
assert(docs.includes('TRAINING_IMPORT_RECIPIENT_EMAIL'));
assert(docs.includes('TRAINING_IMPORT_TEMPLATE_FILE_ID'));
assert(docs.includes('importtemplate_vYYYYMMDD.xlsx'));
assert(docs.includes('不需要轉換成 Google Sheet'));
```

- [ ] **Step 2: Run the deployment test and verify the missing scope failure**

Run:

```bash
node test/training-import-deployment.test.js
```

Expected: assertion failure because `drive.readonly` is absent.

- [ ] **Step 3: Add the scope and exact deployment instructions**

Add this manifest entry without removing existing scopes:

```json
"https://www.googleapis.com/auth/drive.readonly"
```

Add a `GEMINI.md` section that tells the administrator to:

1. Upload `importtemplate_v20251226 (1).xlsx` to Drive without converting it.
2. Copy the Drive file ID into `TRAINING_IMPORT_TEMPLATE_FILE_ID`.
3. Put the fixed recipient Email into `TRAINING_IMPORT_RECIPIENT_EMAIL`.
4. Ensure that recipient Email and the deploying operator Email both map to Chinese names in columns A:B of `人員主檔`.
5. Share the template with the Web App execution account as Viewer.
6. Redeploy and approve the added read-only Drive scope.
7. Run one test send, open the resulting XLSX, and perform a target-system import to verify blank `certNo` is accepted.

Add an Event Log line dated `2026-09-11` summarizing the course picker, one-workbook/all-learners behavior, Drive template preservation, Script Properties, deduplication ledger, and tests.

- [ ] **Step 4: Run the deployment test and every repository test**

Run:

```bash
node test/training-import-deployment.test.js
for f in test/*.test.js; do node "$f" || exit 1; done
git diff --check
```

Expected: every test exits zero and `git diff --check` prints nothing.

- [ ] **Step 5: Perform structural and manual handoff checks**

Run:

```bash
rg -n "listTrainingImportCourses|previewTrainingImportEmail|executeTrainingImportEmail|TRAINING_IMPORT_RECIPIENT_EMAIL|TRAINING_IMPORT_TEMPLATE_FILE_ID|training-import-btn" code.js mention.html appsscript.json GEMINI.md
git diff -- code.js mention.html appsscript.json GEMINI.md AGENTS.md test
git status --short
```

Confirm from the diff that:

- Exactly one `MailApp.sendEmail()` call is made for a training-import batch.
- The attachment receives all `snapshot.rows` in the first worksheet.
- No client payload field can replace the recipient or rows.
- Existing notification and report-export handlers remain present.
- No production Spreadsheet ID, personal Email, or Drive file ID is committed.

Then verify in a GAS test deployment:

1. The new Drive scope authorization completes.
2. The course picker has no default selection.
3. Selecting a course shows all pending qualified learners in one 14-column table.
4. The email preview begins with the recipient's given name and ends with the operator's given name plus `敬上`.
5. One confirmation sends one email with one `importtemplate_vYYYYMMDD.xlsx` attachment.
6. The attachment opens in Excel with all qualified learners in `表1-匯入資料填寫區` and the other two sheets intact.
7. A second preview for the same course excludes the learners just sent.
8. The target system accepts the workbook, including blank `certNo`.

- [ ] **Step 6: Commit deployment documentation and verification coverage**

```bash
git add appsscript.json GEMINI.md AGENTS.md test/training-import-deployment.test.js
git commit -m "Document training import deployment"
```

---

## Completion Criteria

- The administrator explicitly selects one course.
- The preview and attachment contain every newly qualified learner for that course in one shared first worksheet.
- One confirmation produces one email and one template-preserving XLSX attachment.
- `已寄出` and `準備寄送` ledger rows prevent duplicates; `寄送失敗` rows can be retried.
- The server controls recipient, data, filename, names, subject, body, and attachment.
- All automated tests pass from a clean run.
- The GAS test deployment opens the file successfully and the target system accepts it.
