/* 枕书 UI module: library/view */

'use strict';

/* ============================================================
   Library View
   ============================================================ */
function formatLibraryScanStatus(scan) {
  if (!scan || typeof scan !== 'object') return '';
  if (scan.status === 'running') return '正在读取授权目录…';

  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const discovered = count(scan.discoveredCount);
  const indexed = count(scan.indexedCount);
  const reused = count(scan.reusedCount);
  const errors = count(scan.errorCount);
  const errorSummary = errors ? '，' + errors + ' 项未能读取' : '';
  const skipped = count(scan.skippedCount);
  const skippedSummary = skipped ? '，' + skipped + ' 个子文件夹或文件无法读取（已跳过）' : '';
  return '扫描完成：发现 ' + discovered + ' 项，新增 ' + indexed + ' 本，复用 ' + reused + ' 本' + errorSummary + skippedSummary + '。';
}

// Why a reason code stopped a folder or file from being read, in words.
function libraryReadFailure(code, fallback = '') {
  const reasons = {
    EACCES: '没有读取权限',
    EPERM: '没有读取权限',
    ENOENT: '文件夹不存在',
    ENOTDIR: '不是文件夹',
    ELOOP: '链接层级过多',
    EIO: '磁盘读取出错'
  };
  return reasons[code] || fallback || '无法读取';
}

// Where the books are read from (admins only). Always shown when the library
// is empty, or when a folder or some of its contents could not be read, so
// the cause is on the page instead of behind SSH. With nothing wrong it is a
// one-time notice: the first time the folders are seen, and again after a scan
// finds a new folder; it stays for this page load and is gone after a refresh.
const LIBRARY_FOLDER_SOURCES = Object.freeze({
  accessible: 'fnOS 授权',
  shared: '应用共享文件夹',
  configured: '应用设置'
});
const LIBRARY_FOLDERS_SEEN_KEY = 'zhenshu.libraryFoldersSeen';
// The notice shown during this page load: its folders, and whether dismissed.
let libraryFoldersNotice = null;

