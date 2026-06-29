const DASHBOARD_CONFIG = {
  allowedEmailsPropertyKey: 'DASHBOARD_ALLOWED_EMAILS',
  notificationAllowedEmailsPropertyKey: 'DASHBOARD_NOTIFICATION_ALLOWED_EMAILS',
  requiredWatchSeconds: 60 * 60,
  recentActivityDays: 7,
  defaultCourseTitle: '資安暨個資教育訓練',
  maxAlertItems: 8,
  personnelSheetName: '人員主檔',
  orgSheetName: '組織架構樹',
  assignmentSheetName: '人員職務配置',
  trainingRecordSheetName: '訓練紀錄',
  progressSheetName: '觀看進度',
  notificationLogSheetName: '通知紀錄'
};

const NOTIFICATION_CASE_STAFF_VIRTUAL_ORG_CODE = '__CASE_STAFF__';

const TRAINING_SHEET_HEADERS = {
  訓練紀錄: ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  觀看進度: ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間', '最後同步來源版本'],
  通知紀錄: ['時間戳記', '操作者信箱', '課程名稱', '範本類型', '寄送方式', '組織類型', '層級', '組別代碼', '包含下層', '狀態篩選', '人員狀態篩選', '主旨', '收件人數', '成功數', '略過數']
};

function doGet() {
  return renderDashboardPage_();
}

function authorizeDashboardProject() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  const properties = PropertiesService.getScriptProperties();
  const allowedEmailsRaw = properties.getProperty(DASHBOARD_CONFIG.allowedEmailsPropertyKey) || '';
  const notificationAllowedRaw = properties.getProperty(DASHBOARD_CONFIG.notificationAllowedEmailsPropertyKey) || '';
  const masterSS = getMasterSpreadsheet_();
  const trainingSS = getTrainingSpreadsheet_();

  return {
    success: true,
    viewerEmail,
    allowedEmailsPropertyKey: DASHBOARD_CONFIG.allowedEmailsPropertyKey,
    allowedEmailsConfigured: Boolean(String(allowedEmailsRaw).trim()),
    notificationAllowedEmailsPropertyKey: DASHBOARD_CONFIG.notificationAllowedEmailsPropertyKey,
    notificationAllowedEmailsConfigured: Boolean(String(notificationAllowedRaw).trim()),
    masterSpreadsheetId: masterSS.getId(),
    masterSpreadsheetName: masterSS.getName(),
    trainingSpreadsheetId: trainingSS.getId(),
    trainingSpreadsheetName: trainingSS.getName()
  };
}

function authorizeDashboardMailAccess() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  try {
    const mailQuota = MailApp.getRemainingDailyQuota();
    return {
      success: true,
      viewerEmail,
      mailQuota,
      dashboardUrl: buildDashboardUrl_(),
      message: '寄信權限已授權，可重新測試通知寄送。'
    };
  } catch (error) {
    return {
      success: false,
      viewerEmail,
      message: `寄信權限授權失敗：${error && error.message ? error.message : String(error)}。請在 Apps Script 編輯器手動執行 authorizeDashboardMailAccess() 並完成 Google 授權。`
    };
  }
}

function checkDashboardMailAccess() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  try {
    const mailQuota = MailApp.getRemainingDailyQuota();
    return {
      success: true,
      viewerEmail,
      mailQuota,
      message: '目前寄信權限可用。'
    };
  } catch (error) {
    return {
      success: false,
      viewerEmail,
      message: `目前尚未取得寄信權限：${error && error.message ? error.message : String(error)}。請在 Apps Script 編輯器手動執行 authorizeDashboardMailAccess() 並完成 Google 授權。`
    };
  }
}

function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (error) {
    return '';
  }
}

function getTrainingDashboardBootstrap() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return buildDashboardPermissionResponse_(viewerEmail, false, '您沒有查看學員訓練儀表板的權限。');
  }

  return {
    success: true,
    authorized: true,
    viewerEmail,
    requiredWatchSeconds: DASHBOARD_CONFIG.requiredWatchSeconds,
    dashboardUrl: buildDashboardUrl_(),
    courseTitle: DASHBOARD_CONFIG.defaultCourseTitle,
    canSendNotifications: canSendDashboardNotifications_(viewerEmail)
  };
}

function getTrainingDashboardData(filters) {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return buildDashboardPermissionResponse_(viewerEmail, false, '您沒有查看學員訓練儀表板的權限。');
  }

  try {
    const payload = buildTrainingDashboardData_(filters);
    return {
      success: true,
      authorized: true,
      viewerEmail,
      ...payload
    };
  } catch (error) {
    console.error('載入訓練儀表板失敗:', error);
    return buildDashboardPermissionResponse_(
      viewerEmail,
      true,
      error && error.message ? error.message : '無法載入訓練儀表板資料。'
    );
  }
}

function getTrainingNotificationBootstrap() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return buildDashboardPermissionResponse_(viewerEmail, false, '您沒有查看學員訓練儀表板的權限。');
  }
  if (!canSendDashboardNotifications_(viewerEmail)) {
    return buildDashboardPermissionResponse_(viewerEmail, true, '您目前沒有寄送課程通知的權限。');
  }

  const context = buildDashboardContext_();
  const orgOptions = buildNotificationOrgOptions_(context.orgNodes);

  return {
    success: true,
    authorized: true,
    viewerEmail,
    canSendNotifications: true,
    dashboardUrl: buildDashboardUrl_(),
    courseTitle: context.courseTitle,
    placeholderTokensByTemplateType: {
      personalized: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      case_staff_personalized: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      parental_leave_personalized: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      announcement: ['{{課程名稱}}', '{{上課網址}}'],
      group_announcement: ['{{組別稱呼}}', '{{課程名稱}}', '{{上課網址}}'],
      station_manager_announcement: ['{{駐站管理稱呼}}', '{{課程名稱}}', '{{上課網址}}'],
      leadership_announcement_summary: ['{{課程名稱}}', '{{上課網址}}'],
      leadership_announcement: ['{{課程名稱}}', '{{上課網址}}'],
      case_staff_layered_reminder: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{駐站列表}}', '{{駐站管理員姓名}}', '{{組長姓名}}', '{{未完成人員名單}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}']
    },
    placeholderTokensByTemplateAndDeliveryMode: buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_(),
    defaultDeliveryModeByTemplateType: buildDefaultDeliveryModeByTemplateType_(),
    defaultTemplateType: 'personalized',
    templates: buildNotificationTemplates_(context.courseTitle),
    templatesByDeliveryMode: buildNotificationTemplatesByDeliveryMode_(context.courseTitle),
    orgOptions,
    personnelStatusOptions: context.personnelStatusOptions
  };
}

function previewTrainingNotification(payload) {
  return executeTrainingNotification_(payload, { dryRun: true });
}

function sendTrainingNotification(payload) {
  return executeTrainingNotification_(payload, { dryRun: false });
}

function safeMailQuota_() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (error) {
    return 'N/A:' + (error && error.message ? error.message : String(error));
  }
}

function renderDashboardPage_() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return HtmlService.createHtmlOutput(buildDashboardAccessDeniedHtml_(viewerEmail))
      .setTitle('學員訓練儀表板')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createHtmlOutputFromFile('dashboard')
    .setTitle('學員訓練儀表板')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function canAccessDashboard_(viewerEmail) {
  const normalizedViewerEmail = normalizeEmail_(viewerEmail);
  if (!normalizedViewerEmail) return false;
  return getDashboardAllowedEmails_().includes(normalizedViewerEmail);
}

function canSendDashboardNotifications_(viewerEmail) {
  const normalizedViewerEmail = normalizeEmail_(viewerEmail);
  if (!normalizedViewerEmail) return false;
  const explicitAllowed = getDashboardNotificationAllowedEmails_();
  if (explicitAllowed.length === 0) return getDashboardAllowedEmails_().includes(normalizedViewerEmail);
  return explicitAllowed.includes(normalizedViewerEmail);
}

function getDashboardAllowedEmails_() {
  return parseEmailListProperty_(DASHBOARD_CONFIG.allowedEmailsPropertyKey);
}

function getDashboardNotificationAllowedEmails_() {
  return parseEmailListProperty_(DASHBOARD_CONFIG.notificationAllowedEmailsPropertyKey);
}

function parseEmailListProperty_(propertyKey) {
  const raw = PropertiesService.getScriptProperties().getProperty(propertyKey) || '';
  return raw
    .split(/[\n,;]+/)
    .map((item) => normalizeEmail_(item))
    .filter(Boolean);
}

function buildDashboardUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    return '';
  }
}

