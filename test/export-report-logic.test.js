const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 驗證核心函式存在於 HTML 腳本中
assert(html.includes('function formatFiltersSummary('), '需定義 formatFiltersSummary 函式');
assert(html.includes('function formatExportDateTime('), '需定義 formatExportDateTime 函式');
assert(html.includes('function buildSummarySheetAoa('), '需定義 buildSummarySheetAoa 函式');
assert(html.includes('function buildLearnerDetailsSheetAoa('), '需定義 buildLearnerDetailsSheetAoa 函式');
assert(html.includes('function calculateColWidths('), '需定義 calculateColWidths 函式');
assert(html.includes('function buildExportWorkbook('), '需定義 buildExportWorkbook 函式');

// 2. 驗證 15 欄欄位定義完整
const expectedHeaders = [
  '姓名', '電子郵件', '工作地點', '所屬單位', '職務名稱',
  '人員狀態', '觀看進度', '累計觀看秒數', '影片觀看合格', '測驗最佳分數',
  '測驗最新分數', '測驗最新結果', '測驗測驗次數', '最終訓練狀態', '最後活動時間'
];

for (const header of expectedHeaders) {
  assert(html.includes(`'${header}'`) || html.includes(`"${header}"`), `學員明細表頭需包含欄位: ${header}`);
}

// 3. 動態執行與邏輯單元測試
// 提取包含內嵌程式碼的 <script> 區塊
const inlineScripts = [];
const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRegex.exec(html)) !== null) {
  if (match[1].trim()) {
    inlineScripts.push(match[1]);
  }
}
assert(inlineScripts.length > 0, '無法於 dashboard.html 中找到內嵌 script 區塊');
const scriptContent = inlineScripts.join('\n');

const mockXLSX = {
  utils: {
    book_new() {
      return { SheetNames: [], Sheets: {} };
    },
    aoa_to_sheet(aoa) {
      return { '!data': aoa };
    },
    book_append_sheet(wb, ws, name) {
      wb.SheetNames.push(name);
      wb.Sheets[name] = ws;
    }
  }
};

const sandbox = {
  console,
  document: {
    addEventListener: () => {},
    getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, value: '' }),
    querySelectorAll: () => []
  },
  window: {},
  XLSX: mockXLSX,
  Date
};
vm.createContext(sandbox);

// 執行腳本以載入函式
vm.runInContext(scriptContent, sandbox);

const {
  formatFiltersSummary,
  formatExportDateTime,
  buildSummarySheetAoa,
  buildLearnerDetailsSheetAoa,
  calculateColWidths,
  buildExportWorkbook
} = sandbox;

// 測試 formatExportDateTime
const testDate = new Date(2026, 7, 18, 23, 22, 5); // 2026-08-18 23:22:05
const formattedDateStr = formatExportDateTime(testDate);
assert.strictEqual(formattedDateStr, '2026-08-18 23:22:05', 'formatExportDateTime 應格式化為 YYYY-MM-DD HH:mm:ss');

// 測試 formatFiltersSummary
const defaultFiltersSummary = formatFiltersSummary({
  search: '',
  status: '',
  unit: '',
  locations: [],
  incompleteOnly: false,
  excludeEgc: true
});
assert(Array.isArray(defaultFiltersSummary), 'formatFiltersSummary 應回傳陣列');
assert(defaultFiltersSummary.some(row => (Array.isArray(row) ? row[0] : row).includes('排除倫理委員會')), '需包含排除倫理委員會項目');

const customFiltersSummary = formatFiltersSummary({
  search: '王小明',
  status: 'completed',
  unit: '資訊部',
  locations: ['台北', '台中'],
  incompleteOnly: true,
  excludeEgc: false
});
const summaryMap = new Map(customFiltersSummary.map(row => Array.isArray(row) ? [row[0], row[1]] : [row, '']));
assert(summaryMap.get('關鍵字搜尋').includes('王小明'), '關鍵字搜尋應包含王小明');
assert.strictEqual(summaryMap.get('訓練狀態'), '已完成', 'status completed 應轉換為 已完成');
assert.strictEqual(summaryMap.get('所屬單位'), '資訊部', '所屬單位應為資訊部');
assert.strictEqual(summaryMap.get('工作地點'), '台北、台中', '工作地點應為 台北、台中');
assert.strictEqual(summaryMap.get('僅顯示未完成'), '是', '僅顯示未完成應為 是');
assert.strictEqual(summaryMap.get('排除倫理委員會'), '否', '排除倫理委員會應為 否');

// 測試 buildSummarySheetAoa
const meta = { courseTitle: '資安教育訓練 2026', exportTime: '2026-08-18 23:22:00', operatorEmail: 'admin@corp.com' };
const kpis = { total: 10, completed: 8, pendingQuiz: 1, inProgress: 1, notStarted: 0, recentActive: 5, completionRate: 80 };
const units = [{ unitName: '資訊部', total: 10, completed: 8, completionRate: 80 }];
const summaryAoa = buildSummarySheetAoa(meta, kpis, units, customFiltersSummary);

