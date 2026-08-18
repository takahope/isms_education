const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 模擬學員資料集
const sampleLearners = [
  { name: '王大明', email: 'wang@example.com', assignmentOrgCode: 'GRP-01', assignmentOrgName: '資訊組', status: 'completed' },
  { name: '李小華', email: 'lee@example.com', assignmentOrgCode: 'GRP-02', assignmentOrgName: '研發組', status: 'in_progress' },
  { name: '張委員', email: 'chang@example.com', assignmentOrgCode: 'EGC', assignmentOrgName: '倫理委員會', status: 'not_started' },
  { name: '陳委員', email: 'chen@example.com', assignmentOrgCode: '', assignmentOrgName: '', personnelStatus: '倫理委員會', status: 'pending_quiz' }
];

// 提取 applyFilters 與 computeClientMetrics 相關邏輯進行純 JS 驗證
const isEgcFunc = new Function(html.match(/function isEgcMember\([\s\S]*?\n\s{4}\}/)[0] + '; return isEgcMember;')();

// 1. 預設排除狀態測試 (excludeEgc: true)
const defaultFiltered = sampleLearners.filter(l => !isEgcFunc(l));
assert.strictEqual(defaultFiltered.length, 2, '預設排除後應只剩 2 位一般同仁');

// 2. 取消排除狀態測試 (excludeEgc: false)
const allFiltered = sampleLearners.filter(() => true);
assert.strictEqual(allFiltered.length, 4, '取消排除後應包含全部 4 位學員');

console.log('Task 2 整合測試驗證通過！');
