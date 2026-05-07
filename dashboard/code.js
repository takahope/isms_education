const DASHBOARD_CONFIG = {
  allowedEmailsPropertyKey: 'DASHBOARD_ALLOWED_EMAILS',
  requiredWatchSeconds: 60 * 60,
  recentActivityDays: 7,
  defaultCourseTitle: '資安暨個資教育訓練',
  maxAlertItems: 8,
  personnelSheetName: '人員主檔',
  assignmentSheetName: '人員職務配置',
  trainingRecordSheetName: '訓練紀錄',
  progressSheetName: '觀看進度'
};

const TRAINING_SHEET_HEADERS = {
  訓練紀錄: ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  觀看進度: ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間', '最後同步來源版本']
};

function doGet() {
  return renderDashboardPage_();
}

function authorizeDashboardProject() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  const allowedEmailsRaw = PropertiesService.getScriptProperties()
    .getProperty(DASHBOARD_CONFIG.allowedEmailsPropertyKey) || '';
  const masterSS = getMasterSpreadsheet_();
  const trainingSS = getTrainingSpreadsheet_();

  return {
    success: true,
    viewerEmail,
    allowedEmailsPropertyKey: DASHBOARD_CONFIG.allowedEmailsPropertyKey,
    allowedEmailsConfigured: Boolean(String(allowedEmailsRaw).trim()),
    masterSpreadsheetId: masterSS.getId(),
    masterSpreadsheetName: masterSS.getName(),
    trainingSpreadsheetId: trainingSS.getId(),
    trainingSpreadsheetName: trainingSS.getName()
  };
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
  const personnelSheet = getRequiredSheet_(masterSS, DASHBOARD_CONFIG.personnelSheetName);
  const assignmentSheet = getOptionalSheet_(masterSS, DASHBOARD_CONFIG.assignmentSheetName);
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
  const ss = getTrainingSpreadsheet_();
  const sheet = getOptionalSheet_(ss, DASHBOARD_CONFIG.trainingRecordSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRAINING_SHEET_HEADERS[DASHBOARD_CONFIG.trainingRecordSheetName].length).getDisplayValues();
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
  const ss = getTrainingSpreadsheet_();
  const sheet = getOptionalSheet_(ss, DASHBOARD_CONFIG.progressSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRAINING_SHEET_HEADERS[DASHBOARD_CONFIG.progressSheetName].length).getDisplayValues();
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

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