function readSeenLibraryFolders() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIBRARY_FOLDERS_SEEN_KEY) || 'null');
    return Array.isArray(saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveSeenLibraryFolders(roots) {
  try { localStorage.setItem(LIBRARY_FOLDERS_SEEN_KEY, JSON.stringify(roots)); } catch { /* private mode */ }
}

// For a healthy library: the notice to show now, or null.
function libraryFoldersNoticeFor(scanned) {
  const roots = scanned.map((folder) => folder.root).sort();
  const key = roots.join('\n');
  if (libraryFoldersNotice?.key === key) return libraryFoldersNotice.dismissed ? null : libraryFoldersNotice;
  const seen = readSeenLibraryFolders();
  const added = seen ? roots.filter((root) => !seen.includes(root)) : roots;
  saveSeenLibraryFolders(roots);
  // A folder taken away is not news: just remember the smaller set.
  if (!added.length) return null;
  libraryFoldersNotice = { key, first: !seen, added: new Set(seen ? added : []), dismissed: false };
  return libraryFoldersNotice;
}

function libraryFolderName(root) {
  return String(root || '').split(/[\\/]+/).filter(Boolean).pop() || String(root || '');
}

function createLibraryFolderRow(root, meta, { warning = false, added = false } = {}) {
  const item = document.createElement('li');
  const name = document.createElement('div');
  name.className = 'library-folders-name';
  const title = document.createElement('strong');
  title.textContent = libraryFolderName(root);
  name.appendChild(title);
  if (added) {
    const badge = document.createElement('span');
    badge.className = 'library-folders-new';
    badge.textContent = '新增';
    name.appendChild(badge);
  }
  const where = document.createElement('code');
  where.textContent = root;
  name.appendChild(where);
  const count = document.createElement('span');
  count.className = 'library-folders-count';
  count.textContent = meta;
  if (warning) count.classList.add('is-warning');
  item.append(name, count);
  return item;
}

function createLibraryFoldersPanel(library, { empty = false } = {}) {
  const folders = library?.folders;
  if (!folders) return null;
  const scanned = Array.isArray(folders.scanned) ? folders.scanned : [];
  const unavailable = Array.isArray(folders.unavailable) ? folders.unavailable : [];
  const skippedTotal = scanned.reduce((sum, folder) => sum + (Number(folder.skippedCount) || 0), 0);
  const problem = Boolean(empty || unavailable.length || skippedTotal);
  const notice = problem || !scanned.length ? null : libraryFoldersNoticeFor(scanned);
  if (!problem && !notice) return null;

  const panel = document.createElement('section');
  panel.className = problem ? 'library-folders is-problem' : 'library-folders is-notice';
  panel.setAttribute('aria-label', '书库文件夹');
  const head = document.createElement('div');
  head.className = 'library-folders-head';
  const heading = document.createElement('div');
  heading.className = 'library-folders-heading';
  const title = document.createElement('h2');
  title.className = 'library-folders-title';
  title.textContent = notice && !notice.first ? '发现新的书库文件夹' : '书库文件夹';
  heading.appendChild(title);
  if (notice) {
    const books = scanned.reduce((sum, folder) => sum + (Number(folder.bookCount) || 0), 0);
    const sub = document.createElement('p');
    sub.className = 'library-folders-sub';
    sub.textContent = `${scanned.length} 个文件夹，共 ${books} 本书。此提示只显示一次。`;
    heading.appendChild(sub);
  }
  head.appendChild(heading);
  if (notice) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'zs-btn zs-btn-plain zs-btn-small library-folders-dismiss';
    dismiss.textContent = '知道了';
    dismiss.addEventListener('click', () => {
      notice.dismissed = true;
      panel.remove();
    });
    head.appendChild(dismiss);
  }
  panel.appendChild(head);

  if (!scanned.length && !unavailable.length) {
    const none = document.createElement('p');
    none.className = 'library-folders-hint';
    none.textContent = '还没有可读取的书库文件夹：请在 fnOS 应用设置中为枕书授权文件夹，或把书放进共享文件夹 zhenshu/library。';
    panel.appendChild(none);
    return panel;
  }

  const list = document.createElement('ul');
  list.className = 'library-folders-list';
  for (const folder of scanned) {
    const skipped = Number(folder.skippedCount) || 0;
    const source = LIBRARY_FOLDER_SOURCES[folder.source] || '';
    const meta = `${source ? `${source} · ` : ''}${Number(folder.bookCount) || 0} 本${skipped ? `，${skipped} 项无法读取` : ''}`;
    list.appendChild(createLibraryFolderRow(folder.root, meta, {
      warning: Boolean(skipped),
      added: Boolean(notice?.added.has(folder.root))
    }));
  }
  for (const folder of unavailable) {
    list.appendChild(createLibraryFolderRow(folder.root, `无法打开：${libraryReadFailure(folder.code, folder.error)}`, { warning: true }));
  }
  panel.appendChild(list);
  if (!problem) return panel;

  const skippedItems = scanned.flatMap((folder) => (folder.skipped || [])
    .map((entry) => ({ root: folder.root, ...entry })));
  if (skippedItems.length) {
    const details = document.createElement('details');
    details.className = 'library-folders-skipped';
    const summary = document.createElement('summary');
    summary.textContent = `无法读取的子文件夹或文件（${skippedTotal}）`;
    const skippedList = document.createElement('ul');
    for (const entry of skippedItems) {
      const item = document.createElement('li');
      const where = document.createElement('code');
      where.textContent = entry.path;
      item.append(where, document.createTextNode(` — ${libraryReadFailure(entry.code)}`));
      skippedList.appendChild(item);
    }
    details.append(summary, skippedList);
    panel.appendChild(details);
  }

  const hint = document.createElement('p');
  hint.className = 'library-folders-hint';
  hint.textContent = empty
    ? '把 EPUB、PDF、MOBI/AZW3、TXT 或 Markdown 放进上面的文件夹，然后点“重新扫描”。'
    : '其余的书已正常读取。无法读取的项目通常是权限问题：请让枕书应用用户可以读取它们后重新扫描。';
  panel.appendChild(hint);
  return panel;
}

const libraryFilterQueries = new Map();

