'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCorruptPdfFixture, createPdfFixture } = require('./fixtures/pdf-fixtures');

const SANDBOX = path.join(os.tmpdir(), `babyreader-search-api-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const CUSTOM_ROOT = path.join(SANDBOX, 'custom-library');
const BOOK_ID = 'd'.repeat(64);
const UNKNOWN_BOOK_ID = 'e'.repeat(64);
const BROKEN_BOOK_ID = 'f'.repeat(64);
const PDF_BOOK_ID = 'a'.repeat(64);
const TEXTLESS_PDF_BOOK_ID = 'b'.repeat(64);
const BROKEN_PDF_BOOK_ID = 'c'.repeat(64);
const BOOK_PATH = path.join(LIBRARY_ROOT, 'search-book.txt');
const BROKEN_BOOK_PATH = path.join(LIBRARY_ROOT, 'broken-book.epub');
const PDF_BOOK_PATH = path.join(LIBRARY_ROOT, 'search-book.pdf');
const TEXTLESS_PDF_PATH = path.join(LIBRARY_ROOT, 'textless-book.pdf');
const BROKEN_PDF_PATH = path.join(LIBRARY_ROOT, 'broken-book.pdf');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';
process.env.BABYREADER_PDF_ENABLED = 'true';

const { parseBookSearchParams } = require('../app/server/book-search');
const { writeFnOSAuthorizedRoots } = require('../app/server/fnos-roots-config');
const { handleRequest, loadConfiguration } = require('../app/server/index');

let server;
let baseUrl;

function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(CUSTOM_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.writeFile(BOOK_PATH, '前言没有命中。蛋白质出现在第二句。第三句再次提到蛋白质。', 'utf8');
  await fs.writeFile(PDF_BOOK_PATH, createPdfFixture({ pageTexts: [
    '第一页面。精确搜索词在这里。',
    '第二页面。相同的精确搜索词再次出现。'
  ] }));
  await fs.writeFile(TEXTLESS_PDF_PATH, createPdfFixture({ pageTexts: [null, ''] }));
  await fs.writeFile(BROKEN_PDF_PATH, createCorruptPdfFixture());
  await fs.writeFile(path.join(CUSTOM_ROOT, 'custom-book.txt'), '来自 fnOS 自定义授权目录的书籍。', 'utf8');
  await fs.writeFile(BROKEN_BOOK_PATH, '这不是有效的 EPUB 压缩包', 'utf8');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({
    libraryRoots: [LIBRARY_ROOT]
  }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    books: [{
      id: BOOK_ID,
      path: BOOK_PATH,
      type: 'txt',
      title: '搜索测试书'
    }, {
      id: BROKEN_BOOK_ID,
      path: BROKEN_BOOK_PATH,
      type: 'epub',
      title: '损坏的 EPUB'
    }, {
      id: PDF_BOOK_ID,
      path: PDF_BOOK_PATH,
      type: 'pdf',
      title: 'PDF 搜索书'
    }, {
      id: TEXTLESS_PDF_BOOK_ID,
      path: TEXTLESS_PDF_PATH,
      type: 'pdf',
      title: '扫描版 PDF'
    }, {
      id: BROKEN_PDF_BOOK_ID,
      path: BROKEN_PDF_PATH,
      type: 'pdf',
      title: '损坏 PDF'
    }]
  }));
  await loadConfiguration();
  server = http.createServer((requestObject, response) => {
    void handleRequest(requestObject, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

test('parseBookSearchParams maps URL parameters to the bounded service contract', () => {
  assert.deepEqual(
    parseBookSearchParams(new URLSearchParams('q=%E8%9B%8B%E7%99%BD%E8%B4%A8&scope=chapter&chapterIndex=2&limit=50')),
    { query: '蛋白质', scope: 'chapter', chapterIndex: 2, limit: 50, cursor: null }
  );
  assert.deepEqual(parseBookSearchParams(new URLSearchParams('q=health')), {
    query: 'health',
    scope: 'book',
    chapterIndex: null,
    limit: 20,
    cursor: null
  });
});

test('library scan discovers an fnOS accessible root and exposes safe root counts', async () => {
  const previousAccessible = process.env.TRIM_DATA_ACCESSIBLE_PATHS;
  const libraryIndexPath = path.join(DATA_ROOT, 'index', 'library.json');
  const previousLibraryIndex = await fs.readFile(libraryIndexPath, 'utf8');
  process.env.TRIM_DATA_ACCESSIBLE_PATHS = CUSTOM_ROOT;
  try {
    await loadConfiguration();

    const scan = await request('/app/babyreader-fnos/api/library/scan', {
      method: 'POST',
      headers: { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' }
    });
    assert.equal(scan.status, 200);
    assert.ok(scan.body.books.some((book) => book.title === 'custom-book'));

    const diagnostics = await request('/app/babyreader-fnos/api/diagnostics', {
      headers: { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' }
    });
    assert.equal(diagnostics.status, 200);
    assert.deepEqual(diagnostics.body.rootCounts, {
      configured: 1,
      accessible: 1,
      shared: 0,
      authorized: 2,
      rejected: 0
    });
    assert.equal('root' in scan.body, false);

    process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
    await loadConfiguration();
    const afterRevoke = await request('/app/babyreader-fnos/api/diagnostics', {
      headers: { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' }
    });
    assert.equal(afterRevoke.status, 200);
    assert.equal(afterRevoke.body.rootCounts.accessible, 0);
    assert.equal(afterRevoke.body.rootCounts.authorized, 1);
  } finally {
    process.env.TRIM_DATA_ACCESSIBLE_PATHS = previousAccessible || '';
    await fs.writeFile(libraryIndexPath, previousLibraryIndex, 'utf8');
    await loadConfiguration();
  }
});

test('library scan uses the first fnOS permission callback result without restarting the server', async () => {
  const snapshot = path.join(CONFIG_ROOT, 'fnos-authorized-roots.json');
  const libraryIndexPath = path.join(DATA_ROOT, 'index', 'library.json');
  const previousIndex = await fs.readFile(libraryIndexPath, 'utf8');
  try {
    assert.equal(process.env.TRIM_DATA_ACCESSIBLE_PATHS, '');
    writeFnOSAuthorizedRoots(CONFIG_ROOT, CUSTOM_ROOT);
    const added = await request('/app/babyreader-fnos/api/library/scan', {
      method: 'POST', headers: { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' }
    });
    assert.equal(added.status, 200);
    assert.ok(added.body.books.some((book) => book.title === 'custom-book'));

    const customBook = added.body.books.find((book) => book.title === 'custom-book');
    writeFnOSAuthorizedRoots(CONFIG_ROOT, '');
    const staleContent = await fetch(`${baseUrl}/app/babyreader-fnos/api/books/${customBook.id}/content`, {
      headers: { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' }
    });
    assert.equal(staleContent.status, 404);
    await staleContent.arrayBuffer();
    const revoked = await request('/app/babyreader-fnos/api/library/scan', {
      method: 'POST', headers: { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' }
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.books.some((book) => book.title === 'custom-book'), false);
  } finally {
    await fs.rm(snapshot, { force: true });
    await fs.writeFile(libraryIndexPath, previousIndex, 'utf8');
    await loadConfiguration();
  }
});

test('search API returns bounded independent results for an authenticated book', async () => {
  const response = await request(
    `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}&limit=1`
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.query, '蛋白质');
  assert.equal(response.body.scope, 'book');
  assert.equal(response.body.results.length, 1);
  assert.equal(response.body.results[0].locator.type, 'text-search');
  assert.equal(typeof response.body.hasMore, 'boolean');
  assert.equal('path' in response.body, false);
  assert.equal('raw' in response.body.results[0], false);
});

test('search API reaches chapter scope without changing the AI route', async () => {
  const response = await request(
    `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}&scope=chapter&chapterIndex=0`
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.scope, 'chapter');
  assert.ok(response.body.results.every((item) => item.chapterIndex === 0));
});

test('search API supports cursor continuation and rejects a cursor reused for another query', async () => {
  const first = await request(
    `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}&limit=1`
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.hasMore, true);

  const next = await request(
    `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`
  );
  assert.equal(next.status, 200);
  assert.equal(next.body.results.length, 1);
  assert.notEqual(next.body.results[0].id, first.body.results[0].id);

  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const unauthenticatedContinuation = await request(
      `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`
    );
    assert.equal(unauthenticatedContinuation.status, 401);
  } finally {
    process.env.NODE_ENV = previousEnvironment;
  }

  const mismatch = await request(
    `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=wrong&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`
  );
  assert.equal(mismatch.status, 400);
});

test('search API rejects missing or malformed parameters with 400', async () => {
  const missingQuery = await request(`/app/babyreader-fnos/api/books/${BOOK_ID}/search`);
  assert.equal(missingQuery.status, 400);

  const malformed = await request(
    `/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=x&scope=other&limit=0`
  );
  assert.equal(malformed.status, 400);
});

test('search API rejects requests without fnOS identity', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = await request(`/app/babyreader-fnos/api/books/${BOOK_ID}/search?q=x`);
    assert.equal(response.status, 401);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('search API resolves only known books', async () => {
  const response = await request(
    `/app/babyreader-fnos/api/books/${UNKNOWN_BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}`
  );
  assert.equal(response.status, 404);
});

test('search API returns a controlled unavailable result when FTS cannot build', async () => {
  const response = await request(
    `/app/babyreader-fnos/api/books/${BROKEN_BOOK_ID}/search?q=${encodeURIComponent('蛋白质')}`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    available: false,
    query: '蛋白质',
    scope: 'book',
    results: [],
    hasMore: false,
    nextCursor: null,
    truncated: false
  });
});

test('search API returns bounded PDF page locators without exposing source text or paths', async () => {
  const response = await request(
    `/app/babyreader-fnos/api/books/${PDF_BOOK_ID}/search?q=${encodeURIComponent('精确搜索词')}&limit=1`
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.results.length, 1);
  assert.equal(response.body.results[0].locator.type, 'pdf');
  assert.equal(response.body.results[0].locator.pageIndex, 0);
  assert.equal(response.body.results[0].locator.textOffset, '第一页面。'.length);
  assert.equal(response.body.results[0].locator.quote, '精确搜索词');
  assert.equal(response.body.hasMore, true);
  assert.equal(JSON.stringify(response.body).includes(PDF_BOOK_PATH), false);
  assert.equal('raw' in response.body.results[0], false);
});

test('search API identifies image-only PDFs and safely rejects malformed PDFs', async () => {
  const textless = await request(
    `/app/babyreader-fnos/api/books/${TEXTLESS_PDF_BOOK_ID}/search?q=${encodeURIComponent('任意内容')}`
  );
  assert.deepEqual(textless.body, {
    available: false,
    query: '任意内容',
    scope: 'book',
    results: [],
    hasMore: false,
    nextCursor: null,
    truncated: false,
    unavailableReason: 'pdf_no_searchable_text'
  });

  const malformed = await request(
    `/app/babyreader-fnos/api/books/${BROKEN_PDF_BOOK_ID}/search?q=${encodeURIComponent('任意内容')}`
  );
  assert.equal(malformed.status, 200);
  assert.equal(malformed.body.available, false);
  assert.equal(malformed.body.results.length, 0);
  assert.equal('path' in malformed.body, false);
});
