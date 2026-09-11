const assert = require('assert');
const fs = require('fs');

const codeJs = fs.readFileSync('code.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));

assert(
  manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.readonly'),
  'manifest.oauthScopes 必須包含 Drive 唯讀授權範圍'
);
assert(
  codeJs.includes('function authorizeDriveAppScope('),
  'code.js 必須包含 authorizeDriveAppScope 函式'
);

const functionMatch = codeJs.match(/function authorizeDriveAppScope\(\)\s*\{[\s\S]*?\n\}/);
assert(functionMatch, '必須能載入 authorizeDriveAppScope 函式');

const logs = [];
const requestedFileIds = [];
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => key === 'TRAINING_IMPORT_TEMPLATE_FILE_ID'
      ? ' template-file-id '
      : ''
  })
};
const DriveApp = {
  getFileById: (fileId) => {
    requestedFileIds.push(fileId);
    return {
      getName: () => 'importtemplate_v20251226 (1).xlsx'
    };
  }
};
const Logger = {
  log: (message) => logs.push(message)
};
const MENTION_CONFIG = {
  trainingImportTemplatePropertyKey: 'TRAINING_IMPORT_TEMPLATE_FILE_ID'
};

const runAuthorization = new Function(
  'PropertiesService',
  'DriveApp',
  'Logger',
  'MENTION_CONFIG',
  `${functionMatch[0]}; return authorizeDriveAppScope();`
);
const result = runAuthorization(PropertiesService, DriveApp, Logger, MENTION_CONFIG);

assert.deepStrictEqual(requestedFileIds, ['template-file-id']);
assert.strictEqual(result.success, true);
assert.strictEqual(result.fileName, 'importtemplate_v20251226 (1).xlsx');
assert(result.message.includes('Drive 唯讀權限已授權'));
assert(logs.some((message) => message.includes('importtemplate_v20251226 (1).xlsx')));

const missingPropertyService = {
  getScriptProperties: () => ({ getProperty: () => '' })
};
assert.throws(
  () => runAuthorization(missingPropertyService, DriveApp, Logger, MENTION_CONFIG),
  /TRAINING_IMPORT_TEMPLATE_FILE_ID/
);

console.log('authorizeDriveAppScope 驗證通過');