assert(Array.isArray(summaryAoa), 'buildSummarySheetAoa 應回傳 2D 陣列');
assert(summaryAoa.some(row => row[0] === '課程名稱' && row[1] === '資安教育訓練 2026'), '需包含課程名稱');
assert(summaryAoa.some(row => row[0] === '應訓總人數' && row[1] === 10), '需包含應訓總人數為 10');
assert(summaryAoa.some(row => row[0] === '資訊部' && row[1] === 10 && row[2] === 8 && row[3] === 2 && row[4] === '80%'), '需正確計算各單位未完成人數與完成率');

// 測試 buildLearnerDetailsSheetAoa
const mockLearners = [
  {
    name: '張三',
    email: 'zhangsan@corp.com',
    location: '台北',
    assignmentOrgName: '研發部',
    assignmentTitle: '工程師',
    personnelStatus: '在職',
    watchedPercent: 100,
    watchedSecondsCount: 3600,
    watchCompleted: true,
    bestScore: 90,
    latestScore: 90,
    latestResult: '通過',
    attemptCount: 1,
    status: 'completed',
    statusLabel: '已完成',
    lastActivityAt: '2026-08-18T10:00:00.000Z'
  },
  {
    name: '李四',
    email: 'lisi@corp.com',
    location: '',
    assignmentOrgName: '',
    assignmentTitle: '',
    personnelStatus: '',
    watchedPercent: 0,
    watchedSecondsCount: 0,
    watchCompleted: false,
    bestScore: null,
    latestScore: null,
    latestResult: '',
    attemptCount: 0,
    status: 'not_started',
    statusLabel: '未開始',
    lastActivityAt: ''
  }
];

const detailsAoa = buildLearnerDetailsSheetAoa(mockLearners);
assert.strictEqual(detailsAoa.length, 3, '表頭 + 2 筆學員共 3 行');
assert.deepStrictEqual([...detailsAoa[0]], expectedHeaders, '第一行為 15 欄標準表頭');

// 驗證第一筆資料型態與內容
const row1 = detailsAoa[1];
assert.strictEqual(row1[0], '張三');
assert.strictEqual(row1[1], 'zhangsan@corp.com');
assert.strictEqual(row1[2], '台北');
assert.strictEqual(row1[3], '研發部');
assert.strictEqual(row1[4], '工程師');
assert.strictEqual(row1[5], '在職');
assert.strictEqual(row1[6], '100%');
assert.strictEqual(typeof row1[7], 'number', '累計觀看秒數需為 number 型態');
assert.strictEqual(row1[7], 3600);
assert.strictEqual(row1[8], '是');
assert.strictEqual(typeof row1[9], 'number', '測驗最佳分數需為 number 型態');
assert.strictEqual(row1[9], 90);
assert.strictEqual(typeof row1[10], 'number', '測驗最新分數需為 number 型態');
assert.strictEqual(row1[10], 90);
assert.strictEqual(row1[11], '通過');
assert.strictEqual(typeof row1[12], 'number', '測驗測驗次數需為 number 型態');
assert.strictEqual(row1[12], 1);
assert.strictEqual(row1[13], '已完成');
assert(row1[14].includes('2026'), '最後活動時間需格式化');

// 驗證第二筆空值處理
const row2 = detailsAoa[2];
assert.strictEqual(row2[2], '-', '無工作地點應顯示 -');
assert.strictEqual(row2[3], '未設定單位', '無單位應顯示 未設定單位');
assert.strictEqual(row2[4], '-', '無職稱應顯示 -');
assert.strictEqual(row2[5], '-', '無人員狀態應顯示 -');
assert.strictEqual(row2[8], '否');
assert.strictEqual(row2[9], '-', '未測驗最佳分數應為 -');
assert.strictEqual(row2[10], '-', '未測驗最新分數應為 -');
assert.strictEqual(row2[11], '未作答', '無測驗結果應顯示 未作答');
assert.strictEqual(row2[14], '無紀錄', '無活動時間應顯示 無紀錄');

// 測試 calculateColWidths
const colWidths = calculateColWidths(detailsAoa);
assert(Array.isArray(colWidths) || typeof colWidths.length === 'number', 'calculateColWidths 應回傳陣列');
assert.strictEqual(colWidths.length, 15, '應有 15 個欄寬定義');
assert(Array.from(colWidths).every(col => typeof col.wch === 'number' && col.wch >= 10), '每個欄寬需為大於等於 10 的數字');

// 測試 buildExportWorkbook
const mockState = {
  courseTitle: '資安教育訓練 2026',
  viewerEmail: 'admin@corp.com',
  filters: { search: '', status: '', unit: '', locations: [], incompleteOnly: false, excludeEgc: true }
};
const wb = buildExportWorkbook(mockLearners, kpis, units, mockState);
assert(wb, '應回傳 workbook 物件');
assert.deepStrictEqual([...wb.SheetNames], ['訓練統計摘要', '學員明細清單'], '工作表名稱必須包含 訓練統計摘要 與 學員明細清單');
assert(wb.Sheets['訓練統計摘要']['!cols'], '工作表 1 需設定 !cols');
assert(wb.Sheets['學員明細清單']['!cols'], '工作表 2 需設定 !cols');

console.log('Task 2 測試通過：匯出資料轉換與工作表建構邏輯齊全！');