function buildDashboardAccessDeniedHtml_(viewerEmail) {
  const safeEmail = escapeHtml_(viewerEmail || '未登入帳號');
  const propertyKey = escapeHtml_(DASHBOARD_CONFIG.allowedEmailsPropertyKey);
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>學員訓練儀表板</title>
  <style>
    :root {
      --bg: #eef4f7;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --line: rgba(15, 23, 42, 0.08);
      --warn: #b91c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: "Noto Sans TC", system-ui, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 28%),
        linear-gradient(180deg, #f8fbfc 0%, var(--bg) 100%);
      color: var(--text);
    }
    .panel {
      width: min(560px, 100%);
      padding: 28px;
      border-radius: 24px;
      background: var(--card);
      border: 1px solid var(--line);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
    }
    .eyebrow {
      display: inline-flex;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(185, 28, 28, 0.08);
      color: var(--warn);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 18px 0 10px;
      font-size: 28px;
      line-height: 1.2;
    }
    p {
      margin: 0 0 14px;
      color: var(--muted);
      line-height: 1.7;
    }
    code {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.06);
      color: #0f766e;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main class="panel">
    <div class="eyebrow">Access Restricted</div>
    <h1>您目前沒有查看學員訓練儀表板的權限</h1>
    <p>目前登入帳號：<code>${safeEmail}</code></p>
    <p>請在這個 dashboard 專案的 Apps Script Script Properties 設定 <code>${propertyKey}</code>，並將允許進入儀表板的 email 白名單加入後重新整理頁面。</p>
  </main>
</body>
</html>`;
}

function buildTrainingDashboardData_() {
  const context = buildDashboardContext_();
  return {
    generatedAt: new Date().toISOString(),
    courseTitle: context.courseTitle,
    requiredWatchSeconds: DASHBOARD_CONFIG.requiredWatchSeconds,
    kpis: buildDashboardKpis_(context.learners, new Date()),
    units: buildDashboardUnitSummary_(context.learners),
    alerts: buildDashboardAlerts_(context.learners, new Date()),
    learners: context.learners
  };
}

function buildDashboardContext_() {
  const masterSS = getMasterSpreadsheet_();
  const trainingSS = getTrainingSpreadsheet_();
  const personnelSheet = getRequiredSheet_(masterSS, DASHBOARD_CONFIG.personnelSheetName);
  const assignmentSheet = getOptionalSheet_(masterSS, DASHBOARD_CONFIG.assignmentSheetName);
  const orgSheet = getOptionalSheet_(masterSS, DASHBOARD_CONFIG.orgSheetName);

  const personnelRows = personnelSheet.getDataRange().getDisplayValues();
  const assignments = assignmentSheet ? readAllAssignments_(assignmentSheet) : [];
  const orgNodes = orgSheet ? readOrgNodes_(orgSheet) : [];
  const orgNodeMap = buildOrgNodeMap_(orgNodes);
  const assignmentSummaries = buildDashboardAssignmentSummaryByEmail_(assignments, orgNodeMap);
  const trainingRecords = loadTrainingRecords_(trainingSS);
  const progressRecords = loadProgressRecords_(trainingSS);
  const quizByEmail = buildQuizSummaryByEmail_(trainingRecords);
  const progressByEmail = buildProgressSummaryByEmail_(progressRecords);
  const learners = [];
  const personnelStatusOptions = collectPersonnelStatusOptions_(personnelRows);

  for (let i = 1; i < personnelRows.length; i += 1) {
    const email = normalizeEmail_(personnelRows[i][0]);
    if (!email) continue;
    const name = String(personnelRows[i][1] || '').trim();
    const personnelStatus = String(personnelRows[i][2] || '').trim();
    const assignment = assignmentSummaries.get(email) || createEmptyAssignmentSummary_();
    const quiz = quizByEmail.get(email) || createEmptyQuizSummary_();
    const progress = progressByEmail.get(email) || createEmptyProgressSummary_();
    const watchedPercent = DASHBOARD_CONFIG.requiredWatchSeconds > 0
      ? Math.min(100, Math.round((progress.watchedSecondsCount / DASHBOARD_CONFIG.requiredWatchSeconds) * 100))
      : 0;
    const watchCompleted = progress.watchedSecondsCount >= DASHBOARD_CONFIG.requiredWatchSeconds;
    const status = resolveLearnerTrainingStatus_(watchCompleted, quiz.hasPassed, progress.watchedSecondsCount, quiz.attemptCount);
    const lastActivityAt = getLatestTimestampString_(progress.updatedAt, quiz.latestAttemptAt);

    learners.push({
      email,
      name,
      personnelStatus,
      assignmentLabel: assignment.assignmentLabel,
      assignmentType: assignment.assignmentType,
      assignmentOrgCode: assignment.assignmentOrgCode,
      assignmentOrgName: assignment.assignmentOrgName,
      assignmentOrgLevel: assignment.assignmentOrgLevel,
      assignmentOrgType: assignment.assignmentOrgType,
      assignmentTitle: assignment.assignmentTitle,
      watchedSecondsCount: progress.watchedSecondsCount,
      watchedPercent,
      watchCompleted,
      watchedRanges: progress.watchedRanges,
      lastPlaybackPosition: progress.lastPlaybackPosition,
      progressUpdatedAt: progress.updatedAt,
      bestScore: quiz.bestScore,
      latestScore: quiz.latestScore,
      latestResult: quiz.latestResult,
      latestAttemptAt: quiz.latestAttemptAt,
      hasPassed: quiz.hasPassed,
      attemptCount: quiz.attemptCount,
      courseTitle: quiz.courseTitle || progress.videoTitle || DASHBOARD_CONFIG.defaultCourseTitle,
      status,
      statusLabel: getLearnerStatusLabel_(status),
      lastActivityAt,
      hasAnyActivity: Boolean(progress.watchedSecondsCount > 0 || quiz.attemptCount > 0)
    });
  }

  learners.sort((left, right) => {
    const statusDiff = getDashboardStatusSortOrder_(left.status) - getDashboardStatusSortOrder_(right.status);
    if (statusDiff !== 0) return statusDiff;
    const activityDiff = compareDashboardTimestamps_(right.lastActivityAt, left.lastActivityAt);
    if (activityDiff !== 0) return activityDiff;
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-Hant');
  });

  return {
    learners,
    assignments,
    orgNodes,
    orgNodeMap,
    courseTitle: resolveDashboardCourseTitle_(learners),
    personnelStatusOptions
  };
}

function collectPersonnelStatusOptions_(personnelRows) {
  const seen = new Set();
  const options = [];
  for (let i = 1; i < personnelRows.length; i += 1) {
    const status = String(personnelRows[i][2] || '').trim();
    if (!status || seen.has(status)) continue;
    seen.add(status);
    options.push(status);
  }
  return options;
}

function readAllAssignments_(sheet) {
  const rows = sheet.getDataRange().getDisplayValues();
  const assignments = [];
  for (let i = 1; i < rows.length; i += 1) {
    const email = normalizeEmail_(rows[i][0]);
    if (!email) continue;
    assignments.push({
      rowIndex: i + 1,
      email,
      name: String(rows[i][1] || '').trim(),
      orgCode: String(rows[i][2] || '').trim(),
      orgName: String(rows[i][3] || '').trim(),
      title: String(rows[i][4] || '').trim(),
      managerEmail: normalizeEmail_(rows[i][5]),
      managerName: String(rows[i][6] || '').trim()
    });
  }
  return assignments;
}

function readOrgNodes_(sheet) {
  const rows = sheet.getDataRange().getDisplayValues();
  const nodes = [];
  for (let i = 1; i < rows.length; i += 1) {
    const code = String(rows[i][2] || '').trim();
    if (!code) continue;
    nodes.push({
      rowIndex: i + 1,
      type: String(rows[i][0] || '').trim(),
      level: Number(rows[i][1] || 0),
      code,
      name: String(rows[i][3] || '').trim(),
      alias: String(rows[i][4] || '').trim(),
      parentCode: String(rows[i][5] || '').trim(),
      managerEmail: normalizeEmail_(rows[i][6]),
      managerName: String(rows[i][7] || '').trim()
    });
  }
  return nodes;
}

function buildOrgNodeMap_(orgNodes) {
  const map = new Map();
  orgNodes.forEach((node) => {
    map.set(normalizeOrgCode_(node.code), node);
  });
  return map;
}

function buildDashboardAssignmentSummaryByEmail_(assignments, orgNodeMap) {
  const assignmentTypeMap = buildAssignmentTypeMap_(assignments);
  const grouped = new Map();

  assignments.forEach((assignment) => {
    const email = normalizeEmail_(assignment.email);
    if (!grouped.has(email)) grouped.set(email, []);
    const orgNode = orgNodeMap.get(normalizeOrgCode_(assignment.orgCode)) || null;
    grouped.get(email).push({
      orgCode: assignment.orgCode,
      orgName: assignment.orgName,
      orgType: orgNode ? String(orgNode.type || '').trim() : '',
      orgLevel: orgNode ? Number(orgNode.level || 0) : 0,
      title: assignment.title,
      type: assignmentTypeMap.get(getAssignmentIdentityKey_(assignment)) || '兼任'
    });
  });

  const summaryByEmail = new Map();
  grouped.forEach((items, email) => {
    const sortedItems = items.slice().sort((left, right) => {
      const typeDiff = getAssignmentSortOrder_(left.type) - getAssignmentSortOrder_(right.type);
      if (typeDiff !== 0) return typeDiff;
      return `${left.orgName}${left.title}`.localeCompare(`${right.orgName}${right.title}`, 'zh-Hant');
    });
    const primaryItem = sortedItems.find((item) => item.type === '主職') || sortedItems[0];
    const assignmentLabel = primaryItem
      ? [primaryItem.type, primaryItem.orgName, primaryItem.title].filter(Boolean).join('｜')
      : '未設定職務';

    summaryByEmail.set(email, {
      assignmentLabel,
      assignmentType: primaryItem ? primaryItem.type : '',
      assignmentOrgCode: primaryItem ? primaryItem.orgCode : '',
      assignmentOrgName: primaryItem ? primaryItem.orgName : '',
      assignmentOrgType: primaryItem ? primaryItem.orgType : '',
      assignmentOrgLevel: primaryItem ? Number(primaryItem.orgLevel || 0) : 0,
      assignmentTitle: primaryItem ? primaryItem.title : ''
    });
  });

  return summaryByEmail;
}

function createEmptyAssignmentSummary_() {
  return {
    assignmentLabel: '未設定職務',
    assignmentType: '',
    assignmentOrgCode: '',
    assignmentOrgName: '',
    assignmentOrgType: '',
    assignmentOrgLevel: 0,
    assignmentTitle: ''
  };
}

function loadTrainingRecords_(trainingSS) {
  const sheet = getOptionalSheet_(trainingSS, DASHBOARD_CONFIG.trainingRecordSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, TRAINING_SHEET_HEADERS[DASHBOARD_CONFIG.trainingRecordSheetName].length)
    .getDisplayValues();
  return rows
    .filter((row) => normalizeEmail_(row[2]))
    .map((row) => ({
      timestamp: row[0],
      userName: String(row[1] || '').trim(),
      userEmail: normalizeEmail_(row[2]),
      courseTitle: String(row[3] || '').trim(),
      score: Number(row[4] || 0),
      result: String(row[5] || '').trim()
    }));
}

function loadProgressRecords_(trainingSS) {
  const sheet = getOptionalSheet_(trainingSS, DASHBOARD_CONFIG.progressSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, TRAINING_SHEET_HEADERS[DASHBOARD_CONFIG.progressSheetName].length)
    .getDisplayValues();
  return rows
    .filter((row) => normalizeEmail_(row[0]))
    .map((row) => ({
      userEmail: normalizeEmail_(row[0]),
      videoTitle: String(row[1] || '').trim(),
      videoId: String(row[2] || '').trim(),
      watchedRanges: String(row[3] || '').trim(),
      watchedSecondsCount: Number(row[4] || 0),
      lastPlaybackPosition: Number(row[5] || 0),
      updatedAt: String(row[6] || '').trim(),
      sourceVersion: String(row[7] || '').trim()
    }));
}

function buildQuizSummaryByEmail_(records) {
  const summaryByEmail = new Map();
  records.forEach((record) => {
    const email = normalizeEmail_(record.userEmail);
    if (!summaryByEmail.has(email)) summaryByEmail.set(email, createEmptyQuizSummary_());
    const current = summaryByEmail.get(email);
    current.hasPassed = current.hasPassed || record.result === '通過';
    current.bestScore = Math.max(current.bestScore, record.score);
    current.attemptCount += 1;
    if (!current.courseTitle && record.courseTitle) current.courseTitle = record.courseTitle;
    if (!current.latestAttemptAt || compareDashboardTimestamps_(record.timestamp, current.latestAttemptAt) > 0) {
      current.latestAttemptAt = String(record.timestamp || '').trim();
      current.latestScore = record.score;
      current.latestResult = record.result;
      current.courseTitle = record.courseTitle || current.courseTitle;
    }
  });
  return summaryByEmail;
}

function buildProgressSummaryByEmail_(records) {
  const summaryByEmail = new Map();
  records.forEach((record) => {
    const email = normalizeEmail_(record.userEmail);
    if (!summaryByEmail.has(email)) summaryByEmail.set(email, createEmptyProgressSummary_());
    const current = summaryByEmail.get(email);
    if (record.watchedSecondsCount > current.watchedSecondsCount) {
      current.watchedSecondsCount = record.watchedSecondsCount;
      current.watchedRanges = record.watchedRanges;
      current.lastPlaybackPosition = record.lastPlaybackPosition;
      current.videoTitle = record.videoTitle || current.videoTitle;
    }
    if (!current.updatedAt || compareDashboardTimestamps_(record.updatedAt, current.updatedAt) > 0) {
      current.updatedAt = record.updatedAt;
      current.videoTitle = record.videoTitle || current.videoTitle;
    }
  });
  return summaryByEmail;
}

function createEmptyQuizSummary_() {
  return {
    hasPassed: false,
    bestScore: 0,
    latestScore: null,
    latestResult: '',
    latestAttemptAt: '',
    attemptCount: 0,
    courseTitle: ''
  };
}

function createEmptyProgressSummary_() {
  return {
    watchedSecondsCount: 0,
    watchedRanges: '',
    lastPlaybackPosition: 0,
    updatedAt: '',
    videoTitle: ''
  };
}

function resolveLearnerTrainingStatus_(watchCompleted, hasPassed, watchedSecondsCount, attemptCount) {
  if (watchCompleted && hasPassed) return 'completed';
  if (watchCompleted && !hasPassed) return 'pending_quiz';
  if (watchedSecondsCount > 0 || attemptCount > 0) return 'in_progress';
  return 'not_started';
}

function getLearnerStatusLabel_(status) {
  const labels = {
    completed: '已完成',
    pending_quiz: '待補測',
    in_progress: '進行中',
    not_started: '未開始'
  };
  return labels[status] || '未分類';
}

function getDashboardStatusSortOrder_(status) {
  const orderMap = {
    pending_quiz: 1,
    in_progress: 2,
    not_started: 3,
    completed: 4
  };
  return orderMap[status] || 99;
}

function buildDashboardKpis_(learners, now) {
  const counts = {
    total: learners.length,
    completed: 0,
    pendingQuiz: 0,
    inProgress: 0,
    notStarted: 0,
    recentActive: 0
  };
  const recentThresholdMs = now.getTime() - (DASHBOARD_CONFIG.recentActivityDays * 24 * 60 * 60 * 1000);

  learners.forEach((learner) => {
    if (learner.status === 'completed') counts.completed += 1;
    if (learner.status === 'pending_quiz') counts.pendingQuiz += 1;
    if (learner.status === 'in_progress') counts.inProgress += 1;
    if (learner.status === 'not_started') counts.notStarted += 1;
    const activityMs = parseDashboardTimestampMs_(learner.lastActivityAt);
    if (activityMs && activityMs >= recentThresholdMs) counts.recentActive += 1;
  });

  const completionRate = counts.total > 0
    ? Math.round((counts.completed / counts.total) * 1000) / 10
    : 0;

  return {
    ...counts,
    completionRate
  };
}

function buildDashboardUnitSummary_(learners) {
  const unitMap = new Map();
  learners.forEach((learner) => {
    const key = learner.assignmentOrgName || '未設定單位';
    if (!unitMap.has(key)) {
      unitMap.set(key, {
        unitName: key,
        total: 0,
        completed: 0,
        pendingQuiz: 0,
        inProgress: 0,
        notStarted: 0
      });
    }
    const unit = unitMap.get(key);
    unit.total += 1;
    if (learner.status === 'completed') unit.completed += 1;
    if (learner.status === 'pending_quiz') unit.pendingQuiz += 1;
    if (learner.status === 'in_progress') unit.inProgress += 1;
    if (learner.status === 'not_started') unit.notStarted += 1;
  });

  return Array.from(unitMap.values())
    .map((unit) => ({
      ...unit,
      completionRate: unit.total > 0 ? Math.round((unit.completed / unit.total) * 1000) / 10 : 0
    }))
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total;
      return left.unitName.localeCompare(right.unitName, 'zh-Hant');
    })
    .slice(0, 8);
}

function buildDashboardAlerts_(learners, now) {
  const recentThresholdMs = now.getTime() - (DASHBOARD_CONFIG.recentActivityDays * 24 * 60 * 60 * 1000);
  return {
    pendingQuiz: learners.filter((learner) => learner.status === 'pending_quiz').slice(0, DASHBOARD_CONFIG.maxAlertItems),
    staleInProgress: learners
      .filter((learner) => {
        if (learner.status !== 'in_progress') return false;
        const activityMs = parseDashboardTimestampMs_(learner.lastActivityAt);
        return !activityMs || activityMs < recentThresholdMs;
      })
      .slice(0, DASHBOARD_CONFIG.maxAlertItems),
    latestFailed: learners
      .filter((learner) => learner.latestResult === '未通過' && !learner.hasPassed)
      .slice(0, DASHBOARD_CONFIG.maxAlertItems)
  };
}

function resolveDashboardCourseTitle_(learners) {
  const firstTitledLearner = learners.find((learner) => learner.courseTitle);
  return firstTitledLearner ? firstTitledLearner.courseTitle : DASHBOARD_CONFIG.defaultCourseTitle;
}

function getLatestTimestampString_(left, right) {
  return compareDashboardTimestamps_(left, right) >= 0 ? String(left || '').trim() : String(right || '').trim();
}

function compareDashboardTimestamps_(left, right) {
  const leftMs = parseDashboardTimestampMs_(left);
  const rightMs = parseDashboardTimestampMs_(right);
  if (leftMs === rightMs) return 0;
  return leftMs > rightMs ? 1 : -1;
}

function parseDashboardTimestampMs_(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parsed = new Date(raw);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function buildNotificationOrgOptions_(orgNodes) {
  const typeMap = new Map();
  orgNodes.forEach((node) => {
    const typeKey = String(node.type || '').trim();
    if (!typeKey) return;
    if (!typeMap.has(typeKey)) typeMap.set(typeKey, new Map());
    const levelMap = typeMap.get(typeKey);
    const levelKey = Number(node.level || 0);
    if (!levelMap.has(levelKey)) levelMap.set(levelKey, []);
    levelMap.get(levelKey).push({
      code: node.code,
      name: node.name,
      alias: node.alias,
      parentCode: node.parentCode,
      managerName: node.managerName
    });
  });

  return Array.from(typeMap.keys())
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((typeKey) => ({
      type: typeKey,
      levels: Array.from(typeMap.get(typeKey).keys())
        .sort((left, right) => left - right)
        .map((levelKey) => ({
          level: levelKey,
          groups: typeMap.get(typeKey).get(levelKey)
            .slice()
            .sort((left, right) => `${left.name}${left.code}`.localeCompare(`${right.name}${right.code}`, 'zh-Hant'))
        }))
    }));
}

function isCaseStaffVirtualTarget_(orgCode) {
  return normalizeOrgCode_(orgCode) === normalizeOrgCode_(NOTIFICATION_CASE_STAFF_VIRTUAL_ORG_CODE);
}

function isCaseStaffOrgCode_(orgCode) {
  const normalized = normalizeOrgCode_(orgCode);
  return normalized.startsWith('GRP-CO-') && !normalized.startsWith('GRP-CO-EX-');
}

function buildNotificationTemplates_(courseTitle) {
  return {
    personalized: buildPersonalizedNotificationTemplate_(courseTitle),
    case_staff_personalized: buildCaseStaffIndividualNotificationTemplate_(courseTitle),
    case_staff_layered_reminder: buildCaseStaffLayeredReminderTemplateBundle_(courseTitle),
    parental_leave_personalized: buildParentalLeavePersonalizedNotificationTemplate_(courseTitle),
    announcement: buildAnnouncementNotificationTemplate_(courseTitle),
    group_announcement: buildGroupAnnouncementNotificationTemplate_(courseTitle),
    station_manager_announcement: buildStationManagerAnnouncementTemplate_(courseTitle),
    leadership_announcement_summary: buildLeadershipAnnouncementSummaryTemplate_(courseTitle),
    leadership_announcement: buildLeadershipAnnouncementNotificationTemplate_(courseTitle)
  };
}

function buildNotificationTemplatesByDeliveryMode_(courseTitle) {
  return {
    case_staff_personalized: {
      individual: buildCaseStaffIndividualNotificationTemplate_(courseTitle),
      single_bcc: buildCaseStaffSingleBccNotificationTemplate_(courseTitle)
    },
    case_staff_layered_reminder: {
      layered: buildCaseStaffLayeredReminderTemplateBundle_(courseTitle)
    }
  };
}

function buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_() {
  return {
    case_staff_personalized: {
      individual: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}'],
      single_bcc: ['{{課程名稱}}', '{{上課網址}}']
    },
    case_staff_layered_reminder: {
      layered: ['{{姓名}}', '{{信箱}}', '{{單位}}', '{{職稱}}', '{{駐站列表}}', '{{駐站管理員姓名}}', '{{組長姓名}}', '{{未完成人員名單}}', '{{課程名稱}}', '{{訓練狀態}}', '{{上課網址}}']
    }
  };
}

function buildDefaultDeliveryModeByTemplateType_() {
  return {
    personalized: 'individual',
    case_staff_personalized: 'individual',
    case_staff_layered_reminder: 'layered',
    parental_leave_personalized: 'individual',
    announcement: 'single_bcc',
    group_announcement: 'single_bcc',
    station_manager_announcement: 'single_bcc',
    leadership_announcement_summary: 'single_bcc',
    leadership_announcement: 'single_bcc'
  };
}

function buildNotificationWatchReminderHtml_() {
  return '<p>提醒您，觀看課程時請直接從教育訓練頁面提供的上課頁面開啟影片並完成觀看。如果從YOUTUBE頁面、別人轉傳的YOUTUBE連結，或另外開啟的YOUTUBE視窗觀看，系統無法正確計算您的觀看時數。</p>';
}

function buildNotificationLoginReminderHtml_() {
  return '<p>請先確認已使用院方 Gmail 帳號登入後，再點擊下方連結進入課程，以確保系統能正確記錄您的教育訓練與測驗完成狀態。</p>';
}

function buildNotificationAutoReplyFooterHtml_() {
  return '<p>此為自動發送之通知信件，無需直接回覆。</p><p>如有任何問題，請聯絡專案管理組(策略組)。</p>';
}

function buildPersonalizedNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>{{姓名}} 您好：</p>',
      '<p>提醒您，因應本次資訊安全暨個資保護教育訓練安排，請協助完成課程影片觀看與測驗。本次課程內容已提供線上課程與評量，完成後可列入相關教育訓練時數。</p>',
      `<p>您目前的訓練資訊如下：<br>課程名稱：${escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練')}教育訓練<br>目前狀態：{{訓練狀態}}<br>所屬單位：{{單位}}<br>職稱：{{職稱}}</p>`,
      '<p>請於 8 月 30 日前完成課程與測驗；若您已完成相關要求，請忽略此提醒，謝謝您的配合。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildCaseStaffIndividualNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>{{姓名}} 您好：</p>',
      '<p>提醒您，因應本次資訊安全暨個資保護教育訓練安排，您目前屬於收案相關人員通知對象，請協助完成課程影片觀看與測驗。本次課程內容已提供線上課程與評量，完成後可列入相關教育訓練時數。</p>',
      `<p>您目前的訓練資訊如下：<br>課程名稱：${escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練')}教育訓練<br>目前狀態：{{訓練狀態}}<br>所屬單位：{{單位}}<br>職稱：{{職稱}}</p>`,
      '<p>請於 8 月 30 日前完成課程與測驗；若您已完成相關要求，請忽略此提醒，謝謝您的配合。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildCaseStaffSingleBccNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>各位收案同仁們好：</p>',
      `<p>因應本年度資訊安全暨個資保護教育訓練安排，請收案相關人員協助完成<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練')}</strong>課程影片觀看與測驗。本次課程內容已提供線上課程與評量，完成後可列入相關教育訓練時數。</p>`,
      '<p>本次課程可同時列計資安三小時與個資保護教育訓練時數。請先完成課程影片觀看，再進行評量；評量 70 分以上為及格，並請於 8 月 30 日以前完成相關課程與測驗。如已完成相關要求，請忽略此信。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildCaseStaffLayeredReminderTemplateBundle_(courseTitle) {
  const safeCourseTitle = escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練');
  return {
    caseStaff: {
      subject: '【教育訓練提醒】請完成資訊安全暨個資保護教育訓練',
      htmlBody: [
        '<p>{{姓名}} 您好：</p>',
        `<p>系統顯示您目前仍未完成<strong>${safeCourseTitle}</strong>課程，請協助儘速完成影片觀看與課後測驗。</p>`,
        '<p>您目前的訓練資訊如下：<br>目前狀態：{{訓練狀態}}<br>收案駐站：{{駐站列表}}<br>職稱：{{職稱}}</p>',
        buildNotificationWatchReminderHtml_(),
        buildNotificationLoginReminderHtml_(),
        '<p><a href="{{上課網址}}">前往上課</a></p>',
        buildNotificationAutoReplyFooterHtml_()
      ].join('')
    },
    stationManager: {
      subject: '【教育訓練追蹤】駐站收案人員未完成名單',
      htmlBody: [
        '<p>{{駐站管理員姓名}} 您好：</p>',
        `<p>以下為您所管理駐站中，尚未完成<strong>${safeCourseTitle}</strong>的收案人員名單，請協助提醒完成課程影片觀看與測驗。</p>`,
        '<p>{{未完成人員名單}}</p>',
        '<p><a href="{{上課網址}}">前往上課頁面</a></p>',
        buildNotificationAutoReplyFooterHtml_()
      ].join('')
    },
    teamLead: {
      subject: '【教育訓練追蹤】收案組未完成名單',
      htmlBody: [
        '<p>{{組長姓名}} 您好：</p>',
        `<p>以下為收案組目前尚未完成<strong>${safeCourseTitle}</strong>的收案人員名單，請協助掌握與提醒。</p>`,
        '<p>{{未完成人員名單}}</p>',
        '<p><a href="{{上課網址}}">前往上課頁面</a></p>',
        buildNotificationAutoReplyFooterHtml_()
      ].join('')
    }
  };
}

function buildParentalLeavePersonalizedNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>{{姓名}} 您好：</p>',
      '<p>提醒您，因應本次資訊安全暨個資保護教育訓練安排，您目前屬於人員狀態標記為育嬰假的通知對象，請協助完成課程影片觀看與測驗。本次課程內容已提供線上課程與評量，完成後可列入相關教育訓練時數。</p>',
      `<p>您目前的訓練資訊如下：<br>課程名稱：${escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練')}教育訓練<br>目前狀態：{{訓練狀態}}<br>所屬單位：{{單位}}<br>職稱：{{職稱}}</p>`,
      '<p>請於 8 月 30 日前完成課程與測驗；若您已完成相關要求，請忽略此提醒，謝謝您的配合。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildAnnouncementNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>長官、主管、組長和同仁們好：</p>',
      `<p>因應外稽單位要求，我們需對內部人員進行<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練')}</strong>教育訓練。課程內容已製作為線上課程與評量，敬請大家完成本次教育訓練時數與評量。</p>`,
      '<p>本次課程可同時折抵資安三小時時數與個資保護教育訓練時數。請先完成課程影片觀看，再進行評量；評量 70 分以上為及格。請於 8 月 30 日以前完成課程，感謝大家的協助。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildGroupAnnouncementNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>{{組別稱呼}}</p>',
      `<p>因應外部稽核要求，也配合《資通安全責任等級分級辦法》每年需完成至少 3 小時資通安全通識教育訓練的規定，這次已安排<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護')}</strong>教育訓練課程，想請大家撥空完成。</p>`,
      '<p>本次課程可同時列計資安三小時與個資保護教育訓練時數。請先完成課程影片觀看，再進行評量；評量 70 分以上為及格，並請於 8 月 30 日以前完成相關課程與測驗，謝謝大家的配合。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildStationManagerAnnouncementTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>{{駐站管理稱呼}}</p>',
      `<p>因應外部稽核要求，也配合《資通安全責任等級分級辦法》每年需完成至少 3 小時資通安全通識教育訓練的規定，這次已安排<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護')}</strong>教育訓練課程，想請大家撥空完成。</p>`,
      `<p>本次<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護')}教育訓練課程</strong>作業安排，教育訓練管理工具將自動追蹤收案人員上課情形，並依系統資料自動通知發信。教育訓練採分階段通知，系統會依照駐站管理員維護的駐站資訊，持續安排後續教育訓練通知。若資料已確認正確，後續通知將由系統接續處理，您不需要另外協助轉發信件至駐站。</p>`,
      '<p>為了讓後續通知更準確，建議您在上課前先協助確認您所管理的駐站與收案人員資訊是否正確；若資料有不一致、成員歸屬錯誤，或管理關係需要調整，也請一併協助更新。</p>',
      '<p>如需更正資料，請點擊下方上課連結，並依照頁面中的導覽說明逐步確認與修正相關資訊，再開始後續課程與測驗。</p>',
      '<p>本次課程可同時列計資安三小時與個資保護教育訓練時數。請先完成課程影片觀看，再進行評量；評量 70 分以上為及格，並請於 8 月 30 日以前完成相關課程與測驗。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildLeadershipAnnouncementNotificationTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>長官、主管們好：</p>',
     `<p>依據《資通安全責任等級分級辦法》，公務機關及特定非公務機關人員（含約聘僱）每年須完成至少 3 小時之資通安全通識教育訓練。另臺灣人體生物資料庫每年亦須通過 ISO27001 與 ISO27701 第三方國際標準驗證，須持續就資訊安全暨個人資料保護管理系統範圍內之政策、制度及作業規範進行宣導，並確保相關管理措施符合組織實際運作情形。為配合前述法規要求與制度推動，本次已安排辦理<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護')}教育訓練課程</strong>。</p>`,
     '<p>鑑於長官與主管們同時肩負資訊安全暨個人資料保護委員會召集人或委員之職責，需參與政策審議、資源協調、管理審查、稽核督導及制度推動等事項。為使召集人與委員充分了解臺灣人體生物資料庫之資訊安全與個人資料保護相關政策、管理要求及執行重點，特誠摯邀請長官撥冗參與本次課程。</p>',
     '<p>本次課程可同時列計資安三小時與個資保護教育訓練時數。請先完成課程影片觀看，再進行評量；評量 70 分以上為及格，並請於 8 月 30 日以前完成相關課程與測驗。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
     '<p><a href="{{上課網址}}">前往上課</a></p>',
     '<p>敬請撥冗參與。</p>',
     buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildLeadershipAnnouncementSummaryTemplate_(courseTitle) {
  return {
    subject: '【教育訓練通知】資訊安全暨個資保護教育訓練',
    htmlBody: [
      '<p>長官、主管們好：</p>',
      `<p>依據《資通安全責任等級分級辦法》，公務機關及特定非公務機關人員（含約聘僱）每年須完成至少 3 小時之資通安全通識教育訓練。另因臺灣人體生物資料庫每年需通過 ISO27001 與 ISO27701 第三方國際標準驗證，故已安排辦理<strong>${escapeHtml_(courseTitle || '資訊安全暨個資保護')}教育訓練課程</strong>。</p>`,
      '<p>鑑於長官與主管身為資訊安全暨個人資料保護委員會召集人或委員，需了解本庫資訊安全與個人資料保護相關政策、管理要求及制度推動重點，以利後續政策審議、管理審查與督導作業。</p>',
      '<p>本次課程可同時列計資安三小時與個資保護教育訓練時數。請先完成課程影片觀看，再進行評量；評量 70 分以上為及格，並請於 8 月 30 日以前完成相關課程與測驗。如已完成相關要求，請忽略此信。</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function executeTrainingNotification_(payload, options) {
  const dryRun = Boolean(options && options.dryRun);
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return buildDashboardPermissionResponse_(viewerEmail, false, '您沒有查看學員訓練儀表板的權限。');
  }
  if (!canSendDashboardNotifications_(viewerEmail)) {
    return buildDashboardPermissionResponse_(viewerEmail, true, '您目前沒有寄送課程通知的權限。');
  }

  try {
    const normalizedPayload = normalizeNotificationPayload_(payload);
    const context = buildDashboardContext_();
    const trainingCourseUrl = getTrainingCourseUrl_();
    if (normalizedPayload.templateType === 'case_staff_layered_reminder') {
      return executeCaseStaffLayeredNotification_(normalizedPayload, context, trainingCourseUrl, viewerEmail, dryRun);
    }
    const selection = selectNotificationRecipients_(context, normalizedPayload);
    const templateContext = buildNotificationTemplateContext_(context, normalizedPayload);
    const isSingleBccDelivery = normalizedPayload.deliveryMode === 'single_bcc';
    const previewRecipient = normalizedPayload.deliveryMode === 'individual'
      ? (selection.recipients[0] || null)
      : null;
    const sampleSubject = previewRecipient
      ? applyNotificationTemplate_(normalizedPayload.template.subject, previewRecipient, context.courseTitle, trainingCourseUrl, templateContext)
      : applyGenericNotificationTemplate_(normalizedPayload.template.subject, context.courseTitle, trainingCourseUrl, templateContext);
    const sampleHtmlBody = previewRecipient
      ? applyNotificationTemplate_(normalizedPayload.template.htmlBody, previewRecipient, context.courseTitle, trainingCourseUrl, templateContext)
      : applyGenericNotificationTemplate_(normalizedPayload.template.htmlBody, context.courseTitle, trainingCourseUrl, templateContext);

    if (dryRun) {
      return {
        success: true,
        authorized: true,
        viewerEmail,
        mode: 'preview',
        courseTitle: context.courseTitle,
        criteriaSummary: buildNotificationCriteriaSummary_(normalizedPayload),
        templateType: normalizedPayload.templateType,
        deliveryMode: normalizedPayload.deliveryMode,
        recipientCount: selection.recipients.length,
        skippedCount: selection.skipped.length,
        recipients: selection.recipients.slice(0, 200),
        skipped: selection.skipped.slice(0, 200),
        sampleSubject,
        sampleHtmlBody
      };
    }

    console.log(
      '[sendTrainingNotification] viewer=%s deliveryMode=%s template=%s recipients=%s skipped=%s quota=%s',
      viewerEmail,
      normalizedPayload.deliveryMode,
      normalizedPayload.templateType,
      selection.recipients.length,
      selection.skipped.length,
      safeMailQuota_()
    );

    const failures = [];
    let sentCount = 0;
    if (isSingleBccDelivery) {
      const bccRecipients = selection.recipients.map((recipient) => recipient.email).filter(Boolean);
      if (bccRecipients.length === 0) {
        throw new Error('目前沒有可寄送的公告收件人。');
      }
      console.log('[sendTrainingNotification] single_bcc to=%s bccCount=%s', viewerEmail, bccRecipients.length);
      try {
        MailApp.sendEmail({
          to: viewerEmail,
          bcc: bccRecipients.join(','),
          subject: applyGenericNotificationTemplate_(normalizedPayload.template.subject, context.courseTitle, trainingCourseUrl, templateContext),
          htmlBody: applyGenericNotificationTemplate_(normalizedPayload.template.htmlBody, context.courseTitle, trainingCourseUrl, templateContext)
        });
        sentCount = 1;
      } catch (error) {
        console.error('[sendTrainingNotification] single_bcc 失敗:', error && error.stack ? error.stack : error);
        failures.push({
          email: viewerEmail,
          name: '公告寄送',
          message: error && error.message ? error.message : String(error)
        });
      }
    } else {
      selection.recipients.forEach((recipient) => {
        const subject = applyNotificationTemplate_(normalizedPayload.template.subject, recipient, context.courseTitle, trainingCourseUrl, templateContext);
        const htmlBody = applyNotificationTemplate_(normalizedPayload.template.htmlBody, recipient, context.courseTitle, trainingCourseUrl, templateContext);
        try {
          MailApp.sendEmail({
            to: recipient.email,
            subject,
            htmlBody
          });
          sentCount += 1;
        } catch (error) {
          console.error(
            '[sendTrainingNotification] 寄送失敗 email=%s msg=%s',
            recipient.email,
            error && error.message ? error.message : String(error)
          );
          failures.push({
            email: recipient.email,
            name: recipient.name,
            message: error && error.message ? error.message : String(error)
          });
        }
      });
    }

    appendNotificationLog_({
      operatorEmail: viewerEmail,
      courseTitle: context.courseTitle,
      payload: normalizedPayload,
      recipientCount: selection.recipients.length,
      sentCount,
      skippedCount: selection.skipped.length + failures.length
    });

    return {
      success: true,
      authorized: true,
      viewerEmail,
      mode: 'send',
      courseTitle: context.courseTitle,
      criteriaSummary: buildNotificationCriteriaSummary_(normalizedPayload),
      templateType: normalizedPayload.templateType,
      deliveryMode: normalizedPayload.deliveryMode,
      recipientCount: selection.recipients.length,
      sentCount,
      skippedCount: selection.skipped.length,
      failureCount: failures.length,
      failureMessage: failures.length ? failures[0].message : '',
      skipped: selection.skipped.slice(0, 200),
      failed: failures.slice(0, 200)
    };
  } catch (error) {
    console.error('寄送通知失敗:', error);
    return buildDashboardPermissionResponse_(
      viewerEmail,
      true,
      error && error.message ? error.message : '寄送通知失敗。'
    );
  }
}

function normalizeNotificationPayload_(payload) {
  const target = payload && payload.target ? payload.target : {};
  const template = payload && payload.template ? payload.template : {};
  const templateType = String(payload && payload.templateType || 'personalized').trim() || 'personalized';
  const deliveryMode = String(payload && payload.deliveryMode || 'individual').trim() || 'individual';
  const layeredTargetRole = String(payload && payload.layeredTargetRole || 'all').trim() || 'all';
  const trainingStatus = String(payload && payload.trainingStatus || 'incomplete').trim() || 'incomplete';
  const personnelStatus = String(payload && payload.personnelStatus || '').trim();
  const descendantMode = String(target.descendantMode || 'self').trim() || 'self';
  const orgType = String(target.orgType || '').trim();
  const levelValue = String(typeof target.level === 'undefined' || target.level === null ? '' : target.level).trim();
  const orgLevel = levelValue === '' ? '' : Number(levelValue);
  const orgCode = String(target.orgCode || '').trim();
  const assignmentMatch = String(target.assignmentMatch || 'primary_only').trim() || 'primary_only';
  const subject = String(template.subject || '').trim();
  const htmlBody = String(template.htmlBody || '').trim();
  const allowedTemplateTypes = ['personalized', 'case_staff_personalized', 'case_staff_layered_reminder', 'parental_leave_personalized', 'announcement', 'group_announcement', 'station_manager_announcement', 'leadership_announcement_summary', 'leadership_announcement'];

  if (!allowedTemplateTypes.includes(templateType)) throw new Error('通知範本類型不正確。');
  if (templateType === 'case_staff_layered_reminder') {
    if (deliveryMode !== 'layered') throw new Error('收案分層提醒僅支援分層寄送。');
    if (!['all', 'case_staff', 'station_manager', 'team_lead'].includes(layeredTargetRole)) throw new Error('分層通知對象不正確。');
  } else {
    if (!subject) throw new Error('通知主旨不得為空。');
    if (!htmlBody) throw new Error('通知內文不得為空。');
    if (!['individual', 'single_bcc'].includes(deliveryMode)) throw new Error('寄送方式不正確。');
  }
  if (!orgType) throw new Error('請選擇組織類型。');
  if (assignmentMatch !== 'primary_only') throw new Error('目前僅支援依主職寄送。');
  if (levelValue !== '' && (!Number.isFinite(orgLevel) || orgLevel <= 0)) throw new Error('組織層級格式不正確。');
  if (!['self', 'depth_1', 'depth_2', 'depth_3', 'all_descendants'].includes(descendantMode)) {
    throw new Error('寄送範圍設定不正確。');
  }

  return {
    templateType,
    deliveryMode,
    layeredTargetRole,
    target: {
      orgType,
      level: templateType === 'case_staff_layered_reminder' ? '' : (levelValue === '' ? '' : orgLevel),
      orgCode: templateType === 'case_staff_layered_reminder' ? NOTIFICATION_CASE_STAFF_VIRTUAL_ORG_CODE : orgCode,
      descendantMode: templateType === 'case_staff_layered_reminder' ? 'self' : descendantMode,
      assignmentMatch
    },
    trainingStatus,
    personnelStatus,
    template: {
      subject: templateType === 'case_staff_layered_reminder' ? '收案分層提醒' : subject,
      htmlBody: templateType === 'case_staff_layered_reminder' ? '依角色套用分層範本' : htmlBody
    },
    layeredTemplates: templateType === 'case_staff_layered_reminder'
      ? normalizeLayeredNotificationTemplates_(payload && payload.layeredTemplates, layeredTargetRole)
      : null
  };
}

function normalizeLayeredNotificationTemplates_(templates, layeredTargetRole) {
  const source = templates || {};
  const roleKeys = getRequiredLayeredTemplateKeys_(layeredTargetRole);
  const normalized = {};

  roleKeys.forEach((key) => {
    const item = source[key] || {};
    const subject = String(item.subject || '').trim();
    const htmlBody = String(item.htmlBody || '').trim();
    if (!subject) throw new Error('分層通知主旨不得為空。');
    if (!htmlBody) throw new Error('分層通知內文不得為空。');
    normalized[key] = { subject, htmlBody };
  });

  return normalized;
}

function getRequiredLayeredTemplateKeys_(layeredTargetRole) {
  const role = String(layeredTargetRole || 'all').trim();
  if (role === 'case_staff') return ['caseStaff'];
  if (role === 'station_manager') return ['stationManager'];
  if (role === 'team_lead') return ['teamLead'];
  return ['caseStaff', 'stationManager', 'teamLead'];
}

function executeCaseStaffLayeredNotification_(payload, context, trainingCourseUrl, viewerEmail, dryRun) {
  const selection = selectCaseStaffLayeredRecipients_(context, payload);
  const sampleMessages = buildLayeredSampleMessages_(payload, selection, context.courseTitle, trainingCourseUrl);
  const primarySampleMessage = sampleMessages[0] || { subject: '', htmlBody: '' };

  if (dryRun) {
    return {
      success: true,
      authorized: true,
      viewerEmail,
      mode: 'preview',
      courseTitle: context.courseTitle,
      criteriaSummary: buildNotificationCriteriaSummary_(payload),
      templateType: payload.templateType,
      deliveryMode: payload.deliveryMode,
      layeredTargetRole: payload.layeredTargetRole,
      recipientCount: selection.recipients.length,
      skippedCount: selection.skipped.length,
      roleCounts: selection.roleCounts,
      recipients: selection.recipients.slice(0, 200),
      skipped: selection.skipped.slice(0, 200),
      sampleSubject: primarySampleMessage.subject,
      sampleHtmlBody: primarySampleMessage.htmlBody,
      sampleMessages
    };
  }

  const failures = [];
  let sentCount = 0;
  selection.recipients.forEach((recipient) => {
    const template = getLayeredTemplateForRole_(payload.layeredTemplates, recipient.roleKey);
    const subject = applyLayeredNotificationTemplate_(template.subject, recipient, context.courseTitle, trainingCourseUrl);
    const htmlBody = applyLayeredNotificationTemplate_(template.htmlBody, recipient, context.courseTitle, trainingCourseUrl);
    try {
      MailApp.sendEmail({
        to: recipient.email,
        subject,
        htmlBody
      });
      sentCount += 1;
    } catch (error) {
      failures.push({
        email: recipient.email,
        name: recipient.name,
        roleLabel: recipient.roleLabel,
        message: error && error.message ? error.message : String(error)
      });
    }
  });

  appendNotificationLog_({
    operatorEmail: viewerEmail,
    courseTitle: context.courseTitle,
    payload,
    recipientCount: selection.recipients.length,
    sentCount,
    skippedCount: selection.skipped.length + failures.length
  });

  return {
    success: true,
    authorized: true,
    viewerEmail,
    mode: 'send',
    courseTitle: context.courseTitle,
    criteriaSummary: buildNotificationCriteriaSummary_(payload),
    templateType: payload.templateType,
    deliveryMode: payload.deliveryMode,
    layeredTargetRole: payload.layeredTargetRole,
    recipientCount: selection.recipients.length,
    sentCount,
    skippedCount: selection.skipped.length,
    failureCount: failures.length,
    roleCounts: selection.roleCounts,
    skipped: selection.skipped.slice(0, 200),
    failed: failures.slice(0, 200)
  };
}

function buildLayeredSampleMessages_(payload, selection, courseTitle, trainingCourseUrl) {
  const roleOrder = [
    { roleKey: 'case_staff', roleLabel: '收案人員' },
    { roleKey: 'station_manager', roleLabel: '駐站管理員' },
    { roleKey: 'team_lead', roleLabel: '收案組組長' }
  ];

  return roleOrder
    .filter((role) => shouldIncludeLayeredRole_(payload.layeredTargetRole, role.roleKey))
    .map((role) => {
      const recipient = (selection.recipients || []).find((item) => item.roleKey === role.roleKey);
      if (!recipient) return null;
      const template = getLayeredTemplateForRole_(payload.layeredTemplates, role.roleKey);
      return {
        roleKey: role.roleKey,
        roleLabel: role.roleLabel,
        recipientName: recipient.name || recipient.email || '',
        subject: applyLayeredNotificationTemplate_(template.subject, recipient, courseTitle, trainingCourseUrl),
        htmlBody: applyLayeredNotificationTemplate_(template.htmlBody, recipient, courseTitle, trainingCourseUrl)
      };
    })
    .filter(Boolean);
}

function shouldIncludeLayeredRole_(layeredTargetRole, roleKey) {
  const targetRole = String(layeredTargetRole || 'all').trim();
  if (targetRole === 'all') return true;
  return targetRole === roleKey;
}

function selectCaseStaffLayeredRecipients_(context, payload) {
  const includeCaseStaff = payload.layeredTargetRole === 'all' || payload.layeredTargetRole === 'case_staff';
  const includeStationManager = payload.layeredTargetRole === 'all' || payload.layeredTargetRole === 'station_manager';
  const includeTeamLead = payload.layeredTargetRole === 'all' || payload.layeredTargetRole === 'team_lead';
  const stationAssignmentsByEmail = buildCaseStaffStationAssignmentsByEmail_(context.assignments || [], context.orgNodeMap);
  const teamLeads = buildCaseStaffTeamLeadRecipients_(context.assignments || []);
  const caseStaffRecipients = [];
  const stationManagerMap = new Map();
  const teamLeadMap = new Map();
  const skipped = [];
  const seenCaseStaffEmails = new Set();

  (context.learners || []).forEach((learner) => {
    const email = normalizeEmail_(learner.email);
    const stationAssignments = stationAssignmentsByEmail.get(email) || [];
    const reasons = [];
    if (!email) reasons.push('缺少信箱');
    if (!isValidEmail_(email)) reasons.push('信箱格式不正確');
    if (seenCaseStaffEmails.has(email)) reasons.push('重複信箱');
    if (stationAssignments.length === 0) reasons.push('不在收案人員範圍');
    if (!matchesNotificationStatusFilter_(learner.status, payload.trainingStatus)) reasons.push('訓練狀態不符');
    if (payload.personnelStatus && String(learner.personnelStatus || '').trim() !== payload.personnelStatus) reasons.push('人員狀態不符');

    if (reasons.length > 0) {
      if (['缺少信箱', '信箱格式不正確', '重複信箱'].includes(reasons[0])) {
        skipped.push({
          email: learner.email,
          name: learner.name,
          roleLabel: '收案人員',
          reason: reasons[0]
        });
      }
      return;
    }

    seenCaseStaffEmails.add(email);
    const stationList = stationAssignments.map((item) => item.stationName || item.stationCode).filter(Boolean).join('、');
    const stationManagerNames = Array.from(new Set(stationAssignments.map((item) => item.managerName || item.managerEmail).filter(Boolean))).join('、');
    const caseStaffRecipient = {
      roleKey: 'case_staff',
      roleLabel: '收案人員',
      email,
      name: learner.name,
      personnelStatus: learner.personnelStatus,
      assignmentOrgName: stationList || learner.assignmentOrgName,
      assignmentTitle: learner.assignmentTitle,
      stationList,
      stationManagerNames,
      watchedPercent: learner.watchedPercent,
      bestScore: learner.bestScore,
      status: learner.status,
      statusLabel: learner.statusLabel
    };
    if (includeCaseStaff) caseStaffRecipients.push(caseStaffRecipient);

    stationAssignments.forEach((stationAssignment) => {
      const managerEmail = normalizeEmail_(stationAssignment.managerEmail);
      if (!includeStationManager) return;
      if (!managerEmail || !isValidEmail_(managerEmail)) {
        skipped.push({
          email: managerEmail,
          name: stationAssignment.managerName || stationAssignment.stationName,
          roleLabel: '駐站管理員',
          reason: `找不到 ${stationAssignment.stationName || stationAssignment.stationCode} 的有效駐站管理員信箱`
        });
        return;
      }
      if (!stationManagerMap.has(managerEmail)) {
        stationManagerMap.set(managerEmail, {
          roleKey: 'station_manager',
          roleLabel: '駐站管理員',
          email: managerEmail,
          name: stationAssignment.managerName || managerEmail,
          members: [],
          memberKeySet: new Set()
        });
      }
      appendLayeredMember_(stationManagerMap.get(managerEmail), learner, stationAssignment);
    });

    if (includeTeamLead) {
      teamLeads.forEach((lead) => {
        if (!teamLeadMap.has(lead.email)) {
          teamLeadMap.set(lead.email, {
            roleKey: 'team_lead',
            roleLabel: '收案組組長',
            email: lead.email,
            name: lead.name,
            members: [],
            memberKeySet: new Set()
          });
        }
        stationAssignments.forEach((stationAssignment) => {
          appendLayeredMember_(teamLeadMap.get(lead.email), learner, stationAssignment);
        });
      });
    }
  });

  if (includeTeamLead && teamLeads.length === 0) {
    skipped.push({
      email: '',
      name: '收案組組長',
      roleLabel: '收案組組長',
      reason: '找不到 GRP-CO 職稱含「組長」的人員'
    });
  }

  const stationManagerRecipients = Array.from(stationManagerMap.values()).map(finalizeLayeredSummaryRecipient_);
  const teamLeadRecipients = Array.from(teamLeadMap.values()).map(finalizeLayeredSummaryRecipient_);
  const recipients = caseStaffRecipients.concat(stationManagerRecipients, teamLeadRecipients);

  return {
    recipients,
    skipped,
    roleCounts: {
      caseStaff: caseStaffRecipients.length,
      stationManager: stationManagerRecipients.length,
      teamLead: teamLeadRecipients.length
    }
  };
}

function buildCaseStaffStationAssignmentsByEmail_(assignments, orgNodeMap) {
  const grouped = new Map();
  (assignments || []).forEach((assignment) => {
    if (!isCaseStaffOrgCode_(assignment.orgCode)) return;
    const email = normalizeEmail_(assignment.email);
    if (!email) return;
    const station = orgNodeMap && orgNodeMap.get(normalizeOrgCode_(assignment.orgCode)) || null;
    if (!grouped.has(email)) grouped.set(email, []);
    grouped.get(email).push({
      stationCode: String(assignment.orgCode || '').trim(),
      stationName: String(assignment.orgName || (station && station.name) || '').trim(),
      title: String(assignment.title || '').trim(),
      managerEmail: normalizeEmail_((station && station.managerEmail) || assignment.managerEmail),
      managerName: String((station && station.managerName) || assignment.managerName || '').trim()
    });
  });
  return grouped;
}

function buildCaseStaffTeamLeadRecipients_(assignments) {
  const leadsByEmail = new Map();
  (assignments || []).forEach((assignment) => {
    const email = normalizeEmail_(assignment.email);
    if (normalizeOrgCode_(assignment.orgCode) !== 'GRP-CO') return;
    if (!titleContainsLeaderKeyword_(assignment.title)) return;
    if (!email || !isValidEmail_(email)) return;
    if (leadsByEmail.has(email)) return;
    leadsByEmail.set(email, {
      email,
      name: String(assignment.name || email).trim()
    });
  });
  return Array.from(leadsByEmail.values()).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'zh-Hant'));
}

function appendLayeredMember_(recipient, learner, stationAssignment) {
  const key = [
    normalizeEmail_(learner.email),
    normalizeOrgCode_(stationAssignment.stationCode)
  ].join('||');
  if (recipient.memberKeySet.has(key)) return;
  recipient.memberKeySet.add(key);
  recipient.members.push({
    name: String(learner.name || learner.email || '').trim(),
    email: normalizeEmail_(learner.email),
    stationName: String(stationAssignment.stationName || stationAssignment.stationCode || '').trim(),
    stationCode: String(stationAssignment.stationCode || '').trim(),
    title: String(stationAssignment.title || learner.assignmentTitle || '').trim(),
    statusLabel: String(learner.statusLabel || '').trim(),
    managerName: String(stationAssignment.managerName || stationAssignment.managerEmail || '').trim()
  });
}

function finalizeLayeredSummaryRecipient_(recipient) {
  const members = recipient.members
    .slice()
    .sort((left, right) => `${left.stationName}${left.name}`.localeCompare(`${right.stationName}${right.name}`, 'zh-Hant'));
  return {
    roleKey: recipient.roleKey,
    roleLabel: recipient.roleLabel,
    email: recipient.email,
    name: recipient.name,
    members,
    memberCount: members.length,
    memberListHtml: buildLayeredMemberListHtml_(members),
    assignmentOrgName: '',
    assignmentTitle: `${recipient.roleLabel}彙總`
  };
}

function buildLayeredMemberListHtml_(members) {
  if (!members || members.length === 0) return '目前沒有未完成人員。';
  return members.map((member) => {
    const parts = [
      member.stationName ? `[${escapeHtml_(member.stationName)}]` : '',
      escapeHtml_(member.name || member.email || '未命名人員'),
      member.email ? `(${escapeHtml_(member.email)})` : '',
      member.statusLabel ? `：${escapeHtml_(member.statusLabel)}` : '',
      member.managerName ? `，駐管：${escapeHtml_(member.managerName)}` : ''
    ].filter(Boolean).join(' ');
    return `- ${parts}`;
  }).join('<br>');
}

function getLayeredTemplateForRole_(templates, roleKey) {
  if (roleKey === 'station_manager') return templates.stationManager;
  if (roleKey === 'team_lead') return templates.teamLead;
  return templates.caseStaff;
}

function applyLayeredNotificationTemplate_(template, recipient, courseTitle, trainingCourseUrl) {
  const replacements = {
    '{{姓名}}': recipient.name || '',
    '{{信箱}}': recipient.email || '',
    '{{單位}}': recipient.assignmentOrgName || '',
    '{{職稱}}': recipient.assignmentTitle || '',
    '{{駐站列表}}': recipient.stationList || recipient.assignmentOrgName || '',
    '{{駐站管理員姓名}}': recipient.name || '',
    '{{組長姓名}}': recipient.name || '',
    '{{未完成人員名單}}': recipient.memberListHtml || '',
    '{{課程名稱}}': courseTitle || DASHBOARD_CONFIG.defaultCourseTitle,
    '{{訓練狀態}}': recipient.statusLabel || '',
    '{{上課網址}}': trainingCourseUrl || ''
  };

  let output = String(template || '');
  Object.keys(replacements).forEach((token) => {
    output = output.split(token).join(String(replacements[token]));
  });
  return output;
}

function selectNotificationRecipients_(context, payload) {
  const orgCodes = resolveNotificationTargetOrgCodes_(context.orgNodes, payload.target);
  const orgCodeSet = new Set(orgCodes.map((item) => normalizeOrgCode_(item)));
  const isCaseStaffVirtualTarget = isCaseStaffVirtualTarget_(payload.target.orgCode);
  const dedupe = new Set();
  const recipients = [];
  const skipped = [];

  context.learners.forEach((learner) => {
    const reasons = [];
    if (!learner.email) reasons.push('缺少信箱');
    if (learner.assignmentType && learner.assignmentType !== '主職') reasons.push('非主職');
    if (isCaseStaffVirtualTarget) {
      if (!isCaseStaffOrgCode_(learner.assignmentOrgCode)) reasons.push('不在收案人員範圍');
    } else {
      if (learner.assignmentOrgType !== payload.target.orgType) reasons.push('組織類型不符');
      if (payload.target.level !== '' && Number(learner.assignmentOrgLevel || 0) !== Number(payload.target.level)) reasons.push('層級不符');
      if (orgCodeSet.size > 0 && !orgCodeSet.has(normalizeOrgCode_(learner.assignmentOrgCode))) reasons.push('不在目標組織');
    }
    if (!matchesNotificationStatusFilter_(learner.status, payload.trainingStatus)) reasons.push('訓練狀態不符');
    if (payload.personnelStatus && String(learner.personnelStatus || '').trim() !== payload.personnelStatus) reasons.push('人員狀態不符');
    if (!isValidEmail_(learner.email)) reasons.push('信箱格式不正確');
    if (dedupe.has(learner.email)) reasons.push('重複信箱');

    if (reasons.length > 0) {
      if (reasons[0] === '缺少信箱' || reasons[0] === '信箱格式不正確' || reasons[0] === '重複信箱') {
        skipped.push({
          email: learner.email,
          name: learner.name,
          reason: reasons[0]
        });
      }
      return;
    }

    dedupe.add(learner.email);
    recipients.push({
      email: learner.email,
      name: learner.name,
      personnelStatus: learner.personnelStatus,
      assignmentOrgName: learner.assignmentOrgName,
      assignmentTitle: learner.assignmentTitle,
      watchedPercent: learner.watchedPercent,
      bestScore: learner.bestScore,
      status: learner.status,
      statusLabel: learner.statusLabel
    });
  });

  return { recipients, skipped };
}

function resolveNotificationTargetOrgCodes_(orgNodes, target) {
  if (isCaseStaffVirtualTarget_(target.orgCode)) return [];
  const filteredByType = orgNodes.filter((node) => String(node.type || '').trim() === target.orgType);
  if (!target.orgCode) {
    if (target.level === '') return filteredByType.map((node) => node.code);
    return filteredByType
      .filter((node) => Number(node.level || 0) === Number(target.level))
      .map((node) => node.code);
  }

  const baseCode = normalizeOrgCode_(target.orgCode);
  const childMap = buildOrgChildrenMap_(orgNodes);
  return Array.from(collectDescendantOrgCodes_(baseCode, childMap, getDescendantDepthLimit_(target.descendantMode)));
}

function buildOrgChildrenMap_(orgNodes) {
  const childMap = new Map();
  orgNodes.forEach((node) => {
    const parentCode = normalizeOrgCode_(node.parentCode);
    if (!parentCode) return;
    if (!childMap.has(parentCode)) childMap.set(parentCode, []);
    childMap.get(parentCode).push(normalizeOrgCode_(node.code));
  });
  return childMap;
}

function collectDescendantOrgCodes_(startCode, childMap, maxDepth) {
  const collected = new Set();
  const queue = [{ code: normalizeOrgCode_(startCode), depth: 0 }];
  const depthLimit = Number.isFinite(maxDepth) ? Number(maxDepth) : Infinity;
  while (queue.length > 0) {
    const currentItem = queue.shift();
    const current = currentItem && currentItem.code ? currentItem.code : '';
    const currentDepth = currentItem && Number.isFinite(currentItem.depth) ? Number(currentItem.depth) : 0;
    if (!current || collected.has(current)) continue;
    collected.add(current);
    if (currentDepth >= depthLimit) continue;
    const children = childMap.get(current) || [];
    children.forEach((child) => {
      if (!collected.has(child)) queue.push({ code: child, depth: currentDepth + 1 });
    });
  }
  return collected;
}

function getDescendantDepthLimit_(descendantMode) {
  const mode = String(descendantMode || 'self').trim();
  if (mode === 'depth_1') return 1;
  if (mode === 'depth_2') return 2;
  if (mode === 'depth_3') return 3;
  if (mode === 'all_descendants') return Infinity;
  return 0;
}

function matchesNotificationStatusFilter_(learnerStatus, filterValue) {
  if (filterValue === 'all') return true;
  if (filterValue === 'incomplete') return learnerStatus !== 'completed';
  return learnerStatus === filterValue;
}

function applyNotificationTemplate_(template, recipient, courseTitle, trainingCourseUrl, templateContext) {
  const replacements = {
    '{{姓名}}': recipient.name || '',
    '{{信箱}}': recipient.email || '',
    '{{單位}}': recipient.assignmentOrgName || '',
    '{{職稱}}': recipient.assignmentTitle || '',
    '{{課程名稱}}': courseTitle || DASHBOARD_CONFIG.defaultCourseTitle,
    '{{訓練狀態}}': recipient.statusLabel || '',
    '{{上課網址}}': trainingCourseUrl || '',
    '{{組別稱呼}}': templateContext && templateContext.groupGreeting || '',
    '{{駐站管理稱呼}}': templateContext && templateContext.stationManagerGreeting || ''
  };

  let output = String(template || '');
  Object.keys(replacements).forEach((token) => {
    output = output.split(token).join(String(replacements[token]));
  });
  return output;
}

function applyGenericNotificationTemplate_(template, courseTitle, trainingCourseUrl, templateContext) {
  let output = String(template || '');
  const replacements = {
    '{{課程名稱}}': courseTitle || DASHBOARD_CONFIG.defaultCourseTitle,
    '{{上課網址}}': trainingCourseUrl || '',
    '{{組別稱呼}}': templateContext && templateContext.groupGreeting || '',
    '{{駐站管理稱呼}}': templateContext && templateContext.stationManagerGreeting || ''
  };
  Object.keys(replacements).forEach((token) => {
    output = output.split(token).join(String(replacements[token]));
  });
  return output;
}

function buildNotificationTemplateContext_(context, payload) {
  return {
    groupGreeting: resolveNotificationGroupGreeting_(context, payload),
    stationManagerGreeting: resolveNotificationStationManagerGreeting_(context, payload)
  };
}

function resolveNotificationGroupGreeting_(context, payload) {
  const fallback = '長官、主管、組長和同仁們好：';
  const target = payload && payload.target ? payload.target : {};
  const orgCode = normalizeOrgCode_(target.orgCode);
  if (!orgCode) return fallback;
  const orgNode = context && context.orgNodeMap ? context.orgNodeMap.get(orgCode) : null;
  if (!orgNode) return fallback;
  const displayName = String(orgNode.name || orgNode.alias || orgNode.code || '').trim();
  if (!displayName) return fallback;
  return `${displayName}的同仁們好：`;
}

function resolveNotificationStationManagerGreeting_(context, payload) {
  const fallback = '駐站管理員您好：';
  const target = payload && payload.target ? payload.target : {};
  const orgCode = normalizeOrgCode_(target.orgCode);
  if (!orgCode) return fallback;
  const orgNode = context && context.orgNodeMap ? context.orgNodeMap.get(orgCode) : null;
  if (!orgNode) return fallback;
  const displayName = String(orgNode.name || orgNode.alias || orgNode.code || '').trim();
  if (!displayName) return fallback;
  if (isStationOrgCode_(orgCode)) return `${displayName}駐站管理員您好：`;
  return `${displayName}的同仁們好：`;
}

function isStationOrgCode_(orgCode) {
  return String(orgCode || '').trim().toUpperCase().startsWith('GRP-CO-');
}

function buildNotificationCriteriaSummary_(payload) {
  const isCaseStaffVirtualTarget = isCaseStaffVirtualTarget_(payload.target.orgCode);
  return {
    templateType: payload.templateType,
    deliveryMode: payload.deliveryMode,
    layeredTargetRole: payload.layeredTargetRole || '',
    orgType: payload.target.orgType,
    level: isCaseStaffVirtualTarget ? '' : payload.target.level,
    orgCode: payload.target.orgCode,
    descendantMode: isCaseStaffVirtualTarget ? 'self' : payload.target.descendantMode,
    trainingStatus: payload.trainingStatus,
    personnelStatus: payload.personnelStatus,
    assignmentMatch: payload.target.assignmentMatch
  };
}

function getTrainingCourseUrl_() {
  if (typeof ENV === 'undefined' || !ENV.TRAINING_COURSE_URL || String(ENV.TRAINING_COURSE_URL).includes('請填入')) {
    throw new Error('未設定教育訓練上課網址 ENV.TRAINING_COURSE_URL');
  }
  return String(ENV.TRAINING_COURSE_URL || '').trim();
}

function appendNotificationLog_(entry) {
  const ss = getTrainingSpreadsheet_();
  const sheet = getOrCreateSheetWithHeaders_(ss, DASHBOARD_CONFIG.notificationLogSheetName, TRAINING_SHEET_HEADERS[DASHBOARD_CONFIG.notificationLogSheetName]);
  sheet.appendRow([
    Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'),
    entry.operatorEmail || '',
    entry.courseTitle || '',
    getNotificationTemplateLabel_(entry.payload.templateType),
    getNotificationDeliveryModeLabel_(entry.payload.deliveryMode),
    entry.payload.target.orgType || '',
    isCaseStaffVirtualTarget_(entry.payload.target.orgCode) ? '' : (entry.payload.target.level === '' ? '' : Number(entry.payload.target.level || 0)),
    getNotificationTargetOrgLabel_(entry.payload.target.orgCode),
    getNotificationDescendantModeLabel_(entry.payload.target.descendantMode),
    entry.payload.trainingStatus || '',
    entry.payload.personnelStatus || '',
    entry.payload.template.subject || '',
    Number(entry.recipientCount || 0),
    Number(entry.sentCount || 0),
    Number(entry.skippedCount || 0)
  ]);
  SpreadsheetApp.flush();
}

function getNotificationTemplateLabel_(templateType) {
  const labels = {
    personalized: '個人化版',
    case_staff_personalized: '收案人員版',
    case_staff_layered_reminder: '收案分層提醒',
    parental_leave_personalized: '育嬰假版',
    announcement: '公告版',
    group_announcement: '組別版',
    station_manager_announcement: '駐站管理員版',
    leadership_announcement_summary: '長官主管摘要版',
    leadership_announcement: '長官主管完整版'
  };
  return labels[String(templateType || '').trim()] || '個人化版';
}

function getNotificationDeliveryModeLabel_(deliveryMode) {
  const labels = {
    individual: '個人化逐封',
    single_bcc: '單封 BCC',
    layered: '分層寄送'
  };
  return labels[String(deliveryMode || 'individual').trim()] || '個人化逐封';
}

function getNotificationTargetOrgLabel_(orgCode) {
  if (isCaseStaffVirtualTarget_(orgCode)) return '收案人員';
  return String(orgCode || '').trim();
}

function getNotificationDescendantModeLabel_(descendantMode) {
  const labels = {
    self: '本組',
    depth_1: '下1層',
    depth_2: '下2層',
    depth_3: '下3層',
    all_descendants: '全部下層'
  };
  return labels[String(descendantMode || 'self').trim()] || '本組';
}

function getMasterSpreadsheet_() {
  if (typeof ENV === 'undefined' || !ENV.MASTER_SHEET_ID || ENV.MASTER_SHEET_ID.includes('請填入')) {
    throw new Error('未設定人員總表 ID');
  }
  return SpreadsheetApp.openById(ENV.MASTER_SHEET_ID);
}

function getTrainingSpreadsheet_() {
  if (typeof ENV === 'undefined' || !ENV.TRAINING_SHEET_ID || ENV.TRAINING_SHEET_ID.includes('請填入')) {
    throw new Error('未設定教育訓練資料表 ID');
  }
  return SpreadsheetApp.openById(ENV.TRAINING_SHEET_ID);
}

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`找不到工作表：${sheetName}`);
  }
  return sheet;
}

function getOptionalSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName);
}

function getOrCreateSheetWithHeaders_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    const isSame = headers.every((header, index) => String(currentHeaders[index] || '').trim() === String(header || '').trim());
    if (!isSame) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function buildAssignmentTypeMap_(assignments) {
  const groupedAssignments = new Map();
  const typeMap = new Map();

  assignments.forEach((item) => {
    const emailKey = normalizeEmail_(item.email);
    if (!groupedAssignments.has(emailKey)) groupedAssignments.set(emailKey, []);
    groupedAssignments.get(emailKey).push(item);
  });

  groupedAssignments.forEach((personAssignments) => {
    const primaryMode = getPrimaryAssignmentMode_(personAssignments);
    const duplicateOrgCodeTypeMap = buildDuplicateOrgCodeTypeMap_(personAssignments, primaryMode);
    const primaryAssignments = isExplicitPrimaryKind_(primaryMode)
      ? personAssignments.filter((item) => classifyAssignmentKind_(item.orgCode) === primaryMode)
      : [];
    const primaryManagerEmails = new Set(
      primaryAssignments
        .map((item) => normalizeEmail_(item.managerEmail))
        .filter(Boolean)
    );

    personAssignments.forEach((item) => {
      const itemKey = getAssignmentIdentityKey_(item);
      const itemKind = classifyAssignmentKind_(item.orgCode);
      const managerEmail = normalizeEmail_(item.managerEmail);
      const duplicateType = duplicateOrgCodeTypeMap.get(itemKey);

      if (duplicateType) {
        typeMap.set(itemKey, duplicateType);
        return;
      }

      if (isFallbackPrimaryMode_(primaryMode)) {
        typeMap.set(itemKey, '主職');
        return;
      }

      if (isExplicitPrimaryKind_(primaryMode) && itemKind === primaryMode) {
        typeMap.set(itemKey, '主職');
        return;
      }

      if (!primaryMode) {
        typeMap.set(itemKey, '兼任');
        return;
      }

      if (isExplicitPrimaryKind_(primaryMode) && isTfAssignment_(item.orgCode)) {
        if (!managerEmail || primaryManagerEmails.size === 0) {
          typeMap.set(itemKey, '兼任');
          return;
        }
        typeMap.set(itemKey, primaryManagerEmails.has(managerEmail) ? '兼任' : '矩陣兼任');
        return;
      }

      if (!managerEmail || primaryManagerEmails.size === 0) {
        typeMap.set(itemKey, '兼任');
        return;
      }

      typeMap.set(itemKey, primaryManagerEmails.has(managerEmail) ? '垂直兼任' : '矩陣兼任');
    });
  });

  return typeMap;
}

