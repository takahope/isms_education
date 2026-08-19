const assert = require('assert');
const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '../stats.html');
assert(fs.existsSync(htmlPath), 'stats.html 檔案必須存在');
const html = fs.readFileSync(htmlPath, 'utf8');

// 1. 檢查關鍵 UI 元素
assert(html.includes('id="digital-clock"'), '必須包含即時時鐘容器 #digital-clock');
assert(html.includes('id="percentage-value"'), '必須包含完成率容器 #percentage-value');
assert(html.includes('id="progress-bar"'), '必須包含進度條 #progress-bar');
assert(html.includes('id="total-count"'), '必須包含應訓總人數容器 #total-count');
assert(html.includes('id="passed-count"'), '必須包含已通過人數容器 #passed-count');
assert(html.includes('id="incomplete-count"'), '必須包含待完成人數容器 #incomplete-count');
assert(html.includes('id="search-input"'), '必須包含關鍵字搜尋框 #search-input');
assert(html.includes('id="tab-incomplete"'), '必須包含待完成名單 Tab #tab-incomplete');
assert(html.includes('id="tab-all"'), '必須包含全部名單 Tab #tab-all');
assert(html.includes('id="learners-table-body"'), '必須包含人員清單 tbody #learners-table-body');
assert(html.includes('getSimpleTrainingStats'), '前端必須調用 google.script.run.getSimpleTrainingStats');

// 2. 驗證隱私安全：HTML 中不包含任何分數欄位標題
assert(!html.includes('<th>分數</th>') && !html.includes('<th>測驗分數</th>'), '表格標題不得包含分數欄位');

console.log('✓ 前端介面與互動結構測試通過！');
