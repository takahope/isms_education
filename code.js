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

const SHEET_HEADERS = {
  題庫: ['題目ID', '是否啟用', '年度', '主題', '題型', '題目內容', '選項A', '選項B', '選項C', '選項D', '選項E', '正確答案', '答案說明', '來源標註', '備註'],
  訓練紀錄: ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  答題紀錄: ['時間戳記', '測驗批次ID', '姓名', '使用者信箱', '課程名稱', '題目序號', '題目ID', '主題', '題型', '題目內容', '選項快照', '正確答案', '作答答案', '是否答對', '本題得分', '來源標註'],
  觀看進度: ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間', '最後同步來源版本']
};

// 1. 發佈為 Web App 時的進入點
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('臺灣人體生物資料庫資安暨個資教育訓練')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

function buildUserAssignments_(sheet, email) {
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
