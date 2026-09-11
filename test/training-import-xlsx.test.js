const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');

const templatePath = 'docs/importtemplate_v20251226 (1).xlsx';
const partNames = execFileSync('unzip', ['-Z1', templatePath], { encoding: 'utf8' })
  .trim()
  .split('\n');

class MockBlob {
  constructor(data, contentType, name, parts) {
    this.data = data;
    this.contentType = contentType || '';
    this.name = name || '';
    this.parts = parts || null;
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

  setName(name) {
    this.name = name;
    return this;
  }

  setContentType(contentType) {
    this.contentType = contentType;
    return this;
  }
}

function readTemplatePart(name) {
  const unzipName = name === '[Content_Types].xml' ? '\\[Content_Types\\].xml' : name;
  return execFileSync('unzip', ['-p', templatePath, unzipName], { encoding: 'utf8' });
}

const templateParts = partNames.map((name) => new MockBlob(
  readTemplatePart(name),
  'application/xml',
  name
));
const originalPartByName = new Map(templateParts.map((part) => [part.getName(), part]));
const templateBlob = new MockBlob('', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', templatePath, templateParts);

const Utilities = {
  unzip(blob) {
    return blob.parts;
  },
  newBlob(data, contentType, name) {
    return new MockBlob(data, contentType, name);
  },
  zip(parts, filename) {
    return new MockBlob('', 'application/zip', filename, parts);
  }
};

const code = fs.readFileSync('code.js', 'utf8');
const load = new Function('Utilities', `${code}; return {
  TRAINING_IMPORT_HEADERS,
  populateTrainingImportSheetXml_,
  validateTrainingImportTemplateParts_,
  buildTrainingImportWorkbookBlob_,
  verifyTrainingImportWorkbookBlob_
};`);
const api = load(Utilities);

const originalXml = readTemplatePart('xl/worksheets/sheet1.xml');
const rows = [[
  '【資安通識】課程甲 & <測試>', 522, '資通安全(通識)', '王小明',
  '生醫轉譯研究中心', 3, '2026-09-09', 2026, 'ming', '',
  '臺灣人體生物資料庫研究人員', 'ming@example.org', '本院自辦課程', ''
]];
const updatedXml = api.populateTrainingImportSheetXml_(originalXml, rows);

const originalSheetDataStart = originalXml.indexOf('<sheetData>');
const originalSheetDataEnd = originalXml.indexOf('</sheetData>') + '</sheetData>'.length;
const updatedSheetDataStart = updatedXml.indexOf('<sheetData>');
const updatedSheetDataEnd = updatedXml.indexOf('</sheetData>') + '</sheetData>'.length;
const originalHeaderRow = originalXml.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/)[0];
const updatedHeaderRow = updatedXml.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/)[0];

assert.strictEqual(updatedXml.slice(0, updatedSheetDataStart), originalXml.slice(0, originalSheetDataStart));
assert.strictEqual(updatedXml.slice(updatedSheetDataEnd), originalXml.slice(originalSheetDataEnd));
assert.strictEqual(updatedHeaderRow, originalHeaderRow);
assert(updatedXml.includes('<c r="A2" s="1" t="inlineStr"><is><t xml:space="preserve">【資安通識】課程甲 &amp; &lt;測試&gt;</t></is></c>'));
assert(updatedXml.includes('<c r="B2" s="1"><v>522</v></c>'));
assert(updatedXml.includes('ming@example.org'));
assert(!updatedXml.includes('114年度TWB資安曁個資安全教育訓練課程'));
assert(updatedXml.includes('<autoFilter ref="$A$1:$M$1000"'));
assert(updatedXml.includes('<dataValidations'));
assert(updatedXml.includes('<row r="1000"'));
assert(/<c r="A3" s="1" t="inlineStr"\/>/.test(updatedXml));
assert(/<c r="B3" s="1"\/>/.test(updatedXml));
assert(!/<c r="B2"[^>]*\bt=/.test(updatedXml));
assert.throws(
  () => api.populateTrainingImportSheetXml_(originalXml, new Array(1000).fill(rows[0])),
  /999/
);

