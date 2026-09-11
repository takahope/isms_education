const assert = require('assert');
const fs = require('fs');

const code = fs.readFileSync('code.js', 'utf8');
const load = new Function(`${code}; return {
  buildTrainingImportCourseOptions_,
  extractTrainingImportGivenName_,
  buildTrainingImportUniqueKey_,
  parseTrainingImportTaipeiTimestampMs_,
  buildTrainingImportDataset_
};`);
const api = load();

const trainingRows = [
  ['時間戳記', '姓名', '使用者信箱', '課程名稱', '測驗分數', '測驗結果'],
  ['2026/09/08 09:00:00', '王小明', 'ming@example.org', '課程甲', '80', '通過'],
  ['2026/09/10 09:00:00', '李小華', 'hua@example.org', '只有測驗', '90', '通過']
];
const progressRows = [
  ['使用者信箱', '課程名稱', '影片ID', '已觀看區間', '已觀看秒數', '最後播放位置', '最後更新時間'],
  ['ming@example.org', '課程甲', 'video-1', '', '3600', '', '2026/09/09 10:00:00'],
  ['other@example.org', '只有觀看', 'video-1', '', '3600', '', '2026/09/11 10:00:00']
];

assert.deepStrictEqual(
  api.buildTrainingImportCourseOptions_(trainingRows, progressRows).map((item) => item.courseTitle),
  ['課程甲']
);
assert.strictEqual(api.extractTrainingImportGivenName_('王小明'), '小明');
assert.throws(() => api.extractTrainingImportGivenName_('王'), /中文姓名/);
assert.strictEqual(
  api.buildTrainingImportUniqueKey_(' 課程甲 ', 'MING@EXAMPLE.ORG'),
  '課程甲\nming@example.org'
);

const courseOptions = api.buildTrainingImportCourseOptions_([
  trainingRows[0],
  ['2026/09/02 08:00:00', '王小明', 'ming@example.org', '較舊課程', '80', '通過'],
  ['2026/09/09 08:00:00', '王小明', 'ming@example.org', '最新課程', '80', '通過'],
  ['2026/09/10 08:00:00', '李小華', 'hua@example.org', '最新課程', '90', '通過'],
  ['2026/09/12 08:00:00', '李小華', 'hua@example.org', '只有測驗', '90', '通過']
], [
  progressRows[0],
  ['ming@example.org', '較舊課程', 'video-1', '', '3600', '', '2026/09/03 08:00:00'],
  ['ming@example.org', '最新課程', 'video-1', '', '3600', '', '2026/09/11 08:00:00'],
  ['hua@example.org', '最新課程', 'video-1', '', '3600', '', '2026/09/08 08:00:00'],
  ['other@example.org', '只有觀看', 'video-1', '', '3600', '', '2026/09/13 08:00:00']
]);
assert.deepStrictEqual(courseOptions, [
  {
    courseTitle: '最新課程',
    latestActivityAt: '2026/09/11 08:00:00',
    quizRecordCount: 2,
    progressRecordCount: 2
  },
  {
    courseTitle: '較舊課程',
    latestActivityAt: '2026/09/03 08:00:00',
    quizRecordCount: 1,
    progressRecordCount: 1
  }
]);

const personnelRows = [
  ['信箱', '姓名', '人員狀態', '', '', '', '', '工作地點'],
  ['ming@example.org', '王小明', '在勤', '', '', '', '', ''],
  ['hua@example.org', '李小華', '育嬰假', '', '', '', '', ''],
  ['outside@example.org', '陳小美', '在勤', '', '', '', '', 'outside'],
  ['ethics@example.org', '林小安', '倫理委員會', '', '', '', '', ''],
  ['resigned@example.org', '趙小強', '離職', '', '', '', '', ''],
  ['vendor@example.org', '周小芳', '委外廠商', '', '', '', '', ''],
  ['sent@example.org', '吳小文', '在勤', '', '', '', '', ''],
  ['preparing@example.org', '何小玲', '在勤', '', '', '', '', ''],
  ['retry@example.org', '高小傑', '在勤', '', '', '', '', '']
];

