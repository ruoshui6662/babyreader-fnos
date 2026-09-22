'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

async function createReaderDom() {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/babyreader-fnos/' });
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  const sourceFiles = [
    '../app/ui/core/state.js',
    '../app/ui/core/utils.js',
    '../app/ui/core/api.js',
    '../app/ui/core/reader-route.js',
    '../app/ui/core/user-state.js',
    '../app/ui/reader/device-profile.js',
    '../app/ui/reader/epub.js',
    '../app/ui/reader/document.js',
    '../app/ui/reader/editor.js',
    '../app/ui/reader/highlights.js',
    '../app/ui/reader/ai.js',
    '../app/ui/reader/selection-menu.js',
    '../app/ui/reader/actions.js',
    '../app/ui/reader/notes-panel.js',
    '../app/ui/reader/progress.js',
    '../app/ui/reader/bookmarks.js',
    '../app/ui/reader/pagination.js',
    '../app/ui/reader/settings.js',
    '../app/ui/reader/navigation.js',
    '../app/ui/reader/lifecycle.js',
    '../app/ui/reader/search.js',
    '../app/ui/shell/drawer.js',
    '../app/ui/library/view.js',
    '../app/ui/app.js'
  ];
  let source = (await Promise.all(
    sourceFiles.map((relative) => fs.readFile(path.resolve(__dirname, relative), 'utf8'))
  )).join('\n');
  source += '\nwindow.__babyReaderChapterApi = { renderEpubChapter, navigateToEpubChapter, isEpubChapterLoading, updateReadingProgress, restoreTextScroll, navigateEpubTarget, setupTocNavigation };\nwindow.__babyReaderDeviceApi = { getReaderDeviceProfile, setMobileChromeOpen, setupReaderNavigation };';
  source += '\nwindow.__babyReaderTypographyApi = { TYPOGRAPHY_SLIDER_CONFIG, nearestTypographyPreset, formatTypographySliderValue, setupTypographySlider, setupSettingsPanel, resetTypographySettings };';
  source += '\nwindow.__babyReaderUserStateApi = { applyUserState, persistUserSettings, flushUserSettings, currentUserSettings };';
  source += '\nwindow.__babyReaderActionsApi = { formatHighlightsMd };';
  source += '\nwindow.__babyReaderEpubApi = { parseNavToc, parseNcxToc };';
  source += '\nwindow.__babyReaderBookmarkApi = { getCurrentBookmarkLocator, isCurrentBookmark, toggleCurrentBookmark, jumpToBookmark, renderBookmarkButtonState, renderBookmarkList, deleteBookmarkFromList, refreshBookmarks };';
  source += '\nwindow.__babyReaderSearchApi = { updateTopbarState, setupReaderSearch };';
  source += '\nwindow.__babyReaderRouteApi = { restoreReaderFromLocation };';

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

  window.eval(`${source}\nwindow.__babyReaderTest = {\n    state,\n    serializeDomRange,\n    rangeFromHighlight,\n    loadHighlights,\n    openHighlightEditor,\n    deleteActiveHighlight,\n    saveActiveHighlightEdits,\n    currentUserSettings,\n    applyZoom,\n    getEpubThemeCss,\n    debounce,\n    navigateChapter,\n    navigatePageGroup,\n    pageGroupForPage,\n    clampPageGroup,\n    pageLeftForGroup,\n    setPageGroup,\n    snapPaginationToNearestGroup,\n    pageNumberForElement,\n    navigateToSemanticTarget,\n    resolveEffectiveReadingMode,\n    createPaginationGeometry,\n    measurePagination,\n    setReadingMode,\n    currentReadingLocator,\n    restoreReadingLocator,\n    readerActions,\n    readerPanels,\n    openReaderPanel,\n    closeReaderPanel,\n    setupReaderActionMapping,\n    renderToc,\n    returnToLibrary\n  };`);

  window.__babyReaderTest.updateTopbarState = window.__babyReaderSearchApi.updateTopbarState;
  window.__babyReaderTest.restoreReaderFromLocation = window.__babyReaderRouteApi.restoreReaderFromLocation;
  window.__babyReaderTest.setupReaderSearch = window.__babyReaderSearchApi.setupReaderSearch;
  window.__babyReaderTest.readerSurfaceController = window.readerSurfaceController;
  window.__babyReaderTest.readerSearchContract = window.readerSearchContract;
  window.__babyReaderTest.buildReaderSearchUrl = window.buildReaderSearchUrl;
  window.__babyReaderTest.navigateToSearchResult = window.readerSearchApi.navigateToSearchResult;
  window.__babyReaderTest.formatHighlightsMd = window.__babyReaderActionsApi.formatHighlightsMd;
  window.__babyReaderTest.typographyApi = window.__babyReaderTypographyApi;
  window.__babyReaderTest.parseNavToc = window.__babyReaderEpubApi.parseNavToc;
  window.__babyReaderTest.parseNcxToc = window.__babyReaderEpubApi.parseNcxToc;
  window.__babyReaderTest.aiApi = window.__babyReaderAiApi;
  window.__babyReaderTest.renderEpubChapter = window.__babyReaderChapterApi.renderEpubChapter;
  window.__babyReaderTest.navigateToEpubChapter = window.__babyReaderChapterApi.navigateToEpubChapter;
  window.__babyReaderTest.isEpubChapterLoading = window.__babyReaderChapterApi.isEpubChapterLoading;
  window.__babyReaderTest.updateReadingProgress = window.__babyReaderChapterApi.updateReadingProgress;
  window.__babyReaderTest.restoreTextScroll = window.__babyReaderChapterApi.restoreTextScroll;
  window.__babyReaderTest.navigateEpubTarget = window.__babyReaderChapterApi.navigateEpubTarget;
  window.__babyReaderTest.setupTocNavigation = window.__babyReaderChapterApi.setupTocNavigation;
  window.__babyReaderTest.applyUserState = window.__babyReaderUserStateApi.applyUserState;
  window.__babyReaderTest.userStateApi = window.__babyReaderUserStateApi;
  window.__babyReaderTest.getReaderDeviceProfile = window.__babyReaderDeviceApi.getReaderDeviceProfile;
  window.__babyReaderTest.setMobileChromeOpen = window.__babyReaderDeviceApi.setMobileChromeOpen;
  window.__babyReaderTest.setupReaderNavigation = window.__babyReaderDeviceApi.setupReaderNavigation;
  window.__babyReaderTest.captureSelectionSession = window.__babyReaderSelectionMenuApi.captureSelectionSession;
  window.__babyReaderTest.setupSelectionMenu = window.__babyReaderSelectionMenuApi.setupSelectionMenu;
  window.__babyReaderTest.showSelectionMenuForCurrentSelection = window.__babyReaderSelectionMenuApi.showSelectionMenuForCurrentSelection;
  window.__babyReaderTest.closeSelectionMenu = window.__babyReaderSelectionMenuApi.closeSelectionMenu;
  window.__babyReaderTest.renderNotesPanel = window.__babyReaderNotesPanelApi.renderNotesPanel;
  window.__babyReaderTest.setupNotesPanel = window.__babyReaderNotesPanelApi.setupNotesPanel;
  window.__babyReaderTest.navigateToAnnotation = window.__babyReaderNotesPanelApi.navigateToAnnotation;
  window.__babyReaderTest.getCurrentBookmarkLocator = window.__babyReaderBookmarkApi.getCurrentBookmarkLocator;
  window.__babyReaderTest.isCurrentBookmark = window.__babyReaderBookmarkApi.isCurrentBookmark;
  window.__babyReaderTest.toggleCurrentBookmark = window.__babyReaderBookmarkApi.toggleCurrentBookmark;
  window.__babyReaderTest.jumpToBookmark = window.__babyReaderBookmarkApi.jumpToBookmark;
  window.__babyReaderTest.renderBookmarkButtonState = window.__babyReaderBookmarkApi.renderBookmarkButtonState;
  window.__babyReaderTest.renderBookmarkList = window.__babyReaderBookmarkApi.renderBookmarkList;
  window.__babyReaderTest.deleteBookmarkFromList = window.__babyReaderBookmarkApi.deleteBookmarkFromList;
  window.__babyReaderTest.refreshBookmarks = window.__babyReaderBookmarkApi.refreshBookmarks;
  return { window, api: window.__babyReaderTest };
}

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
  assert.equal(article.querySelectorAll('.epub-chapter').length, 1);
  assert.equal(article.textContent, 'third chapter');

  chapterTwo.resolve('<body><p>second chapter</p></body>');
  assert.equal(await secondRequest, false);
  assert.equal(api.state.epubChapterIndex, 2);
  assert.equal(article.querySelectorAll('.epub-chapter').length, 1);
  assert.equal(article.textContent, 'third chapter');
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
    () => fileName.textContent === '无法跳转：chapter-2.xhtml#missing（来源：OPS/chapter-1.xhtml）',
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

