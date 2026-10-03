'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

async function createReaderDom() {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/zhenshu/' });
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  const sourceFiles = [
    '../app/ui/core/state.js',
    '../app/ui/core/utils.js',
    '../app/ui/core/api.js',
    '../app/ui/core/reader-route.js',
    '../app/ui/core/glass.js',
    '../app/ui/core/user-state.js',
    '../app/ui/reader/annotations.js',
    '../app/ui/reader/device-profile.js',
    '../app/ui/reader/epub.js',
    '../app/ui/reader/document.js',
    '../app/ui/reader/editor.js',
    '../app/ui/reader/highlights.js',
    '../app/ui/reader/pdf-notes-export.js',
    '../app/ui/reader/ai.js',
    '../app/ui/reader/ai-index-manager.js',
    '../app/ui/reader/selection-menu.js',
    '../app/ui/reader/actions.js',
    '../app/ui/reader/notes-panel.js',
    '../app/ui/reader/progress.js',
    '../app/ui/reader/bookmarks.js',
    '../app/ui/reader/pagination.js',
    '../app/ui/reader/paragraphs.js',
    '../app/ui/reader/settings.js',
    '../app/ui/reader/jump-back.js',
    '../app/ui/reader/navigation.js',
    '../app/ui/reader/pdf-annotation-geometry.js',
    '../app/ui/reader/pdf-annotations.js',
    '../app/ui/reader/pdf-render-scheduler.js',
    '../app/ui/reader/pdf.js',
    '../app/ui/reader/lifecycle.js',
    '../app/ui/reader/search.js',
    '../app/ui/shell/drawer.js',
    '../app/ui/library/reorder.js',
    '../app/ui/library/import.js',
    '../app/ui/library/organization.js',
    '../app/ui/library/shelf-nav.js',
    '../app/ui/library/stats-page.js',
    '../app/ui/library/note-card.js',
    '../app/ui/library/notes-export.js',
    '../app/ui/library/notes-page.js',
    '../app/ui/library/view.js',
    '../app/ui/app.js'
  ];
  let source = (await Promise.all(
    sourceFiles.map((relative) => fs.readFile(path.resolve(__dirname, relative), 'utf8'))
  )).join('\n');
  source += '\nwindow.__zhenshuPaginationApi = { updatePaginationControls };';
  source += '\nwindow.__zhenshuChapterApi = { renderEpubChapter, navigateToEpubChapter, isEpubChapterLoading, updateReadingProgress, restoreTextScroll, navigateEpubTarget, setupTocNavigation };\nwindow.__zhenshuDeviceApi = { getReaderDeviceProfile, setMobileChromeOpen, setupReaderNavigation };';
  source += '\nwindow.__zhenshuTypographyApi = { TYPOGRAPHY_SLIDER_CONFIG, nearestTypographyPreset, formatTypographySliderValue, setupTypographySlider, setupSettingsPanel, syncSettingsPanel, resetTypographySettings };';
  source += '\nwindow.__zhenshuUserStateApi = { applyUserState, persistUserSettings, flushUserSettings, currentUserSettings };';
  source += '\nwindow.__zhenshuActionsApi = { formatHighlightsMd, exportHighlights, handleKeyboardShortcut };';
  source += '\nwindow.__zhenshuEditorApi = { openThoughtComposer, closeHighlightEditor };';
  source += '\nwindow.__zhenshuEpubApi = { parseNavToc, parseNcxToc, destroyEpub };';
  source += '\nwindow.__zhenshuPdfApi = { createPdfReaderController, pdfReaderController };';
  source += '\nwindow.__pdfProgressTestHooks = { savePdfProgress, flushPdfProgressSave, saveTextScroll };';
  source += '\nwindow.__zhenshuBookmarkApi = { getCurrentBookmarkLocator, isCurrentBookmark, toggleCurrentBookmark, jumpToBookmark, renderBookmarkButtonState, renderBookmarkList, deleteBookmarkFromList, refreshBookmarks };';
  source += '\nwindow.__zhenshuSearchApi = { updateTopbarState, setupReaderSearch };';
  source += '\nwindow.__zhenshuAiApi.pdfAiScopeInput = pdfAiScopeInput;';
  source += '\nwindow.__zhenshuRouteApi = { restoreReaderFromLocation };';
  source += '\nwindow.__zhenshuLibraryApi = { renderLibrary };';
  source += '\nwindow.__zhenshuImportApi = { enqueueLibraryImports, libraryImportQueue };';
  source += '\nwindow.__uxApi = { showHighlightHint, setupHighlightEditor, setupCustomSelect, syncCustomSelectValue, renderReaderSearchResults, ensureSelectionMenu, startReaderSession: typeof startReaderSession === "function" ? startReaderSession : null };';

  window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  window.requestAnimationFrame = (callback) => {
    callback(Date.now());
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    this.dataset.scrolledIntoView = 'true';
  };
  window.fetch = async () => ({
    ok: true,
    json: async () => ({}),
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(0)
  });
  window.marked = {
    parse: (value) => String(value),
    parseInline: (value) => String(value),
    setOptions: () => {}
  };
  window.JSZip = {};
  window.confirm = () => true;

  window.eval(`${source}\nwindow.__zhenshuTest = {\n    state,\n    serializeDomRange,\n    rangeFromHighlight,\n    loadHighlights,\n    openHighlightEditor,\n    deleteActiveHighlight,\n    saveActiveHighlightEdits,\n    currentUserSettings,\n    applyZoom,\n    getEpubThemeCss,\n    debounce,\n    navigateChapter,\n    navigatePageGroup,\n    pageGroupForPage,\n    clampPageGroup,\n    pageLeftForGroup,\n    setPageGroup,\n    snapPaginationToNearestGroup,\n    pageNumberForElement,\n    navigateToSemanticTarget,\n    resolveEffectiveReadingMode,\n    createPaginationGeometry,\n    measurePagination,\n    setReadingMode,\n    currentReadingLocator,\n    restoreReadingLocator,\n    readerActions,\n    readerPanels,\n    openReaderPanel,\n    closeReaderPanel,\n    setupReaderActionMapping,\n    renderLibrary,\n    renderToc,\n    returnToLibrary,\n    createLibraryFoldersPanel\n  };`);

  window.__zhenshuTest.savePdfProgress = window.__pdfProgressTestHooks.savePdfProgress;
  window.__zhenshuTest.flushPdfProgressSave = window.__pdfProgressTestHooks.flushPdfProgressSave;
  window.__zhenshuTest.saveTextScroll = window.__pdfProgressTestHooks.saveTextScroll;
  delete window.__pdfProgressTestHooks;
  window.__zhenshuTest.updatePaginationControls = window.__zhenshuPaginationApi.updatePaginationControls;
  window.__zhenshuTest.updateTopbarState = window.__zhenshuSearchApi.updateTopbarState;
  window.__zhenshuTest.renderLibrary = window.__zhenshuLibraryApi.renderLibrary;
  window.__zhenshuTest.restoreReaderFromLocation = window.__zhenshuRouteApi.restoreReaderFromLocation;
  window.__zhenshuTest.setupReaderSearch = window.__zhenshuSearchApi.setupReaderSearch;
  window.__zhenshuTest.readerSurfaceController = window.readerSurfaceController;
  window.__zhenshuTest.readerSearchContract = window.readerSearchContract;
  window.__zhenshuTest.buildReaderSearchUrl = window.buildReaderSearchUrl;
  window.__zhenshuTest.navigateToSearchResult = window.readerSearchApi.navigateToSearchResult;
  window.__zhenshuTest.formatHighlightsMd = window.__zhenshuActionsApi.formatHighlightsMd;
  window.__zhenshuTest.exportHighlights = window.__zhenshuActionsApi.exportHighlights;
  window.__zhenshuTest.handleKeyboardShortcut = window.__zhenshuActionsApi.handleKeyboardShortcut;
  window.__zhenshuTest.openThoughtComposer = window.__zhenshuEditorApi.openThoughtComposer;
  window.__zhenshuTest.closeHighlightEditor = window.__zhenshuEditorApi.closeHighlightEditor;
  window.__zhenshuTest.typographyApi = window.__zhenshuTypographyApi;
  window.__zhenshuTest.parseNavToc = window.__zhenshuEpubApi.parseNavToc;
  window.__zhenshuTest.parseNcxToc = window.__zhenshuEpubApi.parseNcxToc;
  window.__zhenshuTest.destroyEpub = window.__zhenshuEpubApi.destroyEpub;
  window.__zhenshuTest.pdfApi = window.__zhenshuPdfApi;
  window.__zhenshuTest.aiApi = window.__zhenshuAiApi;
  window.__zhenshuTest.renderEpubChapter = window.__zhenshuChapterApi.renderEpubChapter;
  window.__zhenshuTest.navigateToEpubChapter = window.__zhenshuChapterApi.navigateToEpubChapter;
  window.__zhenshuTest.isEpubChapterLoading = window.__zhenshuChapterApi.isEpubChapterLoading;
  window.__zhenshuTest.updateReadingProgress = window.__zhenshuChapterApi.updateReadingProgress;
  window.__zhenshuTest.restoreTextScroll = window.__zhenshuChapterApi.restoreTextScroll;
  window.__zhenshuTest.navigateEpubTarget = window.__zhenshuChapterApi.navigateEpubTarget;
  window.__zhenshuTest.setupTocNavigation = window.__zhenshuChapterApi.setupTocNavigation;
  window.__zhenshuTest.applyUserState = window.__zhenshuUserStateApi.applyUserState;
  window.__zhenshuTest.userStateApi = window.__zhenshuUserStateApi;
  window.__zhenshuTest.getReaderDeviceProfile = window.__zhenshuDeviceApi.getReaderDeviceProfile;
  window.__zhenshuTest.setMobileChromeOpen = window.__zhenshuDeviceApi.setMobileChromeOpen;
  window.__zhenshuTest.setupReaderNavigation = window.__zhenshuDeviceApi.setupReaderNavigation;
  window.__zhenshuTest.captureSelectionSession = window.__zhenshuSelectionMenuApi.captureSelectionSession;
  window.__zhenshuTest.openSelectionMenu = window.__zhenshuSelectionMenuApi.openSelectionMenu;
  window.__zhenshuTest.setupSelectionMenu = window.__zhenshuSelectionMenuApi.setupSelectionMenu;
  window.__zhenshuTest.showSelectionMenuForCurrentSelection = window.__zhenshuSelectionMenuApi.showSelectionMenuForCurrentSelection;
  window.__zhenshuTest.closeSelectionMenu = window.__zhenshuSelectionMenuApi.closeSelectionMenu;
  window.__zhenshuTest.renderNotesPanel = window.__zhenshuNotesPanelApi.renderNotesPanel;
  window.__zhenshuTest.setupNotesPanel = window.__zhenshuNotesPanelApi.setupNotesPanel;
  window.__zhenshuTest.navigateToAnnotation = window.__zhenshuNotesPanelApi.navigateToAnnotation;
  window.__zhenshuTest.getCurrentBookmarkLocator = window.__zhenshuBookmarkApi.getCurrentBookmarkLocator;
  window.__zhenshuTest.isCurrentBookmark = window.__zhenshuBookmarkApi.isCurrentBookmark;
  window.__zhenshuTest.toggleCurrentBookmark = window.__zhenshuBookmarkApi.toggleCurrentBookmark;
  window.__zhenshuTest.jumpToBookmark = window.__zhenshuBookmarkApi.jumpToBookmark;
  window.__zhenshuTest.renderBookmarkButtonState = window.__zhenshuBookmarkApi.renderBookmarkButtonState;
  window.__zhenshuTest.renderBookmarkList = window.__zhenshuBookmarkApi.renderBookmarkList;
  window.__zhenshuTest.deleteBookmarkFromList = window.__zhenshuBookmarkApi.deleteBookmarkFromList;
  window.__zhenshuTest.refreshBookmarks = window.__zhenshuBookmarkApi.refreshBookmarks;
  return { window, api: window.__zhenshuTest };
}

test('UX return failure preserves PDF renderer and search; concurrent returns share one transition', async () => {
  const { window, api } = await createReaderDom();
  const events = [];
  api.state.currentBookId = 'ux-book';
  api.state.contentType = 'pdf';
  api.pdfApi.pdfReaderController.destroyPdfReader = async () => { events.push('destroy'); };
  const input = window.document.querySelector('#readerSearchSheet input');
  input.value = 'unchanged';
  window.browserHost.getLibrary = async () => { events.push('load'); throw new Error('offline'); };
  await Promise.all([api.returnToLibrary(), api.returnToLibrary()]);
  assert.deepEqual(events, ['load']);
  assert.equal(input.value, 'unchanged');
  assert.equal(api.state.currentBookId, 'ux-book');
  assert.equal(window.document.getElementById('btnBackToLibrary').disabled, false);
  await window.happyDOM.close();
});

test('UX search focuses the query and preserves it when closed and reopened', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'ux-book';
  api.state.currentPath = 'book.epub';
  api.openReaderPanel('search');
  const input = window.document.querySelector('#readerSearchSheet input');
  assert.equal(window.document.activeElement?.id, input.id);
  input.value = '保留搜索';
  api.closeReaderPanel();
  api.openReaderPanel('search');
  assert.equal(input.value, '保留搜索');
  await window.happyDOM.close();
});

test('UX TOC trigger describes actual panel state, not default preference', async () => {
  const { window, api } = await createReaderDom();
  api.state.toc = [{ label: 'chapter', href: 'chapter' }];
  api.state.tocOpen = true;
  api.openReaderPanel('toc');
  api.closeReaderPanel();
  api.updateTopbarState();
  assert.equal(window.document.getElementById('btnToc').getAttribute('aria-label'), '显示目录');
  await window.happyDOM.close();
});

test('UX note action keys are not intercepted as card navigation', async () => {
  const { window, api } = await createReaderDom();
  api.setupNotesPanel();
  const list = window.document.getElementById('notesList');
  list.innerHTML = '<article data-annotation-id="x" data-annotation-navigable="true"><button data-notes-action="edit">编辑</button></article>';
  const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  list.querySelector('button').dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  await window.happyDOM.close();
});

test('UX Escape closes visible AI main panel but does not consume unrelated Escape', async () => {
  const { window, api } = await createReaderDom();
  api.aiApi.setupAiPanel();
  const modal = window.document.getElementById('aiModal');
  modal.hidden = false;
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(modal.hidden, true);
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  window.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  await window.happyDOM.close();
});

test('UX feedback never overwrites the book title and failed feedback remains dismissible', async () => {
  const { window } = await createReaderDom();
  window.document.getElementById('fileName').textContent = '正在读的书';
  window.__uxApi.showHighlightHint('保存失败，请重试');
  assert.equal(window.document.getElementById('fileName').textContent, '正在读的书');
  const feedback = window.document.getElementById('readerFeedback');
  assert.ok(feedback);
  assert.match(feedback.textContent, /保存失败/);
  feedback.querySelector('button').click();
  assert.equal(feedback.hidden, true);
  await window.happyDOM.close();
});

test('UX custom selects reflect changed PDF labels and disabled state', async () => {
  const { window } = await createReaderDom();
  const select = window.document.getElementById('notesSort');
  window.__uxApi.setupCustomSelect(select);
  select.querySelector('[value="chapter"]').textContent = '按页';
  select.value = 'chapter';
  select.disabled = true;
  window.__uxApi.syncCustomSelectValue(select);
  assert.equal(select._customSelect.trigger.textContent, '按页');
  assert.equal(select._customSelect.options.find((item) => item.dataset.value === 'chapter').textContent, '按页');
  assert.equal(select._customSelect.trigger.disabled, true);
  await window.happyDOM.close();
});

test('UX unsaved note remains open when discard is declined; pending save cannot duplicate', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'a'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.contentType = 'pdf';
  api.state.userState.books[bookId] = { pdfAnnotations: [{ id: 'note', type: 'pdf', text: '原文', thought: '', color: 'yellow', style: 'marker', targets: [] }] };
  api.openHighlightEditor('note');
  window.document.getElementById('highlightEditorThought').value = '还没有保存的想法';
  window.confirm = () => false;
  api.closeHighlightEditor();
  assert.equal(window.document.getElementById('highlightEditor').hidden, false);
  let writes = 0;
  let rejectSave;
  window.browserHost.updatePdfAnnotation = () => { writes++; return new Promise((resolve, reject) => { rejectSave = reject; }); };
  const first = api.saveActiveHighlightEdits();
  const second = api.saveActiveHighlightEdits();
  assert.equal(writes, 1);
  rejectSave(new Error('offline'));
  await Promise.all([first, second]);
  assert.equal(window.document.getElementById('highlightEditor').hidden, false);
  assert.equal(window.document.getElementById('highlightEditorThought').value, '还没有保存的想法');
  assert.equal(window.document.getElementById('btnSaveHighlight').disabled, false);
  await window.happyDOM.close();
});

test('UX restoring conversations cannot erase missing AI configuration feedback', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'pdf';
  api.state.currentBookId = 'a'.repeat(64);
  window.browserHost.aiStatus = async () => ({ configured: false });
  window.browserHost.getAiConversations = async () => ({ conversations: [] });
  await api.aiApi.openAiModal();
  assert.equal(window.document.getElementById('aiQuestion').disabled, true);
  assert.equal(window.document.getElementById('aiStatus').hidden, false);
  assert.match(window.document.getElementById('aiStatus').textContent, /配置/);
  await window.happyDOM.close();
});

test('UX library filter preserves manual order and never invokes a scan', async () => {
  const { window, api } = await createReaderDom();
  api.renderLibrary({ books: [{ id: 'a', title: '月亮', author: '甲', type: 'epub' }, { id: 'b', title: '太阳', author: '乙', type: 'pdf' }] });
  const filter = window.document.querySelector('.library-filter');
  assert.ok(filter);
  filter.value = '乙';
  filter.dispatchEvent(new window.Event('input'));
  const cards = [...window.document.querySelectorAll('.library-book')];
  assert.equal(cards[0].hidden, true);
  assert.equal(cards[1].hidden, false);
  filter.value = '';
  filter.dispatchEvent(new window.Event('input'));
  assert.deepEqual(cards.map((item) => item.dataset.bookId), ['a', 'b']);
  assert.ok(cards.every((item) => !item.hidden));
  await window.happyDOM.close();
});

test('UX search snippets emphasize literal text safely and count loaded matches', async () => {
  const { window } = await createReaderDom();
  window.__uxApi.renderReaderSearchResults({ available: true, results: [{ id: 'one', snippet: '甲 <b>乙</b> 丙', matchText: '<b>乙</b>' }], hasMore: false });
  const excerpt = window.document.querySelector('.reader-search-result-excerpt');
  assert.equal(excerpt.querySelector('b'), null);
  assert.equal(excerpt.querySelector('mark')?.textContent, '<b>乙</b>');
  assert.match(window.document.getElementById('readerSearchSheet').textContent, /已加载 1/);
  await window.happyDOM.close();
});

test('UX search next and previous select adjacent loaded matches', async () => {
  const { window } = await createReaderDom();
  window.readerSearchApi.setupReaderSearch();
  window.__uxApi.renderReaderSearchResults({ available: true, results: [
    { id: 'first', snippet: '第一处', matchText: '第一处' },
    { id: 'second', snippet: '第二处', matchText: '第二处' }
  ], hasMore: false });
  const results = [...window.document.querySelectorAll('.reader-search-result')];
  const next = window.document.getElementById('readerSearchNext');
  const previous = window.document.getElementById('readerSearchPrevious');
  assert.ok(next);
  next.click();
  assert.equal(results[0].getAttribute('aria-current'), 'true');
  next.click();
  assert.equal(results[1].getAttribute('aria-current'), 'true');
  previous.click();
  assert.equal(results[0].getAttribute('aria-current'), 'true');
  await window.happyDOM.close();
});

test('UX a failed replacement search retains the last usable results and cursor', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'a'.repeat(64);
  let requested = 0;
  window.browserHost.searchBook = async () => {
    requested += 1;
    if (requested > 1) throw new Error('网络暂不可用');
    return { available: true, results: [{ id: 'old', snippet: '旧命中', matchText: '旧' }], hasMore: true, nextCursor: 'next' };
  };
  window.readerSearchApi.setupReaderSearch();
  const input = window.document.getElementById('readerSearchQuery');
  input.value = '旧';
  window.document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  input.value = '新';
  window.document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(window.document.getElementById('readerSearchResults').textContent, /旧命中/);
  assert.match(window.document.getElementById('readerSearchStatus').textContent, /仍显示.*旧/);
  assert.equal(window.document.getElementById('readerSearchMore').hidden, false);
  await window.happyDOM.close();
});

test('UX next hit loads the following result page before moving selection', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'a'.repeat(64);
  const cursors = [];
  window.browserHost.searchBook = async (_bookId, options) => {
    cursors.push(options.cursor || null);
    return options.cursor
      ? { available: true, results: [{ id: 'second', snippet: '第二处', matchText: '第二处' }], hasMore: false }
      : { available: true, results: [{ id: 'first', snippet: '第一处', matchText: '第一处' }], hasMore: true, nextCursor: 'page-2' };
  };
  window.readerSearchApi.setupReaderSearch();
  window.document.getElementById('readerSearchQuery').value = '处';
  window.document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const next = window.document.getElementById('readerSearchNext');
  next.click();
  next.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cursors, [null, 'page-2']);
  const active = window.document.querySelector('#readerSearchResults [aria-current="true"]');
  assert.equal(active?.dataset.searchResultId, 'second');
  await window.happyDOM.close();
});

test('UX AI answer does not pull a reader away from earlier messages', async () => {
  const { window, api } = await createReaderDom();
  api.aiApi.setupAiPanel();
  const scroll = window.document.getElementById('aiChatScroll');
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1200 });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 });
  scroll.scrollTop = 100;
  api.aiApi.renderAiAnswer('新的回答');
  assert.equal(scroll.scrollTop, 100);
  const newReply = window.document.getElementById('aiNewReply');
  assert.equal(newReply.hidden, false);
  newReply.click();
  assert.equal(scroll.scrollTop, 1200);
  assert.equal(newReply.hidden, true);
  await window.happyDOM.close();
});

test('UX notes export is discoverable and does not copy to the clipboard', async () => {
  const { window, api } = await createReaderDom();
  assert.ok(window.document.querySelector('#readerPanelNotes [data-reader-action="exportHighlights"]'));
  let copied = 0;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { copied += 1; } }
  });
  api.state.contentType = 'epub';
  api.state.currentBookId = 'a'.repeat(64);
  api.state.userState.books[api.state.currentBookId] = { highlights: [{ id: 'first', text: '一条划线' }] };
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  api.exportHighlights();
  assert.equal(copied, 0);
  await window.happyDOM.close();
});

test('UX tab arrow keys select the next content panel and leave one tab stop', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'pdf';
  api.state.currentBookId = 'a'.repeat(64);
  api.state.toc = [{ label: '目录', href: 'x' }];
  api.setupReaderActionMapping();
  api.openReaderPanel('toc');
  const tabs = [...window.document.querySelectorAll('#readerDrawer [data-reader-panel-target]')];
  tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs.filter((item) => item.tabIndex === 0).length, 1);
  await window.happyDOM.close();
});

test('UX startup shows persistent retry after failure and recovers the library', async () => {
  const { window } = await createReaderDom();
  assert.equal(typeof window.__uxApi.startReaderSession, 'function');
  window.browserHost.getSession = async () => { throw new Error('offline'); };
  window.browserHost.getUserState = async () => ({});
  window.browserHost.getLibrary = async () => ({ books: [] });
  await window.__uxApi.startReaderSession();
  const status = window.document.getElementById('readerStartupStatus');
  assert.match(status.textContent, /重试/);
  assert.equal(status.querySelector('button').disabled, false);
  window.browserHost.getSession = async () => ({});
  await window.__uxApi.startReaderSession();
  assert.ok(window.document.querySelector('.library-view'));
  await window.happyDOM.close();
});

test('UX selection color choice changes preference without losing the open menu', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'pdf';
  const menu = window.__uxApi.ensureSelectionMenu();
  menu.hidden = false;
  const colors = menu.querySelectorAll('[data-selection-color]');
  assert.equal(colors.length, 4);
  menu.querySelector('[data-selection-color="pink"]').click();
  assert.equal(api.state.highlightColor, 'pink');
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector('[data-selection-color="pink"]').getAttribute('aria-pressed'), 'true');
  await window.happyDOM.close();
});

test('UX collapsing AI retains the in-flight answer and does not send a second request', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'pdf';
  api.state.currentBookId = 'a'.repeat(64);
  window.pdfReaderController = { getPageCount: () => 9 };
  let complete;
  let calls = 0;
  window.browserHost.aiStatus = async () => ({ configured: true });
  window.browserHost.getAiConversations = async () => ({ conversations: [] });
  window.browserHost.askAiStream = async (_book, _request, handlers) => {
    calls++;
    return new Promise((resolve) => { complete = () => { handlers.onDone({ answer: '合成回答', sources: [] }); resolve({ answer: '合成回答', sources: [] }); }; });
  };
  await api.aiApi.openAiModal();
  window.document.getElementById('aiQuestion').value = '合成问题';
  const asking = api.aiApi.askAiQuestion();
  await waitFor(() => Boolean(complete));
  api.aiApi.closeAiModal();
  await api.aiApi.openAiModal();
  complete();
  await asking;
  assert.equal(calls, 1);
  assert.match(window.document.getElementById('aiMessages').textContent, /合成回答/);
  await window.happyDOM.close();
});

test('UX declining annotation deletion sends no mutation', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'a'.repeat(64);
  api.state.contentType = 'pdf';
  api.state.userState.books[api.state.currentBookId] = { pdfAnnotations: [{ id: 'note', type: 'pdf', text: '原文', thought: '', color: 'yellow', style: 'marker', targets: [] }] };
  api.openHighlightEditor('note');
  let calls = 0;
  window.confirm = () => false;
  window.browserHost.deletePdfAnnotation = async () => { calls++; return { deleted: true }; };
  await api.deleteActiveHighlight();
  assert.equal(calls, 0);
  assert.equal(window.document.getElementById('highlightEditor').hidden, false);
  await window.happyDOM.close();
});

test('UX search is nonmodal and does not trap keyboard focus', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'a'.repeat(64);
  api.state.currentPath = 'test.pdf';
  api.setupReaderActionMapping();
  api.openReaderPanel('search');
  assert.equal(window.document.getElementById('readerSearchSheet').getAttribute('aria-modal'), 'false');
  const close = window.document.querySelector('#readerSearchSheet button');
  close.focus();
  const event = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  close.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  await window.happyDOM.close();
});

test('library rescan shows safe progress and outcome feedback', async () => {
  const { window } = await createReaderDom();
  const renderLibrary = window.__zhenshuTest.renderLibrary;
  const book = { id: 'a'.repeat(64), title: '授权目录中的书', type: 'txt' };
  let resolveScan;
  window.browserHost.scanLibrary = () => new Promise((resolve) => {
    resolveScan = resolve;
  });

  renderLibrary({ books: [book] });
  const article = window.document.getElementById('article');
  const button = article.querySelector('.library-scan-button');
  assert.ok(button);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '正在读取授权目录…');
  assert.match(article.querySelector('.library-scan-status')?.textContent || '', /正在读取授权目录/);

  resolveScan({
    books: [book],
    scan: { discoveredCount: 4, indexedCount: 2, reusedCount: 1, errorCount: 1 }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(article.textContent, /发现 4 项/);
  assert.match(article.textContent, /新增 2 本/);
  assert.match(article.textContent, /复用 1 本/);
  assert.match(article.textContent, /1 项未能读取/);
  assert.doesNotMatch(article.textContent, /root|path|\/var\/|[A-Z]:\\/i);

  window.browserHost.scanLibrary = async () => {
    throw new Error('/var/apps/zhenshu/custom-library permission denied');
  };
  renderLibrary({ books: [book] });
  const failedButton = article.querySelector('.library-scan-button');
  failedButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(failedButton.disabled, false);
  assert.equal(failedButton.textContent, '重新扫描');
  assert.match(article.querySelector('.library-scan-status')?.textContent || '', /检查 fnOS 应用权限后重试/);
  assert.doesNotMatch(article.textContent, /permission denied|\/var\/|root|path/i);
});

test('opening a MOBI book waits through server-side preparation and then receives the derived EPUB', async () => {
  const { window } = await createReaderDom();
  const calls = [];
  const replies = [
    { ok: false, status: 409, body: { error: '正在准备这本书，请稍候…', code: 'MOBI_PREPARING' } },
    { ok: false, status: 409, body: { error: '正在准备这本书，请稍候…', code: 'MOBI_PREPARING' } },
    { ok: true, status: 200, body: null }
  ];
  window.fetch = async (url) => {
    calls.push(String(url));
    const reply = replies.shift();
    return { ok: reply.ok, status: reply.status, json: async () => reply.body, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const realTimeout = window.setTimeout;
  window.setTimeout = (callback) => { callback(); return 0; };
  const received = [];
  window.appHost.receiveDocument = async (document) => received.push(document);
  await window.browserHost.openBook({ id: 'a'.repeat(64), type: 'epub', format: 'mobi', title: 'MOBI 书', relativePath: 'a.mobi' });
  window.setTimeout = realTimeout;
  assert.equal(calls.length, 3);
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'epub');

  // Other errors are not retried.
  window.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: '无法转换这本书，文件可能已损坏。', code: 'MOBI_CORRUPT' }) });
  await assert.rejects(
    window.browserHost.openBook({ id: 'b'.repeat(64), type: 'epub', format: 'mobi', title: '坏书', relativePath: 'b.mobi' }),
    /无法转换这本书/
  );
  await window.happyDOM.close();
});

test('library explains hidden and DRM-protected Kindle books and labels MOBI/AZW3 covers', async () => {
  const { window, api } = await createReaderDom();
  const text = { id: 'a'.repeat(64), title: '已收录文本', type: 'txt' };
  api.renderLibrary({
    books: [text],
    features: { libraryOrganization: false, pdfReader: true, mobiReader: false, hiddenMobiCount: 3 }
  });
  assert.match(window.document.querySelector('.library-view').textContent, /3 本 MOBI\/AZW3.*管理员已关闭 MOBI\/AZW3 阅读/);
  // MOBI/AZW3 has no fnOS settings switch any more; never send people looking for one.
  assert.doesNotMatch(window.document.querySelector('.library-view').textContent, /运行设置/);
  assert.doesNotMatch(window.document.querySelector('.library-view').textContent, /PDF 已扫描/);

  const mobi6 = { id: 'b'.repeat(64), title: '旧格式', type: 'mobi', sourceFormat: 'mobi6' };
  const kf8 = { id: 'c'.repeat(64), title: '新格式', type: 'mobi', sourceFormat: 'kf8' };
  api.renderLibrary({
    books: [mobi6, kf8],
    features: { libraryOrganization: false, mobiReader: true, hiddenMobiCount: 0, drmProtectedMobiCount: 2 }
  });
  const view = window.document.querySelector('.library-view');
  assert.match(view.textContent, /2 本 Kindle 书受 DRM 保护/);
  assert.doesNotMatch(view.textContent, /管理员已关闭 MOBI/);
  const labels = [...view.querySelectorAll('.library-grid .library-cover-format')].map((node) => node.textContent);
  assert.deepEqual(labels.sort(), ['AZW3', 'MOBI']);
  await window.happyDOM.close();
});

