const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LOG_HEADERS = [
  '批次ID', '唯一鍵', '課程名稱', '姓名', '使用者信箱', '完成日期',
  '收件人信箱', '附件檔名', '狀態', '操作者', '建立時間', '寄送時間',
  '最後更新時間', '錯誤訊息'
];
const IMPORT_HEADERS = [
  'course_title', 'category_id', 'category_title', 'name', 'instName',
  'certified_hour', 'certified_date', 'year', 'sso', 'tel', 'title',
  'mail', 'typez', 'certNo'
];
const TEMPLATE_PART_NAMES = [
  'xl/comments1.xml',
  'xl/_rels/comments1.xml.rels',
  'xl/drawings/vmlDrawing1.vml',
  'xl/drawings/drawing1.xml',
  'xl/drawings/drawing2.xml',
  'xl/drawings/drawing3.xml',
  'xl/worksheets/sheet1.xml',
  'xl/worksheets/_rels/sheet1.xml.rels',
  'xl/worksheets/sheet2.xml',
  'xl/worksheets/_rels/sheet2.xml.rels',
  'xl/worksheets/sheet3.xml',
  'xl/worksheets/_rels/sheet3.xml.rels',
  'docProps/core.xml',
  'xl/theme/theme1.xml',
  'xl/sharedStrings.xml',
  'xl/styles.xml',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  '_rels/.rels',
  'xl/metadata',
  'xl/commentsmeta0',
  '[Content_Types].xml'
];

class MockBlob {
  constructor(data, contentType, name, parts, byteLength) {
    this.data = data;
    this.contentType = contentType || '';
    this.name = name || '';
    this.parts = parts || null;
    this.byteLength = byteLength === undefined
      ? Buffer.byteLength(String(data || ''))
      : byteLength;
  }

  getName() {
    return this.name;
  }

  getContentType() {
    return this.contentType;
  }

  getDataAsString() {
    return String(this.data || '');
  }

  getBytes() {
    return { length: this.byteLength };
  }

  setName(name) {
    this.name = name;
    return this;
  }

  setContentType(contentType) {
    this.contentType = contentType;
    return this;
  }
}

