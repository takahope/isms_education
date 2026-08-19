const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查靜態代碼包含必要防呆驗證與提示文字
assert(html.includes('目前篩選範圍內無學員資料可供匯出'), '需包含空資料時的提示文字');
assert(html.includes('generateExportFileName('), '需定義 generateExportFileName 函式');
assert(html.includes('教育訓練報告_'), '檔名需以 教育訓練報告_ 開頭');
assert(html.includes('XLSX.writeFile('), '需調用 XLSX.writeFile 觸發下載');
assert(html.includes('已成功匯出教育訓練報告'), '需包含成功匯出的提示訊息');

// 2. 提取內嵌腳本進行動態行為與整合測試
const inlineScripts = [];
const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRegex.exec(html)) !== null) {
  if (match[1].trim()) {
    inlineScripts.push(match[1]);
  }
}
assert(inlineScripts.length > 0, '無法於 dashboard.html 中找到內嵌 script 區塊');
const scriptContent = inlineScripts.join('\n').replace('const state =', 'var state =');

// 建立 Mock DOM 與環境
let alertMessages = [];
let swalCalls = [];
let writtenFiles = [];

const mockBtn = {
  textContent: '📊 匯出報告',
  disabled: false,
  classList: { add: () => {}, remove: () => {} },
  value: ''
};

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
  },
  writeFile(wb, filename) {
    writtenFiles.push({ wb, filename });
  }
};

const mockSwal = {
  fire(titleOrOptions, message, icon) {
    swalCalls.push({ titleOrOptions, message, icon });
    return Promise.resolve({ isConfirmed: true });
  }
};

const sandbox = {
  console,
  document: {
    getElementById(id) {
      if (id === 'export-report-btn') return mockBtn;
      return {
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} },
        value: '',
        textContent: '',
        checked: false
      };
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  window: {},
  XLSX: mockXLSX,
  Swal: mockSwal,
  alert(msg) {
    alertMessages.push(msg);
  },
  Date
};
vm.createContext(sandbox);
vm.runInContext(scriptContent, sandbox);

const { generateExportFileName, exportTrainingReport } = sandbox;

// 3. 測試 generateExportFileName
assert(typeof generateExportFileName === 'function', 'generateExportFileName 需為函式');

const fixedDate = new Date(2026, 7, 18, 23, 22, 5); // 2026-08-18 23:22:05
const filename1 = generateExportFileName('113年下半年資通安全教育訓練', fixedDate);
assert.strictEqual(
  filename1,
  '教育訓練報告_113年下半年資通安全教育訓練_20260818_2322.xlsx',
  '檔名格式應為 教育訓練報告_{課程名稱}_{YYYYMMDD_HHmm}.xlsx'
);

// 測試非法字元過濾
const filenameWithIllegalChars = generateExportFileName('113年/下半年:資安*教育?訓練"測試<1>|結束\\', fixedDate);
assert.strictEqual(
  filenameWithIllegalChars,
  '教育訓練報告_113年_下半年_資安_教育_訓練_測試_1__結束__20260818_2322.xlsx',
  '非法字元應被替換為底線'
);

// 測試空課程名稱預設值
const filenameEmptyCourse = generateExportFileName('', fixedDate);
assert(filenameEmptyCourse.startsWith('教育訓練報告_') && filenameEmptyCourse.endsWith('_20260818_2322.xlsx'), '空課程名稱應有預設檔名');

// 4. 測試 exportTrainingReport 防呆與正常流程
// 4.1 空名單防呆測試
sandbox.state = {
  courseTitle: '測試課程',
  viewerEmail: 'test@corp.com',
  filters: { search: '', status: '', unit: '', locations: [], incompleteOnly: false, excludeEgc: true },
  allLearners: []
};

swalCalls = [];
writtenFiles = [];
exportTrainingReport();
assert.strictEqual(writtenFiles.length, 0, '學員名單為空時不應觸發 XLSX.writeFile');
assert(
  swalCalls.some(call => JSON.stringify(call).includes('目前篩選範圍內無學員資料可供匯出')),
  '學員名單為空時需顯示警示訊息'
);
assert.strictEqual(mockBtn.disabled, false, '空名單中斷後按鈕應恢復為未禁用狀態');

// 4.2 正常匯出流程測試
sandbox.state.allLearners = [
  {
    name: '王大明',
    email: 'ming@corp.com',
    location: '台北',
    assignmentOrgName: '資訊部',
    assignmentTitle: '主管',
    personnelStatus: '在職',
    watchedPercent: 100,
    watchedSecondsCount: 3600,
    watchCompleted: true,
    bestScore: 100,
    latestScore: 100,
    latestResult: '通過',
    attemptCount: 1,
    status: 'completed',
    statusLabel: '已完成',
    lastActivityAt: '2026-08-18 10:00:00'
  }
];

swalCalls = [];
writtenFiles = [];
mockBtn.disabled = false;
mockBtn.textContent = '📊 匯出報告';

exportTrainingReport();

assert.strictEqual(writtenFiles.length, 1, '正常流程應觸發一次 XLSX.writeFile');
assert(writtenFiles[0].filename.startsWith('教育訓練報告_測試課程_'), '匯出檔名應正確包含課程名稱');
assert(writtenFiles[0].filename.endsWith('.xlsx'), '匯出檔名副檔名應為 .xlsx');
assert.strictEqual(mockBtn.disabled, false, '匯出完成後按鈕應恢復啟用');
assert.strictEqual(mockBtn.textContent, '📊 匯出報告', '匯出完成後按鈕文字應恢復原狀');
assert(
  swalCalls.some(call => JSON.stringify(call).includes('已成功匯出教育訓練報告')),
  '匯出成功後需顯示成功 Toast 提示'
);

// 4.3 測試例外錯誤處理與按鈕狀態還原 (Error Recovery)
const originalWriteFile = mockXLSX.writeFile;
mockXLSX.writeFile = () => {
  throw new Error('磁碟空間不足');
};

swalCalls = [];
writtenFiles = [];
mockBtn.disabled = false;
mockBtn.textContent = '📊 匯出報告';

exportTrainingReport();

assert.strictEqual(mockBtn.disabled, false, '發生例外後按鈕應恢復為可點擊');
assert.strictEqual(mockBtn.textContent, '📊 匯出報告', '發生例外後按鈕文字應恢復原狀');
assert(
  swalCalls.some(call => JSON.stringify(call).includes('磁碟空間不足') || JSON.stringify(call).includes('匯出失敗')),
  '發生例外時需顯示錯誤提示'
);

mockXLSX.writeFile = originalWriteFile;

console.log('Task 3 測試通過：匯出整合處理、防呆與下載邏輯正確！');