function buildDuplicateOrgCodeTypeMap_(personAssignments, primaryMode) {
  if (!isExplicitPrimaryKind_(primaryMode)) return new Map();

  const assignmentsByOrgCode = new Map();
  const duplicateTypeMap = new Map();

  personAssignments.forEach((item) => {
    if (classifyAssignmentKind_(item.orgCode) !== primaryMode) return;
    const orgCodeKey = String(item.orgCode || '').trim().toUpperCase();
    if (!orgCodeKey) return;
    if (!assignmentsByOrgCode.has(orgCodeKey)) assignmentsByOrgCode.set(orgCodeKey, []);
    assignmentsByOrgCode.get(orgCodeKey).push(item);
  });

  assignmentsByOrgCode.forEach((orgAssignments) => {
    if (orgAssignments.length < 2) return;

    const leaderAssignments = orgAssignments.filter((item) => titleContainsLeaderKeyword_(item.title));
    if (leaderAssignments.length !== 1) return;

    const primaryKey = getAssignmentIdentityKey_(leaderAssignments[0]);
    orgAssignments.forEach((item) => {
      const itemKey = getAssignmentIdentityKey_(item);
      duplicateTypeMap.set(itemKey, itemKey === primaryKey ? '主職' : '垂直兼任');
    });
  });

  return duplicateTypeMap;
}