function createLibraryScanStatus(scan) {
  const status = document.createElement('p');
  status.className = 'library-scan-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = formatLibraryScanStatus(scan);
  // Only what needs attention stays on the page (a failure, books that
  // could not be read, skipped folders); progress and a clean result are in
  // the ring at the top right.
  status.hidden = !status.textContent || scan?.status === 'running' || !(scan?.status === 'failed'
    || Number(scan?.errorCount) > 0 || Number(scan?.skippedCount) > 0);
  return status;
}

// ---------------------------------------------------------------------------
// Scan progress: a small ring at the top right while the library is scanned.
// Hover (or tap) shows what it is doing; when the scan ends it turns into a
// check mark for a moment, or stays as “!” after a failure. It follows the
// server's scan state, so a scan started elsewhere, or one that outlasts its
// request (a gateway may give up on a long request), still shows and ends
// with the shelf refreshed.
// ---------------------------------------------------------------------------
const LIBRARY_SCAN_POLL_MS = 700;
const LIBRARY_SCAN_DONE_MS = 4000;
let libraryScanWatch = null;
let libraryScanHideTimer = 0;

function libraryScanNumber(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))).toLocaleString('zh-CN') : '0';
}

// { state, title, detail, percent } for the ring and its popover.
function describeLibraryScan(scanState) {
  const progress = scanState?.progress || {};
  const count = libraryScanNumber;
  if (scanState?.active || scanState?.status === 'running') {
    if (progress.phase === 'indexing' && Number(progress.total) > 0) {
      const percent = Math.min(100, Math.round((Number(progress.processed) / Number(progress.total)) * 100));
      const errors = Number(progress.errors) ? ` · ${count(progress.errors)} 本未能读取` : '';
      return {
        state: 'indexing',
        title: `正在读取书籍 ${count(progress.processed)} / ${count(progress.total)}`,
        detail: `新增 ${count(progress.indexed)} · 已有 ${count(progress.reused)}${errors}`,
        percent
      };
    }
    if (progress.phase === 'finishing') return { state: 'finishing', title: '正在整理书库', detail: `共 ${count(progress.total)} 本`, percent: 100 };
    return {
      state: 'discovering',
      title: '正在查找书籍',
      detail: Number(progress.discovered) ? `已发现 ${count(progress.discovered)} 本` : '正在读取授权的文件夹',
      percent: null
    };
  }
  if (scanState?.status === 'failed') {
    return { state: 'failed', title: '扫描失败', detail: '请检查 fnOS 应用权限后重试。', percent: null };
  }
  const result = scanState?.result || {};
  const errors = Number(result.errorCount) ? ` · ${count(result.errorCount)} 项未能读取` : '';
  return {
    state: 'done',
    title: '扫描完成',
    detail: `共 ${count(result.discoveredCount)} 本 · 新增 ${count(result.indexedCount)} · 已有 ${count(result.reusedCount)}${errors}`,
    percent: 100
  };
}

function renderLibraryScanIndicator(scanState) {
  const indicator = document.getElementById('libraryScanIndicator');
  if (!indicator) return;
  const view = describeLibraryScan(scanState);
  clearTimeout(libraryScanHideTimer);
  indicator.hidden = false;
  indicator.dataset.state = view.state;
  indicator.style.setProperty('--scan-percent', String(view.percent ?? 0));
  const ring = indicator.querySelector('.library-scan-ring');
  ring.setAttribute('aria-label', `${view.title}。${view.detail}`);
  indicator.querySelector('.library-scan-popover-title').textContent = view.title;
  indicator.querySelector('.library-scan-popover-detail').textContent = view.detail;
  const meter = indicator.querySelector('.library-scan-popover-meter');
  meter.hidden = view.percent === null || view.state === 'done';
  if (view.state === 'done') {
    libraryScanHideTimer = setTimeout(() => {
      if (indicator.dataset.open === 'true') return;
      indicator.hidden = true;
    }, LIBRARY_SCAN_DONE_MS);
  }
}