const validated = api.validateTrainingImportTemplateParts_(templateParts);
assert.strictEqual(validated.sheetBlob, originalPartByName.get('xl/worksheets/sheet1.xml'));
assert.strictEqual(validated.sheetXml, originalXml);

function withoutPart(name) {
  return templateParts.filter((part) => part.getName() !== name);
}

assert.throws(() => api.validateTrainingImportTemplateParts_(withoutPart('xl/workbook.xml')), /xl\/workbook\.xml/);
assert.throws(() => api.validateTrainingImportTemplateParts_(withoutPart('xl/worksheets/sheet1.xml')), /xl\/worksheets\/sheet1\.xml/);
assert.throws(() => api.validateTrainingImportTemplateParts_(withoutPart('xl/worksheets/sheet2.xml')), /xl\/worksheets\/sheet2\.xml/);
assert.throws(() => api.validateTrainingImportTemplateParts_(withoutPart('xl/worksheets/sheet3.xml')), /xl\/worksheets\/sheet3\.xml/);
assert.throws(() => api.validateTrainingImportTemplateParts_(withoutPart('xl/sharedStrings.xml')), /xl\/sharedStrings\.xml/);

function replacePart(parts, name, transform) {
  return parts.map((part) => part.getName() === name
    ? new MockBlob(transform(part.getDataAsString()), part.getContentType(), name)
    : part);
}

const wrongSheetNames = replacePart(templateParts, 'xl/workbook.xml', (xml) => xml.replace(
  'name="表1-匯入資料填寫區"',
  'name="錯誤工作表"'
));
assert.throws(() => api.validateTrainingImportTemplateParts_(wrongSheetNames), /工作表/);

const wrongHeaders = replacePart(templateParts, 'xl/sharedStrings.xml', (xml) => xml.replace(
  '<si><t>course_title</t></si>',
  '<si><t>wrong_header</t></si>'
));
assert.throws(() => api.validateTrainingImportTemplateParts_(wrongHeaders), /A1:N1|欄位/);

const filename = 'importtemplate_v20260911.xlsx';
const workbookBlob = api.buildTrainingImportWorkbookBlob_(templateBlob, rows, filename);
assert.strictEqual(workbookBlob.getName(), filename);
assert.strictEqual(workbookBlob.getContentType(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
assert.deepStrictEqual(workbookBlob.parts.map((part) => part.getName()), partNames);
workbookBlob.parts.forEach((part) => {
  if (part.getName() === 'xl/worksheets/sheet1.xml') {
    assert.notStrictEqual(part, originalPartByName.get(part.getName()));
    assert(part.getDataAsString().includes('ming@example.org'));
    return;
  }
  assert.strictEqual(part, originalPartByName.get(part.getName()));
});

assert.doesNotThrow(() => api.verifyTrainingImportWorkbookBlob_(workbookBlob, rows));

const badValueParts = replacePart(workbookBlob.parts, 'xl/worksheets/sheet1.xml', (xml) => xml.replace(
  'ming@example.org',
  'wrong@example.org'
));
assert.throws(
  () => api.verifyTrainingImportWorkbookBlob_(new MockBlob('', '', 'bad-value.xlsx', badValueParts), rows),
  /L2|資料/
);

const extraRowXml = api.populateTrainingImportSheetXml_(originalXml, rows.concat([rows[0]]));
const extraRowParts = replacePart(templateParts, 'xl/worksheets/sheet1.xml', () => extraRowXml);
assert.throws(
  () => api.verifyTrainingImportWorkbookBlob_(new MockBlob('', '', 'extra-row.xlsx', extraRowParts), rows),
  /筆數|列數/
);

assert.throws(
  () => api.verifyTrainingImportWorkbookBlob_(new MockBlob('', '', 'missing-sheet.xlsx', withoutPart('xl/worksheets/sheet1.xml')), rows),
  /xl\/worksheets\/sheet1\.xml/
);

console.log('Training import XLSX tests passed.');
