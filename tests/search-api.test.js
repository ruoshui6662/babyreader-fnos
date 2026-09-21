'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SANDBOX = path.join(os.tmpdir(), `babyreader-search-api-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const BOOK_ID = 'd'.repeat(64);
const UNKNOWN_BOOK_ID = 'e'.repeat(64);
const BROKEN_BOOK_ID = 'f'.repeat(64);
const BOOK_PATH = path.join(LIBRARY_ROOT, 'search-book.txt');
const BROKEN_BOOK_PATH = path.join(LIBRARY_ROOT, 'broken-book.epub');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';

const { parseBookSearchParams } = require('../app/server/book-search');
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
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.writeFile(BOOK_PATH, '前言没有命中。蛋白质出现在第二句。第三句再次提到蛋白质。', 'utf8');
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
    { query: '蛋白质', scope: 'chapter', chapterIndex: 2, limit: 50 }
  );
  assert.deepEqual(parseBookSearchParams(new URLSearchParams('q=health')), {
    query: 'health',
    scope: 'book',
    chapterIndex: null,
    limit: 20
  });
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
    truncated: false
  });
});