function getPrimaryAssignmentMode_(personAssignments) {
  if (personAssignments.some((item) => classifyAssignmentKind_(item.orgCode) === 'PRE')) return 'PRE';
  if (personAssignments.some((item) => classifyAssignmentKind_(item.orgCode) === 'CEO')) return 'CEO';
  if (personAssignments.some((item) => classifyAssignmentKind_(item.orgCode) === 'DEPT')) return 'DEPT';
  if (personAssignments.some((item) => classifyAssignmentKind_(item.orgCode) === 'GRP')) return 'GRP';

  const managerEmails = personAssignments.map((item) => normalizeEmail_(item.managerEmail));
  const nonEmptyManagerEmails = [...new Set(managerEmails.filter(Boolean))];
  if (nonEmptyManagerEmails.length === 1) return 'FALLBACK_SINGLE_MANAGER';
  if (managerEmails.length > 0 && managerEmails.every((managerEmail) => !managerEmail)) return 'FALLBACK_NO_MANAGER';

  return null;
}

function classifyAssignmentKind_(orgCode) {
  const normalized = String(orgCode || '').trim().toUpperCase();
  if (normalized === 'PRE') return 'PRE';
  if (normalized === 'CEO') return 'CEO';
  if (normalized.startsWith('DEPT-')) return 'DEPT';
  if (normalized.startsWith('GRP-')) return 'GRP';
  return 'OTHER';
}

