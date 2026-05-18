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

// 1. 發佈為 Web App 時的進入點
function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
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

function getCurrentUserProfile() {
  const fallbackEmail = getCurrentUserEmail();

  try {
    const context = buildHomeProfileContext_(fallbackEmail);

    return {
      success: true,
      email: context.viewer.email,
      name: context.viewer.name,
      assignments: context.assignments,
      managedStations: context.managedStations,
      isStationManager: context.viewer.isStationManager,
      isStationStaff: context.viewer.isStationStaff,
      canEditStationAssignments: context.viewer.canEditStationAssignments
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

  return {
    viewer: {
      email: normalizedViewerEmail,
      name: viewerName,
      isStationManager: managedStations.length > 0,
      isStationStaff: selfAssignments.length > 0,
      canEditStationAssignments: managedStations.length > 0 || selfAssignments.length > 0
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
  const canEditStationAssignments = isStationManager || isStationStaff;
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
  const assignmentEmail = normalizeEmail_(assignment.email);
  if (assignmentEmail === viewerEmail) return;
  if (viewerIsStationManager) return;
  throw new Error('您沒有刪除此駐站收案配置的權限。');
}

function assertCanMoveStationAssignment_(assignment, targetStation, viewerEmail, viewerIsStationManager) {
  const assignmentEmail = normalizeEmail_(assignment.email);
  if (assignmentEmail === viewerEmail) return;

  if (viewerIsStationManager) return;
  throw new Error('您沒有搬移此駐站收案配置的權限。');
}

function assertCanAddStationAssignment_(targetEmail, station, viewerEmail, viewerIsStationManager, candidateEmailSet) {
  if (!candidateEmailSet.has(targetEmail)) {
    throw new Error('只能新增既有站務人員到駐站。');
  }

  if (targetEmail === viewerEmail) return;
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
  return normalizeOrgCode_(stationCode).startsWith('GRP-CO-EX-') ? '委外廠商' : '在職';
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
