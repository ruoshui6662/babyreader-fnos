'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const { createAiIndexManager } = require('../app/server/ai-index-manager');

const BOOK_ID = 'a'.repeat(64);
const ORPHAN_ID = 'b'.repeat(64);
const MISSING_ID = 'c'.repeat(64);

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-ai-index-manager-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function createValidIndex(dataRoot, bookId, fingerprint = 'fingerprint-1') {
  const directory = path.join(dataRoot, 'ai-index');
  const filePath = path.join(directory, bookId + '.sqlite');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filePath);
  db.exec('CREATE TABLE ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  db.exec('CREATE TABLE ai_chunk_text (rowid INTEGER PRIMARY KEY, bodyText TEXT NOT NULL, titleText TEXT NOT NULL, headingsText TEXT NOT NULL);');
  db.exec('CREATE VIRTUAL TABLE ai_chunks USING fts5(title, headings, body, chapterIndex UNINDEXED, chapterHref UNINDEXED, chapterLabel UNINDEXED, startOffset UNINDEXED);');
  const insert = db.prepare('INSERT INTO ai_meta(key, value) VALUES (?, ?)');
  insert.run('schemaVersion', '2');
  insert.run('bookId', bookId);
  insert.run('fingerprint', fingerprint);
  db.close();
  return filePath;
}

test('manager derives safe index paths and rejects invalid book ids', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });

  assert.equal(
    manager.getIndexPath(BOOK_ID),
    path.join(path.resolve(dataRoot), 'ai-index', BOOK_ID + '.sqlite')
  );
  assert.throws(() => manager.getIndexPath('../outside'), (error) => error.code === 'INVALID_BOOK_ID');
  assert.throws(() => manager.getIndexPath('A'.repeat(64)), (error) => error.code === 'INVALID_BOOK_ID');
  assert.throws(() => manager.getIndexPath('a'.repeat(63)), (error) => error.code === 'INVALID_BOOK_ID');
});

test('missing inspection is read-only and does not create a database', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const filePath = manager.getIndexPath(BOOK_ID);

  const result = await manager.inspectIndexFile(filePath);

  assert.equal(result.status, 'missing');
  assert.equal(result.exists, false);
  await assert.rejects(() => fs.access(filePath), { code: 'ENOENT' });
});

test('read-only inspection returns required schema and SQLite size statistics', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const filePath = await createValidIndex(dataRoot, BOOK_ID);
  const manager = createAiIndexManager({ dataRoot });

  const result = await manager.inspectIndexFile(filePath);

  assert.equal(result.status, 'ready');
  assert.equal(result.exists, true);
  assert.deepEqual(result.requiredTables.sort(), ['ai_chunk_text', 'ai_chunks', 'ai_meta']);
  assert.ok(result.sizeBytes > 0);
  assert.ok(result.pageCount > 0);
  assert.ok(result.pageSize > 0);
  assert.ok(Number.isInteger(result.freelistCount));
});

test('read-only inspection exposes the regular file mtime without creating a manifest', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const filePath = await createValidIndex(dataRoot, BOOK_ID);
  const expectedTime = new Date('2026-09-22T00:52:04.000Z');
  await fs.utimes(filePath, expectedTime, expectedTime);
  const manager = createAiIndexManager({ dataRoot });

  const result = await manager.inspectIndexFile(filePath);

  assert.equal(result.modifiedAt, expectedTime.toISOString());
  assert.equal(await fs.stat(manager.getManifestPath()).then(() => true).catch(() => false), false);
});

test('unsafe and missing index inspections never report a modification time', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const directoryPath = manager.getIndexPath(BOOK_ID);
  await fs.mkdir(directoryPath, { recursive: true });

  const unsafe = await manager.inspectIndexFile(directoryPath);
  const missing = await manager.inspectIndexFile(manager.getIndexPath(ORPHAN_ID));

  assert.equal(unsafe.status, 'unsafe');
  assert.equal(unsafe.modifiedAt, null);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.modifiedAt, null);
});

test('recordBuildSuccess writes only non-sensitive manifest metadata atomically', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot, now: () => new Date('2026-09-21T05:11:32.835Z') });
  const filePath = manager.getIndexPath(BOOK_ID);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'sqlite-placeholder');

  await manager.recordBuildSuccess(
    { id: BOOK_ID, title: '测试书', path: path.join(dataRoot, 'secret-book.epub') },
    { filePath, fingerprint: 'fingerprint-1', schemaVersion: 2 }
  );

  const manifestPath = path.join(dataRoot, 'ai-index', 'manifest.json');
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.entries[BOOK_ID], {
    bookId: BOOK_ID,
    sizeBytes: Buffer.byteLength('sqlite-placeholder'),
    indexedAt: '2026-09-21T05:11:32.835Z',
    lastAccessedAt: '2026-09-21T05:11:32.835Z',
    fingerprint: 'fingerprint-1',
    schemaVersion: 2
  });
  assert.equal(manifestText.includes('secret-book.epub'), false);
  assert.equal(manifestText.includes('测试书'), false);
});

