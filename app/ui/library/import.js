/* 枕书 UI module: library/import (admin book import, MOBI/import plan Task 5) */

'use strict';

// Mirrors the server's IMPORT_FORMATS so obviously wrong files fail instantly.
const LIBRARY_IMPORT_LIMITS_MIB = Object.freeze({
  '.epub': 64, '.pdf': 256, '.txt': 32, '.md': 32, '.markdown': 32, '.mobi': 64, '.azw': 64, '.azw3': 64
});
const LIBRARY_IMPORT_ACCEPT = Object.keys(LIBRARY_IMPORT_LIMITS_MIB).join(',');
const LIBRARY_IMPORT_STATUS_TEXT = Object.freeze({
  pending: '等待上传',
  uploading: '正在上传',
  done: '已导入',
  duplicate: '书库中已有这本书',
  failed: '导入失败',
  cancelled: '已取消',
  rejected: '无法导入'
});

const libraryImportQueue = [];
let libraryImportRunning = false;
let libraryImportSequence = 0;

function libraryImportAvailable(library) {
  return library?.features?.bookImport === true;
}

function libraryImportExtension(name) {
  const match = /\.[^.]+$/.exec(String(name || '').toLowerCase());
  return match ? match[0] : '';
}

function formatImportSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function enqueueLibraryImports(files, { collectionId = null } = {}) {
  const added = [];
  for (const file of Array.from(files || [])) {
    const limit = LIBRARY_IMPORT_LIMITS_MIB[libraryImportExtension(file.name)];
    const item = { id: ++libraryImportSequence, file, collectionId, status: 'pending', progress: 0, message: '' };
    if (!limit) {
      item.status = 'rejected';
      item.message = '只支持 EPUB、PDF、TXT、Markdown、MOBI 和 AZW3。';
    } else if (file.size > limit * 1024 * 1024) {
      item.status = 'rejected';
      item.message = `超过 ${limit} MB 的导入上限。`;
    } else if (file.size === 0) {
      item.status = 'rejected';
      item.message = '文件是空的。';
    }
    libraryImportQueue.push(item);
    added.push(item);
  }
  if (!added.length) return added;
  renderLibraryImportPanel();
  void drainLibraryImports();
  return added;
}

async function drainLibraryImports() {
  if (libraryImportRunning) return;
  libraryImportRunning = true;
  try {
    for (let item = libraryImportQueue.find((entry) => entry.status === 'pending'); item;
      item = libraryImportQueue.find((entry) => entry.status === 'pending')) {
      await runLibraryImport(item);
    }
  } finally {
    libraryImportRunning = false;
    renderLibraryImportPanel();
  }
}

async function runLibraryImport(item) {
  item.status = 'uploading';
  item.progress = 0;
  renderLibraryImportPanel();
  const upload = window.browserHost.importBook(item.file, {
    onProgress: (ratio) => {
      item.progress = ratio;
      updateLibraryImportRow(item);
    }
  });
  item.abort = upload.abort;
  try {
    const result = await upload.promise;
    item.status = 'done';
    item.book = result.book || null;
    item.message = result.name && result.name !== item.file.name ? `已保存为“${result.name}”` : '';
    if (item.collectionId && item.book?.id) {
      try {
        const organization = await window.browserHost.getLibraryOrganization();
        await window.browserHost.placeLibraryBook(item.book.id, item.collectionId, null, organization.revision);
        item.message = [item.message, '已放入当前分类'].filter(Boolean).join('，');
      } catch {
        item.message = [item.message, '未能放入当前分类，可在书库中手动整理'].filter(Boolean).join('，');
      }
    }
    await refreshLibraryAfterImport();
  } catch (error) {
    item.status = error.code === 'IMPORT_CANCELLED' ? 'cancelled'
      : error.code === 'IMPORT_DUPLICATE' ? 'duplicate' : 'failed';
    item.message = item.status === 'failed' ? (error.message || '导入失败') : '';
    item.existingBookId = error.details?.bookId || null;
  } finally {
    item.abort = null;
    renderLibraryImportPanel();
  }
}

// Only re-render while the shelf is showing, so a finished upload never
// interrupts someone who has meanwhile opened a book.
async function refreshLibraryAfterImport() {
  if (!document.body.classList.contains('is-library')) return;
  try {
    const library = await window.browserHost.getLibrary();
    if (!document.body.classList.contains('is-library')) return;
    if (typeof renderLibraryWithOrganization === 'function') await renderLibraryWithOrganization(library);
    else renderLibrary(library);
  } catch {
    // The next manual refresh shows the book; the queue already says it arrived.
  }
}

async function openImportedBook(bookId) {
  try {
    const library = await window.browserHost.getLibrary();
    const book = (library.books || []).find((entry) => entry.id === bookId && !entry.error);
    if (!book) throw new Error('书库中找不到这本书，请重新扫描。');
    await window.browserHost.openBook(book);
  } catch (error) {
    showHighlightHint(error.message || '打开失败');
  }
}

function libraryImportPanel() {
  let panel = document.getElementById('libraryImportPanel');
  if (panel) return panel;
  panel = document.createElement('section');
  panel.id = 'libraryImportPanel';
  panel.className = 'library-import-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', '导入书籍');
  panel.hidden = true;
  const header = document.createElement('div');
  header.className = 'library-import-header';
  const title = document.createElement('h2');
  title.textContent = '导入书籍';
  const summary = document.createElement('p');
  summary.className = 'library-import-summary';
  summary.setAttribute('aria-live', 'polite');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'library-import-close';
  close.textContent = '完成';
  close.addEventListener('click', () => {
    for (let index = libraryImportQueue.length - 1; index >= 0; index -= 1) {
      if (!['pending', 'uploading'].includes(libraryImportQueue[index].status)) libraryImportQueue.splice(index, 1);
    }
    renderLibraryImportPanel();
  });
  header.append(title, summary, close);
  const list = document.createElement('ol');
  list.className = 'library-import-list';
  panel.append(header, list);
  document.body.appendChild(panel);
  return panel;
}

