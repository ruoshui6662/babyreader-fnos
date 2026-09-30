/* BabyReader UI module: reader/bookmarks */

'use strict';

let _bookmarkTogglePromise = null;
let _bookmarkRefreshPromise = null;
let _bookmarkPanelStatus = 'idle';

function currentBookBookmarks() {
  return typeof currentServerBookBookmarks === 'function'
    ? currentServerBookBookmarks()
    : [];
}

function updateCurrentBookBookmarks(bookmarks) {
  return typeof setCurrentServerBookBookmarks === 'function'
    ? setCurrentServerBookBookmarks(bookmarks)
    : [];
}

function stableBookmarkLocator(locator) {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) return null;
  if (Number(locator.version) === 1 && locator.type === 'pdf') {
    const pageIndex = locator.pageIndex;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= 10000) return null;
    return { version: 1, type: 'pdf', pageIndex };
  }
  const href = String(locator.href || '').trim();
  if (!href) return null;
  const anchor = String(locator.anchor || '').trim();
  const textBefore = String(locator.textBefore || '').replace(/\s+/g, ' ').trim();
  const pageNumber = Number(locator.pageNumber);
  return {
    version: Number(locator.version) || 2,
    type: String(locator.type || 'semantic-position'),
    readingScope: String(locator.readingScope || 'chapter'),
    href,
    anchor,
    textBefore,
    pageNumber: anchor || textBefore
      ? null
      : Number.isInteger(pageNumber) && pageNumber >= 0 ? pageNumber : null
  };
}

function bookmarkLocatorKey(locator) {
  const normalized = stableBookmarkLocator(locator);
  return normalized ? JSON.stringify(normalized) : '';
}

function getCurrentBookmarkLocator() {
  if (!state.currentBookId) return null;
  if (state.contentType === 'pdf') {
    const controller = window.pdfReaderController;
    if (!controller || controller.getCurrentBookId() !== state.currentBookId) return null;
    const pageIndex = controller.getCurrentPageIndex();
    const pageCount = controller.getPageCount();
    return Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pageCount
      ? { version: 1, type: 'pdf', pageIndex }
      : null;
  }
  if (state.contentType !== 'epub') return null;
  const reader = document.getElementById('reader');
  if (!reader || typeof currentReadingLocator !== 'function') return null;
  if (typeof updateReadingProgress === 'function') updateReadingProgress();
  const locator = currentReadingLocator(reader);
  return locator ? JSON.parse(JSON.stringify(locator)) : null;
}

function isCurrentBookmark(locator = getCurrentBookmarkLocator()) {
  locator = locator?.locator || locator;
  const key = bookmarkLocatorKey(locator);
  if (!key) return false;
  return currentBookBookmarks().some((bookmark) => bookmarkLocatorKey(bookmark?.locator) === key);
}

function bookmarkLabel(locator) {
  if (locator?.type === 'pdf' && Number.isInteger(locator.pageIndex)) {
    return `第 ${locator.pageIndex + 1} 页`;
  }
  const chapter = [...document.querySelectorAll('#article .epub-chapter')]
    .find((candidate) => candidate.dataset.sourcePath === locator?.href);
  const heading = chapter?.querySelector('h1, h2, h3, h4')?.textContent?.replace(/\s+/g, ' ').trim();
  if (heading) return heading.slice(0, 120);
  if (Number.isFinite(locator?.pageNumber)) return `第 ${locator.pageNumber} 页`;
  return `第 ${Math.round((Number(locator?.chapterPercentage) || 0) * 100)}%`;
}

function showBookmarkError(error) {
  console.error('书签操作失败', error);
  if (typeof showHighlightHint === 'function') showHighlightHint('书签操作失败，请稍后重试');
}

function ensureBookmarkPanelStatus() {
  const panel = document.getElementById('readerPanelBookmarks');
  const list = document.getElementById('bookmarkList');
  if (!panel || !list) return null;
  let status = document.getElementById('bookmarkPanelStatus');
  if (!status) {
    status = document.createElement('p');
    status.id = 'bookmarkPanelStatus';
    status.className = 'reader-panel-empty reader-panel-status bookmark-panel-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    panel.insertBefore(status, list);
  }
  return status;
}

