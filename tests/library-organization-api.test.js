'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SANDBOX = path.join(os.tmpdir(), `zhenshu-library-organization-api-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const BOOK_ID = 'a'.repeat(64);
const SECOND_BOOK_ID = 'b'.repeat(64);
const UNKNOWN_BOOK_ID = 'c'.repeat(64);
const BOOK_PATH = path.join(LIBRARY_ROOT, 'one.txt');
const SECOND_BOOK_PATH = path.join(LIBRARY_ROOT, 'two.txt');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';

const { handleRequest, loadConfiguration } = require('../app/server/index');

let server;
let baseUrl;

function userHeaders(uid = 'user-a') {
  return {
    'x-trim-userid': uid,
    'x-trim-username': uid,
    'x-trim-isadmin': 'false'
  };
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...userHeaders(), ...(options.headers || {}) }
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

async function jsonRequest(pathname, method, body, headers = {}) {
  return request(pathname, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.writeFile(BOOK_PATH, '第一本书', 'utf8');
  await fs.writeFile(SECOND_BOOK_PATH, '第二本书', 'utf8');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({
    libraryRoots: [LIBRARY_ROOT]
  }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    scan: { status: 'completed', errorCount: 0, rootErrors: [] },
    books: [{
      id: BOOK_ID,
      path: BOOK_PATH,
      root: LIBRARY_ROOT,
      relativePath: 'one.txt',
      type: 'txt',
      title: '第一本书'
    }, {
      id: SECOND_BOOK_ID,
      path: SECOND_BOOK_PATH,
      root: LIBRARY_ROOT,
      relativePath: 'two.txt',
      type: 'txt',
      title: '第二本书'
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

test('organization API requires an authenticated fnOS identity', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const raw = await fetch(`${baseUrl}/app/zhenshu/api/library/organization`);
    assert.equal(raw.status, 401);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('organization read returns a resolved, path-free model', async () => {
  const response = await request('/app/zhenshu/api/library/organization');
  assert.equal(response.status, 200);
  assert.equal(response.body.revision, 0);
  assert.equal(response.body.books.length, 2);
  assert.deepEqual(response.body.unassignedOrder, [BOOK_ID, SECOND_BOOK_ID]);
  assert.equal('path' in response.body.books[0], false);
  assert.equal('root' in response.body.books[0], false);
  assert.equal(JSON.stringify(response.body).includes(LIBRARY_ROOT), false);
});

test('freshly scanned unassigned books can save their displayed order', async () => {
  const headers = userHeaders('fresh-order-user');
  const result = await jsonRequest('/app/zhenshu/api/library/organization/order', 'PUT', {
    scope: 'unassigned', order: [SECOND_BOOK_ID, BOOK_ID], revision: 0
  }, headers);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.unassignedOrder, [SECOND_BOOK_ID, BOOK_ID]);
});

test('all-book order is persisted per user and rejects missing or duplicate IDs', async () => {
  const headers = userHeaders('all-order-user');
  const url = '/app/zhenshu/api/library/organization/order';
  const result = await jsonRequest(url, 'PUT', { scope: 'all', order: [SECOND_BOOK_ID, BOOK_ID], revision: 0 }, headers);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.allBookOrder, [SECOND_BOOK_ID, BOOK_ID]);
  assert.deepEqual(result.body.bookAssignments, {});
  for (const order of [[BOOK_ID], [BOOK_ID, BOOK_ID], [BOOK_ID, UNKNOWN_BOOK_ID]]) {
    const rejected = await jsonRequest(url, 'PUT', { scope: 'all', order, revision: 1 }, headers);
    assert.equal(rejected.status, 400);
  }
  const fresh = await request('/app/zhenshu/api/library/organization', { headers });
  assert.deepEqual(fresh.body.allBookOrder, [SECOND_BOOK_ID, BOOK_ID]);
  const other = await request('/app/zhenshu/api/library/organization', { headers: userHeaders('other-order-user') });
  assert.deepEqual(other.body.allBookOrder, [BOOK_ID, SECOND_BOOK_ID]);
});

test('reordering visible collection books retains temporarily missing references', async () => {
  const headers = userHeaders('offline-order-user');
  const created = await jsonRequest('/app/zhenshu/api/library/collections', 'POST', { name: '保留离线', revision: 0 }, headers);
  const id = created.body.collections[0].id;
  // Model a previously saved assignment whose source file has temporarily disappeared.
  const { UserStorage } = require('../app/server/storage');
  const store = new UserStorage(DATA_ROOT);
  await store.mutateLibraryOrganization('offline-order-user', 1, draft => {
    draft.collectionOrders[id] = [UNKNOWN_BOOK_ID, BOOK_ID, SECOND_BOOK_ID];
    draft.bookAssignments = { [UNKNOWN_BOOK_ID]: id, [BOOK_ID]: id, [SECOND_BOOK_ID]: id };
  });
  const reordered = await jsonRequest('/app/zhenshu/api/library/organization/order', 'PUT', {
    scope: id, order: [SECOND_BOOK_ID, BOOK_ID], revision: 2
  }, headers);
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.collectionOrders[id], [SECOND_BOOK_ID, BOOK_ID]);
  const persisted = await store.getLibraryOrganization('offline-order-user');
  assert.ok(persisted.collectionOrders[id].includes(UNKNOWN_BOOK_ID));
  assert.equal(persisted.bookAssignments[UNKNOWN_BOOK_ID], id);
});

test('organization mutations create, rename, place and reorder collections', async () => {
  const created = await jsonRequest('/app/zhenshu/api/library/collections', 'POST', {
    name: '  营养   科学  ',
    revision: 0
  });
  assert.equal(created.status, 201);
  const collection = created.body.collections[0];
  assert.equal(collection.name, '营养 科学');
  assert.equal(created.body.revision, 1);

  const renamed = await jsonRequest(
    `/app/zhenshu/api/library/collections/${collection.id}`,
    'PATCH',
    { name: '<script>alert(1)</script>', revision: 1 }
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.collections[0].name, '<script>alert(1)</script>');

  const placed = await jsonRequest(
    `/app/zhenshu/api/library/books/${BOOK_ID}/placement`,
    'PUT',
    { collectionId: collection.id, beforeBookId: null, revision: 2 }
  );
  assert.equal(placed.status, 200);
  assert.deepEqual(placed.body.collectionOrders[collection.id], [BOOK_ID]);
  assert.equal(placed.body.bookAssignments[BOOK_ID], collection.id);

  const secondPlaced = await jsonRequest(
    `/app/zhenshu/api/library/books/${SECOND_BOOK_ID}/placement`,
    'PUT',
    { collectionId: collection.id, beforeBookId: BOOK_ID, revision: 3 }
  );
  assert.equal(secondPlaced.status, 200);
  assert.deepEqual(secondPlaced.body.collectionOrders[collection.id], [SECOND_BOOK_ID, BOOK_ID]);
  assert.deepEqual(secondPlaced.body.unassignedOrder, []);

  const reordered = await jsonRequest('/app/zhenshu/api/library/organization/order', 'PUT', {
    scope: collection.id,
    order: [BOOK_ID, SECOND_BOOK_ID],
    revision: 4
  });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.collectionOrders[collection.id], [BOOK_ID, SECOND_BOOK_ID]);
});

test('organization API rejects stale revisions and invalid book ids without leaking paths', async () => {
  const response = await jsonRequest('/app/zhenshu/api/library/collections', 'POST', {
    name: '过期操作',
    revision: 0
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, '书库已在其他页面更新，请重新加载');

  const invalid = await jsonRequest(
    '/app/zhenshu/api/library/books/not-a-book/placement',
    'PUT',
    { collectionId: null, revision: 4 }
  );
  assert.equal(invalid.status, 400);
  assert.equal(JSON.stringify(invalid.body).includes(LIBRARY_ROOT), false);

  const missing = await jsonRequest(
    `/app/zhenshu/api/library/books/${UNKNOWN_BOOK_ID}/placement`,
    'PUT',
    { collectionId: null, revision: 5 }
  );
  assert.equal(missing.status, 404);
});

test('organization state is isolated by user and deleting a collection unassigns books', async () => {
  const other = await request('/app/zhenshu/api/library/organization', {
    headers: userHeaders('user-b')
  });
  assert.equal(other.status, 200);
  assert.equal(other.body.revision, 0);
  assert.deepEqual(other.body.collections, []);

  const current = await request('/app/zhenshu/api/library/organization');
  const collectionId = current.body.collections[0].id;
  const deleted = await jsonRequest(
    `/app/zhenshu/api/library/collections/${collectionId}`,
    'DELETE',
    { revision: current.body.revision }
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body.collections, []);
  assert.deepEqual(deleted.body.unassignedOrder, [BOOK_ID, SECOND_BOOK_ID]);
});

test('legacy library API remains a flat catalog and exposes only the feature flag', async () => {
  const response = await request('/app/zhenshu/api/library');
  assert.equal(response.status, 200);
  assert.equal(response.body.features.libraryOrganization, false);
  assert.equal('organization' in response.body, false);
  assert.equal('path' in response.body.books[0], false);
  assert.equal('root' in response.body.books[0], false);
});

test('organization preferences accept only the bounded view modes', async () => {
  const current = await request('/app/zhenshu/api/library/organization');
  const updated = await jsonRequest('/app/zhenshu/api/library/organization/preferences', 'PUT', {
    viewMode: 'source-folders',
    revision: current.body.revision
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preferences.viewMode, 'source-folders');

  const invalid = await jsonRequest('/app/zhenshu/api/library/organization/preferences', 'PUT', {
    viewMode: 'delete-files',
    revision: updated.body.revision
  });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.preferences.viewMode, 'flat');
});

test('organization reconcile dry-runs first and only confirmed cleanup removes orphan references', async () => {
  const collectionId = '44444444-4444-4444-8444-444444444444';
  const userDirectory = path.join(DATA_ROOT, 'users', 'user-c');
  await fs.mkdir(userDirectory, { recursive: true });
  await fs.writeFile(path.join(userDirectory, 'library-organization.json'), JSON.stringify({
    version: 1,
    revision: 0,
    updatedAt: null,
    preferences: { viewMode: 'collections' },
    collections: [{ id: collectionId, name: '待整理', createdAt: null, updatedAt: null }],
    unassignedOrder: [UNKNOWN_BOOK_ID],
    collectionOrders: { [collectionId]: [BOOK_ID, UNKNOWN_BOOK_ID] },
    bookAssignments: { [BOOK_ID]: collectionId, [UNKNOWN_BOOK_ID]: collectionId }
  }), 'utf8');

  const before = await request('/app/zhenshu/api/library/organization', {
    headers: userHeaders('user-c')
  });
  assert.deepEqual(before.body.orphanedBookIds, [UNKNOWN_BOOK_ID]);

  const dryRun = await jsonRequest(
    '/app/zhenshu/api/library/organization/reconcile',
    'POST',
    { revision: 0 },
    userHeaders('user-c')
  );
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.dryRun, true);
  assert.equal(dryRun.body.confirmed, false);
  assert.equal(dryRun.body.orphanCount, 1);
  assert.equal(dryRun.body.revision, 0);

  const stillPresent = await request('/app/zhenshu/api/library/organization', {
    headers: userHeaders('user-c')
  });
  assert.deepEqual(stillPresent.body.orphanedBookIds, [UNKNOWN_BOOK_ID]);

  const confirmed = await jsonRequest(
    '/app/zhenshu/api/library/organization/reconcile',
    'POST',
    { revision: 0, confirm: true },
    userHeaders('user-c')
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.dryRun, false);
  assert.equal(confirmed.body.confirmed, true);
  assert.equal(confirmed.body.removedCount, 1);
  assert.equal(confirmed.body.revision, 1);
  assert.deepEqual(confirmed.body.orphanedBookIds, []);
  assert.equal(confirmed.body.collections.length, 1);
  assert.deepEqual(confirmed.body.collectionOrders[collectionId], [BOOK_ID]);
  assert.deepEqual(confirmed.body.unassignedOrder, [SECOND_BOOK_ID]);
});

test('organization reconcile fails closed when the library scan is unhealthy', async () => {
  const libraryPath = path.join(DATA_ROOT, 'index', 'library.json');
  const original = await fs.readFile(libraryPath, 'utf8');
  await fs.writeFile(libraryPath, JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    scan: { status: 'failed', errorCount: 1, rootErrors: ['test'] },
    books: []
  }), 'utf8');
  try {
    const response = await jsonRequest(
      '/app/zhenshu/api/library/organization/reconcile',
      'POST',
      { revision: 0, confirm: true },
      userHeaders('user-d')
    );
    assert.equal(response.status, 503);
    assert.equal(response.body.error, '当前书库扫描未完成，暂不能修改分类');
  } finally {
    await fs.writeFile(libraryPath, original, 'utf8');
  }
});