test('library explains when indexed PDFs are hidden by the operator PDF kill switch', async () => {
  const { window, api } = await createReaderDom();
  const book = { id: 'a'.repeat(64), title: '已收录文本', type: 'txt' };
  api.renderLibrary({
    books: [book],
    features: { libraryOrganization: false, pdfReader: false, hiddenPdfCount: 2 }
  });
  assert.match(window.document.querySelector('.library-view')?.textContent || '', /2 本 PDF.*管理员已关闭 PDF 阅读/);
  // PDF has no fnOS settings switch any more; never send people looking for one.
  assert.doesNotMatch(window.document.querySelector('.library-view')?.textContent || '', /PDF.*运行设置/);

  api.renderLibrary({
    books: [book],
    features: { libraryOrganization: true, pdfReader: false, hiddenPdfCount: 2 },
    organization: {
      revision: 0,
      collections: [],
      allBookOrder: [book.id],
      collectionOrders: {},
      unassignedOrder: [book.id],
      books: [book]
    }
  });
  assert.match(window.document.querySelector('.library-view')?.textContent || '', /2 本 PDF.*管理员已关闭 PDF 阅读/);

  api.renderLibrary({ books: [book], features: { libraryOrganization: false, pdfReader: true, hiddenPdfCount: 0 } });
  assert.doesNotMatch(window.document.querySelector('.library-view')?.textContent || '', /管理员已关闭 PDF 阅读/);
});

test('browser refresh restores the book selected in the reader URL', async () => {
  const { window, api } = await createReaderDom();
  const book = {
    id: 'a'.repeat(64),
    title: '刷新后仍在阅读',
    type: 'txt',
    relativePath: 'refresh.txt'
  };
  window.history.replaceState({}, '', `?book=${book.id}`);
  const opened = [];
  window.browserHost.openBook = async (selected) => opened.push(selected);

  assert.equal(await api.restoreReaderFromLocation({ books: [book] }), true);
  assert.deepEqual(opened, [book]);
  assert.equal(new URL(window.location.href).searchParams.get('book'), book.id);
});

test('library organization stays opt-in and falls back to the flat shelf', async () => {
  const { window, api } = await createReaderDom();
  const book = {
    id: 'a'.repeat(64),
    title: '保持现有书库入口',
    type: 'txt',
    relativePath: 'stable.txt'
  };
  const opened = [];
  window.browserHost.openBook = async (selected) => opened.push(selected);

  window.renderLibraryOrganization = () => {
    throw new Error('organization renderer unavailable');
  };
  api.renderLibrary({
    books: [book],
    features: { libraryOrganization: true }
  });

  const shell = window.document.querySelector('.library-view');
  assert.equal(shell?.dataset.libraryMode, 'flat');
  assert.equal(shell?.dataset.libraryOrganizationEnabled, 'true');
  assert.equal(window.document.querySelector('[data-library-organization]'), null);

  window.document.querySelector('.library-book').click();
  await Promise.resolve();
  assert.deepEqual(opened, [book]);
});

test('library organization switches to a collection detail without changing book opening', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '分类内书籍', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '未分类书籍', type: 'txt', relativePath: 'two.txt' };
  const collectionId = '11111111-1111-4111-8111-111111111111';
  window.browserHost.openBook = async () => {};
  const organization = {
    version: 1,
    revision: 0,
    updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [{ id: collectionId, name: '重点阅读' }],
    collectionOrders: { [collectionId]: [first.id] },
    unassignedOrder: [second.id],
    bookAssignments: { [first.id]: collectionId },
    orphanedBookIds: [],
    books: [first, second]
  };
  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization });

  assert.equal(window.document.querySelector('.library-view')?.dataset.libraryMode, 'flat');
  assert.equal(window.document.querySelectorAll('[data-library-collection-id]').length, 1);
  window.document.querySelector('[data-library-collection-id] .library-organization-card-main').click();
  assert.equal(window.document.querySelector('.library-view')?.dataset.libraryMode, 'collection');
  assert.deepEqual(
    [...window.document.querySelectorAll('.library-book strong')].map((item) => item.textContent),
    ['分类内书籍']
  );

  window.history.back();
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: { libraryOrganization: { mode: 'root', collectionId: null } } }));
  assert.equal(window.document.querySelector('.library-view')?.dataset.libraryMode, 'flat');
  assert.equal(window.document.querySelector('[data-library-collection-id] .library-organization-card-main strong')?.textContent, '重点阅读');
});

test('library organization keeps rescan separate from view switching and collection creation', async () => {
  const { window, api } = await createReaderDom();
  const book = { id: 'a'.repeat(64), title: '组织书架扫描', type: 'txt', relativePath: 'scan.txt' };
  const organization = {
    version: 1, revision: 0, updatedAt: null,
    preferences: { viewMode: 'flat' },
    collections: [], collectionOrders: {}, unassignedOrder: [book.id],
    bookAssignments: {}, orphanedBookIds: [], books: [book]
  };
  let scans = 0;
  window.browserHost.scanLibrary = async () => {
    scans += 1;
    return { books: [book], features: { libraryOrganization: true } };
  };
  window.browserHost.getLibraryOrganization = async () => organization;
  window.browserHost.openBook = async () => {};

  api.renderLibrary({ books: [book], features: { libraryOrganization: true }, organization });
  const create = window.document.querySelector('.library-create-button');
  const scan = window.document.querySelector('.library-scan-button');
  assert.equal(window.document.querySelector('.library-view-switcher'), null);
  assert.equal(window.document.body.textContent.includes('我的分类'), false);
  assert.equal(window.document.body.textContent.includes('按目录'), false);
  assert.ok(create.closest('.library-header-actions'));
  assert.equal(window.document.querySelector('.library-collections-section'), null);
  assert.equal(window.document.querySelector('.library-category-navigation [aria-current="page"] strong')?.textContent, '我的书籍');
  assert.ok(scan);

  create.click();
  assert.equal(
    window.document.querySelector('.library-collection-form')?.parentElement === window.document.querySelector('.library-category-navigation'),
    true
  );
  // Escape dismisses the inline form and hands focus back to 新建分类.
  window.document.querySelector('.library-collection-form input').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  assert.equal(window.document.querySelector('.library-collection-form'), null);
  assert.equal(window.document.activeElement, create);

  scan.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scans, 1);
});

test('library organization adds a book to the current collection through the existing placement API', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '已归类书籍', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '待加入书籍', type: 'txt', relativePath: 'two.txt' };
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const organization = {
    version: 1, revision: 4, updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [{ id: collectionId, name: '重点阅读' }],
    collectionOrders: { [collectionId]: [first.id] },
    unassignedOrder: [second.id],
    bookAssignments: { [first.id]: collectionId },
    orphanedBookIds: [], books: [first, second]
  };
  const calls = [];
  window.browserHost.openBook = async () => {};
  window.browserHost.placeLibraryBook = async (bookId, targetCollectionId, beforeBookId, revision) => {
    calls.push({ bookId, targetCollectionId, beforeBookId, revision });
    return {
      ...organization,
      revision: 5,
      collectionOrders: { [collectionId]: [first.id, second.id] },
      unassignedOrder: [],
      bookAssignments: { [first.id]: collectionId, [second.id]: collectionId }
    };
  };

  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization });
  window.document.querySelector('[data-library-collection-id] .library-organization-card-main').click();
  assert.equal(window.document.querySelector('.library-view')?.dataset.libraryMode, 'collection');
  window.document.querySelector('.library-header-actions button.library-create-button')?.click();
  assert.ok(window.document.querySelector('.library-book-picker'));
  assert.equal(window.document.querySelector('.library-book-picker-title')?.textContent, '添加书籍');
  assert.equal(window.document.querySelector('.library-book-picker strong')?.textContent, '待加入书籍');

  window.document.querySelector('.library-book-picker-add').click();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [{
    bookId: second.id,
    targetCollectionId: collectionId,
    beforeBookId: null,
    revision: 4
  }]);
  assert.deepEqual(
    [...window.document.querySelectorAll('.library-book strong')].map((item) => item.textContent),
    ['已归类书籍', '待加入书籍']
  );
});

test('UX book picker filters and moves multiple books with sequential revisions', async () => {
  const { window, api } = await createReaderDom();
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const books = [
    { id: 'a'.repeat(64), title: '历史甲', type: 'txt' },
    { id: 'b'.repeat(64), title: '历史乙', type: 'txt' },
    { id: 'c'.repeat(64), title: '科学丙', type: 'txt' }
  ];
  const organization = {
    version: 1, revision: 4, collections: [{ id: collectionId, name: '历史' }],
    collectionOrders: { [collectionId]: [] }, unassignedOrder: books.map((book) => book.id),
    bookAssignments: {}, books
  };
  const revisions = [];
  window.browserHost.placeLibraryBook = async (bookId, target, before, revision) => {
    revisions.push(revision);
    return {
      ...organization,
      revision: revision + 1,
      bookAssignments: Object.fromEntries(books.filter((item) => revisions.some((_n, index) => item.id === books[index]?.id)).map((item) => [item.id, collectionId])),
      collectionOrders: { [collectionId]: books.slice(0, revisions.length).map((book) => book.id) },
      unassignedOrder: books.slice(revisions.length).map((book) => book.id)
    };
  };
  api.renderLibrary({ books, features: { libraryOrganization: true }, organization });
  window.document.querySelector('[data-library-collection-id] .library-organization-card-main').click();
  window.document.querySelector('.library-header-actions .library-create-button').click();
  const picker = window.document.querySelector('.library-book-picker');
  const query = picker.querySelector('input[type="search"]');
  assert.ok(query);
  query.value = '历史';
  query.dispatchEvent(new window.Event('input'));
  assert.equal(picker.querySelectorAll('.library-book-picker-row:not([hidden])').length, 2);
  picker.querySelectorAll('.library-book-picker-row:not([hidden]) input[type="checkbox"]').forEach((item) => item.click());
  picker.querySelector('.library-book-picker-move-selected').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(revisions, [4, 5]);
  assert.equal(window.document.querySelector('.library-book-picker input[type="search"]')?.value, '历史');
  await window.happyDOM.close();
});

test('UX regular shelf keeps books openable while exposing direct reorder handles', async () => {
  const { window, api } = await createReaderDom();
  const books = [
    { id: 'a'.repeat(64), title: '第一本', type: 'txt' },
    { id: 'b'.repeat(64), title: '第二本', type: 'txt' }
  ];
  const organization = {
    version: 1, revision: 2, collections: [], collectionOrders: {},
    allBookOrder: books.map((book) => book.id), unassignedOrder: books.map((book) => book.id),
    bookAssignments: {}, books
  };
  let opened = 0;
  window.browserHost.openBook = async () => { opened += 1; };
  api.renderLibrary({ books, features: { libraryOrganization: true }, organization });
  assert.equal(window.document.querySelectorAll('.library-grid .library-reorder-handle').length, 2);
  window.document.querySelector('.library-book').click();
  assert.equal(opened, 1);
  await window.happyDOM.close();
});

test('library book cover starts a desktop drag only after movement and does not open on release', async () => {
  const { window, api } = await createReaderDom();
  const books = [
    { id: 'a'.repeat(64), title: '第一本', type: 'txt' },
    { id: 'b'.repeat(64), title: '第二本', type: 'txt' }
  ];
  const organization = {
    version: 1, revision: 2, collections: [], collectionOrders: {},
    allBookOrder: books.map(book => book.id), unassignedOrder: books.map(book => book.id),
    bookAssignments: {}, books
  };
  let opened = 0;
  window.browserHost.openBook = async () => { opened += 1; };
  api.renderLibrary({ books, features: { libraryOrganization: true }, organization });
  const card = window.document.querySelector('.library-grid .library-book');
  const item = card.closest('[data-reorder-id]');
  card.click();
  assert.equal(opened, 1);
  const cover = card.querySelector('.library-book-cover');
  const pointer = (type, x) => cover.dispatchEvent(new window.PointerEvent(type, {
    bubbles: true, pointerId: 31, pointerType: 'mouse', isPrimary: true, button: 0,
    clientX: x, clientY: 10
  }));
  pointer('pointerdown', 10);
  pointer('pointermove', 14);
  assert.equal(item.classList.contains('is-library-dragging'), false);
  pointer('pointermove', 18);
  assert.equal(item.classList.contains('is-library-dragging'), true);
  pointer('pointerup', 18);
  card.click();
  assert.equal(opened, 1);
  await window.happyDOM.close();
});

test('library Escape cancellation suppresses a delayed compatibility click after release', async () => {
  const { window, api } = await createReaderDom();
  const books = [
    { id: 'a'.repeat(64), title: '第一本', type: 'txt' },
    { id: 'b'.repeat(64), title: '第二本', type: 'txt' }
  ];
  const organization = {
    version: 1, revision: 2, collections: [], collectionOrders: {},
    allBookOrder: books.map(book => book.id), unassignedOrder: books.map(book => book.id),
    bookAssignments: {}, books
  };
  let opened = 0;
  window.browserHost.openBook = async () => { opened += 1; };
  api.renderLibrary({ books, features: { libraryOrganization: true }, organization });
  const card = window.document.querySelector('.library-grid .library-book');
  const cover = card.querySelector('.library-book-cover');
  const pointer = (type, x) => cover.dispatchEvent(new window.PointerEvent(type, {
    bubbles: true, pointerId: 32, pointerType: 'mouse', isPrimary: true, button: 0,
    clientX: x, clientY: 10
  }));
  pointer('pointerdown', 10);
  pointer('pointermove', 18);
  assert.equal(card.closest('[data-reorder-id]').classList.contains('is-library-dragging'), true);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  pointer('pointerup', 18);
  card.click();
  assert.equal(opened, 0);
  card.click();
  assert.equal(opened, 1);
  await window.happyDOM.close();
});

test('library organize mode still accepts cover drags but ignores its category selector', async () => {
  const { window, api } = await createReaderDom();
  const books = [{ id: 'a'.repeat(64), title: '第一本', type: 'txt' }];
  const organization = {
    version: 1, revision: 2, collections: [], collectionOrders: {},
    allBookOrder: books.map(book => book.id), unassignedOrder: books.map(book => book.id),
    bookAssignments: {}, books
  };
  api.renderLibrary({ books, features: { libraryOrganization: true }, organization });
  window.document.querySelector('.library-mode-button').click();
  const item = window.document.querySelector('.library-grid .library-reorder-item');
  const card = item.querySelector('.library-book');
  assert.equal(card.disabled, false);
  assert.equal(card.getAttribute('aria-disabled'), 'true');
  const select = item.querySelector('select');
  const send = (node, type, id, x) => node.dispatchEvent(new window.PointerEvent(type, {
    bubbles: true, pointerId: id, pointerType: 'mouse', isPrimary: true, button: 0,
    clientX: x, clientY: 10
  }));
  send(select, 'pointerdown', 40, 10);
  send(select, 'pointermove', 40, 18);
  assert.equal(item.classList.contains('is-library-dragging'), false);
  send(card.querySelector('.library-book-cover'), 'pointerdown', 41, 10);
  send(card.querySelector('.library-book-cover'), 'pointermove', 41, 18);
  assert.equal(item.classList.contains('is-library-dragging'), true);
  await window.happyDOM.close();
});

test('UX shelf exposes last-read book without changing manual order', async () => {
  const { window, api } = await createReaderDom();
  const books = [
    { id: 'a'.repeat(64), title: '第一本', type: 'txt' },
    { id: 'b'.repeat(64), title: '第二本', type: 'txt', coverUrl: '/covers/second.jpg' }
  ];
  api.state.userState.books[books[1].id] = {
    progress: { locator: '{"page":2}', percentage: 0.42, updatedAt: '2026-09-27T12:00:00Z' }
  };
  const organization = {
    version: 1, revision: 2, collections: [], collectionOrders: {},
    allBookOrder: books.map((book) => book.id), unassignedOrder: books.map((book) => book.id),
    bookAssignments: {}, books
  };
  api.renderLibrary({ books, features: { libraryOrganization: true }, organization });
  const recent = window.document.querySelector('.library-recent-reading');
  assert.equal(recent?.querySelector('h2')?.textContent, '继续阅读');
  assert.equal(recent?.querySelector('.library-recent-card strong')?.textContent, '第二本');
  assert.equal(recent?.querySelector('.library-recent-cover img')?.getAttribute('src'), '/covers/second.jpg');
  assert.match(recent?.textContent || '', /42%/);
  assert.equal(window.document.querySelector('.library-continue-button'), null);
  assert.ok(recent.compareDocumentPosition(window.document.querySelector('.library-grid')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual([...window.document.querySelectorAll('.library-grid .library-book strong')].map((item) => item.textContent), ['第一本', '第二本']);
  await window.happyDOM.close();
});

test('UX shelf keeps search and actions together while category navigation stays above recent books', async () => {
  const { window, api } = await createReaderDom();
  const book = { id: 'a'.repeat(64), title: '封面书籍', type: 'txt', coverUrl: '/covers/a.jpg' };
  api.state.userState.books[book.id] = {
    progress: { locator: '{"page":1}', updatedAt: '2026-09-27T12:00:00Z' }
  };
  const organization = {
    version: 1, revision: 2, collections: [], collectionOrders: {},
    allBookOrder: [book.id], unassignedOrder: [book.id], bookAssignments: {}, books: [book]
  };
  api.renderLibrary({ books: [book], scan: { status: 'completed', discoveredCount: 1, reusedCount: 1 },
    features: { libraryOrganization: true }, organization });
  const shell = window.document.querySelector('.library-view');
  const filter = shell.querySelector('.library-filter');
  assert.ok(filter.closest('.library-header-actions'));
  assert.equal(shell.querySelector('.library-scan-status').hidden, true);
  const nav = shell.querySelector('.library-category-navigation');
  const recent = shell.querySelector('.library-recent-reading');
  assert.ok(nav.compareDocumentPosition(recent) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(recent.compareDocumentPosition(shell.querySelector('.library-grid')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  await window.happyDOM.close();
});

test('UX shelf search hides an unrelated recent book without changing its saved progress', async () => {
  const { window, api } = await createReaderDom();
  const books = [
    { id: 'a'.repeat(64), title: '历史故事', type: 'txt' },
    { id: 'b'.repeat(64), title: '科学笔记', type: 'txt' }
  ];
  api.state.userState.books[books[0].id] = {
    progress: { locator: '{"page":1}', updatedAt: '2026-09-27T12:00:00Z' }
  };
  api.renderLibrary({ books });
  const filter = window.document.querySelector('.library-filter');
  const recent = window.document.querySelector('.library-recent-reading');
  filter.value = '科学';
  filter.dispatchEvent(new window.Event('input'));
  assert.equal(recent.hidden, true);
  filter.value = '历史';
  filter.dispatchEvent(new window.Event('input'));
  assert.equal(recent.hidden, false);
  assert.equal(api.state.userState.books[books[0].id].progress.locator, '{"page":1}');
  await window.happyDOM.close();
});

test('UX recent reading uses a compact cover card and completed scan feedback takes no layout space', async () => {
  const { window, api } = await createReaderDom();
  const style = window.document.createElement('style');
  style.textContent = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  window.document.head.appendChild(style);
  const book = { id: 'a'.repeat(64), title: '正在读的书', type: 'epub', coverUrl: '/cover.jpg' };
  api.state.userState.books[book.id] = {
    progress: { locator: '{"page":1}', updatedAt: '2026-09-27T12:00:00Z' }
  };
  api.renderLibrary({ books: [book], scan: { status: 'completed', discoveredCount: 1, reusedCount: 1 } });
  const card = window.document.querySelector('.library-recent-card');
  assert.equal(window.getComputedStyle(card).display, 'grid');
  assert.equal(window.getComputedStyle(card.querySelector('.library-book-cover')).width, '48px');
  assert.equal(window.getComputedStyle(card.querySelector('.library-book-cover')).height, '70px');
  assert.equal(window.getComputedStyle(window.document.querySelector('.library-scan-status')).display, 'none');
  await window.happyDOM.close();
});

test('library home exposes stable extension regions without changing its existing sections', async () => {
  const { window, api } = await createReaderDom();
  const book = { id: 'a'.repeat(64), title: '扩展锚点测试', type: 'epub', coverUrl: '/cover.jpg' };
  api.state.userState.books[book.id] = {
    progress: { locator: '{"page":1}', updatedAt: '2026-09-27T12:00:00Z' }
  };
  api.renderLibrary({ books: [book], features: { libraryOrganization: true }, organization: {
    version: 1, revision: 1, collections: [], collectionOrders: {}, allBookOrder: [book.id],
    unassignedOrder: [book.id], bookAssignments: {}, books: [book]
  } });

  const shell = window.document.querySelector('.library-view');
  assert.ok(shell.querySelector('[data-library-slot="header"]')?.matches('.library-header'));
  assert.ok(shell.querySelector('[data-library-slot="header-actions"]')?.matches('.library-header-actions'));
  assert.ok(shell.querySelector('[data-library-slot="categories"]')?.matches('.library-category-navigation'));
  assert.ok(shell.querySelector('[data-library-slot="recent-reading"]')?.matches('.library-recent-reading'));
  assert.ok(shell.querySelector('[data-library-slot="book-grid"]')?.matches('.library-grid'));
  assert.deepEqual([...shell.querySelectorAll('.library-grid .library-book strong')].map((item) => item.textContent), ['扩展锚点测试']);
  await window.happyDOM.close();
});

test('library home styling fills rows with WeChat-Reading-sized covers at every breakpoint', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  assert.ok(/\.library-view\s*\{[^}]*width:\s*min\(1280px,\s*100%\)/s.test(css), 'library width should match the approved max-width');
  assert.ok(/^\.library-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(128px,\s*1fr\)\)/ms.test(css), 'desktop should fill rows with ~130px covers (eight on the 1280px shelf)');
  assert.ok(/^\.library-book-cover\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1\.45/ms.test(css), 'book covers should use the approved 1:1.45 frame');
  assert.ok(/@media\s*\(max-width:\s*919px\)[\s\S]*?\.library-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(112px,/.test(css), 'tablet covers should stay ~112px');
  assert.ok(/@media\s*\(max-width:\s*679px\)[\s\S]*?\.library-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(88px,/.test(css), 'phones should fit three ~100px covers per row');
  assert.equal(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css.match(/@media\s*\(max-width:\s*479px\)[^@]*/)?.[0] || ''), false, 'phones should no longer fall back to two oversized columns');
});

test('library root actions follow create, rescan, and organize order on one toolbar row', async () => {
  const { window, api } = await createReaderDom();
  const book = { id: 'a'.repeat(64), title: '工具栏顺序', type: 'txt' };
  const organization = {
    version: 1, revision: 0, collections: [], collectionOrders: {},
    allBookOrder: [book.id], unassignedOrder: [book.id], bookAssignments: {}, books: [book]
  };
  api.renderLibrary({ books: [book], features: { libraryOrganization: true }, organization });
  const actions = window.document.querySelector('.library-organization-view[data-library-mode="flat"] .library-header-actions');
  assert.deepEqual([...actions.querySelectorAll('button')].map((button) => button.textContent), ['新建分类', '重新扫描', '整理']);
  assert.ok(actions.querySelector('.library-filter'));
  await window.happyDOM.close();
});

test('library headings opt out of the article accent underline and search shares the toolbar row', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  assert.ok(/\.article\.is-library\s+\.library-recent-reading\s+h2\s*\{[^}]*border-bottom:\s*0/s.test(css), 'library recent-reading heading should not inherit the article underline');
  assert.ok(/\.article \.library-view \.library-empty-title\s*\{[^}]*border-bottom:\s*0/s.test(css), 'empty-state heading should not inherit the article underline');
  assert.ok(/^\.library-header-actions\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap/ms.test(css), 'desktop search and actions should share one toolbar row');
  assert.ok(/@media\s*\(max-width:\s*679px\)[\s\S]*?\.library-filter\s*\{\s*flex-basis:\s*100%/.test(css), 'phones should give search its own full-width row');
});

test('UX reorder handles stay available without dominating the resting shelf', async () => {
  const { window, api } = await createReaderDom();
  const style = window.document.createElement('style');
  style.textContent = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  window.document.head.appendChild(style);
  const book = { id: 'a'.repeat(64), title: '安静的封面', type: 'txt' };
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const organization = {
    version: 1, revision: 2, collections: [{ id: collectionId, name: '历史' }],
    collectionOrders: { [collectionId]: [] }, allBookOrder: [book.id],
    unassignedOrder: [book.id], bookAssignments: {}, books: [book]
  };
  api.renderLibrary({ books: [book], features: { libraryOrganization: true }, organization });
  const bookHandle = window.document.querySelector('.library-grid .library-reorder-handle');
  const categoryHandle = window.document.querySelector('.library-category-navigation .library-reorder-handle');
  assert.equal(bookHandle.tabIndex, 0);
  assert.equal(window.getComputedStyle(bookHandle).opacity, '0');
  assert.equal(categoryHandle.tabIndex, 0, 'collapsed category handles remain keyboard reachable');
  assert.equal(window.getComputedStyle(categoryHandle).width, '0px');
  window.document.querySelector('.library-mode-button').click();
  // Books are dragged by the card; their handle stays keyboard-only even in 整理.
  const manageBookHandle = window.document.querySelector('.library-grid .library-reorder-handle');
  assert.ok(manageBookHandle.classList.contains('is-keyboard-only'));
  assert.equal(manageBookHandle.tabIndex, 0);
  assert.equal(window.getComputedStyle(manageBookHandle).opacity, '0');
  assert.equal(window.getComputedStyle(window.document.querySelector('.library-category-navigation .library-reorder-handle')).width, '28px');
  await window.happyDOM.close();
});

test('UX category rename saves through revision API without deleting its books', async () => {
  const { window, api } = await createReaderDom();
  const id = '11111111-1111-4111-8111-111111111111';
  const book = { id: 'a'.repeat(64), title: '旧书', type: 'txt' };
  const organization = {
    version: 1, revision: 4, collections: [{ id, name: '旧名' }],
    collectionOrders: { [id]: [book.id] }, unassignedOrder: [],
    bookAssignments: { [book.id]: id }, books: [book]
  };
  let called;
  window.browserHost.renameLibraryCollection = async (...args) => {
    called = args;
    return { ...organization, revision: 5, collections: [{ id, name: '新名' }] };
  };
  api.renderLibrary({ books: [book], features: { libraryOrganization: true }, organization });
  window.document.querySelector('.library-mode-button').click();
  window.document.querySelector('.library-organization-card-rename').click();
  const form = window.document.querySelector('.library-collection-rename-form');
  assert.ok(form);
  form.querySelector('input').value = '新名';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(called, [id, '新名', 4]);
  assert.equal(window.document.querySelector('[data-library-collection-id] strong')?.textContent, '新名');
  await window.happyDOM.close();
});

test('library organization uses drag handles instead of visible move buttons and keeps keyboard reorder', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '第一本', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '第二本', type: 'txt', relativePath: 'two.txt' };
  const firstCollection = '11111111-1111-4111-8111-111111111111';
  const secondCollection = '22222222-2222-4222-8222-222222222222';
  const baseOrganization = {
    version: 1,
    revision: 0,
    updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [
      { id: firstCollection, name: '第一组' },
      { id: secondCollection, name: '第二组' }
    ],
    collectionOrders: { [firstCollection]: [first.id], [secondCollection]: [second.id] },
    unassignedOrder: [],
    bookAssignments: { [first.id]: firstCollection, [second.id]: secondCollection },
    orphanedBookIds: [],
    books: [first, second]
  };
  const calls = [];
  window.browserHost.reorderLibraryOrganization = async (scope, order) => {
    calls.push({ scope, order });
    return { ...baseOrganization, revision: 1, collections: [
      { id: secondCollection, name: '第二组' },
      { id: firstCollection, name: '第一组' }
    ] };
  };
  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization: baseOrganization });
  assert.equal(window.document.querySelectorAll('.library-reorder-controls').length, 0);
  window.document.querySelector('.library-mode-button').click();
  assert.equal(window.document.querySelectorAll('.library-reorder-button').length, 0);
  assert.ok(window.document.querySelectorAll('.library-reorder-handle').length >= 4);
  const categoryHandle = window.document.querySelector('.library-category-navigation .library-reorder-handle');
  categoryHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [{ scope: 'collections', order: [secondCollection, firstCollection] }]);
});

test('library organization exposes a visible drag handle and keeps book cards inert in manage mode', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '第一本', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '第二本', type: 'txt', relativePath: 'two.txt' };
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const organization = {
    version: 1,
    revision: 0,
    updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [{ id: collectionId, name: '重点阅读' }],
    collectionOrders: { [collectionId]: [first.id, second.id] },
    unassignedOrder: [],
    bookAssignments: { [first.id]: collectionId, [second.id]: collectionId },
    orphanedBookIds: [],
    books: [first, second]
  };
  let opened = 0;
  window.browserHost.openBook = async () => { opened += 1; };

  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization });
  window.document.querySelector('.library-mode-button').click();

  const handles = window.document.querySelectorAll('.library-grid .library-reorder-handle');
  assert.equal(handles.length, 2);
  assert.match(handles[0].getAttribute('aria-label'), /拖动排序.*第一本/);
  window.document.querySelector('.library-book').click();
  assert.equal(opened, 0);
});

test('library organization activates mouse reorder only after deliberate movement', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '第一本', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '第二本', type: 'txt', relativePath: 'two.txt' };
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const organization = {
    version: 1,
    revision: 0,
    updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [{ id: collectionId, name: '重点阅读' }],
    collectionOrders: { [collectionId]: [first.id, second.id] },
    unassignedOrder: [],
    bookAssignments: { [first.id]: collectionId, [second.id]: collectionId },
    orphanedBookIds: [],
    books: [first, second]
  };
  window.browserHost.reorderLibraryOrganization = async () => organization;

  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization });
  window.document.querySelector('.library-mode-button').click();

  const handle = window.document.querySelector('.library-reorder-handle');
  const item = handle.closest('[data-reorder-id]');
  handle.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 11,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: 10,
    clientY: 10
  }));
  assert.equal(item.classList.contains('is-library-dragging'), false);
  handle.dispatchEvent(new window.PointerEvent('pointermove', {
    bubbles: true, pointerId: 11, pointerType: 'mouse', clientX: 18, clientY: 10
  }));
  assert.equal(item.classList.contains('is-library-dragging'), true);
  handle.dispatchEvent(new window.PointerEvent('pointerup', {
    bubbles: true,
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 10,
    clientY: 10
  }));
  assert.equal(item.classList.contains('is-library-dragging'), false);
  assert.equal(item.hasAttribute('aria-grabbed'), false);
});

test('library organization keeps touch reorder delayed and cancels when the finger moves', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '第一本', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '第二本', type: 'txt', relativePath: 'two.txt' };
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const organization = {
    version: 1,
    revision: 0,
    updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [{ id: collectionId, name: '重点阅读' }],
    collectionOrders: { [collectionId]: [first.id, second.id] },
    unassignedOrder: [],
    bookAssignments: { [first.id]: collectionId, [second.id]: collectionId },
    orphanedBookIds: [],
    books: [first, second]
  };
  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization });
  window.document.querySelector('.library-mode-button').click();

  const handle = window.document.querySelector('.library-reorder-handle');
  const item = handle.closest('[data-reorder-id]');
  handle.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 21,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 10,
    clientY: 10
  }));
  assert.equal(item.classList.contains('is-library-dragging'), false);
  handle.dispatchEvent(new window.PointerEvent('pointermove', {
    bubbles: true,
    pointerId: 21,
    pointerType: 'touch',
    clientX: 20,
    clientY: 10
  }));
  await new Promise((resolve) => setTimeout(resolve, 380));
  assert.equal(item.classList.contains('is-library-dragging'), false);

  handle.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 22,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 10,
    clientY: 10
  }));
  await new Promise((resolve) => setTimeout(resolve, 380));
  assert.equal(item.classList.contains('is-library-dragging'), true);
});

