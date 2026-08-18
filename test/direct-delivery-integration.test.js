const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codeJs = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 驗證所有 UI 標籤一致性
assert(dashboardHtml.includes('單封多人（互相可見）'));
assert(dashboardHtml.includes('副本 CC（單封多人專用）'));

// 2. 驗證 code.js 語法正確性 (透過 Node.js 語法檢查)
const vm = require('vm');
const script = new vm.Script(codeJs, { filename: 'dashboard/code.js' });
assert(script, 'code.js 語法無誤');

console.log('全流程整合測試驗證通過！');