function setLibraryScanPopoverOpen(open) {
  const indicator = document.getElementById('libraryScanIndicator');
  if (!indicator) return;
  indicator.dataset.open = String(open);
  indicator.querySelector('.library-scan-popover').hidden = !open;
  indicator.querySelector('.library-scan-ring').setAttribute('aria-expanded', String(open));
  if (!open && indicator.dataset.state === 'done') {
    clearTimeout(libraryScanHideTimer);
    libraryScanHideTimer = setTimeout(() => { indicator.hidden = true; }, 1200);
  }
}

function setupLibraryScanIndicator() {
  const indicator = document.getElementById('libraryScanIndicator');
  if (!indicator || indicator.dataset.ready) return;
  indicator.dataset.ready = 'true';
  const ring = indicator.querySelector('.library-scan-ring');
  let pinned = false;
  const hoverable = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  indicator.addEventListener('mouseenter', () => { if (hoverable()) setLibraryScanPopoverOpen(true); });
  indicator.addEventListener('mouseleave', () => { if (hoverable() && !pinned) setLibraryScanPopoverOpen(false); });
  ring.addEventListener('click', (event) => {
    event.stopPropagation();
    pinned = !(pinned && indicator.dataset.open === 'true');
    setLibraryScanPopoverOpen(pinned);
    // After a failure the ring stays until it has been looked at.
    if (!pinned && indicator.dataset.state === 'failed') indicator.hidden = true;
  });
  document.addEventListener('pointerdown', (event) => {
    if (indicator.dataset.open === 'true' && !indicator.contains(event.target)) {
      pinned = false;
      setLibraryScanPopoverOpen(false);
    }
  }, true);
}

// Follows the server's scan until it ends; resolves with its last state.
// One watcher at a time: a second call shares the first.
function watchLibraryScan(initial = null) {
  if (libraryScanWatch) return libraryScanWatch;
  setupLibraryScanIndicator();
  renderLibraryScanIndicator(initial || { active: true, status: 'running', progress: { phase: 'discovering' } });
  libraryScanWatch = (async () => {
    let last = initial;
    let failures = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, LIBRARY_SCAN_POLL_MS));
      try {
        last = await window.browserHost.getScanStatus();
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= 5) {
          last = { active: false, status: 'failed' };
          break;
        }
        continue;
      }
      if (!last?.active) break;
      renderLibraryScanIndicator(last);
    }
    renderLibraryScanIndicator(last);
    return last;
  })().finally(() => { libraryScanWatch = null; });
  return libraryScanWatch;
}

// A scan already running when the shelf is shown (started by another admin,
// or before a reload): show it, and refresh the shelf when it ends.
function followRunningLibraryScan(library) {
  if (!library?.scanState?.active || libraryScanWatch) return;
  if (typeof window.browserHost?.getScanStatus !== 'function') return;
  void watchLibraryScan(library.scanState).then(async (final) => {
    if (final?.status === 'failed' || !document.body.classList.contains('is-library')) return;
    try {
      const next = await window.browserHost.getLibrary();
      if (typeof renderLibraryWithOrganization === 'function') await renderLibraryWithOrganization(next);
      else renderLibrary(next);
    } catch { /* the next visit shows it */ }
  });
}

// 重新扫描, for the flat shelf and the organized one alike. The request runs
// the scan; the ring follows its progress meanwhile. If the request itself
// fails while the scan went on (a timeout on a long scan), the finished
// library is fetched instead of reporting a failure.
async function runLibraryScanFromButton(button, scanStatus = null) {
  button.disabled = true;
  button.textContent = '扫描中…';
  if (scanStatus) scanStatus.hidden = true;
  const watching = typeof window.browserHost.getScanStatus === 'function' ? watchLibraryScan() : null;
  let scanned = null;
  let failure = null;
  try {
    scanned = await window.browserHost.scanLibrary();
  } catch (error) {
    failure = error;
  }
  const final = watching ? await watching : null;
  if (!scanned && final && final.status !== 'failed') {
    try {
      scanned = await window.browserHost.getLibrary();
      failure = null;
    } catch { /* keep the first failure */ }
  }
  if (scanned) {
    if (!watching) renderLibraryScanIndicator({ active: false, status: 'completed', result: scanned.scan || {} });
    if (typeof renderLibraryWithOrganization === 'function') await renderLibraryWithOrganization(scanned);
    else renderLibrary(scanned);
    return;
  }
  renderLibraryScanIndicator({ active: false, status: 'failed' });
  if (scanStatus) {
    scanStatus.textContent = '读取失败：请检查 fnOS 应用权限后重试。';
    scanStatus.hidden = false;
  }
  if (typeof showHighlightHint === 'function') {
    showHighlightHint(failure?.message && !/\/|\\|permission|denied/i.test(failure.message)
      ? failure.message
      : '读取失败，请检查 fnOS 应用权限后重试。');
  }
  button.disabled = false;
  button.textContent = '重新扫描';
}

