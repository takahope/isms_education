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
