const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 1. 檢查常數與函式定義
assert(code.includes('DASHBOARD_EXCLUDED_PERSONNEL_STATUSES'), '必須定義 DASHBOARD_EXCLUDED_PERSONNEL_STATUSES');
const funcMatch = code.match(/function isExcludedPersonnelStatus_\([\s\S]*?\n\}/);
assert(funcMatch, '必須存在 isExcludedPersonnelStatus_ 函式');

const isExcluded = new Function(
  code.match(/const DASHBOARD_EXCLUDED_PERSONNEL_STATUSES = [\s\S]*?;\n/)[0] +
  funcMatch[0] +
  '; return isExcludedPersonnelStatus_;'
)();

// 2. 驗證排除狀態
const excludedCases = ['離職', '委外', '委外廠商', '合作', '合作廠商', ' 離職 ', '委外廠商 '];
excludedCases.forEach(st => {
  assert.strictEqual(isExcluded(st), true, `狀態 "${st}" 應被排除`);
});

// 3. 驗證保留狀態
const keepCases = ['在勤', '在職', '育嬰假', '休假', '留職停薪', '外派人員', '倫理委員會', ''];
keepCases.forEach(st => {
  assert.strictEqual(isExcluded(st), false, `狀態 "${st}" 應保留`);
});

console.log('Task 1 測試通過！');