const qualifiedEmails = [
  'ming@example.org',
  'hua@example.org',
  'outside@example.org',
  'ethics@example.org',
  'resigned@example.org',
  'vendor@example.org',
  'sent@example.org',
  'preparing@example.org',
  'retry@example.org'
];
const datasetTrainingRows = [trainingRows[0]].concat(qualifiedEmails.map((email) => [
  '2026/09/08 09:00:00',
  '',
  email,
  '課程甲',
  '80',
  '通過'
]));
const datasetProgressRows = [progressRows[0]].concat(qualifiedEmails.flatMap((email) => [
  [email, '課程甲', 'video-1', '', '3500', '', '2026/09/07 09:00:00'],
  [email, '課程甲', 'video-1', '', '3600', '', '2026/09/09 10:00:00']
]));
const logRows = [
  ['批次ID', '唯一鍵', '課程名稱', '姓名', '使用者信箱', '完成日期', '收件人信箱', '附件檔名', '狀態', '操作者', '建立時間', '寄送時間', '最後更新時間', '錯誤訊息'],
  ['batch-1', '課程甲\nsent@example.org', '課程甲', '吳小文', 'sent@example.org', '2026-09-09', 'ming@example.org', 'old.xlsx', '已寄出', '', '', '', '', ''],
  ['batch-2', '課程甲\npreparing@example.org', '課程甲', '何小玲', 'preparing@example.org', '2026-09-09', 'ming@example.org', 'old.xlsx', '準備寄送', '', '', '', '', ''],
  ['batch-3', '課程甲\nretry@example.org', '課程甲', '高小傑', 'retry@example.org', '2026-09-09', 'ming@example.org', 'old.xlsx', '寄送失敗', '', '', '', '', '']
];
const context = {
  learners: qualifiedEmails.map((email) => ({
    email,
    personnelStatus: email === 'vendor@example.org' ? '在勤' : '',
    location: email === 'outside@example.org' ? 'outside' : '',
    assignmentOrgName: email === 'ethics@example.org' ? '倫理委員會' : '',
    assignments: []
  })),
  assignments: [],
  orgNodes: [],
  orgNodeMap: new Map()
};
const dataset = api.buildTrainingImportDataset_({
  courseTitle: '課程甲',
  personnelRows,
  trainingRows: datasetTrainingRows,
  progressRows: datasetProgressRows,
  logRows,
  context,
  recipientEmail: 'ming@example.org',
  viewerEmail: 'hua@example.org',
  now: new Date('2026-09-11T08:00:00+08:00')
});

assert.deepStrictEqual(
  dataset.pendingLearners.map((learner) => learner.email),
  ['ethics@example.org', 'hua@example.org', 'ming@example.org', 'outside@example.org', 'retry@example.org']
);
assert.strictEqual(dataset.alreadySent.length, 1);
assert.strictEqual(dataset.preparing.length, 1);
assert.strictEqual(dataset.retryableFailures.length, 1);
assert.strictEqual(dataset.rows.length, dataset.pendingLearners.length);
assert(dataset.rows.every((row) => row.length === 14));
assert.deepStrictEqual(dataset.rows.find((row) => row[11] === 'ming@example.org'), [
  '【資安通識】課程甲',
  522,
  '資通安全(通識)',
  '王小明',
  '生醫轉譯研究中心',
  3,
  '2026-09-09',
  2026,
  'ming',
  '',
  '臺灣人體生物資料庫研究人員',
  'ming@example.org',
  '本院自辦課程',
  ''
]);
assert.strictEqual(dataset.subject.includes('課程甲'), true);
assert.strictEqual(dataset.htmlBody.includes('小明您好：'), true);
assert.strictEqual(dataset.htmlBody.includes('小華 敬上'), true);
assert.strictEqual(dataset.htmlBody.includes('自動發送'), false);
assert.strictEqual(dataset.attachmentName, 'importtemplate_v20260911.xlsx');

