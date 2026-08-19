const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codePath = path.resolve(__dirname, '../code.js');
const code = fs.readFileSync(codePath, 'utf8');

// 檢查 doGet 邏輯
assert(code.includes("e.parameter.page") || code.includes("parameter.page"), 'doGet 必須檢查 e.parameter.page');
assert(code.includes("createTemplateFromFile('stats')"), '當 page 為 stats 時必須載入 stats.html 模板');
assert(code.includes("createTemplateFromFile('index')"), '預設情況下必須載入 index.html 模板');

console.log('✓ 路由分流規格檢查通過！');
