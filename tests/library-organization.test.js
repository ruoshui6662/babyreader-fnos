'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { UserStorage } = require('../app/server/storage');
const {
  MAX_COLLECTIONS,
  createEmptyLibraryOrganization,
  normalizeLibraryOrganization,
  reconcileLibraryOrganization,
  resolveLibraryOrganization
} = require('../app/server/library-organization');

const BOOK_A = 'a'.repeat(64);
const BOOK_B = 'b'.repeat(64);
const BOOK_C = 'c'.repeat(64);
const BOOK_MISSING = 'd'.repeat(64);
const COLLECTION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_COLLECTION_ID = '22222222-2222-4222-8222-222222222222';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-library-org-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function collection(id, name, position = 0) {
  return {
    id,
    name,
    position,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z'
  };
}

function organizationWithCollection() {
  return {
    ...createEmptyLibraryOrganization(),
    revision: 4,
    collections: [collection(COLLECTION_ID, '待读')],
    unassignedOrder: [BOOK_B, BOOK_C],
    collectionOrders: { [COLLECTION_ID]: [BOOK_A] },
    bookAssignments: { [BOOK_A]: COLLECTION_ID }
  };
}

test('empty organization is created per user with private atomic file permissions', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = new UserStorage(dataRoot);
  await storage.initialize();

  const first = await storage.getLibraryOrganization('alice');
  const second = await storage.getLibraryOrganization('bob');
  assert.equal(first.version, 1);
  assert.equal(first.revision, 0);
  assert.deepEqual(first.collections, []);
  assert.deepEqual(first.unassignedOrder, []);
  assert.deepEqual(second.collections, []);

  await storage.mutateLibraryOrganization('alice', first.revision, (state) => {
    state.collections.push(collection(COLLECTION_ID, '待读'));
    state.collectionOrders[COLLECTION_ID] = [BOOK_A];
    state.bookAssignments[BOOK_A] = COLLECTION_ID;
  });

  const filePath = path.join(dataRoot, 'users', 'alice', 'library-organization.json');
  const userDirectory = path.dirname(filePath);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(userDirectory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  }
  assert.equal((await storage.getLibraryOrganization('bob')).collections.length, 0);
  assert.deepEqual((await storage.getLibraryOrganization('alice')).bookAssignments, {
    [BOOK_A]: COLLECTION_ID
  });
});

