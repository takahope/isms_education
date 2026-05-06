/**
 * ==========================================
 * 後端邏輯：Google Apps Script (Code.gs)
 * ==========================================
 */

const QUIZ_CONFIG = {
  questionSheetName: '題庫',
  trainingRecordSheetName: '訓練紀錄',
  answerRecordSheetName: '答題紀錄',
  progressSheetName: '觀看進度',
  questionCount: 10,
  passingScore: 70,
  pointsPerQuestion: 10,
  cacheSeconds: 6 * 60 * 60
};

const DASHBOARD_CONFIG = {
  allowedEmailsPropertyKey: 'DASHBOARD_ALLOWED_EMAILS',
  requiredWatchSeconds: 60 * 60,
  recentActivityDays: 7,
  defaultCourseTitle: '資安暨個資教育訓練',
  maxAlertItems: 8
};

const SHEET_HEADERS = {
  題庫: ['題目ID', '是否啟用', '年度', '主題', '題型', '題目內容', '選項A', '選項B', '選項C', '選項D', '選項E', '正確答案', '答案說明', '來源標註', '備註'],
  訓練紀錄: ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  答題紀錄: ['時間戳記', '測驗批次ID', '姓名', '使用者信箱', '課程名稱', '題目序號', '題目ID', '主題', '題型', '題目內容', '選項快照', '正確答案', '作答答案', '是否答對', '本題得分', '來源標註'],
  觀看進度: ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間', '最後同步來源版本']
};

// 1. 發佈為 Web App 時的進入點
function doGet(e) {
  const view = String(e && e.parameter && e.parameter.view || '').trim().toLowerCase();
  if (view === 'dashboard') {
    return renderDashboardPage_();
  }
  return renderTrainingPage_();
}

// 2. 獲取當前登入使用者的 Email (供前端顯示)
function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function getCurrentUserProfile() {
  const fallbackEmail = getCurrentUserEmail();

  try {
    const email = normalizeEmail_(fallbackEmail);
    const masterSS = getMasterSpreadsheet_();
    const personnelSheet = getRequiredSheet_(masterSS, '人員主檔');
    const assignmentSheet = getRequiredSheet_(masterSS, '人員職務配置');
    const name = findPersonnelNameByEmail_(personnelSheet, email);
    const assignments = buildUserAssignments_(assignmentSheet, email);

    return {
      success: true,
      email,
      name,
      assignments
    };
  } catch (error) {
    console.error('讀取首頁人員資料失敗:', error);
    return {
      success: false,
      email: fallbackEmail || '',
      name: '',
      assignments: [],
      message: error && error.message ? error.message : '無法讀取人員資料'
    };
  }
}

function getTrainingDashboardBootstrap() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return {
      success: false,
      authorized: false,
      viewerEmail,
      message: '您沒有查看學員訓練儀表板的權限。'
    };
  }

  return {
    success: true,
    authorized: true,
    viewerEmail,
    requiredWatchSeconds: DASHBOARD_CONFIG.requiredWatchSeconds,
    dashboardUrl: buildDashboardUrl_(),
    courseTitle: DASHBOARD_CONFIG.defaultCourseTitle
  };
}

function getTrainingDashboardData(filters) {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  if (!canAccessDashboard_(viewerEmail)) {
    return {
      success: false,
      authorized: false,
      viewerEmail,
      message: '您沒有查看學員訓練儀表板的權限。'
    };
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
    return {
      success: false,
      authorized: true,
      viewerEmail,
      message: error && error.message ? error.message : '無法載入訓練儀表板資料。'
    };
  }
}

// 3. 根據 Email 從人員主檔查姓名
function getUserNameByEmail(email) {
  try {
    const masterSheet = getRequiredSheet_(getMasterSpreadsheet_(), '人員主檔');
    const name = findPersonnelNameByEmail_(masterSheet, email);
    if (name) return name;
    return '查無此人';
  } catch (e) {
    console.error('讀取人員主檔失敗:', e);
    if (e && e.message === '未設定主檔ID') return '未設定主檔ID';
    if (e && e.message === '找不到人員主檔') return '找不到人員主檔';
    return '讀取失敗';
  }
}

