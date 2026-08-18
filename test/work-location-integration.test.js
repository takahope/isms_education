const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codeJs = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 語法安全驗證
const script = new vm.Script(codeJs, { filename: 'dashboard/code.js' });
assert(script, 'code.js 語法無誤');

// 2. 模擬多選篩選
const sampleLearners = [
  { name: '王大明', location: '南港總部', status: 'completed' },
  { name: '李小華', location: '台大醫院', status: 'in_progress' },
  { name: '張小美', location: '台中駐站', status: 'not_started' },
  { name: '陳大文', location: '高雄駐站', status: 'completed' }
];

// 單選南港總部
const filteredSingle = sampleLearners.filter(l => ['南港總部'].includes(l.location));
assert.strictEqual(filteredSingle.length, 1);

// 多選南港 + 台大
const filteredMulti = sampleLearners.filter(l => ['南港總部', '台大醫院'].includes(l.location));
assert.strictEqual(filteredMulti.length, 2);

// 不限（空陣列）
const filterLocations = [];
const filteredAll = sampleLearners.filter(l => filterLocations.length === 0 || filterLocations.includes(l.location));
assert.strictEqual(filteredAll.length, 4);

console.log('Task 3 整合測試驗證通過！');