test('source-folder mode is no longer exposed by the library home', async () => {
  const { window, api } = await createReaderDom();
  const rootId = 'c'.repeat(64);
  const first = { id: 'a'.repeat(64), title: '目录中的书', type: 'txt', relativePath: '营养/基础/one.txt', sourceRootId: rootId, sourcePathSegments: ['营养', '基础'] };
  const second = { id: 'b'.repeat(64), title: '根目录的书', type: 'txt', relativePath: 'two.txt', sourceRootId: rootId, sourcePathSegments: [] };
  const organization = {
    version: 1, revision: 0, updatedAt: null,
    preferences: { viewMode: 'source-folders' },
    collections: [], collectionOrders: {}, unassignedOrder: [first.id, second.id],
    bookAssignments: {}, orphanedBookIds: [], books: [first, second]
  };
  api.renderLibrary({ books: [first, second], features: { libraryOrganization: true }, organization });
  assert.equal(window.document.querySelector('.library-view')?.dataset.libraryMode, 'flat');
  assert.equal(window.document.querySelector('.library-view-switcher'), null);
  assert.equal(window.document.body.textContent.includes('按目录'), false);
  assert.equal(window.history.state.libraryOrganization.mode, 'root');
  assert.equal(window.document.querySelectorAll('.library-reorder-controls').length, 0);
});

test('AI local retrieval chunks book text and prioritizes selected terms and current chapter', async () => {
  const { api } = await createReaderDom();
  const index = api.aiApi.buildBookSearchIndex([
    { index: 0, href: 'OPS/one.xhtml', label: '第一章', text: '苹果和维生素是第一章的内容。' },
    { index: 1, href: 'OPS/two.xhtml', label: '第二章', text: '蛋白质与氨基酸是第二章的核心内容，蛋白质帮助身体维持健康。' }
  ]);
  assert.ok(index.length >= 2);
  const results = api.aiApi.searchBookIndex(index, {
    query: '蛋白质如何维持健康',
    selectedText: '蛋白质帮助身体维持健康',
    currentChapterIndex: 1,
    limit: 3
  });
  assert.ok(results.length > 0);
  assert.equal(results[0].chapterIndex, 1);
  assert.match(results[0].text, /蛋白质/);
  assert.ok(results[0].score > 0);
});

test('AI local retrieval weights chapter titles and headings without expanding the result budget', async () => {
  const { api } = await createReaderDom();
  const index = api.aiApi.buildBookSearchIndex([
    {
      index: 0,
      href: 'OPS/one.xhtml',
      label: '第一章 日常饮食',
      headings: ['早餐与能量'],
      text: '这里介绍普通饮食安排和生活习惯。'
    },
    {
      index: 1,
      href: 'OPS/two.xhtml',
      label: '第二章 蛋白质',
      headings: ['蛋白质的需要量'],
      text: '蛋白质帮助身体维持健康，食物中的蛋白质需要合理摄取。'
    }
  ]);
  const results = api.aiApi.searchBookIndex(index, {
    query: '蛋白质需要量',
    currentChapterIndex: 0,
    limit: 3
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].chapterIndex, 1);
  assert.ok(results[0].headingScore > 0);
  assert.ok(results[0].score >= results[0].bodyScore);
});

test('AI local retrieval removes overlapping chunks before filling the fixed result budget', async () => {
  const { api } = await createReaderDom();
  const repeated = '蛋白质是人体重要的营养物质，合理摄取蛋白质有助于维持健康。'.repeat(20);
  const index = api.aiApi.buildBookSearchIndex([
    { index: 0, href: 'OPS/one.xhtml', label: '第一章', text: repeated },
    { index: 1, href: 'OPS/two.xhtml', label: '第二章', text: '维生素和矿物质同样与健康有关。'.repeat(30) }
  ]);
  const results = api.aiApi.searchBookIndex(index, {
    query: '蛋白质 健康 维生素',
    limit: 6
  });

  assert.ok(results.length <= 6);
  assert.ok(new Set(results.map((item) => `${item.chapterIndex}:${item.start}`)).size === results.length);
  assert.ok(results.some((item) => item.chapterIndex === 1));
  assert.ok(results.reduce((total, item) => total + item.text.length, 0) <= 5400);
});

test('AI local retrieval exposes a guarded state for weak matches', async () => {
  const { api } = await createReaderDom();
  const weak = api.aiApi.assessAiRetrievalConfidence([
    { text: '蛋白质是人体重要的营养物质。', lexicalScore: 2, bodyScore: 2, retrievalSources: ['fts', 'lexical'] }
  ], { query: '量子物理火星发动机' });
  assert.equal(weak.level, 'low');
  assert.equal(weak.guarded, true);
});

test('AI panel exposes a safe answer surface and the selection entry point', async () => {
  const { window, api } = await createReaderDom();
  assert.ok(window.document.getElementById('aiModal'));
  assert.equal(window.document.getElementById('readerPanelAi'), null);
  assert.ok(window.document.getElementById('aiQuestion'));
  assert.ok(window.document.getElementById('aiAnswer'));
  assert.equal(window.document.querySelector('.ai-answer-title'), null);
  assert.ok(window.document.getElementById('aiBaseUrl'));
  assert.ok(window.document.getElementById('aiApiKey'));
  assert.ok(window.document.getElementById('aiModel'));
  assert.match(await fs.readFile(path.resolve(__dirname, '../app/ui/reader/selection-menu.js'), 'utf8'), /openAiForSelection/);
  assert.equal(typeof api.aiApi.openAiForSelection, 'function');
  api.state.contentType = 'epub';
  await api.aiApi.openAiForSelection({ text: '书本选中文本' });
  assert.equal(window.document.getElementById('aiModal').hidden, false);
  assert.equal(window.document.getElementById('readerDrawer').hidden, true);
  const answer = window.document.getElementById('aiAnswer');
  window.marked.parse = () => '<h2>核心观点</h2><p><strong>书本依据</strong>如下：</p><ul><li>第一条</li></ul>';
  api.aiApi.renderAiAnswer('## 核心观点\n\n**书本依据**如下：\n\n- 第一条');
  assert.equal(answer.querySelector('h2')?.textContent, '核心观点');
  assert.equal(answer.querySelector('strong')?.textContent, '书本依据');
  assert.equal(answer.querySelector('li')?.textContent, '第一条');
  window.marked.parse = () => '<p onclick="alert(1)"><script>alert(1)</script><strong>安全文本</strong><a href="javascript:alert(1)">危险链接</a><a href="https://example.com">安全链接</a></p>';
  api.aiApi.renderAiAnswer('恶意输入');
  assert.equal(answer.querySelector('script'), null);
  assert.equal(answer.querySelector('[onclick]'), null);
  assert.equal(answer.querySelector('a[href^="javascript:"]'), null);
  assert.equal(answer.querySelector('a[href="https://example.com/"]')?.textContent, '安全链接');
});

test('AI settings open as a secondary sheet without replacing the conversation and close after saving', async () => {
  const { window, api } = await createReaderDom();
  let saveCount = 0;
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConfig: async () => ({ baseUrl: 'https://api.example.com/v1', model: 'test-model', hasApiKey: true }),
    saveAiConfig: async () => {
      saveCount += 1;
      return { configured: true, model: 'test-model', hasApiKey: true };
    }
  };
  api.state.contentType = 'epub';
  await api.aiApi.openAiForSelection({ text: '设置浮层测试' });
  api.aiApi.renderAiAnswer('当前对话内容');
  await api.aiApi.openAiConfigSheet();
  await waitFor(() => window.document.getElementById('aiConfigView')?.hidden === false, 'AI settings sheet did not open');
  assert.equal(window.document.getElementById('aiChatView')?.hidden, false);
  assert.equal(window.document.getElementById('aiAnswer')?.textContent, '当前对话内容');
  await api.aiApi.saveAiSettings();
  await waitFor(() => saveCount === 1, 'AI settings did not save');
  await waitFor(() => window.document.getElementById('aiConfigView')?.hidden === true, 'AI settings sheet did not close after saving');
  assert.equal(window.document.getElementById('aiChatView')?.hidden, false);
  assert.equal(window.document.getElementById('aiAnswer')?.textContent, '当前对话内容');
});

test('AI conversation survives close and restores the active server conversation on reopen', async () => {
  const { window, api } = await createReaderDom();
  const calls = [];
  const bookId = 'c'.repeat(64);
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async (requestedBookId) => {
      calls.push(['list', requestedBookId]);
      return {
        activeConversationId: 'conversation-1',
        conversations: [{
          id: 'conversation-1',
          title: '本书讲了什么',
          messageCount: 2,
          createdAt: '2026-09-21T00:00:00.000Z',
          updatedAt: '2026-09-21T00:00:01.000Z'
        }]
      };
    },
    getAiConversation: async (conversationId, requestedBookId) => {
      calls.push(['detail', conversationId, requestedBookId]);
      return {
        id: conversationId,
        title: '本书讲了什么',
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:01.000Z',
        messages: [
          { id: 'user-message', role: 'user', content: '本书讲了什么？', createdAt: '2026-09-21T00:00:00.000Z' },
          {
            id: 'assistant-message',
            role: 'assistant',
            content: '本书主要讨论营养与健康。',
            sources: [{ citationIndex: 1, chapterIndex: 0, chapterHref: '', chapterLabel: '前言' }],
            createdAt: '2026-09-21T00:00:01.000Z'
          }
        ]
      };
    }
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;

  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => window.document.getElementById('aiAnswer')?.textContent.includes('营养与健康'), 'AI conversation did not restore');
  assert.equal(window.document.getElementById('aiMessages')?.textContent.includes('本书讲了什么？'), true);
  assert.deepEqual(calls.slice(0, 2), [
    ['list', bookId],
    ['detail', 'conversation-1', bookId]
  ]);
  assert.equal(api.aiApi.getAiConversationState().conversationId, 'conversation-1');

  api.aiApi.closeAiModal({ restoreFocus: false });
  assert.equal(window.document.getElementById('aiModal').hidden, true);
  assert.match(window.document.getElementById('aiAnswer').textContent, /营养与健康/);

  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => calls.filter(([kind]) => kind === 'list').length === 2, 'AI conversation was not reloaded after reopen');
  assert.match(window.document.getElementById('aiAnswer').textContent, /营养与健康/);
});

test('a delayed AI conversation restore cannot erase a newly completed PDF answer', async () => {
  const { window, api } = await createReaderDom();
  const bookId = '1'.repeat(64);
  let releaseDetail;
  api.state.contentType = 'pdf';
  api.state.currentBookId = bookId;
  window.pdfReaderController = { getPageCount: () => 9 };
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({ activeConversationId: 'old', conversations: [{ id: 'old', title: '旧对话' }] }),
    getAiConversation: async () => new Promise((resolve) => { releaseDetail = resolve; }),
    askAiStream: async (_bookId, _request, handlers) => {
      handlers.onDone({ answer: '新回答', sources: [] });
      return { answer: '新回答', sources: [] };
    }
  };
  const opening = api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => typeof releaseDetail === 'function', 'conversation detail request did not start');
  window.document.getElementById('aiQuestion').value = '新问题';
  assert.equal(await api.aiApi.askAiQuestion(), true);
  assert.match(window.document.getElementById('aiMessages').textContent, /新回答/);
  releaseDetail({ id: 'old', messages: [{ role: 'assistant', content: '旧回答', sources: [] }] });
  await opening;
  assert.match(window.document.getElementById('aiMessages').textContent, /新回答/);
});

test('first AI answer survives delayed status loading before conversation restoration begins', async () => {
  const { window, api } = await createReaderDom();
  let releaseStatus;
  let restoreCalls = 0;
  api.state.contentType = 'pdf';
  api.state.currentBookId = '3'.repeat(64);
  window.pdfReaderController = { getPageCount: () => 9 };
  window.browserHost = {
    aiStatus: async () => new Promise((resolve) => { releaseStatus = resolve; }),
    getAiConversations: async () => { restoreCalls += 1; return { conversations: [] }; },
    askAiStream: async (_bookId, _request, handlers) => {
      handlers.onDone({ answer: '首轮回答', sources: [] });
      return { answer: '首轮回答', sources: [] };
    }
  };
  const opening = api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => typeof releaseStatus === 'function');
  window.document.getElementById('aiQuestion').value = '首轮问题';
  assert.equal(await api.aiApi.askAiQuestion(), true);
  releaseStatus({ configured: true, model: 'test-model' });
  await opening;
  assert.equal(restoreCalls, 0);
  assert.match(window.document.getElementById('aiMessages').textContent, /首轮回答/);
});

test('AI browser stream rejects EOF without a done event', async () => {
  const { window } = await createReaderDom();
  window.fetch = async () => new Response('event: meta\ndata: {}\n\nevent: delta\ndata: {"delta":"半句"}\n\n', {
    status: 200, headers: { 'Content-Type': 'text/event-stream' }
  });
  await assert.rejects(() => window.browserHost.askAiStream('1'.repeat(64), { question: '问题' }), /中断/);
});

test('failed PDF AI answer restores the question and removes the empty answer card', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'pdf';
  api.state.currentBookId = '2'.repeat(64);
  window.pdfReaderController = { getPageCount: () => 9 };
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    askAiStream: async () => { throw new Error('AI 回答超时，请重试。'); }
  };
  await api.aiApi.openAiModal(null, window.document.body);
  const question = window.document.getElementById('aiQuestion');
  question.value = '这篇文章研究什么？';
  assert.equal(await api.aiApi.askAiQuestion(), false);
  assert.equal(question.value, '这篇文章研究什么？');
  assert.equal(window.document.getElementById('aiInitialAnswerCard').hidden, true);
  assert.match(window.document.getElementById('aiStatus').textContent, /超时/);
});

test('AI conversation restore failure shows retry without blocking the reader', async () => {
  const { window, api } = await createReaderDom();
  let attempts = 0;
  api.state.contentType = 'epub';
  api.state.currentBookId = 'd'.repeat(64);
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('网络暂时不可用');
      return { activeConversationId: null, conversations: [] };
    }
  };

  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => window.document.getElementById('aiStatus')?.textContent.includes('重试'), 'restore retry state was not shown');
  assert.equal(window.document.getElementById('aiModal').hidden, false);
  assert.equal(window.document.getElementById('aiQuestion').disabled, false);
  const retry = window.document.getElementById('btnAiRetryConversation');
  assert.ok(retry);
  retry.click();
  await waitFor(() => attempts === 2, 'restore retry did not call the API again');
  assert.doesNotMatch(window.document.getElementById('aiStatus').textContent, /网络暂时不可用/);
});

test('switching books clears in-memory AI conversation and never restores the previous book', async () => {
  const { window, api } = await createReaderDom();
  const calls = [];
  const firstBook = 'e'.repeat(64);
  const secondBook = 'f'.repeat(64);
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async (bookId) => {
      calls.push(bookId);
      return bookId === firstBook
        ? { activeConversationId: 'old-conversation', conversations: [{ id: 'old-conversation', title: '旧会话', messageCount: 2 }] }
        : { activeConversationId: null, conversations: [] };
    },
    getAiConversation: async () => ({
      id: 'old-conversation',
      title: '旧会话',
      messages: [
        { id: 'old-user', role: 'user', content: '旧问题', createdAt: '2026-09-21T00:00:00.000Z' },
        { id: 'old-answer', role: 'assistant', content: '旧回答', sources: [], createdAt: '2026-09-21T00:00:01.000Z' }
      ]
    })
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = firstBook;
  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => window.document.getElementById('aiAnswer')?.textContent.includes('旧回答'), 'old conversation did not restore');

  await window.appHost.receiveDocument({
    path: 'second.txt',
    name: '第二本书',
    type: 'text',
    content: '第二本书内容',
    bookId: secondBook
  });
  assert.equal(api.state.currentBookId, secondBook);
  assert.equal(api.aiApi.getAiConversationState().conversationId, null);
  assert.doesNotMatch(window.document.getElementById('aiMessages').textContent, /旧回答/);
  assert.equal(window.document.getElementById('aiModal').hidden, true);
});

test('new AI conversation creates a new server session without deleting the old one', async () => {
  const { window, api } = await createReaderDom();
  const calls = [];
  api.state.contentType = 'epub';
  api.state.currentBookId = '1'.repeat(64);
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({
      activeConversationId: 'old-conversation',
      conversations: [{ id: 'old-conversation', title: '旧会话', messageCount: 2 }]
    }),
    getAiConversation: async () => ({
      id: 'old-conversation',
      title: '旧会话',
      messages: [
        { id: 'old-user', role: 'user', content: '旧问题', createdAt: '2026-09-21T00:00:00.000Z' },
        { id: 'old-answer', role: 'assistant', content: '旧回答', sources: [], createdAt: '2026-09-21T00:00:01.000Z' }
      ]
    }),
    createAiConversation: async (title, bookId) => {
      calls.push(['create', title, bookId]);
      return { id: 'new-conversation', title: '新对话', messages: [] };
    },
    deleteAiConversation: async (...args) => calls.push(['delete', ...args]),
    clearAiConversation: async (...args) => calls.push(['clear', ...args])
  };
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => window.document.getElementById('aiAnswer')?.textContent.includes('旧回答'), 'old conversation did not restore');
  window.document.getElementById('btnAiNewConversation').click();
  await waitFor(() => api.aiApi.getAiConversationState().conversationId === 'new-conversation', 'new conversation was not created');
  assert.deepEqual(calls, [['create', '', '1'.repeat(64)]]);
  assert.doesNotMatch(window.document.getElementById('aiMessages').textContent, /旧回答/);
  assert.equal(window.document.getElementById('aiInitialAnswerCard').hidden, true);
});

test('AI conversation list shows bounded summaries and switches by loading selected details', async () => {
  const { window, api } = await createReaderDom();
  const calls = [];
  const bookId = '2'.repeat(64);
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({
      activeConversationId: 'conversation-1',
      conversations: [
        {
          id: 'conversation-1',
          title: '第一轮问题',
          messageCount: 2,
          createdAt: '2026-09-21T00:00:00.000Z',
          updatedAt: '2026-09-21T00:00:01.000Z'
        },
        {
          id: 'conversation-2',
          title: '第二轮问题',
          messageCount: 4,
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:01.000Z'
        }
      ]
    }),
    getAiConversation: async (conversationId) => {
      calls.push(['detail', conversationId]);
      return {
        id: conversationId,
        title: conversationId === 'conversation-1' ? '第一轮问题' : '第二轮问题',
        messages: [
          { id: `${conversationId}-user`, role: 'user', content: `${conversationId} 的问题`, createdAt: '2026-09-21T00:00:00.000Z' },
          { id: `${conversationId}-answer`, role: 'assistant', content: `${conversationId} 的回答`, sources: [], createdAt: '2026-09-21T00:00:01.000Z' }
        ]
      };
    }
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => window.document.getElementById('aiAnswer')?.textContent.includes('conversation-1 的回答'), 'active conversation did not restore');

  window.document.getElementById('btnAiConversations').click();
  await waitFor(() => window.document.getElementById('aiConversationsView')?.hidden === false, 'conversation sheet did not open');
  const rows = window.document.querySelectorAll('.ai-conversation-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /第一轮问题/);
  assert.match(rows[0].textContent, /2 条消息/);
  assert.doesNotMatch(rows[0].textContent, /conversation-1 的回答/);

  window.document.querySelector('[data-ai-conversation-id="conversation-2"] .ai-conversation-open').click();
  await waitFor(() => window.document.getElementById('aiAnswer')?.textContent.includes('conversation-2 的回答'), 'selected conversation did not restore');
  assert.equal(api.aiApi.getAiConversationState().conversationId, 'conversation-2');
  assert.deepEqual(calls, [['detail', 'conversation-1'], ['detail', 'conversation-2']]);
  assert.equal(window.document.getElementById('aiConversationsView').hidden, true);
});

test('AI conversation confirmation surface exposes an app-owned alertdialog contract', async () => {
  const { window } = await createReaderDom();
  const view = window.document.getElementById('aiConversationConfirmView');
  assert.ok(view);
  assert.equal(view.getAttribute('role'), 'alertdialog');
  assert.equal(view.getAttribute('aria-modal'), 'true');
  assert.equal(view.hidden, true);
  assert.equal(window.document.getElementById('btnCancelAiConversationConfirm').textContent, '取消');
  assert.ok(window.document.getElementById('btnConfirmAiConversationAction'));
});

test('AI conversation delete and clear update only the local summary after server success', async () => {
  const { window, api } = await createReaderDom();
  const calls = [];
  const bookId = '3'.repeat(64);
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({
      activeConversationId: 'conversation-1',
      conversations: [
        { id: 'conversation-1', title: '当前会话', messageCount: 2, updatedAt: '2026-09-21T00:00:01.000Z' },
        { id: 'conversation-2', title: '待删除会话', messageCount: 2, updatedAt: '2026-09-20T00:00:01.000Z' }
      ]
    }),
    getAiConversation: async () => ({
      id: 'conversation-1',
      messages: [
        { id: 'user', role: 'user', content: '当前问题', createdAt: '2026-09-21T00:00:00.000Z' },
        { id: 'answer', role: 'assistant', content: '当前回答', sources: [], createdAt: '2026-09-21T00:00:01.000Z' }
      ]
    }),
    deleteAiConversation: async (conversationId, requestedBookId) => {
      calls.push(['delete', conversationId, requestedBookId]);
      return { deleted: true, id: conversationId };
    },
    clearAiConversation: async (conversationId, requestedBookId) => {
      calls.push(['clear', conversationId, requestedBookId]);
      return { id: conversationId, messages: [] };
    }
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  await waitFor(() => window.document.getElementById('aiAnswer')?.textContent.includes('当前回答'), 'current conversation did not restore');
  window.document.getElementById('btnAiConversations').click();
  await waitFor(() => window.document.querySelectorAll('.ai-conversation-row').length === 2, 'conversation list did not render');

  const clear = window.document.querySelector('[data-ai-conversation-id="conversation-1"] .ai-conversation-clear');
  const remove = window.document.querySelector('[data-ai-conversation-id="conversation-2"] .ai-conversation-delete');
  clear.click();
  assert.equal(calls.length, 0);
  assert.equal(window.document.getElementById('aiConversationConfirmView').hidden, false);
  assert.equal(window.document.getElementById('aiConversationConfirmTitle').textContent, '清空此会话？');
  assert.match(window.document.getElementById('aiConversationConfirmDescription').textContent, /当前会话.*2 条消息/);
  window.document.getElementById('btnCancelAiConversationConfirm').click();
  assert.equal(calls.length, 0);
  assert.equal(window.document.getElementById('aiConversationConfirmView').hidden, true);
  assert.equal(window.document.activeElement, clear);

  remove.click();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(calls.length, 0);
  assert.equal(window.document.getElementById('aiConversationConfirmView').hidden, true);
  assert.equal(window.document.activeElement, remove);

  clear.click();
  window.document.getElementById('btnCloseAiConversationConfirmBackdrop').click();
  assert.equal(calls.length, 0);
  assert.equal(window.document.getElementById('aiConversationConfirmView').hidden, true);

  clear.click();
  window.document.getElementById('btnConfirmAiConversationAction').click();
  await waitFor(() => calls.some(([kind]) => kind === 'clear'), 'clear conversation did not call the server');
  await waitFor(() => window.document.getElementById('aiAnswer').hidden === true, 'cleared conversation answer stayed visible');
  assert.equal(api.aiApi.getAiConversationState().conversationId, 'conversation-1');
  assert.equal(window.document.getElementById('aiAnswer').hidden, true);
  assert.match(window.document.querySelector('[data-ai-conversation-id="conversation-1"]').textContent, /0 条消息/);

  const removeAfterClear = window.document.querySelector('[data-ai-conversation-id="conversation-2"] .ai-conversation-delete');
  removeAfterClear.click();
  window.document.getElementById('btnConfirmAiConversationAction').click();
  await waitFor(() => window.document.querySelectorAll('.ai-conversation-row').length === 1, 'deleted conversation stayed in the list');
  assert.deepEqual(calls, [
    ['clear', 'conversation-1', bookId],
    ['delete', 'conversation-2', bookId]
  ]);
});

test('AI conversation management keeps the sheet open and offers retry after list or mutation failures', async () => {
  const { window, api } = await createReaderDom();
  const bookId = '4'.repeat(64);
  let listAttempts = 0;
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => {
      listAttempts += 1;
      if (listAttempts === 2) throw new Error('列表读取失败');
      return {
        activeConversationId: 'conversation-1',
        conversations: [{ id: 'conversation-1', title: '当前会话', messageCount: 2, updatedAt: '2026-09-21T00:00:01.000Z' }]
      };
    },
    getAiConversation: async () => ({ id: 'conversation-1', messages: [] }),
    deleteAiConversation: async () => { throw new Error('删除失败'); },
    clearAiConversation: async () => { throw new Error('清空失败'); }
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  window.document.getElementById('btnAiConversations').click();
  await waitFor(() => window.document.getElementById('aiConversationsView')?.hidden === false, 'conversation sheet did not open');
  window.document.getElementById('btnRefreshAiConversations').click();
  await waitFor(() => window.document.getElementById('aiConversationStatus')?.textContent.includes('列表读取失败'), 'list failure was not shown');
  assert.equal(window.document.getElementById('aiConversationsView').hidden, false);
  assert.ok(window.document.getElementById('btnRetryAiConversations'));

  window.document.getElementById('btnRetryAiConversations').click();
  await waitFor(() => (
    window.document.querySelectorAll('.ai-conversation-row').length === 1
    && window.document.querySelector('.ai-conversation-clear')?.disabled === false
  ), 'conversation list retry did not recover');
  window.document.querySelector('.ai-conversation-clear').click();
  window.document.getElementById('btnConfirmAiConversationAction').click();
  await waitFor(() => window.document.getElementById('aiConversationStatus')?.textContent.includes('清空失败'), 'clear failure was not shown');
  assert.equal(window.document.querySelectorAll('.ai-conversation-row').length, 1);

  window.document.querySelector('.ai-conversation-delete').click();
  window.document.getElementById('btnConfirmAiConversationAction').click();
  await waitFor(() => window.document.getElementById('aiConversationStatus')?.textContent.includes('删除失败'), 'delete failure was not shown');
  assert.equal(window.document.querySelectorAll('.ai-conversation-row').length, 1);
});

test('AI conversation confirmation submits only one mutation while it is pending', async () => {
  const { window, api } = await createReaderDom();
  const bookId = '7'.repeat(64);
  const calls = [];
  let resolveClear;
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({
      activeConversationId: 'conversation-1',
      conversations: [{ id: 'conversation-1', title: '当前会话', messageCount: 2 }]
    }),
    getAiConversation: async () => ({ id: 'conversation-1', messages: [] }),
    clearAiConversation: async (conversationId, requestedBookId) => {
      calls.push([conversationId, requestedBookId]);
      await new Promise((resolve) => { resolveClear = resolve; });
      return { id: conversationId, messages: [] };
    }
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  window.document.getElementById('btnAiConversations').click();
  await waitFor(() => window.document.querySelector('.ai-conversation-clear'), 'conversation row did not render');

  window.document.querySelector('.ai-conversation-clear').click();
  const confirm = window.document.getElementById('btnConfirmAiConversationAction');
  confirm.click();
  confirm.click();
  await waitFor(() => calls.length === 1, 'clear mutation did not start exactly once');
  assert.equal(confirm.disabled, true);
  assert.equal(window.document.getElementById('btnCancelAiConversationConfirm').disabled, true);
  resolveClear();
  await waitFor(() => window.document.querySelector('.ai-conversation-clear').disabled === false, 'conversation controls did not recover');
  assert.deepEqual(calls, [['conversation-1', bookId]]);
});

test('AI conversation confirmation becomes inert when its book changes or the AI modal closes', async () => {
  const { window, api } = await createReaderDom();
  const bookId = '8'.repeat(64);
  const calls = [];
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({
      activeConversationId: 'conversation-1',
      conversations: [{ id: 'conversation-1', title: '当前会话', messageCount: 2 }]
    }),
    getAiConversation: async () => ({ id: 'conversation-1', messages: [] }),
    clearAiConversation: async (...args) => calls.push(args)
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  window.document.getElementById('btnAiConversations').click();
  await waitFor(() => window.document.querySelector('.ai-conversation-clear'), 'conversation row did not render');

  window.document.querySelector('.ai-conversation-clear').click();
  api.state.currentBookId = '9'.repeat(64);
  window.document.getElementById('btnConfirmAiConversationAction').click();
  assert.equal(calls.length, 0);

  api.state.currentBookId = bookId;
  window.document.querySelector('.ai-conversation-clear').click();
  api.aiApi.closeAiModal({ restoreFocus: false });
  assert.equal(window.document.getElementById('aiConversationConfirmView').hidden, true);
  assert.equal(window.document.getElementById('aiConversationConfirmView').dataset.action, undefined);
  assert.equal(calls.length, 0);
});

test('AI conversation confirmation releases management controls after an in-flight book switch', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'a'.repeat(64);
  let resolveClear;
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({
      activeConversationId: 'conversation-1',
      conversations: [{ id: 'conversation-1', title: '当前会话', messageCount: 2 }]
    }),
    getAiConversation: async () => ({ id: 'conversation-1', messages: [] }),
    clearAiConversation: async () => new Promise((resolve) => { resolveClear = resolve; })
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  window.document.getElementById('btnAiConversations').click();
  await waitFor(() => window.document.querySelector('.ai-conversation-clear'), 'conversation row did not render');

  window.document.querySelector('.ai-conversation-clear').click();
  window.document.getElementById('btnConfirmAiConversationAction').click();
  await waitFor(() => window.document.getElementById('btnRefreshAiConversations').disabled, 'management controls did not lock');
  api.state.currentBookId = 'b'.repeat(64);
  resolveClear({ id: 'conversation-1', messages: [] });
  await waitFor(() => window.document.getElementById('btnRefreshAiConversations').disabled === false, 'management controls stayed locked after book switch');
});

test('AI browser stream reader dispatches split UTF-8 SSE events', async () => {
  const { window } = await createReaderDom();
  const encoder = new TextEncoder();
  const chunks = [
    'event: meta\ndata: {"sources":[]}',
    '\n\nevent: delta\ndata: {"delta":"第一"}\n\n',
    'event: delta\ndata: {"delta":"轮"}\n\n',
    'event: done\ndata: {"answer":"第一轮"}\n\n'
  ].map((chunk) => encoder.encode(chunk));
  window.fetch = async () => ({
    ok: true,
    body: {
      getReader() {
        let index = 0;
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
          }
        };
      }
    }
  });
  const received = { meta: null, deltas: [], done: null };
  const result = await window.browserHost.askAiStream('a'.repeat(64), { question: '问题' }, {
    onMeta: (value) => { received.meta = value; },
    onDelta: (value) => { received.deltas.push(value); },
    onDone: (value) => { received.done = value; }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(received.meta)), { sources: [] });
  assert.deepEqual(received.deltas, ['第一', '轮']);
  assert.deepEqual(JSON.parse(JSON.stringify(received.done)), { answer: '第一轮' });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { answer: '第一轮' });
});

test('PDF AI structure status is accessible, backward-compatible, and separate from EPUB wording', async () => {
  const { window, api } = await createReaderDom();
  const status = window.document.getElementById('aiStatus');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(api.aiApi.pdfAiStatusFromMeta({ profileStatus: 'ready' }, 4), '正在分析论文结构，仅发送有限页片段…');
  assert.equal(api.aiApi.pdfAiStatusFromMeta({ profileStatus: 'cached' }, 3), '已使用论文结构，正在检索原文页证据…');
  assert.equal(api.aiApi.pdfAiStatusFromMeta({ profileStatus: 'fallback' }, 2), '结构分析不可用，已按页检索。');
  assert.equal(api.aiApi.pdfAiStatusFromMeta({ sources: [] }, 2), '已找到 2 条页证据，正在生成回答…');
});

