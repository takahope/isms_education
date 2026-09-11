const assert = require('assert');
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('appsscript.json', 'utf8'));
const docs = fs.readFileSync('GEMINI.md', 'utf8');
const code = fs.readFileSync('code.js', 'utf8');

assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive.readonly'));
assert(code.includes("'TRAINING_IMPORT_RECIPIENT_EMAIL'"));
assert(code.includes("'TRAINING_IMPORT_TEMPLATE_FILE_ID'"));
assert(docs.includes('TRAINING_IMPORT_RECIPIENT_EMAIL'));
assert(docs.includes('TRAINING_IMPORT_TEMPLATE_FILE_ID'));
assert(docs.includes('importtemplate_vYYYYMMDD.xlsx'));
assert(docs.includes('不需要轉換成 Google Sheet'));

const deploymentGuide = docs.split('### 教育訓練匯入信件設定')[0];
assert(deploymentGuide.includes('根目錄的 `code.js`'));
assert(deploymentGuide.includes('小寫的 `index.html`'));
assert(deploymentGuide.includes('`mention.html`'));
assert(deploymentGuide.includes('`env.js`'));
assert(deploymentGuide.includes('`appsscript.json`'));
assert(deploymentGuide.includes('`example/` 僅供參考，不是部署目標'));
assert(deploymentGuide.includes('ENV.MASTER_SHEET_ID'));
assert(deploymentGuide.includes('可連線的 Google 試算表'));
assert(!deploymentGuide.includes('example/code.js'));
assert(!deploymentGuide.includes('example/index.html'));