function buildWorksheetXml() {
  const rows = [];
  for (let rowNumber = 1; rowNumber <= 1000; rowNumber += 1) {
    const cells = IMPORT_HEADERS.map((header, columnIndex) => {
      const columnName = String.fromCharCode(65 + columnIndex);
      if (rowNumber === 1) {
        return `<c r="${columnName}1" t="s"><v>${columnIndex}</v></c>`;
      }
      return `<c r="${columnName}${rowNumber}" s="1"/>`;
    }).join('');
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  }
  return `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

function buildTemplatePart(name) {
  if (name === 'xl/workbook.xml') {
    return '<workbook><sheets>' + [
      '<sheet name="表1-匯入資料填寫區" sheetId="1" r:id="rId1"/>',
      '<sheet name="表2-此為範例說明(勿在此頁輸入資料)" sheetId="2" r:id="rId2"/>',
      '<sheet name="表3-對應清單(參考用)" sheetId="3" r:id="rId3"/>'
    ].join('') + '</sheets></workbook>';
  }
  if (name === 'xl/_rels/workbook.xml.rels') {
    return '<Relationships>' + [1, 2, 3].map((number) =>
      `<Relationship Id="rId${number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${number}.xml"/>`
    ).join('') + '</Relationships>';
  }
  if (name === 'xl/sharedStrings.xml') {
    return '<sst>' + IMPORT_HEADERS.map((header) => `<si><t>${header}</t></si>`).join('') + '</sst>';
  }
  if (name === 'xl/worksheets/sheet1.xml') return buildWorksheetXml();
  return '<part/>';
}

function buildTemplateParts() {
  return TEMPLATE_PART_NAMES.map((name) => new MockBlob(
    buildTemplatePart(name),
    'application/xml',
    name
  ));
}

const sandbox = {
  currentEmail: '',
  properties: {},
  eventOrder: [],
  sentMessages: [],
  remainingQuota: 100,
  throwOnMail: false,
  throwOnSentStatusUpdate: false,
  throwOnZipCall: 0,
  zipCallCount: 0,
  uuidCounter: 0,
  lockReleased: false,
  masterSpreadsheet: null,
  activeSpreadsheet: null
};

function cloneRows(rows) {
  return (rows || []).map((row) => row.slice());
}

class MockSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = cloneRows(rows);
  }

  getLastRow() {
    return this.rows.length;
  }

  getDataRange() {
    return {
      getDisplayValues: () => cloneRows(this.rows),
      getValues: () => cloneRows(this.rows)
    };
  }

  appendRow(row) {
    sandbox.eventOrder.push('appendRow');
    this.rows.push(row.slice());
    return this;
  }

  getRange(startRow, startColumn, rowCount, columnCount) {
    return {
      getDisplayValues: () => {
        const values = [];
        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
          const sourceRow = this.rows[startRow - 1 + rowOffset] || [];
          values.push(sourceRow.slice(startColumn - 1, startColumn - 1 + columnCount));
        }
        return values;
      },
      getValues: () => {
        const values = [];
        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
          const sourceRow = this.rows[startRow - 1 + rowOffset] || [];
          values.push(sourceRow.slice(startColumn - 1, startColumn - 1 + columnCount));
        }
        return values;
      },
      setValues: (values) => {
        sandbox.eventOrder.push('setValues');
        const isSentStatusUpdate = this.name === '訓練匯出紀錄'
          && values.some((row) => row[8] === '已寄出');
        if (isSentStatusUpdate && sandbox.throwOnSentStatusUpdate) {
          throw new Error('模擬寄送成功後台帳更新失敗');
        }
        values.forEach((valueRow, rowOffset) => {
          const targetRowIndex = startRow - 1 + rowOffset;
          while (this.rows.length <= targetRowIndex) this.rows.push([]);
          const targetRow = this.rows[targetRowIndex];
          for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
            targetRow[startColumn - 1 + columnOffset] = valueRow[columnOffset];
          }
        });
        return this;
      }
    };
  }
}

class MockSpreadsheet {
  constructor(rowsByName) {
    this.sheets = {};
    Object.keys(rowsByName || {}).forEach((name) => {
      this.sheets[name] = new MockSheet(name, rowsByName[name]);
    });
  }

  getSheetByName(name) {
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    sandbox.eventOrder.push('insertSheet');
    if (this.sheets[name]) throw new Error('工作表已存在');
    const sheet = new MockSheet(name, []);
    this.sheets[name] = sheet;
    return sheet;
  }
}

function qualifiedRows(emails) {
  return {
    trainingRows: [[
      '時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果'
    ]].concat(emails.map((email, index) => [
      `2026/09/0${index + 1} 09:00:00`, '', email, '課程甲', '80', '通過'
    ])),
    progressRows: [[
      '使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間'
    ]].concat(emails.map((email, index) => [
      email, '課程甲', 'video-1', '', '3600', '', `2026/09/0${index + 1} 10:00:00`
    ]))
  };
}

function resetFixtures(options) {
  const settings = options || {};
  const learnerRows = [
    ['learner1@example.org', '張學員甲', '在勤', '', '', '', '', ''],
    ['learner2@example.org', '陳學員乙', '育嬰假', '', '', '', '', ''],
    ['learner3@example.org', '林學員丙', '倫理委員會', '', '', '', '', ''],
    ['learner4@example.org', '黃學員丁', '在勤', '', '', '', '', 'outside']
  ];
  const qualified = qualifiedRows(learnerRows.map((row) => row[0]));
  sandbox.currentEmail = settings.currentEmail === undefined ? 'admin@example.org' : settings.currentEmail;
  sandbox.properties = {
    DASHBOARD_ALLOWED_EMAILS: 'admin@example.org',
    TRAINING_IMPORT_RECIPIENT_EMAIL: ' Receiver@Example.org ',
    TRAINING_IMPORT_TEMPLATE_FILE_ID: ' template-file-id '
  };
  sandbox.eventOrder = [];
  sandbox.sentMessages = [];
  sandbox.remainingQuota = 100;
  sandbox.throwOnMail = false;
  sandbox.throwOnSentStatusUpdate = false;
  sandbox.throwOnZipCall = 0;
  sandbox.zipCallCount = 0;
  sandbox.uuidCounter = 0;
  sandbox.lockReleased = false;
  sandbox.masterSpreadsheet = new MockSpreadsheet({
    人員主檔: [
      ['信箱', '姓名', '人員狀態', '', '', '', '', '工作地點'],
      ['admin@example.org', '王管理', '在勤', '', '', '', '', ''],
      ['receiver@example.org', '李承辦', '在勤', '', '', '', '', '']
    ].concat(learnerRows),
    組織架構樹: [['類型', '層級', '代碼', '名稱', '別名', '父代碼', '主管信箱', '主管姓名']]
  });
  const activeRows = {
    人員職務配置: [['使用者信箱', '姓名', '組織代碼', '組織名稱', '職稱', '類型']],
    訓練紀錄: qualified.trainingRows,
    觀看進度: qualified.progressRows
  };
  if (settings.logRows) activeRows.訓練匯出紀錄 = settings.logRows;
  sandbox.activeSpreadsheet = new MockSpreadsheet(activeRows);
}

class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : ['2026-09-11T08:00:00+08:00']));
  }
}
FixedDate.now = () => new Date('2026-09-11T08:00:00+08:00').getTime();
FixedDate.parse = Date.parse;
FixedDate.UTC = Date.UTC;

const Session = {
  getActiveUser() {
    return { getEmail: () => sandbox.currentEmail };
  }
};

const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        return Object.prototype.hasOwnProperty.call(sandbox.properties, key)
          ? sandbox.properties[key]
          : null;
      }
    };
  }
};

const SpreadsheetApp = {
  openById() {
    return sandbox.masterSpreadsheet;
  },
  getActiveSpreadsheet() {
    return sandbox.activeSpreadsheet;
  },
  flush() {
    sandbox.eventOrder.push('flush');
  }
};

const DriveApp = {
  getFileById(fileId) {
    assert.strictEqual(fileId, 'template-file-id');
    return {
      getMimeType: () => XLSX_MIME,
      getSize: () => 59 * 1024,
      getBlob: () => new MockBlob('', XLSX_MIME, 'source-template.xlsx', buildTemplateParts(), 59 * 1024)
    };
  }
};

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest(algorithm, value, charset) {
    assert.strictEqual(algorithm, 'SHA_256');
    assert.strictEqual(charset, 'UTF_8');
    return Array.from(crypto.createHash('sha256').update(value, 'utf8').digest())
      .map((byte) => byte > 127 ? byte - 256 : byte);
  },
  formatDate(value, timeZone, pattern) {
    assert.strictEqual(timeZone, 'Asia/Taipei');
    const taipei = new Date(value.getTime() + 8 * 60 * 60 * 1000);
    if (pattern === 'yyyy-MM-dd') {
      return [
        taipei.getUTCFullYear(),
        String(taipei.getUTCMonth() + 1).padStart(2, '0'),
        String(taipei.getUTCDate()).padStart(2, '0')
      ].join('-');
    }
    assert.strictEqual(pattern, 'yyyy/MM/dd HH:mm:ss');
    return [
      taipei.getUTCFullYear(),
      String(taipei.getUTCMonth() + 1).padStart(2, '0'),
      String(taipei.getUTCDate()).padStart(2, '0')
    ].join('/') + ' ' + [
      String(taipei.getUTCHours()).padStart(2, '0'),
      String(taipei.getUTCMinutes()).padStart(2, '0'),
      String(taipei.getUTCSeconds()).padStart(2, '0')
    ].join(':');
  },
  getUuid() {
    sandbox.uuidCounter += 1;
    return 'batch-' + sandbox.uuidCounter;
  },
  unzip(blob) {
    return blob.parts || [];
  },
  newBlob(data, contentType, name) {
    return new MockBlob(data, contentType, name);
  },
  zip(parts, filename) {
    sandbox.zipCallCount += 1;
    if (sandbox.throwOnZipCall === sandbox.zipCallCount) {
      throw new Error('模擬附件產製失敗');
    }
    return new MockBlob('', 'application/zip', filename, parts, 59 * 1024);
  }
};

const MailApp = {
  getRemainingDailyQuota() {
    return sandbox.remainingQuota;
  },
  sendEmail(options) {
    sandbox.eventOrder.push('sendEmail');
    if (sandbox.throwOnMail) throw new Error('模擬 MailApp 失敗');
    sandbox.sentMessages.push(options);
  }
};

const LockService = {
  getScriptLock() {
    return {
      waitLock(timeoutMs) {
        assert.strictEqual(timeoutMs, 10000);
        sandbox.eventOrder.push('waitLock');
      },
      releaseLock() {
        sandbox.eventOrder.push('releaseLock');
        sandbox.lockReleased = true;
      }
    };
  }
};

const ENV = { MASTER_SHEET_ID: 'master-sheet-id' };
const code = fs.readFileSync('code.js', 'utf8');
const load = new Function(
  'Session',
  'PropertiesService',
  'SpreadsheetApp',
  'DriveApp',
  'Utilities',
  'MailApp',
  'LockService',
  'ENV',
  'Date',
  'process',
  `${code}; return {
    previewTrainingImportEmail,
    executeTrainingImportEmail,
    getOrCreateTrainingImportLogSheet_,
    reserveTrainingImportBatch_,
    updateTrainingImportBatchStatus_,
    parseTrainingImportSharedStrings_,
    parseTrainingImportRowValues_
  };`
);

const api = load(
  Session,
  PropertiesService,
  SpreadsheetApp,
  DriveApp,
  Utilities,
  MailApp,
  LockService,
  ENV,
  FixedDate,
  undefined
);

function getLogRows() {
  const logSheet = sandbox.activeSpreadsheet.getSheetByName('訓練匯出紀錄');
  return logSheet ? logSheet.rows : [];
}

function readAttachmentRows(attachment) {
  const partMap = new Map(Utilities.unzip(attachment).map((part) => [part.getName(), part]));
  const sheetXml = partMap.get('xl/worksheets/sheet1.xml').getDataAsString();
  const sharedStrings = api.parseTrainingImportSharedStrings_(
    partMap.get('xl/sharedStrings.xml').getDataAsString()
  );
  const rows = [];
  for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
    const row = api.parseTrainingImportRowValues_(sheetXml, rowNumber, sharedStrings);
    if (row.some((value) => String(value || '') !== '')) rows.push(row);
  }
  return rows;
}

resetFixtures();
const preview = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
assert.strictEqual(preview.success, true);
sandbox.eventOrder = [];
const result = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: preview.previewHash,
  recipientEmail: 'attacker@example.org',
  rows: [['attacker-controlled']]
});
assert.strictEqual(result.success, true);
assert.strictEqual(result.batchId, 'batch-1');
assert.strictEqual(result.sentCount, 4);
assert.strictEqual(result.attachmentName, 'importtemplate_v20260911.xlsx');
assert.match(result.message, /寄送/);
assert.strictEqual(sandbox.sentMessages.length, 1);
assert.strictEqual(sandbox.sentMessages[0].to, 'receiver@example.org');
assert.strictEqual(sandbox.sentMessages[0].attachments.length, 1);
assert.strictEqual(sandbox.sentMessages[0].attachments[0].getName(), 'importtemplate_v20260911.xlsx');
const snapshotRowsInAttachment = readAttachmentRows(sandbox.sentMessages[0].attachments[0]);
assert.strictEqual(snapshotRowsInAttachment.length, 4);
assert(snapshotRowsInAttachment.every((row) => row[11].endsWith('@example.org')));
assert.deepStrictEqual(getLogRows()[0], LOG_HEADERS);
const logRowsForBatch = getLogRows().filter((row) => row[0] === result.batchId);
assert.strictEqual(logRowsForBatch.length, 4);
assert(logRowsForBatch.every((row) => row[8] === '已寄出'));
assert(logRowsForBatch.every((row) => row[0] === 'batch-1'));
assert.strictEqual(new Set(logRowsForBatch.map((row) => row[1])).size, 4);
const lastReservationIndex = sandbox.eventOrder.lastIndexOf('appendRow');
const reservationFlushIndex = sandbox.eventOrder.indexOf('flush', lastReservationIndex);
const sendIndex = sandbox.eventOrder.indexOf('sendEmail');
assert(lastReservationIndex >= 0);
assert(reservationFlushIndex > lastReservationIndex);
assert(reservationFlushIndex < sendIndex);
assert.strictEqual(sandbox.eventOrder[sandbox.eventOrder.length - 1], 'releaseLock');
assert.strictEqual(sandbox.lockReleased, true);

const freshPreviewAfterSuccess = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
assert.strictEqual(freshPreviewAfterSuccess.success, false);
const duplicateResult = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: freshPreviewAfterSuccess.previewHash
});
assert.strictEqual(duplicateResult.success, false);
assert.strictEqual(sandbox.sentMessages.length, 1);
assert.strictEqual(getLogRows().length, 5);

resetFixtures();
const staleResult = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: '0'.repeat(64)
});
assert.strictEqual(staleResult.success, false);
assert.match(staleResult.message, /預覽資料已變動/);
assert.strictEqual(sandbox.activeSpreadsheet.getSheetByName('訓練匯出紀錄'), null);
assert.strictEqual(sandbox.sentMessages.length, 0);
assert.strictEqual(sandbox.lockReleased, true);

resetFixtures();
const previewBeforeConcurrentReservation = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
const concurrentKey = '課程甲\nlearner1@example.org';
const concurrentRow = [
  'other-batch', concurrentKey, '課程甲', '張學員甲', 'learner1@example.org',
  '2026-09-01', 'receiver@example.org', 'old.xlsx', '準備寄送',
  'other@example.org', '2026/09/11 07:59:59', '', '2026/09/11 07:59:59', ''
];
sandbox.activeSpreadsheet.sheets.訓練匯出紀錄 = new MockSheet(
  '訓練匯出紀錄',
  [LOG_HEADERS, concurrentRow]
);
sandbox.eventOrder = [];
const concurrentResult = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: previewBeforeConcurrentReservation.previewHash
});
assert.strictEqual(concurrentResult.success, false);
assert.match(concurrentResult.message, /預覽資料已變動/);
assert.strictEqual(getLogRows().filter((row) => row[1] === concurrentKey).length, 1);
assert.strictEqual(sandbox.eventOrder.includes('appendRow'), false);
assert.strictEqual(sandbox.sentMessages.length, 0);
assert.strictEqual(sandbox.lockReleased, true);

resetFixtures();
const previewBeforeMailFailure = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
sandbox.throwOnMail = true;
const mailFailure = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: previewBeforeMailFailure.previewHash
});
assert.strictEqual(mailFailure.success, false);
assert.match(mailFailure.message, /MailApp/);
const failedBatchRows = getLogRows().filter((row) => row[0] === mailFailure.batchId);
assert.strictEqual(failedBatchRows.length, 4);
assert(failedBatchRows.every((row) => row[8] === '寄送失敗'));
assert(failedBatchRows.every((row) => row[13].includes('MailApp')));
assert.strictEqual(sandbox.sentMessages.length, 0);
sandbox.throwOnMail = false;
const retryPreview = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
assert.strictEqual(retryPreview.success, true);
assert.strictEqual(retryPreview.rows.length, 4);
assert.strictEqual(retryPreview.retryableFailureCount, 4);
assert.strictEqual(sandbox.lockReleased, true);

resetFixtures();
const previewBeforeAcceptedMail = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
sandbox.throwOnSentStatusUpdate = true;
const acceptedButUnlogged = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: previewBeforeAcceptedMail.previewHash
});
assert.strictEqual(acceptedButUnlogged.success, false);
assert.match(acceptedButUnlogged.message, /台帳更新失敗/);
assert.strictEqual(sandbox.sentMessages.length, 1);
const preparingRows = getLogRows().filter((row) => row[0] === acceptedButUnlogged.batchId);
assert.strictEqual(preparingRows.length, 4);
assert(preparingRows.every((row) => row[8] === '準備寄送'));
sandbox.throwOnSentStatusUpdate = false;
const previewAfterAcceptedMail = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
assert.strictEqual(previewAfterAcceptedMail.success, false);
const acceptedRetry = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: previewBeforeAcceptedMail.previewHash
});
assert.strictEqual(acceptedRetry.success, false);
assert.strictEqual(sandbox.sentMessages.length, 1);
assert.strictEqual(sandbox.lockReleased, true);

resetFixtures();
const previewBeforeQuotaCheck = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
sandbox.remainingQuota = 0;
sandbox.eventOrder = [];
const quotaFailure = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: previewBeforeQuotaCheck.previewHash
});
assert.strictEqual(quotaFailure.success, false);
assert.match(quotaFailure.message, /配額不足/);
assert.strictEqual(sandbox.activeSpreadsheet.getSheetByName('訓練匯出紀錄'), null);
assert.strictEqual(sandbox.eventOrder.includes('appendRow'), false);
assert.strictEqual(sandbox.sentMessages.length, 0);
assert.strictEqual(sandbox.lockReleased, true);

resetFixtures();
const previewBeforeBuildFailure = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
sandbox.throwOnZipCall = sandbox.zipCallCount + 2;
const buildFailure = api.executeTrainingImportEmail({
  courseTitle: '課程甲',
  previewHash: previewBeforeBuildFailure.previewHash
});
assert.strictEqual(buildFailure.success, false);
assert.match(buildFailure.message, /附件產製失敗/);
const buildFailureRows = getLogRows().filter((row) => row[0] === buildFailure.batchId);
assert.strictEqual(buildFailureRows.length, 4);
assert(buildFailureRows.every((row) => row[8] === '寄送失敗'));
assert.strictEqual(sandbox.sentMessages.length, 0);
assert.strictEqual(sandbox.lockReleased, true);

resetFixtures({ currentEmail: 'intruder@example.org' });
const denied = api.executeTrainingImportEmail({ courseTitle: '課程甲', previewHash: 'anything' });
assert.strictEqual(denied.success, false);
assert.match(denied.message, /未被授權/);
assert.strictEqual(sandbox.sentMessages.length, 0);
assert.strictEqual(sandbox.eventOrder.includes('waitLock'), false);

console.log('Training import send tests passed.');
