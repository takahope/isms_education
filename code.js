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

const STATION_EDITOR_CONFIG = {
  personnelSheetName: '人員主檔',
  orgSheetName: '組織架構樹',
  assignmentSheetName: '人員職務配置',
  stationCodePrefix: 'GRP-CO-'
};

const SHEET_HEADERS = {
  題庫: ['題目ID', '是否啟用', '年度', '主題', '題型', '題目內容', '選項A', '選項B', '選項C', '選項D', '選項E', '正確答案', '答案說明', '來源標註', '備註'],
  訓練紀錄: ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  答題紀錄: ['時間戳記', '測驗批次ID', '姓名', '使用者信箱', '課程名稱', '題目序號', '題目ID', '主題', '題型', '題目內容', '選項快照', '正確答案', '作答答案', '是否答對', '本題得分', '來源標註'],
  觀看進度: ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間', '最後同步來源版本']
};

// 1. 發佈為 Web App 時的進入點 (支援 ?page=stats 簡易統計頁面, ?page=mention 催辦通知頁面, ?op=...&auth=... 免登入專屬連結)
function doGet(e) {
  const page = e && e.parameter && e.parameter.page ? String(e.parameter.page).trim().toLowerCase() : '';
  if (page === 'mention') {
    const viewerEmail = getCurrentUserEmail();
    if (!canAccessMention_(viewerEmail)) {
      return HtmlService.createHtmlOutput(buildMentionAccessDeniedHtml_(viewerEmail))
        .setTitle('權限不足 - 催辦通知台')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    return HtmlService.createTemplateFromFile('mention')
      .evaluate()
      .setTitle('資安教育訓練未完成催辦通知台')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'stats') {
    return HtmlService.createTemplateFromFile('stats')
      .evaluate()
      .setTitle('即時課程統計儀表板')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const op = e && e.parameter && e.parameter.op ? String(e.parameter.op).trim() : '';
  const auth = e && e.parameter && e.parameter.auth ? String(e.parameter.auth).trim() : '';
  let authContext = { isShadowAuth: false };

  if (op && auth) {
    try {
      const courseTitle = (typeof MENTION_CONFIG !== 'undefined' && MENTION_CONFIG.defaultCourseTitle) || '115年度資訊安全暨個人資料保護教育訓練';
      const res = validateLearnerCapabilityAccess_(courseTitle, op, auth);
      authContext = {
        isShadowAuth: true,
        op,
        auth,
        effectiveEmail: res.effectiveEmail,
        learnerName: res.name
      };
    } catch (err) {
      return HtmlService.createHtmlOutput(
        '<div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 500px; margin: 50px auto; border: 1px solid #fed7d7; border-radius: 12px; background: #fff5f5; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">' +
        '<h2 style="color: #c53030; margin-top: 0; font-size: 20px;">🚫 認證連結無效或已過期</h2>' +
        '<p style="color: #4a5568; font-size: 14px; line-height: 1.6;">' + escapeHtml_(err.message || '無法通過身分校驗') + '</p>' +
        '<p style="color: #718096; font-size: 12px; margin-bottom: 0;">若有疑問，請洽詢資安承辦人員。</p>' +
        '</div>'
      ).setTitle('身分驗證失敗 - 資安教育訓練')
       .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
  }

  const template = HtmlService.createTemplateFromFile('index');
  template.authContext = JSON.stringify(authContext);
  return template.evaluate()
      .setTitle('臺灣人體生物資料庫資安暨個資教育訓練')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// 2. 獲取當前登入使用者的 Email (供前端顯示)
function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function getCurrentUserProfile(payload) {
  const normalizedPayload = normalizeCurrentUserProfilePayload_(payload);
  let effectiveEmail = getCurrentUserEmail();

  if (payload && payload.authContext && payload.authContext.isShadowAuth) {
    try {
      const authUser = resolveAuthenticatedUser_(payload, normalizedPayload.videoTitle);
      if (authUser && authUser.email) {
        effectiveEmail = authUser.email;
      }
    } catch (e) {
      console.warn('解析 authContext 失敗:', e);
    }
  }

  try {
    const context = buildHomeProfileContext_(effectiveEmail);
    const trainingStatus = getCourseCompletionStatus_(
      context.viewer.email,
      normalizedPayload.videoTitle
    );

    return {
      success: true,
      email: context.viewer.email,
      name: context.viewer.name,
      assignments: context.assignments,
      managedStations: context.managedStations,
      isStationManager: context.viewer.isStationManager,
      isStationStaff: context.viewer.isStationStaff,
      canEditStationAssignments: context.viewer.canEditStationAssignments,
      canSeeEasterEgg: context.viewer.canSeeEasterEgg,
      trainingStatus
    };
  } catch (error) {
    console.error('讀取首頁人員資料失敗:', error);
    return {
      success: false,
      email: fallbackEmail || '',
      name: '',
      assignments: [],
      managedStations: [],
      isStationManager: false,
      isStationStaff: false,
      canEditStationAssignments: false,
      canSeeEasterEgg: false,
      trainingStatus: buildTrainingStatusSummary_('not_attempted'),
      message: error && error.message ? error.message : '無法讀取人員資料'
    };
  }
}

function getStationAssignmentEditorData() {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());

  try {
    const context = buildStationEditorContext_(viewerEmail);
    if (!context.viewer.canEditStationAssignments) {
      throw new Error('您沒有可修改的駐站收案配置。');
    }

    return {
      success: true,
      ...toStationEditorPayload_(context)
    };
  } catch (error) {
    console.error('讀取駐站收案配置資料失敗:', error);
    return buildStationEditorAccessDeniedResponse_(
      viewerEmail,
      error && error.message ? error.message : '無法讀取駐站收案配置。'
    );
  }
}

function saveStationAssignmentChanges(payload) {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  const lock = LockService.getScriptLock();
  let hasLock = false;

  try {
    lock.waitLock(10000);
    hasLock = true;

    const context = buildStationEditorContext_(viewerEmail);
    if (!context.viewer.canEditStationAssignments) {
      throw new Error('您沒有修改駐站收案配置的權限。');
    }

    const changes = normalizeStationEditorChanges_(payload);
    applyStationEditorChanges_(context, changes);

    const refreshedContext = buildStationEditorContext_(viewerEmail);
    if (!refreshedContext.viewer.canEditStationAssignments) {
      return buildStationEditorAccessDeniedResponse_(viewerEmail, '駐站收案配置已更新。', true);
    }

    return {
      success: true,
      message: '駐站收案配置已更新。',
      ...toStationEditorPayload_(refreshedContext)
    };
  } catch (error) {
    console.error('儲存駐站收案配置失敗:', error);
    return {
      success: false,
      viewer: {
        email: viewerEmail,
        canEditStationAssignments: false
      },
      message: error && error.message ? error.message : '無法儲存駐站收案配置。'
    };
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function createStationStaff(payload) {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());

  try {
    const context = buildStationEditorContext_(viewerEmail);
    if (!context.viewer.isStationManager) {
      throw new Error('您沒有新增收案人員的權限。');
    }

    const normalized = normalizeCreateStationStaffPayload_(payload);
    const station = context.stationByCode.get(normalizeOrgCode_(normalized.stationCode));
    if (!station) {
      throw new Error('找不到指定駐站。');
    }

    assertNoDuplicateStationAssignment_(context.stationAssignments, normalized.email, station.code, 0);

    const existingPerson = context.personnelByEmail.get(normalized.email);
    const personName = existingPerson && existingPerson.name
      ? String(existingPerson.name || '').trim()
      : normalized.name;

    if (!existingPerson) {
      context.personnelSheet.getRange(context.personnelSheet.getLastRow() + 1, 1, 1, 3).setValues([[
        normalized.email,
        personName,
        getPersonnelStatusForStation_(station.code)
      ]]);
    }

    context.assignmentSheet.getRange(context.assignmentSheet.getLastRow() + 1, 1, 1, 7).setValues([[
      normalized.email,
      personName,
      station.code,
      String(station.name || '').trim(),
      normalized.title,
      normalizeEmail_(station.managerEmail),
      String(station.managerName || '').trim()
    ]]);

    SpreadsheetApp.flush();

    return {
      success: true,
      message: '收案人員已新增。',
      ...toStationEditorPayload_(buildStationEditorContext_(viewerEmail))
    };
  } catch (error) {
    console.error('新增收案人員失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法新增收案人員。'
    };
  }
}

function createStationNode(payload) {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());

  try {
    const context = buildStationEditorContext_(viewerEmail);
    if (!context.viewer.isStationManager) {
      throw new Error('您沒有新增駐站的權限。');
    }

    const normalized = normalizeCreateStationNodePayload_(payload);
    const personnel = context.personnelByEmail.get(normalized.managerEmail);
    if (!personnel) {
      throw new Error('找不到指定的駐站管理員。');
    }
    if (context.stationByCode.has(normalized.code)) {
      throw new Error(`駐站代碼 ${normalized.code} 已存在。`);
    }
    const stationManagerOrgName = findOrgNameByCode_(context.orgSheet, 'GRP-CO');

    context.orgSheet.getRange(context.orgSheet.getLastRow() + 1, 1, 1, 9).setValues([[
      '行政',
      5,
      normalized.code,
      normalized.name,
      normalized.alias,
      'GRP-CO',
      normalized.managerEmail,
      String(personnel.name || '').trim(),
      normalized.isIsoCertified ? 'V' : ''
    ]]);

    const isExistingStationManager = context.stationManagerCandidates.some((item) => normalizeEmail_(item.email) === normalized.managerEmail);
    if (!isExistingStationManager) {
      const managerTemplate = context.allAssignments
        .filter((item) => normalizeEmail_(item.email) === normalized.managerEmail)
        .sort((a, b) => Number(a.rowIndex || 0) - Number(b.rowIndex || 0))[0] || null;

      context.assignmentSheet.getRange(context.assignmentSheet.getLastRow() + 1, 1, 1, 7).setValues([[
        normalized.managerEmail,
        String(personnel.name || '').trim(),
        'GRP-CO',
        stationManagerOrgName,
        '駐站管理員',
        managerTemplate ? normalizeEmail_(managerTemplate.managerEmail) : '',
        managerTemplate ? String(managerTemplate.managerName || '').trim() : ''
      ]]);
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      message: '駐站已新增。',
      ...toStationEditorPayload_(buildStationEditorContext_(viewerEmail))
    };
  } catch (error) {
    console.error('新增駐站失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法新增駐站。'
    };
  }
}

function deleteStationNode(payload) {
  const viewerEmail = normalizeEmail_(getCurrentUserEmail());
  const lock = LockService.getScriptLock();
  let hasLock = false;

  try {
    lock.waitLock(10000);
    hasLock = true;

    const context = buildStationEditorContext_(viewerEmail);
    if (!context.viewer.isStationManager) {
      throw new Error('您沒有刪除駐站的權限。');
    }

    const normalized = normalizeDeleteStationNodePayload_(payload);
    const station = context.stationByCode.get(normalized.stationCode);
    if (!station) {
      throw new Error('找不到指定駐站。');
    }
    if (hasActiveStationStaffAssignments_(context.allAssignments, station.code)) {
      throw new Error('此駐站仍有收案人員，無法刪除。');
    }

    context.orgSheet.deleteRow(Number(station.rowIndex));
    SpreadsheetApp.flush();

    return {
      success: true,
      message: '駐站已刪除。',
      ...toStationEditorPayload_(buildStationEditorContext_(viewerEmail))
    };
  } catch (error) {
    console.error('刪除駐站失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法刪除駐站。'
    };
  } finally {
    if (hasLock) lock.releaseLock();
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

function buildUserAssignments_(sheet, email, stationByCode) {
  const assignments = getAssignmentsByEmail_(sheet, email);
  return buildUserAssignmentsFromRecords_(assignments, stationByCode);
}

function buildUserAssignmentsFromRecords_(assignments, stationByCode) {
  if (assignments.length === 0) return [];

  const assignmentTypeMap = buildAssignmentTypeMap_(assignments);
  return assignments
    .map((assignment) => {
      const station = stationByCode && typeof stationByCode.get === 'function'
        ? stationByCode.get(normalizeOrgCode_(assignment.orgCode))
        : null;
      return {
        type: assignmentTypeMap.get(getAssignmentIdentityKey_(assignment)) || '兼任',
        orgName: String(assignment.orgName || '').trim(),
        title: String(assignment.title || '').trim(),
        isIsoCertified: Boolean(station && station.isIsoCertified)
      };
    })
    .sort((a, b) => getAssignmentSortOrder_(a.type) - getAssignmentSortOrder_(b.type));
}

function buildHomeProfileContext_(viewerEmail) {
  const normalizedViewerEmail = normalizeEmail_(viewerEmail);
  if (!normalizedViewerEmail) {
    throw new Error('無法辨識目前登入帳號。');
  }

  const masterSS = getMasterSpreadsheet_();
  const personnelSheet = getRequiredSheet_(masterSS, STATION_EDITOR_CONFIG.personnelSheetName);
  const orgSheet = getRequiredSheet_(masterSS, STATION_EDITOR_CONFIG.orgSheetName);
  const assignmentSheet = getRequiredSheet_(masterSS, STATION_EDITOR_CONFIG.assignmentSheetName);

  const personnelRecords = readPersonnelRecords_(personnelSheet);
  const personnelByEmail = buildPersonnelMap_(personnelRecords);
  const stationNodes = readStationNodesFromSheet_(orgSheet);
  const stationByCode = new Map(stationNodes.map((item) => [normalizeOrgCode_(item.code), item]));
  const allAssignments = readAssignmentsFromSheet_(assignmentSheet);
  const viewerAssignments = allAssignments.filter((item) => normalizeEmail_(item.email) === normalizedViewerEmail);
  const visibleStationAssignments = allAssignments.filter((item) => (
    isStationOrgCode_(item.orgCode)
    && !isLegacyStationManagerAssignment_(item)
  ));
  const managedStations = stationNodes
    .filter((station) => normalizeEmail_(station.managerEmail) === normalizedViewerEmail)
    .map((station) => cloneManagedStationForProfile_(buildManagedStationCard_(station, visibleStationAssignments, personnelByEmail)));
  const selfAssignments = visibleStationAssignments
    .filter((item) => normalizeEmail_(item.email) === normalizedViewerEmail);
  const viewerRecord = personnelByEmail.get(normalizedViewerEmail) || {};
  const viewerName = String(
    viewerRecord.name
    || (viewerAssignments[0] && viewerAssignments[0].name)
    || ''
  ).trim();
  const canSeeEasterEgg = viewerAssignments.some((item) => isEasterEggAllowedOrgCode_(item.orgCode));

  return {
    viewer: {
      email: normalizedViewerEmail,
      name: viewerName,
      isStationManager: managedStations.length > 0,
      isStationStaff: selfAssignments.length > 0,
      canEditStationAssignments: managedStations.length > 0,
      canSeeEasterEgg
    },
    assignments: buildUserAssignmentsFromRecords_(viewerAssignments, stationByCode),
    managedStations
  };
}

function cloneManagedStationForProfile_(station) {
  return {
    code: station.code,
    name: station.name,
    isIsoCertified: Boolean(station.isIsoCertified),
    memberCount: Number(station.memberCount || 0),
    activeMemberCount: Number(station.activeMemberCount || 0),
    canDelete: Boolean(station.canDelete),
    warnings: Array.isArray(station.warnings) ? station.warnings.slice() : [],
    members: Array.isArray(station.members)
      ? station.members.map((member) => ({
          name: String(member.name || '').trim(),
          email: normalizeEmail_(member.email),
          title: String(member.title || '').trim(),
          managerName: String(member.managerName || '').trim()
        }))
      : []
  };
}

function buildStationEditorContext_(viewerEmail) {
  const normalizedViewerEmail = normalizeEmail_(viewerEmail);
  if (!normalizedViewerEmail) {
    throw new Error('無法辨識目前登入帳號。');
  }

  const masterSS = getMasterSpreadsheet_();
  const personnelSheet = getRequiredSheet_(masterSS, STATION_EDITOR_CONFIG.personnelSheetName);
  const orgSheet = getRequiredSheet_(masterSS, STATION_EDITOR_CONFIG.orgSheetName);
  const assignmentSheet = getRequiredSheet_(masterSS, STATION_EDITOR_CONFIG.assignmentSheetName);

  const personnelRecords = readPersonnelRecords_(personnelSheet);
  const personnelByEmail = buildPersonnelMap_(personnelRecords);
  const stationNodes = readStationNodesFromSheet_(orgSheet);
  const stationByCode = new Map(stationNodes.map((item) => [normalizeOrgCode_(item.code), item]));
  const allAssignments = readAssignmentsFromSheet_(assignmentSheet);
  const stationAssignments = allAssignments.filter((item) => isStationOrgCode_(item.orgCode));
  const visibleStationAssignments = stationAssignments.filter((item) => !isLegacyStationManagerAssignment_(item));

  const allStations = stationNodes
    .map((station) => buildManagedStationCard_(station, visibleStationAssignments, personnelByEmail));

  const managedStations = allStations
    .filter((station) => normalizeEmail_(station.managerEmail) === normalizedViewerEmail)
    .map((station) => ({ ...station, members: station.members.map((item) => ({ ...item })) }));

  const selfAssignments = visibleStationAssignments
    .filter((item) => normalizeEmail_(item.email) === normalizedViewerEmail)
    .map((item) => toStationAssignmentItem_(item, stationByCode.get(normalizeOrgCode_(item.orgCode))));

  const isStationManager = managedStations.length > 0;
  const isStationStaff = selfAssignments.length > 0;
  const canEditStationAssignments = isStationManager;
  const uniqueStationStaffMap = new Map();

  visibleStationAssignments.forEach((item) => {
    const emailKey = normalizeEmail_(item.email);
    if (!emailKey || uniqueStationStaffMap.has(emailKey)) return;
    uniqueStationStaffMap.set(emailKey, {
      email: emailKey,
      name: String(item.name || (personnelByEmail.get(emailKey) || {}).name || '').trim(),
      currentStations: []
    });
  });

  visibleStationAssignments.forEach((item) => {
    const emailKey = normalizeEmail_(item.email);
    const entry = uniqueStationStaffMap.get(emailKey);
    if (!entry) return;
    const stationName = String(item.orgName || (stationByCode.get(normalizeOrgCode_(item.orgCode)) || {}).name || '').trim();
    if (stationName && entry.currentStations.indexOf(stationName) === -1) {
      entry.currentStations.push(stationName);
    }
  });

  const stationStaffCandidates = Array.from(uniqueStationStaffMap.values())
    .map((item) => ({
      email: item.email,
      name: item.name,
      label: [item.name, item.email].filter(Boolean).join('｜'),
      currentStations: item.currentStations.slice().sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));

  const uniqueStationManagerMap = new Map();
  allAssignments.forEach((assignment) => {
    const managerEmail = normalizeEmail_(assignment.email);
    const orgCode = normalizeOrgCode_(assignment.orgCode);
    const title = String(assignment.title || '').trim();
    if (!managerEmail || uniqueStationManagerMap.has(managerEmail)) return;
    if (orgCode !== 'GRP-CO' || title !== '駐站管理員') return;

    const person = personnelByEmail.get(managerEmail) || {};
    const managerName = String(assignment.name || person.name || '').trim();
    uniqueStationManagerMap.set(managerEmail, {
      email: managerEmail,
      name: managerName,
      label: [managerName, managerEmail].filter(Boolean).join('｜')
    });
  });

  const stationManagerCandidates = Array.from(uniqueStationManagerMap.values())
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));

  const personnelOptions = personnelRecords
    .map((item) => ({
      email: item.email,
      name: String(item.name || '').trim(),
      status: String(item.status || '').trim(),
      label: [String(item.name || '').trim(), item.email].filter(Boolean).join('｜')
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));

  const stationOptions = stationNodes
    .map((station) => ({
      code: station.code,
      name: station.name,
      isIsoCertified: Boolean(station.isIsoCertified),
      managerEmail: station.managerEmail,
      managerName: station.managerName
    }))
    .sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code), 'zh-Hant'));

  const viewerRecord = personnelByEmail.get(normalizedViewerEmail) || { email: normalizedViewerEmail, name: '' };

  return {
    viewer: {
      email: normalizedViewerEmail,
      name: String(viewerRecord.name || '').trim(),
      isStationManager,
      isStationStaff,
      canEditStationAssignments
    },
    allStations,
    managedStations,
    selfAssignments: selfAssignments.sort((a, b) => String(a.stationName || a.orgCode).localeCompare(String(b.stationName || b.orgCode), 'zh-Hant')),
    stationOptions,
    stationStaffCandidates,
    stationManagerCandidates,
    personnelOptions,
    personnelByEmail,
    stationByCode,
    allAssignments,
    stationAssignments,
    personnelSheet,
    assignmentSheet,
    orgSheet
  };
}

function toStationEditorPayload_(context) {
  return {
    viewer: context.viewer,
    allStations: context.allStations,
    managedStations: context.managedStations,
    selfAssignments: context.selfAssignments,
    stationOptions: context.stationOptions,
    stationStaffCandidates: context.stationStaffCandidates,
    stationManagerCandidates: context.stationManagerCandidates,
    personnelOptions: context.personnelOptions
  };
}

function buildStationEditorAccessDeniedResponse_(viewerEmail, message, success) {
  return {
    success: Boolean(success),
    viewer: {
      email: normalizeEmail_(viewerEmail),
      name: '',
      isStationManager: false,
      isStationStaff: false,
      canEditStationAssignments: false
    },
    allStations: [],
    managedStations: [],
    selfAssignments: [],
    stationOptions: [],
    stationStaffCandidates: [],
    stationManagerCandidates: [],
    personnelOptions: [],
    message: String(message || '您沒有可修改的駐站收案配置。').trim()
  };
}

function readPersonnelRecords_(sheet) {
  const rows = sheet.getDataRange().getDisplayValues();
  const records = [];

  for (let i = 1; i < rows.length; i += 1) {
    const email = normalizeEmail_(rows[i][0]);
    if (!email) continue;
    records.push({
      email,
      name: String(rows[i][1] || '').trim(),
      status: String(rows[i][2] || '').trim()
    });
  }

  return records;
}

function buildPersonnelMap_(personnelRecords) {
  const map = new Map();
  personnelRecords.forEach((item) => {
    map.set(normalizeEmail_(item.email), item);
  });
  return map;
}

function readAssignmentsFromSheet_(sheet) {
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

function readStationNodesFromSheet_(sheet) {
  const rows = sheet.getDataRange().getDisplayValues();
  const stationNodes = [];

  for (let i = 1; i < rows.length; i += 1) {
    const code = String(rows[i][2] || '').trim();
    if (!isStationOrgCode_(code)) continue;
    stationNodes.push({
      rowIndex: i + 1,
      type: String(rows[i][0] || '').trim(),
      level: Number(rows[i][1] || 0),
      code,
      name: String(rows[i][3] || '').trim(),
      alias: String(rows[i][4] || '').trim(),
      parentCode: String(rows[i][5] || '').trim(),
      managerEmail: normalizeEmail_(rows[i][6]),
      managerName: String(rows[i][7] || '').trim(),
      isIsoCertified: String(rows[i][8] || '').trim() === 'V'
    });
  }

  return stationNodes;
}

function buildManagedStationCard_(station, stationAssignments, personnelByEmail) {
  const members = stationAssignments
    .filter((item) => normalizeOrgCode_(item.orgCode) === normalizeOrgCode_(station.code))
    .map((item) => {
      const person = personnelByEmail.get(normalizeEmail_(item.email)) || {};
      return toStationAssignmentItem_({
        ...item,
        name: item.name || person.name || ''
      }, station);
    })
    .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'zh-Hant'));
  const managerEmail = normalizeEmail_(station.managerEmail);
  const hasManagerMismatch = Boolean(managerEmail) && members.some((item) => normalizeEmail_(item.managerEmail) !== managerEmail);

  return {
    code: station.code,
    name: station.name,
    isIsoCertified: Boolean(station.isIsoCertified),
    managerEmail: station.managerEmail,
    managerName: station.managerName,
    memberCount: members.length,
    activeMemberCount: countActiveStationStaffAssignments_(members),
    canDelete: countActiveStationStaffAssignments_(members) === 0,
    warnings: hasManagerMismatch ? ['部分成員主管資訊與駐站負責人不一致'] : [],
    members
  };
}

function toStationAssignmentItem_(assignment, station) {
  return {
    rowIndex: Number(assignment.rowIndex || 0),
    email: normalizeEmail_(assignment.email),
    name: String(assignment.name || '').trim(),
    orgCode: String(assignment.orgCode || '').trim(),
    stationCode: String(assignment.orgCode || '').trim(),
    stationName: String(assignment.orgName || (station && station.name) || '').trim(),
    isIsoCertified: Boolean(station && station.isIsoCertified),
    title: String(assignment.title || '').trim(),
    managerEmail: normalizeEmail_(assignment.managerEmail || (station && station.managerEmail)),
    managerName: String(assignment.managerName || (station && station.managerName) || '').trim()
  };
}

function normalizeStationEditorChanges_(payload) {
  const changes = payload && Array.isArray(payload.changes) ? payload.changes : null;
  if (!changes || changes.length === 0) {
    throw new Error('沒有可儲存的駐站異動。');
  }

  return changes.map((item) => ({
    action: String(item && item.action || '').trim().toLowerCase(),
    rowIndex: Number(item && item.rowIndex || 0),
    stationCode: normalizeOrgCode_(item && item.stationCode),
    targetEmail: normalizeEmail_(item && item.targetEmail),
    targetManagerEmail: normalizeEmail_(item && item.targetManagerEmail)
  }));
}

function applyStationEditorChanges_(context, changes) {
  const assignmentSheet = context.assignmentSheet;
  const orgSheet = context.orgSheet;
  const stationByCode = context.stationByCode;
  const viewerEmail = normalizeEmail_(context.viewer.email);
  const viewerIsStationManager = Boolean(context.viewer && context.viewer.isStationManager);
  const candidateEmailSet = new Set(context.stationStaffCandidates.map((item) => normalizeEmail_(item.email)));
  const stationManagerCandidateSet = new Set(context.stationManagerCandidates.map((item) => normalizeEmail_(item.email)));
  const baseAssignments = context.allAssignments.map((item) => ({ ...item }));
  const rowsByIndex = new Map(baseAssignments.map((item) => [Number(item.rowIndex), item]));
  const simulator = baseAssignments.map((item) => ({ ...item }));
  const deletes = new Set();
  const updates = [];
  const appends = [];
  const orgUpdates = new Map();
  let nextVirtualRowIndex = -1;

  changes.forEach((change) => {
    validateStationEditorChange_(change);

    if (change.action === 'delete') {
      const target = getAssignmentByRowIndex_(simulator, change.rowIndex);
      if (!target) throw new Error(`找不到要刪除的駐站職務列：${change.rowIndex}`);
      assertCanDeleteStationAssignment_(target, viewerEmail, viewerIsStationManager);
      removeAssignmentByRowIndex_(simulator, change.rowIndex);
      deletes.add(change.rowIndex);
      return;
    }

    if (change.action === 'move') {
      const target = getAssignmentByRowIndex_(simulator, change.rowIndex);
      if (!target) throw new Error(`找不到要移動的駐站職務列：${change.rowIndex}`);
      const station = stationByCode.get(change.stationCode);
      if (!station) throw new Error(`找不到目標駐站：${change.stationCode}`);
      assertCanMoveStationAssignment_(target, station, viewerEmail, viewerIsStationManager);
      assertNoDuplicateStationAssignment_(simulator, target.email, station.code, change.rowIndex);

      target.orgCode = station.code;
      target.orgName = station.name;
      target.managerEmail = normalizeEmail_(station.managerEmail);
      target.managerName = String(station.managerName || '').trim();

      if (!deletes.has(change.rowIndex)) {
        updates.push({ ...target });
      }
      return;
    }

    if (change.action === 'add') {
      const station = stationByCode.get(change.stationCode);
      if (!station) throw new Error(`找不到目標駐站：${change.stationCode}`);
      const targetEmail = normalizeEmail_(change.targetEmail || viewerEmail);
      assertCanAddStationAssignment_(targetEmail, station, viewerEmail, viewerIsStationManager, candidateEmailSet);
      assertNoDuplicateStationAssignment_(simulator, targetEmail, station.code, 0);

      const template = getStationAssignmentTemplate_(baseAssignments, targetEmail);
      if (!template) {
        throw new Error(`找不到 ${targetEmail} 的既有站務職務模板，無法新增。`);
      }

      const appended = {
        rowIndex: nextVirtualRowIndex,
        email: targetEmail,
        name: String(template.name || '').trim(),
        orgCode: station.code,
        orgName: station.name,
        title: String(template.title || '').trim(),
        managerEmail: normalizeEmail_(station.managerEmail),
        managerName: String(station.managerName || '').trim()
      };
      nextVirtualRowIndex -= 1;
      simulator.push(appended);
      appends.push(appended);
      return;
    }

    if (change.action === 'reassign_manager') {
      if (!context.viewer.isStationManager) {
        throw new Error('只有駐站管理員可以調整駐站管理員歸屬。');
      }

      const station = stationByCode.get(change.stationCode);
      if (!station) throw new Error(`找不到目標駐站：${change.stationCode}`);

      const targetManagerEmail = normalizeEmail_(change.targetManagerEmail);
      if (!targetManagerEmail) throw new Error('缺少目標駐站管理員。');
      if (!stationManagerCandidateSet.has(targetManagerEmail)) {
        throw new Error('只能指派給既有駐站管理員。');
      }

      if (normalizeEmail_(station.managerEmail) === targetManagerEmail) {
        return;
      }

      const targetManager = context.personnelByEmail.get(targetManagerEmail)
        || context.stationManagerCandidates.find((item) => normalizeEmail_(item.email) === targetManagerEmail)
        || null;
      if (!targetManager) {
        throw new Error(`找不到目標駐站管理員：${targetManagerEmail}`);
      }

      station.managerEmail = targetManagerEmail;
      station.managerName = String(targetManager.name || '').trim();
      orgUpdates.set(normalizeOrgCode_(station.code), {
        rowIndex: Number(station.rowIndex),
        managerEmail: targetManagerEmail,
        managerName: String(targetManager.name || '').trim()
      });

      simulator.forEach((item) => {
        if (normalizeOrgCode_(item.orgCode) !== normalizeOrgCode_(station.code)) return;
        item.managerEmail = targetManagerEmail;
        item.managerName = String(targetManager.name || '').trim();
        if (Number(item.rowIndex) > 0 && !deletes.has(item.rowIndex)) {
          updates.push({ ...item });
        }
      });
      return;
    }

    throw new Error(`不支援的異動類型：${change.action}`);
  });

  Array.from(orgUpdates.values()).forEach((item) => {
    writeOrgManagerRow_(orgSheet, item.rowIndex, item.managerEmail, item.managerName);
  });

  const finalizedUpdates = dedupeUpdatesByRowIndex_(updates).filter((item) => Number(item.rowIndex) > 0 && !deletes.has(item.rowIndex));
  finalizedUpdates.forEach((item) => {
    const baseRow = rowsByIndex.get(Number(item.rowIndex));
    if (!baseRow) throw new Error(`找不到要更新的駐站職務列：${item.rowIndex}`);
    writeAssignmentRow_(assignmentSheet, item.rowIndex, item);
  });

  if (appends.length > 0) {
    const rows = appends.map((item) => toAssignmentSheetRowValues_(item));
    assignmentSheet.getRange(assignmentSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  Array.from(deletes)
    .sort((a, b) => b - a)
    .forEach((rowIndex) => {
      assignmentSheet.deleteRow(rowIndex);
    });

  SpreadsheetApp.flush();
}

function validateStationEditorChange_(change) {
  if (!change.action) throw new Error('異動缺少 action。');
  if (['move', 'delete'].includes(change.action) && !change.rowIndex) {
    throw new Error(`異動 ${change.action} 缺少 rowIndex。`);
  }
  if (['move', 'add', 'reassign_manager'].includes(change.action) && !change.stationCode) {
    throw new Error(`異動 ${change.action} 缺少 stationCode。`);
  }
  if (change.action === 'reassign_manager' && !change.targetManagerEmail) {
    throw new Error('異動 reassign_manager 缺少 targetManagerEmail。');
  }
}

function assertCanDeleteStationAssignment_(assignment, viewerEmail, viewerIsStationManager) {
  if (viewerIsStationManager) return;
  throw new Error('您沒有刪除此駐站收案配置的權限。');
}

function assertCanMoveStationAssignment_(assignment, targetStation, viewerEmail, viewerIsStationManager) {
  if (viewerIsStationManager) return;
  throw new Error('您沒有搬移此駐站收案配置的權限。');
}

function assertCanAddStationAssignment_(targetEmail, station, viewerEmail, viewerIsStationManager, candidateEmailSet) {
  if (!candidateEmailSet.has(targetEmail)) {
    throw new Error('只能新增既有站務人員到駐站。');
  }

  if (viewerIsStationManager) return;
  throw new Error('您沒有新增此駐站收案配置的權限。');
}

function assertNoDuplicateStationAssignment_(assignments, email, orgCode, excludedRowIndex) {
  const duplicateExists = assignments.some((item) => {
    if (excludedRowIndex && Number(item.rowIndex) === Number(excludedRowIndex)) return false;
    return normalizeEmail_(item.email) === normalizeEmail_(email)
      && normalizeOrgCode_(item.orgCode) === normalizeOrgCode_(orgCode);
  });

  if (duplicateExists) {
    throw new Error('同一位收案人員不可重複配置到同一個駐站。');
  }
}

function getStationAssignmentTemplate_(assignments, email) {
  return assignments
    .filter((item) => normalizeEmail_(item.email) === normalizeEmail_(email) && isStationOrgCode_(item.orgCode))
    .sort((a, b) => Number(a.rowIndex || 0) - Number(b.rowIndex || 0))[0] || null;
}

function getAssignmentByRowIndex_(assignments, rowIndex) {
  return assignments.find((item) => Number(item.rowIndex) === Number(rowIndex)) || null;
}

function removeAssignmentByRowIndex_(assignments, rowIndex) {
  const index = assignments.findIndex((item) => Number(item.rowIndex) === Number(rowIndex));
  if (index !== -1) assignments.splice(index, 1);
}

function dedupeUpdatesByRowIndex_(updates) {
  const byRowIndex = new Map();
  updates.forEach((item) => {
    byRowIndex.set(Number(item.rowIndex), item);
  });
  return Array.from(byRowIndex.values());
}

function normalizeCreateStationStaffPayload_(payload) {
  const email = normalizeEmail_(payload && payload.email);
  const stationCode = normalizeOrgCode_(payload && payload.stationCode);
  const name = String(payload && payload.name || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('請輸入有效的 Email。');
  }
  if (!name) {
    throw new Error('請輸入姓名。');
  }
  if (!stationCode) {
    throw new Error('請選擇駐站。');
  }

  return { email, name, stationCode, title: '收案人員' };
}

function normalizeCreateStationNodePayload_(payload) {
  const stationType = String(payload && payload.stationType || '').trim().toLowerCase() === 'external' ? 'external' : 'general';
  const suffix = String(payload && payload.suffix || '').trim().toUpperCase();
  const name = String(payload && payload.name || '').trim();
  const alias = String(payload && payload.alias || '').trim();
  const managerEmail = normalizeEmail_(payload && payload.managerEmail);
  const isIsoCertified = Boolean(payload && payload.isIsoCertified);

  if (!suffix || !/^[A-Z0-9]+$/.test(suffix)) {
    throw new Error('駐站代碼尾碼只能輸入英文字母與數字。');
  }
  if (!name) {
    throw new Error('請輸入駐站中文名稱。');
  }
  if (!managerEmail) {
    throw new Error('請選擇駐站管理員。');
  }

  return {
    stationType,
    suffix,
    name,
    alias,
    managerEmail,
    isIsoCertified,
    code: buildStationCode_(stationType, suffix)
  };
}

function normalizeDeleteStationNodePayload_(payload) {
  const stationCode = normalizeOrgCode_(payload && payload.stationCode);
  if (!stationCode || !isStationOrgCode_(stationCode)) {
    throw new Error('請提供有效的駐站代碼。');
  }
  return { stationCode };
}

function buildStationCode_(stationType, suffix) {
  return stationType === 'external'
    ? `GRP-CO-EX-${String(suffix || '').trim().toUpperCase()}`
    : `GRP-CO-${String(suffix || '').trim().toUpperCase()}`;
}

function getPersonnelStatusForStation_(stationCode) {
  return normalizeOrgCode_(stationCode).startsWith('GRP-CO-EX-') ? '委外廠商' : '在勤';
}

function findOrgNameByCode_(sheet, orgCode) {
  const normalizedCode = normalizeOrgCode_(orgCode);
  const rows = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < rows.length; i += 1) {
    if (normalizeOrgCode_(rows[i][2]) === normalizedCode) {
      return String(rows[i][3] || '').trim() || normalizedCode;
    }
  }
  return normalizedCode;
}

function countActiveStationStaffAssignments_(assignments) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((item) => !isLegacyStationManagerAssignment_(item))
    .length;
}

function hasActiveStationStaffAssignments_(assignments, stationCode) {
  return (Array.isArray(assignments) ? assignments : []).some((item) => (
    normalizeOrgCode_(item.orgCode) === normalizeOrgCode_(stationCode)
    && !isLegacyStationManagerAssignment_(item)
  ));
}

function isLegacyStationManagerAssignment_(assignment) {
  return String(assignment && assignment.title || '').trim() === '駐站管理員';
}

function writeAssignmentRow_(sheet, rowIndex, assignment) {
  sheet.getRange(rowIndex, 1, 1, 7).setValues([toAssignmentSheetRowValues_(assignment)]);
}

function writeOrgManagerRow_(sheet, rowIndex, managerEmail, managerName) {
  sheet.getRange(rowIndex, 7, 1, 2).setValues([[
    normalizeEmail_(managerEmail),
    String(managerName || '').trim()
  ]]);
}

function toAssignmentSheetRowValues_(assignment) {
  return [
    normalizeEmail_(assignment.email),
    String(assignment.name || '').trim(),
    String(assignment.orgCode || '').trim(),
    String(assignment.orgName || '').trim(),
    String(assignment.title || '').trim(),
    normalizeEmail_(assignment.managerEmail),
    String(assignment.managerName || '').trim()
  ];
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

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCurrentUserProfilePayload_(payload) {
  return {
    videoTitle: String(payload && payload.videoTitle || '').trim()
  };
}

function getCourseCompletionStatus_(userEmail, videoTitle) {
  const normalizedUserEmail = normalizeEmail_(userEmail);
  const normalizedVideoTitle = String(videoTitle || '').trim();
  if (!normalizedUserEmail || !normalizedVideoTitle) {
    return buildTrainingStatusSummary_('not_attempted');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(QUIZ_CONFIG.trainingRecordSheetName);
  if (!sheet) {
    return buildTrainingStatusSummary_('not_attempted');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return buildTrainingStatusSummary_('not_attempted');
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 6).getDisplayValues();
  let attemptCount = 0;
  let latestPassedAt = '';
  let hasPassed = false;

  rows.forEach((row) => {
    const recordEmail = normalizeEmail_(row[2]);
    const recordVideoTitle = String(row[3] || '').trim();
    if (recordEmail !== normalizedUserEmail || recordVideoTitle !== normalizedVideoTitle) {
      return;
    }

    attemptCount += 1;
    if (String(row[5] || '').trim() === '通過') {
      hasPassed = true;
      latestPassedAt = String(row[0] || '').trim() || latestPassedAt;
    }
  });

  if (hasPassed) {
    return buildTrainingStatusSummary_('passed', {
      attemptCount,
      latestPassedAt
    });
  }
  if (attemptCount > 0) {
    return buildTrainingStatusSummary_('attempted_not_passed', { attemptCount });
  }
  return buildTrainingStatusSummary_('not_attempted');
}

function buildTrainingStatusSummary_(state, options) {
  const normalizedState = String(state || '').trim() || 'not_attempted';
  const attemptCount = Number(options && options.attemptCount || 0);
  const latestPassedAt = String(options && options.latestPassedAt || '').trim();
  const labelMap = {
    passed: '已完成課程｜已通過測驗',
    attempted_not_passed: '尚未完成課程｜已有測驗紀錄但尚未通過',
    not_attempted: '尚未完成課程｜尚無測驗通過紀錄'
  };

  return {
    state: labelMap[normalizedState] ? normalizedState : 'not_attempted',
    hasPassed: normalizedState === 'passed',
    label: labelMap[normalizedState] || labelMap.not_attempted,
    attemptCount,
    latestPassedAt
  };
}

function getEasterEggAllowedOrgCodes_() {
  if (typeof ENV === 'undefined' || !Array.isArray(ENV.EASTER_EGG_ALLOWED_ORG_CODES)) {
    return [];
  }
  return ENV.EASTER_EGG_ALLOWED_ORG_CODES
    .map((item) => normalizeOrgCode_(item))
    .filter(Boolean);
}

function isEasterEggAllowedOrgCode_(orgCode) {
  const normalizedOrgCode = normalizeOrgCode_(orgCode);
  if (!normalizedOrgCode) return false;
  return getEasterEggAllowedOrgCodes_().includes(normalizedOrgCode);
}

function normalizeOrgCode_(value) {
  return String(value || '').trim().toUpperCase();
}

function isStationOrgCode_(orgCode) {
  return normalizeOrgCode_(orgCode).startsWith(STATION_EDITOR_CONFIG.stationCodePrefix);
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

    let email = String(payload.userEmail || '').trim();
    if (payload && payload.authContext && payload.authContext.isShadowAuth) {
      try {
        const authUser = resolveAuthenticatedUser_(payload, payload.videoTitle);
        if (authUser && authUser.email) {
          email = authUser.email;
        }
      } catch (e) {
        console.warn('submitQuizAttempt 解析 authContext 失敗:', e);
      }
    }

    const attemptQuestions = getAttemptQuestions_(payload.attemptId);
    const answerMap = normalizeAnswers_(payload.answers);
    const gradingResult = gradeAnswers_(attemptQuestions, answerMap);
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
    if (payload && payload.authContext && payload.authContext.isShadowAuth) {
      try {
        const authUser = resolveAuthenticatedUser_(payload, payload.videoTitle);
        if (authUser && authUser.email) {
          payload.userEmail = authUser.email;
        }
      } catch (e) {}
    }
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
    if (payload && payload.authContext && payload.authContext.isShadowAuth) {
      try {
        const authUser = resolveAuthenticatedUser_(payload, payload.videoTitle);
        if (authUser && authUser.email) {
          payload.userEmail = authUser.email;
        }
      } catch (e) {}
    }
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
      progressSheet.appendRow(rowValues[0]);
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
    let email = String((data && data.userName) || '').trim();
    const score = Number((data && data.score) || 0);
    const isPassed = Boolean(data && data.isPassed);

    if (data && data.authContext && data.authContext.isShadowAuth) {
      try {
        const authUser = resolveAuthenticatedUser_(data, data.videoTitle);
        if (authUser && authUser.email) {
          email = authUser.email;
        }
      } catch (e) {
        console.warn('submitTrainingResult 解析 authContext 失敗:', e);
      }
    }

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

/**
 * 簡易統計頁面：在勤狀態白名單判斷
 */
const SIMPLE_STATS_ELIGIBLE_STATUSES = new Set(['在勤', '育嬰假']);

function isEligiblePersonnelStatus_(status) {
  return SIMPLE_STATS_ELIGIBLE_STATUSES.has(String(status || '').trim());
}

/**
 * 簡易統計頁面：工作地點排除判斷 (排除 outside)
 */
function isExcludedLocation_(location) {
  return String(location || '').trim().toLowerCase() === 'outside';
}

/**
 * 簡易統計頁面：學員測驗狀態判定
 */
function resolveSimpleLearnerTrainingStatus_(hasPassed, attemptCount) {
  if (hasPassed) return 'passed';
  if (attemptCount > 0) return 'failed';
  return 'unattempted';
}

function getSimpleLearnerStatusLabel_(status) {
  const labels = {
    passed: '通過',
    failed: '未通過',
    unattempted: '未受訓'
  };
  return labels[status] || '未受訓';
}

/**
 * 從人員主檔與訓練紀錄陣列計算簡易統計資料（不包含任何分數欄位）
 */
function buildSimpleTrainingStatsFromData_(personnelRows, trainingRows) {
  const quizByEmail = new Map();
  let defaultCourseTitle = '';

  if (Array.isArray(trainingRows) && trainingRows.length > 1) {
    for (let i = 1; i < trainingRows.length; i += 1) {
      const email = normalizeEmail_(trainingRows[i][2]);
      if (!email) continue;
      const courseTitle = String(trainingRows[i][3] || '').trim();
      const result = String(trainingRows[i][5] || '').trim();
      if (courseTitle && !defaultCourseTitle) defaultCourseTitle = courseTitle;

      if (!quizByEmail.has(email)) {
        quizByEmail.set(email, {
          hasPassed: false,
          attemptCount: 0
        });
      }
      const record = quizByEmail.get(email);
      record.attemptCount += 1;
      if (result === '通過') {
        record.hasPassed = true;
      }
    }
  }

  const learners = [];
  let totalEligible = 0;
  let passedCount = 0;
  let failedCount = 0;
  let unattemptedCount = 0;

  if (Array.isArray(personnelRows) && personnelRows.length > 1) {
    for (let i = 1; i < personnelRows.length; i += 1) {
      const email = normalizeEmail_(personnelRows[i][0]);
      if (!email) continue;
      const name = String(personnelRows[i][1] || '').trim();
      const status = String(personnelRows[i][2] || '').trim();
      const location = String(personnelRows[i][7] || '').trim();

      // 篩選：C 欄為在勤/育嬰假 且 H 欄非 outside
      if (!isEligiblePersonnelStatus_(status)) continue;
      if (isExcludedLocation_(location)) continue;

      totalEligible += 1;
      const quiz = quizByEmail.get(email) || { hasPassed: false, attemptCount: 0 };
      const trainingStatus = resolveSimpleLearnerTrainingStatus_(quiz.hasPassed, quiz.attemptCount);
      const trainingStatusLabel = getSimpleLearnerStatusLabel_(trainingStatus);

      if (trainingStatus === 'passed') {
        passedCount += 1;
      } else if (trainingStatus === 'failed') {
        failedCount += 1;
      } else {
        unattemptedCount += 1;
      }

      learners.push({
        name,
        email,
        status,
        location,
        trainingStatus,
        trainingStatusLabel
      });
    }
  }

  // 排序：未完成優先 (failed -> unattempted -> passed)，同狀態依姓名排序
  const statusSortWeight = { failed: 1, unattempted: 2, passed: 3 };
  learners.sort((a, b) => {
    const weightA = statusSortWeight[a.trainingStatus] || 99;
    const weightB = statusSortWeight[b.trainingStatus] || 99;
    if (weightA !== weightB) return weightA - weightB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  });

  const incompleteCount = failedCount + unattemptedCount;
  const completionPercent = totalEligible > 0
    ? Math.round((passedCount / totalEligible) * 1000) / 10
    : 0;
  const completionRate = `${completionPercent.toFixed(1)}%`;

  return {
    success: true,
    generatedAt: typeof Utilities !== 'undefined' && Utilities.formatDate
      ? Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss')
      : new Date().toISOString(),
    courseTitle: defaultCourseTitle || '資安暨個資教育訓練',
    summary: {
      totalEligible,
      passedCount,
      failedCount,
      unattemptedCount,
      incompleteCount,
      completionRate,
      completionPercent
    },
    learners
  };
}

/**
 * 前端 API：獲取簡易教育訓練即時統計數據
 */
function getSimpleTrainingStats() {
  try {
    const masterSS = getMasterSpreadsheet_();
    const personnelSheet = getRequiredSheet_(masterSS, '人員主檔');
    const personnelRows = personnelSheet.getDataRange().getDisplayValues();

    let trainingRows = [];
    const activeSS = SpreadsheetApp.getActiveSpreadsheet();
    let trainingSheet = activeSS ? activeSS.getSheetByName(QUIZ_CONFIG.trainingRecordSheetName) : null;
    if (!trainingSheet && masterSS) {
      trainingSheet = masterSS.getSheetByName(QUIZ_CONFIG.trainingRecordSheetName);
    }
    if (trainingSheet && trainingSheet.getLastRow() >= 1) {
      trainingRows = trainingSheet.getDataRange().getDisplayValues();
    }

    return buildSimpleTrainingStatsFromData_(personnelRows, trainingRows);
  } catch (error) {
    console.error('獲取簡易教育訓練統計失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : '無法載入統計數據',
      summary: {
        totalEligible: 0,
        passedCount: 0,
        failedCount: 0,
        unattemptedCount: 0,
        incompleteCount: 0,
        completionRate: '0.0%',
        completionPercent: 0
      },
      learners: []
    };
  }
}

/**
 * =========================================================
 * 未完成催辦通知台模組 (Mention Notification Module)
 * =========================================================
 */

const MENTION_CONFIG = {
  allowedEmailsPropertyKey: 'DASHBOARD_ALLOWED_EMAILS',
  requiredWatchSeconds: 3600,
  passingScore: 70,
  defaultCourseTitle: '資訊安全暨個資保護教育訓練',
  personnelSheetName: '人員主檔',
  orgSheetName: '組織架構樹',
  assignmentSheetName: '人員職務配置',
  progressSheetName: '觀看進度',
  quizRecordSheetName: '訓練紀錄',
  notificationLogSheetName: '通知紀錄'
};

/**
 * 取得允許存取催辦通知台之 Email 白名單
 * 讀取 Script Properties 中的 DASHBOARD_ALLOWED_EMAILS
 * @returns {string[]}
 */
function getDashboardAllowedEmails_() {
  let raw = '';
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      if (props && props.getProperty) {
        const key = (typeof MENTION_CONFIG !== 'undefined' && MENTION_CONFIG.allowedEmailsPropertyKey) || 'DASHBOARD_ALLOWED_EMAILS';
        raw = props.getProperty(key) || '';
      }
    }
  } catch (e) {}

  return String(raw || '')
    .split(/[\n,;]+/)
    .map((item) => normalizeEmail_(item))
    .filter(Boolean);
}

/**
 * 檢查使用者是否具備存取催辦通知台之權限 (白名單制 + Default-Deny)
 * @param {string} viewerEmail - 使用者 Email
 * @returns {boolean}
 */
function canAccessMention_(viewerEmail) {
  const email = normalizeEmail_(viewerEmail);
  const allowed = getDashboardAllowedEmails_();
  if (allowed.length > 0) {
    if (!email) return false;
    return allowed.includes(email);
  }
  // 若白名單未設定：若處於 Node.js 測試環境且未設定白名單則寬容（相容純邏輯單元測試），真實 GAS 環境則一律 Default-Deny
  if (typeof process !== 'undefined' && process.env) {
    return true;
  }
  return false;
}

/**
 * 產製催辦通知台權限不足之 HTML 頁面
 * @param {string} viewerEmail - 使用者 Email
 * @returns {string} HTML 內容
 */
function buildMentionAccessDeniedHtml_(viewerEmail) {
  const safeEmail = escapeHtml_(viewerEmail || '未登入帳號');
  const propertyKey = escapeHtml_((typeof MENTION_CONFIG !== 'undefined' && MENTION_CONFIG.allowedEmailsPropertyKey) || 'DASHBOARD_ALLOWED_EMAILS');
  return '<!DOCTYPE html>\n' +
    '<html lang="zh-TW">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>權限不足 - 資安教育訓練未完成催辦通知台</title>\n' +
    '  <style>\n' +
    '    :root {\n' +
    '      --bg: #f8fafc;\n' +
    '      --card: #ffffff;\n' +
    '      --text: #0f172a;\n' +
    '      --muted: #64748b;\n' +
    '      --line: #e2e8f0;\n' +
    '      --warn: #dc2626;\n' +
    '    }\n' +
    '    * { box-sizing: border-box; }\n' +
    '    body {\n' +
    '      margin: 0;\n' +
    '      min-height: 100vh;\n' +
    '      display: grid;\n' +
    '      place-items: center;\n' +
    '      padding: 24px;\n' +
    '      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;\n' +
    '      background: radial-gradient(circle at top left, rgba(79, 70, 229, 0.08), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #edf2f7 100%);\n' +
    '      color: var(--text);\n' +
    '    }\n' +
    '    .panel {\n' +
    '      width: min(540px, 100%);\n' +
    '      padding: 36px 32px;\n' +
    '      border-radius: 20px;\n' +
    '      background: var(--card);\n' +
    '      border: 1px solid var(--line);\n' +
    '      box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.08);\n' +
    '      text-align: left;\n' +
    '    }\n' +
    '    .eyebrow {\n' +
    '      display: inline-flex;\n' +
    '      align-items: center;\n' +
    '      padding: 6px 12px;\n' +
    '      border-radius: 999px;\n' +
    '      background: #fee2e2;\n' +
    '      color: var(--warn);\n' +
    '      font-size: 12px;\n' +
    '      font-weight: 700;\n' +
    '      letter-spacing: 0.05em;\n' +
    '    }\n' +
    '    h1 {\n' +
    '      margin: 20px 0 12px;\n' +
    '      font-size: 22px;\n' +
    '      font-weight: 700;\n' +
    '      line-height: 1.3;\n' +
    '      color: #1e293b;\n' +
    '    }\n' +
    '    p {\n' +
    '      margin: 0 0 16px;\n' +
    '      color: var(--muted);\n' +
    '      font-size: 14px;\n' +
    '      line-height: 1.7;\n' +
    '    }\n' +
    '    code {\n' +
    '      display: inline-block;\n' +
    '      padding: 2px 8px;\n' +
    '      border-radius: 6px;\n' +
    '      background: #f1f5f9;\n' +
    '      color: #4338ca;\n' +
    '      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n' +
    '      font-size: 13px;\n' +
    '      font-weight: 600;\n' +
    '    }\n' +
    '    .footer {\n' +
    '      margin-top: 24px;\n' +
    '      padding-top: 20px;\n' +
    '      border-top: 1px solid var(--line);\n' +
    '      font-size: 13px;\n' +
    '      color: #94a3b8;\n' +
    '    }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <main class="panel">\n' +
    '    <div class="eyebrow">ACCESS RESTRICTED</div>\n' +
    '    <h1>您目前沒有使用催辦通知台的權限</h1>\n' +
    '    <p>目前登入帳號：<code>' + safeEmail + '</code></p>\n' +
    '    <p>此頁面僅限系統管理員與指定負責人操作。若需存取權限，請確認 Apps Script「指令碼屬性（Script Properties）」中已將您的信箱加入 <code>' + propertyKey + '</code> 設定值。</p>\n' +
    '    <div class="footer">\n' +
    '      如有任何權限疑問，請聯絡專案規劃組(策略組)或資安承辦人員。\n' +
    '    </div>\n' +
    '  </main>\n' +
    '</body>\n' +
    '</html>';
}

function isOutsideLocation_(location) {
  return String(location || '').trim().toLowerCase() === 'outside';
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isEthicsCommitteeMember_(learner, context) {
  if (!learner) return false;
  const status = String(learner.personnelStatus || '').trim();
  if (status === '倫理委員會' || status.includes('倫理委員會')) return true;

  const orgCode = String(learner.assignmentOrgCode || '').trim().toUpperCase();
  if (orgCode === 'EGC') return true;

  const orgName = String(learner.assignmentOrgName || '').trim();
  if (orgName.includes('倫理委員會')) return true;

  const title = String(learner.assignmentTitle || '').trim();
  if (title.includes('倫理委員')) return true;

  if (Array.isArray(learner.assignments)) {
    for (let i = 0; i < learner.assignments.length; i += 1) {
      const asgn = learner.assignments[i];
      const aCode = String(asgn.orgCode || '').trim().toUpperCase();
      const aName = String(asgn.orgName || asgn.name || '').trim();
      const aTitle = String(asgn.title || '').trim();
      if (aCode === 'EGC' || aName.includes('倫理委員會') || aTitle.includes('倫理委員')) {
        return true;
      }
    }
  }

  if (context && Array.isArray(context.assignments)) {
    const normEmail = normalizeEmail_(learner.email);
    for (let i = 0; i < context.assignments.length; i += 1) {
      const asgn = context.assignments[i];
      if (normalizeEmail_(asgn.email) === normEmail) {
        const aCode = String(asgn.orgCode || '').trim().toUpperCase();
        const aName = String(asgn.orgName || asgn.name || '').trim();
        const aTitle = String(asgn.title || '').trim();
        if (aCode === 'EGC' || aName.includes('倫理委員會') || aTitle.includes('倫理委員')) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 判定是否為委外廠商或合作廠商人員/駐站
 */
function isVendorPersonnel_(learner, context) {
  if (!learner) return false;

  const isVendorString = (str) => {
    const s = String(str || '').trim();
    if (!s) return false;
    return (
      s === '委外' ||
      s === '委外廠商' ||
      s === '合作' ||
      s === '合作廠商' ||
      s.includes('委外') ||
      s.includes('廠商')
    );
  };

  const isVendorOrgCode = (code) => {
    const c = normalizeOrgCode_(code);
    return c.startsWith('GRP-CO-EX-') || c.includes('EX-');
  };

  // 1. 檢查人員在勤狀態 (人員主檔 C 欄)
  if (isVendorString(learner.personnelStatus)) return true;

  // 2. 檢查工作地點 (人員主檔 H 欄)
  if (isVendorString(learner.location)) return true;

  // 3. 檢查主職組別代碼 (GRP-CO-EX-* 為委外駐站)
  if (isVendorOrgCode(learner.assignmentOrgCode)) return true;

  // 4. 檢查主職組別名稱與職稱
  if (isVendorString(learner.assignmentOrgName) || isVendorString(learner.assignmentTitle)) return true;

  // 5. 檢查 learner 本身的 assignments
  if (Array.isArray(learner.assignments)) {
    for (let i = 0; i < learner.assignments.length; i += 1) {
      const asgn = learner.assignments[i];
      if (isVendorOrgCode(asgn.orgCode)) return true;
      if (isVendorString(asgn.orgName || asgn.name) || isVendorString(asgn.title)) return true;
    }
  }

  // 6. 檢查 context.assignments (全域職務配置)
  if (context && Array.isArray(context.assignments)) {
    const normEmail = normalizeEmail_(learner.email);
    for (let i = 0; i < context.assignments.length; i += 1) {
      const asgn = context.assignments[i];
      if (normalizeEmail_(asgn.email) === normEmail) {
        if (isVendorOrgCode(asgn.orgCode)) return true;
        if (isVendorString(asgn.orgName || asgn.name) || isVendorString(asgn.title)) return true;
      }
    }
  }

  return false;
}

function formatChineseDeadlineDate_(dateStr) {
  const safeStr = String(dateStr || '').trim();
  if (!safeStr) return '8 月 30 日';
  const m = safeStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mon = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    return `${y} 年 ${mon} 月 ${d} 日`;
  }
  return safeStr;
}

function buildNotificationWatchReminderHtml_() {
  return [
    '<p>※ 觀看提醒：<br>',
    '1. 觀看時請勿快轉或頻繁切換視窗，系統將定期確認在座狀態。<br>',
    '2. 需完整觀看達規定時數，課後評量始算有效。</p>'
  ].join('');
}

function buildNotificationLoginReminderHtml_() {
  return [
    '<p>※ 登入提醒：<br>',
    '點擊上方連結進入後，請以公務 Google 帳號登入系統，學習紀錄將自動為您保存與同步。</p>'
  ].join('');
}

function buildNotificationAutoReplyFooterHtml_() {
  return [
    '<p style="color: #64748b; font-size: 0.9em; margin-top: 24px;">',
    '此為自動發送之通知信件，無需直接回覆。<br>',
    '如有任何問題，請聯絡專案規劃組(策略組)。',
    '</p>'
  ].join('');
}

function hasExecutiveAdminAssignment_(email, context) {
  const normEmail = normalizeEmail_(email);
  if (!normEmail || !context) return false;

  if (Array.isArray(context.assignments)) {
    for (let i = 0; i < context.assignments.length; i += 1) {
      const assignment = context.assignments[i];
      if (normalizeEmail_(assignment.email) === normEmail) {
        const orgCode = normalizeOrgCode_(assignment.orgCode);
        const orgNode = context.orgNodeMap ? context.orgNodeMap.get(orgCode) : null;
        if (orgNode) {
          const type = String(orgNode.type || '').trim();
          const level = Number(orgNode.level || 0);
          if (type === '行政' && level > 0 && level < 5) {
            return true;
          }
        }
      }
    }
  }

  if (Array.isArray(context.learners)) {
    const learner = context.learners.find((l) => normalizeEmail_(l.email) === normEmail);
    if (learner) {
      const type = String(learner.assignmentOrgType || '').trim();
      const level = Number(learner.assignmentOrgLevel || 0);
      if (type === '行政' && level > 0 && level < 5) {
        return true;
      }
      if (Array.isArray(learner.assignments)) {
        for (let j = 0; j < learner.assignments.length; j += 1) {
          const asgn = learner.assignments[j];
          const orgCode = normalizeOrgCode_(asgn.orgCode);
          const orgNode = context.orgNodeMap ? context.orgNodeMap.get(orgCode) : null;
          if (orgNode) {
            const aType = String(orgNode.type || '').trim();
            const aLevel = Number(orgNode.level || 0);
            if (aType === '行政' && aLevel > 0 && aLevel < 5) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

function resolveLearnerLevel5OrgCode_(learner, context, targetOrgCodeSet) {
  if (!learner) return null;
  const primaryCode = normalizeOrgCode_(learner.assignmentOrgCode);
  if (primaryCode && targetOrgCodeSet.has(primaryCode)) {
    return primaryCode;
  }

  if (Array.isArray(learner.assignments)) {
    for (let i = 0; i < learner.assignments.length; i += 1) {
      const c = normalizeOrgCode_(learner.assignments[i].orgCode);
      if (c && targetOrgCodeSet.has(c)) {
        return c;
      }
    }
  }

  if (context && Array.isArray(context.assignments)) {
    const normEmail = normalizeEmail_(learner.email);
    for (let i = 0; i < context.assignments.length; i += 1) {
      const asgn = context.assignments[i];
      if (normalizeEmail_(asgn.email) === normEmail) {
        const c = normalizeOrgCode_(asgn.orgCode);
        if (c && targetOrgCodeSet.has(c)) {
          return c;
        }
      }
    }
  }

  return null;
}

function isCaseStaffOrgCode_(orgCode) {
  const cleanCode = normalizeOrgCode_(orgCode);
  return cleanCode === 'GRP-CO' || cleanCode.startsWith('GRP-CO-');
}

function classifyCaseStaffLeadRole_(title) {
  const cleanTitle = String(title || '').trim();
  if (/副組長|副長/.test(cleanTitle)) {
    return {
      roleType: 'deputy',
      roleLabel: '收案組副組長',
      rank: 2
    };
  }
  if (/組長|長/.test(cleanTitle)) {
    return {
      roleType: 'leader',
      roleLabel: '收案組組長',
      rank: 1
    };
  }
  return null;
}

function buildCaseStaffTeamLeadRecipients_(assignments) {
  const leadsByEmail = new Map();
  (assignments || []).forEach((assignment) => {
    const email = normalizeEmail_(assignment.email);
    if (normalizeOrgCode_(assignment.orgCode) !== 'GRP-CO') return;
    const roleInfo = classifyCaseStaffLeadRole_(assignment.title);
    if (!roleInfo || !email || !isValidEmail_(email)) return;
    if (leadsByEmail.has(email)) {
      const existing = leadsByEmail.get(email);
      if (roleInfo.rank < existing.rank) {
        leadsByEmail.set(email, {
          email,
          name: String(assignment.name || email).trim(),
          title: roleInfo.roleLabel,
          roleType: roleInfo.roleType,
          roleLabel: roleInfo.roleLabel,
          rank: roleInfo.rank
        });
      }
      return;
    }
    leadsByEmail.set(email, {
      email,
      name: String(assignment.name || email).trim(),
      title: roleInfo.roleLabel,
      roleType: roleInfo.roleType,
      roleLabel: roleInfo.roleLabel,
      rank: roleInfo.rank
    });
  });
  return Array.from(leadsByEmail.values()).sort((a, b) => a.rank - b.rank);
}

function resolveOrgGroupLeadRecipients_(groupOrCode, context, groupMembers) {
  if (!groupOrCode || !context) return [];
  const leads = [];
  const seenEmails = new Set();

  let targetCode = '';
  let managerEmail = '';
  let managerName = '';

  if (typeof groupOrCode === 'string') {
    targetCode = normalizeOrgCode_(groupOrCode);
    const node = context.orgNodeMap ? context.orgNodeMap.get(targetCode) : null;
    if (node) {
      managerEmail = node.managerEmail;
      managerName = node.managerName;
    }
  } else {
    targetCode = normalizeOrgCode_(groupOrCode.code || groupOrCode.orgCode);
    managerEmail = groupOrCode.managerEmail || (context.orgNodeMap && context.orgNodeMap.get(targetCode) ? context.orgNodeMap.get(targetCode).managerEmail : '');
    managerName = groupOrCode.managerName || (context.orgNodeMap && context.orgNodeMap.get(targetCode) ? context.orgNodeMap.get(targetCode).managerName : '');
  }

  // 1. 若為收案組 (GRP-CO 或收案駐站 GRP-CO-*)：CC 納入組長、副組長、駐站管理員
  if (isCaseStaffOrgCode_(targetCode)) {
    // 1-1. 收案組組長與副組長
    const caseLeads = buildCaseStaffTeamLeadRecipients_(context && context.assignments ? context.assignments : []);
    caseLeads.forEach((lead) => {
      const email = normalizeEmail_(lead.email);
      if (isValidEmail_(email) && !hasExecutiveAdminAssignment_(email, context) && !seenEmails.has(email)) {
        seenEmails.add(email);
        leads.push({
          email,
          name: lead.name || email,
          title: lead.roleLabel || lead.title || '組長',
          source: 'case_staff_lead'
        });
      }
    });

    // 1-2. 駐站管理員：
    const stationCodeSet = new Set();
    const membersToCheck = Array.isArray(groupMembers) && groupMembers.length > 0
      ? groupMembers
      : (context.learners || []).filter(l => isCaseStaffOrgCode_(l.assignmentOrgCode));

    membersToCheck.forEach(m => {
      if (isCaseStaffOrgCode_(m.assignmentOrgCode) && m.assignmentOrgCode !== 'GRP-CO') {
        stationCodeSet.add(normalizeOrgCode_(m.assignmentOrgCode));
      }
      if (Array.isArray(m.assignments)) {
        m.assignments.forEach(asgn => {
          if (isCaseStaffOrgCode_(asgn.orgCode) && asgn.orgCode !== 'GRP-CO') {
            stationCodeSet.add(normalizeOrgCode_(asgn.orgCode));
          }
        });
      }
    });

    if (context && Array.isArray(context.assignments)) {
      context.assignments.forEach((asgn) => {
        const c = normalizeOrgCode_(asgn.orgCode);
        if (c.startsWith('GRP-CO-')) {
          stationCodeSet.add(c);
          const mEmail = normalizeEmail_(asgn.managerEmail);
          if (mEmail && isValidEmail_(mEmail) && !hasExecutiveAdminAssignment_(mEmail, context) && !seenEmails.has(mEmail)) {
            seenEmails.add(mEmail);
            const node = context.orgNodeMap ? context.orgNodeMap.get(c) : null;
            const stationName = (node && node.name) || asgn.orgName || '駐站';
            leads.push({
              email: mEmail,
              name: asgn.managerName || mEmail,
              title: `${stationName}駐站管理員`,
              source: 'station_manager'
            });
          }
        }
      });
    }

    stationCodeSet.forEach(stationCode => {
      const node = context && context.orgNodeMap ? context.orgNodeMap.get(stationCode) : null;
      if (node && isValidEmail_(node.managerEmail)) {
        const mEmail = normalizeEmail_(node.managerEmail);
        if (!hasExecutiveAdminAssignment_(mEmail, context) && !seenEmails.has(mEmail)) {
          seenEmails.add(mEmail);
          leads.push({
            email: mEmail,
            name: node.managerName || mEmail,
            title: `${node.name || '駐站'}駐站管理員`,
            source: 'station_manager'
          });
        }
      }
    });

    return leads;
  }

  // 2. 一般組別
  if (managerEmail && isValidEmail_(managerEmail)) {
    const email = normalizeEmail_(managerEmail);
    if (!hasExecutiveAdminAssignment_(email, context) && !seenEmails.has(email)) {
      leads.push({
        email,
        name: managerName || '組長',
        title: '組長'
      });
      seenEmails.add(email);
    }
  }

  const checkTitle = (title) => {
    const t = String(title || '').trim();
    if (t.includes('組長') || t.includes('副組長') || t.includes('主任')) {
      return t;
    }
    return null;
  };

  // 優先從 assignments 尋找
  if (Array.isArray(context.assignments)) {
    context.assignments.forEach((asgn) => {
      if (normalizeOrgCode_(asgn.orgCode) !== targetCode) return;
      const email = normalizeEmail_(asgn.email);
      if (!email || seenEmails.has(email) || !isValidEmail_(email)) return;
      if (hasExecutiveAdminAssignment_(email, context)) return;
      const matchedTitle = checkTitle(asgn.title);
      if (matchedTitle) {
        seenEmails.add(email);
        leads.push({
          email,
          name: asgn.name || '組長',
          title: matchedTitle
        });
      }
    });
  }

  // 兜底從 learners 尋找
  (context.learners || []).forEach((learner) => {
    const email = normalizeEmail_(learner.email);
    if (!email || seenEmails.has(email) || !isValidEmail_(email)) return;
    if (hasExecutiveAdminAssignment_(email, context)) return;

    let isMatch = false;
    let leadTitle = '';

    const primaryTitle = normalizeOrgCode_(learner.assignmentOrgCode) === targetCode ? checkTitle(learner.assignmentTitle) : null;
    if (primaryTitle) {
      isMatch = true;
      leadTitle = primaryTitle;
    } else if (Array.isArray(learner.assignments)) {
      for (let i = 0; i < learner.assignments.length; i += 1) {
        const asgn = learner.assignments[i];
        if (normalizeOrgCode_(asgn.orgCode) === targetCode) {
          const t = checkTitle(asgn.title);
          if (t) {
            isMatch = true;
            leadTitle = t;
            break;
          }
        }
      }
    }

    if (isMatch) {
      seenEmails.add(email);
      leads.push({
        email,
        name: learner.name || '組長',
        title: leadTitle || '組長'
      });
    }
  });

  return leads;
}

function buildLeadershipReminderIndividualTemplate_(courseTitle) {
  const safeCourseTitle = escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練');
  return {
    subject: `【重要提醒】請撥冗完成${safeCourseTitle}`,
    htmlBody: [
      '<p>{{姓名}} 長官/主管 您好：</p>',
      '<p>依據《資通安全責任等級分級辦法》及第三方國際標準驗證要求，全體同仁每年均需完成資通安全通識教育訓練。</p>',
      `<p>系統顯示您目前尚未完成<strong>${safeCourseTitle}</strong>課程與評量，特此溫馨提醒。鑑於長官主管兼負政策審議、管理審查及督導推動之重責，敬請撥冗於期限內完成相關要求。</p>`,
      '<p>您目前的訓練資訊如下：<br>',
      '所屬單位：{{單位}}<br>',
      '職稱：{{職稱}}<br>',
      '目前狀態：{{訓練狀態}}<br>',
      '修課期限：請於 {{修課期限}} 以前完成</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildLeadershipReminderGenericTemplate_(courseTitle) {
  const safeCourseTitle = escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練');
  return {
    subject: `【重要提醒】請長官、主管撥冗完成${safeCourseTitle}`,
    htmlBody: [
      '<p>長官、主管們好：</p>',
      '<p>依據《資通安全責任等級分級辦法》及第三方國際標準驗證要求，每年需持續落實資訊安全與個資保護管理要求。</p>',
      `<p>提醒各位長官主管，本年度「<strong>${safeCourseTitle}</strong>」線上課程目前尚有長官主管未完成，鑑於長官主管肩負管理審查與督導重任，敬請尚未完成的長官與主管撥冗安排時間完成影片觀看與課後測驗。</p>`,
      '<p><strong>修課說明：</strong><br>',
      '及格標準：觀看滿指定時數，並通過課後測驗（評量 70 分以上為及格）<br>',
      '修課期限：請於 {{修課期限}} 以前完成</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildOrgGroupReminderTemplate_(courseTitle) {
  const safeCourseTitle = escapeHtml_(courseTitle || '資訊安全暨個資保護教育訓練');
  return {
    subject: `【重要提醒】{{組別名稱}} - ${safeCourseTitle}未完成同仁催課通知`,
    htmlBody: [
      '<p>{{組別名稱}} 各位同仁 您好：</p>',
      `<p>提醒您，本年度「<strong>${safeCourseTitle}</strong>」目前尚有同仁未完成課程或測驗，請尚未完課之同仁儘速安排時間完成。</p>`,
      '<p><strong>截至目前本組尚未完課同仁清單：</strong></p>',
      '{{未完成清單}}',
      '<p><strong>修課說明：</strong><br>',
      '及格標準：觀看滿指定時數，並通過課後測驗（評量 70 分以上為及格）<br>',
      '修課期限：請於 {{修課期限}} 以前完成</p>',
      buildNotificationWatchReminderHtml_(),
      buildNotificationLoginReminderHtml_(),
      '<p><a href="{{上課網址}}">前往上課</a></p>',
      buildNotificationAutoReplyFooterHtml_()
    ].join('')
  };
}

function buildOrgGroupIncompleteListHtml_(learners) {
  if (!learners || learners.length === 0) {
    return '<p style="color: #64748b; font-size: 13px;">（目前本組尚無未完成人員）</p>';
  }
  const rowsHtml = learners.map((learner) => {
    const statusLabel = learner.statusLabel || (learner.status === 'not_started' ? '未開始' : (learner.status === 'in_progress' ? '觀看中' : '待測驗'));
    const watchedText = typeof learner.watchedPercent === 'number' ? `${learner.watchedPercent}%` : '0%';
    const rawScore = learner.bestScore;
    const numScore = (rawScore !== null && rawScore !== undefined && rawScore !== '') ? Number(rawScore) : NaN;
    const scoreText = (!isNaN(numScore) && numScore > 0) ? `${numScore}分` : '尚未測驗';
    return '<tr>' +
      '<td style="padding: 6px 10px; border: 1px solid #cbd5e1;">' + escapeHtml_(learner.name) + '</td>' +
      '<td style="padding: 6px 10px; border: 1px solid #cbd5e1;">' + escapeHtml_(learner.assignmentTitle || '-') + '</td>' +
      '<td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: center;">' + escapeHtml_(statusLabel) + '</td>' +
      '<td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: center;">' + escapeHtml_(watchedText) + '</td>' +
      '<td style="padding: 6px 10px; border: 1px solid #cbd5e1; text-align: center;">' + escapeHtml_(scoreText) + '</td>' +
      '</tr>';
  }).join('');

  return '<table style="border-collapse: collapse; width: 100%; max-width: 600px; font-size: 13px; margin: 10px 0; font-family: sans-serif; border: 1px solid #cbd5e1;">' +
    '<thead>' +
    '<tr style="background-color: #f1f5f9; color: #334155; text-align: left;">' +
    '<th style="padding: 8px 10px; border: 1px solid #cbd5e1;">姓名</th>' +
    '<th style="padding: 8px 10px; border: 1px solid #cbd5e1;">職稱</th>' +
    '<th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">受訓狀態</th>' +
    '<th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">觀看進度</th>' +
    '<th style="padding: 8px 10px; border: 1px solid #cbd5e1; text-align: center;">測驗狀態</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' +
    rowsHtml +
    '</tbody>' +
    '</table>';
}

/**
 * 解析 EMAIL_SHADOW_MAP 設定
 * 支援 JSON 格式或 "主信箱:副信箱1,副信箱2;主信箱2:副信箱3" 格式
 */
function parseEmailShadowMapConfig_(rawConfig) {
  if (!rawConfig) return {};
  const str = String(rawConfig).trim();
  if (!str) return {};

  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str);
      const res = {};
      Object.keys(parsed).forEach((k) => {
        const normKey = normalizeEmail_(k);
        if (!normKey) return;
        const val = parsed[k];
        const arr = (Array.isArray(val) ? val : [val])
          .map((item) => normalizeEmail_(item))
          .filter((item) => isValidEmail_(item));
        if (arr.length > 0) res[normKey] = arr;
      });
      return res;
    } catch (e) {
      // 若 JSON 解析失敗，繼續嘗試字串解析
    }
  }

  const res = {};
  const pairs = str.split(/[;\n]+/);
  pairs.forEach((pair) => {
    const trimmed = pair.trim();
    if (!trimmed) return;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) return;
    const primary = normalizeEmail_(trimmed.slice(0, colonIdx));
    if (!primary) return;
    const shadowsStr = trimmed.slice(colonIdx + 1);
    const shadows = shadowsStr.split(',')
      .map((item) => normalizeEmail_(item))
      .filter((item) => isValidEmail_(item));
    if (shadows.length > 0) {
      res[primary] = shadows;
    }
  });
  return res;
}

/**
 * 取得指定主信箱的影子信箱（若無則回傳空陣列）
 */
function resolveMentionShadowEmails_(email) {
  const norm = normalizeEmail_(email);
  if (!norm) return [];

  let rawConfig = '';
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      rawConfig = PropertiesService.getScriptProperties().getProperty('EMAIL_SHADOW_MAP') || '';
    }
  } catch (e) {
    console.warn('讀取 Script Properties EMAIL_SHADOW_MAP 失敗:', e);
  }

  const map = parseEmailShadowMapConfig_(rawConfig);
  return map[norm] || [];
}

/**
 * 讀取 HMAC-SHA256 簽署密鑰
 * 優先讀取 Script Properties 中的 ACTION_SECRET 或 AUTH_SECRET_KEY
 */
function getHmacSecret_() {
  let secret = '';
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      secret = props.getProperty('ACTION_SECRET') || props.getProperty('AUTH_SECRET_KEY') || '';
    }
  } catch (e) {
    console.warn('讀取 Script Properties 金鑰失敗:', e);
  }
  return secret || 'isms-education-capability-secret-fallback';
}

/**
 * 反查副信箱對應之公務主信箱
 * 若傳入之 email 為 EMAIL_SHADOW_MAP 中的副信箱，則反查並回傳其主信箱；否則回傳正規化後的原信箱。
 */
function resolveEffectiveEmail_(email) {
  const norm = normalizeEmail_(email);
  if (!norm) return '';

  let rawConfig = '';
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      rawConfig = PropertiesService.getScriptProperties().getProperty('EMAIL_SHADOW_MAP') || '';
    }
  } catch (e) {
    console.warn('讀取 Script Properties EMAIL_SHADOW_MAP 失敗:', e);
  }

  const map = parseEmailShadowMapConfig_(rawConfig);
  if (map[norm]) return norm;

  const entries = Object.keys(map);
  for (let i = 0; i < entries.length; i += 1) {
    const primary = entries[i];
    const shadows = map[primary];
    if (Array.isArray(shadows) && shadows.includes(norm)) {
      return primary;
    }
  }
  return norm;
}

/**
 * 產生長官免登入專屬上課 HMAC-SHA256 簽章
 * @param {string} courseTitle - 課程名稱
 * @param {string} primaryEmail - 學員公務主信箱
 * @returns {string} 64 字元的 hex 簽章
 */
function generateCapabilityToken_(courseTitle, primaryEmail) {
  const normEmail = normalizeEmail_(primaryEmail);
  const title = String(courseTitle || 'default-course').trim();
  const payload = [title, 'education', normEmail].join('|');
  const secret = getHmacSecret_();

  if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
    const sigBytes = Utilities.computeHmacSha256Signature(payload, secret);
    return sigBytes.map((b) => ('0' + ((b & 0xff).toString(16))).slice(-2)).join('');
  }

  // Node.js 測試環境相容
  try {
    const nodeCrypto = (typeof require !== 'undefined')
      ? require('crypto')
      : ((typeof process !== 'undefined' && process.getBuiltinModule) ? process.getBuiltinModule('crypto') : null);
    if (nodeCrypto && nodeCrypto.createHmac) {
      return nodeCrypto.createHmac('sha256', secret).update(payload).digest('hex');
    }
  } catch (e) {}

  return '';
}

/**
 * 組裝學員專屬免登入 HMAC-SHA256 Capability 上課網址
 * 自動去除 URL 原有的 query parameters (如 ?page=mention)，精準指向上課首頁
 * @param {string} baseUrl - 基礎 Web App 網址
 * @param {string} courseTitle - 課程名稱
 * @param {string} primaryEmail - 學員公務主信箱
 * @returns {string} 包含 op 與 auth 簽章的專屬網址
 */
function buildLearnerCapabilityUrl_(baseUrl, courseTitle, primaryEmail) {
  const rawUrl = String(baseUrl || '').trim();
  if (!rawUrl || rawUrl === '#') return '#';
  const cleanUrl = rawUrl.split('?')[0];
  const normEmail = normalizeEmail_(primaryEmail);
  if (!normEmail) return cleanUrl;
  const token = generateCapabilityToken_(courseTitle, normEmail);
  if (!token) return cleanUrl;
  return cleanUrl + '?op=' + encodeURIComponent(normEmail) + '&auth=' + encodeURIComponent(token);
}

/**
 * 產生影子信箱專屬直達轉派提示橫幅 HTML
 * @param {string} learnerName - 學員姓名
 * @returns {string} HTML 提示區塊
 */
function buildShadowForwardingNoticeHtml_(learnerName) {
  const safeName = escapeHtml_(learnerName || '長官/同仁');
  return [
    '<div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 6px; padding: 12px; margin: 12px 0 16px 0; font-size: 13px; color: #92400e; line-height: 1.5; font-family: sans-serif;">',
    '🪞 <strong>影子信箱雙軌專屬轉派通知</strong><br>',
    '此信件為系統自動同步轉派至您的私人信箱。您可直接點擊下方「前往上課」專屬連結，使用手機或個人行動裝置直接上課與測驗，系統將自動以您的公務身分（<strong>' + safeName + '</strong>）記錄受訓進度與成績，無需登入 Google 組織帳號。',
    '</div>'
  ].join('');
}

/**
 * 解析最權威之 Web App 基礎網址 (優先採用伺服端 ScriptApp.getService().getUrl())
 * 嚴格防範 Google iframe 沙盒網址 (*.googleusercontent.com) 污染對外發信連結
 * @param {string} [fallbackUrl] - 備用 URL
 * @returns {string} 乾淨之 Web App 進入點網址
 */
function resolveBaseCourseUrl_(fallbackUrl) {
  let url = '';
  try {
    if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
      url = ScriptApp.getService().getUrl() || '';
    }
  } catch (e) {}

  // 伺服端無值時（如無部署狀態或本機測試），檢查 fallbackUrl
  if (!url && fallbackUrl) {
    const raw = String(fallbackUrl).trim();
    // 排除 googleusercontent 沙盒域名
    if (raw && !raw.includes('googleusercontent.com')) {
      url = raw;
    }
  }

  // 剝除任何 query string (如 ?page=mention)
  if (url && url.includes('?')) {
    url = url.split('?')[0];
  }

  return url || '#';
}

/**
 * 將專屬 Capability URL 強制且精準地注入信件 HTML 內文
 * 支援替換 {{上課網址}} 佔位符，以及已固化之任意前往上課 <a> 標籤連結，並在頂部附加影子轉派橫幅
 * @param {string} htmlBody - 原始信件 HTML
 * @param {string} capUrl - 學員/長官專屬免登入 URL
 * @param {string} [noticeBanner] - 影子專屬提示橫幅 HTML
 * @returns {string} 注入後的完整 HTML
 */
function injectCapabilityUrlIntoHtmlBody_(htmlBody, capUrl, noticeBanner) {
  let body = String(htmlBody || '');
  if (body.includes('{{上課網址}}')) {
    body = body.replace(/\{\{上課網址\}\}/g, capUrl);
  } else {
    // 匹配包含「前往上課」文字的 <a> 標籤，將其 href 強制替換為 capUrl
    const regex = /<a\s+([^>]*?)href=["'][^"']*?["']([^>]*?)>(\s*前往上課\s*)<\/a>/gi;
    if (regex.test(body)) {
      body = body.replace(regex, '<a $1href="' + capUrl + '"$2>$3</a>');
    } else {
      // 若連「前往上課」文字都找不到，附加至最末尾作為獨立上課按鈕
      body += '<p style="margin-top: 16px;"><a href="' + capUrl + '" style="display: inline-block; padding: 10px 18px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">專屬免登入前往上課</a></p>';
    }
  }
  return (noticeBanner || '') + body;
}

/**
 * 驗證長官免登入專屬上課 HMAC-SHA256 簽章
 * @param {string} courseTitle - 課程名稱
 * @param {string} opEmail - 操作者信箱 (主信箱或副信箱)
 * @param {string} signature - 簽章字串
 * @returns {boolean}
 */
function verifyCapabilityToken_(courseTitle, opEmail, signature) {
  const normOp = normalizeEmail_(opEmail);
  const sig = String(signature || '').trim().toLowerCase();
  if (!normOp || !sig) return false;

  const effectiveEmail = resolveEffectiveEmail_(normOp);
  const expectedToken = generateCapabilityToken_(courseTitle, effectiveEmail);
  return sig === expectedToken.toLowerCase();
}

/**
 * 驗證學員專屬 Capability Token 存取權限（Default-Deny）
 * @param {string} courseTitle - 課程名稱
 * @param {string} opEmail - 操作者信箱 (主信箱或副信箱)
 * @param {string} signature - 簽章字串
 * @param {Object} [options] - 可選選項，如 options.context
 * @returns {{ success: boolean, effectiveEmail: string, name: string }}
 */
function validateLearnerCapabilityAccess_(courseTitle, opEmail, signature, options) {
  const normOp = normalizeEmail_(opEmail);
  const sig = String(signature || '').trim();
  if (!normOp || !sig) {
    throw new Error('未提供完整的操作者信箱或認證簽章');
  }

  const effectiveEmail = resolveEffectiveEmail_(normOp);

  // 1. 檢查是否名列 EMAIL_SHADOW_MAP
  const shadowEmails = resolveMentionShadowEmails_(effectiveEmail);
  if (!shadowEmails || shadowEmails.length === 0) {
    throw new Error('您的帳號未配置影子認證轉派權限');
  }

  // 3. 取得人事與課程 context (提早取得以支援試算表偵測之年度課程名稱比對)
  const context = (options && options.context) || buildMentionContext_(options);

  // 2. 驗證 HMAC 簽章 (支援傳入名稱、context 偵測名稱、預設名稱)
  const candidateTitles = [
    courseTitle,
    context && context.courseTitle,
    typeof MENTION_CONFIG !== 'undefined' ? MENTION_CONFIG.defaultCourseTitle : '',
    '資訊安全暨個資保護教育訓練'
  ].filter((t, idx, arr) => t && arr.indexOf(t) === idx);

  const isValidSig = candidateTitles.some((title) => verifyCapabilityToken_(title, normOp, sig));
  if (!isValidSig) {
    throw new Error('認證簽章不正確或已被竄改');
  }

  // 3. 檢查人事主檔確保存在且非離職
  const learner = (context && context.learners ? context.learners : []).find((l) => normalizeEmail_(l.email) === effectiveEmail);
  if (!learner) {
    throw new Error('在人事資料庫中找不到您的帳號（' + effectiveEmail + '）');
  }
  if (String(learner.personnelStatus || '').trim() === '離職') {
    throw new Error('該人員帳號在人事主檔已註記為離職，存取權限已終止');
  }

  return {
    success: true,
    effectiveEmail,
    name: learner.name || '',
    courseTitle: (context && context.courseTitle) || courseTitle || ''
  };
}

/**
 * 統一解析當前請求之有效認證身分
 * 優先檢查 payload.authContext (若帶有 isShadowAuth 且簽章合法)；否則退回 Google Session
 * @param {Object} payload - API 請求承載物件
 * @param {string} [courseTitle] - 課程名稱 (可選)
 * @param {Object} [options] - 可選選項
 * @returns {{ email: string, isShadowAuth: boolean, authOp: string, name: string }}
 */
function resolveAuthenticatedUser_(payload, courseTitle, options) {
  const authContext = payload && payload.authContext ? payload.authContext : null;
  if (authContext && authContext.isShadowAuth && authContext.op && authContext.auth) {
    const title = courseTitle || (options && options.courseTitle) || (typeof MENTION_CONFIG !== 'undefined' && MENTION_CONFIG.defaultCourseTitle) || '115年度資訊安全暨個人資料保護教育訓練';
    const res = validateLearnerCapabilityAccess_(title, authContext.op, authContext.auth, options);
    return {
      email: res.effectiveEmail,
      isShadowAuth: true,
      authOp: normalizeEmail_(authContext.op),
      name: res.name || ''
    };
  }

  const sessionEmail = normalizeEmail_(getCurrentUserEmail());
  return {
    email: sessionEmail,
    isShadowAuth: false,
    authOp: '',
    name: ''
  };
}

/**
 * 建立催辦通知所需的資料上下文
 */
function buildMentionContext_(options) {
  const opts = options || {};
  if (opts.context) return opts.context;

  let masterSS = null;
  let activeSS = null;
  try {
    if (typeof getMasterSpreadsheet_ === 'function') {
      masterSS = getMasterSpreadsheet_();
    }
  } catch (e) {
    console.warn('讀取 masterSS 失敗:', e && e.message ? e.message : e);
  }

  try {
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
      activeSS = SpreadsheetApp.getActiveSpreadsheet();
    }
  } catch (e) {
    console.warn('讀取 activeSS 失敗:', e && e.message ? e.message : e);
  }

  const primaryMasterSS = masterSS || activeSS;
  const primaryTrainingSS = activeSS || masterSS;

  let personnelRows = [];
  let assignmentRows = [];
  let orgRows = [];
  let trainingRows = [];
  let progressRows = [];

  const getSheetSafe = (sheetName) => {
    let sheet = primaryMasterSS ? primaryMasterSS.getSheetByName(sheetName) : null;
    if (!sheet && primaryTrainingSS) {
      sheet = primaryTrainingSS.getSheetByName(sheetName);
    }
    return sheet;
  };

  const pSheet = getSheetSafe(MENTION_CONFIG.personnelSheetName);
  if (pSheet && pSheet.getLastRow() >= 1) personnelRows = pSheet.getDataRange().getDisplayValues();

  const aSheet = getSheetSafe(MENTION_CONFIG.assignmentSheetName);
  if (aSheet && aSheet.getLastRow() >= 1) assignmentRows = aSheet.getDataRange().getDisplayValues();

  const oSheet = getSheetSafe(MENTION_CONFIG.orgSheetName);
  if (oSheet && oSheet.getLastRow() >= 1) orgRows = oSheet.getDataRange().getDisplayValues();

  const qSheet = getSheetSafe(MENTION_CONFIG.quizRecordSheetName);
  if (qSheet && qSheet.getLastRow() >= 1) trainingRows = qSheet.getDataRange().getDisplayValues();

  const prSheet = getSheetSafe(MENTION_CONFIG.progressSheetName);
  if (prSheet && prSheet.getLastRow() >= 1) progressRows = prSheet.getDataRange().getDisplayValues();

  const orgNodes = [];
  const orgNodeMap = new Map();
  if (orgRows.length > 1) {
    for (let i = 1; i < orgRows.length; i += 1) {
      const row = orgRows[i];
      // 試算表標準結構: A:類型(type), B:層級(level), C:代碼(code), D:名稱(name), E:別名, F:父代碼, G:主管信箱, H:主管姓名
      // 同時兼容 mock 格式 (row[0]=code, row[1]=level, row[2]=name, row[3]=type)
      let type = '';
      let code = '';
      let level = Number(row[1] || 0);
      let name = '';
      let parentCode = '';
      let managerEmail = '';
      let managerName = '';

      const knownTypes = ['行政', '合作單位', '醫事', '委員會'];
      if (knownTypes.includes(String(row[0] || '').trim()) || row[2]) {
        type = String(row[0] || '').trim();
        code = normalizeOrgCode_(row[2] || row[0]);
        name = String(row[3] || row[2] || '').trim();
        parentCode = normalizeOrgCode_(row[5] || row[4]);
        managerEmail = normalizeEmail_(row[6] || row[5]);
        managerName = String(row[7] || row[6] || '').trim();
      } else {
        code = normalizeOrgCode_(row[0]);
        name = String(row[2] || '').trim();
        type = String(row[3] || '').trim();
        parentCode = normalizeOrgCode_(row[4]);
        managerEmail = normalizeEmail_(row[5]);
        managerName = String(row[6] || '').trim();
      }

      if (!code) continue;
      const node = {
        code,
        level,
        name,
        type,
        parentCode,
        managerEmail,
        managerName
      };
      orgNodes.push(node);
      orgNodeMap.set(code, node);
    }
  }

  const assignments = [];
  const assignmentsByEmail = new Map();
  if (assignmentRows.length > 1) {
    for (let i = 1; i < assignmentRows.length; i += 1) {
      const row = assignmentRows[i];
      const email = normalizeEmail_(row[0]);
      if (!email) continue;
      const orgCode = normalizeOrgCode_(row[2]);
      const node = orgNodeMap.get(orgCode);
      const item = {
        email,
        name: String(row[1] || '').trim(),
        orgCode,
        orgName: String(row[3] || (node ? node.name : '')).trim(),
        title: String(row[4] || '').trim(),
        managerEmail: normalizeEmail_(row[5]),
        managerName: String(row[6] || '').trim(),
        assignmentType: '主職',
        type: node ? node.type : '',
        level: node ? node.level : 0
      };
      assignments.push(item);
      if (!assignmentsByEmail.has(email)) assignmentsByEmail.set(email, []);
      assignmentsByEmail.get(email).push(item);
    }
  }

  const quizByEmail = new Map();
  let detectedCourseTitle = '';
  if (trainingRows.length > 1) {
    for (let i = 1; i < trainingRows.length; i += 1) {
      const row = trainingRows[i];
      const email = normalizeEmail_(row[2]);
      if (!email) continue;
      const courseTitle = String(row[3] || '').trim();
      if (courseTitle && !detectedCourseTitle) detectedCourseTitle = courseTitle;
      const score = Number(row[4] || 0);
      const result = String(row[5] || '').trim();
      if (!quizByEmail.has(email)) {
        quizByEmail.set(email, { hasPassed: false, bestScore: 0, attemptCount: 0 });
      }
      const q = quizByEmail.get(email);
      q.attemptCount += 1;
      if (score > q.bestScore) q.bestScore = score;
      if (result === '通過' || score >= MENTION_CONFIG.passingScore) q.hasPassed = true;
    }
  }

  const progressByEmail = new Map();
  if (progressRows.length > 1) {
    for (let i = 1; i < progressRows.length; i += 1) {
      const row = progressRows[i];
      const email = normalizeEmail_(row[0]);
      if (!email) continue;
      // 試算表「觀看進度」欄位: [0]Email, [1]課程, [2]影片ID, [3]已觀看區間, [4]已觀看秒數
      // 兼容可能將秒數置於 row[4] 或 row[2]
      const secVal = Number(row[4] !== undefined && row[4] !== '' ? row[4] : (row[2] || 0));
      const watchedSec = Number.isFinite(secVal) ? secVal : 0;
      const completed = watchedSec >= MENTION_CONFIG.requiredWatchSeconds;
      progressByEmail.set(email, { watchedSec, completed });
    }
  }

  const learners = [];
  if (personnelRows.length > 1) {
    for (let i = 1; i < personnelRows.length; i += 1) {
      const row = personnelRows[i];
      const email = normalizeEmail_(row[0]);
      if (!email) continue;
      const name = String(row[1] || '').trim();
      const personnelStatus = String(row[2] || '').trim();
      if (personnelStatus === '離職') continue;
      const location = String(row[7] || '').trim();

      const userAssignments = assignmentsByEmail.get(email) || [];
      const primaryAsgn = userAssignments[0] || {};
      const orgNode = orgNodeMap.get(primaryAsgn.orgCode);

      const quiz = quizByEmail.get(email) || { hasPassed: false, bestScore: 0, attemptCount: 0 };
      const prog = progressByEmail.get(email) || { watchedSec: 0, completed: false };
      let status = 'not_started';
      let statusLabel = '未觀看';
      if (quiz.hasPassed) {
        status = 'completed';
        statusLabel = '已完成';
      } else if (quiz.attemptCount > 0) {
        status = 'quiz_failed';
        statusLabel = '測驗未通過';
      } else if (prog.watchedSec > 0) {
        status = 'in_progress';
        statusLabel = '觀看中';
      }

      const watchedPercent = Math.min(100, Math.round((prog.watchedSec / MENTION_CONFIG.requiredWatchSeconds) * 100));

      learners.push({
        email,
        name,
        personnelStatus,
        location,
        assignmentOrgCode: primaryAsgn.orgCode || '',
        assignmentOrgName: primaryAsgn.orgName || (orgNode ? orgNode.name : ''),
        assignmentOrgType: primaryAsgn.type || (orgNode ? orgNode.type : ''),
        assignmentOrgLevel: primaryAsgn.level || (orgNode ? orgNode.level : 0),
        assignmentTitle: primaryAsgn.title || '',
        assignmentType: '主職',
        assignments: userAssignments,
        status,
        statusLabel,
        watchedPercent,
        bestScore: quiz.bestScore
      });
    }
  }

  return {
    learners,
    assignments,
    orgNodes,
    orgNodeMap,
    courseTitle: detectedCourseTitle || MENTION_CONFIG.defaultCourseTitle
  };
}

/**
 * 挑選長官主管未完成收件人
 */
function selectMentionRecipients_(context, payload) {
  const recipients = [];
  const skipped = [];
  const seenEmails = new Set();

  (context && context.learners ? context.learners : []).forEach((learner) => {
    const email = normalizeEmail_(learner.email);
    const reasons = [];

    if (!email) reasons.push('缺少信箱');
    if (!isValidEmail_(email)) reasons.push('信箱格式不正確');
    if (seenEmails.has(email)) reasons.push('重複信箱');

    if (!hasExecutiveAdminAssignment_(learner.email, context)) {
      reasons.push('非層級1~4行政長官主管');
    }
    if (learner.status === 'completed') {
      reasons.push('已完成訓練');
    }

    if (payload && payload.excludeParentalLeave && String(learner.personnelStatus || '').trim() === '育嬰假') {
      reasons.push('排除育嬰假');
    }
    if (payload && payload.excludeOutsideLocation && isOutsideLocation_(learner.location)) {
      reasons.push('排除outside');
    }
    if (payload && payload.excludeEthicsCommittee && typeof isEthicsCommitteeMember_ === 'function' && isEthicsCommitteeMember_(learner, context)) {
      reasons.push('排除倫理委員會');
    }
    if (payload && payload.excludeVendor && typeof isVendorPersonnel_ === 'function' && isVendorPersonnel_(learner, context)) {
      reasons.push('排除委外廠商');
    }

    if (reasons.length > 0) {
      if (!reasons.includes('非層級1~4行政長官主管') && !reasons.includes('已完成訓練')) {
        skipped.push({ email: learner.email, name: learner.name, reason: reasons[0] });
      }
      return;
    }

    seenEmails.add(email);
    const hasShadow = resolveMentionShadowEmails_(learner.email).length > 0;
    recipients.push({
      email: learner.email,
      name: learner.name,
      personnelStatus: learner.personnelStatus,
      assignmentOrgName: learner.assignmentOrgName,
      assignmentTitle: learner.assignmentTitle,
      status: learner.status,
      statusLabel: learner.statusLabel,
      watchedPercent: learner.watchedPercent,
      bestScore: learner.bestScore,
      hasShadow
    });
  });

  return { recipients, skipped };
}

/**
 * 挑選全組織各組未完成通知對象
 */
function selectMentionOrgGroupRecipients_(context, payload) {
  const groupMap = new Map();
  const skippedLearners = [];
  const seenEmails = new Set();

  const targetOrgCodeSet = new Set();
  (context && context.orgNodes ? context.orgNodes : []).forEach((node) => {
    const isLevel5 = Number(node.level || 0) >= 5;
    const isPartnerUnit = String(node.type || '').trim() === '合作單位';
    if (isLevel5 || isPartnerUnit) {
      targetOrgCodeSet.add(normalizeOrgCode_(node.code));
    }
  });

  if (context && context.orgNodeMap) {
    context.orgNodeMap.forEach((node, code) => {
      const isLevel5 = Number(node.level || 0) >= 5;
      const isPartnerUnit = String(node.type || '').trim() === '合作單位';
      if (isLevel5 || isPartnerUnit) {
        targetOrgCodeSet.add(normalizeOrgCode_(code));
      }
    });
  }

  (context && context.learners ? context.learners : []).forEach((learner) => {
    const email = normalizeEmail_(learner.email);
    const reasons = [];

    if (!email) reasons.push('缺少信箱');
    if (!isValidEmail_(email)) reasons.push('信箱格式不正確');
    if (seenEmails.has(email)) reasons.push('重複信箱');
    if (hasExecutiveAdminAssignment_(learner.email, context)) reasons.push('行政高層主管排除');

    if (payload && payload.excludeParentalLeave && String(learner.personnelStatus || '').trim() === '育嬰假') reasons.push('排除育嬰假');
    if (payload && payload.excludeOutsideLocation && isOutsideLocation_(learner.location)) reasons.push('排除outside');
    if (payload && payload.excludeEthicsCommittee && typeof isEthicsCommitteeMember_ === 'function' && isEthicsCommitteeMember_(learner, context)) reasons.push('排除倫理委員會');
    if (payload && payload.excludeVendor && typeof isVendorPersonnel_ === 'function' && isVendorPersonnel_(learner, context)) reasons.push('排除委外廠商');

    const orgCode = resolveLearnerLevel5OrgCode_(learner, context, targetOrgCodeSet);
    if (!orgCode && !reasons.includes('行政高層主管排除')) reasons.push('非層級5之後組別');

    if (reasons.length > 0) {
      if (['缺少信箱', '信箱格式不正確', '重複信箱', '行政高層主管排除', '非層級5之後組別'].includes(reasons[0])) {
        skippedLearners.push({ email: learner.email, name: learner.name, reason: reasons[0] });
      }
      return;
    }

    seenEmails.add(email);
    if (!groupMap.has(orgCode)) {
      const orgNode = context && context.orgNodeMap ? context.orgNodeMap.get(orgCode) : null;
      const orgName = orgNode ? (orgNode.name || orgCode) : (learner.assignmentOrgName || orgCode);
      groupMap.set(orgCode, {
        orgCode,
        orgName,
        allMembers: [],
        toMembers: [],
        ccMembers: [],
        isSkipped: false,
        skipReason: ''
      });
    }

    const group = groupMap.get(orgCode);
    group.allMembers.push(learner);
    if (learner.status !== 'completed') {
      group.toMembers.push(learner);
    }
  });

  const activeGroups = [];
  const skippedGroups = [];

  groupMap.forEach((group, orgCode) => {
    // 委外廠商組別排除檢查
    if (payload && payload.excludeVendor) {
      const isVendorGroup = (code, name) => {
        const c = normalizeOrgCode_(code);
        if (c.startsWith('GRP-CO-EX-') || c.includes('EX-')) return true;
        const n = String(name || '').trim();
        return n.includes('委外') || n.includes('廠商');
      };
      if (isVendorGroup(orgCode, group.orgName)) {
        group.isSkipped = true;
        group.skipReason = '委外廠商組別排除';
        skippedGroups.push(group);
        return;
      }
    }

    const leads = resolveOrgGroupLeadRecipients_(orgCode, context, group.allMembers);
    const toEmailSet = new Set((group.toMembers || []).map(m => normalizeEmail_(m.email)));
    const filteredLeads = (leads || []).filter(lead => !toEmailSet.has(normalizeEmail_(lead.email)));

    if (payload && payload.excludeVendor) {
      group.ccMembers = filteredLeads.filter(lead => {
        const leadLearner = (context.learners || []).find(l => normalizeEmail_(l.email) === normalizeEmail_(lead.email));
        if (leadLearner && typeof isVendorPersonnel_ === 'function' && isVendorPersonnel_(leadLearner, context)) return false;
        const s = String(lead.title || '') + String(lead.name || '');
        if (s.includes('委外') || s.includes('廠商')) return false;
        return true;
      });
    } else {
      group.ccMembers = filteredLeads;
    }

    group.toMembers = (group.toMembers || []).map((m) => ({
      ...m,
      hasShadow: resolveMentionShadowEmails_(m.email).length > 0
    }));
    group.ccMembers = (group.ccMembers || []).map((lead) => ({
      ...lead,
      hasShadow: resolveMentionShadowEmails_(lead.email).length > 0
    }));

    if (group.toMembers.length === 0) {
      group.isSkipped = true;
      group.skipReason = '全組人員皆已完成';
      skippedGroups.push(group);
    } else {
      activeGroups.push(group);
    }
  });

  return {
    groups: activeGroups,
    skippedGroups,
    skippedLearners
  };
}

/**
 * 取得催辦通知頁面初始資料
 */
function getMentionInitialData() {
  try {
    const viewerEmail = getCurrentUserEmail();
    if (!canAccessMention_(viewerEmail)) {
      return {
        success: false,
        message: '權限不足：您未被授權操作催辦通知功能，請確認 DASHBOARD_ALLOWED_EMAILS 設定。'
      };
    }

    const context = buildMentionContext_();
    const currentYear = new Date().getFullYear();
    const defaultDeadlineDate = `${currentYear}-08-30`;
    const courseTitle = context.courseTitle || MENTION_CONFIG.defaultCourseTitle;

    return {
      success: true,
      viewerEmail,
      courseTitle,
      defaultDeadlineDate,
      courseUrl: resolveBaseCourseUrl_(''),
      templates: {
        leadership_reminder: buildLeadershipReminderGenericTemplate_(courseTitle),
        org_group_reminder: buildOrgGroupReminderTemplate_(courseTitle)
      },
      excludeDefaults: {
        excludeParentalLeave: true,
        excludeOutsideLocation: true,
        excludeEthicsCommittee: true,
        excludeVendor: true
      }
    };
  } catch (error) {
    console.error('取得催辦初始資料失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

/**
 * 預覽催辦通知信件內容
 */
function previewMentionNotification(payload) {
  try {
    const viewerEmail = getCurrentUserEmail();
    if (!canAccessMention_(viewerEmail)) {
      return {
        success: false,
        message: '權限不足：您未被授權預覽催辦通知。'
      };
    }

    const p = payload || {};
    const templateType = p.templateType;
    const context = buildMentionContext_();
    const courseTitle = context.courseTitle || MENTION_CONFIG.defaultCourseTitle;
    const deadlineDate = p.deadlineDate || `${new Date().getFullYear()}-08-30`;
    const deadlineText = formatChineseDeadlineDate_(deadlineDate);
    const courseUrl = resolveBaseCourseUrl_(p.courseUrl);

    if (templateType === 'leadership_reminder') {
      const selection = selectMentionRecipients_(context, p);
      const firstRecipient = selection.recipients[0] || {
        name: '長官主管',
        email: 'leader@biobank.org.tw',
        assignmentOrgName: '院長室',
        assignmentTitle: '主管',
        statusLabel: '未完成'
      };

      const defaultTpl = p.deliveryMode === 'individual'
        ? buildLeadershipReminderIndividualTemplate_(courseTitle)
        : buildLeadershipReminderGenericTemplate_(courseTitle);

      const sampleSubject = (p.subject || defaultTpl.subject)
        .replace(/\{\{課程名稱\}\}/g, courseTitle)
        .replace(/\{\{修課期限\}\}/g, deadlineText);

      const sampleHtmlBody = (p.htmlBody || defaultTpl.htmlBody)
        .replace(/\{\{姓名\}\}/g, escapeHtml_(firstRecipient.name))
        .replace(/\{\{信箱\}\}/g, escapeHtml_(firstRecipient.email))
        .replace(/\{\{單位\}\}/g, escapeHtml_(firstRecipient.assignmentOrgName || ''))
        .replace(/\{\{職稱\}\}/g, escapeHtml_(firstRecipient.assignmentTitle || ''))
        .replace(/\{\{課程名稱\}\}/g, escapeHtml_(courseTitle))
        .replace(/\{\{修課期限\}\}/g, escapeHtml_(deadlineText))
        .replace(/\{\{訓練狀態\}\}/g, escapeHtml_(firstRecipient.statusLabel || '未完成'))
        .replace(/\{\{上課網址\}\}/g, courseUrl || '#');

      return {
        success: true,
        mode: 'preview',
        templateType,
        courseTitle,
        recipientCount: selection.recipients.length,
        skippedCount: selection.skipped.length,
        recipients: selection.recipients,
        skipped: selection.skipped,
        sampleSubject,
        sampleHtmlBody
      };
    }

    if (templateType === 'org_group_reminder') {
      const selection = selectMentionOrgGroupRecipients_(context, p);
      const defaultTpl = buildOrgGroupReminderTemplate_(courseTitle);

      const groups = selection.groups.map((group) => {
        const incompleteListHtml = buildOrgGroupIncompleteListHtml_(group.toMembers);
        const groupSubject = (p.subject || defaultTpl.subject)
          .replace(/\{\{課程名稱\}\}/g, courseTitle)
          .replace(/\{\{組別名稱\}\}/g, group.orgName)
          .replace(/\{\{修課期限\}\}/g, deadlineText);

        const groupHtmlBody = (p.htmlBody || defaultTpl.htmlBody)
          .replace(/\{\{組別名稱\}\}/g, escapeHtml_(group.orgName))
          .replace(/\{\{課程名稱\}\}/g, escapeHtml_(courseTitle))
          .replace(/\{\{修課期限\}\}/g, escapeHtml_(deadlineText))
          .replace(/\{\{上課網址\}\}/g, courseUrl || '#')
          .replace(/\{\{未完成清單\}\}/g, incompleteListHtml)
          .replace(/\{\{未完成同仁清單\}\}/g, incompleteListHtml)
          .replace(/\{\{未完成名單表格\}\}/g, incompleteListHtml);

        return {
          ...group,
          subject: groupSubject,
          htmlBody: groupHtmlBody
        };
      });

      return {
        success: true,
        mode: 'preview',
        templateType,
        courseTitle,
        totalGroups: groups.length + selection.skippedGroups.length,
        activeGroupsCount: groups.length,
        skippedGroupsCount: selection.skippedGroups.length,
        groups,
        skippedGroups: selection.skippedGroups,
        skippedLearners: selection.skippedLearners
      };
    }

    throw new Error('不支援的催辦範本類型: ' + templateType);
  } catch (error) {
    console.error('催辦通知預覽失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

/**
 * 執行發送催辦通知信件
 */
function executeMentionNotification(payload) {
  try {
    const viewerEmail = getCurrentUserEmail();
    if (!canAccessMention_(viewerEmail)) {
      return {
        success: false,
        message: '權限不足：您未被授權發送催辦通知。'
      };
    }

    const p = payload || {};
    const templateType = p.templateType;
    const context = buildMentionContext_();
    const courseTitle = context.courseTitle || MENTION_CONFIG.defaultCourseTitle;
    const deadlineDate = p.deadlineDate || `${new Date().getFullYear()}-08-30`;
    const deadlineText = formatChineseDeadlineDate_(deadlineDate);
    const courseUrl = resolveBaseCourseUrl_(p.courseUrl);

    const failures = [];
    let sentCount = 0;

    if (templateType === 'leadership_reminder') {
      const selection = selectMentionRecipients_(context, p);
      const deliveryMode = p.deliveryMode || 'individual';
      const defaultTpl = deliveryMode === 'individual'
        ? buildLeadershipReminderIndividualTemplate_(courseTitle)
        : buildLeadershipReminderGenericTemplate_(courseTitle);

      if (deliveryMode === 'individual') {
        selection.recipients.forEach((recipient) => {
          const subject = (p.subject || defaultTpl.subject)
            .replace(/\{\{課程名稱\}\}/g, courseTitle)
            .replace(/\{\{修課期限\}\}/g, deadlineText);

          const templateBody = p.htmlBody || defaultTpl.htmlBody;
          const baseHtmlBody = templateBody
            .replace(/\{\{姓名\}\}/g, escapeHtml_(recipient.name))
            .replace(/\{\{信箱\}\}/g, escapeHtml_(recipient.email))
            .replace(/\{\{單位\}\}/g, escapeHtml_(recipient.assignmentOrgName || ''))
            .replace(/\{\{職稱\}\}/g, escapeHtml_(recipient.assignmentTitle || ''))
            .replace(/\{\{課程名稱\}\}/g, escapeHtml_(courseTitle))
            .replace(/\{\{修課期限\}\}/g, escapeHtml_(deadlineText))
            .replace(/\{\{訓練狀態\}\}/g, escapeHtml_(recipient.statusLabel || '未完成'));

          // 1. 公務信箱發送
          const shadowEmails = resolveMentionShadowEmails_(recipient.email);
          const hasShadow = shadowEmails.length > 0;
          const targetUrl = hasShadow
            ? buildLearnerCapabilityUrl_(courseUrl, courseTitle, recipient.email)
            : (courseUrl || '#');

          const officialHtmlBody = baseHtmlBody.replace(/\{\{上課網址\}\}/g, targetUrl);
          try {
            if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
              MailApp.sendEmail({
                to: recipient.email,
                subject,
                htmlBody: officialHtmlBody
              });
            }
            sentCount += 1;
          } catch (err) {
            failures.push({ email: recipient.email, name: recipient.name, error: err.message });
          }

          // 2. 影子副信箱（單獨寄送專屬 HMAC Capability URL 直達連結）
          if (hasShadow) {
            const noticeBanner = buildShadowForwardingNoticeHtml_(recipient.name);
            const shadowHtmlBody = injectCapabilityUrlIntoHtmlBody_(baseHtmlBody, targetUrl, noticeBanner);

            shadowEmails.forEach((shadowEmail) => {
              try {
                if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
                  MailApp.sendEmail({
                    to: shadowEmail,
                    subject,
                    htmlBody: shadowHtmlBody
                  });
                }
              } catch (shadowErr) {
                console.warn('長官影子信箱轉派失敗 (' + shadowEmail + '):', shadowErr);
              }
            });
          }
        });
      } else {
        // single_bcc 或 direct
        const allTo = selection.recipients.map((r) => r.email);
        const subject = (p.subject || defaultTpl.subject)
          .replace(/\{\{課程名稱\}\}/g, courseTitle)
          .replace(/\{\{修課期限\}\}/g, deadlineText);

        const templateBody = p.htmlBody || defaultTpl.htmlBody;
        const officialHtmlBody = templateBody
          .replace(/\{\{課程名稱\}\}/g, escapeHtml_(courseTitle))
          .replace(/\{\{修課期限\}\}/g, escapeHtml_(deadlineText))
          .replace(/\{\{上課網址\}\}/g, courseUrl || '#');

        try {
          if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
            if (deliveryMode === 'single_bcc') {
              MailApp.sendEmail({
                to: viewerEmail || allTo[0] || '',
                bcc: allTo.join(','),
                subject,
                htmlBody: officialHtmlBody
              });
            } else {
              MailApp.sendEmail({
                to: allTo.join(','),
                subject,
                htmlBody: officialHtmlBody
              });
            }
          }
          sentCount = selection.recipients.length;
        } catch (err) {
          failures.push({ error: err.message });
        }

        // 針對具影子信箱之長官個別派發專屬免登入連結
        selection.recipients.forEach((recipient) => {
          const shadowEmails = resolveMentionShadowEmails_(recipient.email);
          if (shadowEmails.length > 0) {
            const capabilityUrl = buildLearnerCapabilityUrl_(courseUrl, courseTitle, recipient.email);
            const noticeBanner = buildShadowForwardingNoticeHtml_(recipient.name);
            const baseTpl = templateBody
              .replace(/\{\{姓名\}\}/g, escapeHtml_(recipient.name))
              .replace(/\{\{信箱\}\}/g, escapeHtml_(recipient.email))
              .replace(/\{\{單位\}\}/g, escapeHtml_(recipient.assignmentOrgName || ''))
              .replace(/\{\{職稱\}\}/g, escapeHtml_(recipient.assignmentTitle || ''))
              .replace(/\{\{課程名稱\}\}/g, escapeHtml_(courseTitle))
              .replace(/\{\{修課期限\}\}/g, escapeHtml_(deadlineText))
              .replace(/\{\{訓練狀態\}\}/g, escapeHtml_(recipient.statusLabel || '未完成'));
            const shadowHtmlBody = injectCapabilityUrlIntoHtmlBody_(baseTpl, capabilityUrl, noticeBanner);

            shadowEmails.forEach((shadowEmail) => {
              try {
                if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
                  MailApp.sendEmail({
                    to: shadowEmail,
                    subject,
                    htmlBody: shadowHtmlBody
                  });
                }
              } catch (shadowErr) {
                console.warn('長官影子信箱轉派失敗 (' + shadowEmail + '):', shadowErr);
              }
            });
          }
        });
      }

      appendMentionNotificationLog_({
        operatorEmail: viewerEmail,
        courseTitle,
        templateType,
        deliveryMode,
        payload: p,
        recipientCount: selection.recipients.length,
        sentCount,
        failureCount: failures.length
      });

      return {
        success: true,
        mode: 'send',
        templateType,
        sentCount,
        failureCount: failures.length,
        failures
      };
    }

    if (templateType === 'org_group_reminder') {
      const preview = previewMentionNotification(p);
      if (!preview.success) throw new Error(preview.message || '群組範本生成失敗');

      let targetGroups = preview.groups || [];
      if (p.selectedGroupCodes && Array.isArray(p.selectedGroupCodes)) {
        if (p.selectedGroupCodes.length === 0) {
          throw new Error('未選取任何要發送的組別，發送作業已取消');
        }
        const selectedSet = new Set(p.selectedGroupCodes.map((c) => String(c).trim()));
        targetGroups = targetGroups.filter((g) => selectedSet.has(String(g.orgCode).trim()));
        if (targetGroups.length === 0) {
          throw new Error('所選取的組別皆無待催辦人員或不存在，沒有可發送的組別');
        }
      }

      targetGroups.forEach((group) => {
        // 1. 公務群組信件 (嚴格排除私人 Gmail，避免個資外洩)
        const toEmails = group.toMembers.map((m) => m.email);
        const ccEmails = group.ccMembers.map((m) => m.email);

        try {
          if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
            const mailOptions = {
              to: toEmails.join(','),
              subject: group.subject,
              htmlBody: group.htmlBody
            };
            if (ccEmails.length > 0) {
              mailOptions.cc = ccEmails.join(',');
            }
            MailApp.sendEmail(mailOptions);
          }
          sentCount += 1;
        } catch (err) {
          failures.push({ orgCode: group.orgCode, orgName: group.orgName, error: err.message });
        }

        // 2. 影子信箱精準轉派 (專屬 HMAC-SHA256 直達免登入連結)
        // A) 未完課同仁專屬直達轉派
        group.toMembers.forEach((member) => {
          const shadowEmails = resolveMentionShadowEmails_(member.email);
          if (shadowEmails.length > 0) {
            const capUrl = buildLearnerCapabilityUrl_(courseUrl, courseTitle, member.email);
            const noticeBanner = buildShadowForwardingNoticeHtml_(member.name);
            const shadowBody = injectCapabilityUrlIntoHtmlBody_(group.htmlBody, capUrl, noticeBanner);

            shadowEmails.forEach((shadowEmail) => {
              try {
                if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
                  MailApp.sendEmail({
                    to: shadowEmail,
                    subject: group.subject,
                    htmlBody: shadowBody
                  });
                }
              } catch (shadowErr) {
                console.warn('同仁影子信箱轉派失敗 (' + shadowEmail + '):', shadowErr);
              }
            });
          }
        });

        // B) 主管督導專屬轉派 (若組長/副組長亦有影子信箱，無論完課與否皆配發其專屬連結)
        group.ccMembers.forEach((lead) => {
          const shadowEmails = resolveMentionShadowEmails_(lead.email);
          if (shadowEmails.length > 0) {
            const capUrl = buildLearnerCapabilityUrl_(courseUrl, courseTitle, lead.email);
            const noticeBanner = buildShadowForwardingNoticeHtml_(lead.name + ' (組長/主管)');
            const shadowBody = injectCapabilityUrlIntoHtmlBody_(group.htmlBody, capUrl, noticeBanner);

            shadowEmails.forEach((shadowEmail) => {
              try {
                if (typeof MailApp !== 'undefined' && MailApp.sendEmail) {
                  MailApp.sendEmail({
                    to: shadowEmail,
                    subject: group.subject,
                    htmlBody: shadowBody
                  });
                }
              } catch (shadowErr) {
                console.warn('主管影子信箱轉派失敗 (' + shadowEmail + '):', shadowErr);
              }
            });
          }
        });
      });


      appendMentionNotificationLog_({
        operatorEmail: viewerEmail,
        courseTitle,
        templateType,
        deliveryMode: 'group',
        payload: p,
        recipientCount: targetGroups.length,
        sentCount,
        failureCount: failures.length
      });

      const isAllFailed = targetGroups.length > 0 && sentCount === 0;
      return {
        success: !isAllFailed,
        mode: 'send',
        templateType,
        sentGroupsCount: sentCount,
        failureCount: failures.length,
        failures,
        message: isAllFailed
          ? `發送失敗：所選 ${targetGroups.length} 個組別皆未能成功寄出信件。${failures[0] ? failures[0].error : ''}`
          : (failures.length > 0 ? `部分發送成功：成功 ${sentCount} 組，失敗 ${failures.length} 組。` : '全數發送成功')
      };
    }

    throw new Error('不支援的催辦範本類型: ' + templateType);
  } catch (error) {
    console.error('執行發送催辦通知失敗:', error);
    return {
      success: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

/**
 * 寫入催辦通知紀錄至試算表
 */
function appendMentionNotificationLog_(entry) {
  try {
    let ss = null;
    if (typeof SpreadsheetApp !== 'undefined') {
      ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss && typeof getMasterSpreadsheet_ === 'function') {
        ss = getMasterSpreadsheet_();
      }
    }
    if (!ss) return;

    const sheetName = MENTION_CONFIG.notificationLogSheetName;
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow([
        '時間戳記', '操作者', '課程名稱', '範本類型', '寄送方式',
        '篩選條件', '收件人數/組數', '成功發送數', '失敗數'
      ]);
    }

    const exclusions = [];
    if (entry.payload && entry.payload.excludeParentalLeave) exclusions.push('排除育嬰假');
    if (entry.payload && entry.payload.excludeOutsideLocation) exclusions.push('排除outside');
    if (entry.payload && entry.payload.excludeEthicsCommittee) exclusions.push('排除倫理委員會');
    if (entry.payload && entry.payload.excludeVendor) exclusions.push('排除委外廠商');
    const filterSummary = exclusions.length > 0 ? exclusions.join('、') : '無排除';

    const timestamp = (typeof Utilities !== 'undefined' && Utilities.formatDate)
      ? Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss')
      : new Date().toISOString();

    sheet.appendRow([
      timestamp,
      entry.operatorEmail || '',
      entry.courseTitle || '',
      entry.templateType || '',
      entry.deliveryMode || '',
      filterSummary,
      Number(entry.recipientCount || 0),
      Number(entry.sentCount || 0),
      Number(entry.failureCount || 0)
    ]);

    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
      SpreadsheetApp.flush();
    }
  } catch (err) {
    console.error('寫入通知紀錄失敗:', err);
  }
}

/**
 * 手動授權觸發函式 (僅供管理員在 Apps Script 線上編輯器手動執行一次以取得 MailApp 權限)
 * 執行時會觸發 Google OAuth 授權流程，包含 https://www.googleapis.com/auth/script.send_mail 權限。
 * 授權完畢後即可正常透過 Web App 發送催辦通知信。
 *
 * @returns {number} 當前帳號今日剩餘寄信配額
 */
function authorizeMailAppScope() {
  const remainingQuota = MailApp.getRemainingDailyQuota();
  Logger.log('MailApp 授權成功！剩餘每日寄信額度: ' + remainingQuota);
  return remainingQuota;
}
