const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codeJs = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 1. 語法安全驗證
const script = new vm.Script(codeJs, { filename: 'dashboard/code.js' });
assert(script, 'code.js 語法無誤');

// 2. 模擬 collectPersonnelStatusOptions_
const collectFuncMatch = codeJs.match(/function collectPersonnelStatusOptions_\([\s\S]*?\n\}/);
const isExcludedMatch = codeJs.match(/function isExcludedPersonnelStatus_\([\s\S]*?\n\}/);
const constMatch = codeJs.match(/const DASHBOARD_EXCLUDED_PERSONNEL_STATUSES = [\s\S]*?;\n/);

const testScope = new Function(
  constMatch[0] +
  isExcludedMatch[0] +
  collectFuncMatch[0] +
  '; return { collectPersonnelStatusOptions_, isExcludedPersonnelStatus_ };'
)();

const mockRows = [
  ['信箱', '姓名', '狀態'],
  ['a@example.com', '在職員工', '在勤'],
  ['b@example.com', '育嬰同仁', '育嬰假'],
  ['c@example.com', '離職員工', '離職'],
  ['d@example.com', '委外人員', '委外廠商'],
  ['e@example.com', '合作人員', '合作']
];

const options = testScope.collectPersonnelStatusOptions_(mockRows);
assert.deepStrictEqual(options, ['在勤', '育嬰假'], '選項清單應排除離職、委外廠商與合作');

console.log('Task 2 整合測試驗證通過！');