test('PDF full-book AI scope does not depend on the local PDF.js page renderer being ready', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'pdf';
  api.state.currentBookId = 'a'.repeat(64);
  window.pdfReaderController = { getPageCount: () => 0 };

  assert.deepEqual(JSON.parse(JSON.stringify(api.aiApi.pdfAiScopeInput())), { scope: 'searchable_book' });
});

test('AI citations render as circled links and only cited sources appear after completion', async () => {
  const { window, api } = await createReaderDom();
  await api.aiApi.openAiForSelection({ text: '引用测试' });
  api.aiApi.renderAiAnswer('本章明确说明了这个结论【1】，另一个片段没有被引用。');
  api.aiApi.renderAiSources([
    { chapterIndex: 0, chapterLabel: '第一章' },
    { chapterIndex: 1, chapterLabel: '第二章' }
  ], null, '本章明确说明了这个结论【1】，另一个片段没有被引用。');
  const citation = window.document.querySelector('#aiAnswer [data-ai-citation="1"]');
  assert.equal(citation?.textContent, '①');
  assert.equal(citation?.getAttribute('href'), '#ai-source-1');
  assert.equal(window.document.querySelectorAll('#aiSources .ai-source').length, 1);
  assert.match(window.document.querySelector('#aiSources')?.textContent || '', /第一章/);
  assert.doesNotMatch(window.document.querySelector('#aiSources')?.textContent || '', /第二章/);
  assert.equal(window.document.querySelector('#aiSources')?.hidden, false);

  api.aiApi.renderAiSources([{ chapterIndex: 0, chapterLabel: '第一章', citationIndexes: [1] }]);
  api.aiApi.renderAiAnswer('可信【1】与伪造【8】。', null, [{ citationIndex: 1 }]);
  assert.match(window.document.getElementById('aiAnswer')?.textContent || '', /可信①与伪造。/);
  assert.equal(window.document.querySelector('#aiAnswer [data-ai-citation="8"]'), null);

  api.aiApi.renderAiAnswer('同一章节的第二个片段支持这个结论【3】。');
  api.aiApi.renderAiSources([
    { chapterIndex: 0, chapterLabel: '第一章', citationIndexes: [1, 2, 3] }
  ], null, '同一章节的第二个片段支持这个结论【3】。');
  assert.equal(window.document.querySelector('#aiSources .ai-source-index')?.textContent, '3');
  assert.equal(window.document.querySelector('#aiSources .ai-source-label')?.textContent, '第一章');
  assert.ok(window.document.getElementById('ai-source-3'));
});

test('AI citations stay scoped to their own multi-turn answer card', async () => {
  const { window, api } = await createReaderDom();
  const createCard = () => {
    const card = window.document.createElement('div');
    card.className = 'ai-message-assistant ai-answer-card';
    const answer = window.document.createElement('div');
    answer.className = 'ai-answer';
    const sources = window.document.createElement('div');
    sources.className = 'ai-sources';
    card.append(answer, sources);
    window.document.body.appendChild(card);
    return { card, answer, sources };
  };
  const first = createCard();
  const second = createCard();
  const firstAnswer = '第一轮引用【1】。';
  const secondAnswer = '第二轮引用【1】。';
  api.aiApi.renderAiAnswer(firstAnswer, first.answer);
  api.aiApi.renderAiSources([{ chapterIndex: 0, chapterLabel: '第一章' }], first.sources, firstAnswer);
  api.aiApi.renderAiAnswer(secondAnswer, second.answer);
  api.aiApi.renderAiSources([{ chapterIndex: 1, chapterLabel: '第二章' }], second.sources, secondAnswer);
  const firstCitation = first.answer.querySelector('[data-ai-citation="1"]');
  const secondCitation = second.answer.querySelector('[data-ai-citation="1"]');
  assert.notEqual(firstCitation?.getAttribute('href'), secondCitation?.getAttribute('href'));
  assert.ok(first.card.querySelector('[data-ai-source-index="1"]'));
  assert.ok(second.card.querySelector('[data-ai-source-index="1"]'));
});

test('AI source chips use a fixed number badge and label slot for one and two digit citations', async () => {
  const { window, api } = await createReaderDom();
  await api.aiApi.openAiForSelection({ text: '来源标签样式' });
  const answer = '引用多个片段【1】【10】。';
  api.aiApi.renderAiAnswer(answer);
  api.aiApi.renderAiSources([
    { chapterIndex: 0, chapterLabel: '⑦ 第一章' },
    { chapterIndex: 9, chapterLabel: '⑩ 第十章', citationIndexes: [10] }
  ], null, answer);
  const chips = [...window.document.querySelectorAll('#aiSources .ai-source')];
  assert.equal(chips.length, 2);
  assert.deepEqual(chips.map((chip) => chip.querySelector('.ai-source-index')?.textContent), ['1', '10']);
  assert.deepEqual(chips.map((chip) => chip.querySelector('.ai-source-label')?.textContent), ['第一章', '第十章']);
  assert.equal(chips[0].getAttribute('aria-label'), '来源章节：⑦ 第一章');
  assert.equal(chips[1].getAttribute('aria-label'), '来源章节：⑩ 第十章');
});

test('user settings persistence serializes in-flight saves and keeps the newest snapshot', async () => {
  const { window, api } = await createReaderDom();
  const saves = [];
  let releaseFirstSave;
  const firstSaveGate = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCount = 0;

  window.browserHost = {
    saveSettings: async (settings) => {
      saves.push({ ...settings });
      saveCount += 1;
      if (saveCount === 1) await firstSaveGate;
      return settings;
    }
  };

  api.userStateApi.persistUserSettings();
  const firstFlush = api.userStateApi.flushUserSettings();
  await waitFor(() => saves.length === 1, 'first settings save did not start');

  api.state.theme = 'light';
  api.userStateApi.persistUserSettings();
  const secondFlush = api.userStateApi.flushUserSettings();
  releaseFirstSave();

  await Promise.all([firstFlush, secondFlush]);
  assert.equal(saves.length, 2);
  assert.equal(saves[0].theme, 'dark');
  assert.equal(saves[1].theme, 'light');
});

function mountDuplicateTextChapter(window) {
  const article = window.document.getElementById('article');
  article.innerHTML = '';
  const chapter = window.document.createElement('section');
  chapter.className = 'epub-chapter';
  chapter.dataset.sourcePath = 'OPS/chapter.xhtml';
  chapter.appendChild(window.document.createTextNode('alpha repeat middle repeat omega'));
  article.appendChild(chapter);
  return chapter;
}

test('bookmarks capture the current semantic locator and compare stable position fields', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  const target = window.document.createElement('p');
  target.id = 'bookmark-target';
  target.textContent = '当前书签位置';
  chapter.replaceChildren(target);

  const reader = window.document.getElementById('reader');
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 300 });
  reader.scrollTop = 80;
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.id === 'reader') return { left: 0, right: 800, top: 0, bottom: 100, width: 800, height: 100 };
    if (this.id === 'bookmark-target') return { left: 0, right: 400, top: 10, bottom: 40, width: 400, height: 30 };
    if (this.classList?.contains('epub-chapter')) return { left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300 };
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  };

  api.state.contentType = 'epub';
  api.state.currentBookId = 'bookmark-book';
  api.state.effectiveReadingMode = 'scroll';
  api.state.epubArchive = {};
  api.state.epubChapterCount = 4;
  api.state.epubChapterIndex = 1;

  const locator = api.getCurrentBookmarkLocator();
  assert.equal(locator.type, 'semantic-position');
  assert.equal(locator.href, 'OPS/chapter.xhtml');
  assert.equal(locator.anchor, 'bookmark-target');
  assert.equal(locator.readingScope, 'chapter');
  assert.equal(locator.chapterPercentage, 0.4);
  assert.equal(api.isCurrentBookmark({ locator }), false);
  assert.equal(api.isCurrentBookmark({ locator: { ...locator, pageNumber: 99, scrollTop: 999 } }), false);
});

test('PDF bookmarks capture, toggle, display, and jump to the exact zero-based page', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'pdf-bookmark-book';
  const controller = api.pdfApi.pdfReaderController;
  let pageIndex = 17;
  const jumps = [];
  controller.getCurrentBookId = () => bookId;
  controller.getCurrentPageIndex = () => pageIndex;
  controller.getPageCount = () => 30;
  controller.goToPdfPage = (target) => { jumps.push(target); return true; };
  api.state.contentType = 'pdf';
  api.state.currentBookId = bookId;
  api.state.userState.books[bookId] = { bookmarks: [] };
  api.renderToc();

  const locator = api.getCurrentBookmarkLocator();
  assert.deepEqual(JSON.parse(JSON.stringify(locator)), { version: 1, type: 'pdf', pageIndex: 17 });
  assert.equal(api.readerPanels.bookmarks.enabled(), true);
  assert.equal(api.renderBookmarkButtonState(), false);
  assert.equal(window.document.getElementById('btnBookmarks').disabled, false);
  assert.equal(window.document.getElementById('btnMobileTopBookmark').disabled, false);

  window.browserHost.createBookmark = async (input) => ({ id: 'pdf-mark-1', ...input });
  window.browserHost.deleteBookmark = async (id) => ({ deleted: true, id });
  const bookmark = await api.toggleCurrentBookmark();
  assert.deepEqual(bookmark.locator, locator);
  assert.equal(bookmark.label, '第 18 页');
  assert.equal(api.isCurrentBookmark(), true);

  api.renderBookmarkList();
  assert.equal(window.document.querySelector('.bookmark-row-title').textContent, '第 18 页');
  assert.equal(window.document.querySelector('.bookmark-row-meta').textContent, 'PDF · 第 18 页');
  assert.equal(await api.jumpToBookmark({ locator: { version: 1, type: 'pdf', pageIndex: 30 } }), false);
  assert.equal(await api.jumpToBookmark(bookmark), true);
  assert.deepEqual(jumps, [17]);

  pageIndex = 18;
  assert.equal(api.renderBookmarkButtonState(), false);
  assert.equal(window.document.getElementById('btnBookmarks').dataset.bookmarkActive, 'false');
  pageIndex = 17;
  assert.equal(api.renderBookmarkButtonState(), true);
  await api.toggleCurrentBookmark();
  assert.equal(api.state.userState.books[bookId].bookmarks.length, 0);
});

test('bookmark toggle persists add/remove and mirrors the current book state', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  const target = window.document.createElement('p');
  target.id = 'toggle-target';
  target.textContent = '切换书签';
  chapter.replaceChildren(target);
  const reader = window.document.getElementById('reader');
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 200 });
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.id === 'reader') return { left: 0, right: 800, top: 0, bottom: 100, width: 800, height: 100 };
    if (this.id === 'toggle-target') return { left: 0, right: 400, top: 10, bottom: 40, width: 400, height: 30 };
    if (this.classList?.contains('epub-chapter')) return { left: 0, right: 800, top: 0, bottom: 200, width: 800, height: 200 };
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  };

  const bookId = 'bookmark-toggle-book';
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.state.currentPath = 'bookmark-toggle.epub';
  api.state.effectiveReadingMode = 'scroll';
  api.state.epubArchive = {};
  api.state.epubChapterCount = 1;
  api.state.epubChapterIndex = 0;
  api.state.userState.books[bookId] = {};

  const calls = [];
  window.browserHost.createBookmark = async (input) => {
    calls.push({ type: 'create', input });
    return { id: 'bookmark-1', ...input, createdAt: '2026-09-21T00:00:00.000Z' };
  };
  window.browserHost.deleteBookmark = async (bookmarkId) => {
    calls.push({ type: 'delete', bookmarkId });
    return { deleted: true, id: bookmarkId };
  };

  const added = await api.toggleCurrentBookmark();
  assert.equal(added.id, 'bookmark-1');
  assert.deepEqual(calls.map((call) => call.type), ['create']);
  assert.equal(api.state.userState.books[bookId].bookmarks.length, 1);
  assert.equal(api.isCurrentBookmark(api.state.userState.books[bookId].bookmarks[0]), true);

  const removed = await api.toggleCurrentBookmark();
  assert.equal(removed.deleted, true);
  assert.deepEqual(calls.map((call) => call.type), ['create', 'delete']);
  assert.equal(api.state.userState.books[bookId].bookmarks.length, 0);
});

test('bookmark mutation failures leave button state and list state unchanged', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  const target = window.document.createElement('p');
  target.id = 'mutation-target';
  target.textContent = '变更目标';
  chapter.replaceChildren(target);
  const reader = window.document.getElementById('reader');
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 200 });
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.id === 'reader') return { left: 0, right: 800, top: 0, bottom: 100, width: 800, height: 100 };
    if (this.id === 'mutation-target') return { left: 0, right: 400, top: 10, bottom: 40, width: 400, height: 30 };
    if (this.classList?.contains('epub-chapter')) return { left: 0, right: 800, top: 0, bottom: 200, width: 800, height: 200 };
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  };

  const bookId = 'bookmark-mutation-book';
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.state.currentPath = 'bookmark-mutation.epub';
  api.state.effectiveReadingMode = 'scroll';
  api.state.epubArchive = {};
  api.state.epubChapterCount = 1;
  api.state.epubChapterIndex = 0;
  api.state.userState.books[bookId] = { bookmarks: [] };
  window.browserHost.createBookmark = async () => { throw new Error('network down'); };

  await assert.rejects(api.toggleCurrentBookmark(), /network down/);
  assert.deepEqual(api.state.userState.books[bookId].bookmarks, []);
  assert.equal(window.document.getElementById('btnBookmarks').dataset.bookmarkActive, 'false');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message = 'Timed out waiting for condition') {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

test('EPUB chapter rendering keeps only the latest out-of-order chapter load', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const chapterTwo = deferred();
  const chapterThree = deferred();
  const leases = [];
  const released = [];
  const resourceManager = {
    createLease() {
      const lease = { id: `lease-${leases.length + 1}`, paths: new Set(), released: false };
      leases.push(lease);
      return lease;
    },
    release(lease) {
      if (!lease || lease.released) return;
      lease.released = true;
      released.push(lease.id);
    },
    snapshot() { return { cachedBytes: 0, skippedResources: [] }; },
    destroy() {}
  };
  const files = {
    'OPS/chapter-2.xhtml': { async: () => chapterTwo.promise },
    'OPS/chapter-3.xhtml': { async: () => chapterThree.promise }
  };

  api.state.contentType = 'epub';
  api.state.epubArchive = {
    spine: [
      { index: 0, fullPath: 'OPS/chapter-1.xhtml' },
      { index: 1, fullPath: 'OPS/chapter-2.xhtml' },
      { index: 2, fullPath: 'OPS/chapter-3.xhtml' }
    ],
    zip: {
      files,
      file: (filePath) => files[filePath] || null
    },
    mediaTypes: {},
    resourceManager,
    resourceBudget: { totalBytes: 0, skippedResources: [], reserve: () => true },
    diagnostics: { inlinedResourceBytes: 0, skippedResourceCount: 0, skippedResources: [] }
  };
  api.state.epubChapterCount = 3;

  const secondRequest = api.renderEpubChapter(1);
  await waitFor(() => api.isEpubChapterLoading?.() === true, 'chapter 2 did not start loading');
  const thirdRequest = api.renderEpubChapter(2);
  await waitFor(() => api.isEpubChapterLoading?.() === true, 'chapter 3 did not start loading');

  chapterThree.resolve('<body><p id="third-target">third chapter</p></body>');
  assert.equal(await thirdRequest, true);
  assert.equal(api.state.epubChapterIndex, 2);
  assert.equal(api.state.epubArchive.activeChapterLease, leases[1]);
  assert.equal(article.querySelectorAll('.epub-chapter').length, 1);
  assert.equal(article.textContent, 'third chapter');

  chapterTwo.resolve('<body><p>second chapter</p></body>');
  assert.equal(await secondRequest, false);
  assert.equal(api.state.epubChapterIndex, 2);
  assert.deepEqual(released, ['lease-1']);
  assert.equal(article.querySelectorAll('.epub-chapter').length, 1);
  assert.equal(article.textContent, 'third chapter');
});

test('EPUB chapter leases release after DOM replacement and archive destruction', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const leases = [];
  const released = [];
  let managerDestroyed = false;
  const resourceManager = {
    createLease() {
      const lease = { id: `lease-${leases.length + 1}`, paths: new Set(), released: false };
      leases.push(lease);
      return lease;
    },
    release(lease) {
      if (!lease || lease.released) return;
      if (lease.id === 'lease-1') assert.match(article.textContent, /Chapter two/);
      lease.released = true;
      released.push(lease.id);
    },
    snapshot() { return { cachedBytes: 0, skippedResources: [] }; },
    destroy() {
      assert.deepEqual(released, ['lease-1', 'lease-2']);
      managerDestroyed = true;
    }
  };
  const entries = {
    'OPS/one.xhtml': { async: async () => '<body><p>Chapter one</p></body>' },
    'OPS/two.xhtml': { async: async () => '<body><p>Chapter two</p></body>' }
  };
  api.state.contentType = 'epub';
  api.state.epubChapterCount = 2;
  api.state.epubArchive = {
    spine: [
      { index: 0, fullPath: 'OPS/one.xhtml' },
      { index: 1, fullPath: 'OPS/two.xhtml' }
    ],
    zip: { files: entries, file: (filePath) => entries[filePath] || null },
    mediaTypes: {},
    resourceManager,
    diagnostics: { skippedResources: [], skippedResourceCount: 0, inlinedResourceBytes: 0 }
  };

  assert.equal(await api.renderEpubChapter(0), true);
  assert.equal(await api.renderEpubChapter(1), true);
  assert.deepEqual(released, ['lease-1']);
  assert.equal(api.state.epubArchive.activeChapterLease, leases[1]);

  api.destroyEpub();
  assert.deepEqual(released, ['lease-1', 'lease-2']);
  assert.equal(managerDestroyed, true);
});

test('scroll EPUB rendering mounts one chapter and loads the next only after navigation', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const spine = Array.from({ length: 4 }, (_, index) => ({
    index,
    fullPath: `OPS/chapter-${index + 1}.xhtml`
  }));
  const reads = [];
  const files = Object.fromEntries(spine.map((chapter, index) => [chapter.fullPath, {
    async: async () => {
      reads.push(index);
      return `<!doctype html><html><body><h1>Chapter ${index + 1}</h1></body></html>`;
    }
  }]));

  api.state.contentType = 'epub';
  api.state.readingMode = 'scroll';
  api.state.effectiveReadingMode = 'scroll';
  api.state.chapterPaths = spine.map((chapter) => chapter.fullPath);
  api.state.epubChapterCount = spine.length;
  api.state.epubChapterIndex = 0;
  api.state.epubArchive = {
    spine,
    zip: { files, file: (filePath) => files[filePath] || null },
    mediaTypes: {},
    resourceBudget: { totalBytes: 0, skippedResources: [], reserve: () => true },
    diagnostics: { skippedResources: [], skippedResourceCount: 0, inlinedResourceBytes: 0 }
  };

  assert.equal(await api.renderEpubChapter(0), true);
  assert.deepEqual(reads, [0]);
  assert.equal(article.querySelectorAll('.epub-chapter').length, 1);
  assert.match(article.textContent, /Chapter 1/);
  assert.doesNotMatch(article.textContent, /Chapter 2|Chapter 3|Chapter 4/);

  assert.equal(await api.navigateToEpubChapter(1), true);
  assert.deepEqual(reads, [0, 1]);
  assert.equal(article.querySelectorAll('.epub-chapter').length, 1);
  assert.match(article.textContent, /Chapter 2/);
  assert.doesNotMatch(article.textContent, /Chapter 1|Chapter 3|Chapter 4/);
});

test('scroll EPUB document loading does not retain the whole-book renderer', async () => {
  const epubSource = await fs.readFile(path.resolve(__dirname, '../app/ui/reader/epub.js'), 'utf8');
  assert.doesNotMatch(epubSource, /renderEpubWholeBook/);
  assert.match(epubSource, /await renderEpubChapter\(0\)/);
});

test('EPUB progress uses the archive chapter index for a single mounted chapter', async () => {
  const { window, api } = await createReaderDom();
  mountDuplicateTextChapter(window);
  api.state.contentType = 'epub';
  api.state.epubArchive = {};
  api.state.epubChapterCount = 3;
  api.state.epubChapterIndex = 1;

  api.updateReadingProgress();

  assert.equal(api.state.currentChapterIndex, 1);
  assert.match(window.document.getElementById('readingProgress').textContent, /2\/3/);
});

test('scroll EPUB locators preserve chapter-local and full-book progress', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  chapter.dataset.sourcePath = 'OPS/chapter-2.xhtml';
  const reader = window.document.getElementById('reader');
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 200 });
  reader.scrollTop = 50;

  api.state.contentType = 'epub';
  api.state.effectiveReadingMode = 'scroll';
  api.state.epubArchive = {};
  api.state.epubChapterCount = 4;
  api.state.epubChapterIndex = 1;

  const locator = api.currentReadingLocator(reader);
  assert.equal(locator.readingScope, 'chapter');
  assert.equal(locator.chapterPercentage, 0.5);
  assert.equal(locator.percentage, 0.375);
  assert.equal(locator.href, 'OPS/chapter-2.xhtml');
});

test('PDF progress writes a bounded page locator and rejects a stale document generation', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'a'.repeat(64);
  const generation = 12;
  api.state.currentBookId = bookId;
  api.state.currentPath = 'library/private.pdf';
  api.state.contentType = 'pdf';
  const controller = api.pdfApi.pdfReaderController;
  controller.getCurrentBookId = () => bookId;
  controller.getGeneration = () => generation;
  const requests = [];
  window.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({}) };
  };

  api.savePdfProgress({ bookId, pageIndex: 4, generation });
  await api.flushPdfProgressSave({ keepalive: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, new RegExp(`/books/${bookId}/progress$`));
  assert.equal(requests[0].options.keepalive, true);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    locator: JSON.stringify({ version: 1, type: 'pdf', pageIndex: 4 }),
    percentage: null
  });

  api.savePdfProgress({ bookId, pageIndex: 5, generation });
  controller.getGeneration = () => generation + 1;
  await api.flushPdfProgressSave();
  assert.equal(requests.length, 1, 'a pending write from a replaced PDF document is discarded');
});

test('generic text progress never overwrites PDF page progress during scroll or pagehide', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'b'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.currentPath = 'library/private.pdf';
  api.state.contentType = 'pdf';
  api.state.mode = 'read';
  const requests = [];
  window.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({}) };
  };

  api.saveTextScroll();
  await api.saveTextScroll.flush();

  assert.deepEqual(requests, []);
});

test('AI chapter request position follows the visible EPUB anchor without sending page text', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  chapter.dataset.sourcePath = 'OPS/shared.xhtml';
  const heading = window.document.createElement('h1');
  heading.id = 'visible-chapter-two';
  heading.textContent = '第二章';
  chapter.appendChild(heading);
  const reader = window.document.getElementById('reader');
  reader.getBoundingClientRect = () => ({ top: 0, bottom: 800, left: 0, right: 1200 });
  heading.getBoundingClientRect = () => ({ top: 20, bottom: 50, left: 20, right: 500 });
  api.state.contentType = 'epub';
  api.state.effectiveReadingMode = 'paged';
  api.state.pageCount = 4;
  api.state.pageNumber = 2;
  api.state.epubChapterIndex = 0;
  api.state.chapterPaths = ['OPS/shared.xhtml'];

  const chapterContext = api.aiApi.currentAiChapter();

  assert.equal(chapterContext.index, 0);
  assert.equal(chapterContext.href, 'OPS/shared.xhtml');
  assert.equal(chapterContext.position.href, 'OPS/shared.xhtml');
  assert.equal(chapterContext.position.anchor, 'visible-chapter-two');
  assert.equal(Object.hasOwn(chapterContext.position, 'textBefore'), false);
});

test('legacy EPUB locators restore a valid chapter anchor before whole-book scroll values', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  chapter.dataset.sourcePath = 'OPS/chapter-2.xhtml';
  const anchor = window.document.createElement('p');
  anchor.id = 'saved-target';
  anchor.textContent = 'saved target';
  chapter.appendChild(anchor);
  const reader = window.document.getElementById('reader');
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(reader, 'scrollHeight', { configurable: true, value: 1000 });

  api.state.contentType = 'epub';
  api.state.effectiveReadingMode = 'scroll';
  api.state.epubArchive = {};
  api.state.epubChapterCount = 3;
  api.state.epubChapterIndex = 1;

  assert.equal(api.restoreReadingLocator({
    href: 'OPS/chapter-2.xhtml',
    anchor: 'saved-target',
    percentage: 0.9,
    scrollTop: 810
  }), true);
  assert.equal(anchor.dataset.scrolledIntoView, 'true');
  assert.equal(reader.scrollTop, 0);

  assert.equal(api.restoreReadingLocator({
    href: 'OPS/chapter-2.xhtml',
    readingScope: 'chapter',
    chapterPercentage: 0.4,
    percentage: 0.9
  }), true);
  assert.equal(reader.scrollTop, 360);
});

test('EPUB restoration loads the saved archive chapter before applying its locator', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  chapter.dataset.sourcePath = 'OPS/chapter-1.xhtml';
  const files = {
    'OPS/chapter-2.xhtml': { async: async () => '<body><p id="saved-target">restored chapter</p></body>' }
  };
  const bookId = 'restore-window';

  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.state.epubArchive = {
    spine: [
      { index: 0, fullPath: 'OPS/chapter-1.xhtml' },
      { index: 1, fullPath: 'OPS/chapter-2.xhtml' }
    ],
    chapterIndexByPath: { 'OPS/chapter-1.xhtml': 0, 'OPS/chapter-2.xhtml': 1 },
    zip: { files, file: (filePath) => files[filePath] || null },
    mediaTypes: {},
    resourceBudget: { totalBytes: 0, skippedResources: [], reserve: () => true },
    diagnostics: { inlinedResourceBytes: 0, skippedResourceCount: 0, skippedResources: [] }
  };
  api.state.epubChapterCount = 2;
  api.state.epubChapterIndex = 0;
  api.state.userState.books[bookId] = {
    progress: { locator: JSON.stringify({ href: 'OPS/chapter-2.xhtml', anchor: 'saved-target', pageNumber: 1 }) }
  };

  api.restoreTextScroll();
  await waitFor(() => api.state.epubChapterIndex === 1, 'saved chapter was not loaded');

  assert.equal(window.document.getElementById('article').textContent, 'restored chapter');
  assert.equal(window.document.querySelectorAll('#article .epub-chapter').length, 1);
});

test('EPUB saved page restoration runs after pagination settles', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');
  article.innerHTML = '<section class="epub-chapter">long chapter</section>';
  article.scrollTo = ({ left, top = 0 }) => {
    article.scrollLeft = left;
    article.scrollTop = top;
  };
  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(article, 'scrollWidth', { configurable: true, value: 5000 });

  api.state.contentType = 'epub';
  api.state.readingMode = 'double';
  api.state.pageMargin = 40;
  api.state.epubRenderPending = true;
  api.measurePagination({
    preserveLocator: false,
    allowEpubPending: true,
    onSettled: () => api.restoreReadingLocator({ pageNumber: 3 })
  });

  assert.equal(api.state.pageNumber, 3);
  assert.equal(api.state.pageGroup, 1);
});

test('cross-chapter EPUB fragments navigate after target pagination settles', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const reader = window.document.getElementById('reader');
  const animationFrames = [];
  let chapterReads = 0;
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.id === 'article') return { left: 0, right: 1200, top: 0, bottom: 800, width: 1200, height: 800 };
    if (this.id === 'destination') return { left: 3000, right: 3100, top: 40, bottom: 80, width: 100, height: 40 };
    return originalRect.call(this);
  };
  article.innerHTML = '<section class="epub-chapter" data-source-path="OPS/chapter-1.xhtml">first chapter</section>';
  article.scrollTo = ({ left, top = 0 }) => {
    article.scrollLeft = left;
    article.scrollTop = top;
  };
  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(article, 'scrollWidth', { configurable: true, value: 5000 });

  api.state.contentType = 'epub';
  api.state.readingMode = 'double';
  api.state.pageMargin = 40;
  api.state.epubChapterIndex = 0;
  api.state.epubChapterCount = 2;
  api.state.epubArchive = {
    spine: [
      { index: 0, fullPath: 'OPS/chapter-1.xhtml' },
      { index: 1, fullPath: 'OPS/chapter-2.xhtml' }
    ],
    chapterIndexByPath: { 'OPS/chapter-1.xhtml': 0, 'OPS/chapter-2.xhtml': 1 },
    zip: {
      file: (filePath) => filePath === 'OPS/chapter-2.xhtml'
        ? { async: async () => { chapterReads += 1; return '<body><p id="destination">destination chapter</p></body>'; } }
        : null
    },
    mediaTypes: {},
    resourceBudget: { totalBytes: 0, skippedResources: [], reserve: () => true },
    diagnostics: { inlinedResourceBytes: 0, skippedResourceCount: 0, skippedResources: [] }
  };

  const navigation = api.navigateEpubTarget('epub-path:OPS/chapter-2.xhtml#destination');
  const flushNextFrame = async (description) => {
    await waitFor(() => animationFrames.length > 0, description);
    animationFrames.shift()(Date.now());
  };
  // The archive loader yields twice, then the renderer waits for its mount frame.
  await flushNextFrame('first chapter-load frame was not requested');
  await flushNextFrame('second chapter-load frame was not requested');
  await flushNextFrame('chapter mount frame was not requested');
  await waitFor(() => animationFrames.length > 0, 'pagination settlement frame was not requested');
  assert.equal(api.isEpubChapterLoading(), true);
  assert.equal(window.document.getElementById('btnNextPage').disabled, true);

  // Do not let the target move until pagination has established its final page count.
  animationFrames.shift()(Date.now());
  assert.equal(await navigation, true);
  assert.equal(api.state.epubChapterIndex, 1);
  assert.ok(api.state.pageGroup > 0, 'fragment target should win over default page 1');
  assert.ok(api.state.pageNumber > 1, 'fragment target should not remain on page 1');
  assert.equal(chapterReads, 1, 'fragment validation must reuse the loaded chapter');
  assert.equal(api.isEpubChapterLoading(), false);
});

test('an invalid cross-chapter EPUB fragment keeps the current chapter and page visible', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const fileName = window.document.getElementById('fileName');
  article.innerHTML = '<section class="epub-chapter" data-source-path="OPS/chapter-1.xhtml"><a href="#" data-epub-href="chapter-2.xhtml#missing">broken link</a></section>';
  const sourceChapter = article.firstElementChild;
  article.scrollLeft = 1200;
  api.state.contentType = 'epub';
  api.state.readingMode = 'double';
  api.state.effectiveReadingMode = 'double';
  api.state.epubChapterIndex = 0;
  api.state.epubChapterCount = 2;
  api.state.pageNumber = 3;
  api.state.pageGroup = 1;
  api.state.pageCount = 6;
  api.state.pageGroupCount = 3;
  api.state.epubArchive = {
    spine: [
      { index: 0, fullPath: 'OPS/chapter-1.xhtml' },
      { index: 1, fullPath: 'OPS/chapter-2.xhtml' }
    ],
    chapterIndexByPath: { 'OPS/chapter-1.xhtml': 0, 'OPS/chapter-2.xhtml': 1 },
    zip: {
      file: (filePath) => filePath === 'OPS/chapter-2.xhtml'
        ? { async: async () => '<body><p id="actual">destination chapter</p></body>' }
        : null
    },
    mediaTypes: {},
    resourceBudget: { totalBytes: 0, skippedResources: [], reserve: () => true },
    diagnostics: { inlinedResourceBytes: 0, skippedResourceCount: 0, skippedResources: [] }
  };
  api.setupTocNavigation();

  article.querySelector('a').click();
  await waitFor(
    () => window.document.getElementById('readerFeedback')?.textContent.includes('无法跳转：chapter-2.xhtml#missing（来源：OPS/chapter-1.xhtml）'),
    'invalid EPUB fragment did not show the existing navigation failure'
  );

  assert.equal(api.state.epubChapterIndex, 0);
  assert.equal(api.state.pageNumber, 3);
  assert.equal(api.state.pageGroup, 1);
  assert.equal(article.querySelector('.epub-chapter').dataset.sourcePath, 'OPS/chapter-1.xhtml');
  assert.equal(article.textContent, 'broken link');
  assert.equal(article.firstElementChild, sourceChapter);
  assert.equal(article.scrollLeft, 1200);
  assert.equal(api.isEpubChapterLoading(), false);
});