test('selection session opens a bounded six-action menu and rejects outside selections', async () => {
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
  assert.equal(menu.querySelectorAll('[data-selection-action]').length, 6);
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
  assert.match(bookmarkControl.getAttribute('aria-label'), /书签仅支持 EPUB/);
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

test('search result navigation locates text in the current document safely', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  api.state.currentBookId = 'search-book';
  api.state.currentPath = 'search-book.txt';
  api.state.contentType = 'text';
  document.getElementById('article').innerHTML = '<p>这是可定位的蛋白质内容。</p>';

  const navigated = await api.navigateToSearchResult({
    chapterIndex: 0,
    matchText: '蛋白质',
    locator: { text: '蛋白质' }
  });

  assert.equal(navigated, true);
  assert.equal(document.querySelector('.reader-search-target')?.dataset.scrolledIntoView, 'true');
});

test('search jump feedback uses a soft highlight instead of a blue outline', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  const targetRule = css.match(/\.reader-search-target\s*\{([^}]*)\}/s)?.[1] || '';
  assert.match(targetRule, /background(?:-color)?:/);
  assert.match(targetRule, /animation:/);
  assert.doesNotMatch(targetRule, /outline:/);
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

test('text documents keep the shared desktop and mobile return-to-library entry', async () => {
  const { window, api } = await createReaderDom();
  api.state.contentType = 'text';
  api.state.currentBookId = 'a'.repeat(64);
  api.state.currentPath = 'library/notes.md';

  api.updateTopbarState();

  assert.equal(window.document.getElementById('btnBackToLibrary').hidden, false);
  assert.equal(window.document.getElementById('btnMobileBackToLibrary').disabled, false);

  api.state.currentPath = '';
  api.updateTopbarState();
  assert.equal(window.document.getElementById('btnBackToLibrary').hidden, true);
  assert.equal(window.document.getElementById('btnMobileBackToLibrary').disabled, true);
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

  assert.equal(document.getElementById('mobileReaderChromeToggle')?.getAttribute('aria-label'), '显示阅读工具');
  assert.deepEqual(
    [...toolbar.querySelectorAll('button')].map((button) => button.dataset.readerAction),
    ['backToLibrary', 'openToc', 'openBookmarks', 'openSearch', 'openNotes', 'highlight', 'openSettings']
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
  assert.equal(toolbar.hidden, false);
  api.setMobileChromeOpen(false);
  assert.equal(document.body.dataset.mobileChrome, 'closed');
  assert.equal(toolbar.hidden, true);
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

test('mobile devices default to continuous reading without overwriting the desktop preference', async () => {
  const mobile = await createReaderDom();
  mobile.window.document.documentElement.dataset.readerSurface = 'mobile';
  mobile.api.applyUserState({ settings: { readingMode: 'double', continuousScroll: false }, books: {} });

  assert.equal(mobile.api.state.readingMode, 'scroll');
  assert.equal(mobile.api.state.effectiveReadingMode, 'scroll');
  assert.equal(mobile.api.currentUserSettings().readingMode, 'double');

  const legacyMobile = await createReaderDom();
  legacyMobile.window.document.documentElement.dataset.readerSurface = 'mobile';
  legacyMobile.api.applyUserState({ settings: { continuousScroll: false }, books: {} });
  assert.equal(legacyMobile.api.state.readingMode, 'scroll');
  assert.equal(legacyMobile.api.currentUserSettings().readingMode, 'double');

  const desktop = await createReaderDom();
  desktop.window.document.documentElement.dataset.readerSurface = 'desktop';
  desktop.api.applyUserState({ settings: { readingMode: 'double', continuousScroll: false }, books: {} });
  assert.equal(desktop.api.state.readingMode, 'double');
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

test('bookmark toolbar, Drawer list, and mobile entry are enabled only for EPUB', async () => {
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
  const mobileButton = document.getElementById('btnMobileBookmarks');
  assert.equal(desktopButton.disabled, false);
  assert.equal(desktopButton.dataset.readerStatus, undefined);
  assert.equal(api.readerPanels.bookmarks.enabled(), true);
  assert.ok(mobileButton);
  assert.equal(mobileButton.disabled, false);

  api.renderBookmarkList();
  assert.equal(document.querySelectorAll('#bookmarkList [data-bookmark-id]').length, 1);
  assert.equal(document.getElementById('bookmarkEmptyState').hidden, true);

  assert.equal(api.readerActions.openBookmarks(mobileButton), true);
  assert.equal(document.getElementById('readerPanelBookmarks').hidden, false);
  assert.equal(document.querySelectorAll('[data-reader-panel-name]:not([hidden])').length, 1);

  api.state.contentType = 'text';
  api.renderToc();
  assert.equal(desktopButton.disabled, true);
  assert.equal(mobileButton.disabled, true);
  assert.equal(api.readerPanels.bookmarks.enabled(), false);
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
  // pageMargin 40 maps onto the measured WeChat inner inset of 70px.
  assert.equal(single.columnPadding, 70);
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
  assert.equal(double.columnGap, Math.max(70, 36));
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
  // Expanded reading surface: 800 - 56 (top band) - 40 (bottom breath) = 704 card,
  // minus 64 / 56 of inner block padding.
  assert.equal(desktop.bandTop, 56);
  assert.equal(desktop.bandBottom, 40);
  assert.equal(desktop.padTop, 64);
  assert.equal(desktop.padBottom, 56);
  assert.equal(desktop.pageHeight, 704 - 64 - 56);
  assert.equal(desktop.columns, 2);
  assert.equal(desktop.columnGap, 98);
  assert.equal(desktop.columnPadding, 96);
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
  // Expanded compact viewport: 600 - 56 (top) - 40 (bottom) = 504 card, pad 64/56 → 384 column.
  assert.equal(compact.pageHeight, 384);
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
    columnGap: 98,
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
    columnGap: 98,
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

  for (const key of ['textIndent', 'paragraphSpacing', 'fontSize', 'lineHeight', 'pageMargin']) {
    const input = document.querySelector(`[data-typography-slider="${key}"]`);
    assert.equal(
      input.closest('.settings-range-track').querySelectorAll('.settings-range-tick').length,
      api.typographyApi.TYPOGRAPHY_SLIDER_CONFIG[key].presets.length
    );
  }

  document.getElementById('settingTextIndent').value = '3';
  document.getElementById('settingTextIndent').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('settingPageMargin').value = '80';
  document.getElementById('settingPageMargin').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('btnResetTypography').click();

  assert.equal(document.getElementById('settingFontSize').value, '100');
  assert.equal(document.getElementById('settingLineHeight').value, '1.9');
  assert.equal(document.getElementById('settingPageMargin').value, '40');
  assert.equal(document.getElementById('settingTextIndent').value, '2');
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
  assert.match(html, /class="ai-icon-button ai-surface-close" id="btnCloseAiIndexManager"/);
  assert.match(html, /class="ai-icon-button ai-surface-close" id="btnCloseAiModal"/);
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