function setupLibraryFilter(shell) {
  const scope = JSON.stringify(window.history?.state?.libraryOrganization || { mode: 'root' });
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'library-filter';
  input.placeholder = '查找书名或作者';
  input.setAttribute('aria-label', '查找书名或作者');
  input.value = libraryFilterQueries.get(scope) || '';
  const empty = document.createElement('p');
  empty.className = 'library-summary';
  empty.textContent = '没有匹配的书籍，试试其他书名或作者。';
  empty.hidden = true;
  const apply = () => {
    const query = input.value.trim().normalize('NFKC').toLocaleLowerCase();
    libraryFilterQueries.set(scope, input.value);
    let count = 0;
    const visibleBookIds = new Set();
    const cards = [...shell.querySelectorAll('.library-grid .library-book')];
    for (const card of cards) {
      const visible = !query || card.textContent.normalize('NFKC').toLocaleLowerCase().includes(query);
      const wrapper = card.parentElement?.parentElement?.classList.contains('library-grid') ? card.parentElement : card;
      wrapper.hidden = !visible;
      if (visible) {
        count++;
        visibleBookIds.add(card.dataset.bookId);
      }
    }
    const recent = shell.querySelector('.library-recent-reading');
    if (recent) recent.hidden = Boolean(query) && !visibleBookIds.has(recent.querySelector('.library-recent-card')?.dataset.bookId);
    empty.hidden = !query || count > 0;
  };
  input.addEventListener('input', apply);
  shell.querySelector('.library-header-actions')?.prepend(input);
  const grid = shell.querySelector('.library-grid');
  if (grid) grid.after(empty);
  else shell.appendChild(empty);
  apply();
}

function createLibraryRecentCard(books) {
  const candidates = (Array.isArray(books) ? books : []).map((book) => {
    const progress = state.userState?.books?.[book.id]?.progress;
    const updated = Date.parse(progress?.updatedAt || '');
    return Number.isFinite(updated) && progress?.locator ? { book, progress, updated } : null;
  }).filter(Boolean).sort((left, right) => right.updated - left.updated);
  const recent = candidates[0];
  if (!recent) return null;
  const section = document.createElement('section');
  section.className = 'library-recent-reading';
  section.dataset.librarySlot = 'recent-reading';
  const heading = document.createElement('h2');
  heading.textContent = '继续阅读';
  section.appendChild(heading);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'library-recent-card';
  button.dataset.bookId = recent.book.id;
  const coverFrame = document.createElement('span');
  coverFrame.className = 'library-recent-cover';
  const cover = typeof createLibraryCover === 'function'
    ? createLibraryCover(recent.book)
    : document.createElement('span');
  cover.classList.add('library-book-cover');
  cover.draggable = false;
  if (typeof setGlassAmbientBook === 'function') setGlassAmbientBook(recent.book, cover);
  coverFrame.appendChild(cover);
  button.appendChild(coverFrame);
  if (recent.book.type === 'pdf' && !recent.book.coverUrl && typeof window.requestPdfLibraryCover === 'function') {
    window.requestPdfLibraryCover(recent.book, cover);
  }
  const details = document.createElement('span');
  details.className = 'library-recent-details';
  const title = document.createElement('strong');
  title.textContent = recent.book.title || recent.book.relativePath || '未命名书籍';
  details.appendChild(title);
  const ratio = Number.isFinite(recent.progress.percentage)
    ? Math.max(0, Math.min(1, recent.progress.percentage)) : null;
  const percent = ratio === null ? '' : `${Math.round(ratio * 100)}%`;
  if (recent.book.author) {
    const meta = document.createElement('small');
    meta.textContent = recent.book.author;
    details.appendChild(meta);
  }
  if (percent) {
    const progress = document.createElement('span');
    progress.className = 'library-recent-progress';
    const track = document.createElement('span');
    track.className = 'library-recent-progress-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'library-recent-progress-fill';
    fill.style.width = `${Math.max(2, ratio * 100)}%`;
    track.appendChild(fill);
    const label = document.createElement('small');
    label.textContent = `已读 ${percent}`;
    progress.append(track, label);
    details.appendChild(progress);
  }
  button.appendChild(details);
  const action = document.createElement('span');
  action.className = 'library-recent-action zs-btn zs-btn-primary zs-btn-small';
  action.setAttribute('aria-hidden', 'true');
  action.textContent = '继续';
  button.appendChild(action);
  button.setAttribute('aria-label', `继续阅读 ${title.textContent}${percent ? `，已读 ${percent}` : ''}`);
  button.addEventListener('click', () => {
    window.browserHost.openBook(recent.book).catch((error) => showHighlightHint(error.message));
  });
  section.appendChild(button);
  return section;
}