test('superseded and stale pagination settlement cannot mutate current page state', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const reader = window.document.getElementById('reader');
  const frames = [];
  window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(article, 'scrollWidth', { configurable: true, value: 5000 });
  api.state.readingMode = 'double';
  let staleCallbacks = 0;
  const previous = api.measurePagination({ preserveLocator: false, onSettled: () => { staleCallbacks += 1; } });
  const previousFrame = frames.shift();
  const current = api.measurePagination({ preserveLocator: false });
  const currentFrame = frames.shift();
  assert.equal(await previous, false, 'a newer measurement must cancel the previous completion');
  currentFrame();
  assert.equal(await current, true);
  api.setPageGroup(1);
  const page = api.state.pageNumber;
  const offset = article.scrollLeft;
  Object.defineProperty(article, 'scrollWidth', { configurable: true, value: 100 });
  previousFrame();
  assert.equal(api.state.pageNumber, page);
  assert.equal(article.scrollLeft, offset);
  assert.equal(staleCallbacks, 0);

  frames.length = 0;
  let isCurrent = true;
  const stale = api.measurePagination({ preserveLocator: false, isCurrent: () => isCurrent });
  const staleFrame = frames.shift();
  isCurrent = false;
  api.state.pageCount = 20;
  api.state.pageGroupCount = 10;
  staleFrame();
  assert.equal(await stale, false, 'a stale chapter must cancel its measurement');
  assert.equal(api.state.pageCount, 20);
  assert.equal(api.state.pageGroupCount, 10);
});

test('DOM Range restoration uses chapter context to distinguish identical text', async () => {
  const { window, api } = await createReaderDom();
  const chapter = mountDuplicateTextChapter(window);
  const locator = {
    chapterHref: 'OPS/chapter.xhtml',
    startPath: [99],
    endPath: [99],
    startOffset: 0,
    endOffset: 6,
    startTextOffset: 999,
    endTextOffset: 1005,
    contextBefore: 'alpha repeat middle ',
    contextAfter: ' omega'
  };

  const range = api.rangeFromHighlight({
    id: 'second-repeat',
    chapterHref: 'OPS/chapter.xhtml',
    text: 'repeat',
    contextBefore: locator.contextBefore,
    contextAfter: locator.contextAfter,
    domRange: locator
  });

  assert.ok(range);
  assert.equal(range.toString(), 'repeat');
  assert.equal(range.startContainer, chapter.firstChild);
  assert.equal(range.startOffset, 'alpha repeat middle '.length);

  const ambiguous = api.rangeFromHighlight({
    id: 'ambiguous-repeat',
    chapterHref: 'OPS/chapter.xhtml',
    text: 'repeat',
    domRange: { ...locator, contextBefore: '', contextAfter: '' }
  });
  assert.equal(ambiguous, null);
});

test('annotation styles have a backwards-compatible normalizer and rendering hook', async () => {
  const highlightsSource = await fs.readFile(
    path.resolve(__dirname, '../app/ui/reader/highlights.js'),
    'utf8'
  );

  assert.match(highlightsSource, /function normalizeAnnotation\(/);
  assert.match(highlightsSource, /data-annotation-style/);
});

test('notes panel contract exposes whole-book filters and safe list rendering', async () => {
  const notesSource = await fs.readFile(
    path.resolve(__dirname, '../app/ui/reader/notes-panel.js'),
    'utf8'
  );
  assert.match(notesSource, /function renderNotesPanel\(/);
  assert.match(notesSource, /data-notes-filter/);
  assert.match(notesSource, /textContent/);
});

test('selection session opens a bounded seven-action menu and rejects outside selections', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const chapter = window.document.createElement('section');
  chapter.className = 'epub-chapter';
  chapter.dataset.sourcePath = 'OPS/chapter.xhtml';
  const textNode = window.document.createTextNode('select this phrase');
  chapter.appendChild(textNode);
  article.appendChild(chapter);

  const range = window.document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 17);
  range.getBoundingClientRect = () => ({ left: 300, top: 240, bottom: 264, width: 120, height: 24 });
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  api.setupSelectionMenu();
  assert.ok(api.captureSelectionSession(selection));
  assert.equal(api.showSelectionMenuForCurrentSelection(), true);
  const menu = window.document.getElementById('selectionMenu');
  assert.ok(menu);
  assert.equal(menu.hidden, false);
  // Seven desktop actions plus the phone's one-tap “划线”.
  assert.equal(menu.querySelectorAll('[data-selection-action]').length, 8);
  assert.ok(menu.querySelector('[data-selection-action="highlight"]'));
  assert.ok(menu.querySelector('[data-selection-action="search"]'), 'selection can be searched in the book');
  assert.ok(Number.parseFloat(menu.style.left) >= 8);
  assert.ok(Number.parseFloat(menu.style.top) >= 8);

  const outside = window.document.createRange();
  const outsideText = window.document.createTextNode('outside');
  window.document.body.appendChild(outsideText);
  outside.selectNodeContents(outsideText);
  selection.removeAllRanges();
  selection.addRange(outside);
  assert.equal(api.captureSelectionSession(selection), null);
  api.closeSelectionMenu({ clearSelection: false });
});

test('PDF selection menu explains why cross-page or oversized selections cannot use selected-text AI', async () => {
  const { window, api } = await createReaderDom();
  api.setupSelectionMenu();
  const base = { format: 'pdf', text: '选中文本', anchor: { left: 160, top: 120, bottom: 140 } };
  const crossPage = {
    ...base,
    targets: [{ pageIndex: 0, quads: [[]] }, { pageIndex: 1, quads: [[]] }]
  };

  assert.equal(api.openSelectionMenu(crossPage), true);
  const menu = window.document.getElementById('selectionMenu');
  const aiAction = menu.querySelector('[data-selection-action="ai"]');
  const hint = menu.querySelector('.selection-menu-hint');
  assert.equal(aiAction.hidden, true);
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /跨页/);
  assert.match(hint.textContent, /全书提问/);

  api.openSelectionMenu({ ...base, text: '长文本'.repeat(500), targets: [{ pageIndex: 0, quads: [[]] }] });
  assert.equal(aiAction.hidden, true);
  assert.match(hint.textContent, /1200 字/);

  api.openSelectionMenu({ ...base, targets: [{ pageIndex: 0, quads: [[]] }] });
  assert.equal(aiAction.hidden, false);
  assert.equal(hint.hidden, true);
  api.openSelectionMenu({ ...base, format: 'epub', targets: [] });
  assert.equal(aiAction.hidden, false);
  assert.equal(hint.hidden, true, 'EPUB selection actions keep their existing behavior');
});

test('Escape from a PDF selection menu restores focus to the PDF reading surface', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.setupSelectionMenu();
  api.state.contentType = 'pdf';
  document.getElementById('pdfReaderSurface').hidden = false;
  api.openSelectionMenu({
    format: 'pdf', text: '依据', targets: [{ pageIndex: 0, quads: [[]] }],
    anchor: { left: 160, top: 120, bottom: 140 }
  });
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.equal(document.getElementById('selectionMenu').hidden, true);
  assert.equal(document.activeElement, document.getElementById('pdfPages'));
});

test('oversized PDF text selection explains how to recover instead of silently closing the menu', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.contentType = 'pdf';
  api.state.currentBookId = 'a'.repeat(64);
  const page = document.createElement('div');
  page.className = 'pdf-page';
  page.dataset.pageIndex = '0';
  const textLayer = document.createElement('div');
  textLayer.className = 'pdf-page-text-layer';
  const text = document.createTextNode('x'.repeat(4001));
  textLayer.appendChild(text);
  page.appendChild(textLayer);
  document.getElementById('pdfPages').appendChild(page);
  window.pdfReaderController = { getRenderedPageGeometry: () => null };
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  assert.equal(api.showSelectionMenuForCurrentSelection(), false);
  assert.match(document.getElementById('readerFeedback').textContent, /超过 4000 字/);
  assert.match(document.getElementById('readerFeedback').textContent, /缩小选区/);
});

test('EPUB TOC parsing preserves nested navigation depth for markdown export', async () => {
  const { api } = await createReaderDom();
  const nav = `
    <nav epub:type="toc"><ol>
      <li><a href="chapter-1.xhtml">第一章</a><ol>
        <li><a href="chapter-1-1.xhtml">第一节</a><ol>
          <li><a href="chapter-1-1-1.xhtml">第一小节</a></li>
        </ol></li>
      </ol></li>
    </ol></nav>`;

  assert.deepEqual(JSON.parse(JSON.stringify(api.parseNavToc(nav, 'OPS/nav.xhtml'))), [
    { label: '第一章', target: 'epub-path:OPS/chapter-1.xhtml#', depth: 0 },
    { label: '第一节', target: 'epub-path:OPS/chapter-1-1.xhtml#', depth: 1 },
    { label: '第一小节', target: 'epub-path:OPS/chapter-1-1-1.xhtml#', depth: 2 }
  ]);

  const ncx = `
    <navMap><navPoint><navLabel><text>第一章</text></navLabel>
      <content src="chapter-1.xhtml"/><navPoint><navLabel><text>第一节</text></navLabel>
        <content src="chapter-1-1.xhtml"/></navPoint>
    </navPoint></navMap>`;
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseNcxToc(ncx, 'OPS/toc.ncx'))), [
    { label: '第一章', target: 'epub-path:OPS/chapter-1.xhtml#', depth: 0 },
    { label: '第一节', target: 'epub-path:OPS/chapter-1-1.xhtml#', depth: 1 }
  ]);
});

test('markdown export groups annotations by chapter depth and quotes only marked text with thoughts', async () => {
  const { api } = await createReaderDom();
  api.state.currentName = '样书.epub';
  api.state.contentType = 'epub';
  api.state.epubMetadata = { creator: '测试作者' };
  api.state.toc = [
    { label: '第一章', target: 'epub-path:OPS/chapter-1.xhtml#', depth: 0 },
    { label: '第一章·小节', target: 'epub-path:OPS/chapter-1-1.xhtml#', depth: 1 },
    { label: '第二章', target: 'epub-path:OPS/chapter-2.xhtml#', depth: 0 }
  ];

  const markdown = api.formatHighlightsMd([
    {
      chapterHref: 'OPS/chapter-1.xhtml',
      date: '2026-09-20',
      text: '没有想法的标记',
      thought: ''
    },
    {
      chapterHref: 'OPS/chapter-1-1.xhtml',
      date: '2026-09-21',
      text: '有想法的标记',
      thought: '这是普通段落形式的想法。'
    },
    {
      chapterHref: 'OPS/chapter-2.xhtml',
      text: '第二章标记',
      note: ''
    }
  ]);

  assert.equal(markdown, [
    '# 《样书》标记与想法',
    '',
    '作者：测试作者',
    '',
    '---',
    '',
    '## 第一章',
    '',
    '- [2026-09-20] 没有想法的标记',
    '',
    '### 第一章·小节',
    '',
    '> [2026-09-21] 有想法的标记',
    '',
    '想法：这是普通段落形式的想法。',
    '',
    '## 第二章',
    '',
    '- 第二章标记',
    '',
    ''
  ].join('\n'));
});

test('PDF export fetches the current book instead of cached notes and downloads one Markdown file', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'a'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.currentName = '示例.pdf';
  api.state.contentType = 'pdf';
  api.state.userState.books[bookId] = { pdfAnnotations: [{ id: 'stale-cache', text: '缓存旧内容' }] };
  let requestedUrl = '';
  window.fetch = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ annotations: [{
      type: 'pdf', id: 'fresh', text: '实时笔记', thought: '我的想法',
      targets: [{ pageIndex: 2, quads: [] }]
    }] }) };
  };
  let blob;
  let filename;
  window.URL.createObjectURL = (value) => { blob = value; return 'blob:notes'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() { filename = this.download; };
  await api.exportHighlights();
  assert.equal(requestedUrl, `/app/zhenshu/api/books/${bookId}/pdf-annotations`);
  assert.equal(filename, '示例.md');
  const markdown = await blob.text();
  assert.match(markdown, /第 3 页/);
  assert.match(markdown, /实时笔记/);
  assert.doesNotMatch(markdown, /缓存旧内容/);
});

test('PDF export fails closed when the book changes or its API request fails', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'b'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.currentName = '示例.pdf';
  api.state.contentType = 'pdf';
  let finishRequest;
  window.fetch = () => new Promise((resolve) => { finishRequest = resolve; });
  let downloads = 0;
  window.HTMLAnchorElement.prototype.click = function click() { downloads += 1; };
  const pending = api.exportHighlights();
  api.state.currentBookId = 'c'.repeat(64);
  finishRequest({ ok: true, json: async () => ({ annotations: [{
    type: 'pdf', id: 'late', text: '另一书', targets: [{ pageIndex: 0, quads: [] }]
  }] }) });
  await pending;
  assert.equal(downloads, 0);
  assert.match(window.document.getElementById('readerFeedback').textContent, /已取消上一书的笔记导出/);

  api.state.currentBookId = bookId;
  api.state.userState.books[bookId] = { pdfAnnotations: [{
    type: 'pdf', id: 'cached', text: '不允许降级', targets: [{ pageIndex: 0, quads: [] }]
  }] };
  window.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: '无权访问' }) });
  await api.exportHighlights();
  assert.equal(downloads, 0);
});

test('a pending export for the old PDF does not block the new book export or download late data', async () => {
  const { window, api } = await createReaderDom();
  const oldBook = '1'.repeat(64);
  const newBook = '2'.repeat(64);
  api.state.currentBookId = oldBook;
  api.state.currentName = '旧书.pdf';
  api.state.contentType = 'pdf';
  api.updateTopbarState();
  let finishOld;
  window.fetch = async (url) => {
    if (url.includes(oldBook)) return new Promise((resolve) => { finishOld = resolve; });
    return { ok: true, json: async () => ({ annotations: [{
      type: 'pdf', id: 'new', text: '新书内容', targets: [{ pageIndex: 0, quads: [] }]
    }] }) };
  };
  const downloads = [];
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() { downloads.push(this.download); };
  const oldExport = api.exportHighlights();
  api.state.currentBookId = newBook;
  api.state.currentName = '新书.pdf';
  api.updateTopbarState();
  assert.equal(window.document.getElementById('btnExportHighlights').disabled, false);
  await api.exportHighlights();
  assert.deepEqual(downloads, ['新书.md']);
  finishOld({ ok: true, json: async () => ({ annotations: [{
    type: 'pdf', id: 'old', text: '旧书内容', targets: [{ pageIndex: 0, quads: [] }]
  }] }) });
  await oldExport;
  assert.deepEqual(downloads, ['新书.md']);
});

test('PDF export button and shortcut are available without changing EPUB shortcut behavior', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'd'.repeat(64);
  api.state.contentType = 'pdf';
  api.updateTopbarState();
  assert.equal(window.document.getElementById('btnExportHighlights').hidden, false);
  const event = { key: 'E', ctrlKey: true, metaKey: true, shiftKey: true, preventDefault() { this.prevented = true; } };
  assert.equal(api.handleKeyboardShortcut(event), true);
  assert.equal(event.prevented, true);
  api.state.contentType = 'epub';
  api.updateTopbarState();
  assert.equal(window.document.getElementById('btnExportHighlights').hidden, false);
});

test('PDF export shortcut does not intercept text fields', async () => {
  const { window, api } = await createReaderDom();
  api.state.currentBookId = 'e'.repeat(64);
  api.state.contentType = 'pdf';
  const input = window.document.createElement('input');
  const event = {
    key: 'e', ctrlKey: true, metaKey: true, shiftKey: true, target: input,
    preventDefault() { this.prevented = true; }
  };
  assert.equal(api.handleKeyboardShortcut(event), false);
  assert.equal(event.prevented, undefined);
});

test('deleting one identical-text highlight removes only its stable ID and persists immediately', async () => {
  const { window, api } = await createReaderDom();
  mountDuplicateTextChapter(window);
  const bookId = 'a'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.currentPath = 'sample.epub';
  api.state.currentName = 'sample.epub';
  api.state.contentType = 'epub';
  api.state.userState.books[bookId] = {
    highlights: [
      {
        id: 'first-repeat',
        locator: 'locator-1',
        chapterHref: 'OPS/chapter.xhtml',
        text: 'repeat',
        contextBefore: 'alpha ',
        contextAfter: ' middle',
        color: 'yellow',
        note: ''
      },
      {
        id: 'second-repeat',
        locator: 'locator-2',
        chapterHref: 'OPS/chapter.xhtml',
        text: 'repeat',
        contextBefore: 'alpha repeat middle ',
        contextAfter: ' omega',
        color: 'blue',
        note: 'keep location-specific metadata'
      }
    ]
  };

  let persisted = null;
  window.browserHost.saveHighlights = async (highlights, savedBookId) => {
    persisted = { highlights, bookId: savedBookId };
  };

  assert.equal(api.openHighlightEditor('second-repeat'), true);
  await api.deleteActiveHighlight();

  const remaining = api.loadHighlights();
  assert.deepEqual(remaining.map((item) => item.id), ['first-repeat']);
  assert.equal(persisted.bookId, bookId);
  assert.deepEqual(persisted.highlights.map((item) => item.id), ['first-repeat']);
});

test('highlight color and thought edits retain locator metadata during server persistence', async () => {
  const { window, api } = await createReaderDom();
  mountDuplicateTextChapter(window);
  const bookId = 'b'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.currentPath = 'notes.epub';
  api.state.currentName = 'notes.epub';
  api.state.contentType = 'epub';
  api.state.userState.books[bookId] = {
    highlights: [{
      id: 'edit-me',
      locator: 'locator-edit',
      chapterHref: 'OPS/chapter.xhtml',
      text: 'repeat',
      contextBefore: 'alpha ',
      contextAfter: ' middle',
      color: 'yellow',
      note: ''
    }]
  };

  let persisted = null;
  window.browserHost.saveHighlights = async (highlights) => {
    persisted = highlights;
  };

  assert.equal(api.openHighlightEditor('edit-me'), true);
  window.document.getElementById('highlightEditorColor').value = 'pink';
  window.document.getElementById('highlightEditorThought').value = '精确想法';
  await api.saveActiveHighlightEdits();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, 'edit-me');
  assert.equal(persisted[0].locator, 'locator-edit');
  assert.equal(persisted[0].chapterHref, 'OPS/chapter.xhtml');
  assert.equal(persisted[0].contextBefore, 'alpha ');
  assert.equal(persisted[0].contextAfter, ' middle');
  assert.equal(persisted[0].color, 'pink');
  assert.equal(persisted[0].thought, '精确想法');
  assert.equal(persisted[0].note, '精确想法');
});

test('reader typography settings share CSS variables and generated EPUB styles', async () => {
  const { window, api } = await createReaderDom();
  api.state.lineHeight = 2.3;
  api.state.pageMargin = 68;
  api.state.highlightColor = 'green';
  api.applyZoom();

  const rootStyle = window.document.documentElement.style;
  assert.equal(rootStyle.getPropertyValue('--reader-line-height'), '2.3');
  assert.equal(rootStyle.getPropertyValue('--reader-page-margin'), '68px');
  assert.equal(window.document.body.dataset.highlightColor, 'green');
  assert.match(api.getEpubThemeCss(), /line-height: 2\.3 !important/);

  const settings = api.currentUserSettings();
  assert.equal(settings.lineHeight, 2.3);
  assert.equal(settings.pageMargin, 68);
  assert.equal(settings.highlightColor, 'green');
});

test('chapter navigation does not scroll past first or last chapter', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  const reader = window.document.getElementById('reader');
  article.innerHTML = '';
  reader.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });

  const chapters = [0, 1, 2].map((index) => {
    const chapter = window.document.createElement('section');
    chapter.className = 'epub-chapter';
    chapter.dataset.sourcePath = `OPS/${index}.xhtml`;
    chapter.textContent = `chapter ${index}`;
    chapter.getBoundingClientRect = () => ({ top: index * 100, bottom: index * 100 + 80, left: 0, right: 800, width: 800, height: 80 });
    article.appendChild(chapter);
    return chapter;
  });

  api.state.contentType = 'epub';
  api.state.chapterPaths = chapters.map((chapter) => chapter.dataset.sourcePath);
  api.state.currentChapterIndex = 0;

  assert.equal(api.navigateChapter(-1), false);
  assert.equal(chapters[0].dataset.scrolledIntoView, undefined);
  assert.equal(api.navigateChapter(1), true);
  assert.equal(chapters[1].dataset.scrolledIntoView, 'true');

  chapters.forEach((chapter, index) => {
    chapter.getBoundingClientRect = () => ({ top: (index - 2) * 100, bottom: (index - 2) * 100 + 80, left: 0, right: 800, width: 800, height: 80 });
  });
  api.state.currentChapterIndex = 2;
  delete chapters[2].dataset.scrolledIntoView;
  assert.equal(api.navigateChapter(1), false);
  assert.equal(chapters[2].dataset.scrolledIntoView, undefined);
});

test('pagination groups pages correctly for single and double modes', async () => {
  const { api } = await createReaderDom();

  api.state.effectiveReadingMode = 'single';
  assert.equal(api.pageGroupForPage(1), 0);
  assert.equal(api.pageGroupForPage(2), 1);
  assert.equal(api.pageGroupForPage(5), 4);

  api.state.effectiveReadingMode = 'double';
  assert.equal(api.pageGroupForPage(1), 0);
  assert.equal(api.pageGroupForPage(2), 0);
  assert.equal(api.pageGroupForPage(3), 1);
  assert.equal(api.pageGroupForPage(6), 2);
});

test('double-page mode falls back to single-page mode on narrow readers', async () => {
  const { api } = await createReaderDom();
  api.state.readingMode = 'double';

  assert.equal(api.resolveEffectiveReadingMode(1200), 'double');
  assert.equal(api.resolveEffectiveReadingMode(899), 'single');

  api.state.readingMode = 'scroll';
  assert.equal(api.resolveEffectiveReadingMode(500), 'scroll');
});

test('page navigation stays within pagination boundaries', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');
  article.scrollTo = ({ left }) => {
    article.scrollLeft = left;
  };

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.effectiveReadingMode = 'single';
  api.state.columnWidth = 400;
  api.state.columnGap = 0;
  api.state.pageGroupWidth = 800;
  api.state.pageGroup = 0;
  api.state.pageGroupCount = 3;
  api.state.pageCount = 3;

  assert.equal(api.navigatePageGroup(-1), false);
  assert.equal(api.navigatePageGroup(1), true);
  assert.equal(api.state.pageGroup, 1);
  assert.equal(api.state.pageNumber, 2);
  assert.equal(article.scrollLeft, 800);
  assert.equal(article.scrollLeft % api.state.pageGroupWidth, 0);

  api.state.pageGroup = 2;
  assert.equal(api.navigatePageGroup(1), false);
});

test('repeated pagination control sync does not rewrite stable page buttons', async () => {
  const { window, api } = await createReaderDom();
  const previous = window.document.getElementById('btnPreviousPage');
  const next = window.document.getElementById('btnNextPage');
  const writes = { previousHidden: 0, previousDisabled: 0, nextHidden: 0, nextDisabled: 0 };

  for (const [button, key] of [[previous, 'previous'], [next, 'next']]) {
    let hidden = button.hidden;
    let disabled = button.disabled;
    Object.defineProperty(button, 'hidden', {
      configurable: true,
      get: () => hidden,
      set: (value) => { writes[`${key}Hidden`] += 1; hidden = Boolean(value); }
    });
    Object.defineProperty(button, 'disabled', {
      configurable: true,
      get: () => disabled,
      set: (value) => { writes[`${key}Disabled`] += 1; disabled = Boolean(value); }
    });
  }

  api.state.contentType = 'epub';
  api.state.effectiveReadingMode = 'double';
  api.state.pageGroup = 1;
  api.state.pageGroupCount = 3;
  api.state.pageCount = 6;

  api.updatePaginationControls();
  const firstSyncWrites = { ...writes };
  api.updatePaginationControls();

  assert.deepEqual(firstSyncWrites, {
    previousHidden: 1,
    previousDisabled: 0,
    nextHidden: 1,
    nextDisabled: 0
  });
  assert.deepEqual(writes, firstSyncWrites, 'a stable page turn must not rewrite either page button');
  assert.equal(previous.hidden, false);
  assert.equal(previous.disabled, false);
  assert.equal(next.hidden, false);
  assert.equal(next.disabled, false);
});

test('pagination snapping skips an already settled page group', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  let scrollLeft = 800;
  let scrollWrites = 0;
  Object.defineProperty(article, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value) => { scrollWrites += 1; scrollLeft = value; }
  });

  api.state.contentType = 'epub';
  api.state.effectiveReadingMode = 'double';
  api.state.pageGroup = 1;
  api.state.pageGroupCount = 3;
  api.state.pageCount = 6;
  api.state.pageGroupWidth = 800;
  api.state.pageOffset = 800;

  assert.equal(api.snapPaginationToNearestGroup({ save: false }), true);
  assert.equal(scrollWrites, 0, 'settled page groups must not be applied a second time');
  assert.equal(scrollLeft, 800);
});

test('page turns keep the existing highlight layer without a full redraw', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.effectiveReadingMode = 'double';
  api.state.pageCount = 6;
  api.state.pageGroupCount = 3;
  api.state.pageGroup = 0;
  api.state.pageNumber = 1;
  api.state.pageGroupWidth = 800;

  const layer = window.document.createElement('div');
  layer.className = 'highlight-layer';
  const marker = window.document.createElement('button');
  marker.className = 'br-highlight-box';
  layer.appendChild(marker);
  article.appendChild(layer);

  assert.equal(api.navigatePageGroup(1), true);
  assert.equal(layer.contains(marker), true, 'paging must not clear and rebuild the highlight layer');
});

test('Reader Shell retains legacy DOM IDs and exposes one responsive Drawer', async () => {
  const { window } = await createReaderDom();
  const document = window.document;
  const requiredIds = [
    'topbar',
    'reader',
    'article',
    'btnBackToLibrary',
    'btnPreviousChapter',
    'btnNextChapter',
    'btnPreviousPage',
    'btnNextPage',
    'btnToc',
    'btnHighlight',
    'btnExportHighlights',
    'btnSettings',
    'settingsPanel',
    'settingTheme',
    'settingFontSize',
    'settingLineHeight',
    'settingPageMargin',
    'settingHighlightColor',
    'settingReadingMode',
    'toc',
    'tocList'
  ];

  for (const id of requiredIds) {
    assert.ok(document.getElementById(id), `missing retained DOM ID: ${id}`);
  }

  // P0: topbar 阅读/编辑 buttons are removed — no mode buttons left anywhere.
  assert.equal(document.getElementById('btnRead'), null);
  assert.equal(document.getElementById('btnEdit'), null);
  assert.equal(document.querySelectorAll('.topbar .mode-btn').length, 0);

  assert.equal(document.querySelectorAll('.reader-floating-toolbar').length, 1);
  assert.equal(document.querySelectorAll('.reader-drawer').length, 1);
  assert.equal(document.getElementById('btnBackToLibrary').dataset.readerAction, 'backToLibrary');
  assert.equal(document.getElementById('btnSettings').dataset.readerAction, 'openSettings');

  const searchControl = document.getElementById('btnSearch');
  assert.ok(searchControl);
  assert.equal(searchControl.disabled, true);
  assert.equal(searchControl.dataset.readerStatus, 'reserved');
  assert.match(searchControl.getAttribute('aria-label'), /打开书籍后可用/);
  assert.equal(searchControl.textContent.trim(), '');

  const bookmarkControl = document.getElementById('btnBookmarks');
  assert.ok(bookmarkControl);
  assert.equal(bookmarkControl.disabled, true);
  assert.equal(bookmarkControl.dataset.readerStatus, undefined);
  assert.doesNotMatch(bookmarkControl.getAttribute('aria-label'), /仅支持 EPUB/);
  assert.match(bookmarkControl.getAttribute('aria-label'), /书签/);
  assert.equal(bookmarkControl.textContent.trim(), '');
  const aiButton = document.getElementById('btnAi');
  assert.ok(aiButton);
  assert.equal(aiButton.disabled, true);
  assert.equal(aiButton.dataset.readerStatus, undefined);
  assert.match(aiButton.getAttribute('aria-label'), /AI 阅读助手/);
  assert.equal(aiButton.textContent.trim(), '');
  // Settings button is icon-only too.
  assert.equal(document.getElementById('btnSettings').textContent.trim(), '');
  assert.equal(document.getElementById('btnNotes').disabled, false);
  assert.equal(document.getElementById('btnNotes').dataset.readerStatus, undefined);

  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  assert.match(css, /body\.is-epub \.reader \.article/);
  assert.match(css, /\.reader-floating-toolbar/);
  assert.match(css, /\.reader-sheet/);
  assert.match(css, /@media \(max-width: 1200px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test('search surface opens, queries the book, and renders safe results', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const searchSheet = document.getElementById('readerSearchSheet');

  assert.ok(searchSheet);
  assert.equal(searchSheet.hidden, true);
  assert.equal(document.getElementById('readerSearchForm').dataset.readerSearchState, 'idle');
  assert.equal(document.getElementById('readerSearchQuery').disabled, false);
  assert.equal(document.getElementById('readerSearchScope'), null);
  assert.equal(document.getElementById('readerSearchSubmit').disabled, false);
  assert.equal(document.getElementById('readerSearchLoading').hidden, true);
  assert.equal(document.getElementById('readerSearchResults').hidden, true);
  assert.equal(document.getElementById('readerSearchError').hidden, true);
  assert.equal(document.getElementById('readerSearchEmpty').hidden, true);

  assert.equal(api.readerSearchContract.endpointTemplate, '/api/books/:bookId/search');
  assert.deepEqual([...api.readerSearchContract.scopes], ['book']);
  assert.equal(api.readerSearchContract.defaultScope, 'book');
  assert.equal(api.readerSearchContract.defaultLimit, 20);
  assert.equal(api.readerSearchContract.maxLimit, 50);
  assert.equal(
    api.buildReaderSearchUrl({
      bookId: 'book/1',
      query: '蛋白质 与 健康',
      scope: 'chapter',
      chapterIndex: 2,
      limit: 100
    }),
    '/api/books/book%2F1/search?q=%E8%9B%8B%E7%99%BD%E8%B4%A8+%E4%B8%8E+%E5%81%A5%E5%BA%B7&scope=book&limit=50'
  );

  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  api.updateTopbarState();
  api.setupReaderActionMapping();
  api.setupReaderSearch();

  let requestedUrl = '';
  window.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        available: true,
        query: '蛋白质',
        scope: 'book',
        truncated: false,
        results: [{
          id: '0:12:3',
          chapterIndex: 0,
          chapterHref: '',
          chapterLabel: '当前书本',
          snippet: '<img src=x>蛋白质相关内容',
          matchText: '蛋白质',
          matchOffset: 12,
          locator: { version: 1, type: 'text-search', chapterIndex: 0, chapterHref: '', offset: 12, text: '蛋白质' }
        }]
      })
    };
  };

  assert.equal(document.getElementById('btnSearch').disabled, false);
  assert.equal(api.readerPanels.search.enabled(), true);
  document.getElementById('btnSearch').click();
  assert.equal(searchSheet.hidden, false);

  const query = document.getElementById('readerSearchQuery');
  query.value = '蛋白质';
  document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(requestedUrl, /\/search\?q=%E8%9B%8B%E7%99%BD%E8%B4%A8/);
  assert.match(requestedUrl, /[?&]scope=book(?:&|$)/);
  assert.doesNotMatch(requestedUrl, /chapterIndex=/);
  assert.equal(document.getElementById('readerSearchResults').hidden, false);
  assert.equal(document.querySelectorAll('#readerSearchResults > li').length, 1);
  assert.match(document.querySelector('#readerSearchResults').textContent, /蛋白质相关内容/);
  assert.equal(document.querySelector('#readerSearchResults img'), null);
  assert.equal(document.getElementById('readerSearchEmpty').hidden, true);
});

