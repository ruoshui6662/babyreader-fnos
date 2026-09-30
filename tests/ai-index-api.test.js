'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SANDBOX = path.join(os.tmpdir(), 'babyreader-ai-index-api-' + process.pid);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const BOOK_ID = 'd'.repeat(64);
const ORPHAN_ID = 'e'.repeat(64);
const BOOK_PATH = path.join(LIBRARY_ROOT, 'index-api-book.txt');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';

const { createAiIndexManager } = require('../app/server/ai-index-manager');
const { handleRequest, loadConfiguration } = require('../app/server/index');

let server;
let baseUrl;

function request(pathname, options = {}) {
  return fetch(baseUrl + pathname, options).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

async function writeRequest(pathname, body, options = {}) {
  return request(pathname, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: JSON.stringify(body)
  });
}

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.writeFile(BOOK_PATH, '索引管理测试内容', 'utf8');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({
    libraryRoots: [LIBRARY_ROOT]
  }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    books: [{ id: BOOK_ID, path: BOOK_PATH, type: 'txt', title: '索引管理测试书' }],
    scan: { status: 'completed', errorCount: 0, rootErrors: [] }
  }));
  await loadConfiguration();
  server = http.createServer((requestObject, response) => {
    void handleRequest(requestObject, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

test('index list requires an authenticated administrator and redacts paths', async () => {
  const admin = await request('/app/babyreader-fnos/api/ai/indexes');
  assert.equal(admin.status, 200);
  assert.equal('dataRoot' in admin.body, false);
  assert.equal(JSON.stringify(admin.body).includes(DATA_ROOT), false);
  assert.equal(JSON.stringify(admin.body).includes(BOOK_PATH), false);

  const regular = await request('/app/babyreader-fnos/api/ai/indexes', {
    headers: { 'x-trim-userid': 'regular-user', 'x-trim-isadmin': 'false' }
  });
  assert.equal(regular.status, 403);

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const anonymous = await request('/app/babyreader-fnos/api/ai/indexes');
    assert.equal(anonymous.status, 401);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('single index delete is idempotent and accepts only a book id', async () => {
  const manager = createAiIndexManager({ dataRoot: DATA_ROOT });
  const filePath = manager.getIndexPath(BOOK_ID);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'index');

  const deleted = await request('/app/babyreader-fnos/api/ai/indexes/' + BOOK_ID, {
    method: 'DELETE'
  });
  assert.equal(deleted.status, 200);
  await assert.rejects(() => fs.access(filePath), { code: 'ENOENT' });

  const repeated = await request('/app/babyreader-fnos/api/ai/indexes/' + BOOK_ID, {
    method: 'DELETE'
  });
  assert.equal(repeated.status, 200);

  const invalid = await request('/app/babyreader-fnos/api/ai/indexes/not-a-book', {
    method: 'DELETE'
  });
  assert.equal(invalid.status, 404);
});

test('cleanup requires confirmation and only removes confirmed orphan indexes', async () => {
  const manager = createAiIndexManager({ dataRoot: DATA_ROOT });
  const orphanPath = manager.getIndexPath(ORPHAN_ID);
  await fs.mkdir(path.dirname(orphanPath), { recursive: true });
  await fs.writeFile(orphanPath, 'orphan-index');

  const notConfirmed = await writeRequest('/app/babyreader-fnos/api/ai/indexes/cleanup', {
    kind: 'orphans',
    confirm: false
  });
  assert.equal(notConfirmed.status, 400);
  await fs.access(orphanPath);

  const cleaned = await writeRequest('/app/babyreader-fnos/api/ai/indexes/cleanup', {
    kind: 'orphans',
    confirm: true
  });
  assert.equal(cleaned.status, 200);
  assert.equal(cleaned.body.deleted.length, 1);
  await assert.rejects(() => fs.access(orphanPath), { code: 'ENOENT' });
});

test('cleanup fails closed when the library scan is not healthy', async () => {
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    books: [{ id: BOOK_ID, path: BOOK_PATH, type: 'txt', title: '索引管理测试书' }],
    scan: { status: 'completed-with-errors', errorCount: 1, rootErrors: ['unavailable'] }
  }));
  const manager = createAiIndexManager({ dataRoot: DATA_ROOT });
  const orphanPath = manager.getIndexPath(ORPHAN_ID);
  await fs.mkdir(path.dirname(orphanPath), { recursive: true });
  await fs.writeFile(orphanPath, 'orphan-index');

  const response = await writeRequest('/app/babyreader-fnos/api/ai/indexes/cleanup', {
    kind: 'orphans',
    confirm: true
  });

  assert.equal(response.status, 503);
  await fs.access(orphanPath);
});

test('healthy library scan removes indexes for deleted books and exposes only cleanup counts', async () => {
  const manager = createAiIndexManager({ dataRoot: DATA_ROOT });
  const indexPath = manager.getIndexPath(BOOK_ID);
  const orphanPath = manager.getIndexPath(ORPHAN_ID);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, 'book-index');
  await fs.writeFile(orphanPath, 'orphan-index');

  await fs.rm(BOOK_PATH);
  const response = await request('/app/babyreader-fnos/api/library/scan', {
    method: 'POST'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.scan.indexCleanup, {
    attempted: true,
    deletedCount: 2,
    skippedCount: 0,
    manifestRemovedCount: 0,
    bytesFreed: Buffer.byteLength('book-index') + Buffer.byteLength('orphan-index')
  });
  assert.equal(JSON.stringify(response.body.scan.indexCleanup).includes(DATA_ROOT), false);
  assert.equal(JSON.stringify(response.body.scan.indexCleanup).includes(BOOK_ID), false);
  await assert.rejects(() => fs.access(indexPath), { code: 'ENOENT' });
  await assert.rejects(() => fs.access(orphanPath), { code: 'ENOENT' });
});

test('rejected library roots preserve indexes during automatic cleanup', async () => {
  const orphanId = 'f'.repeat(64);
  const manager = createAiIndexManager({ dataRoot: DATA_ROOT });
  const orphanPath = manager.getIndexPath(orphanId);
  await fs.mkdir(path.dirname(orphanPath), { recursive: true });
  await fs.writeFile(orphanPath, 'keep-index');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({
    libraryRoots: [path.join(SANDBOX, 'missing-library-root')]
  }));

  const response = await request('/app/babyreader-fnos/api/library/scan', {
    method: 'POST'
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.scan.indexCleanup, undefined);
  await fs.access(orphanPath);
});