function createLibraryHiddenPdfNotice(library) {
  const features = library?.features || {};
  const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  const lines = [];
  if (features.pdfReader === false && count(features.hiddenPdfCount)) {
    lines.push(`另有 ${features.hiddenPdfCount} 本 PDF 已扫描；管理员已关闭 PDF 阅读（ZHENSHU_PDF_ENABLED）。`);
  }
  if (features.mobiReader === false && count(features.hiddenMobiCount)) {
    lines.push(`另有 ${features.hiddenMobiCount} 本 MOBI/AZW3 已扫描；管理员已关闭 MOBI/AZW3 阅读（ZHENSHU_MOBI_ENABLED）。`);
  }
  if (count(features.drmProtectedMobiCount)) {
    lines.push(`${features.drmProtectedMobiCount} 本 Kindle 书受 DRM 保护，无法阅读。`);
  }
  if (!lines.length) return null;
  const notice = document.createElement('p');
  notice.className = 'library-summary';
  notice.textContent = lines.join(' ');
  return notice;
}

function renderLibrary(library) {
  followRunningLibraryScan(library);
  const organizationEnabled = library?.features?.libraryOrganization === true;
  const organizationRenderer = typeof window !== 'undefined'
    && typeof window.renderLibraryOrganization === 'function'
    ? window.renderLibraryOrganization
    : null;

  if (organizationEnabled && organizationRenderer) {
    try {
      if (organizationRenderer(library) === true) return true;
    } catch {
      // The organization surface is optional. A renderer failure must never
      // prevent the stable flat library from opening books.
    }
  }

  return renderFlatLibrary(library, { organizationEnabled });
}

function prepareLibrarySurface() {
  if (typeof clearReaderBookLocation === 'function') clearReaderBookLocation();
  if (typeof closeReaderPanel === 'function') closeReaderPanel({ restoreFocus: false });
  else if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
  if (typeof closeAiModal === 'function') closeAiModal({ restoreFocus: false, cancelRequest: true });
  if (typeof resetAiConversation === 'function') {
    resetAiConversation({ clearConversationId: true, clearConversationList: true });
  }
  const article = document.getElementById('article');
  const welcome = document.getElementById('welcome');
  if (!article) return null;

  state.currentBookId = null;
  state.currentPath = null;
  state.currentName = null;
  if (typeof syncNativeClient === 'function') syncNativeClient();
  clearTimeout(_fileNameFlashTimeout);
  const fileName = document.getElementById('fileName');
  if (fileName) {
    fileName.textContent = '';
    delete fileName.dataset.flashPrev;
  }
  state.content = '';
  state.contentType = 'text';
  destroyEpub();
  article.innerHTML = '';
  article.classList.add('is-library');
  if (welcome) welcome.style.display = 'none';
  document.body.classList.remove('is-welcome', 'is-epub', 'is-pdf-reader', 'has-toc', 'toc-open');
  document.body.classList.add('is-library');
  document.getElementById('reader')?.classList.remove('is-welcome');
  return article;
}