test('recordBuildSuccess rejects symbolic link targets', {
  skip: process.platform === 'win32'
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const directory = path.join(dataRoot, 'ai-index');
  const outsidePath = path.join(dataRoot, 'outside.sqlite');
  const linkPath = manager.getIndexPath(BOOK_ID);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(outsidePath, 'outside');
  await fs.symlink(outsidePath, linkPath);

  await assert.rejects(
    () => manager.recordBuildSuccess({ id: BOOK_ID }, {
      filePath: linkPath,
      fingerprint: 'fingerprint-1',
      schemaVersion: 2
    }),
    (error) => error.code === 'INDEX_UNSAFE_TARGET'
  );
});

test('listIndexes distinguishes ready, orphan, and manifest-only missing indexes', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const readyPath = await createValidIndex(dataRoot, BOOK_ID);
  await manager.recordBuildSuccess(
    { id: BOOK_ID },
    { filePath: readyPath, fingerprint: 'fingerprint-1', schemaVersion: 2 }
  );
  await createValidIndex(dataRoot, ORPHAN_ID);
  const missingPath = await createValidIndex(dataRoot, MISSING_ID);
  await manager.recordBuildSuccess(
    { id: MISSING_ID },
    { filePath: missingPath, fingerprint: 'fingerprint-1', schemaVersion: 2 }
  );
  await fs.rm(missingPath);

  const result = await manager.listIndexes({
    libraryIndex: [{ id: BOOK_ID, title: '测试书', type: 'txt' }],
    scanHealthy: true
  });
  const byId = new Map(result.items.map((item) => [item.bookId, item]));

  assert.equal(byId.get(BOOK_ID).status, 'ready');
  assert.equal(byId.get(ORPHAN_ID).status, 'orphan');
  assert.equal(byId.get(MISSING_ID).status, 'missing');
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.orphan, 1);
  assert.equal(result.summary.missing, 1);
});

test('listIndexes falls back to file mtime for legacy indexes and does not write a manifest', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const filePath = await createValidIndex(dataRoot, BOOK_ID);
  const expectedTime = new Date('2026-09-22T00:52:04.000Z');
  await fs.utimes(filePath, expectedTime, expectedTime);
  const manager = createAiIndexManager({ dataRoot });

  const result = await manager.listIndexes({
    libraryIndex: [{ id: BOOK_ID, title: '旧索引书', type: 'epub' }],
    scanHealthy: true
  });
  const item = result.items.find((entry) => entry.bookId === BOOK_ID);

  assert.equal(item.indexedAt, expectedTime.toISOString());
  assert.equal(item.indexedAtSource, 'file-mtime');
  await assert.rejects(() => fs.access(manager.getManifestPath()), { code: 'ENOENT' });
});

test('malformed manifest is recoverable without deleting a valid index', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const directory = path.join(dataRoot, 'ai-index');
  await fs.mkdir(directory, { recursive: true });
  const filePath = await createValidIndex(dataRoot, BOOK_ID);
  await fs.writeFile(path.join(directory, 'manifest.json'), '{not-json');
  const manager = createAiIndexManager({ dataRoot });

  const result = await manager.listIndexes({
    libraryIndex: [{ id: BOOK_ID, title: '测试书', type: 'txt' }],
    scanHealthy: true
  });

  assert.equal(result.items.find((item) => item.bookId === BOOK_ID).status, 'ready');
  await fs.access(filePath);
});

test('unhealthy library scan refuses to infer orphan indexes', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  await createValidIndex(dataRoot, ORPHAN_ID);
  const manager = createAiIndexManager({ dataRoot });

  const result = await manager.listIndexes({ libraryIndex: [], scanHealthy: false });

  assert.equal(result.scanHealthy, false);
  assert.equal(result.summary.orphan, 0);
  assert.equal(result.items.find((item) => item.bookId === ORPHAN_ID).status, 'unknown');
});

test('orphan cleanup removes manifest-only entries and keeps active indexes for retry', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const orphanPath = await createValidIndex(dataRoot, ORPHAN_ID);
  await manager.recordBuildSuccess(
    { id: ORPHAN_ID },
    { filePath: orphanPath, fingerprint: 'fingerprint-1', schemaVersion: 2 }
  );
  await fs.rm(orphanPath);

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const build = manager.withBuildLease(BOOK_ID, () => gate);
  const activePath = await createValidIndex(dataRoot, BOOK_ID);

  const first = await manager.cleanup({
    kind: 'orphans',
    libraryIndex: [],
    scanHealthy: true,
    confirm: true
  });

  assert.deepEqual(first.manifestRemoved, [ORPHAN_ID]);
  assert.equal(first.skipped.length, 1);
  assert.equal(first.skipped[0].reason, 'INDEX_BUSY');
  await fs.access(activePath);
  release();
  await build;

  const second = await manager.cleanup({
    kind: 'orphans',
    libraryIndex: [],
    scanHealthy: true,
    confirm: true
  });
  assert.equal(second.deleted.length, 1);
  await assert.rejects(() => fs.access(activePath), { code: 'ENOENT' });
  const manifest = JSON.parse(await fs.readFile(manager.getManifestPath(), 'utf8'));
  assert.equal(manifest.entries[ORPHAN_ID], undefined);
});

