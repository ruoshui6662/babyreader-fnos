'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanLibrary } = require('../app/server/library');
const { UserStorage } = require('../app/server/storage');
const { parseFnOSPathList } = require('../app/server/index');

const BOOK_ID = 'a'.repeat(64);

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('fnOS authorization path lists preserve multiple roots, spaces, Chinese names, and /vol paths', () => {
  assert.deepEqual(
    parseFnOSPathList(' /vol1/图书 目录 :/vol2/books:/vol3/共享/小说 '),
    ['/vol1/图书 目录', '/vol2/books', '/vol3/共享/小说']
  );
  assert.deepEqual(parseFnOSPathList(''), []);
  assert.deepEqual(parseFnOSPathList(undefined), []);
});

test('recursive multi-root scan indexes epub, md, markdown, and txt files in Chinese directories', async (t) => {
  const sandbox = await temporaryDirectory(t, 'babyreader-multi-root-');
  const firstRoot = path.join(sandbox, 'vol1', '中文 书库');
  const secondRoot = path.join(sandbox, 'vol2', '另一书库');
  const nested = path.join(firstRoot, '子目录');
  await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(secondRoot, { recursive: true });

  await fs.writeFile(path.join(nested, '第一本.md'), '# 第一本书\n\n内容', 'utf8');
  await fs.writeFile(path.join(firstRoot, '第二本.markdown'), '# 第二本书\n', 'utf8');
  await fs.writeFile(path.join(secondRoot, '第三本.txt'), '第三本书', 'utf8');
  await fs.writeFile(path.join(secondRoot, '忽略.pdf'), 'not supported', 'utf8');

  const index = await scanLibrary([firstRoot, secondRoot]);
  assert.equal(index.scan.discoveredCount, 3);
  assert.equal(index.scan.indexedCount, 3);
  assert.equal(index.scan.errorCount, 0);
  assert.deepEqual(
    new Set(index.books.map((book) => book.type)),
    new Set(['markdown', 'txt'])
  );
  assert.ok(index.books.some((book) => book.relativePath === '子目录/第一本.md'));
  assert.ok(index.books.some((book) => book.title === '第二本书'));
});

test('incremental scan reuses unchanged books and reindexes changed files with stable IDs', async (t) => {
  const sandbox = await temporaryDirectory(t, 'babyreader-scan-');
  const libraryRoot = path.join(sandbox, 'library');
  const coverDirectory = path.join(sandbox, 'covers');
  await fs.mkdir(libraryRoot, { recursive: true });
  const bookPath = path.join(libraryRoot, 'sample.md');
  await fs.writeFile(bookPath, '# First title\n\nHello.', 'utf8');

  const first = await scanLibrary([libraryRoot], { coverDirectory });
  assert.equal(first.version, 2);
  assert.equal(first.books.length, 1);
  assert.equal(first.scan.discoveredCount, 1);
  assert.equal(first.scan.indexedCount, 1);
  assert.equal(first.scan.reusedCount, 0);
  assert.equal(first.books[0].title, 'First title');

  const second = await scanLibrary([libraryRoot], {
    coverDirectory,
    previousIndex: first
  });
  assert.equal(second.books.length, 1);
  assert.equal(second.books[0].id, first.books[0].id);
  assert.equal(second.books[0].fingerprint, first.books[0].fingerprint);
  assert.equal(second.scan.indexedCount, 0);
  assert.equal(second.scan.reusedCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(bookPath, '# Changed title\n\nUpdated.', 'utf8');
  const third = await scanLibrary([libraryRoot], {
    coverDirectory,
    previousIndex: second
  });
  assert.equal(third.books[0].id, first.books[0].id);
  assert.notEqual(third.books[0].fingerprint, first.books[0].fingerprint);
  assert.equal(third.books[0].title, 'Changed title');
  assert.equal(third.scan.indexedCount, 1);
  assert.equal(third.scan.reusedCount, 0);
});

test('scan reports unavailable roots without discarding valid roots', async (t) => {
  const sandbox = await temporaryDirectory(t, 'babyreader-root-errors-');
  const libraryRoot = path.join(sandbox, 'library');
  await fs.mkdir(libraryRoot, { recursive: true });
  await fs.writeFile(path.join(libraryRoot, 'valid.txt'), 'readable', 'utf8');

  const index = await scanLibrary([
    libraryRoot,
    path.join(sandbox, 'missing')
  ]);
  assert.equal(index.books.filter((book) => !book.error).length, 1);
  assert.equal(index.scan.status, 'completed-with-errors');
  assert.equal(index.scan.rootErrors.length, 1);
  assert.equal(index.scan.errorCount, 1);
});

test('user settings, progress, and highlights remain isolated by fnOS user ID', async (t) => {
  const dataRoot = await temporaryDirectory(t, 'babyreader-users-');
  const storage = new UserStorage(dataRoot);
  await storage.initialize();

  await storage.updateSettings('alice', {
    theme: 'light',
    fontSize: 140,
    continuousScroll: false,
    tocOpen: false
  });
  await storage.updateProgress('alice', BOOK_ID, {
    locator: '{"scrollTop":240}',
    percentage: 0.4
  });
  await storage.replaceHighlights('alice', BOOK_ID, [{
    id: 'highlight-1',
    locator: 'epubcfi(/6/2)',
    text: 'Alice only',
    note: '',
    color: 'yellow',
    createdAt: '2026-09-17T00:00:00.000Z'
  }]);

  await storage.updateSettings('bob', {
    theme: 'dark',
    fontSize: 90,
    continuousScroll: true,
    tocOpen: true
  });

  const alice = await storage.getState('alice');
  const bob = await storage.getState('bob');
  assert.equal(alice.settings.theme, 'light');
  assert.equal(alice.settings.fontSize, 140);
  assert.equal(alice.settings.readingMode, 'double');
  assert.equal(alice.settings.continuousScroll, false);
  assert.equal(alice.books[BOOK_ID].progress.percentage, 0.4);
  assert.equal(alice.books[BOOK_ID].highlights[0].text, 'Alice only');
  assert.equal(bob.settings.theme, 'dark');
  assert.equal(bob.settings.fontSize, 90);
  assert.equal(bob.settings.readingMode, 'scroll');
  assert.equal(bob.settings.continuousScroll, true);
  assert.deepEqual(bob.books, {});
});

test('settings validation clamps font size and normalizes supported values', async (t) => {
  const dataRoot = await temporaryDirectory(t, 'babyreader-settings-');
  const storage = new UserStorage(dataRoot);
  await storage.initialize();

  const settings = await storage.updateSettings('reader_1', {
    theme: 'unsupported',
    fontSize: 999,
    lineHeight: 9,
    pageMargin: 999,
    highlightColor: 'unsupported',
    continuousScroll: 0,
    tocOpen: 0
  });
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.fontSize, 200);
  assert.equal(settings.lineHeight, 2.6);
  assert.equal(settings.pageMargin, 96);
  assert.equal(settings.highlightColor, 'yellow');
  assert.equal(settings.textIndent, 2);           // default preserved (unsupported not present)
  assert.equal(settings.paragraphSpacing, 1.1);   // default preserved
  assert.equal(settings.fontFamily, 'sans');      // default preserved
  assert.equal(settings.continuousScroll, true);
  assert.equal(settings.tocOpen, true);
  assert.throws(() => storage.userDirectory('../escape'), /Invalid fnOS user ID/);

  // P0: typography clamp and normalisation (same ranges as the client)
  const typ = await storage.updateSettings('reader_1', {
    textIndent: 99,          // out-of-range → clamp to 4
    paragraphSpacing: 0.1,  // out-of-range → clamp to 0.4
    fontFamily: 'comic-sans' // unknown → fall back to default 'sans'
  });
  assert.equal(typ.textIndent, 4);
  assert.equal(typ.paragraphSpacing, 0.4);
  assert.equal(typ.fontFamily, 'sans');

  const valid = await storage.updateSettings('reader_1', {
    textIndent: 2, paragraphSpacing: 1.5, fontFamily: 'source-serif', theme: 'sepia'
  });
  assert.equal(valid.textIndent, 2);
  assert.equal(valid.paragraphSpacing, 1.5);
  assert.equal(valid.fontFamily, 'source-serif');
  assert.equal(valid.theme, 'sepia');
});

