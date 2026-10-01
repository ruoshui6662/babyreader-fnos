/* BabyReader UI module: library/view */

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
  return '扫描完成：发现 ' + discovered + ' 项，新增 ' + indexed + ' 本，复用 ' + reused + ' 本' + errorSummary + '。';
}

const libraryFilterQueries = new Map();
let showNextLibraryScanResult = false;

function markNextLibraryScanResult() {
  showNextLibraryScanResult = true;
}

function createLibraryScanStatus(scan) {
  const status = document.createElement('p');
  status.className = 'library-scan-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = formatLibraryScanStatus(scan);
  status.hidden = !status.textContent || !(showNextLibraryScanResult
    || scan?.status === 'running' || scan?.status === 'failed' || Number(scan?.errorCount) > 0);
  showNextLibraryScanResult = false;
  return status;
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
  action.className = 'library-recent-action';
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
    lines.push(`另有 ${features.hiddenPdfCount} 本 PDF 已扫描；管理员已关闭 PDF 阅读（BABYREADER_PDF_ENABLED）。`);
  }
  if (features.mobiReader === false && count(features.hiddenMobiCount)) {
    lines.push(`另有 ${features.hiddenMobiCount} 本 MOBI/AZW3 已扫描；管理员已关闭 MOBI/AZW3 阅读（BABYREADER_MOBI_ENABLED）。`);
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
  scanButton.className = 'mode-btn library-scan-button';
  scanButton.textContent = '重新扫描';
  const scanStatus = createLibraryScanStatus(library?.scan);
  scanButton.addEventListener('click', async () => {
    scanButton.disabled = true;
    scanButton.textContent = '正在读取授权目录…';
    scanStatus.textContent = '正在读取授权目录…';
    scanStatus.hidden = false;
    try {
      const scanned = await window.browserHost.scanLibrary();
      markNextLibraryScanResult();
      if (typeof renderLibraryWithOrganization === 'function') await renderLibraryWithOrganization(scanned);
      else renderLibrary(scanned);
    } catch (error) {
      scanStatus.textContent = '读取失败：请检查 fnOS 应用权限后重试。';
      scanStatus.hidden = false;
      if (typeof showHighlightHint === 'function') {
        showHighlightHint('读取失败，请检查 fnOS 应用权限后重试。');
      }
      scanButton.disabled = false;
      scanButton.textContent = '重新扫描';
    }
  });
  const actions = document.createElement('div');
  actions.className = 'library-header-actions';
  actions.dataset.librarySlot = 'header-actions';
  if (typeof libraryImportAvailable === 'function' && libraryImportAvailable(library)) {
    actions.appendChild(createLibraryImportButton(library));
  }
  actions.appendChild(scanButton);
  header.appendChild(actions);
  shell.appendChild(header);
  shell.appendChild(scanStatus);
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
    emptyCopy.textContent = '在 fnOS 中授权书库目录后，EPUB、Markdown、TXT 和已启用的 PDF 会出现在这里。';
    empty.appendChild(emptyCopy);
    shell.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'library-grid';
    grid.dataset.librarySlot = 'book-grid';
    for (const book of validBooks) {
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
