const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查 SheetJS CDN 引入
assert(
  html.includes('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'),
  '必須在 head 引入 SheetJS CDN'
);

// 2. 檢查匯出報告按鈕結構與 ID
assert(html.includes('id="export-report-btn"'), '必須包含 id="export-report-btn" 按鈕');
assert(html.includes('匯出報告'), '按鈕文字需包含 匯出報告');

// 3. 檢查事件綁定
assert(
  html.includes("document.getElementById('export-report-btn').addEventListener('click'") ||
  html.includes("document.getElementById('export-report-btn')?.addEventListener('click'"),
  'bindEvents 需綁定 export-report-btn 點擊事件'
);

console.log('Task 1 測試通過：SheetJS CDN 與匯出按鈕結構正確！');
