const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 檢查 HTML 標籤
assert(html.includes('<option value="direct">單封多人（互相可見）</option>'), '選單選項應為 單封多人（互相可見）');
assert(html.includes('副本 CC（單封多人專用）'), 'CC 欄位標籤應為 副本 CC（單封多人專用）');
assert(html.includes("direct: '單封多人（互相可見）'"), '前端 getNotificationDeliveryModeLabel direct 標籤應為 單封多人（互相可見）');

// 測試 getSelectedNotificationTemplateDefinition 邏輯（不應有寫死的 if direct 強制轉 announcement）
assert(!html.includes("if (normalizedDeliveryMode === 'direct') {\n        return state.notification.templates.announcement"), '不應暴力強制將 direct 轉為 announcement');

console.log('Task 2 測試通過！');
