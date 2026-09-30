'use strict';

// MOBI plan Task 1: discovery, metadata and visibility. MOBI stays invisible
// and unreadable unless its switch is on, and even then content/search/AI stay
// closed until the converter exists (Task 3). Other formats must not change.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createMobiFixture,
  createDrmMobiFixture,
  createTruncatedMobiFixture
} = require('./fixtures/mobi-fixtures');
const { scanLibrary } = require('../app/server/library');
const { setMobiReaderEnabled } = require('../app/server/mobi-feature-config');

const SANDBOX = path.join(os.tmpdir(), `babyreader-mobi-library-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'production';
process.env.BABYREADER_ENABLE_LIBRARY_ORGANIZATION = '1';
delete process.env.BABYREADER_MOBI_ENABLED;
const { handleRequest, loadConfiguration } = require('../app/server/index');
let server;
let baseUrl;

const ADMIN = { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' };
const READER = { 'x-trim-userid': 'reader', 'x-trim-isadmin': 'false' };

async function makeLibrary(root, { mobi = true } = {}) {
  await fs.mkdir(path.join(root, 'kindle'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes.txt'), '纯文本书\n\n正文');
  await fs.writeFile(path.join(root, 'guide.md'), '# 指南\n\n正文');
  if (!mobi) return;
  await fs.writeFile(path.join(root, 'kindle', 'novel.mobi'), createMobiFixture({ title: '小说', author: '作者' }));
  await fs.writeFile(path.join(root, 'kindle', 'modern.azw3'), createMobiFixture({ title: '新格式', kf8: 'standalone' }));
  await fs.writeFile(path.join(root, 'kindle', 'locked.azw'), createDrmMobiFixture({ title: '受保护' }));
  await fs.writeFile(path.join(root, 'kindle', 'broken.mobi'), createTruncatedMobiFixture());
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-mobi-scan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function withoutTimes(index) {
  return {
    books: index.books.map(({ modifiedAt, ...book }) => book),
    scan: { ...index.scan }
  };
}

test('with MOBI disabled the scan is identical to a library without Kindle files, plus a hidden count', async (t) => {
  const withMobi = await temporaryDirectory(t);
  await makeLibrary(withMobi);
  const plain = await temporaryDirectory(t);
  await makeLibrary(plain, { mobi: false });

  const indexed = withoutTimes(await scanLibrary([withMobi]));
  const reference = withoutTimes(await scanLibrary([plain]));
  assert.equal(indexed.scan.hiddenMobiCount, 4);
  delete indexed.scan.hiddenMobiCount;
  // Different temp roots only change path-derived identifiers.
  const comparable = ({ id, root, path: p, fingerprint, sourceRootId, ...book }) => book;
  assert.deepEqual(indexed.books.map(comparable), reference.books.map(comparable));
  assert.deepEqual(indexed.scan, reference.scan);
});

test('with MOBI enabled Kindle files are indexed; DRM is counted but never an error', async (t) => {
  const root = await temporaryDirectory(t);
  const covers = await temporaryDirectory(t);
  await makeLibrary(root);
  const index = await scanLibrary([root], { mobiEnabled: true, coverDirectory: covers });

  const novel = index.books.find((book) => book.relativePath === 'kindle/novel.mobi');
  assert.equal(novel.type, 'mobi');
  assert.equal(novel.sourceFormat, 'mobi6');
  assert.equal(novel.title, '小说');
  assert.equal(novel.author, '作者');
  assert.match(novel.coverUrl, new RegExp(`/api/books/${novel.id}/cover$`));
  assert.ok((await fs.readdir(covers)).some((name) => name.startsWith(novel.id) && name.endsWith('.png')));

  const modern = index.books.find((book) => book.relativePath === 'kindle/modern.azw3');
  assert.equal(modern.sourceFormat, 'kf8');

  assert.equal(index.books.some((book) => book.relativePath === 'kindle/locked.azw'), false);
  assert.equal(index.scan.drmProtectedCount, 1);
  assert.deepEqual(index.scan.drmProtected, [{ relativePath: 'kindle/locked.azw' }]);

  const broken = index.books.find((book) => book.relativePath === 'kindle/broken.mobi');
  assert.match(broken.error, /truncated|past the end/i);
  assert.equal(index.scan.errorCount, 1);
  assert.equal(index.scan.hiddenMobiCount, 0);

  const rescanned = await scanLibrary([root], { mobiEnabled: true, coverDirectory: covers, previousIndex: index });
  assert.equal(rescanned.books.find((book) => book.id === novel.id).title, '小说');
  assert.ok(rescanned.scan.reusedCount >= 4, 'unchanged MOBI and text books are reused');
});

test('a library of only DRM books stays healthy for category editing', async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, 'locked.azw3'), createDrmMobiFixture({ kf8: 'combo' }));
  const index = await scanLibrary([root], { mobiEnabled: true });
  assert.equal(index.scan.status, 'completed');
  assert.equal(index.scan.errorCount, 0);
  assert.equal(index.books.length, 0);
});

test.describe('library API', () => {
  test.before(async () => {
    await fs.rm(SANDBOX, { recursive: true, force: true });
    await fs.mkdir(CONFIG_ROOT, { recursive: true });
    await makeLibrary(LIBRARY_ROOT);
    await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({ libraryRoots: [LIBRARY_ROOT] }));
    await loadConfiguration();
    server = http.createServer((request, response) => void handleRequest(request, response));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/app/babyreader-fnos`;
  });

  test.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await fs.rm(SANDBOX, { recursive: true, force: true });
  });

  async function scan() {
    const response = await fetch(`${baseUrl}/api/library/scan`, { method: 'POST', headers: ADMIN });
    assert.equal(response.status, 200);
    return response.json();
  }

  test('MOBI defaults off: hidden from library and organization, reported as a hidden count', async () => {
    const library = await scan();
    assert.equal(library.features.mobiReader, false);
    assert.equal(library.features.hiddenMobiCount, 4);
    assert.equal(library.books.some((book) => book.type === 'mobi'), false);
    assert.deepEqual(library.books.map((book) => book.title).sort(), ['notes', '指南'].sort());
    const organization = await (await fetch(`${baseUrl}/api/library/organization`, { headers: READER })).json();
    assert.equal(organization.books.length, 2);
  });

  test('MOBI enabled after a rescan: listed with metadata and cover, but content stays closed', async () => {
    setMobiReaderEnabled(CONFIG_ROOT, 'true');
    const library = await scan();
    assert.equal(library.features.mobiReader, true);
    assert.equal(library.features.hiddenMobiCount, 0);
    assert.equal(library.features.drmProtectedMobiCount, 1);
    const novel = library.books.find((book) => book.title === '小说');
    assert.equal(novel.type, 'mobi');
    assert.equal(novel.path, undefined, 'paths stay redacted');

    const cover = await fetch(`${baseUrl}/api/books/${novel.id}/cover`, { headers: READER });
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get('content-type'), 'image/png');

    for (const suffix of ['content', 'search?q=%E7%AB%A0']) {
      const response = await fetch(`${baseUrl}/api/books/${novel.id}/${suffix}`, { headers: READER });
      assert.equal(response.status, 409, suffix);
      assert.match((await response.json()).error, /MOBI/);
    }
    const organization = await (await fetch(`${baseUrl}/api/library/organization`, { headers: READER })).json();
    assert.ok(organization.books.some((book) => book.id === novel.id));
  });

  test('switching MOBI off again hides indexed Kindle books and closes their endpoints', async () => {
    setMobiReaderEnabled(CONFIG_ROOT, 'false');
    const library = await (await fetch(`${baseUrl}/api/library`, { headers: READER })).json();
    assert.equal(library.books.some((book) => book.type === 'mobi'), false);
    assert.equal(library.features.hiddenMobiCount, 2, 'indexed readable Kindle books (not DRM or broken ones) are counted as hidden');
    const index = JSON.parse(await fs.readFile(path.join(DATA_ROOT, 'index', 'library.json'), 'utf8'));
    const novel = index.books.find((book) => book.title === '小说');
    for (const suffix of ['content', 'cover']) {
      const response = await fetch(`${baseUrl}/api/books/${novel.id}/${suffix}`, { headers: READER });
      assert.equal(response.status, 404, suffix);
    }
  });
});