test('search loading shows one progress message without the redundant whole-book hint', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  api.updateTopbarState();
  api.setupReaderActionMapping();
  api.setupReaderSearch();

  window.fetch = () => new Promise((resolve) => {
    window.setTimeout(() => resolve({
      ok: true,
      json: async () => ({ available: true, results: [] })
    }), 50);
  });
  document.getElementById('readerSearchQuery').value = '蛋白质';
  document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.querySelector('.reader-search-hint'), null);
  assert.equal(document.querySelectorAll('.reader-search-loading').length, 1);
  assert.equal(document.getElementById('readerSearchLoading').hidden, false);
  assert.equal(document.getElementById('readerSearchStatus').hidden, true);
  await new Promise((resolve) => setTimeout(resolve, 60));
});

test('search surface keeps the newest query when responses finish out of order', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  api.updateTopbarState();
  api.setupReaderActionMapping();
  api.setupReaderSearch();

  const pending = new Map();
  window.fetch = (url) => new Promise((resolve) => {
    const query = new URL(String(url), window.location.origin).searchParams.get('q');
    pending.set(query, resolve);
  });

  const input = document.getElementById('readerSearchQuery');
  const form = document.getElementById('readerSearchForm');
  input.value = '第一次';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  input.value = '第二次';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  pending.get('第二次')({
    ok: true,
    json: async () => ({ available: true, results: [{ id: 'new', chapterLabel: '第二次', snippet: '新结果' }] })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  pending.get('第一次')({
    ok: true,
    json: async () => ({ available: true, results: [{ id: 'old', chapterLabel: '第一次', snippet: '旧结果' }] })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(document.getElementById('readerSearchResults').textContent, /新结果/);
  assert.doesNotMatch(document.getElementById('readerSearchResults').textContent, /旧结果/);
});

test('search API adapter forwards a bounded continuation cursor', async () => {
  const { window } = await createReaderDom();
  let requestedUrl = '';
  window.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => ({ available: true, results: [], hasMore: false, nextCursor: null }) };
  };

  await window.browserHost.searchBook('search-book', {
    query: '蛋白质',
    cursor: 'opaque_cursor-1'
  });

  const params = new URL(requestedUrl, window.location.origin).searchParams;
  assert.equal(params.get('cursor'), 'opaque_cursor-1');
  assert.equal(params.get('limit'), '20');
});

test('search continuation appends stable unique results and blocks concurrent requests', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  api.setupReaderActionMapping();
  api.setupReaderSearch();

  const result = (id) => ({ id, chapterLabel: '当前书本', snippet: `结果 ${id}`, matchText: '内容' });
  let continuationResolve;
  let continuationRequests = 0;
  window.fetch = async (url) => {
    const cursor = new URL(String(url), window.location.origin).searchParams.get('cursor');
    if (!cursor) {
      return { ok: true, json: async () => ({ available: true, results: [result('r1'), result('r2')], hasMore: true, nextCursor: 'cursor-2' }) };
    }
    continuationRequests += 1;
    return new Promise((resolve) => { continuationResolve = resolve; });
  };

  document.getElementById('readerSearchQuery').value = '内容';
  document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const more = document.getElementById('readerSearchMore');
  assert.equal(more.hidden, false);
  more.click();
  more.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(continuationRequests, 1);
  assert.equal(more.disabled, true);
  assert.match(more.textContent, /加载/);
  continuationResolve({
    ok: true,
    json: async () => ({ available: true, results: [result('r2'), result('r3'), result('r4')], hasMore: false, nextCursor: null })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual([...document.querySelectorAll('#readerSearchResults .reader-search-result')]
    .map((button) => button.dataset.searchResultId), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(more.hidden, true);
});

test('failed search continuation keeps results and retries the same cursor', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  api.setupReaderActionMapping();
  api.setupReaderSearch();

  let attempts = 0;
  window.fetch = async (url) => {
    const cursor = new URL(String(url), window.location.origin).searchParams.get('cursor');
    if (!cursor) return {
      ok: true,
      json: async () => ({ available: true, results: [{ id: 'kept', snippet: '已有结果', matchText: '已有' }], hasMore: true, nextCursor: 'retry-cursor' })
    };
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 503, json: async () => ({ error: '续取暂时失败' }) };
    return { ok: true, json: async () => ({ available: true, results: [{ id: 'next', snippet: '后续结果', matchText: '后续' }], hasMore: false, nextCursor: null }) };
  };

  document.getElementById('readerSearchQuery').value = '内容';
  document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.getElementById('readerSearchMore').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.querySelectorAll('#readerSearchResults .reader-search-result').length, 1);
  assert.match(document.getElementById('readerSearchResults').textContent, /已有结果/);
  assert.equal(document.getElementById('readerSearchError').hidden, false);
  assert.match(document.getElementById('readerSearchMore').textContent, /重试/);

  document.getElementById('readerSearchMore').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 2);
  assert.deepEqual([...document.querySelectorAll('#readerSearchResults .reader-search-result')]
    .map((button) => button.dataset.searchResultId), ['kept', 'next']);
  assert.equal(document.getElementById('readerSearchError').hidden, true);
});

test('closing search retains same-book responses while switching books invalidates paging state', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  api.setupReaderActionMapping();
  api.setupReaderSearch();
  api.openReaderPanel('search');

  let resolvePending;
  window.fetch = () => new Promise((resolve) => { resolvePending = resolve; });
  document.getElementById('readerSearchQuery').value = '内容';
  document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  api.closeReaderPanel({ restoreFocus: false });
  resolvePending({
    ok: true,
    json: async () => ({ available: true, results: [{ id: 'stale', snippet: '不可显示', matchText: '内容' }], hasMore: true, nextCursor: 'stale-cursor' })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById('readerSearchSheet').hidden, true);
  assert.equal(document.getElementById('readerSearchResults').textContent.includes('不可显示'), true);

  api.openReaderPanel('search');
  document.getElementById('readerSearchQuery').value = '切书';
  document.getElementById('readerSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  api.state.currentBookId = 'another-book';
  window.readerSearchApi.resetReaderSearch();
  resolvePending({
    ok: true,
    json: async () => ({ available: true, results: [{ id: 'old-book', snippet: '旧书结果', matchText: '旧书' }], hasMore: true, nextCursor: 'old-book-cursor' })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById('readerSearchMore').hidden, true);
  assert.equal(document.querySelectorAll('#readerSearchResults > li').length, 0);
  assert.doesNotMatch(document.getElementById('readerSearchResults').textContent, /旧书结果/);
});

test('search result navigation locates text in the current document safely', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  document.getElementById('article').innerHTML = '<p>这是可定位的蛋白质内容。</p>';
  window.Range.prototype.getClientRects = () => [{ left: 24, top: 60, width: 36, height: 18 }];

  const navigated = await api.navigateToSearchResult({
    chapterIndex: 0,
    matchText: '蛋白质',
    locator: { text: '蛋白质' }
  });

  assert.equal(navigated, true);
  assert.equal(document.querySelector('#article p').classList.contains('reader-search-target'), false);
  assert.equal(document.querySelectorAll('#article .reader-search-hit-rect').length, 1);
  assert.equal(document.querySelector('#article .reader-search-hit-layer')?.getAttribute('aria-hidden'), 'true');
});

test('search navigation uses the locator and local snippet to select a repeated occurrence', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  document.getElementById('article').innerHTML = '<p>第一次蛋白质</p><p>第二次蛋白质</p>';
  window.Range.prototype.getClientRects = () => [{ left: 24, top: 60, width: 36, height: 18 }];

  const navigated = await api.navigateToSearchResult({
    chapterIndex: 0,
    matchText: '蛋白质',
    snippet: '…第二次蛋白质…',
    // Canonical EPUB offsets can drift from DOM offsets around source markup;
    // the bounded local snippet must win over a coincidental numeric offset.
    locator: { text: '蛋白质', offset: 3 }
  });

  const paragraphs = [...document.querySelectorAll('#article p')];
  assert.equal(navigated, true);
  assert.equal(paragraphs[0].classList.contains('reader-search-target'), false);
  assert.equal(paragraphs[1].classList.contains('reader-search-target'), false);
  assert.equal(document.querySelectorAll('#article .reader-search-hit-rect').length, 1);
});

test('search locator offset selects a repeated occurrence when it exactly maps to rendered UTF-16 text', async () => {
  const { window } = await createReaderDom();
  const article = window.document.getElementById('article');
  article.innerHTML = '<p>第一次蛋白质</p><p>第二次蛋白质</p>';

  const target = window.readerSearchApi.findSearchTextRange(article, '蛋白质', { offset: 9 });

  assert.ok(target);
  assert.equal(target.element.textContent, '第二次蛋白质');
});

test('search locator mapping handles whitespace, inline nodes, supplementary characters, and decoded entities', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  document.getElementById('article').innerHTML = '<p>😀 前 foo <em>bar</em></p><p>😀 后 foo&nbsp;bar</p>';

  const rangeResult = window.readerSearchApi.findSearchTextRange(
    document.getElementById('article'),
    'foo bar',
    { offset: 13, snippet: '…😀 后 foo bar…' }
  );

  assert.ok(rangeResult);
  assert.equal(rangeResult.range.toString(), 'foo bar');
  assert.equal(rangeResult.element.closest('p')?.textContent, '😀 后 foo bar');
});

test('PDF-style text-layer spans and line breaks keep repeated search hits on the verified phrase', async () => {
  const { window } = await createReaderDom();
  const layer = window.document.createElement('div');
  layer.className = 'textLayer pdf-page-text-layer';
  layer.innerHTML = '<span>左栏重复关键词</span><br><span>右栏重复关</span><span>键词，跨行</span><span>命中</span>';

  const repeated = window.readerSearchApi.findSearchTextRange(layer, '重复关键词', {
    snippet: '…右栏重复关键词，跨行命中…'
  });
  const splitAcrossRuns = window.readerSearchApi.findSearchTextRange(layer, '跨行命中', {
    snippet: '…关键词，跨行命中…'
  });

  assert.ok(repeated);
  assert.equal(repeated.range.toString(), '重复关键词');
  assert.equal(repeated.range.startContainer.parentElement.textContent, '右栏重复关');
  assert.ok(splitAcrossRuns);
  assert.equal(splitAcrossRuns.range.toString(), '跨行命中');
  assert.equal(splitAcrossRuns.range.endContainer.parentElement.textContent, '命中');
});

test('PDF search hit layers are discarded when their committed page frameId becomes stale', async () => {
  const { window } = await createReaderDom();
  const page = window.document.createElement('section');
  page.className = 'pdf-page';
  page.dataset.pageIndex = '0';
  const stale = window.document.createElement('div');
  stale.className = 'pdf-search-hit-layer';
  stale.dataset.frameId = 'frame-old';
  page.append(stale);
  window.document.getElementById('pdfPages').append(page);

  assert.equal(typeof window.readerSearchApi.onPdfPageFrameCommitted, 'function');
  window.readerSearchApi.onPdfPageFrameCommitted({ pageIndex: 0, pageElement: page, frameId: 'frame-new' });
  assert.equal(page.querySelector('.pdf-search-hit-layer'), null);

  const current = window.document.createElement('div');
  current.className = 'pdf-search-hit-layer';
  current.dataset.frameId = 'frame-new';
  page.append(current);
  window.readerSearchApi.onPdfPageFrameCommitted({ pageIndex: 0, pageElement: page, frameId: 'frame-new' });
  assert.equal(page.querySelector('.pdf-search-hit-layer'), current);
});

test('search navigation does not highlight an unverified first occurrence when locator context is absent', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  document.getElementById('article').innerHTML = '<p>第一次蛋白质</p><p>第二次蛋白质</p>';

  const navigated = await api.navigateToSearchResult({
    chapterIndex: 0,
    matchText: '蛋白质',
    locator: { text: '蛋白质', offset: 500 }
  });

  assert.equal(navigated, false);
  assert.equal(document.querySelector('.reader-search-hit-layer'), null);
});

test('search hit is transient and does not become a saved annotation', async () => {
  const { window, api } = await createReaderDom();
  const article = window.document.getElementById('article');
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  article.innerHTML = '<p>前文蛋白质后文</p>';
  window.Range.prototype.getClientRects = () => [{ left: 24, top: 60, width: 36, height: 18 }];

  assert.equal(await api.navigateToSearchResult({ matchText: '蛋白质', locator: { text: '蛋白质' } }), true);
  assert.equal(article.querySelectorAll('.reader-search-hit-rect').length, 1);
  assert.equal(article.querySelectorAll('.br-highlight-box').length, 0);
  window.readerSearchApi.resetReaderSearch();
  assert.equal(article.querySelector('.reader-search-hit-layer'), null);
  assert.equal(article.querySelector('p')?.textContent, '前文蛋白质后文');

  assert.equal(await api.navigateToSearchResult({ matchText: '蛋白质', locator: { text: '蛋白质' } }), true);
  assert.equal(article.querySelectorAll('.reader-search-hit-rect').length, 1);
  api.state.effectiveReadingMode = 'single';
  assert.equal(api.setPageGroup(0), true);
  assert.equal(article.querySelector('.reader-search-hit-layer'), null, 'manual pagination clears transient feedback');
});

test('semantic search ranges navigate by the hit rectangle in paged and continuous layouts', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  api.state.pageCount = 12;
  api.state.pageGroupCount = 6;
  api.state.pageStepWidth = 100;
  api.state.pageGroupWidth = 200;
  api.state.pageOffset = 0;
  api.state.effectiveReadingMode = 'double';

  const range = {
    startContainer: document.createTextNode('hit'),
    getClientRects: () => [{ left: 650, top: 120 }]
  };
  assert.equal(api.navigateToSemanticTarget(range), true);
  assert.equal(api.state.pageGroup, 3, 'right-hand page hit should navigate to its double-page spread');

  api.state.effectiveReadingMode = 'scroll';
  reader.scrollTop = 0;
  const scrollRange = {
    startContainer: document.createTextNode('hit'),
    getClientRects: () => [{ left: 0, top: 360 }]
  };
  assert.equal(api.navigateToSemanticTarget(scrollRange), true);
  assert.equal(reader.scrollTop, 336, 'continuous mode should align the actual match rather than its paragraph start');
  assert.ok(article);
});

test('search jump feedback paints only Range geometry and never a block outline', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const layerRule = css.match(/\.article \.reader-search-hit-layer\s*\{([^}]*)\}/s)?.[1] || '';
  const rectRule = css.match(/\.article \.reader-search-hit-rect\s*\{([^}]*)\}/s)?.[1] || '';
  assert.match(layerRule, /pointer-events:\s*none/);
  assert.match(rectRule, /background(?:-color)?:/);
  assert.doesNotMatch(rectRule, /outline:/);
});

test('topbar navigation controls use icon-only SVGs without changing actions', async () => {
  const { window } = await createReaderDom();
  const document = window.document;
  const controls = [
    ['btnBackToLibrary', 'backToLibrary', '返回书架'],
    ['btnPreviousChapter', 'previousChapter', '上一章'],
    ['btnPreviousPage', 'previousPage', '上一页'],
    ['btnNextPage', 'nextPage', '下一页'],
    ['btnNextChapter', 'nextChapter', '下一章']
  ];

  for (const [id, action, label] of controls) {
    const control = document.getElementById(id);
    assert.equal(control.dataset.readerAction, action);
    assert.equal(control.getAttribute('aria-label'), label);
    assert.ok(control.querySelector('svg'), `${id} must render an SVG icon`);
    assert.equal(control.textContent.trim(), '', `${id} must remain icon-only`);
  }
});

test('text documents keep the shared return-to-library entry on desktop and phone', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'text';
  api.state.currentBookId = 'a'.repeat(64);
  api.state.currentPath = 'library/notes.md';

  api.updateTopbarState();

  // Phones use the same top-bar back button (shown with the reading chrome).
  assert.equal(window.document.getElementById('btnBackToLibrary').hidden, false);
  assert.equal(window.document.getElementById('btnMobileBackToLibrary'), null);

  api.state.currentPath = '';
  api.updateTopbarState();
  assert.equal(window.document.getElementById('btnBackToLibrary').hidden, true);
});

test('reader drawer separates fixed chrome from the scrollable panel viewport', async () => {
  const { window } = await createReaderDom();
  const document = window.document;
  const drawer = document.getElementById('readerDrawer');
  const header = drawer?.querySelector('.reader-drawer-header');
  const tabs = drawer?.querySelector('.reader-drawer-tabs');
  const viewport = drawer?.querySelector('.reader-drawer-content');

  assert.ok(drawer);
  assert.ok(header);
  assert.ok(tabs);
  assert.ok(viewport);
  assert.equal(header?.parentElement, drawer);
  assert.equal(tabs?.parentElement, drawer);
  assert.equal(viewport?.parentElement, drawer);
  assert.equal(viewport?.querySelector('#readerPanelToc')?.parentElement, viewport);
  assert.equal(viewport?.querySelector('#readerPanelNotes')?.parentElement, viewport);

  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  assert.match(css, /\.reader-sheet\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.reader-drawer-content\s*,[\s\S]*?overflow-y:\s*auto;/);
});

test('mobile continuous-scroll controls use flow chapter boundaries and a compact shared-action HUD', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const toolbar = document.getElementById('mobileReaderToolbar');

  // No floating ⋯ toggle: tapping the page shows the chrome. Row 1 moves
  // through the book, row 2 holds the five reading entries.
  assert.equal(document.getElementById('mobileReaderChromeToggle'), null);
  assert.deepEqual(
    [...toolbar.querySelectorAll('.mobile-reader-progress button')].map((button) => button.dataset.readerAction),
    ['previousChapter', 'nextChapter']
  );
  assert.equal(toolbar.querySelector('.mobile-reader-progress input[type="range"]')?.id, 'mobileReaderProgress');
  assert.deepEqual(
    [...toolbar.querySelectorAll('.mobile-reader-actions button')].map((button) => button.dataset.readerAction),
    ['openToc', 'openNotes', 'openAi', 'toggleTheme', 'openSettings']
  );
  assert.deepEqual(
    [...document.querySelectorAll('.topbar-right .mobile-topbar-action')].map((button) => button.id),
    ['btnMobileTopSearch', 'btnMobileTopBookmark', 'btnMobileMore']
  );
  assert.deepEqual(
    [...document.querySelectorAll('#mobileMoreMenu button')].map((button) => button.dataset.readerAction),
    ['openBookmarks', 'exportHighlights', 'openAi']
  );
  assert.equal(document.getElementById('btnMobilePreviousPage'), null);
  assert.equal(document.getElementById('btnMobileNextPage'), null);
  assert.equal(document.getElementById('btnScrollPreviousChapter').parentElement.id, 'scrollChapterHeader');
  assert.equal(document.getElementById('btnScrollNextChapter').parentElement.id, 'scrollChapterFooter');

  window.document.documentElement.dataset.readerSurface = 'mobile';
  api.state.contentType = 'epub';
  api.state.currentPath = 'fixture.epub';
  api.setMobileChromeOpen(true);
  assert.equal(document.body.dataset.mobileChrome, 'open');
  assert.equal(document.body.classList.contains('mobile-reading'), true);
  assert.equal(toolbar.hidden, false);
  assert.equal(document.getElementById('mobileReadingFooter').hidden, true);
  api.setMobileChromeOpen(false);
  assert.equal(document.body.dataset.mobileChrome, 'closed');
  assert.equal(toolbar.hidden, true);
  // While the chrome is hidden a quiet footer shows where the reader is.
  assert.equal(document.getElementById('mobileReadingFooter').hidden, false);
});

test('phone tap zones turn pages at the edges and show the chrome in the middle', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const reader = document.getElementById('reader');
  document.documentElement.dataset.readerSurface = 'mobile';
  api.state.contentType = 'epub';
  api.state.currentPath = 'fixture.epub';
  api.state.effectiveReadingMode = 'double';
  api.state.pageGroupCount = 5;
  api.state.pageGroup = 2;
  const turns = [];
  const recordTurn = () => turns.push(api.state.pageGroup);
  api.setupReaderNavigation();
  const width = window.innerWidth;
  const tap = (x) => reader.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: x, clientY: 200 }));

  tap(width - 10);
  recordTurn();
  tap(10);
  recordTurn();
  assert.equal(document.body.classList.contains('mobile-chrome-open'), false);
  tap(width / 2);
  assert.equal(document.body.classList.contains('mobile-chrome-open'), true);
  // With the chrome open any tap only hides it.
  tap(width - 10);
  assert.equal(document.body.classList.contains('mobile-chrome-open'), false);
  assert.equal(api.state.pageGroup, 2);
  assert.deepEqual(turns, [3, 2]);

  // Scrolling books: any tap shows the chrome.
  api.state.effectiveReadingMode = 'scroll';
  tap(width - 10);
  assert.equal(document.body.classList.contains('mobile-chrome-open'), true);
  assert.equal(api.state.pageGroup, 2);
});

test('mobile reader hides the topbar while scrolling down and restores it while scrolling up', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  window.document.documentElement.dataset.readerSurface = 'mobile';
  api.state.contentType = 'epub';
  api.setupReaderNavigation();

  reader.scrollTop = 160;
  reader.dispatchEvent(new window.Event('scroll'));
  assert.equal(window.document.body.classList.contains('mobile-topbar-hidden'), true);

  reader.scrollTop = 80;
  reader.dispatchEvent(new window.Event('scroll'));
  assert.equal(window.document.body.classList.contains('mobile-topbar-hidden'), false);

  reader.scrollTop = 0;
  reader.dispatchEvent(new window.Event('scroll'));
  assert.equal(window.document.body.classList.contains('mobile-topbar-hidden'), false);
});

test('phones page left and right by default and keep their own mode apart from the desktop one', async () => {
  const mobile = await createReaderDom();
  mobile.window.document.documentElement.dataset.readerSurface = 'mobile';
  mobile.api.applyUserState({ settings: { readingMode: 'scroll', continuousScroll: true }, books: {} });

  assert.equal(mobile.api.state.readingMode, 'double');
  assert.equal(mobile.api.currentUserSettings().readingMode, 'scroll');
  assert.equal(mobile.api.currentUserSettings().mobileReadingMode, 'paged');

  // Choosing 上下滚动 on the phone saves only the phone's mode.
  mobile.api.state.readingMode = 'scroll';
  assert.equal(mobile.api.currentUserSettings().readingMode, 'scroll');
  assert.equal(mobile.api.currentUserSettings().mobileReadingMode, 'scroll');

  const phoneScroll = await createReaderDom();
  phoneScroll.window.document.documentElement.dataset.readerSurface = 'mobile';
  phoneScroll.api.applyUserState({ settings: { readingMode: 'double', mobileReadingMode: 'scroll' }, books: {} });
  assert.equal(phoneScroll.api.state.readingMode, 'scroll');
  assert.equal(phoneScroll.api.currentUserSettings().readingMode, 'double');

  const desktop = await createReaderDom();
  desktop.window.document.documentElement.dataset.readerSurface = 'desktop';
  desktop.api.applyUserState({ settings: { readingMode: 'double', mobileReadingMode: 'scroll' }, books: {} });
  assert.equal(desktop.api.state.readingMode, 'double');
  assert.equal(desktop.api.currentUserSettings().mobileReadingMode, 'scroll');
});

test('PDF layout preference and shared highlight color keep EPUB controls intact', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.applyUserState({ settings: { pdfLayoutMode: 'invalid', readingMode: 'double' }, books: {} });
  assert.equal(api.state.pdfLayoutMode, 'continuous');
  assert.equal(api.state.readingMode, 'double');
  api.applyUserState({ settings: { pdfLayoutMode: 'single', readingMode: 'double' }, books: {} });
  assert.equal(api.currentUserSettings().pdfLayoutMode, 'single');

  api.state.contentType = 'pdf';
  api.openReaderPanel('settings', document.getElementById('btnSettings'));
  assert.equal(document.getElementById('settingPdfLayoutMode').closest('label').hidden, false);
  assert.equal(document.getElementById('settingReadingMode').closest('label').hidden, true);
  assert.equal(document.getElementById('settingFontFamily').closest('label').hidden, true);
  assert.equal(document.querySelector('[data-settings-group="highlight"]').hidden, false);
  assert.equal(document.querySelector('[data-settings-group="typography"]').hidden, true);

  api.state.contentType = 'epub';
  api.openReaderPanel('settings', document.getElementById('btnSettings'));
  assert.equal(document.getElementById('settingPdfLayoutMode').closest('label').hidden, true);
  assert.equal(document.getElementById('settingReadingMode').closest('label').hidden, false);
  assert.equal(document.querySelector('[data-settings-group="highlight"]').hidden, false);
  assert.equal(api.state.readingMode, 'double');
});

test('PDF toolbar uses the shared reader navigation icons and Apple control tokens', async () => {
  const { window } = await createReaderDom();
  const document = window.document;
  const controls = document.querySelector('.pdf-reader-controls');
  assert.ok(controls);
  for (const id of ['pdfPreviousPage', 'pdfNextPage', 'pdfZoomOut', 'pdfZoomIn']) {
    const button = document.getElementById(id);
    assert.ok(button?.querySelector('svg'), `${id} should use a vector icon`);
    assert.equal(button.textContent.trim(), '', `${id} should not rely on a text glyph`);
  }
  const css = (await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8'))
    .replace(/\r\n/g, '\n');
  assert.match(css, /\.pdf-reader-controls button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(css, /\.pdf-reader-controls button\s*\{[^}]*border-radius:\s*var\(--radius-control\);/s);
  assert.match(css, /\.pdf-reader-controls button svg\s*\{[^}]*stroke:\s*currentColor;[^}]*stroke-linecap:\s*round;/s);
  assert.match(css, /\.pdf-reader-controls\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--color-bar\)/s);
});

test('PDF desktop controls share the fixed reader topbar material while mobile keeps flow layout', async () => {
  const css = (await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8'))
    .replace(/\r\n/g, '\n');
  assert.match(css, /body\.is-pdf-reader\s+\.pdf-reader-controls\s*\{[^}]*position:\s*fixed;[^}]*top:\s*0;[^}]*z-index:\s*101;/s);
  assert.match(css, /body\.is-pdf-reader\s+\.pdf-reader-controls\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /body\.is-pdf-reader\s+\.pdf-reader-controls\s+\.pdf-control-group\s*\{[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /body\.is-pdf-reader\s+\.pdf-reader-controls\[data-pdf-toolbar-mode="compact"\],\s*body\.is-pdf-reader\s+\.pdf-reader-controls\[data-pdf-toolbar-mode="mobile"\]\s*\{[^}]*position:\s*sticky;/s);
});

test('PDF reading exposes one deliberate position announcement and a keyboard-focusable page viewport', async () => {
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  assert.match(html, /id="pdfReaderAnnouncement"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="pdfPages"[^>]*tabindex="0"/);
  assert.doesNotMatch(html, /id="pdfZoomValue"[^>]*aria-live=/);
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  assert.match(css, /@media \(forced-colors: active\)\s*\{[^]*?\.pdf-search-hit-rect\s*\{[^}]*outline:\s*2px solid Highlight;/);
});

test('mobile topbar hiding also releases the reader into the topbar area', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const normalized = css.replace(/\r\n/g, '\n');
  assert.match(normalized, /html\[data-reader-surface="mobile"\]\s+body\.is-epub\.mobile-topbar-hidden\s+\.reader-shell-nav\s*\{[^}]*transform:\s*translateY\(-100%\);[^}]*pointer-events:\s*none;/s);
  assert.match(normalized, /html\[data-reader-surface="mobile"\]\s+body\.is-epub\.mobile-topbar-hidden\s+\.reader\s*\{[^}]*top:\s*0;/s);
});

test('mobile chapter boundary buttons use a compact size rather than the desktop-width pill', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const normalized = css.replace(/\r\n/g, '\n');
  assert.match(normalized, /html\[data-reader-surface="mobile"\]\s+\.scroll-chapter-btn\s*\{[^}]*width: min\(168px, 100%\);[^}]*min-height: 40px;/s);
});

test('readerActions and readerPanels switch TOC and settings across independent surfaces', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;

  assert.deepEqual(
    Object.keys(api.readerPanels),
    ['toc', 'settings', 'search', 'bookmarks', 'notes']
  );
  for (const action of [
    'backToLibrary',
    'previousChapter',
    'nextChapter',
    'previousPage',
    'nextPage',
    'highlight',
    'exportHighlights',
    'toggleTheme',
    'openToc',
    'openSettings',
    'openNotes',
    'closePanel'
  ]) {
    assert.equal(typeof api.readerActions[action], 'function', `missing reader action: ${action}`);
  }

  api.setupNotesPanel();
  api.setupReaderActionMapping();
  document.getElementById('btnSettings').click();
  assert.equal(document.getElementById('readerSettingsSheet').hidden, false);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerPanelSettings').hidden, false);
  assert.equal(document.getElementById('readerPanelSettings').closest('#readerDrawer'), null);

  api.state.contentType = 'epub';
  api.state.toc = [{ label: '第一章', target: '#chapter-1', depth: 0 }];
  api.renderToc();
  document.getElementById('drawerTabToc').click();
  assert.equal(document.getElementById('readerPanelToc').hidden, false);
  assert.equal(document.getElementById('readerSettingsSheet').hidden, true);
  assert.equal(document.querySelectorAll('#tocList a[data-target]').length, 1);

  document.getElementById('btnCloseSettings').click();
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerSettingsSheet').hidden, true);
  assert.equal(document.getElementById('readerDrawerBackdrop').hidden, true);
});

test('reader content and display settings use independent surfaces', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;

  assert.ok(document.getElementById('readerDrawer'));
  assert.ok(document.getElementById('readerSettingsSheet'));
  assert.equal(document.querySelectorAll('#readerDrawer .reader-drawer-tabs [role="tab"]').length, 3);
  assert.equal(document.querySelector('#readerDrawer #drawerTabSettings'), null);
  assert.equal(document.querySelector('#readerDrawer #readerPanelSettings'), null);

  api.setupReaderActionMapping();
  const settingsButton = document.getElementById('btnSettings');
  settingsButton.focus();
  settingsButton.click();
  assert.equal(document.getElementById('readerSettingsSheet').hidden, false);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerSettingsSheet').querySelector('#settingsPanel') !== null, true);

  api.state.contentType = 'epub';
  api.state.toc = [{ label: '第一章', target: '#chapter-1', depth: 0 }];
  api.renderToc();
  document.getElementById('btnToc').click();
  assert.equal(document.getElementById('readerDrawer').hidden, false);
  assert.equal(document.getElementById('readerSettingsSheet').hidden, true);
  assert.equal(document.getElementById('readerPanelToc').hidden, false);
  assert.equal(document.querySelectorAll('#readerDrawer .reader-drawer-tabs [role="tab"]').length, 3);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerSettingsSheet').hidden, true);
});