test('server exposes health, diagnostics, scan status, error log, and shared scan control', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../app/server/index.js'), 'utf8');
  assert.match(source, /\/api\/health/);
  assert.match(source, /\/api\/diagnostics/);
  assert.match(source, /\/api\/errors/);
  assert.match(source, /\/api\/library\/scan\/status/);
  assert.match(source, /if \(activeScan\) return activeScan/);
  assert.match(source, /previousIndex/);
  assert.match(source, /recordError/);
});

test('frontend restores server state and wires library, settings, EPUB TOC, and continuous scrolling', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../app/ui/app.js'), 'utf8');
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  const css = await fs.readFile(path.resolve(__dirname, '../app/ui/styles.css'), 'utf8');

  assert.match(source, /getUserState\(\)/);
  assert.match(source, /applyUserState\(userState\)/);
  assert.match(source, /currentServerBookState\(\)\.progress/);
  assert.match(source, /currentServerBookState\(\)\.highlights/);
  assert.match(source, /setupTocNavigation/);
  assert.match(source, /navigateEpubTarget\(target\)/);
  assert.doesNotMatch(source, /state\.epubRendition\.display\(target\)/);
  assert.match(source, /queryIndex/);
  assert.match(source, /decodeEpubPath\(split\.fragment\)/);
  assert.match(source, /describeEpubNavigationFailure/);
  assert.match(source, /applyContinuousScroll/);
  assert.match(source, /renderLibrary/);
  assert.match(source, /btnBackToLibrary/);
  assert.match(source, /Array\.isArray\(serverHighlights\)/);
  assert.match(html, /id="btnBackToLibrary"/);
  assert.match(html, /aria-label="返回书架"/);
  assert.match(html, /id="settingsPanel"/);
  assert.match(html, /id="settingFontSize"/);
  assert.match(html, /id="settingLineHeight"/);
  assert.match(html, /id="settingPageMargin"/);
  assert.match(html, /id="settingReadingMode"/);
  // P0 typography controls must exist and be wired.
  assert.match(html, /id="settingFontFamily"/);
  assert.match(html, /id="settingTextIndent"/);
  assert.match(html, /id="settingParagraphSpacing"/);
  assert.match(html, /value="sepia"/);
  assert.match(source, /const FONT_STACKS = Object\.freeze/);
  assert.match(source, /function applyTypography\(\)/);
  assert.match(source, /--reader-text-indent/);
  assert.match(source, /--reader-para-spacing/);
  assert.match(source, /--reader-font-family/);
  assert.match(css, /text-indent: var\(--reader-text-indent/);
  assert.match(css, /margin-bottom: var\(--reader-para-spacing/);
  assert.match(css, /font-family: var\(--reader-font-family/);
  assert.match(css, /body\.theme-sepia \{/);
  assert.match(css, /\.library-grid/);
  assert.match(css, /body\.paged-reading/);
  assert.match(css, /line-height: var\(--reader-line-height\) !important/);
  assert.match(css, /padding: 48px var\(--reader-page-margin\) 120px/);
});