function setBookmarkPanelStatus(statusName) {
  _bookmarkPanelStatus = statusName;
  const status = ensureBookmarkPanelStatus();
  if (!status) return;
  const messages = {
    loading: '正在加载书签…',
    error: '书签暂时无法加载',
    idle: '',
    ready: ''
  };
  status.textContent = messages[statusName] || '';
  status.hidden = !messages[statusName];
}

async function toggleCurrentBookmark() {
  if (_bookmarkTogglePromise) return _bookmarkTogglePromise;

  _bookmarkTogglePromise = (async () => {
    const locator = getCurrentBookmarkLocator();
    if (!locator || !state.currentBookId) return null;

    const existing = currentBookBookmarks().find(
      (bookmark) => bookmarkLocatorKey(bookmark?.locator) === bookmarkLocatorKey(locator)
    );
    if (existing) {
      const result = await window.browserHost.deleteBookmark(existing.id, state.currentBookId);
      if (result?.deleted === false) return result;
      updateCurrentBookBookmarks(currentBookBookmarks().filter((bookmark) => bookmark.id !== existing.id));
      renderBookmarkList();
      renderBookmarkButtonState();
      return result;
    }

    const created = await window.browserHost.createBookmark({
      locator,
      label: bookmarkLabel(locator)
    }, state.currentBookId);
    if (!created || typeof created !== 'object' || !created.id) {
      throw new Error('书签保存响应无效');
    }
    const bookmark = { ...created, locator: created.locator || locator };
    updateCurrentBookBookmarks([...currentBookBookmarks(), bookmark]);
    renderBookmarkList();
    renderBookmarkButtonState();
    return bookmark;
  })().catch((error) => {
    renderBookmarkList();
    renderBookmarkButtonState();
    showBookmarkError(error);
    throw error;
  }).finally(() => {
    _bookmarkTogglePromise = null;
  });

  return _bookmarkTogglePromise;
}

async function jumpToBookmark(bookmark) {
  const locator = bookmark?.locator || bookmark;
  if (!locator) return false;
  if (state.contentType === 'pdf') {
    const normalized = stableBookmarkLocator(locator);
    const controller = window.pdfReaderController;
    if (!normalized || normalized.type !== 'pdf'
      || !controller || controller.getCurrentBookId() !== state.currentBookId
      || normalized.pageIndex >= controller.getPageCount()) return false;
    return Boolean(controller.goToPdfPage(normalized.pageIndex));
  }
  if (state.contentType !== 'epub') return false;

  let targetIndex = null;
  if (state.epubArchive && locator.href) {
    const chapterPath = typeof normalizeZipPath === 'function'
      ? normalizeZipPath(locator.href)
      : locator.href;
    targetIndex = state.epubArchive.chapterIndexByPath?.[chapterPath];
  }

  if (Number.isInteger(targetIndex) && targetIndex !== state.epubChapterIndex) {
    const navigate = typeof window.navigateToEpubChapter === 'function'
      ? window.navigateToEpubChapter
      : navigateToEpubChapter;
    return Boolean(await navigate(targetIndex, { locator }));
  }

  return Boolean(restoreReadingLocator(locator));
}

function renderBookmarkButtonState() {
  const button = document.getElementById('btnBookmarks');
  if (!button) return false;
  const available = ['epub', 'pdf'].includes(state.contentType) && Boolean(state.currentBookId);
  const active = available && isCurrentBookmark();
  button.disabled = !available;
  button.dataset.bookmarkActive = active ? 'true' : 'false';
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  const label = active ? '取消当前书签' : '添加当前书签';
  button.setAttribute('aria-label', available ? label : '书签仅支持 EPUB 和 PDF');
  button.setAttribute('title', available ? label : '书签仅支持 EPUB 和 PDF');
  return active;
}

