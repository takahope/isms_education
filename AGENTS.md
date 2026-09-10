# Repository Guidelines

## Project Structure & Module Organization
This repository contains a Google Apps Script (GAS) training web app. The active deployment target lives at the repository root:

- `code.js`: GAS backend entry points such as `doGet()`, account lookup helpers, and spreadsheet write logic.
- `index.html`: single-page frontend with inline CSS and client-side video/quiz flow.
- `env.js`: environment-specific constants such as `ENV.MASTER_SHEET_ID`.
- `GEMINI.md`: project overview and deployment notes.
- `example/`: reference and legacy sample material, not the primary deployment target.
- `conductor/`: planning notes and refactor documents, not runtime code.

Keep frontend and backend changes in sync. If you change the submission payload in `index.html`, update the corresponding handling and sheet write logic in `code.js` in the same change.

## Build, Test, and Development Commands
There is no local build pipeline or package manager configured. Development is done by editing files here and pasting or syncing them into Google Apps Script.

- `git status --short`: review pending changes before editing or deploying.
- `git diff -- code.js index.html env.js AGENTS.md`: inspect the main app files together.
- `rg "submitTrainingResult|getCurrentUserEmail|getUserNameByEmail|google.script.run|MASTER_SHEET_ID"`: trace key integration points quickly.

Run and verify through a GAS web app deployment bound to a Google Sheet. Use the steps in `GEMINI.md` as the baseline deployment flow.

## Coding Style & Naming Conventions
Use 2-space indentation in both JavaScript and HTML. Prefer simple vanilla JavaScript with inline CSS/JS in GAS HTML files, matching the current app structure. Keep user-facing text in Traditional Chinese (`zh-TW`). Use comments sparingly and keep them consistent within the file being edited.

Use:

- `camelCase` for variables and functions, for example `getCurrentUserEmail`.
- clear uppercase constants in frontend scripts, for example `PASSING_SCORE`.
- descriptive sheet/tab names such as `訓練紀錄` and `人員主檔`.

## Configuration Notes
- `env.js` is required for environment-specific configuration. Keep production IDs and similar values there, not in `index.html`.
- `ENV.MASTER_SHEET_ID` must point to a Google Spreadsheet that contains a `人員主檔` sheet.
- The current backend expects `人員主檔` column A to contain user email addresses and column B to contain display names.
- Treat `example/` as reference material only. Do not update deployment instructions to point there unless the active app is intentionally moved.

## Backend / Frontend Contract
- `doGet()` must continue serving `index` unless you intentionally rename the HTML file and update both sides together.
- `submitTrainingResult(data)` currently expects `userName`, `videoTitle`, `score`, and `isPassed`.
- The `userName` field currently carries the user email. If you rename or normalize that payload key, update both `index.html` and `code.js` together.
- Preserve the `訓練紀錄` sheet output contract unless the sheet schema change is part of the task. The current columns are timestamp, name, email, course title, score, and result.

## Testing Guidelines
No automated test framework is configured yet. Validate changes manually in the deployed Apps Script web app.

Before opening a PR, verify:

1. `doGet()` loads `index.html` without filename mismatches.
2. `env.js` is present and `ENV.MASTER_SHEET_ID` points to a reachable spreadsheet.
3. `getCurrentUserEmail()` returns the expected account in the deployed environment.
4. `getUserNameByEmail()` resolves names correctly from `人員主檔`.
5. quiz submission writes the expected six columns into `訓練紀錄`.
6. video anti-fast-forward, idle confirmation, blur/visibility pause, unlock flow, and `localStorage` resume behavior still work in browser.

## Commit & Pull Request Guidelines
Follow the existing Git history: short, imperative English subjects such as `Add initial implementation of backend logic`. Keep commits focused on one change.

PRs should include:

- a brief summary of user-visible behavior;
- any Google Sheet or Apps Script deployment changes;
- screenshots for UI edits;
- manual test notes covering submission and result storage.

