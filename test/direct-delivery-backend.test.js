const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 讀取 code.js 並透過 safe eval 測試純函式邏輯
const code = fs.readFileSync(path.join(__dirname, '../dashboard/code.js'), 'utf8');

// 1. 擷取並測試 getNotificationDeliveryModeLabel_
const labelFuncMatch = code.match(/function getNotificationDeliveryModeLabel_\([\s\S]*?\n\}/);
assert(labelFuncMatch, '必須存在 getNotificationDeliveryModeLabel_ 函式');
const getLabel = new Function(labelFuncMatch[0] + '; return getNotificationDeliveryModeLabel_;')();

assert.strictEqual(getLabel('direct'), '單封多人（互相可見）', 'direct 標籤應為 單封多人（互相可見）');
assert.strictEqual(getLabel('single_bcc'), '單封 BCC', 'single_bcc 標籤應為 單封 BCC');
assert.strictEqual(getLabel('individual'), '個人化逐封', 'individual 標籤應為 個人化逐封');
assert.strictEqual(getLabel('layered'), '分層寄送', 'layered 標籤應為 分層寄送');

// 2. 測試 buildNotificationTemplatesByDeliveryMode_
const templatesByModeMatch = code.match(/function buildNotificationTemplatesByDeliveryMode_\([\s\S]*?\n\}/);
assert(templatesByModeMatch, '必須存在 buildNotificationTemplatesByDeliveryMode_ 函式');
const mockBuildTemplateFunctions = `
function buildPersonalizedNotificationTemplate_(title) { return { title, id: 'pers' }; }
function buildAnnouncementNotificationTemplate_(title) { return { title, id: 'anno' }; }
function buildCaseStaffIndividualNotificationTemplate_(title) { return { title, id: 'case_ind' }; }
function buildCaseStaffSingleBccNotificationTemplate_(title) { return { title, id: 'case_bcc' }; }
function buildParentalLeavePersonalizedNotificationTemplate_(title) { return { title, id: 'parental' }; }
function buildCaseStaffLayeredReminderTemplateBundle_(title) { return { title, id: 'case_layer' }; }
function buildOrgGroupInitialTemplate_(title) { return { title, id: 'org_init' }; }
function buildOrgGroupReminderTemplate_(title) { return { title, id: 'org_rem' }; }
function buildLeadershipReminderIndividualTemplate_(title) { return { title, id: 'lead_ind' }; }
function buildLeadershipReminderGenericTemplate_(title) { return { title, id: 'lead_gen' }; }
`;
const getTemplatesByMode = new Function(mockBuildTemplateFunctions + templatesByModeMatch[0] + '; return buildNotificationTemplatesByDeliveryMode_;')();
const templates = getTemplatesByMode('資安教育訓練');
assert(templates.personalized && templates.personalized.direct, 'personalized 應支援 direct 模式');
assert(templates.case_staff_personalized && templates.case_staff_personalized.direct, 'case_staff_personalized 應支援 direct 模式');
assert(templates.parental_leave_personalized && templates.parental_leave_personalized.direct, 'parental_leave_personalized 應支援 direct 模式');

// 3. 測試 buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_
const tokensByModeMatch = code.match(/function buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_\([\s\S]*?\n\}/);
assert(tokensByModeMatch, '必須存在 buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_ 函式');
const getTokensByMode = new Function(tokensByModeMatch[0] + '; return buildNotificationPlaceholderTokensByTemplateAndDeliveryMode_;')();
const tokens = getTokensByMode();
assert.deepStrictEqual(tokens.personalized.direct, ['{{課程名稱}}', '{{上課網址}}'], 'personalized.direct 變數清單不正確');
assert.deepStrictEqual(tokens.case_staff_personalized.direct, ['{{課程名稱}}', '{{上課網址}}'], 'case_staff_personalized.direct 變數清單不正確');
assert.deepStrictEqual(tokens.parental_leave_personalized.direct, ['{{課程名稱}}', '{{上課網址}}'], 'parental_leave_personalized.direct 變數清單不正確');

// 4. 檢查 executeTrainingNotification_ 提示字串與失敗紀錄名稱
assert(code.includes('單封多人收件人含 CC 共'), '應包含單封多人超額提示');
assert(code.includes("name: '單封多人'"), '失敗紀錄應標示為 單封多人');

console.log('Task 1 測試通過！');