function bookmarkMeta(bookmark) {
  const locator = bookmark?.locator || {};
  if (locator.type === 'pdf' && Number.isInteger(locator.pageIndex)) {
    return `PDF · 第 ${locator.pageIndex + 1} 页`;
  }
  if (Number.isFinite(locator.pageNumber)) return `第 ${locator.pageNumber} 页`;
  if (locator.readingScope === 'chapter') return '章节位置';
  return '阅读位置';
}

function renderBookmarkList() {
  const list = document.getElementById('bookmarkList');
  const empty = document.getElementById('bookmarkEmptyState');
  if (!list) return false;

  ensureBookmarkPanelStatus();
  list.replaceChildren();
  const bookmarks = ['epub', 'pdf'].includes(state.contentType) ? currentBookBookmarks() : [];
  if (empty) empty.hidden = bookmarks.length > 0 || ['loading', 'error'].includes(_bookmarkPanelStatus);

  bookmarks.forEach((bookmark) => {
    const row = document.createElement('div');
    row.className = 'bookmark-row';
    row.dataset.bookmarkId = String(bookmark.id || '');
    row.setAttribute('role', 'listitem');

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'bookmark-row-main';
    jump.setAttribute('aria-label', `跳转到书签：${bookmark.label || '未命名书签'}`);

    const title = document.createElement('span');
    title.className = 'bookmark-row-title';
    title.textContent = String(bookmark.label || '未命名书签');
    const meta = document.createElement('span');
    meta.className = 'bookmark-row-meta';
    meta.textContent = bookmarkMeta(bookmark);
    jump.append(title, meta);

    jump.addEventListener('click', async () => {
      try {
        const restored = await jumpToBookmark(bookmark);
        if (restored && typeof closeReaderPanel === 'function') closeReaderPanel();
      } catch (error) {
        showBookmarkError(error);
      }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'bookmark-row-delete';
    remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除书签：${bookmark.label || '未命名书签'}`);
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void deleteBookmarkFromList(bookmark.id);
    });

    row.append(jump, remove);
    list.append(row);
  });
  return true;
}

async function deleteBookmarkFromList(bookmarkId) {
  const bookmark = currentBookBookmarks().find((item) => item.id === bookmarkId);
  if (!bookmark || !state.currentBookId) return false;
  try {
    const result = await window.browserHost.deleteBookmark(bookmark.id, state.currentBookId);
    if (result?.deleted === false) return false;
    updateCurrentBookBookmarks(currentBookBookmarks().filter((item) => item.id !== bookmark.id));
    renderBookmarkList();
    renderBookmarkButtonState();
    return true;
  } catch (error) {
    renderBookmarkList();
    renderBookmarkButtonState();
    showBookmarkError(error);
    return false;
  }
}

function refreshBookmarks() {
  if (!['epub', 'pdf'].includes(state.contentType) || !state.currentBookId) return Promise.resolve(false);
  if (_bookmarkRefreshPromise) return _bookmarkRefreshPromise;

  const bookId = state.currentBookId;
  setBookmarkPanelStatus('loading');
  renderBookmarkList();

  let request;
  try {
    request = Promise.resolve(window.browserHost.getBookmarks(bookId));
  } catch (error) {
    request = Promise.reject(error);
  }

  request = request
    .then((bookmarks) => {
      if (state.currentBookId !== bookId) return false;
      if (!Array.isArray(bookmarks)) throw new Error('书签列表响应无效');
      updateCurrentBookBookmarks(bookmarks);
      setBookmarkPanelStatus('ready');
      renderBookmarkList();
      renderBookmarkButtonState();
      return true;
    })
    .catch((error) => {
      if (state.currentBookId === bookId) {
        setBookmarkPanelStatus('error');
        renderBookmarkList();
        renderBookmarkButtonState();
      }
      console.warn('书签列表加载失败，保留本地状态', error);
      return false;
    });

  _bookmarkRefreshPromise = request.finally(() => {
    _bookmarkRefreshPromise = null;
  });
  return _bookmarkRefreshPromise;
}
