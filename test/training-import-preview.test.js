const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const templateByteLength = 59 * 1024;
const importHeaders = [
  'course_title', 'category_id', 'category_title', 'name', 'instName',
  'certified_hour', 'certified_date', 'year', 'sso', 'tel', 'title',
  'mail', 'typez', 'certNo'
];
const partNames = [
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
    this.byteLength = byteLength === undefined ? Buffer.byteLength(String(data || '')) : byteLength;
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
    const cells = importHeaders.map((header, columnIndex) => {
      const columnName = String.fromCharCode(65 + columnIndex);
      if (rowNumber === 1) return `<c r="${columnName}1" t="s"><v>${columnIndex}</v></c>`;
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
    return '<sst>' + importHeaders.map((header) => `<si><t>${header}</t></si>`).join('') + '</sst>';
  }
  if (name === 'xl/worksheets/sheet1.xml') return buildWorksheetXml();
  return '<part/>';
}

const validTemplateParts = partNames.map((name) => new MockBlob(
  buildTemplatePart(name),
  'application/xml',
  name
));

function createSheet(rows) {
  return {
    getLastRow() {
      return rows.length;
    },
    getDataRange() {
      return {
        getDisplayValues() {
          return rows.map((row) => row.slice());
        }
      };
    }
  };
}

function createSpreadsheet(sheetRowsByName) {
  return {
    getSheetByName(name) {
      const rows = sheetRowsByName[name];
      return rows ? createSheet(rows) : null;
    }
  };
}

const sandbox = {
  currentEmail: '',
  properties: {},
  masterSheets: {},
  activeSheets: {},
  templateMimeType: XLSX_MIME,
  templateSize: templateByteLength,
  generatedSize: templateByteLength,
  invalidTemplate: false
};

function qualifiedRows(emails) {
  return {
    trainingRows: [[
      '時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果'
    ]].concat(emails.map((email, index) => [
      `2026/09/${String(index % 9 + 1).padStart(2, '0')} 09:00:00`,
      '',
      email,
      '課程甲',
      '80',
      '通過'
    ]), [[
      '2026/09/10 09:00:00', '', 'quiz-only@example.org', '只有測驗', '90', '通過'
    ]]),
    progressRows: [[
      '使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間'
    ]].concat(emails.map((email, index) => [
      email,
      '課程甲',
      'video-1',
      '',
      '3600',
      '',
      `2026/09/${String(index % 9 + 1).padStart(2, '0')} 10:00:00`
    ]), [[
      'watch-only@example.org', '只有觀看', 'video-1', '', '3600', '', '2026/09/11 10:00:00'
    ]])
  };
}

function resetFixtures() {
  const learnerRows = [
    ['learner1@example.org', '張學員甲', '在勤', '', '', '', '', ''],
    ['learner2@example.org', '陳學員乙', '育嬰假', '', '', '', '', ''],
    ['learner3@example.org', '林學員丙', '倫理委員會', '', '', '', '', ''],
    ['learner4@example.org', '黃學員丁', '在勤', '', '', '', '', 'outside']
  ];
  const qualified = qualifiedRows(learnerRows.map((row) => row[0]));
  sandbox.currentEmail = '';
  sandbox.properties = {
    DASHBOARD_ALLOWED_EMAILS: 'admin@example.org',
    TRAINING_IMPORT_RECIPIENT_EMAIL: ' Receiver@Example.org ',
    TRAINING_IMPORT_TEMPLATE_FILE_ID: ' template-file-id '
  };
  sandbox.masterSheets = {
    人員主檔: [
      ['信箱', '姓名', '人員狀態', '', '', '', '', '工作地點'],
      ['admin@example.org', '王管理', '在勤', '', '', '', '', ''],
      ['receiver@example.org', '李承辦', '在勤', '', '', '', '', '']
    ].concat(learnerRows),
    組織架構樹: [['類型', '層級', '代碼', '名稱', '別名', '父代碼', '主管信箱', '主管姓名']]
  };
  sandbox.activeSheets = {
    人員職務配置: [['使用者信箱', '姓名', '組織代碼', '組織名稱', '職稱', '類型']],
    訓練紀錄: qualified.trainingRows,
    觀看進度: qualified.progressRows,
    訓練匯出紀錄: []
  };
  sandbox.templateMimeType = XLSX_MIME;
  sandbox.templateSize = templateByteLength;
  sandbox.generatedSize = templateByteLength;
  sandbox.invalidTemplate = false;
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
    return createSpreadsheet(sandbox.masterSheets);
  },
  getActiveSpreadsheet() {
    return createSpreadsheet(sandbox.activeSheets);
  }
};