function renderFlatLibrary(library, { organizationEnabled = false } = {}) {
  const article = prepareLibrarySurface();
  if (!article) return;

  const shell = document.createElement('section');
  shell.className = 'library-view';
  shell.dataset.libraryMode = 'flat';
  shell.dataset.libraryOrganizationEnabled = String(organizationEnabled);

  const header = document.createElement('div');
  header.className = 'library-header';
  header.dataset.librarySlot = 'header';

  const heading = document.createElement('div');
  heading.className = 'library-heading';

  const title = document.createElement('h1');
  title.textContent = '书库';
  heading.appendChild(title);

  const validBooks = (library?.books || []).filter((book) => book?.id && !book.error);
  const summary = document.createElement('p');
  summary.className = 'library-summary';
  summary.textContent = validBooks.length
    ? `已收录 ${validBooks.length} 本可阅读内容`
    : '你的私人阅读空间';
  heading.appendChild(summary);
  const hiddenPdfNotice = createLibraryHiddenPdfNotice(library);
  if (hiddenPdfNotice) heading.appendChild(hiddenPdfNotice);
  header.appendChild(heading);

  const scanButton = document.createElement('button');
  scanButton.type = 'button';
  scanButton.className = 'zs-btn zs-btn-secondary library-scan-button';
  scanButton.textContent = '重新扫描';
  const scanStatus = createLibraryScanStatus(library?.scan);
  scanButton.addEventListener('click', () => runLibraryScanFromButton(scanButton, scanStatus));
  const actions = document.createElement('div');
  actions.className = 'library-header-actions';
  actions.dataset.librarySlot = 'header-actions';
  if (typeof libraryImportAvailable === 'function' && libraryImportAvailable(library)) {
    actions.appendChild(createLibraryImportButton(library));
  }
  actions.appendChild(scanButton);
  header.appendChild(actions);
  shell.appendChild(header);
  if (typeof setupLibraryPhoneMenu === 'function') setupLibraryPhoneMenu(actions);
  shell.appendChild(scanStatus);
  const foldersPanel = createLibraryFoldersPanel(library, { empty: !validBooks.length });
  if (foldersPanel) shell.appendChild(foldersPanel);
  const recentCard = createLibraryRecentCard(validBooks);
  if (recentCard) shell.appendChild(recentCard);

  if (!validBooks.length) {
    const empty = document.createElement('section');
    empty.className = 'library-empty';
    empty.setAttribute('aria-live', 'polite');

    const emptyIcon = document.createElement('span');
    emptyIcon.className = 'library-empty-icon';
    emptyIcon.setAttribute('aria-hidden', 'true');
    empty.appendChild(emptyIcon);

    const emptyTitle = document.createElement('h2');
    emptyTitle.className = 'library-empty-title';
    emptyTitle.textContent = '书库还是空的';
    empty.appendChild(emptyTitle);

    const emptyCopy = document.createElement('p');
    emptyCopy.className = 'library-empty-copy';
    emptyCopy.textContent = '在 fnOS 中授权书库目录后，EPUB、PDF、MOBI/AZW3、Markdown 和 TXT 会出现在这里。';
    empty.appendChild(emptyCopy);
    shell.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'library-grid';
    grid.dataset.librarySlot = 'book-grid';
    const byId = new Map(validBooks.map((book) => [book.id, book]));
    const shelf = typeof libraryShelfOrder === 'function'
      ? libraryShelfOrder(validBooks.map((book) => book.id)).map((id) => byId.get(id))
      : validBooks;
    for (const book of shelf) {
      const button = typeof createLibraryBookCard === 'function'
        ? createLibraryBookCard(book)
        : null;
      if (button) grid.appendChild(button);
    }
    shell.appendChild(grid);
  }

  article.appendChild(shell);
  setupLibraryFilter(shell);
  if (typeof setupLibraryImportDrop === 'function') setupLibraryImportDrop(shell, library);
}