test('reader surface controller enforces one active surface and accessible state', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;

  api.setupReaderActionMapping();
  api.state.contentType = 'epub';
  api.state.currentBookId = 'surface-controller-book';
  api.state.toc = [{ label: '第一章', target: '#chapter-1', depth: 0 }];
  api.renderToc();

  const settingsButton = document.getElementById('btnSettings');
  settingsButton.focus();
  settingsButton.click();
  assert.equal(api.readerSurfaceController.activeSurface, 'settings');
  assert.equal(document.getElementById('readerSettingsSheet').getAttribute('aria-hidden'), 'false');
  assert.equal(document.getElementById('readerDrawer').getAttribute('aria-hidden'), 'true');
  assert.equal(document.getElementById('readerSettingsBackdrop').hidden, false);
  assert.equal(settingsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('btnToc').getAttribute('aria-expanded'), 'false');

  document.getElementById('btnToc').click();
  assert.equal(api.readerSurfaceController.activeSurface, 'content');
  assert.equal(document.getElementById('readerDrawer').getAttribute('aria-hidden'), 'false');
  assert.equal(document.getElementById('readerSettingsSheet').getAttribute('aria-hidden'), 'true');
  assert.equal(document.getElementById('readerDrawerBackdrop').hidden, false);
  assert.equal(document.getElementById('readerSettingsBackdrop').hidden, true);
  assert.equal(document.getElementById('btnToc').getAttribute('aria-expanded'), 'true');
  assert.equal(settingsButton.getAttribute('aria-expanded'), 'false');

  document.getElementById('readerDrawerBackdrop').click();
  assert.equal(api.readerSurfaceController.activeSurface, null);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.activeElement, settingsButton);

  document.getElementById('btnToc').click();
  assert.equal(api.readerSurfaceController.activeSurface, 'content');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(api.readerSurfaceController.activeSurface, null);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerSettingsSheet').hidden, true);
  assert.equal(document.activeElement, document.getElementById('btnToc'));
});

test('Drawer keeps one active panel and restores focus to its original launcher', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const settingsButton = document.getElementById('btnSettings');

  api.setupReaderActionMapping();
  settingsButton.focus();
  settingsButton.click();
  assert.equal(document.getElementById('readerSettingsSheet').hidden, false);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.body.classList.contains('reader-drawer-open'), true);
  assert.equal(document.getElementById('btnSettings').getAttribute('aria-expanded'), 'true');

  api.state.contentType = 'epub';
  api.state.toc = [{ label: '第一章', target: '#chapter-1', depth: 0 }];
  api.renderToc();
  document.getElementById('drawerTabToc').click();
  assert.equal(document.querySelectorAll('[data-reader-panel-name]:not([hidden])').length, 1);
  assert.equal(document.getElementById('readerPanelToc').hidden, false);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerDrawerBackdrop').hidden, true);
  assert.equal(document.body.classList.contains('reader-drawer-open'), false);
  assert.equal(document.activeElement, settingsButton);
});

test('bookmark toolbar, Drawer list, and mobile entry are enabled for EPUB and PDF', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const bookId = 'bookmark-ui-book';
  const chapter = mountDuplicateTextChapter(window);
  const target = document.createElement('p');
  target.id = 'bookmark-ui-target';
  target.textContent = '书签目标';
  chapter.replaceChildren(target);
  api.state.currentBookId = bookId;
  api.state.currentPath = 'bookmark-ui.epub';
  api.state.contentType = 'epub';
  api.state.effectiveReadingMode = 'scroll';
  api.state.epubChapterCount = 1;
  api.state.epubChapterIndex = 0;
  api.state.userState.books[bookId] = {
    bookmarks: [{
      id: 'bookmark-ui-1',
      label: '书签目标',
      locator: { href: 'OPS/chapter.xhtml', anchor: 'bookmark-ui-target', readingScope: 'chapter' }
    }]
  };

  api.renderToc();
  const desktopButton = document.getElementById('btnBookmarks');
  const mobileButton = document.querySelector('#mobileMoreMenu [data-reader-action="openBookmarks"]');
  assert.equal(desktopButton.disabled, false);
  assert.equal(desktopButton.dataset.readerStatus, undefined);
  assert.equal(api.readerPanels.bookmarks.enabled(), true);
  assert.ok(mobileButton);
  assert.equal(document.getElementById('btnMobileTopBookmark').disabled, false);

  api.renderBookmarkList();
  assert.equal(document.querySelectorAll('#bookmarkList [data-bookmark-id]').length, 1);
  assert.equal(document.getElementById('bookmarkEmptyState').hidden, true);

  assert.equal(api.readerActions.openBookmarks(mobileButton), true);
  assert.equal(document.getElementById('readerPanelBookmarks').hidden, false);
  assert.equal(document.querySelectorAll('[data-reader-panel-name]:not([hidden])').length, 1);

  api.state.contentType = 'pdf';
  api.state.currentPath = 'bookmark-ui.pdf';
  window.pdfReaderController = {
    getCurrentBookId: () => bookId,
    getCurrentPageIndex: () => 0,
    getPageCount: () => 2
  };
  api.renderToc();
  assert.equal(desktopButton.disabled, false);
  assert.equal(mobileButton.disabled, false);
  assert.equal(api.readerPanels.bookmarks.enabled(), true);

  api.state.contentType = 'text';
  api.renderToc();
  assert.equal(desktopButton.disabled, true);
  assert.equal(mobileButton.disabled, true);
  assert.equal(api.readerPanels.bookmarks.enabled(), false);
});

test('PDF settings explain fixed-page behavior without exposing EPUB typography controls', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const hint = document.getElementById('settingsPdfLayoutHint');
  assert.ok(hint);
  api.state.contentType = 'pdf';
  api.typographyApi.syncSettingsPanel();
  assert.equal(hint.hidden, false);
  assert.equal(document.querySelector('[data-pdf-inapplicable] #settingReadingMode').closest('[data-pdf-inapplicable]').hidden, true);
  assert.equal(document.querySelector('[data-pdf-only] #settingPdfLayoutMode').closest('[data-pdf-only]').hidden, false);
  assert.match(hint.textContent, /固定版面/);
  assert.match(hint.textContent, /缩放/);

  api.state.contentType = 'epub';
  api.typographyApi.syncSettingsPanel();
  assert.equal(hint.hidden, true);
  assert.equal(document.querySelector('[data-pdf-inapplicable] #settingReadingMode').closest('[data-pdf-inapplicable]').hidden, false);
  assert.equal(document.querySelector('[data-pdf-only] #settingPdfLayoutMode').closest('[data-pdf-only]').hidden, true);
});

test('reserved reader actions stay disabled and never issue API requests while AI is EPUB-only', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  let requestCount = 0;
  window.fetch = async () => {
    requestCount += 1;
    return { ok: true, json: async () => ({}) };
  };

  const search = ['btnSearch', 'openSearch', 'search'];
  for (const [controlId, actionName, panelName] of [search]) {
    const control = document.getElementById(controlId);
    assert.equal(control.disabled, true);
    assert.equal(control.dataset.readerStatus, 'reserved');
    assert.equal(api.readerPanels[panelName].enabled(), false);
    assert.equal(api.readerActions[actionName](control), false);
  }

  const bookmarks = document.getElementById('btnBookmarks');
  assert.equal(bookmarks.disabled, true);
  assert.equal(bookmarks.dataset.readerStatus, undefined);
  assert.equal(api.readerPanels.bookmarks.enabled(), false);
  assert.equal(api.readerActions.openBookmarks(bookmarks), false);

  api.state.contentType = 'epub';
  assert.equal(typeof api.readerActions.openAi, 'function');
  assert.equal(await api.readerActions.openAi(document.getElementById('btnAi')), true);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requestCount, 1);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('aiModal').hidden, false);
});

test('notes panel is an enabled drawer destination with whole-book filters', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;

  assert.equal(document.getElementById('btnNotes').disabled, false);
  api.state.contentType = 'epub';
  assert.equal(api.readerPanels.notes.enabled(), true);
  assert.equal(document.querySelector('#notesSort option[value="chapter"]').textContent, '按章节');
  assert.ok(document.getElementById('drawerTabNotes'));
  assert.equal(document.getElementById('readerPanelNotes').hidden, true);

  api.state.currentBookId = 'notes-book';
  api.state.userState.books['notes-book'] = {
    highlights: [
      {
        id: 'marker-1',
        chapterHref: 'OPS/chapter-1.xhtml',
        text: '第一章标记',
        kind: 'highlight',
        style: 'marker',
        thought: ''
      },
      {
        id: 'thought-1',
        chapterHref: 'OPS/chapter-2.xhtml',
        text: '第二章原文',
        kind: 'thought',
        style: 'none',
        thought: '这是第二章想法'
      }
    ]
  };
  api.state.toc = [
    { label: '第一章', target: 'epub-path:OPS/chapter-1.xhtml#', depth: 0 },
    { label: '第二章', target: 'epub-path:OPS/chapter-2.xhtml#', depth: 0 }
  ];

  api.setupNotesPanel();
  api.setupReaderActionMapping();
  document.getElementById('btnNotes').click();
  assert.equal(document.getElementById('readerPanelNotes').hidden, false);
  assert.equal(document.getElementById('readerDrawerTitle').textContent, '标记与想法');
  assert.equal(document.querySelectorAll('#notesList [data-annotation-id]').length, 2);
  assert.match(document.getElementById('notesPanelSummary').textContent, /1 条标记 · 1 条想法/);
  api.state.userState.books['notes-book'].highlights.reverse();
  api.renderNotesPanel();
  assert.deepEqual(
    Array.from(document.querySelectorAll('#notesList [data-annotation-id]'), (item) => item.dataset.annotationId),
    ['marker-1', 'thought-1']
  );

  document.querySelector('[data-notes-filter="thought"]').click();
  assert.deepEqual(
    [...document.querySelectorAll('#notesList [data-annotation-id]')].map((item) => item.dataset.annotationId),
    ['thought-1']
  );
});

test('notes panel keeps a row-level error when an annotation locator cannot be resolved', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.contentType = 'epub';
  api.state.currentBookId = 'broken-notes-book';
  api.state.userState.books['broken-notes-book'] = {
    highlights: [{
      id: 'broken-note',
      chapterHref: 'OPS/missing.xhtml',
      text: '失效定位文本',
      kind: 'highlight',
      style: 'marker',
      thought: ''
    }]
  };
  api.setupNotesPanel();

  assert.equal(await api.navigateToAnnotation('broken-note'), false);
  assert.equal(document.querySelector('.notes-item-error')?.textContent, '原文位置已变化');
  assert.equal(document.querySelector('[data-annotation-id="broken-note"]')?.dataset.notesError, 'true');
});

test('PDF annotations use the shared notes panel, show page labels, and block stale navigation and edits', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const bookId = 'c'.repeat(64);
  api.state.contentType = 'pdf';
  api.state.currentBookId = bookId;
  api.state.userState.books[bookId] = {
    pdfAnnotations: [
      {
        version: 1, type: 'pdf', id: 'pdf-fresh', sourceFingerprint: 'a'.repeat(64),
        kind: 'highlight', style: 'marker', color: 'yellow', text: 'PDF 当前页标记', thought: '',
        targets: [{ pageIndex: 3, quads: [[0.1, 0.1, 0.3, 0.1, 0.3, 0.12, 0.1, 0.12]] }],
        createdAt: '2026-09-25T10:00:00.000Z'
      },
      {
        version: 1, type: 'pdf', id: 'pdf-stale', sourceFingerprint: 'b'.repeat(64), sourceStale: true,
        kind: 'thought', style: 'none', color: 'blue', text: '原文替换前的想法', thought: '仅允许清理',
        targets: [{ pageIndex: 7, quads: [[0.1, 0.1, 0.3, 0.1, 0.3, 0.12, 0.1, 0.12]] }],
        createdAt: '2026-09-26T10:00:00.000Z'
      }
    ]
  };

  assert.equal(api.readerPanels.notes.enabled(), true);
  api.setupNotesPanel();
  assert.equal(api.renderNotesPanel(), true);
  assert.equal(document.querySelector('#notesSort option[value="chapter"]').textContent, '按页');
  assert.match(document.getElementById('notesPanelSummary').textContent, /1 条标记 · 1 条想法/);
  assert.match(document.querySelector('[data-annotation-id="pdf-fresh"] .notes-item-chapter').textContent, /第 4 页/);
  const stale = document.querySelector('[data-annotation-id="pdf-stale"]');
  assert.match(stale.textContent, /原文已变化/);
  assert.equal(stale.querySelector('[data-notes-action="edit"]'), null);
  assert.ok(stale.querySelector('[data-notes-action="delete"]'));
  let navigatedPage = -1;
  const scrollCalls = [];
  const pageHost = document.getElementById('pdfPages');
  Object.defineProperty(pageHost, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(pageHost, 'clientWidth', { configurable: true, value: 800 });
  pageHost.getBoundingClientRect = () => ({ left: 100, right: 900, top: 100, bottom: 700, width: 800, height: 600 });
  pageHost.scrollBy = (options) => scrollCalls.push(options);
  const pageElement = document.createElement('div');
  pageElement.className = 'pdf-page';
  pageElement.getBoundingClientRect = () => ({ left: 100, right: 700, top: 1200, bottom: 2000, width: 600, height: 800 });
  pageHost.appendChild(pageElement);
  window.pdfReaderController = {
    getPageCount: () => 12,
    getCurrentBookId: () => bookId,
    getGeneration: () => 3,
    getRenderedPageGeometry: (pageIndex) => pageIndex === 3 ? {
      bookId, generation: 3, pageIndex, pageElement, pageView: [0, 0, 1000, 1000],
      viewport: { convertToViewportPoint: (x, y) => [x, y] }
    } : null,
    goToPdfPage: (pageIndex) => { navigatedPage = pageIndex; return true; }
  };
  assert.equal(await api.navigateToAnnotation('pdf-fresh'), true);
  assert.equal(navigatedPage, 3);
  assert.equal(scrollCalls.length, 1, 'the target quad is moved into the readable viewport');
  assert.ok(scrollCalls[0].top > 0);
  assert.ok(pageElement.querySelector('.pdf-note-navigation-highlight'));
  assert.equal(pageElement.querySelector('.pdf-note-navigation-highlight').style.left, '100px');
  window.pdfReaderController.getRenderedPageGeometry = () => null;
  assert.equal(await api.navigateToAnnotation('pdf-fresh'), true, 'page navigation remains available when a current text frame cannot be resolved');
  assert.match(document.querySelector('[data-annotation-id="pdf-fresh"] .notes-item-error')?.textContent || '', /精确原文位置暂不可用/);
  assert.equal(scrollCalls.length, 1, 'a missing frame must not reuse old geometry');
  assert.equal(await api.navigateToAnnotation('pdf-stale'), false);

  document.querySelector('[data-notes-filter="thought"]').click();
  assert.deepEqual(Array.from(document.querySelectorAll('#notesList [data-annotation-id]'), (item) => item.dataset.annotationId), ['pdf-stale']);
  document.querySelector('[data-notes-filter="marker"]').click();
  assert.deepEqual(Array.from(document.querySelectorAll('#notesList [data-annotation-id]'), (item) => item.dataset.annotationId), ['pdf-fresh']);
  document.querySelector('[data-notes-filter="all"]').click();
  const sort = document.getElementById('notesSort');
  sort.value = 'time';
  sort.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#notesList [data-annotation-id]')?.dataset.annotationId, 'pdf-stale');
});

test('PDF note navigation cancels when the reader changes books during page rendering', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const bookId = 'e'.repeat(64);
  api.state.contentType = 'pdf';
  api.state.currentBookId = bookId;
  api.state.userState.books[bookId] = {
    pdfAnnotations: [{
      version: 1, type: 'pdf', id: 'switching-note', sourceFingerprint: 'f'.repeat(64),
      kind: 'highlight', style: 'marker', color: 'yellow', text: '原书文字', thought: '',
      targets: [{ pageIndex: 0, quads: [[0.1, 0.1, 0.2, 0.1, 0.2, 0.12, 0.1, 0.12]] }]
    }]
  };
  api.setupNotesPanel();
  api.renderNotesPanel();
  window.pdfReaderController = {
    getPageCount: () => 2,
    getCurrentBookId: () => bookId,
    getGeneration: () => 1,
    getRenderedPageGeometry: () => null,
    goToPdfPage: () => { api.state.currentBookId = 'f'.repeat(64); return true; }
  };

  assert.equal(await api.navigateToAnnotation('switching-note'), false);
  assert.match(document.querySelector('.notes-item-error')?.textContent || '', /已切换/);
});

test('PDF annotation API methods update the current book cache only after server success', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'd'.repeat(64);
  api.state.currentBookId = bookId;
  api.state.contentType = 'pdf';
  api.state.userState.books[bookId] = { highlights: [{ id: 'epub-keep' }], pdfAnnotations: [] };
  const requests = [];
  const saved = {
    version: 1, type: 'pdf', id: '00000000-0000-4000-8000-000000000001',
    sourceFingerprint: 'a'.repeat(64), kind: 'highlight', style: 'marker', color: 'yellow',
    text: '依据', thought: '', targets: [{ pageIndex: 0, quads: [[0.1, 0.1, 0.2, 0.1, 0.2, 0.12, 0.1, 0.12]] }]
  };
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => options.method === 'POST' ? { annotation: saved } : { annotations: [saved] }
    };
  };

  assert.equal(typeof window.browserHost.getPdfAnnotations, 'function');
  const listed = await window.browserHost.getPdfAnnotations(bookId);
  assert.deepEqual(Array.from(listed.annotations, (item) => item.id), [saved.id]);
  const created = await window.browserHost.createPdfAnnotation({ version: 1, type: 'pdf', id: saved.id }, bookId);
  assert.equal(created.annotation.id, saved.id);
  assert.equal(requests[0].url, `/app/zhenshu/api/books/${bookId}/pdf-annotations`);
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.userState.books[bookId].highlights)), [{ id: 'epub-keep' }]);
  assert.deepEqual(Array.from(api.state.userState.books[bookId].pdfAnnotations, (item) => item.id), [saved.id]);

  const cacheBeforeFailure = api.state.userState.books[bookId].pdfAnnotations;
  window.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: '原文已变化' })
  });
  await assert.rejects(
    window.browserHost.updatePdfAnnotation(saved.id, { color: 'pink' }, bookId),
    /原文已变化/
  );
  assert.equal(api.state.userState.books[bookId].pdfAnnotations, cacheBeforeFailure);
  await assert.rejects(
    window.browserHost.deletePdfAnnotation(saved.id, bookId),
    /原文已变化/
  );
  assert.equal(api.state.userState.books[bookId].pdfAnnotations, cacheBeforeFailure);
});

test('PDF annotations restore a renderer session before the first page frame and reject old generations', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'd'.repeat(64);
  const record = {
    id: 'restored', sourceFingerprint: 'a'.repeat(64), sourceStale: false,
    targets: [{ pageIndex: 0, quads: [[0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]] }]
  };
  api.state.currentBookId = bookId;
  api.state.contentType = 'pdf';
  let generation = 9;
  const sessions = [];
  window.pdfReaderController = {
    getCurrentBookId: () => bookId,
    getGeneration: () => generation,
    getCurrentPageIndex: () => 0,
    getRenderedPageGeometry: () => null
  };
  window.pdfAnnotationRenderer = {
    setAnnotations: (session) => { sessions.push(session); return true; }
  };

  assert.equal(window.__zhenshuAnnotationsApi.setPdfAnnotationRendererRecords(bookId, [record]), true);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].generation, 9);
  assert.equal(sessions[0].annotations[0].id, 'restored');
  generation = 10;
  assert.equal(window.__zhenshuAnnotationsApi.setPdfAnnotationRendererRecords(bookId, [record], 9), false);
  assert.equal(sessions.length, 1, 'late responses from the previous PDF generation must not install a session');
});

test('PDF thought and edit dialogs reject a book switch before issuing a write', async () => {
  const { window, api } = await createReaderDom();
  const firstBookId = 'e'.repeat(64);
  const secondBookId = 'f'.repeat(64);
  const annotation = {
    id: 'pdf-edit', type: 'pdf', kind: 'highlight', style: 'marker', color: 'yellow',
    text: '第一页原文', thought: '', targets: [{ pageIndex: 0, quads: [] }]
  };
  api.state.currentBookId = firstBookId;
  api.state.contentType = 'pdf';
  api.state.userState.books[firstBookId] = { pdfAnnotations: [annotation] };
  api.state.userState.books[secondBookId] = { highlights: [] };
  let writes = 0;
  window.browserHost.createPdfAnnotation = async () => { writes += 1; return { annotation }; };
  window.browserHost.updatePdfAnnotation = async () => { writes += 1; return { annotation }; };

  assert.equal(api.openThoughtComposer({
    format: 'pdf', bookId: firstBookId, text: '第一页原文', range: {}, targets: [{ pageIndex: 0, quads: [] }]
  }), true);
  window.document.getElementById('highlightEditorThought').value = '切书后不应保存';
  api.state.currentBookId = secondBookId;
  api.state.contentType = 'epub';
  await api.saveActiveHighlightEdits();
  assert.equal(writes, 0);
  assert.deepEqual(Array.from(api.state.userState.books[secondBookId].highlights), []);
  api.closeHighlightEditor({ restoreFocus: false });

  api.state.currentBookId = firstBookId;
  api.state.contentType = 'pdf';
  assert.equal(api.openHighlightEditor(annotation.id), true);
  api.state.currentBookId = secondBookId;
  await api.saveActiveHighlightEdits();
  assert.equal(writes, 0);
});

test('PDF annotation edit failure keeps the editor draft and saved cache intact', async () => {
  const { window, api } = await createReaderDom();
  const bookId = 'a'.repeat(64);
  const saved = {
    id: 'pdf-edit-failure', type: 'pdf', kind: 'highlight', style: 'marker', color: 'yellow',
    text: '待修改原文', thought: '', targets: [{ pageIndex: 0, quads: [] }]
  };
  api.state.contentType = 'pdf';
  api.state.currentBookId = bookId;
  api.state.userState.books[bookId] = { pdfAnnotations: [saved] };
  window.browserHost.updatePdfAnnotation = async () => { throw new Error('写入失败'); };

  assert.equal(api.openHighlightEditor(saved.id), true);
  const thought = window.document.getElementById('highlightEditorThought');
  thought.value = '未保存的草稿';
  await api.saveActiveHighlightEdits();
  assert.equal(window.document.getElementById('highlightEditor').hidden, false);
  assert.equal(thought.value, '未保存的草稿');
  assert.equal(api.state.userState.books[bookId].pdfAnnotations[0], saved);
});

test('pagination geometry fixes single mode to one column and double mode to two columns', async () => {
  const { api } = await createReaderDom();

  const single = api.createPaginationGeometry({
    readerWidth: 1200,
    readerHeight: 800,
    mode: 'single',
    pageMargin: 40,
    columnGap: 36,
    devicePixelRatio: 1
  });
  assert.equal(single.columns, 1);
  // pageMargin 40 maps onto a 56px inner inset (tightened from 70px).
  assert.equal(single.columnPadding, 56);
  // Single-mode uses a minimum gap (≥columnPadding) to prevent the second
  // column from leaking into the paper when column-width is computed. This
  // avoids the right-edge text being clipped by overflow-x:hidden.
  assert.equal(single.columnGap, single.columnPadding);
  // The multicol box owns no horizontal padding, so one column fills the
  // text area exactly; the advance is still one full column pitch, which
  // includes the (invisible but required) single-mode gap.
  assert.equal(single.spreadWidth, single.columnWidth);
  assert.equal(single.pageGroupWidth, single.columns * single.pageStepWidth);
  assert.equal(single.pageStepWidth, single.columnWidth + single.columnGap);
  assert.ok(single.columnGap >= single.columnPadding);

  const double = api.createPaginationGeometry({
    readerWidth: 1200,
    readerHeight: 800,
    mode: 'double',
    pageMargin: 40,
    columnGap: 36,
    devicePixelRatio: 1
  });
  assert.equal(double.columns, 2);
  // Requested gap is honoured only when it is at least the card's inner
  // padding; a smaller gap would let the next spread bleed into this one.
  assert.equal(double.columnGap, Math.max(56, 36));
  assert.equal(double.spreadWidth, double.columnWidth * 2 + double.columnGap);
  // Advancing by the viewport width was the original defect: column k starts
  // at k*(width+gap), so a spread only re-aligns on a (width+gap)*columns grid.
  assert.equal(double.pageGroupWidth, double.columns * (double.columnWidth + double.columnGap));
  assert.notEqual(double.pageGroupWidth, double.viewportWidth);
});

test('insets live on the viewport and keep the paper centred and symmetric', async () => {
  const { api } = await createReaderDom();

  const geometry = api.createPaginationGeometry({
    readerWidth: 1200,
    readerHeight: 800,
    mode: 'double',
    pageMargin: 40,
    columnGap: 98,
    devicePixelRatio: 1
  });
  // Symmetric margins: WeChat-reading-like centred layout.
  assert.equal(geometry.insetLeft, geometry.insetRight);
  assert.ok(geometry.insetLeft >= 40);
  assert.ok(geometry.paperWidth <= 1180);
  assert.ok(geometry.insetLeft * 2 + geometry.paperWidth <= geometry.viewportWidth);
});

test('every page group shows exactly the intended column count at any width', async () => {
  const { api } = await createReaderDom();

  const visibleColumns = (geometry, group) => {
    const textWidth = geometry.spreadWidth;
    const pitch = geometry.columnWidth + geometry.columnGap;
    const left = group * geometry.pageGroupWidth;
    const right = left + textWidth;
    let count = 0;
    const lastColumn = group * geometry.columns + geometry.columns + 2;
    for (let column = 0; column <= lastColumn; column += 1) {
      const start = column * pitch;
      const end = start + geometry.columnWidth;
      if (end > left + 0.5 && start < right - 0.5) count += 1;
    }
    return count;
  };

  for (const mode of ['single', 'double']) {
    for (const readerWidth of [900, 1001, 1200, 1440, 1600, 1920, 2560]) {
      for (const pageMargin of [8, 40, 56, 96]) {
        const geometry = api.createPaginationGeometry({
          readerWidth,
          readerHeight: 800,
          mode,
          pageMargin,
          columnGap: 72,
          devicePixelRatio: 1
        });
        for (const group of [0, 1, 2, 7, 20]) {
          assert.equal(
            visibleColumns(geometry, group),
            geometry.columns,
            `${mode} @ ${readerWidth}px margin ${pageMargin} group ${group}`
          );
        }
      }
    }
  }
});

test('pagination geometry uses reader client dimensions at 1200x800 and 800x600', async () => {
  const { api } = await createReaderDom();

  const desktop = api.createPaginationGeometry({
    readerWidth: 1200,
    readerHeight: 800,
    mode: 'double',
    pageMargin: 56,
    columnGap: 98,
    devicePixelRatio: 1
  });
  assert.equal(desktop.viewportWidth, 1200);
  assert.equal(desktop.viewportHeight, 800);
  // Larger reading surface: 800 - 40 (top band) - 24 (bottom breath) = 736 card,
  // minus 56 / 60 of inner block padding (60 leaves room for the page pills).
  assert.equal(desktop.bandTop, 40);
  assert.equal(desktop.bandBottom, 24);
  assert.equal(desktop.padTop, 56);
  assert.equal(desktop.padBottom, 60);
  assert.equal(desktop.pageHeight, 736 - 56 - 60);
  assert.equal(desktop.columns, 2);
  assert.equal(desktop.columnGap, 98);
  // pageMargin 56 x 1.4 = 78.4 -> 78px inner inset.
  assert.equal(desktop.columnPadding, 78);
  // Expanded card: min(0.90 x 1200, 1200 - 128) = 1072.
  assert.equal(desktop.paperWidth, 1072);
  assert.ok(desktop.pageHeight > 500);

  const compact = api.createPaginationGeometry({
    readerWidth: 800,
    readerHeight: 600,
    mode: 'single',
    pageMargin: 32,
    columnGap: 98,
    devicePixelRatio: 1
  });
  assert.equal(compact.columns, 1);
  // Mobile mode uses smaller padding; single mode's gap must still cover it.
  assert.ok(compact.columnGap >= compact.columnPadding);
  // Compact viewport: 600 - 40 (top) - 24 (bottom) = 536 card, pad 56/60 -> 420 column.
  assert.equal(compact.pageHeight, 420);
  assert.ok(compact.paperWidth <= 700);
});

test('odd widths and fractional device pixels keep whole-column page groups', async () => {
  const { api } = await createReaderDom();
  for (const pageMargin of [8, 40, 73, 96]) {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      const geometry = api.createPaginationGeometry({
        readerWidth: 1001,
        readerHeight: 701,
        mode: 'double',
        pageMargin,
        columnGap: 35,
        devicePixelRatio
      });
      assert.equal(geometry.columns, 2);
      // The group step must stay an exact multiple of the column pitch,
      // otherwise fractional rounding accumulates into half-page remainders.
      assert.ok(
        Math.abs(geometry.pageGroupWidth - geometry.columns * geometry.pageStepWidth) < 1e-9,
        `pageGroupWidth ${geometry.pageGroupWidth} is not ${geometry.columns} x ${geometry.pageStepWidth}`
      );
      assert.ok(geometry.columnWidth >= 1);
      assert.ok(geometry.spreadWidth + geometry.insetLeft + geometry.insetRight <= geometry.viewportWidth + 1e-9);
    }
  }
});

test('pagination declares viewport insets on the reader, not the multicol article', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');

  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1280 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  article.scrollTo = ({ left }) => { article.scrollLeft = left; };

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.readingMode = 'double';
  api.state.pageMargin = 40;

  api.measurePagination({ preserveLocator: false });

  // The CSS reads --reader-inset-* on .reader, and custom properties inherit
  // downwards only, so they must be declared on the reader itself.
  assert.match(reader.style.getPropertyValue('--reader-inset-left'), /^\d+px$/);
  assert.match(reader.style.getPropertyValue('--reader-inset-right'), /^\d+px$/);
  assert.equal(article.style.getPropertyValue('--reader-inset-left'), '');
  // Column geometry still belongs to the multicol box.
  assert.match(article.style.getPropertyValue('--reader-column-width'), /^\d+(\.\d+)?px$/);
  assert.match(article.style.getPropertyValue('--reader-spread-width'), /^\d+(\.\d+)?px$/);

  api.state.readingMode = 'scroll';
  api.measurePagination({ preserveLocator: false });
  assert.equal(reader.style.getPropertyValue('--reader-inset-left'), '');
  assert.equal(reader.style.getPropertyValue('--reader-inset-right'), '');
  assert.equal(article.style.getPropertyValue('--reader-column-width'), '');
});

test('paged mode scrolls the multicol article, never its ancestor reader', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');

  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  // The reader is deliberately left inert: paging must never depend on it.
  reader.scrollLeft = 0;

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.effectiveReadingMode = 'double';
  api.state.pageCount = 9;
  api.state.pageGroupCount = 5;
  api.state.pageGroup = 0;
  api.state.pageNumber = 1;
  api.state.pageGroupWidth = 1078;

  // Paging moves the multicol track through scrollLeft by default.
  assert.equal(api.navigatePageGroup(1), true);
  assert.equal(api.state.pageOffset, 1078);
  assert.equal(article.scrollLeft, 1078);
  // The reader must not be the scroller: its own scrollable overflow does not
  // contain the article's generated page columns.
  assert.equal(reader.scrollLeft, 0);
  assert.equal(article.style.transform, '');

  // scrollLeft-only model: the article is the centred paper card, so a
  // translateX fallback would slide the card off-centre. Repeated turns must
  // keep advancing the scrollLeft track without any transform.
  assert.equal(api.navigatePageGroup(1), true);
  assert.equal(article.scrollLeft, 2156);
  assert.equal(reader.scrollLeft, 0);
  assert.equal(article.style.transform, '');
});