function getMasterSpreadsheet_() {
  if (typeof ENV === 'undefined' || !ENV.MASTER_SHEET_ID || ENV.MASTER_SHEET_ID.includes('請在此填入')) {
    throw new Error('未設定主檔ID');
  }

  return SpreadsheetApp.openById(ENV.MASTER_SHEET_ID);
}

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`找不到${sheetName}`);
  }
  return sheet;
}

function getOptionalSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName);
}

function findPersonnelNameByEmail_(sheet, email) {
  const normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) return '';

  const data = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i += 1) {
    if (normalizeEmail_(data[i][0]) === normalizedEmail) {
      return String(data[i][1] || '').trim();
    }
  }

  return '';
}

function getAssignmentsByEmail_(sheet, email) {
  const normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) return [];

  const rows = sheet.getDataRange().getDisplayValues();
  const assignments = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (normalizeEmail_(rows[i][0]) !== normalizedEmail) continue;

    assignments.push({
      rowIndex: i + 1,
      email: rows[i][0],
      name: rows[i][1],
      orgCode: rows[i][2],
      orgName: rows[i][3],
      title: rows[i][4],
      managerEmail: rows[i][5]
    });
  }

  return assignments;
}

function renderTrainingPage_() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('臺灣人體生物資料庫資安暨個資教育訓練')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

function getDashboardAllowedEmails_() {
  const raw = PropertiesService.getScriptProperties().getProperty(DASHBOARD_CONFIG.allowedEmailsPropertyKey) || '';
  return raw
    .split(/[\n,;]+/)
    .map((item) => normalizeEmail_(item))
    .filter(Boolean);
}

