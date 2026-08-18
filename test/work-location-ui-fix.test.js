const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 驗證篩選面板具備層級堆疊 (filters-panel z-index)
assert(html.includes('filters-panel'), '篩選區塊 section 必須有 filters-panel class');
assert(/\.filters-panel\s*\{[^}]*z-index:\s*(?:[1-9]\d*)/.test(html), '.filters-panel 必須設定明確的 z-index');

// 2. 驗證 multiselect-dropdown 與 custom-multiselect 的 z-index
assert(/\.custom-multiselect\s*\{[^}]*z-index:\s*(?:[1-9]\d*)/.test(html), '.custom-multiselect 必須設定 z-index');

// 3. 驗證選項 checkbox 尺寸已重設為緊湊適中尺寸 (16px 或 18px)，而非繼承 46px
assert(/\.multiselect-option-item\s+input[^}]*width:\s*1[4-8]px/.test(html), '.multiselect-option-item input 必須設定 14-18px 寬度');
assert(/\.multiselect-option-item\s+input[^}]*height:\s*1[4-8]px/.test(html), '.multiselect-option-item input 必須設定 14-18px 高度');

console.log('UI Fix 測試通過！');
