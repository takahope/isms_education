const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.html'), 'utf8');

// 1. 檢查 HTML 結構
assert(html.includes('id="location-multiselect-container"'), '必須包含 location-multiselect-container');
assert(html.includes('id="location-selected-summary"'), '必須包含 location-selected-summary');
assert(html.includes('locations: []'), 'state.filters 預設 locations 必須為空陣列');

// 2. 檢查 applyFilters 與 searchHaystack 是否整合 location
assert(html.includes('state.filters.locations.includes(learner.location)'), 'applyFilters 需比對 locations');
assert(html.includes('learner.location'), 'searchHaystack 需包含 learner.location');

// 3. 檢查表格呈現是否包含地點標註
assert(html.includes('📍'), '學員明細表格需包含地點圖示標籤');

console.log('Task 2 測試通過！');