function buildDashboardUrl_() {
  try {
    const appUrl = ScriptApp.getService().getUrl();
    return appUrl ? `${appUrl}?view=dashboard` : '';
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
      color-scheme: light;
      --bg: #eef4f7;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #0f766e;
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
      color: var(--accent);
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
    <p>請在 Apps Script 的 Script Properties 設定 <code>${propertyKey}</code>，並將允許進入儀表板的 email 白名單加入後重新整理頁面。</p>
  </main>
</body>
</html>`;
}

function buildTrainingDashboardData_() {
  const generatedAt = new Date();
  const roster = loadDashboardRoster_();
  const trainingRecords = loadTrainingRecords_();
  const progressRecords = loadProgressRecords_();
  const quizByEmail = buildQuizSummaryByEmail_(trainingRecords);
  const progressByEmail = buildProgressSummaryByEmail_(progressRecords);
  const learnerRows = roster.map((person) => {
    const normalizedEmail = normalizeEmail_(person.email);
    const quiz = quizByEmail.get(normalizedEmail) || createEmptyQuizSummary_();
    const progress = progressByEmail.get(normalizedEmail) || createEmptyProgressSummary_();
    const watchedPercent = DASHBOARD_CONFIG.requiredWatchSeconds > 0
      ? Math.min(100, Math.round((progress.watchedSecondsCount / DASHBOARD_CONFIG.requiredWatchSeconds) * 100))
      : 0;
    const watchCompleted = progress.watchedSecondsCount >= DASHBOARD_CONFIG.requiredWatchSeconds;
    const status = resolveLearnerTrainingStatus_(watchCompleted, quiz.hasPassed, progress.watchedSecondsCount, quiz.attemptCount);
    const lastActivityAt = getLatestTimestampString_(progress.updatedAt, quiz.latestAttemptAt);

    return {
      email: normalizedEmail,
      name: person.name,
      assignmentLabel: person.assignmentLabel,
      assignmentType: person.assignmentType,
      assignmentOrgName: person.assignmentOrgName,
      assignmentTitle: person.assignmentTitle,
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
    };
  });

  learnerRows.sort((left, right) => {
    const statusDiff = getDashboardStatusSortOrder_(left.status) - getDashboardStatusSortOrder_(right.status);
    if (statusDiff !== 0) return statusDiff;
    const activityDiff = compareDashboardTimestamps_(right.lastActivityAt, left.lastActivityAt);
    if (activityDiff !== 0) return activityDiff;
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-Hant');
  });

  return {
    generatedAt: generatedAt.toISOString(),
    courseTitle: resolveDashboardCourseTitle_(learnerRows),
    requiredWatchSeconds: DASHBOARD_CONFIG.requiredWatchSeconds,
    kpis: buildDashboardKpis_(learnerRows, generatedAt),
    units: buildDashboardUnitSummary_(learnerRows),
    alerts: buildDashboardAlerts_(learnerRows, generatedAt),
    learners: learnerRows
  };
}

function loadDashboardRoster_() {
  const masterSS = getMasterSpreadsheet_();
  const personnelSheet = getRequiredSheet_(masterSS, '人員主檔');
  const assignmentSheet = getOptionalSheet_(masterSS, '人員職務配置');
  const personnelRows = personnelSheet.getDataRange().getDisplayValues();
  const allAssignments = assignmentSheet ? readAllAssignments_(assignmentSheet) : [];
  const assignmentByEmail = buildDashboardAssignmentSummaryByEmail_(allAssignments);
  const roster = [];

  for (let i = 1; i < personnelRows.length; i += 1) {
    const email = normalizeEmail_(personnelRows[i][0]);
    if (!email) continue;
    const name = String(personnelRows[i][1] || '').trim();
    const assignment = assignmentByEmail.get(email) || createEmptyAssignmentSummary_();
    roster.push({
      email,
      name,
      ...assignment
    });
  }

  return roster;
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
      managerEmail: normalizeEmail_(rows[i][5])
    });
  }
  return assignments;
}

function buildDashboardAssignmentSummaryByEmail_(assignments) {
  const assignmentTypeMap = buildAssignmentTypeMap_(assignments);
  const grouped = new Map();

  assignments.forEach((assignment) => {
    const email = normalizeEmail_(assignment.email);
    if (!grouped.has(email)) grouped.set(email, []);
    grouped.get(email).push({
      orgName: assignment.orgName,
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
      assignmentOrgName: primaryItem ? primaryItem.orgName : '',
      assignmentTitle: primaryItem ? primaryItem.title : ''
    });
  });

  return summaryByEmail;
}

function createEmptyAssignmentSummary_() {
  return {
    assignmentLabel: '未設定職務',
    assignmentType: '',
    assignmentOrgName: '',
    assignmentTitle: ''
  };
}

function loadTrainingRecords_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOptionalSheet_(ss, QUIZ_CONFIG.trainingRecordSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SHEET_HEADERS[QUIZ_CONFIG.trainingRecordSheetName].length).getDisplayValues();
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

function loadProgressRecords_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOptionalSheet_(ss, QUIZ_CONFIG.progressSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SHEET_HEADERS[QUIZ_CONFIG.progressSheetName].length).getDisplayValues();
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
  const pendingQuiz = learners
    .filter((learner) => learner.status === 'pending_quiz')
    .slice(0, DASHBOARD_CONFIG.maxAlertItems);
  const staleInProgress = learners
    .filter((learner) => {
      if (learner.status !== 'in_progress') return false;
      const activityMs = parseDashboardTimestampMs_(learner.lastActivityAt);
      return !activityMs || activityMs < recentThresholdMs;
    })
    .slice(0, DASHBOARD_CONFIG.maxAlertItems);
  const latestFailed = learners
    .filter((learner) => learner.latestResult === '未通過' && !learner.hasPassed)
    .slice(0, DASHBOARD_CONFIG.maxAlertItems);

  return {
    pendingQuiz,
    staleInProgress,
    latestFailed
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

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildUserAssignments_(sheet, email) {
  const assignments = getAssignmentsByEmail_(sheet, email);
  if (assignments.length === 0) return [];

  const assignmentTypeMap = buildAssignmentTypeMap_(assignments);
  return assignments
    .map((assignment) => ({
      type: assignmentTypeMap.get(getAssignmentIdentityKey_(assignment)) || '兼任',
      orgName: String(assignment.orgName || '').trim(),
      title: String(assignment.title || '').trim()
    }))
    .sort((a, b) => getAssignmentSortOrder_(a.type) - getAssignmentSortOrder_(b.type));
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
    const duplicateOrgCodeTypeMap = buildDuplicateOrgCodeTypeMap_(personAssignments);
    const primaryMode = getPrimaryAssignmentMode_(personAssignments);
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

function buildDuplicateOrgCodeTypeMap_(personAssignments) {
  const assignmentsByOrgCode = new Map();
  const duplicateTypeMap = new Map();

  personAssignments.forEach((item) => {
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

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function getQuizQuestions() {
  try {
    ensureSheetHeaders_();
    const questionBank = loadQuestionBank_();
    const selectedQuestions = selectQuestions_(questionBank, QUIZ_CONFIG.questionCount);
    const attemptId = Utilities.getUuid();

    CacheService.getScriptCache().put(
      getAttemptCacheKey_(attemptId),
      JSON.stringify(selectedQuestions),
      QUIZ_CONFIG.cacheSeconds
    );

    return {
      success: true,
      attemptId,
      questionCount: QUIZ_CONFIG.questionCount,
      passingScore: QUIZ_CONFIG.passingScore,
      questions: selectedQuestions.map(toQuestionPayload_)
    };
  } catch (error) {
    console.error('載入題庫失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '題庫載入失敗，請聯繫系統管理員。'
    };
  }
}

function submitQuizAttempt(payload) {
  try {
    ensureSheetHeaders_();
    validateQuizPayload_(payload);

    const attemptQuestions = getAttemptQuestions_(payload.attemptId);
    const answerMap = normalizeAnswers_(payload.answers);
    const gradingResult = gradeAnswers_(attemptQuestions, answerMap);
    const email = String(payload.userEmail || '').trim();
    const userName = getUserNameByEmail(email);
    const timestamp = new Date();

    writeTrainingRecord_({
      timestamp,
      attemptId: payload.attemptId,
      userName,
      userEmail: email,
      videoTitle: payload.videoTitle,
      score: gradingResult.score,
      isPassed: gradingResult.isPassed
    });

    writeAnswerRecords_({
      timestamp,
      attemptId: payload.attemptId,
      userName,
      userEmail: email,
      videoTitle: payload.videoTitle,
      gradedQuestions: gradingResult.gradedQuestions
    });

    return {
      success: true,
      score: gradingResult.score,
      isPassed: gradingResult.isPassed,
      passingScore: QUIZ_CONFIG.passingScore
    };
  } catch (error) {
    console.error('送出測驗失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '系統發生錯誤，無法儲存測驗紀錄。'
    };
  }
}

function getTrainingProgress(payload) {
  try {
    ensureSheetHeaders_();
    const normalized = normalizeProgressPayload_(payload, { requireProgressData: false });
    const progressSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(QUIZ_CONFIG.progressSheetName);
    const progressRow = findProgressRow_(progressSheet, normalized.userEmail, normalized.videoId);

    if (!progressRow) {
      return { success: true, progress: null };
    }

    return {
      success: true,
      progress: {
        userEmail: progressRow.userEmail,
        videoTitle: progressRow.videoTitle,
        videoId: progressRow.videoId,
        watchedRanges: progressRow.watchedRanges,
        watchedSecondsCount: progressRow.watchedSecondsCount,
        lastPlaybackPosition: progressRow.lastPlaybackPosition,
        updatedAt: progressRow.updatedAt,
        sourceVersion: progressRow.sourceVersion
      }
    };
  } catch (error) {
    console.error('讀取觀看進度失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法載入觀看進度。'
    };
  }
}

function syncTrainingProgress(payload) {
  try {
    ensureSheetHeaders_();
    const normalized = normalizeProgressPayload_(payload, { requireProgressData: true });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progressSheet = ss.getSheetByName(QUIZ_CONFIG.progressSheetName);
    const existing = findProgressRow_(progressSheet, normalized.userEmail, normalized.videoId);

    if (existing && compareIsoTimestamps_(normalized.updatedAt, existing.updatedAt) < 0) {
      return {
        success: true,
        skipped: true,
        progress: {
          userEmail: existing.userEmail,
          videoTitle: existing.videoTitle,
          videoId: existing.videoId,
          watchedRanges: existing.watchedRanges,
          watchedSecondsCount: existing.watchedSecondsCount,
          lastPlaybackPosition: existing.lastPlaybackPosition,
          updatedAt: existing.updatedAt,
          sourceVersion: existing.sourceVersion
        }
      };
    }

    const rowValues = [[
      normalized.userEmail,
      normalized.videoTitle,
      normalized.videoId,
      normalized.watchedRanges,
      normalized.watchedSecondsCount,
      normalized.lastPlaybackPosition,
      normalized.updatedAt,
      normalized.sourceVersion
    ]];

    if (existing) {
      progressSheet.getRange(existing.rowNumber, 1, 1, rowValues[0].length).setValues(rowValues);
    } else {
      progressSheet.getRange(progressSheet.getLastRow() + 1, 1, 1, rowValues[0].length).setValues(rowValues);
    }
    SpreadsheetApp.flush();

    return {
      success: true,
      skipped: false,
      progress: {
        userEmail: normalized.userEmail,
        videoTitle: normalized.videoTitle,
        videoId: normalized.videoId,
        watchedRanges: normalized.watchedRanges,
        watchedSecondsCount: normalized.watchedSecondsCount,
        lastPlaybackPosition: normalized.lastPlaybackPosition,
        updatedAt: normalized.updatedAt,
        sourceVersion: normalized.sourceVersion
      }
    };
  } catch (error) {
    console.error('同步觀看進度失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法同步觀看進度。'
    };
  }
}

// 舊前端相容入口，保留摘要寫入能力。
function submitTrainingResult(data) {
  try {
    ensureSheetHeaders_();
    const email = String((data && data.userName) || '').trim();
    const score = Number((data && data.score) || 0);
    const isPassed = Boolean(data && data.isPassed);

    writeTrainingRecord_({
      timestamp: new Date(),
      attemptId: Utilities.getUuid(),
      userName: getUserNameByEmail(email),
      userEmail: email,
      videoTitle: data && data.videoTitle ? data.videoTitle : '',
      score,
      isPassed
    });

    return { success: true, message: '紀錄已成功儲存！' };
  } catch (error) {
    console.error('寫入試算表失敗:', error);
    return { success: false, message: '系統發生錯誤，無法儲存紀錄。' };
  }
}

function ensureSheetHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach((sheetName) => {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SHEET_HEADERS[sheetName];

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    const currentHeaders = headerRange.getDisplayValues()[0];
    const shouldRewriteHeader = headers.some((header, index) => currentHeaders[index] !== header);

    if (shouldRewriteHeader) {
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold').setBackground('#f8fafc');
    }
  });
}

function normalizeProgressPayload_(payload, options) {
  const normalized = {
    userEmail: String(payload && payload.userEmail || '').trim(),
    videoTitle: String(payload && payload.videoTitle || '').trim(),
    videoId: String(payload && payload.videoId || '').trim(),
    watchedRanges: String(payload && payload.watchedRanges || '').trim(),
    watchedSecondsCount: Number(payload && payload.watchedSecondsCount || 0),
    lastPlaybackPosition: Number(payload && payload.lastPlaybackPosition || 0),
    updatedAt: normalizeIsoTimestamp_(payload && payload.updatedAt),
    sourceVersion: String(payload && payload.sourceVersion || '2').trim()
  };

  if (!normalized.userEmail) {
    throw new Error('缺少使用者信箱。');
  }
  if (!normalized.videoId) {
    throw new Error('缺少影片ID。');
  }
  if (options && options.requireProgressData) {
    if (!normalized.updatedAt) {
      throw new Error('缺少觀看進度更新時間。');
    }
    if (normalized.watchedSecondsCount < 0) {
      throw new Error('觀看秒數不可為負值。');
    }
  }

  return normalized;
}

function normalizeIsoTimestamp_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('觀看進度時間格式錯誤。');
  }
  return parsed.toISOString();
}

function compareIsoTimestamps_(left, right) {
  const leftTime = Date.parse(String(left || ''));
  const rightTime = Date.parse(String(right || ''));
  const normalizedLeft = Number.isNaN(leftTime) ? 0 : leftTime;
  const normalizedRight = Number.isNaN(rightTime) ? 0 : rightTime;
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

function findProgressRow_(sheet, userEmail, videoId) {
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(1, 1, lastRow, SHEET_HEADERS[QUIZ_CONFIG.progressSheetName].length).getDisplayValues();
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (String(row[0] || '').trim() === userEmail && String(row[2] || '').trim() === videoId) {
      return {
        rowNumber: i + 1,
        userEmail: String(row[0] || '').trim(),
        videoTitle: String(row[1] || '').trim(),
        videoId: String(row[2] || '').trim(),
        watchedRanges: String(row[3] || '').trim(),
        watchedSecondsCount: Number(row[4] || 0),
        lastPlaybackPosition: Number(row[5] || 0),
        updatedAt: String(row[6] || '').trim(),
        sourceVersion: String(row[7] || '').trim()
      };
    }
  }

  return null;
}

function loadQuestionBank_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(QUIZ_CONFIG.questionSheetName);
  const headers = SHEET_HEADERS[QUIZ_CONFIG.questionSheetName];

  if (!sheet) {
    throw new Error('找不到「題庫」工作表。');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('題庫尚未建立內容，請先在「題庫」工作表新增題目。');
  }

  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headerIndex = buildHeaderIndex_(values[0], headers);
  const questions = [];

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const questionId = getCell_(row, headerIndex, '題目ID') || `ROW-${i + 1}`;
    const enabledValue = getCell_(row, headerIndex, '是否啟用');
    const type = normalizeQuestionType_(getCell_(row, headerIndex, '題型'));
    const prompt = getCell_(row, headerIndex, '題目內容');
    const answerCodes = normalizeAnswerCodes_(getCell_(row, headerIndex, '正確答案'));
    const options = ['A', 'B', 'C', 'D', 'E']
      .map((code) => ({
        code,
        text: getCell_(row, headerIndex, `選項${code}`)
      }))
      .filter((option) => option.text);

    if (!isEnabledQuestion_(enabledValue)) continue;
    if (!prompt) continue;
    if (!type) continue;
    if (options.length < 2) continue;
    if (answerCodes.length === 0) continue;
    if ((type === '是非' || type === '單選') && answerCodes.length !== 1) continue;

    questions.push({
      questionId,
      year: getCell_(row, headerIndex, '年度'),
      topic: getCell_(row, headerIndex, '主題') || '未分類',
      type,
      prompt,
      options,
      answerCodes,
      explanation: getCell_(row, headerIndex, '答案說明'),
      source: getCell_(row, headerIndex, '來源標註'),
      note: getCell_(row, headerIndex, '備註')
    });
  }

  if (questions.length < QUIZ_CONFIG.questionCount) {
    throw new Error(`題庫啟用題數不足 ${QUIZ_CONFIG.questionCount} 題，請先補齊或啟用更多題目。`);
  }

  return questions;
}

function selectQuestions_(questionBank, count) {
  const shuffled = shuffleArray_(questionBank.slice());
  const bucketMap = {};

  shuffled.forEach((question) => {
    const key = question.topic || '未分類';
    if (!bucketMap[key]) {
      bucketMap[key] = [];
    }
    bucketMap[key].push(question);
  });

  const selected = [];
  const topicKeys = shuffleArray_(Object.keys(bucketMap));

  topicKeys.forEach((topic) => {
    if (selected.length >= count) return;
    const candidates = bucketMap[topic];
    if (candidates.length > 0) {
      selected.push(candidates.pop());
    }
  });

  const remainingPool = shuffleArray_(
    Object.keys(bucketMap).reduce((list, topic) => list.concat(bucketMap[topic]), [])
  );

  while (selected.length < count && remainingPool.length > 0) {
    selected.push(remainingPool.pop());
  }

  return shuffleArray_(selected).map((question, index) => ({
    order: index + 1,
    ...question
  }));
}

function toQuestionPayload_(question) {
  return {
    questionId: question.questionId,
    order: question.order,
    topic: question.topic,
    type: question.type,
    prompt: question.prompt,
    options: question.options
  };
}

function validateQuizPayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('測驗資料格式錯誤。');
  }
  if (!payload.attemptId) {
    throw new Error('找不到測驗批次，請重新載入題目後再送出。');
  }
  if (!payload.userEmail) {
    throw new Error('無法辨識使用者信箱，請重新整理頁面後再試。');
  }
  if (!Array.isArray(payload.answers)) {
    throw new Error('缺少作答內容，請重新作答後再送出。');
  }
}

function getAttemptQuestions_(attemptId) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(getAttemptCacheKey_(attemptId));
  if (!cached) {
    throw new Error('本次測驗題目已失效，請重新開始測驗。');
  }

  const parsed = JSON.parse(cached);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('本次測驗題目資料異常，請重新開始測驗。');
  }
  return parsed;
}

function normalizeAnswers_(answers) {
  const answerMap = {};
  answers.forEach((item) => {
    if (!item || !item.questionId) return;
    answerMap[item.questionId] = normalizeAnswerCodes_(item.selectedAnswers);
  });
  return answerMap;
}

function gradeAnswers_(questions, answerMap) {
  let score = 0;
  const gradedQuestions = questions.map((question) => {
    const selectedAnswers = answerMap[question.questionId] || [];
    const normalizedCorrect = normalizeAnswerCodes_(question.answerCodes);
    const isCorrect = arraysEqual_(selectedAnswers, normalizedCorrect);
    const questionScore = isCorrect ? QUIZ_CONFIG.pointsPerQuestion : 0;

    score += questionScore;

    return {
      ...question,
      selectedAnswers,
      isCorrect,
      questionScore
    };
  });

  return {
    score,
    isPassed: score >= QUIZ_CONFIG.passingScore,
    gradedQuestions
  };
}

function writeTrainingRecord_(record) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(QUIZ_CONFIG.trainingRecordSheetName);
  const resultStatus = record.isPassed ? '通過' : '未通過';

  sheet.appendRow([
    record.timestamp,
    record.userName,
    record.userEmail,
    record.videoTitle,
    record.score,
    resultStatus,
    record.attemptId,
    QUIZ_CONFIG.questionCount,
    QUIZ_CONFIG.passingScore
  ]);
  SpreadsheetApp.flush();
}

function writeAnswerRecords_(record) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(QUIZ_CONFIG.answerRecordSheetName);
  const rows = record.gradedQuestions.map((question) => [
    record.timestamp,
    record.attemptId,
    record.userName,
    record.userEmail,
    record.videoTitle,
    question.order,
    question.questionId,
    question.topic,
    question.type,
    question.prompt,
    question.options.map((option) => `${option.code}:${option.text}`).join(' | '),
    normalizeAnswerCodes_(question.answerCodes).join(','),
    normalizeAnswerCodes_(question.selectedAnswers).join(','),
    question.isCorrect ? '是' : '否',
    question.questionScore,
    question.source
  ]);

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.flush();
  }
}

function buildHeaderIndex_(actualHeaders, requiredHeaders) {
  const headerIndex = {};
  requiredHeaders.forEach((header) => {
    const index = actualHeaders.indexOf(header);
    if (index === -1) {
      throw new Error(`題庫欄位缺少「${header}」，請先補齊工作表標題列。`);
    }
    headerIndex[header] = index;
  });
  return headerIndex;
}

function getCell_(row, headerIndex, headerName) {
  return String(row[headerIndex[headerName]] || '').trim();
}

function isEnabledQuestion_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['Y', 'YES', 'TRUE', '1', '是'].includes(normalized);
}

function normalizeQuestionType_(value) {
  const normalized = String(value || '').trim();
  if (normalized === '是非' || normalized === '是非題') return '是非';
  if (normalized === '單選' || normalized === '單選題') return '單選';
  if (normalized === '複選' || normalized === '複選題') return '複選';
  return '';
}

function normalizeAnswerCodes_(value) {
  let rawValues = value;
  if (Array.isArray(value)) {
    rawValues = value.join(',');
  }

  return String(rawValues || '')
    .split(/[,、\s]+/)
    .map((item) => item.replace(/[^A-E]/gi, '').toUpperCase())
    .filter((item) => item)
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort();
}

function arraysEqual_(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function shuffleArray_(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getAttemptCacheKey_(attemptId) {
  return `quiz_attempt_${attemptId}`;
}