test('orphan cleanup leaves current, invalid, non-SQLite, directory, and link targets untouched', {
  skip: process.platform === 'win32'
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const currentPath = await createValidIndex(dataRoot, BOOK_ID);
  const directory = path.dirname(currentPath);
  const invalidPath = path.join(directory, 'not-a-book.sqlite');
  const directoryPath = path.join(directory, MISSING_ID + '.sqlite');
  const nonSqlitePath = path.join(directory, ORPHAN_ID + '.txt');
  const linkPath = path.join(directory, ORPHAN_ID + '.sqlite');
  const outsidePath = path.join(dataRoot, 'outside.sqlite');
  await fs.writeFile(invalidPath, 'invalid-name');
  await fs.mkdir(directoryPath);
  await fs.writeFile(nonSqlitePath, 'not-an-index');
  await fs.writeFile(outsidePath, 'outside');
  await fs.symlink(outsidePath, linkPath);

  await manager.cleanup({
    kind: 'orphans',
    libraryIndex: [{ id: BOOK_ID }],
    scanHealthy: true,
    confirm: true
  });

  await fs.access(currentPath);
  await fs.access(invalidPath);
  await fs.access(directoryPath);
  await fs.access(nonSqlitePath);
  await fs.access(linkPath);
  await fs.access(outsidePath);
});

test('build leases serialize the same book and release after failures', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = manager.withBuildLease(BOOK_ID, async () => {
    calls += 1;
    await gate;
    return 'built';
  });
  const second = manager.withBuildLease(BOOK_ID, async () => {
    calls += 1;
    return 'unexpected';
  });

  release();
  assert.equal(await first, 'built');
  assert.equal(await second, 'built');
  assert.equal(calls, 1);
  assert.deepEqual(manager.leaseState(BOOK_ID), { building: false, readers: 0 });

  await assert.rejects(
    () => manager.withBuildLease(BOOK_ID, async () => {
      throw new Error('build failed');
    }),
    /build failed/
  );
  assert.deepEqual(manager.leaseState(BOOK_ID), { building: false, readers: 0 });
});

test('publishIndex replaces an existing index without deleting it on failure', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const targetPath = manager.getIndexPath(BOOK_ID);
  const temporaryPath = targetPath + '.build.tmp';
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, 'old-index');
  await fs.writeFile(temporaryPath, 'new-index');

  await manager.publishIndex(temporaryPath, targetPath);
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'new-index');
  await assert.rejects(() => fs.access(temporaryPath), { code: 'ENOENT' });

  await assert.rejects(
    () => manager.publishIndex(targetPath + '.missing.tmp', targetPath),
    (error) => error.code !== 'INDEX_UNSAFE_TARGET'
  );
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'new-index');
});

test('temporary cleanup removes only expired inactive build files', async (t) => {
  const now = new Date('2026-09-21T05:11:32.835Z');
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot, now: () => now });
  const oldPath = manager.getIndexPath(BOOK_ID) + '.123.1.tmp';
  const freshPath = manager.getIndexPath(ORPHAN_ID) + '.123.1.tmp';
  await fs.mkdir(path.dirname(oldPath), { recursive: true });
  await fs.writeFile(oldPath, 'old');
  await fs.writeFile(freshPath, 'fresh');
  await fs.utimes(oldPath, new Date('2026-09-19T05:11:32.835Z'), new Date('2026-09-19T05:11:32.835Z'));

  const result = await manager.cleanup({ kind: 'temporary', confirm: true, scanHealthy: false });

  assert.equal(result.deleted.length, 1);
  await assert.rejects(() => fs.access(oldPath), { code: 'ENOENT' });
  await fs.access(freshPath);
});

test('temporary cleanup skips files belonging to an active build lease', async (t) => {
  const now = new Date('2026-09-21T05:11:32.835Z');
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot, now: () => now });
  const temporaryPath = manager.getIndexPath(BOOK_ID) + '.123.1.tmp';
  await fs.mkdir(path.dirname(temporaryPath), { recursive: true });
  await fs.writeFile(temporaryPath, 'active');
  await fs.utimes(temporaryPath, new Date('2026-09-19T05:11:32.835Z'), new Date('2026-09-19T05:11:32.835Z'));

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const build = manager.withBuildLease(BOOK_ID, () => gate);
  const result = await manager.cleanup({ kind: 'temporary', confirm: true, scanHealthy: false });
  release();
  await build;

  assert.equal(result.deleted.length, 0);
  assert.equal(result.skipped[0].reason, 'INDEX_BUSY');
  await fs.access(temporaryPath);
});

test('corrupt SQLite files are reported without destructive repair', {
  skip: !DatabaseSync
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const manager = createAiIndexManager({ dataRoot });
  const filePath = manager.getIndexPath(BOOK_ID);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'not sqlite');

  const result = await manager.inspectIndexFile(filePath);

  assert.equal(result.status, 'corrupt');
  assert.equal(await fs.readFile(filePath, 'utf8'), 'not sqlite');
});