const qualificationPersonnelRows = [
  personnelRows[0],
  ['recipient@example.org', '李小華', '在勤', '', '', '', '', ''],
  ['operator@example.org', '王小明', '在勤', '', '', '', '', ''],
  ['score@example.org', '許小安', '在勤', '', '', '', '', ''],
  ['timing@example.org', '陳小美', '在勤', '', '', '', '', ''],
  ['cross-course@example.org', '林小文', '在勤', '', '', '', '', ''],
  ['assignment-vendor@example.org', '周小芳', '在勤', '', '', '', '', '']
];
const qualificationDataset = api.buildTrainingImportDataset_({
  courseTitle: '課程乙',
  personnelRows: qualificationPersonnelRows,
  trainingRows: [
    trainingRows[0],
    ['2026/09/04 08:00:00', '許小安', 'score@example.org', '課程乙', '70', '未通過'],
    ['2026/09/10 08:00:00', '陳小美', 'timing@example.org', '課程乙', '90', '通過'],
    ['2026/09/07 08:00:00', '陳小美', 'timing@example.org', '課程乙', '80', '通過'],
    ['2026/09/04 08:00:00', '林小文', 'cross-course@example.org', '課程乙', '80', '通過'],
    ['2026/09/04 08:00:00', '周小芳', 'assignment-vendor@example.org', '課程乙', '80', '通過']
  ],
  progressRows: [
    progressRows[0],
    ['score@example.org', '課程乙', 'video-1', '', '3600', '', '2026/09/03 08:00:00'],
    ['timing@example.org', '課程乙', 'video-1', '', '3500', '', '2026/09/01 08:00:00'],
    ['timing@example.org', '課程乙', 'video-1', '', '3600', '', '2026/09/12 08:00:00'],
    ['timing@example.org', '課程乙', 'video-1', '', '3600', '', '2026/09/08 08:00:00'],
    ['cross-course@example.org', '課程丙', 'video-1', '', '3600', '', '2026/09/05 08:00:00'],
    ['assignment-vendor@example.org', '課程乙', 'video-1', '', '3600', '', '2026/09/05 08:00:00']
  ],
  logRows: [],
  context: {
    learners: [],
    assignments: [{
      email: 'assignment-vendor@example.org',
      orgCode: 'GRP-CO-EX-01',
      orgName: '收案委外駐站',
      title: '工程師'
    }],
    orgNodes: [],
    orgNodeMap: new Map()
  },
  recipientEmail: 'recipient@example.org',
  viewerEmail: 'operator@example.org',
  now: new Date('2026-09-11T08:00:00+08:00')
});
assert.deepStrictEqual(
  qualificationDataset.pendingLearners.map((learner) => learner.email),
  ['score@example.org', 'timing@example.org']
);
assert.strictEqual(
  qualificationDataset.rows.find((row) => row[11] === 'score@example.org')[6],
  '2026-09-04'
);
assert.strictEqual(
  qualificationDataset.rows.find((row) => row[11] === 'timing@example.org')[6],
  '2026-09-08'
);

assert.strictEqual(
  api.parseTrainingImportTaipeiTimestampMs_(new Date('2026-09-09T16:30:45.123Z')),
  new Date('2026-09-09T16:30:45.123Z').getTime()
);
assert.strictEqual(
  api.parseTrainingImportTaipeiTimestampMs_('2026/09/10 上午 12:30:00'),
  Date.UTC(2026, 8, 9, 16, 30, 0)
);
assert.strictEqual(
  api.parseTrainingImportTaipeiTimestampMs_('2026/09/10 下午 11:30:00'),
  Date.UTC(2026, 8, 10, 15, 30, 0)
);
assert.strictEqual(
  api.parseTrainingImportTaipeiTimestampMs_('2026/09/10 11:30:00 PM'),
  Date.UTC(2026, 8, 10, 15, 30, 0)
);

const timestampDataset = api.buildTrainingImportDataset_({
  courseTitle: '課程時間',
  personnelRows: [
    personnelRows[0],
    ['recipient@example.org', '李小華', '在勤', '', '', '', '', ''],
    ['operator@example.org', '王小明', '在勤', '', '', '', '', ''],
    ['typed@example.org', '陳小美', '在勤', '', '', '', '', ''],
    ['localized@example.org', '林小安', '在勤', '', '', '', '', '']
  ],
  trainingRows: [
    trainingRows[0],
    [new Date('2026-09-08T15:00:00.000Z'), '', 'typed@example.org', '課程時間', '80', '通過'],
    ['2026/09/09 下午 11:30:00', '', 'localized@example.org', '課程時間', '80', '通過']
  ],
  progressRows: [
    progressRows[0],
    ['typed@example.org', '課程時間', 'video-1', '', '3600', '', new Date('2026-09-09T16:30:00.000Z')],
    ['localized@example.org', '課程時間', 'video-1', '', '3600', '', '2026/09/10 上午 12:30:00']
  ],
  logRows: [],
  context: { learners: [], assignments: [], orgNodes: [], orgNodeMap: new Map() },
  recipientEmail: 'recipient@example.org',
  viewerEmail: 'operator@example.org',
  now: new Date('2026-09-11T08:00:00+08:00')
});
assert.strictEqual(
  timestampDataset.rows.find((row) => row[11] === 'typed@example.org')[6],
  '2026-09-10'
);
assert.strictEqual(
  timestampDataset.rows.find((row) => row[11] === 'localized@example.org')[6],
  '2026-09-10'
);

console.log('Training import domain tests passed.');