function isExplicitPrimaryKind_(primaryMode) {
  return primaryMode === 'PRE'
    || primaryMode === 'CEO'
    || primaryMode === 'DEPT'
    || primaryMode === 'GRP';
}

function isFallbackPrimaryMode_(primaryMode) {
  return primaryMode === 'FALLBACK_SINGLE_MANAGER'
    || primaryMode === 'FALLBACK_NO_MANAGER';
}

function isTfAssignment_(orgCode) {
  return String(orgCode || '').trim().toUpperCase().startsWith('TF-');
}

function titleContainsLeaderKeyword_(title) {
  return String(title || '').trim().includes('長');
}

function getAssignmentIdentityKey_(assignment) {
  return [
    normalizeEmail_(assignment.email),
    String(assignment.orgCode || '').trim().toUpperCase(),
    String(assignment.title || '').trim(),
    normalizeEmail_(assignment.managerEmail),
    String(assignment.rowIndex || '')
  ].join('||');
}

function getAssignmentSortOrder_(type) {
  const orderMap = {
    主職: 1,
    垂直兼任: 2,
    兼任: 3,
    矩陣兼任: 4
  };
  return orderMap[type] || 99;
}

function buildDashboardPermissionResponse_(viewerEmail, authorized, message) {
  return {
    success: false,
    authorized,
    viewerEmail,
    message
  };
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeOrgCode_(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidEmail_(value) {
  const email = normalizeEmail_(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