function libraryImportStatusLine(item) {
  if (item.status === 'uploading') {
    return item.progress >= 1 ? '正在处理…' : `${LIBRARY_IMPORT_STATUS_TEXT.uploading} ${Math.round(item.progress * 100)}%`;
  }
  return [LIBRARY_IMPORT_STATUS_TEXT[item.status], item.message].filter(Boolean).join('：');
}

function updateLibraryImportRow(item) {
  const row = document.querySelector(`.library-import-item[data-import-id="${item.id}"]`);
  if (!row) return;
  row.querySelector('.library-import-status').textContent = libraryImportStatusLine(item);
  const bar = row.querySelector('.library-import-progress');
  if (bar) {
    bar.setAttribute('aria-valuenow', String(Math.round(item.progress * 100)));
    bar.firstElementChild.style.width = `${Math.round(item.progress * 100)}%`;
  }
}

function renderLibraryImportPanel() {
  const panel = libraryImportPanel();
  const list = panel.querySelector('.library-import-list');
  list.replaceChildren();
  for (const item of libraryImportQueue) {
    const row = document.createElement('li');
    row.className = 'library-import-item';
    row.dataset.importId = String(item.id);
    row.dataset.status = item.status;
    const text = document.createElement('div');
    text.className = 'library-import-text';
    const name = document.createElement('strong');
    name.textContent = item.file.name;
    name.title = item.file.name;
    const status = document.createElement('span');
    status.className = 'library-import-status';
    status.textContent = libraryImportStatusLine(item);
    text.append(name, status);
    row.appendChild(text);
    if (item.status === 'uploading') {
      const bar = document.createElement('span');
      bar.className = 'library-import-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', `${item.file.name} 上传进度`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(Math.round(item.progress * 100)));
      const fill = document.createElement('span');
      fill.style.width = `${Math.round(item.progress * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
    }
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'library-import-action';
    if (item.status === 'uploading' || item.status === 'pending') {
      action.textContent = '取消';
      action.setAttribute('aria-label', `取消导入 ${item.file.name}`);
      action.addEventListener('click', () => {
        if (item.abort) item.abort();
        else {
          item.status = 'cancelled';
          renderLibraryImportPanel();
        }
      });
      row.appendChild(action);
    } else if (item.status === 'duplicate' && item.existingBookId) {
      action.textContent = '打开';
      action.setAttribute('aria-label', `打开书库中已有的 ${item.file.name}`);
      action.addEventListener('click', () => void openImportedBook(item.existingBookId));
      row.appendChild(action);
    } else if (item.status === 'done' && item.book?.id) {
      action.textContent = '打开';
      action.setAttribute('aria-label', `打开 ${item.book.title || item.file.name}`);
      action.addEventListener('click', () => void openImportedBook(item.book.id));
      row.appendChild(action);
    }
    list.appendChild(row);
  }
  const active = libraryImportQueue.filter((item) => ['pending', 'uploading'].includes(item.status)).length;
  const done = libraryImportQueue.filter((item) => item.status === 'done').length;
  const problems = libraryImportQueue.length - active - done;
  panel.querySelector('.library-import-summary').textContent = active
    ? `正在导入，剩余 ${active} 个`
    : `已导入 ${done} 本${problems ? `，${problems} 个未导入` : ''}`;
  const close = panel.querySelector('.library-import-close');
  close.disabled = active > 0;
  close.title = active > 0 ? '导入完成后可关闭' : '关闭导入列表';
  panel.hidden = libraryImportQueue.length === 0;
}

function createLibraryImportButton(library, { collectionId = null } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mode-btn library-import-button';
  button.textContent = '导入';
  button.title = '导入书籍（也可以把文件拖到书库）';
  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = LIBRARY_IMPORT_ACCEPT;
    input.hidden = true;
    input.className = 'library-import-input';
    input.addEventListener('change', () => {
      enqueueLibraryImports(input.files, { collectionId });
      input.remove();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
  return button;
}

function dragHasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function setupLibraryImportDrop(shell, library, { collectionId = null } = {}) {
  if (!shell || !libraryImportAvailable(library)) return;
  shell.dataset.importDrop = 'true';
  let depth = 0;
  shell.addEventListener('dragenter', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    shell.classList.add('is-import-drop');
  });
  shell.addEventListener('dragover', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  shell.addEventListener('dragleave', (event) => {
    if (!dragHasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) shell.classList.remove('is-import-drop');
  });
  shell.addEventListener('drop', (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    shell.classList.remove('is-import-drop');
    enqueueLibraryImports(event.dataTransfer.files, { collectionId });
  });
}

// A file dropped just outside the shelf must not make the browser navigate
// away to the raw file.
document.addEventListener('dragover', (event) => {
  if (dragHasFiles(event) && document.body.classList.contains('is-library') && document.querySelector('[data-import-drop="true"]')) {
    event.preventDefault();
  }
});
document.addEventListener('drop', (event) => {
  if (dragHasFiles(event) && document.body.classList.contains('is-library') && document.querySelector('[data-import-drop="true"]')) {
    event.preventDefault();
  }
});
