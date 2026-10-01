'use strict';

let aiIndexManagerReturnFocus = null;
let aiIndexManagerReturnToConfig = false;
let aiIndexManagerSetup = false;

const aiIndexStatusLabels = Object.freeze({
  ready: '正常',
  building: '构建中',
  stale: '待更新',
  orphan: '孤儿索引',
  corrupt: '需检查',
  missing: '文件缺失',
  temporary: '临时文件',
  unknown: '待确认'
});

function aiIndexElement(id) {
  return document.getElementById(id);
}

function formatAiIndexBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function syncAiIndexManagerAccess() {
  const entry = aiIndexElement('btnOpenAiIndexManager');
  const visible = Boolean(state.session?.isAdmin);
  if (entry) entry.hidden = !visible;
  return visible;
}

function setAiIndexManagerStatus(message, type = 'normal') {
  const element = aiIndexElement('aiIndexManagerStatus');
  if (!element) return;
  element.textContent = message;
  element.dataset.status = type;
}

function renderAiIndexManager(data) {
  const summary = data?.summary || {};
  const summaryElement = aiIndexElement('aiIndexManagerSummary');
  const list = aiIndexElement('aiIndexManagerList');
  if (!summaryElement || !list) return;
  summaryElement.textContent = '索引 ' + (summary.total || 0)
    + ' 个 · 占用 ' + formatAiIndexBytes(summary.sizeBytes)
    + (summary.orphan || summary.corrupt || summary.missing ? ' · 需要处理 ' + (
      (summary.orphan || 0) + (summary.corrupt || 0) + (summary.missing || 0)
    ) + ' 个' : '');
  list.replaceChildren();
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'ai-index-manager-empty';
    empty.textContent = '当前还没有本地检索索引。';
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'ai-index-manager-item';
    const title = document.createElement('div');
    title.className = 'ai-index-manager-item-title';
    title.textContent = item.title || '未命名书籍';
    const meta = document.createElement('div');
    meta.className = 'ai-index-manager-item-meta';
    meta.textContent = (item.format || '未知格式') + ' · ' + formatAiIndexBytes(item.sizeBytes);
    const status = document.createElement('span');
    status.className = 'ai-index-manager-item-status';
    status.dataset.status = item.status || 'unknown';
    status.textContent = aiIndexStatusLabels[item.status] || aiIndexStatusLabels.unknown;
    const header = document.createElement('div');
    header.className = 'ai-index-manager-item-header';
    header.append(title, status);
    const details = document.createElement('div');
    details.className = 'ai-index-manager-item-details';
    details.append(meta);
    const indexed = document.createElement('span');
    if (item.indexedAt) {
      indexed.textContent = '更新于 ' + new Date(item.indexedAt).toLocaleString();
      if (item.indexedAtSource === 'file-mtime') {
        indexed.title = '索引清单缺少建立记录，显示索引文件最后更新时间';
      }
    } else {
      indexed.textContent = '更新时间未知';
    }
    details.append(indexed);
    const actions = document.createElement('div');
    actions.className = 'ai-index-manager-item-actions';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'ai-index-manager-delete';
    deleteButton.dataset.bookId = item.bookId || '';
    deleteButton.textContent = '删除索引';
    deleteButton.disabled = item.status === 'building';
    deleteButton.title = deleteButton.disabled ? '索引正在使用' : '删除后下次使用时自动重建';
    actions.appendChild(deleteButton);
    row.append(header, details, actions);
    list.appendChild(row);
  }
}

async function refreshAiIndexManager() {
  setAiIndexManagerStatus('正在读取索引状态…', 'loading');
  try {
    const data = await browserHost.listAiIndexes();
    renderAiIndexManager(data);
    setAiIndexManagerStatus(data?.manifestRecovered ? '索引清单已恢复，请重新读取确认状态。' : '状态已更新。', data?.manifestRecovered ? 'warning' : 'normal');
    return data;
  } catch (error) {
    setAiIndexManagerStatus(error.message || '索引状态读取失败，请重试。', 'error');
    return null;
  }
}

function closeAiIndexManager({ restoreFocus = true } = {}) {
  if (typeof readerSurfaceController !== 'undefined') {
    readerSurfaceController.close({ surface: 'ai-index', restoreFocus: false });
  }
  const focusTarget = aiIndexManagerReturnFocus;
  aiIndexManagerReturnFocus = null;
  if (aiIndexManagerReturnToConfig && typeof openAiConfigSheet === 'function') {
    aiIndexManagerReturnToConfig = false;
    void openAiConfigSheet();
    return true;
  }
  if (restoreFocus && focusTarget?.isConnected) focusTarget.focus();
  return true;
}

async function openAiIndexManager(trigger = document.activeElement, { fromConfig = false } = {}) {
  if (!syncAiIndexManagerAccess()) return false;
  if (typeof readerSurfaceController === 'undefined') return false;
  aiIndexManagerReturnFocus = trigger;
  aiIndexManagerReturnToConfig = Boolean(fromConfig);
  if (fromConfig && typeof closeAiConfigSheet === 'function') {
    closeAiConfigSheet({ restoreFocus: false });
  }
  if (!readerSurfaceController.activate('ai-index', trigger, { focus: false })) return false;
  void refreshAiIndexManager();
  requestAnimationFrame(() => aiIndexElement('btnCloseAiIndexManager')?.focus());
  return true;
}

async function deleteAiIndexFromManager(bookId) {
  if (!bookId || !window.confirm('删除这个索引？下次使用本书时会自动重建。')) return false;
  setAiIndexManagerStatus('正在删除索引…', 'loading');
  try {
    await browserHost.deleteAiIndex(bookId);
    await refreshAiIndexManager();
    return true;
  } catch (error) {
    setAiIndexManagerStatus(error.message || '索引删除失败，请重试。', 'error');
    return false;
  }
}

async function cleanupAiIndexesFromManager() {
  if (!window.confirm('清理已不在书库中的孤儿索引和过期临时文件？')) return false;
  setAiIndexManagerStatus('正在清理…', 'loading');
  try {
    const result = await browserHost.cleanupAiIndexes('all');
    await refreshAiIndexManager();
    setAiIndexManagerStatus('已清理 ' + (result?.deleted?.length || 0) + ' 项。', 'normal');
    return true;
  } catch (error) {
    setAiIndexManagerStatus(error.message || '清理失败，请重试。', 'error');
    return false;
  }
}

function setupAiIndexManager() {
  if (aiIndexManagerSetup) return;
  aiIndexManagerSetup = true;
  syncAiIndexManagerAccess();
  aiIndexElement('btnOpenAiIndexManager')?.addEventListener('click', (event) => {
    void openAiIndexManager(event.currentTarget, { fromConfig: true });
  });
  aiIndexElement('btnCloseAiIndexManager')?.addEventListener('click', () => closeAiIndexManager());
  aiIndexElement('btnRefreshAiIndexes')?.addEventListener('click', () => void refreshAiIndexManager());
  aiIndexElement('btnCleanupAiIndexes')?.addEventListener('click', () => void cleanupAiIndexesFromManager());
  aiIndexElement('aiIndexManagerList')?.addEventListener('click', (event) => {
    const button = event.target.closest?.('.ai-index-manager-delete');
    if (button && !button.disabled) void deleteAiIndexFromManager(button.dataset.bookId);
  });
}

window.__zhenshuAiIndexApi = {
  syncAiIndexManagerAccess,
  renderAiIndexManager,
  refreshAiIndexManager,
  openAiIndexManager,
  closeAiIndexManager,
  setupAiIndexManager
};