const DriveApp = {
  getFileById(fileId) {
    assert.strictEqual(fileId, 'template-file-id');
    return {
      getMimeType: () => sandbox.templateMimeType,
      getSize: () => sandbox.templateSize,
      getBlob() {
        return new MockBlob(
          '',
          sandbox.templateMimeType,
          'source-template.xlsx',
          validTemplateParts,
          sandbox.templateSize
        );
      }
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
    assert.strictEqual(pattern, 'yyyy-MM-dd');
    const taipei = new Date(value.getTime() + 8 * 60 * 60 * 1000);
    return [
      taipei.getUTCFullYear(),
      String(taipei.getUTCMonth() + 1).padStart(2, '0'),
      String(taipei.getUTCDate()).padStart(2, '0')
    ].join('-');
  },
  unzip(blob) {
    const parts = blob.parts || [];
    return sandbox.invalidTemplate
      ? parts.filter((part) => part.getName() !== 'xl/workbook.xml')
      : parts;
  },
  newBlob(data, contentType, name) {
    return new MockBlob(data, contentType, name);
  },
  zip(parts, filename) {
    return new MockBlob('', 'application/zip', filename, parts, sandbox.generatedSize);
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
  'ENV',
  'Date',
  'process',
  `${code}; return {
    listTrainingImportCourses,
    previewTrainingImportEmail,
    getTrainingImportConfig_,
    readTrainingImportSource_,
    buildTrainingImportPreviewHash_,
    buildAuthoritativeTrainingImportPreview_
  };`
);

resetFixtures();
const api = load(
  Session,
  PropertiesService,
  SpreadsheetApp,
  DriveApp,
  Utilities,
  ENV,
  FixedDate,
  undefined
);

const unauthorizedCourses = api.listTrainingImportCourses();
assert.strictEqual(unauthorizedCourses.success, false);
assert.match(unauthorizedCourses.message, /權限不足/);
assert.strictEqual(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).success, false);

sandbox.currentEmail = 'admin@example.org';
delete sandbox.properties.DASHBOARD_ALLOWED_EMAILS;
assert.match(api.listTrainingImportCourses().message, /權限不足/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
const courses = api.listTrainingImportCourses();
assert.strictEqual(courses.success, true);
assert.deepStrictEqual(courses.courses.map((item) => item.courseTitle), ['課程甲']);

const config = api.getTrainingImportConfig_();
assert.deepStrictEqual(config, {
  recipientEmail: 'receiver@example.org',
  templateFileId: 'template-file-id'
});
const source = api.readTrainingImportSource_();
assert.strictEqual(source.spreadsheet.getSheetByName('訓練紀錄') !== null, true);
assert.strictEqual(source.personnelRows.length, 7);
assert.strictEqual(source.assignmentRows.length, 1);
assert.strictEqual(source.orgRows.length, 1);
assert.strictEqual(source.trainingRows.length, 6);
assert.strictEqual(source.progressRows.length, 6);
assert.deepStrictEqual(source.logRows, []);
assert(source.context && Array.isArray(source.context.learners));

delete sandbox.properties.TRAINING_IMPORT_RECIPIENT_EMAIL;
const missingRecipient = api.previewTrainingImportEmail({ courseTitle: '課程甲' });
assert.strictEqual(missingRecipient.success, false);
assert.match(missingRecipient.message, /TRAINING_IMPORT_RECIPIENT_EMAIL/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
delete sandbox.properties.TRAINING_IMPORT_TEMPLATE_FILE_ID;
assert.match(
  api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message,
  /TRAINING_IMPORT_TEMPLATE_FILE_ID/
);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
const preview = api.previewTrainingImportEmail({
  courseTitle: '課程甲',
  recipientEmail: 'attacker@example.org',
  rows: [['attacker-controlled']]
});
assert.strictEqual(preview.success, true);
assert.strictEqual(preview.courseTitle, '課程甲');
assert.strictEqual(preview.rows.length, 4);
assert(preview.rows.every((row) => row.length === 14));
assert.strictEqual(preview.recipientEmail, 'receiver@example.org');
assert.strictEqual(preview.attachmentName, 'importtemplate_v20260911.xlsx');
assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
assert.strictEqual(preview.canSend, true);
assert.strictEqual(Object.prototype.hasOwnProperty.call(preview, 'source'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(preview, 'context'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(preview, 'templateBlob'), false);
assert.doesNotThrow(() => JSON.stringify(preview));
const expectedHash = crypto.createHash('sha256').update(JSON.stringify([
  preview.courseTitle,
  preview.recipientEmail,
  preview.attachmentName,
  preview.rows,
  preview.recipientGivenName,
  preview.senderGivenName
]), 'utf8').digest('hex');
assert.strictEqual(preview.previewHash, expectedHash);
assert.strictEqual(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).previewHash, preview.previewHash);
const internalPreview = api.buildAuthoritativeTrainingImportPreview_('課程甲');
assert(internalPreview.source && internalPreview.context && internalPreview.templateBlob);
assert.strictEqual(Object.prototype.hasOwnProperty.call(internalPreview, 'templateFileId'), false);

assert.strictEqual(api.previewTrainingImportEmail({ courseTitle: '未列出的課程' }).success, false);
assert.match(api.previewTrainingImportEmail({ courseTitle: '未列出的課程' }).message, /課程|清單/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.properties.TRAINING_IMPORT_RECIPIENT_EMAIL = 'not-an-email';
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /TRAINING_IMPORT_RECIPIENT_EMAIL|Email/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.masterSheets.人員主檔 = sandbox.masterSheets.人員主檔.filter((row) => row[0] !== 'receiver@example.org');
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /收件人|主檔|中文姓名/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.masterSheets.人員主檔[1][1] = '王';
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /寄件人|中文姓名/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.invalidTemplate = true;
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /範本|workbook/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.templateMimeType = 'application/vnd.google-apps.spreadsheet';
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /XLSX|範本/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.masterSheets.人員主檔.find((row) => row[0] === 'learner1@example.org')[1] = '';
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /資料錯誤|中文姓名/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
const logHeader = new Array(14).fill('');
sandbox.activeSheets.訓練匯出紀錄 = [logHeader].concat(
  ['learner1@example.org', 'learner2@example.org', 'learner3@example.org', 'learner4@example.org']
    .map((email) => ['', `課程甲\n${email}`, '', '', '', '', '', '', '已寄出', '', '', '', '', ''])
);
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /待寄|新增|資料/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
const thousandEmails = Array.from({ length: 1000 }, (_, index) => `learner${index}@example.org`);
const thousandQualified = qualifiedRows(thousandEmails);
sandbox.masterSheets.人員主檔 = sandbox.masterSheets.人員主檔.slice(0, 3).concat(
  thousandEmails.map((email, index) => [email, `王學員${index}`, '在勤', '', '', '', '', ''])
);
sandbox.activeSheets.訓練紀錄 = thousandQualified.trainingRows;
sandbox.activeSheets.觀看進度 = thousandQualified.progressRows;
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /999|筆/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.templateSize = 20 * 1024 * 1024 + 1;
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /20|大小|MiB/);

resetFixtures();
sandbox.currentEmail = 'admin@example.org';
sandbox.generatedSize = 20 * 1024 * 1024 + 1;
assert.match(api.previewTrainingImportEmail({ courseTitle: '課程甲' }).message, /20|大小|MiB/);

console.log('Training import preview tests passed.');