test('organization normalization rejects unsafe IDs, names, duplicate names, and collection overflow', () => {
  const empty = createEmptyLibraryOrganization();
  assert.throws(() => normalizeLibraryOrganization({
    ...empty,
    collections: [collection('not-a-uuid', '无效')]
  }), (error) => error.code === 'INVALID_ORGANIZATION');
  assert.throws(() => normalizeLibraryOrganization({
    ...empty,
    collections: [collection(COLLECTION_ID, '   ')]
  }), (error) => error.code === 'INVALID_ORGANIZATION');
  assert.throws(() => normalizeLibraryOrganization({
    ...empty,
    collections: [
      collection(COLLECTION_ID, '相同名称'),
      collection(SECOND_COLLECTION_ID, '相同名称')
    ]
  }), (error) => error.code === 'INVALID_ORGANIZATION');

  const tooMany = createEmptyLibraryOrganization();
  tooMany.collections = Array.from({ length: MAX_COLLECTIONS + 1 }, (_, index) => collection(
    `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    `分类${index}`,
    index
  ));
  assert.throws(() => normalizeLibraryOrganization(tooMany), (error) => error.code === 'INVALID_ORGANIZATION');
});

test('organization normalization keeps one assignment and deduplicates order references', () => {
  const normalized = normalizeLibraryOrganization({
    ...createEmptyLibraryOrganization(),
    collections: [collection(COLLECTION_ID, '待读'), collection(SECOND_COLLECTION_ID, '已读', 1)],
    unassignedOrder: [BOOK_A, BOOK_A, BOOK_B, 'not-a-book-id'],
    collectionOrders: {
      [COLLECTION_ID]: [BOOK_A, BOOK_A, BOOK_C],
      [SECOND_COLLECTION_ID]: [BOOK_C]
    },
    bookAssignments: {
      [BOOK_A]: COLLECTION_ID,
      [BOOK_C]: SECOND_COLLECTION_ID,
      [BOOK_MISSING]: COLLECTION_ID
    }
  });

  assert.deepEqual(normalized.unassignedOrder, [BOOK_B]);
  assert.deepEqual(normalized.collectionOrders[COLLECTION_ID], [BOOK_A, BOOK_MISSING]);
  assert.deepEqual(normalized.collectionOrders[SECOND_COLLECTION_ID], [BOOK_C]);
  assert.equal(normalized.bookAssignments[BOOK_MISSING], COLLECTION_ID);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.bookAssignments, 'not-a-book-id'), false);
});

test('resolver filters missing books, appends new books, and never writes organization state', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = new UserStorage(dataRoot);
  await storage.initialize();
  await storage.mutateLibraryOrganization('alice', 0, (state) => Object.assign(state, organizationWithCollection()));

  const before = await storage.getLibraryOrganization('alice');
  const resolved = resolveLibraryOrganization([
    { id: BOOK_A, title: 'A', type: 'txt' },
    { id: BOOK_B, title: 'B', type: 'txt' },
    { id: BOOK_C, title: 'C', type: 'txt', error: 'unreadable' },
    { id: BOOK_MISSING, title: 'missing', type: 'txt' }
  ], before);

  assert.deepEqual(resolved.collectionOrders[COLLECTION_ID], [BOOK_A]);
  assert.deepEqual(resolved.unassignedOrder, [BOOK_B, BOOK_MISSING]);
  assert.deepEqual(new Set(resolved.orphanedBookIds), new Set([BOOK_C]));
  assert.equal(resolved.organization.revision, before.revision);
  assert.deepEqual(await storage.getLibraryOrganization('alice'), before);
});

test('reconcile removes only orphan references and preserves collections and active ordering', () => {
  const normalized = normalizeLibraryOrganization({
    ...createEmptyLibraryOrganization(),
    collections: [collection(COLLECTION_ID, '待读')],
    collectionOrders: { [COLLECTION_ID]: [BOOK_A, BOOK_MISSING] },
    unassignedOrder: [BOOK_B, BOOK_MISSING],
    bookAssignments: { [BOOK_A]: COLLECTION_ID, [BOOK_MISSING]: COLLECTION_ID }
  });

  const result = reconcileLibraryOrganization(normalized, new Set([BOOK_A, BOOK_B]));
  assert.deepEqual(result.orphanedBookIds, [BOOK_MISSING]);
  assert.deepEqual(result.organization.collections.map((item) => item.name), ['待读']);
  assert.deepEqual(result.organization.collectionOrders[COLLECTION_ID], [BOOK_A]);
  assert.deepEqual(result.organization.unassignedOrder, [BOOK_B]);
  assert.deepEqual(result.organization.bookAssignments, { [BOOK_A]: COLLECTION_ID });
});

test('concurrent writes for one user serialize revisions while users stay isolated', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = new UserStorage(dataRoot);
  await storage.initialize();

  const writes = await Promise.allSettled([
    storage.mutateLibraryOrganization('alice', 0, (state) => {
      state.unassignedOrder.push(BOOK_A);
    }),
    storage.mutateLibraryOrganization('alice', 0, (state) => {
      state.unassignedOrder.push(BOOK_B);
    }),
    storage.mutateLibraryOrganization('bob', 0, (state) => {
      state.unassignedOrder.push(BOOK_C);
    })
  ]);

  assert.equal(writes.filter((item) => item.status === 'fulfilled').length, 2);
  assert.equal(writes.filter((item) => item.status === 'rejected')
    .every((item) => item.reason.code === 'ORGANIZATION_CONFLICT'), true);
  assert.equal((await storage.getLibraryOrganization('alice')).revision, 1);
  assert.equal((await storage.getLibraryOrganization('bob')).revision, 1);
});

test('corrupt organization JSON fails closed and is not overwritten', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = new UserStorage(dataRoot);
  await storage.initialize();
  const filePath = path.join(dataRoot, 'users', 'alice', 'library-organization.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const corrupt = '{"version":1,"collections":';
  await fs.writeFile(filePath, corrupt, { encoding: 'utf8', mode: 0o600 });

  await assert.rejects(
    storage.getLibraryOrganization('alice'),
    (error) => error.code === 'ORGANIZATION_STORE_CORRUPT'
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), corrupt);
});