test('paged CSS makes the multicol box itself the scroll container', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const section = css.slice(css.indexOf('Deterministic pagination geometry'));
  const articleRule = section.match(
    /body\.is-epub\.paged-reading \.reader \.article\s*\{([^}]*)\}/
  );
  assert.ok(articleRule, 'missing deterministic paged article rule');
  // overflow must not stay `visible`, otherwise the generated page columns
  // live only in paint overflow and page turning silently does nothing.
  assert.match(articleRule[1], /overflow-x: hidden/);
  assert.match(articleRule[1], /overflow-y: hidden/);
  assert.doesNotMatch(articleRule[1], /overflow: visible/);
});

test('page navigation controls use a stable surface during horizontal page turns', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const pageNavRule = css.match(
    /\.reader \.reader-page-nav-btn:not\(\[hidden\]\)\s*\{([^}]*)\}/
  );
  assert.ok(pageNavRule, 'missing page navigation control rule');
  assert.match(pageNavRule[1], /background:\s*var\(--color-bar\)/);
  assert.doesNotMatch(pageNavRule[1], /backdrop-filter/);
  assert.doesNotMatch(pageNavRule[1], /-webkit-backdrop-filter/);
});

test('paged chapter navigation advances exactly one chapter per click', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');

  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  article.scrollTo = ({ left }) => { article.scrollLeft = left; };

  const geometry = api.createPaginationGeometry({
    readerWidth: 1200,
    readerHeight: 800,
    mode: 'double',
    pageMargin: 40,
    columnGap: 84, // DEFAULT_PAGE_GAP, as measurePagination uses
    devicePixelRatio: 1
  });
  const pitch = geometry.columnWidth + geometry.columnGap;

  article.innerHTML = '';
  // Two chapters per spread, each starting on a fresh column. The article box
  // is the paper card, so the first column starts one inner padding in.
  const chapters = Array.from({ length: 12 }, (_, index) => {
    const chapter = window.document.createElement('section');
    chapter.className = 'epub-chapter';
    chapter.dataset.sourcePath = `OPS/chapter-${index + 1}.xhtml`;
    chapter.textContent = `chapter ${index + 1}`;
    chapter.getBoundingClientRect = () => {
      const left = geometry.insetLeft + geometry.columnPadding + index * 2 * pitch - article.scrollLeft;
      return { left, right: left + geometry.spreadWidth, top: 0, bottom: 800, width: geometry.spreadWidth, height: 800 };
    };
    article.appendChild(chapter);
    return chapter;
  });

  Object.defineProperty(article, 'scrollWidth', {
    configurable: true,
    get: () => geometry.columnPadding * 2 + pitch * chapters.length * 2 - geometry.columnGap
  });
  // The article is the scroll container: its own border box stays put and
  // only its children shift left by scrollLeft.
  article.getBoundingClientRect = () => ({
    left: geometry.insetLeft,
    right: geometry.insetLeft + geometry.paperWidth,
    top: 0,
    bottom: 800,
    width: geometry.paperWidth,
    height: 800
  });
  reader.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 0, bottom: 800, width: 1200, height: 800 });

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.readingMode = 'double';
  api.state.pageMargin = 40;
  api.state.chapterPaths = chapters.map((chapter) => chapter.dataset.sourcePath);

  api.measurePagination({ preserveLocator: false });
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  assert.equal(api.state.effectiveReadingMode, 'double');
  assert.equal(api.state.pageCount, chapters.length * 2);
  assert.equal(api.state.pageGroupCount, chapters.length);

  // Each "next chapter" click must land on the immediately following chapter.
  for (let expected = 1; expected < chapters.length; expected += 1) {
    assert.equal(api.navigateChapter(1), true, `click ${expected} should navigate`);
    assert.equal(
      api.state.pageGroup,
      expected,
      `chapter ${expected + 1} must not skip (group ${api.state.pageGroup})`
    );
    assert.equal(article.scrollLeft, expected * geometry.pageGroupWidth);
  }

  assert.equal(api.navigateChapter(1), false);

  // And backwards the same way, one chapter at a time.
  for (let expected = chapters.length - 2; expected >= 0; expected -= 1) {
    assert.equal(api.navigateChapter(-1), true);
    assert.equal(api.state.pageGroup, expected);
  }
  assert.equal(api.navigateChapter(-1), false);
});

test('five columns form three double-page groups and never expose a residual column', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');

  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(reader, 'clientHeight', { configurable: true, value: 800 });
  article.scrollTo = ({ left }) => { article.scrollLeft = left; };

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.readingMode = 'double';
  api.state.pageMargin = 40;

  const geometry = api.createPaginationGeometry({
    readerWidth: 1200,
    readerHeight: 800,
    mode: 'double',
    pageMargin: 40,
    columnGap: 84, // DEFAULT_PAGE_GAP, as measurePagination uses
    devicePixelRatio: 1
  });
  // Five columns: two outer paddings, five column boxes, four inter-column gaps.
  Object.defineProperty(article, 'scrollWidth', {
    configurable: true,
    get: () => geometry.columnPadding * 2 + geometry.columnWidth * 5 + geometry.columnGap * 4
  });

  api.measurePagination({ preserveLocator: false });
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  assert.equal(api.state.pageCount, 5);
  assert.equal(api.state.pageGroupCount, 3);
  assert.equal(api.state.pageGroupWidth, geometry.pageGroupWidth);

  assert.equal(api.navigatePageGroup(1), true);
  assert.equal(article.scrollLeft, geometry.pageGroupWidth);
  assert.equal(api.navigatePageGroup(1), true);
  assert.equal(article.scrollLeft, geometry.pageGroupWidth * 2);
  assert.equal(api.state.pageNumber, 5);
  assert.equal(api.navigatePageGroup(1), false);
  assert.equal(article.scrollLeft % api.state.pageGroupWidth, 0);
});

test('repeated page-group navigation has no cumulative drift and respects both boundaries', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');
  Object.defineProperty(reader, 'clientWidth', { configurable: true, value: 1001 });
  article.scrollTo = ({ left }) => { article.scrollLeft = left; };

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.effectiveReadingMode = 'double';
  api.state.pageCount = 21;
  api.state.pageGroupCount = 11;
  api.state.pageGroup = 0;
  api.state.pageNumber = 1;
  api.state.pageGroupWidth = 1001;

  assert.equal(api.navigatePageGroup(-1), false);
  for (let group = 1; group < 11; group += 1) {
    assert.equal(api.navigatePageGroup(1), true);
    assert.equal(article.scrollLeft, group * 1001);
    assert.equal(article.scrollLeft % 1001, 0);
  }
  assert.equal(api.navigatePageGroup(1), false);
  assert.equal(article.scrollLeft, 10010);

  for (let group = 9; group >= 0; group -= 1) {
    assert.equal(api.navigatePageGroup(-1), true);
    assert.equal(article.scrollLeft, group * 1001);
    assert.equal(article.scrollLeft % 1001, 0);
  }
  assert.equal(api.navigatePageGroup(-1), false);
  assert.equal(article.scrollLeft, 0);
});

test('pagination snapping rounds fractional scroll offsets to a complete spread without drift', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');
  article.scrollTo = ({ left, top = 0 }) => {
    article.scrollLeft = left;
    article.scrollTop = top;
  };

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.effectiveReadingMode = 'double';
  api.state.pageCount = 9;
  api.state.pageGroupCount = 5;
  api.state.pageGroupWidth = 1001;
  api.state.pageGroup = 0;
  api.state.pageNumber = 1;

  for (const [offset, expectedGroup] of [
    [499.49, 0],
    [500.51, 1],
    [1501.6, 2],
    [3499.4, 3],
    [999999, 4]
  ]) {
    // Free dragging does not exist, so the observed offset is the tracked one.
    api.state.pageOffset = offset;
    assert.equal(api.snapPaginationToNearestGroup({ save: false }), true);
    assert.equal(api.state.pageGroup, expectedGroup);
    assert.equal(article.scrollLeft, expectedGroup * 1001);
    assert.equal(article.scrollLeft % 1001, 0);
  }
});

test('semantic targets in paged mode align to the containing complete spread', async () => {
  const { window, api } = await createReaderDom();
  const reader = window.document.getElementById('reader');
  const article = window.document.getElementById('article');
  const target = window.document.createElement('p');
  article.innerHTML = '';
  article.appendChild(target);
  article.scrollTo = ({ left, top = 0 }) => {
    article.scrollLeft = left;
    article.scrollTop = top;
  };
  article.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 0, bottom: 800, width: 1200, height: 800 });
  target.getBoundingClientRect = () => ({ left: 1800, right: 1900, top: 40, bottom: 80, width: 100, height: 40 });

  api.state.contentType = 'epub';
  api.state.currentPath = null;
  api.state.effectiveReadingMode = 'double';
  api.state.columnWidth = 542;
  api.state.columnGap = 36;
  api.state.pageStepWidth = 578;
  api.state.pageGroupWidth = 1200;
  api.state.pageCount = 8;
  api.state.pageGroupCount = 4;
  api.state.pageGroup = 0;

  assert.equal(api.pageNumberForElement(target), 4);
  assert.equal(api.navigateToSemanticTarget(target), true);
  assert.equal(api.state.pageGroup, 1);
  assert.equal(api.state.pageNumber, 3);
  assert.equal(article.scrollLeft, 1200);
});

test('paged CSS uses a continuous fixed-width column track instead of limiting total column count', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const deterministicSection = css.slice(css.indexOf('Deterministic pagination geometry'));

  assert.match(deterministicSection, /column-width: var\(--reader-column-width\)/);
  assert.match(deterministicSection, /column-gap: var\(--reader-column-gap\)/);
  assert.match(deterministicSection, /column-fill: auto/);
  assert.match(deterministicSection, /contain: layout style/);
  assert.doesNotMatch(deterministicSection, /column-count:/);
  assert.match(deterministicSection, /overflow-x: hidden/);
  assert.match(deterministicSection, /break-inside: avoid-column/);
  // Regression guard: the legacy mid-file multicol rule (max-content +
  // padding-only columns, no spread geometry) must stay removed. Two
  // competing multicol rules is what produced extra visible columns and
  // half-page remainders on real devices.
  const legacyRule = /body\.paged-reading \.reader \.article\s*\{[^}]*width: max-content/s;
  assert.doesNotMatch(css, legacyRule);

  const articleRule = deterministicSection.match(
    /body\.is-epub\.paged-reading \.reader \.article\s*\{([^}]*)\}/
  );
  assert.ok(articleRule, 'missing deterministic paged article rule');

  // Root-cause guard: the article is now the paper card (capped width,
  // centre margins, inner text inset), so geometry must come from
  // --reader-paper-* and margin-inline:auto. The vertical inset is split into
  // top/bottom (84/70 WeChat rhythm) and the outer bands live on the reader.
  assert.match(articleRule[1], /padding-top: var\(--reader-paper-padding-top/);
  assert.match(articleRule[1], /padding-bottom: var\(--reader-paper-padding-bottom/);
  assert.match(articleRule[1], /padding-left: var\(--reader-paper-padding[, ]/);
  assert.match(articleRule[1], /padding-right: var\(--reader-paper-padding[, ]/);
  assert.doesNotMatch(articleRule[1], /--reader-horizontal-padding/);
  assert.match(articleRule[1], /width: var\(--reader-paper-width\)/);
  assert.match(articleRule[1], /margin-inline: auto/);
  assert.match(articleRule[1], /border-radius: 16px/);
  assert.match(articleRule[1], /box-shadow:/);
  assert.match(deterministicSection, /padding-left: var\(--reader-inset-left/);
  assert.match(deterministicSection, /padding-right: var\(--reader-inset-right/);
  assert.match(deterministicSection, /padding-top: var\(--reader-band-top/);
  assert.match(deterministicSection, /padding-bottom: var\(--reader-band-bottom/);
});

test('typography slider previews continuously and snaps to a common preset on commit', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const input = document.getElementById('settingParagraphSpacing');
  const field = input.closest('.settings-range-field');
  const output = document.getElementById('settingParagraphSpacingValue');
  api.typographyApi.setupSettingsPanel();

  assert.equal(output.hidden, true);
  input.value = '1.18';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(field.classList.contains('is-showing-value'), true);
  assert.equal(output.hidden, false);
  assert.equal(output.textContent, '1.18em');

  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(input.value, '1.25');
  assert.equal(output.textContent, '1.25em');
  assert.match(input.getAttribute('aria-valuetext'), /1\.25em/);
});

test('typography sliders render common preset ticks and restore recommended defaults', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.typographyApi.setupSettingsPanel();

  for (const key of ['paragraphSpacing', 'fontSize', 'lineHeight', 'pageMargin']) {
    const input = document.querySelector(`[data-typography-slider="${key}"]`);
    assert.equal(
      input.closest('.settings-range-track').querySelectorAll('.settings-range-tick').length,
      api.typographyApi.TYPOGRAPHY_SLIDER_CONFIG[key].presets.length
    );
  }

  document.querySelector('#settingTextIndent [data-text-indent="3"]').click();
  assert.equal(api.state.textIndent, 3);
  document.getElementById('settingPageMargin').value = '80';
  document.getElementById('settingPageMargin').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('btnResetTypography').click();

  assert.equal(document.getElementById('settingFontSize').value, '100');
  assert.equal(document.getElementById('settingLineHeight').value, '1.9');
  assert.equal(document.getElementById('settingPageMargin').value, '40');
  assert.equal(document.getElementById('settingTextIndent').dataset.value, '2');
  assert.equal(document.querySelector('#settingTextIndent [aria-checked="true"]').dataset.textIndent, '2');
  assert.equal(document.getElementById('settingParagraphSpacing').value, '1.1');
});

test('typography slider tooltip follows a common font preset and auto-hides after interaction', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.typographyApi.setupSettingsPanel();
  const input = document.getElementById('settingFontSize');
  const output = document.getElementById('settingFontSizeValue');

  input.value = '111';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(output.hidden, false);
  assert.equal(output.textContent, '20px');
  assert.match(input.getAttribute('aria-valuetext'), /20px/);

  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(input.value, '111');
  await new Promise((resolve) => setTimeout(resolve, 850));
  assert.equal(output.hidden, true);
});

test('AI index manager has an admin-only independent surface contract', async () => {
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  const drawer = await fs.readFile(path.resolve(__dirname, '../app/ui/shell/drawer.js'), 'utf8');
  const api = await fs.readFile(path.resolve(__dirname, '../app/ui/core/api.js'), 'utf8');
  const manager = await fs.readFile(path.resolve(__dirname, '../app/ui/reader/ai-index-manager.js'), 'utf8');
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');

  assert.match(html, /btnOpenAiIndexManager/);
  assert.match(html, /aiIndexManagerSheet/);
  assert.match(html, /class="ai-icon-button ai-surface-close[^"]*" id="btnCloseAiIndexManager"/);
  assert.match(html, /class="ai-icon-button ai-surface-close[^"]*" id="btnCloseAiModal"/);
  assert.match(html, /ai-index-manager\.js/);
  assert.match(drawer, /'ai-index': \{ rootId: 'aiIndexManagerSheet'/);
  assert.match(api, /listAiIndexes/);
  assert.match(api, /deleteAiIndex/);
  assert.match(api, /cleanupAiIndexes/);
  assert.match(manager, /state\.session\?\.isAdmin/);
  assert.match(manager, /readerSurfaceController\.activate\('ai-index'/);
  assert.match(manager, /window\.confirm/);
  assert.match(manager, /indexedAtSource/);
  assert.match(manager, /更新于/);
  assert.match(manager, /更新时间未知/);
  assert.match(manager, /索引清单缺少建立记录/);
  assert.match(css, /\.ai-index-manager-sheet/);
  assert.match(css, /\.ai-index-manager-backdrop/);
  assert.match(css, /\.settings-header \.ai-surface-close::before\s*\{\s*content:\s*none/);
  assert.match(css, /\.ai-index-manager-sheet\s*\{[^}]*width:\s*min\(400px/s);
  assert.match(css, /\.ai-index-manager-list\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.ai-index-manager-list\s*\{[^}]*align-content:\s*(?:start|flex-start)/s);
  assert.match(css, /\.ai-index-manager-status\[data-status="normal"\]/);
});

test('PDF render scheduler loads before the PDF reader controller', async () => {
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  const schedulerIndex = html.indexOf('reader/pdf-render-scheduler.js');
  const readerIndex = html.indexOf('reader/pdf.js');

  assert.ok(schedulerIndex >= 0, 'PDF render scheduler script must be present');
  assert.ok(readerIndex > schedulerIndex, 'PDF reader must load after its scheduler');
});

function importOrganization(books, collections = []) {
  return {
    version: 1, revision: 3, collections, collectionOrders: Object.fromEntries(collections.map((item) => [item.id, []])),
    allBookOrder: books.map((book) => book.id), unassignedOrder: books.map((book) => book.id), bookAssignments: {}, books
  };
}

test('the import button appears only for admins with import enabled, in the agreed toolbar positions', async () => {
  const { window, api } = await createReaderDom();
  const book = { id: 'a'.repeat(64), title: '一本书', type: 'txt' };
  const labels = () => [...window.document.querySelectorAll('.library-header-actions button')].map((button) => button.textContent);

  api.renderLibrary({ books: [book], features: { libraryOrganization: true }, organization: importOrganization([book]) });
  assert.deepEqual(labels(), ['新建分类', '重新扫描', '整理'], 'unchanged without the feature');

  api.renderLibrary({ books: [book], features: { libraryOrganization: true, bookImport: true }, organization: importOrganization([book]) });
  assert.deepEqual(labels(), ['新建分类', '导入', '重新扫描', '整理']);
  assert.equal(window.document.querySelector('.library-view').dataset.importDrop, 'true');

  const collectionId = '11111111-1111-4111-8111-111111111111';
  window.history.replaceState({ libraryOrganization: { mode: 'collection', collectionId } }, '');
  api.renderLibrary({
    books: [book], features: { libraryOrganization: true, bookImport: true },
    organization: importOrganization([book], [{ id: collectionId, name: '小说' }])
  });
  assert.deepEqual(labels(), ['重新扫描', '添加书籍', '导入', '整理']);

  window.history.replaceState({}, '');
  api.renderLibrary({ books: [book], features: { libraryOrganization: false, bookImport: true } });
  assert.deepEqual(labels(), ['导入', '重新扫描'], 'flat shelf');
  await window.happyDOM.close();
});

test('the import queue prechecks files, uploads one at a time and reports each outcome', async () => {
  const { window, api } = await createReaderDom();
  const { enqueueLibraryImports, libraryImportQueue } = window.__zhenshuImportApi;
  const book = { id: 'a'.repeat(64), title: '已有', type: 'txt' };
  api.renderLibrary({ books: [book], features: { libraryOrganization: false, bookImport: true } });

  const uploads = [];
  window.browserHost.importBook = (file, { onProgress }) => {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    uploads.push({ file, onProgress, resolve, reject });
    return { promise, abort: () => reject(Object.assign(new Error('已取消'), { code: 'IMPORT_CANCELLED' })) };
  };
  window.browserHost.getLibrary = async () => ({ books: [book], features: { libraryOrganization: false, bookImport: true } });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  enqueueLibraryImports([
    new window.File(['x'], 'virus.exe'),
    new window.File(['a'], '第一本.epub'),
    new window.File(['b'], '第二本.epub'),
    new window.File(['c'], '第三本.epub')
  ]);
  await tick();
  const rows = () => [...window.document.querySelectorAll('.library-import-item')];
  assert.equal(rows()[0].dataset.status, 'rejected');
  assert.match(rows()[0].textContent, /只支持 EPUB/);
  assert.equal(uploads.length, 1, 'uploads run one at a time');

  uploads[0].onProgress(0.5);
  assert.match(rows()[1].textContent, /正在上传 50%/);
  assert.equal(rows()[1].querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '50');
  uploads[0].resolve({ book: { id: 'b'.repeat(64), title: '第一本' }, name: '第一本 (2).epub' });
  await tick(); await tick(); await tick();
  assert.equal(rows()[1].dataset.status, 'done');
  assert.match(rows()[1].textContent, /已保存为“第一本 \(2\)\.epub”/);
  assert.equal(uploads.length, 2);

  uploads[1].reject(Object.assign(new Error('书库中已有这本书。'), { code: 'IMPORT_DUPLICATE', details: { bookId: 'c'.repeat(64) } }));
  await tick(); await tick();
  assert.equal(rows()[2].dataset.status, 'duplicate');
  assert.equal(rows()[2].querySelector('.library-import-action').textContent, '打开');

  rows()[3].querySelector('.library-import-action').click();
  await tick(); await tick();
  assert.equal(rows()[3].dataset.status, 'cancelled');
  assert.match(window.document.querySelector('.library-import-summary').textContent, /已导入 1 本，3 个未导入/);
  assert.equal(window.document.querySelector('.library-import-close').disabled, false);
  window.document.querySelector('.library-import-close').click();
  assert.equal(window.document.getElementById('libraryImportPanel').hidden, true);
  assert.equal(libraryImportQueue.length, 0);
  await window.happyDOM.close();
});

test('imports started inside a collection are filed into it, and dropped files join the queue', async () => {
  const { window, api } = await createReaderDom();
  const collectionId = '11111111-1111-4111-8111-111111111111';
  const book = { id: 'a'.repeat(64), title: '已有', type: 'txt' };
  window.history.replaceState({ libraryOrganization: { mode: 'collection', collectionId } }, '');
  const library = { books: [book], features: { libraryOrganization: true, bookImport: true }, organization: importOrganization([book], [{ id: collectionId, name: '小说' }]) };
  api.renderLibrary(library);

  const placed = [];
  window.browserHost.importBook = () => ({ promise: Promise.resolve({ book: { id: 'd'.repeat(64), title: '新书' }, name: '新书.epub' }), abort() {} });
  window.browserHost.getLibraryOrganization = async () => ({ ...library.organization, revision: 7 });
  window.browserHost.placeLibraryBook = async (...args) => { placed.push(args); return library.organization; };
  window.browserHost.getLibrary = async () => library;

  const shell = window.document.querySelector('.library-view');
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new window.File(['n'], '新书.epub')] } });
  shell.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true, 'the browser never navigates to the dropped file');
  for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(placed, [['d'.repeat(64), collectionId, null, 7]]);
  assert.match(window.document.querySelector('.library-import-item').textContent, /已放入当前分类/);
  window.history.replaceState({}, '');
  await window.happyDOM.close();
});

test('organize mode renames a book through a dialog and keeps controls on one row', async () => {
  const { window, api } = await createReaderDom();
  const first = { id: 'a'.repeat(64), title: '第一本', type: 'txt', relativePath: 'one.txt' };
  const second = { id: 'b'.repeat(64), title: '第二本', type: 'txt', relativePath: 'two.txt' };
  const organization = {
    version: 1, revision: 4, updatedAt: null, preferences: { viewMode: 'flat' },
    collections: [], collectionOrders: {}, unassignedOrder: [first.id, second.id],
    allBookOrder: [first.id, second.id], bookAssignments: {}, bookTitles: {}, orphanedBookIds: [],
    books: [first, second]
  };
  const calls = [];
  window.browserHost.renameLibraryBook = async (bookId, title, revision) => {
    calls.push({ bookId, title, revision });
    const renamed = { ...first, title, originalTitle: first.title };
    return { ...organization, revision: revision + 1, bookTitles: { [bookId]: title }, books: [renamed, second] };
  };
  const library = { books: [{ ...first }, { ...second }], features: { libraryOrganization: true }, organization };
  api.renderLibrary(library);
  window.document.querySelector('.library-mode-button').click();

  const controls = window.document.querySelectorAll('.library-grid .library-book-manage-controls');
  assert.equal(controls.length, 2);
  assert.ok(controls[0].querySelector('select.library-book-collection-select'));
  const rename = controls[0].querySelector('button.library-book-rename');
  assert.match(rename.getAttribute('aria-label'), /重命名：第一本/);

  rename.click();
  const dialog = window.document.querySelector('.library-rename-dialog');
  assert.ok(dialog);
  const input = dialog.querySelector('input');
  assert.equal(input.value, '第一本');
  assert.equal(dialog.querySelector('.library-rename-reset').hidden, true);
  input.value = '  改过的  名字 ';
  dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.deepEqual(calls, [{ bookId: first.id, title: '改过的 名字', revision: 4 }]);
  assert.equal(window.document.querySelector('.library-rename-dialog'), null);
  assert.equal(window.document.querySelector('.library-grid .library-book-metadata strong').textContent, '改过的 名字');
  // The shared book list (继续阅读, reader title) follows the new name.
  assert.equal(library.books[0].title, '改过的 名字');
  assert.equal(library.books[0].originalTitle, '第一本');
  await window.happyDOM.close();
});

test('the 导读 sheet shows the estimate, starts generation and is available for PDF', async () => {
  const { window, api } = await createReaderDom();
  const bookId = '7'.repeat(64);
  const calls = [];
  const none = {
    state: 'none',
    progress: { done: 0, total: 9 },
    estimate: { calls: 9, inputTokens: 44000, outputTokens: 3150, sampled: false },
    fullEstimate: { calls: 9, inputTokens: 44000, outputTokens: 3150 },
    vectors: { state: 'none', automatic: false, estimateTokens: 30000, progress: { done: 0, total: 80 } },
    book: null,
    nodes: [
      { id: 'c1', label: '第一章 初到云岭', depth: 0, anchor: { chapterIndex: 0 } },
      { id: 'c1s1', label: '一、搬进山里', depth: 1, anchor: { chapterIndex: 0 } }
    ]
  };
  window.browserHost = {
    aiStatus: async () => ({ configured: true, model: 'test-model' }),
    getAiConversations: async () => ({ conversations: [] }),
    getAiBookMap: async (id) => { calls.push(['status', id]); return none; },
    generateAiBookMap: async (id, options) => {
      calls.push(['generate', id, options]);
      return { ...none, state: 'running', progress: { done: 1, total: 9 } };
    },
    cancelAiBookMap: async (id) => { calls.push(['cancel', id]); return none; },
    buildAiVectors: async (id) => { calls.push(['vectors', id]); return { state: 'running' }; }
  };
  api.state.contentType = 'epub';
  api.state.currentBookId = bookId;
  api.aiApi.setupAiPanel();
  await api.aiApi.openAiModal(null, window.document.body);
  const button = window.document.getElementById('btnAiBookMap');
  assert.equal(button.hidden, false);
  button.click();
  await waitFor(() => window.document.querySelectorAll('.ai-book-map-node').length === 2, '导读 outline did not render');
  assert.match(window.document.getElementById('aiBookMapStatus').textContent, /约 4\.7 万 tokens，9 次调用/);
  assert.equal(window.document.getElementById('aiBookMapVectors').hidden, false);
  assert.match(window.document.getElementById('aiBookMapVectorsText').textContent, /需要手动建立（约 3\.0 万 tokens）/);
  window.document.getElementById('btnBuildAiVectors').click();
  await waitFor(() => calls.some(([kind]) => kind === 'vectors'), 'semantic index build did not start');
  const generate = window.document.getElementById('btnGenerateAiBookMap');
  assert.equal(generate.textContent, '生成导读');
  assert.equal(window.document.querySelector('.ai-book-map-node[data-depth="1"]') !== null, true);
  generate.click();
  await waitFor(() => calls.some(([kind]) => kind === 'generate'), 'generation did not start');
  assert.equal(JSON.stringify(calls.find(([kind]) => kind === 'generate')), JSON.stringify(['generate', bookId, { force: false }]));
  await waitFor(() => window.document.getElementById('btnCancelAiBookMap').hidden === false, 'stop button did not appear');
  assert.equal(window.document.getElementById('aiBookMapProgress').hidden, false);
  api.aiApi.closeAiBookMapSheet({ restoreFocus: false });
  assert.equal(window.document.getElementById('aiBookMapView').hidden, true);
  api.aiApi.closeAiModal({ restoreFocus: false });

  api.state.contentType = 'pdf';
  window.pdfReaderController = { getPageCount: () => 3 };
  await api.aiApi.openAiModal(null, window.document.body);
  // PDFs have a 导读 too (from bookmarks, headings or page groups).
  assert.equal(window.document.getElementById('btnAiBookMap').hidden, false);
  await window.happyDOM.close();
});

test('phone pagination runs edge to edge with a text inset from the margin slider', async () => {
  const { api } = await createReaderDom();
  const phone = api.createPaginationGeometry({
    readerWidth: 390, readerHeight: 780, mode: 'double', pageMargin: 40, devicePixelRatio: 3, phone: true
  });
  assert.equal(phone.columns, 1);
  assert.equal(phone.insetLeft, 0);
  assert.equal(phone.insetRight, 0);
  assert.equal(phone.bandTop, 0);
  assert.equal(phone.columnPadding, 20);
  assert.equal(phone.columnWidth, 350);
  // The next page starts exactly one column plus gap later, and the gap
  // covers both text insets so no neighbouring column shows.
  assert.equal(phone.pageGroupWidth, phone.columnWidth + phone.columnGap);
  assert.ok(phone.columnGap >= phone.columnPadding * 2);

  const wide = api.createPaginationGeometry({
    readerWidth: 390, readerHeight: 780, mode: 'double', pageMargin: 96, devicePixelRatio: 3, phone: true
  });
  assert.equal(wide.columnPadding, 48);
  const desktop = api.createPaginationGeometry({
    readerWidth: 390, readerHeight: 780, mode: 'single', pageMargin: 40, devicePixelRatio: 3
  });
  assert.ok(desktop.insetLeft > 0);
});

test('admins see which library folders were read, with counts and unreadable items', async () => {
  const { api } = await createReaderDom();
  const panel = api.createLibraryFoldersPanel({
    folders: {
      scanned: [
        { root: '/vol1/@appshare/zhenshu/library', bookCount: 0, skippedCount: 0, skipped: [] },
        { root: '/vol1/书', bookCount: 12, skippedCount: 2, skipped: [{ path: '私密', code: 'EACCES' }, { path: '旧/坏.txt', code: 'EIO' }] }
      ],
      unavailable: [{ root: '/vol2/不在了', code: 'ENOENT', error: 'ENOENT: no such file or directory' }]
    }
  }, { empty: true });
  const text = panel.textContent;
  assert.match(text, /\/vol1\/@appshare\/zhenshu\/library0 本/);
  assert.match(text, /12 本，2 项无法读取/);
  assert.match(text, /无法打开：文件夹不存在/);
  assert.match(text, /无法读取的子文件夹或文件（2）/);
  assert.match(text, /私密 — 没有读取权限/);
  assert.match(text, /旧\/坏\.txt — 磁盘读取出错/);
  assert.match(text, /然后点“重新扫描”/);

  // A healthy library shows nothing; non-admins never get folder data.
  assert.equal(api.createLibraryFoldersPanel({ folders: { scanned: [{ root: '/a', bookCount: 3, skippedCount: 0, skipped: [] }], unavailable: [] } }), null);
  assert.equal(api.createLibraryFoldersPanel({ books: [] }, { empty: true }), null);
  // No folder at all: say how to add one.
  assert.match(api.createLibraryFoldersPanel({ folders: { scanned: [], unavailable: [] } }, { empty: true }).textContent, /zhenshu\/library/);
});

test('book cards show the author only; a book without one shows no format in its place', async () => {
  const { window, api } = await createReaderDom();
  const pdf = { id: 'c'.repeat(64), title: '论文', type: 'pdf' };
  const epub = { id: 'd'.repeat(64), title: '剑来', author: '烽火戏诸侯', type: 'epub' };
  api.renderLibrary({ books: [pdf, epub], features: { libraryOrganization: false } });
  const detail = (id) => window.document.querySelector(`.library-book[data-book-id="${id}"] .library-book-detail`);
  assert.equal(detail(pdf.id), null);
  assert.equal(detail(epub.id).textContent, '烽火戏诸侯');
  await window.happyDOM.close();
});
