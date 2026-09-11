const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('mention.html', 'utf8');

[
  'training-import-btn',
  'training-import-modal',
  'training-import-course-select',
  'training-import-table-head',
  'training-import-table-body',
  'training-import-confirm'
].forEach((id) => {
  assert(html.includes(`id="${id}"`), `缺少 #${id}`);
});

assert(html.includes('📨 寄送時數匯入檔'));
assert(html.includes('.listTrainingImportCourses()'));
assert(html.includes('.previewTrainingImportEmail({ courseTitle'));
assert(html.includes('.executeTrainingImportEmail({'));
assert(!html.includes('TRAINING_IMPORT_RECIPIENT_EMAIL ='));

class MockClassList {
  constructor() {
    this.values = new Set(['hidden']);
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class MockElement {
  constructor(tagName, id) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.classList = new MockClassList();
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.listeners = {};
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  dispatchEvent(event) {
    (this.listeners[event.type] || []).forEach((listener) => listener.call(this, event));
  }
}

const elementTags = {
  'training-import-modal': 'div',
  'training-import-course-select': 'select',
  'training-import-recipient': 'span',
  'training-import-subject': 'span',
  'training-import-body': 'div',
  'training-import-filename': 'span',
  'training-import-summary': 'span',
  'training-import-table-head': 'thead',
  'training-import-table-body': 'tbody',
  'training-import-errors': 'div',
  'training-import-cancel': 'button',
  'training-import-confirm': 'button'
};
const elements = Object.keys(elementTags).reduce((all, id) => {
  all[id] = new MockElement(elementTags[id], id);
  return all;
}, {});
const courseSelect = elements['training-import-course-select'];
const confirmButton = elements['training-import-confirm'];
const modal = elements['training-import-modal'];

const documentMock = {
  getElementById(id) {
    if (!elements[id]) elements[id] = new MockElement('div', id);
    return elements[id];
  },
  createElement(tagName) {
    return new MockElement(tagName);
  },
  addEventListener() {},
  querySelectorAll() {
    return [];
  }
};

const rpcCalls = [];
const handlers = [];
const swalCalls = [];
function createRpcChain(request) {
  const handlersForRequest = request || { success: null, failure: null };
  return {
    withSuccessHandler(handler) {
      return createRpcChain(Object.assign({}, handlersForRequest, { success: handler }));
    },
    withFailureHandler(handler) {
      return createRpcChain(Object.assign({}, handlersForRequest, { failure: handler }));
    },
    listTrainingImportCourses() {
      rpcCalls.push({ method: 'listTrainingImportCourses' });
      handlers.push(handlersForRequest);
    },
    previewTrainingImportEmail(payload) {
      rpcCalls.push({ method: 'previewTrainingImportEmail', payload });
      handlers.push(handlersForRequest);
    },
    executeTrainingImportEmail(payload) {
      rpcCalls.push({ method: 'executeTrainingImportEmail', payload });
      handlers.push(handlersForRequest);
    }
  };
}

const scripts = [];
const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
let match;
while ((match = scriptPattern.exec(html))) scripts.push(match[1]);

const sandbox = {
  console: { error() {}, warn() {}, log() {}, group() {}, groupEnd() {}, table() {} },
  document: documentMock,
  google: { script: { run: createRpcChain() } },
  window: { location: { href: 'https://example.test/mention' } },
  Swal: {
    fire() { swalCalls.push(Array.from(arguments)); },
    close() {},
    showLoading() {}
  },
  alert() {},
  setTimeout() {},
  clearTimeout,
  Date,
  Array,
  Object,
  String,
  Number,
  Math,
  JSON
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
scripts.forEach((script) => vm.runInContext(script, sandbox));

function latestHandler(method) {
  const index = rpcCalls.map((call) => call.method).lastIndexOf(method);
  assert(index >= 0, `預期 ${method} RPC`);
  return handlers[index];
}

function previewResult(overrides) {
  return Object.assign({
    success: true,
    canSend: true,
    courseTitle: '課程甲',
    previewHash: 'a'.repeat(64),
    rows: [new Array(14).fill('值')],
    headers: new Array(14).fill('欄位'),
    recipientEmail: 'receiver@example.org',
    subject: '主旨',
    htmlBody: '<p>內容</p>',
    attachmentName: 'importtemplate_v20260911.xlsx',
    counts: { pending: 1, sent: 0, preparing: 0, errors: 0 },
    errors: []
  }, overrides || {});
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// 斷開「預覽後仍可直接寄送」的保護，應使這個流程測試失敗。
sandbox.openTrainingImportModal();
assert.strictEqual(courseSelect.value, '');
assert.strictEqual(confirmButton.disabled, true);
assert.strictEqual(rpcCalls[0].method, 'listTrainingImportCourses');
const firstCourseListHandler = latestHandler('listTrainingImportCourses');
sandbox.closeTrainingImportModal();
sandbox.openTrainingImportModal();
const currentCourseListHandler = latestHandler('listTrainingImportCourses');
firstCourseListHandler.success({
  success: true,
  courses: [{ courseTitle: '過期課程' }]
});
assert.strictEqual(courseSelect.children.length, 1);
currentCourseListHandler.success({
  success: true,
  courses: [{ courseTitle: '課程甲' }, { courseTitle: '課程乙' }]
});

courseSelect.value = '課程甲';
courseSelect.dispatchEvent({ type: 'change', target: courseSelect });
assert.deepStrictEqual(plain(rpcCalls[2]), {
  method: 'previewTrainingImportEmail',
  payload: { courseTitle: '課程甲' }
});
assert.strictEqual(confirmButton.disabled, true);
const courseAPreviewHandler = latestHandler('previewTrainingImportEmail');

sandbox.renderTrainingImportPreview(previewResult({
  rows: [['<script>bad()</script>'].concat(new Array(13).fill('值'))],
  headers: ['<b>危險欄位</b>'].concat(new Array(13).fill('欄位')),
  canSend: false,
  errors: [{
    email: 'bad@example.org',
    name: '王小明',
    message: '<img src=x onerror=bad()>'
  }]
}));
assert.strictEqual(elements['training-import-table-head'].children[0].children.length, 14);
assert.strictEqual(elements['training-import-table-body'].children.length, 1);
assert.strictEqual(elements['training-import-table-body'].children[0].children.length, 14);
assert.strictEqual(elements['training-import-table-body'].children[0].children[0].textContent, '<script>bad()</script>');
assert.strictEqual(
  elements['training-import-errors'].textContent,
  '王小明（bad@example.org）：<img src=x onerror=bad()>'
);
assert.strictEqual(elements['training-import-body'].innerHTML, '<p>內容</p>');
assert.strictEqual(elements['training-import-summary'].textContent, '待寄送 0 筆；已寄出 0 筆；準備中 0 筆；可重試失敗 0 筆；異常 0 筆。');
assert.strictEqual(confirmButton.disabled, true);

sandbox.renderTrainingImportPreview(previewResult({
  canSend: false,
  previewHash: '',
  rows: [],
  pendingCount: 0,
  preparingCount: 4,
  errorCount: 1,
  errors: [{ email: '', name: '', message: '準備寄送紀錄需人工確認。' }]
}));
assert.strictEqual(elements['training-import-summary'].textContent, '待寄送 0 筆；已寄出 0 筆；準備中 4 筆；可重試失敗 0 筆；異常 1 筆。');
assert.strictEqual(confirmButton.disabled, true);

courseSelect.value = '課程乙';
courseSelect.dispatchEvent({ type: 'change', target: courseSelect });
assert.deepStrictEqual(plain(rpcCalls[3]), {
  method: 'previewTrainingImportEmail',
  payload: { courseTitle: '課程乙' }
});
assert.strictEqual(confirmButton.disabled, true);
const courseBPreviewHandler = latestHandler('previewTrainingImportEmail');
courseSelect.value = '課程甲';
courseSelect.dispatchEvent({ type: 'change', target: courseSelect });
const currentCourseAPreviewHandler = latestHandler('previewTrainingImportEmail');
courseAPreviewHandler.success(previewResult());
assert.strictEqual(confirmButton.disabled, true);
courseBPreviewHandler.success(previewResult({
  courseTitle: '課程乙',
  previewHash: 'b'.repeat(64)
}));
assert.strictEqual(confirmButton.disabled, true);
currentCourseAPreviewHandler.success(previewResult({
  courseTitle: '課程甲',
  previewHash: 'c'.repeat(64)
}));
assert.strictEqual(confirmButton.disabled, false);

courseSelect.value = '課程乙';
courseSelect.dispatchEvent({ type: 'change', target: courseSelect });
assert.strictEqual(confirmButton.disabled, true);
sandbox.confirmTrainingImportSend();
assert.strictEqual(rpcCalls.filter((call) => call.method === 'executeTrainingImportEmail').length, 0);

latestHandler('previewTrainingImportEmail').success(previewResult({
  courseTitle: '課程乙',
  previewHash: 'b'.repeat(64),
  pendingCount: 1,
  alreadySentCount: 2,
  preparingCount: 3,
  retryableFailureCount: 4,
  errorCount: 5
}));
assert.strictEqual(elements['training-import-summary'].textContent, '待寄送 1 筆；已寄出 2 筆；準備中 3 筆；可重試失敗 4 筆；異常 5 筆。');
confirmButton.dispatchEvent({ type: 'click', target: confirmButton });
assert.deepStrictEqual(plain(rpcCalls[rpcCalls.length - 1]), {
  method: 'executeTrainingImportEmail',
  payload: { courseTitle: '課程乙', previewHash: 'b'.repeat(64) }
});
assert.strictEqual(confirmButton.disabled, true);
assert.strictEqual(elements['training-import-cancel'].disabled, true);
assert.strictEqual(courseSelect.disabled, true);
courseSelect.value = '課程甲';
courseSelect.dispatchEvent({ type: 'change', target: courseSelect });
assert.strictEqual(courseSelect.value, '課程乙');
assert.strictEqual(rpcCalls.filter((call) => call.method === 'previewTrainingImportEmail').length, 4);
latestHandler('previewTrainingImportEmail').success(previewResult({
  courseTitle: '課程乙',
  previewHash: 'c'.repeat(64)
}));
assert.strictEqual(confirmButton.disabled, true);
assert.strictEqual(elements['training-import-cancel'].disabled, true);
assert.strictEqual(courseSelect.disabled, true);
latestHandler('executeTrainingImportEmail').failure(new Error('寄送失敗'));
assert.strictEqual(rpcCalls.filter((call) => call.method === 'previewTrainingImportEmail').length, 5);
assert.strictEqual(confirmButton.disabled, true);
assert.strictEqual(elements['training-import-cancel'].disabled, false);
assert.strictEqual(courseSelect.disabled, false);
assert.match(JSON.stringify(swalCalls[swalCalls.length - 1]), /寄送失敗|狀態未確認/);

latestHandler('previewTrainingImportEmail').success(previewResult({
  courseTitle: '課程乙',
  previewHash: 'd'.repeat(64)
}));
assert.strictEqual(confirmButton.disabled, false);

confirmButton.dispatchEvent({ type: 'click', target: confirmButton });
latestHandler('executeTrainingImportEmail').success({
  success: false,
  batchId: 'batch-warning',
  sentCount: 4,
  attachmentName: 'importtemplate_v20260911.xlsx',
  mailAccepted: true,
  requiresManualReview: true,
  message: 'MailApp 已接受，實際投遞狀態未知，請人工對帳。'
});
assert.strictEqual(modal.classList.contains('hidden'), false);
assert.strictEqual(confirmButton.disabled, true);
assert.strictEqual(rpcCalls.filter((call) => call.method === 'previewTrainingImportEmail').length, 6);
const warningText = JSON.stringify(swalCalls[swalCalls.length - 1]);
assert.match(warningText, /batch-warning/);
assert.match(warningText, /4/);
assert.match(warningText, /importtemplate_v20260911\.xlsx/);
assert.match(warningText, /人工對帳|投遞狀態未知/);

latestHandler('previewTrainingImportEmail').success(previewResult({
  courseTitle: '課程乙',
  canSend: false,
  previewHash: '',
  rows: [],
  pendingCount: 0,
  preparingCount: 4,
  errorCount: 1,
  errors: [{ email: '', name: '', message: '準備寄送紀錄需人工確認。' }]
}));
assert.strictEqual(confirmButton.disabled, true);

sandbox.renderTrainingImportPreview(previewResult({
  courseTitle: '課程乙',
  previewHash: 'e'.repeat(64),
  pendingCount: 2
}));
confirmButton.dispatchEvent({ type: 'click', target: confirmButton });
latestHandler('executeTrainingImportEmail').success({
  success: true,
  batchId: 'batch-success',
  sentCount: 2,
  attachmentName: 'importtemplate_v20260911.xlsx',
  mailAccepted: true,
  requiresManualReview: false,
  message: 'MailApp 已接受寄送要求。'
});
assert.strictEqual(modal.classList.contains('hidden'), true);
assert.strictEqual(confirmButton.disabled, true);
assert.strictEqual(rpcCalls.filter((call) => call.method === 'previewTrainingImportEmail').length, 7);
const successText = JSON.stringify(swalCalls[swalCalls.length - 1]);
assert.match(successText, /batch-success/);
assert.match(successText, /2/);
assert.match(successText, /importtemplate_v20260911\.xlsx/);
assert.strictEqual(rpcCalls.filter((call) => call.method === 'listTrainingImportCourses').length, 2);

console.log('training import frontend behavior: PASS');
