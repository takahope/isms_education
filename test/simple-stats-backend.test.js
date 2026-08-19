const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 載入 code.js 程式碼進行測試
const codePath = path.resolve(__dirname, '../code.js');
const code = fs.readFileSync(codePath, 'utf8');

// 建立模擬環境與待測函式執行環境
const sandbox = {
  console,
  Math,
  Date,
  Set,
  Map,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Utilities: {
    formatDate: (d, tz, fmt) => '2026/08/18 10:00:00'
  }
};

// 提取並包裝待測核心函式
const evalContext = new Function(
  'sandbox',
  `with (sandbox) {
    ${code}
    return {
      normalizeEmail_,
      isEligiblePersonnelStatus_,
      isExcludedLocation_,
      buildSimpleTrainingStatsFromData_,
      resolveSimpleLearnerTrainingStatus_,
      getSimpleTrainingStats
    };
  }`
);

const {
  normalizeEmail_,
  isEligiblePersonnelStatus_,
  isExcludedLocation_,
  buildSimpleTrainingStatsFromData_,
  resolveSimpleLearnerTrainingStatus_
} = evalContext(sandbox);

// 1. 測試在勤狀態過濾
assert.strictEqual(isEligiblePersonnelStatus_('在勤'), true, '「在勤」應判定為符合資格');
assert.strictEqual(isEligiblePersonnelStatus_('育嬰假'), true, '「育嬰假」應判定為符合資格');
assert.strictEqual(isEligiblePersonnelStatus_(' 在勤 '), true, '帶空白的「在勤」應判定為符合資格');
assert.strictEqual(isEligiblePersonnelStatus_('離職'), false, '「離職」應排除');
assert.strictEqual(isEligiblePersonnelStatus_('委外廠商'), false, '「委外廠商」應排除');
assert.strictEqual(isEligiblePersonnelStatus_('合作'), false, '「合作」應排除');
assert.strictEqual(isEligiblePersonnelStatus_('留職停薪'), false, '「留職停薪」應排除');

// 2. 測試地點排除
assert.strictEqual(isExcludedLocation_('outside'), true, '「outside」應排除');
assert.strictEqual(isExcludedLocation_('Outside'), true, '大小寫「Outside」應排除');
assert.strictEqual(isExcludedLocation_(' OUTSIDE '), true, '帶空白大寫「OUTSIDE」應排除');
assert.strictEqual(isExcludedLocation_('南港總部'), false, '「南港總部」不應排除');
assert.strictEqual(isExcludedLocation_('台中駐站'), false, '「台中駐站」不應排除');
assert.strictEqual(isExcludedLocation_(''), false, '空白地點不應排除');

// 3. 測試測驗狀態判定
assert.strictEqual(resolveSimpleLearnerTrainingStatus_(true, 1), 'passed');
assert.strictEqual(resolveSimpleLearnerTrainingStatus_(false, 1), 'failed');
assert.strictEqual(resolveSimpleLearnerTrainingStatus_(false, 0), 'unattempted');

// 4. 測試整體統計與去識別化資料生成
const mockPersonnelRows = [
  ['使用者信箱', '姓名', '在勤狀態', '欄位D', '欄位E', '欄位F', '欄位G', '工作地點'],
  ['ming@example.com', '王小明', '在勤', '', '', '', '', '南港總部'],
  ['hua@example.com', '李小華', '育嬰假', '', '', '', '', '台中駐站'],
  ['outside_user@example.com', '陳外員', '在勤', '', '', '', '', 'outside'],
  ['resigned@example.com', '趙離職', '離職', '', '', '', '', '南港總部'],
  ['tong@example.com', '陳大同', '在勤', '', '', '', '', '高雄駐站'],
  ['failed_user@example.com', '林不及格', '在勤', '', '', '', '', '南港總部']
];

const mockTrainingRows = [
  ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果', '測驗批次ID', '題目數', '及格門檻'],
  ['2026-08-18 10:00:00', '王小明', 'ming@example.com', '資安教育訓練', '90', '通過', 'BATCH-1', '10', '70'],
  ['2026-08-18 11:00:00', '林不及格', 'failed_user@example.com', '資安教育訓練', '60', '未通過', 'BATCH-2', '10', '70']
];

const result = buildSimpleTrainingStatsFromData_(mockPersonnelRows, mockTrainingRows);

assert.strictEqual(result.summary.totalEligible, 4, '符合條件應訓總人數應為 4 (排除 outside 與離職)');
assert.strictEqual(result.summary.passedCount, 1, '已通過人數應為 1 (王小明)');
assert.strictEqual(result.summary.failedCount, 1, '未通過人數應為 1 (林不及格)');
assert.strictEqual(result.summary.unattemptedCount, 2, '未受訓人數應為 2 (李小華, 陳大同)');
assert.strictEqual(result.summary.incompleteCount, 3, '未完成人數應為 3 (failedCount 1 + unattemptedCount 2 = 3)');
assert.strictEqual(result.summary.completionRate, '25.0%', '完成率應為 25.0% (1/4)');

// 5. 驗證隱私安全：所有 learner 均不含 score 欄位
result.learners.forEach((learner) => {
  assert.strictEqual(learner.hasOwnProperty('score'), false, `學員 ${learner.name} 不得包含 score 欄位`);
});

// 6. 測試 getSimpleTrainingStats 在獨立試算表架構下的執行能力 (masterSS 包含 人員主檔，activeSS 包含 訓練紀錄)
const mockMasterSheet = {
  getDataRange: () => ({
    getDisplayValues: () => mockPersonnelRows
  })
};

const mockTrainingSheet = {
  getLastRow: () => mockTrainingRows.length,
  getDataRange: () => ({
    getDisplayValues: () => mockTrainingRows
  })
};

const mockMasterSS = {
  getSheetByName: (name) => {
    if (name === '人員主檔') return mockMasterSheet;
    return null; // 主檔試算表刻意不包含「訓練紀錄」
  }
};

const mockActiveSS = {
  getSheetByName: (name) => {
    if (name === '訓練紀錄') return mockTrainingSheet;
    return null;
  }
};

sandbox.ENV = {
  MASTER_SHEET_ID: 'MOCK_MASTER_ID'
};

sandbox.SpreadsheetApp = {
  openById: (id) => {
    if (id === 'MOCK_MASTER_ID') return mockMasterSS;
    throw new Error('找不到指定試算表');
  },
  getActiveSpreadsheet: () => mockActiveSS
};

const statsResult = evalContext(sandbox).getSimpleTrainingStats();
assert.strictEqual(statsResult.success, true, `getSimpleTrainingStats 應成功執行: ${statsResult.message}`);
assert.strictEqual(statsResult.summary.totalEligible, 4, '應訓總人數應為 4');
assert.strictEqual(statsResult.summary.passedCount, 1, '已通過人數應為 1');

console.log('✓ 後端資料管線與隱私防護單元測試全數通過！');
