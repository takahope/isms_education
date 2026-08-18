const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查 HTML 元素與預設勾選
assert(html.includes('id="exclude-egc-toggle"'), '必須包含 exclude-egc-toggle 元素');
assert(html.includes('<span>排除倫理委員會</span>'), '必須包含 排除倫理委員會 標籤');
assert(html.includes('excludeEgc: true'), 'state.filters 預設 excludeEgc 必須為 true');

// 2. 擷取並測試 isEgcMember 函式
const funcMatch = html.match(/function isEgcMember\([\s\S]*?\n\s{4}\}/);
assert(funcMatch, '必須存在 isEgcMember 函式');
const isEgcMember = new Function(funcMatch[0] + '; return isEgcMember;')();

assert.strictEqual(isEgcMember({ assignmentOrgCode: 'EGC' }), true, '代碼 EGC 應判定為 true');
assert.strictEqual(isEgcMember({ assignmentOrgCode: 'egc' }), true, '小寫 egc 應判定為 true');
assert.strictEqual(isEgcMember({ assignmentOrgName: '倫理委員會' }), true, '名稱 倫理委員會 應判定為 true');
assert.strictEqual(isEgcMember({ personnelStatus: '倫理委員會' }), true, '狀態 倫理委員會 應判定為 true');
assert.strictEqual(isEgcMember({ assignmentOrgCode: 'GRP-01', assignmentOrgName: '資訊組' }), false, '一般人員應判定為 false');

console.log('Task 1 測試通過！');
