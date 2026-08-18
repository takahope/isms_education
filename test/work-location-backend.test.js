const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 檢查 buildDashboardContext_ 是否有讀取 personnelRows[i][7]
assert(code.includes('personnelRows[i][7]'), 'buildDashboardContext_ 必須讀取 personnelRows[i][7] (H 欄)');
assert(code.includes('location,'), 'learners 陣列物件中必須包含 location 屬性');

console.log('Task 1 測試通過！');
