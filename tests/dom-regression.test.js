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
    '../app/ui/core/user-state.js',
    '../app/ui/reader/device-profile.js',
    '../app/ui/reader/epub.js',
    '../app/ui/reader/document.js',
    '../app/ui/reader/editor.js',
    '../app/ui/reader/highlights.js',
    '../app/ui/reader/actions.js',
    '../app/ui/reader/progress.js',
    '../app/ui/reader/pagination.js',
    '../app/ui/reader/settings.js',
    '../app/ui/reader/navigation.js',
    '../app/ui/reader/lifecycle.js',
    '../app/ui/shell/drawer.js',
    '../app/ui/library/view.js',
    '../app/ui/app.js'
  ];
  let source = (await Promise.all(
    sourceFiles.map((relative) => fs.readFile(path.resolve(__dirname, relative), 'utf8'))
  )).join('\n');
  source += '\nwindow.__babyReaderChapterApi = { renderEpubChapter, navigateToEpubChapter, isEpubChapterLoading, updateReadingProgress, restoreTextScroll, navigateEpubTarget, setupTocNavigation };\nwindow.__babyReaderDeviceApi = { getReaderDeviceProfile, setMobileChromeOpen, setupReaderNavigation };';
  source += '\nwindow.__babyReaderUserStateApi = { applyUserState };';

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

  window.__babyReaderTest.renderEpubChapter = window.__babyReaderChapterApi.renderEpubChapter;
  window.__babyReaderTest.navigateToEpubChapter = window.__babyReaderChapterApi.navigateToEpubChapter;
  window.__babyReaderTest.isEpubChapterLoading = window.__babyReaderChapterApi.isEpubChapterLoading;
  window.__babyReaderTest.updateReadingProgress = window.__babyReaderChapterApi.updateReadingProgress;
  window.__babyReaderTest.restoreTextScroll = window.__babyReaderChapterApi.restoreTextScroll;
  window.__babyReaderTest.navigateEpubTarget = window.__babyReaderChapterApi.navigateEpubTarget;
  window.__babyReaderTest.setupTocNavigation = window.__babyReaderChapterApi.setupTocNavigation;
  window.__babyReaderTest.applyUserState = window.__babyReaderUserStateApi.applyUserState;
  window.__babyReaderTest.getReaderDeviceProfile = window.__babyReaderDeviceApi.getReaderDeviceProfile;
  window.__babyReaderTest.setMobileChromeOpen = window.__babyReaderDeviceApi.setMobileChromeOpen;
  window.__babyReaderTest.setupReaderNavigation = window.__babyReaderDeviceApi.setupReaderNavigation;
  return { window, api: window.__babyReaderTest };
}

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

test('highlight color and note edits retain locator metadata during server persistence', async () => {
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
  window.document.getElementById('highlightEditorNote').value = '精确备注';
  await api.saveActiveHighlightEdits();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, 'edit-me');
  assert.equal(persisted[0].locator, 'locator-edit');
  assert.equal(persisted[0].chapterHref, 'OPS/chapter.xhtml');
  assert.equal(persisted[0].contextBefore, 'alpha ');
  assert.equal(persisted[0].contextAfter, ' middle');
  assert.equal(persisted[0].color, 'pink');
  assert.equal(persisted[0].note, '精确备注');
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

  for (const id of ['btnSearch', 'btnBookmarks', 'btnNotes', 'btnAi']) {
    const control = document.getElementById(id);
    assert.ok(control);
    assert.equal(control.disabled, true);
    assert.equal(control.dataset.readerStatus, 'reserved');
    assert.match(control.getAttribute('aria-label'), /预留功能，当前不可用/);
    // Icon-only: no text label, accessible name comes from aria-label.
    assert.equal(control.textContent.trim(), '');
  }
  // Settings button is icon-only too.
  assert.equal(document.getElementById('btnSettings').textContent.trim(), '');

  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');
  assert.match(css, /body\.is-epub \.reader \.article/);
  assert.match(css, /\.reader-floating-toolbar/);
  assert.match(css, /\.settings-panel\.reader-drawer/);
  assert.match(css, /@media \(max-width: 1200px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
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

test('mobile continuous-scroll controls use flow chapter boundaries and a compact shared-action HUD', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const toolbar = document.getElementById('mobileReaderToolbar');

  assert.equal(document.getElementById('mobileReaderChromeToggle')?.getAttribute('aria-label'), '显示阅读工具');
  assert.deepEqual(
    [...toolbar.querySelectorAll('button')].map((button) => button.dataset.readerAction),
    ['backToLibrary', 'openToc', 'highlight', 'openSettings']
  );
  assert.equal(document.getElementById('btnMobilePreviousPage'), null);
  assert.equal(document.getElementById('btnMobileNextPage'), null);
  assert.equal(document.getElementById('btnScrollPreviousChapter').parentElement.id, 'scrollChapterHeader');
  assert.equal(document.getElementById('btnScrollNextChapter').parentElement.id, 'scrollChapterFooter');

  window.document.documentElement.dataset.readerSurface = 'mobile';
  api.state.contentType = 'epub';
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

test('readerActions and readerPanels switch TOC and settings inside the single Drawer', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;

  assert.deepEqual(
    Object.keys(api.readerPanels),
    ['toc', 'settings', 'search', 'bookmarks', 'notes', 'ai']
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
    'closePanel'
  ]) {
    assert.equal(typeof api.readerActions[action], 'function', `missing reader action: ${action}`);
  }

  api.setupReaderActionMapping();
  document.getElementById('btnSettings').click();
  assert.equal(document.getElementById('readerDrawer').hidden, false);
  assert.equal(document.getElementById('readerPanelSettings').hidden, false);
  assert.equal(document.getElementById('readerPanelToc').hidden, true);

  api.state.contentType = 'epub';
  api.state.toc = [{ label: '第一章', target: '#chapter-1', depth: 0 }];
  api.renderToc();
  document.getElementById('drawerTabToc').click();
  assert.equal(document.getElementById('readerPanelToc').hidden, false);
  assert.equal(document.getElementById('readerPanelSettings').hidden, true);
  assert.equal(document.querySelectorAll('#tocList a[data-target]').length, 1);

  document.getElementById('btnCloseSettings').click();
  assert.equal(document.getElementById('readerDrawer').hidden, true);
  assert.equal(document.getElementById('readerDrawerBackdrop').hidden, true);
});

test('Drawer keeps one active panel and restores focus to its original launcher', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  const settingsButton = document.getElementById('btnSettings');

  api.setupReaderActionMapping();
  settingsButton.focus();
  settingsButton.click();
  assert.equal(document.getElementById('readerDrawer').hidden, false);
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

test('reserved reader actions stay disabled and never issue API requests', async () => {
  const { window, api } = await createReaderDom();
  const document = window.document;
  let requestCount = 0;
  window.fetch = async () => {
    requestCount += 1;
    return { ok: true, json: async () => ({}) };
  };

  for (const [controlId, actionName, panelName] of [
    ['btnSearch', 'openSearch', 'search'],
    ['btnBookmarks', 'openBookmarks', 'bookmarks'],
    ['btnNotes', 'openNotes', 'notes'],
    ['btnAi', 'openAi', 'ai']
  ]) {
    const control = document.getElementById(controlId);
    assert.equal(control.disabled, true);
    assert.equal(control.dataset.readerStatus, 'reserved');
    assert.equal(api.readerPanels[panelName].enabled(), false);
    assert.equal(api.readerActions[actionName](control), false);
  }

  assert.equal(requestCount, 0);
  assert.equal(document.getElementById('readerDrawer').hidden, true);
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