## Security & Configuration Tips
Avoid hardcoding spreadsheet IDs, personal data, or secrets in the frontend. Treat all client data as untrusted and validate it in `code.js` before writing to Sheets.
- Keep external spreadsheet IDs in `env.js` or Apps Script-managed configuration, not in client-side code.
- Be careful when sharing docs or screenshots not to expose production spreadsheet IDs, user emails, or internal training data.

## Event Log
- 2026-09-09: Enhanced case collection group (`GRP-CO`) layered notification to distinguish "副組長" (deputy group leader) from "組長". Updated `classifyCaseStaffLeadRole_` and `buildCaseStaffTeamLeadRecipients_` in `dashboard/code.js` to rank and classify titles. Merged team leads into single dual-To recipient in `selectCaseStaffLayeredRecipients_` so both leaders receive the same email. Added dynamic `{{組長姓名}}` greeting resolution in `applyLayeredNotificationTemplate_` (resolving to "收案組組長、副組長 您好："). Updated `dashboard/dashboard.html` labels and placeholders to reflect "收案組主管（組長/副組長）".
- 2026-09-09: Added "排除育嬰假" (Exclude Parental Leave) checkbox in dashboard notification mail filtering (`dashboard/dashboard.html` and `dashboard/code.js`). Default checked; auto-unchecks when switching to `parental_leave_personalized` template or selecting "育嬰假" status. Updated `selectNotificationRecipients_` and `selectCaseStaffLayeredRecipients_` to filter out parental leave personnel, and appended label in `通知紀錄`. Created unit test `test/exclude-parental-leave-notification.test.js`.
- 2026-09-09: Added "排除育嬰假" (Exclude Parental Leave) quick filter checkbox in `dashboard/dashboard.html`. Default checked; dynamically recalculates metrics in "整體訓練概況" (KPI cards, ribbon) and filters learner table, risk list, and exported report summary. Created unit test `test/exclude-parental-leave-filter.test.js`.
- 2026-09-09: Added "排除 outside" (Exclude Outside Location) checkbox in both notification panel and quick filter panel (`dashboard/dashboard.html` and `dashboard/code.js`). Default checked; dynamically recalculates "整體訓練概況" KPIs, filters learner table, updates report export, and excludes outside staff in direct and layered mailings. Created unit test `test/exclude-outside-filter-and-notification.test.js`.
- 2026-09-09: Added organization-wide group notifications by role/group: "全組織各組初次通知" (`org_group_initial`) and "全組織各組未完成通知" (`org_group_reminder`). Emails sent per group with members in To and group leads (from orgNode.managerEmail and leader titles) in CC. Incomplete reminders automatically skip groups where all members completed and render an HTML table of incomplete members. Defaults to excluding parental leave and outside location, and selecting active personnel. Created unit test `test/org-group-notification.test.js`.
- 2026-09-09: Filtered organization-wide group notifications to scan only groups with level >= 5 in "組織架構樹" (B 欄位層級在 5 之後). Added `resolveLearnerLevel5OrgCode_` in `dashboard/code.js` to map learners to valid operational units and exclude top-tier leadership groups (levels 1-4) and executive CCs. Updated `dashboard/dashboard.html` criteria display and unit tests in `test/org-group-notification.test.js`.
- 2026-09-09: Added multi-group preview selector dropdown (#preview-group-select) to mail preview panel in dashboard/dashboard.html for org-wide group notifications (org_group_initial and org_group_reminder). Users can now switch between all scanned operational groups to preview individual group email subject, To member names/count, CC lead names/count, and HTML body (including incomplete learner table). Automatically hides when non-group templates are selected. Updated test/org-group-notification.test.js with comprehensive mock DOM preview and switching tests.
- 2026-09-09: Excluded executive administrative personnel (orgNode.type === '行政' and level 1-4 in "組織架構樹") from org-wide group notifications. Added hasExecutiveAdminAssignment_ in dashboard/code.js to inspect all assignments; if staff holds any administrative role with level < 5, they are excluded from group learner To and CC leads, even if concurrently holding a level >= 5 role/title. Verified non-admin committees remain included. Updated test/org-group-notification.test.js.
- 2026-09-09: Included "合作單位" (Partner Units) in notification mailing scope while keeping dashboard overview and filter dropdown clean. Updated isExcludedPersonnelStatus_ and buildDashboardContext_ in dashboard/code.js with options.includePartnerUnits to load partner unit staff only during notification sending/preview. Updated selectOrgGroupRecipients_ to include any org node with type === '合作單位' regardless of tree level B, and granted exemption for partner staff from generic personnel status mismatch. Updated test/org-group-notification.test.js.
- 2026-09-09: Removed supervisor CC notice sentence ("※ 本信件同步副本（CC）該組組主管，敬請主管協助關心督導。") from org-wide group reminder template (buildOrgGroupReminderTemplate_) in dashboard/code.js. Updated test/org-group-notification.test.js with assertion.
- 2026-09-09: Added customizable training deadline date picker (`#notify-deadline-date`, default `YYYY-08-30`) in notification form (`dashboard/dashboard.html`). Formats date into Traditional Chinese `YYYY 年 M 月 D 日` via `formatChineseDeadlineDate_` and dynamically replaces `{{修課期限}}` across email templates and preview summaries in `dashboard/code.js`. Created unit test `test/deadline-date-notification.test.js`.
- 2026-09-09: Added "長官主管未完成通知" (`leadership_reminder`) template in `dashboard/dashboard.html` and `dashboard/code.js`. Targets personnel holding any primary or concurrent role in "組織架構樹" with type === '行政' and level <= 4 (`hasExecutiveAdminAssignment_`) who have incomplete training status. Supports delivery mode switching between individual personalized, single BCC, and direct visible modes. Supports parental leave and outside location exclusions, and integrates with customizable deadline date. Created unit test `test/leadership-reminder-notification.test.js`.
- 2026-09-09: Added "排除倫理委員會" (Exclude Ethics Committee) checkbox in dashboard notification mail filtering (`dashboard/dashboard.html` and `dashboard/code.js`). Default checked; auto-unchecks when selecting "倫理委員會" status. Added `isEthicsCommitteeMember_` in `dashboard/code.js` to inspect `personnelStatus`, `assignmentOrgCode` (`EGC`), `assignmentOrgName`, `assignmentTitle`, and concurrent `assignments`. Applied filtering across `selectNotificationRecipients_`, `selectOrgGroupRecipients_`, and `selectCaseStaffLayeredRecipients_`. Recorded in `通知紀錄`. Created unit test `test/exclude-ethics-committee-notification.test.js`.
- 2026-09-09: Fixed mention context data pipeline column mapping in `code.js` (`buildMentionContext_`). Corrected "組織架構樹" column alignment (A: type, B: level, C: code, D: name, G: managerEmail), "人員職務配置" role mapping, and "觀看進度" seconds index (column 4). Added `getSheetSafe` bidirectional fallback between masterSS and activeSS and excluded resigned personnel (`personnelStatus === '離職'`). Created unit test `test/mention-real-sheet-structure.test.js`.
- 2026-09-09: Updated mention notification flow and exclusion rules. Removed direct send button (#btn-send) from `mention.html` form, restricting mail execution to preview confirmation modal (#btn-modal-confirm-send). Added "排除委外廠商" (Exclude Vendor) checkbox to `mention.html` and updated `code.js` (`selectMentionRecipients_`, `selectMentionOrgGroupRecipients_`, `appendMentionNotificationLog_`) to exclude personnelStatus === '委外廠商' by default. Created unit tests in `test/mention-frontend-ui.test.js` and `test/mention-exclude-vendor.test.js`.
- 2026-09-09: Fixed vendor exclusion bug and default checkbox state in mention notifications. Added multi-dimensional `isVendorPersonnel_` in `code.js` checking personnelStatus ('委外'/'委外廠商'/'合作'/'合作廠商'/includes), external contractor station code ('GRP-CO-EX-*'), title, and assignments. Updated `selectMentionOrgGroupRecipients_` to skip vendor groups and vendor CC leads. Modified `applyInitialData` in `mention.html` to defensively default exclude checkboxes to true (`!== false`) to prevent cache/undefined unchecking. Updated `test/mention-exclude-vendor.test.js` and `test/mention-frontend-ui.test.js`.
- 2026-09-10: Aligned `org_group_reminder` in `mention.html` and `code.js` to original dashboard text and case collection hierarchy. In case collection (`GRP-CO` and stations), uncompleted members are in To, and CC strictly orders組長 (rank 1), 副組長 (rank 2), and station managers, with To/CC deduplication. Aligned wording from "主管" to "組長" across UI and email templates. Aligned email subject ("未完成同仁催課通知"), body HTML (70% passing score, deadlines, watch/login reminders, auto-reply footer), and table headers ("受訓狀態", "觀看進度", "測驗成績"). Created unit test `test/mention-org-group-case-staff-align.test.js`.
- 2026-09-10: Updated training reminder email table header from "測驗成績" to "測驗狀態" across `code.js` and `dashboard/code.js` in `buildOrgGroupIncompleteListHtml_`. Enhanced score rendering logic so learners with 0 or no score display "尚未測驗" instead of "0分", while displaying actual scores (>0) when available. Updated unit tests in `test/mention-org-group-case-staff-align.test.js`.
- 2026-09-10: Added shadow capability URL authentication (HMAC-SHA256) and mention preview badge. In `code.js`, implemented `generateCapabilityToken_`, `verifyCapabilityToken_`, `validateLearnerCapabilityAccess_`, and `resolveAuthenticatedUser_` to allow executives on `EMAIL_SHADOW_MAP` to access training, log progress, and submit quizzes via personal Gmail without Google Workspace login, while recording results under their official email and name. Updated `executeMentionNotification` to target-dispatch capability URLs (`?op=...&auth=...`). Updated `mention.html` preview modal to mark shadow recipients with `[🪞 雙軌]` badge without leaking personal email addresses. Updated `doGet(e)` to inject `template.authContext` and `index.html` to render soft identity banner (`#shadow-auth-banner`). Created unit and integration tests in `test/shadow-capability-auth.test.js`, `test/mention-shadow-preview-and-dispatch.test.js`, and `test/shadow-student-flow.test.js`.
- 2026-09-10: Added selective group notification sending (Option A) to `mention.html` and `code.js`. Added `#preview-group-checklist-container` with select all/deselect all buttons and checkboxes in preview modal. Synchronized checklist items with preview selector. Added `selectedGroupCodes` validation and filtering in `executeMentionNotification` to ensure emails are sent only to checked groups, preventing accidental bulk dispatch and accurately logging recipient and group counts. Created unit test `test/mention-group-selective-send.test.js`.
- 2026-09-10: Fixed client-side `ReferenceError: escapeHtml_ is not defined` in `mention.html`. Declared `escapeHtml_` and `escapeHtml` in front-end script, and wrapped `renderPreview` inside `try...catch` block to prevent modal silent dismissal on render error. Updated unit test `test/mention-frontend-ui.test.js`.
- 2026-09-10: Aligned notification email footer window to original dashboard spec ("專案規劃組(策略組)") across `code.js` and `mention.html`. Replaced legacy text ("資訊安全小組承辦人") with "此為自動發送之通知信件，無需直接回覆。<br>如有任何問題，請聯絡專案規劃組(策略組)。" in `buildNotificationAutoReplyFooterHtml_` and local mock templates. Updated unit test in `test/mention-org-group-case-staff-align.test.js`.
- 2026-09-10: Fixed `MailApp.sendEmail` `Invalid email: ""` failure when group has no CC manager. Updated `code.js` to omit `cc` field when `ccEmails` is empty instead of passing empty string. Updated backend return status so `sentGroupsCount === 0` marks `success: false` with explicit error message, and updated `mention.html` to alert failures rather than falsely claiming success. Updated unit test `test/mention-group-selective-send.test.js`.
- 2026-09-10: Resolved missing `MailApp.sendEmail` OAuth authorization exception in root project. Added root `appsscript.json` with explicit `oauthScopes` (`script.send_mail`, `spreadsheets`, `script.scriptapp`, `userinfo.email`). Added `authorizeMailAppScope()` in `code.js` to allow admins to trigger the Google OAuth consent flow once in Apps Script Editor. Created unit test `test/authorize-mail-scope.test.js`.
- 2026-09-10: Implemented targeted capability URL dispatch for shadow recipients. In `code.js`, separated official group/individual emails from private Gmail forwardings. Official group mailings strictly exclude private emails to prevent PII exposure, while shadow recipients receive dedicated forwarding emails featuring `buildLearnerCapabilityUrl_` (`?op=...&auth=...`) and an amber notification banner. Supported in both `org_group_reminder` and `leadership_reminder`. Created unit test `test/mention-shadow-capability-dispatch.test.js`.
- 2026-09-10: Fixed shadow recipient emails missing HMAC Capability URLs in real GAS execution. Diagnosed 3 root causes: (1) `mention.html` sending `googleusercontent.com` iframe sandbox URL as `courseUrl`, polluting server base URL and breaking string match; (2) brittle `split(courseUrl).join(capUrl)` string matching; (3) group CC leads downgraded to plain URL when completed. Implemented `resolveBaseCourseUrl_` to enforce `ScriptApp.getService().getUrl()` and filter sandbox domains, added regex-based `injectCapabilityUrlIntoHtmlBody_` to robustly override all "前往上課" links, and ensured all shadow leads receive signed tokens. Updated `test/mention-shadow-capability-dispatch.test.js`.
- 2026-09-10: Fixed client-side `ReferenceError: htmlBody is not defined` in `mention.html` during `getFormPayload()`. Inadvertently omitted `const htmlBody = document.getElementById('mention-body').value.trim();` during sandbox URL patch caused the preview button click listener to throw reference error before displaying the SweetAlert loading popup. Restored `htmlBody` definition and added execution assertion in `test/mention-frontend-ui.test.js`.
- 2026-09-10: Added `DASHBOARD_ALLOWED_EMAILS` access control to `mention.html` and its backend endpoints. In `code.js`, implemented `getDashboardAllowedEmails_()`, `canAccessMention_()`, and `buildMentionAccessDeniedHtml_()`. Enforced default-deny authorization on `doGet(?page=mention)` and backend RPCs (`getMentionInitialData`, `previewMentionNotification`, `executeMentionNotification`). Updated `mention.html` with operator email display and unauthorized alert handling. Created unit test `test/mention-access-control.test.js`.
- 2026-09-10: Added `debugGetLeaderProfile` backend API and `window.testLeader(email)` frontend debug helper to `code.js` and `mention.html`. Enables administrators to test and verify any executive's department name (`assignmentOrgName`), job title (`assignmentTitle`), executive admin qualification (`isExecutiveAdmin`), multi-assignment list, training status, shadow mailbox config, and real-time rendered email template via browser DevTools Console (F12) without being blocked by training completion status. Created unit test `test/debug-leader-profile.test.js`.
- 2026-09-11: Completed code review for uncommitted keyword replacements. Fixed grammatical truncation ("皆無待人員" to "皆無待通知人員", "進行（" to "進行通知（", "（無任何組別需要）" to "（無任何組別需要通知）") across `code.js` and `mention.html`. Synchronized banner title assertion to "非公務信箱專屬轉派通知" in `test/debug-leader-profile.test.js` and aligned frontend fallback template with standard login reminders. Verified all 40 test suites pass.
