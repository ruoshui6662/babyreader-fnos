'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fingerprintBook } = require('../app/server/library');
const { extractEpubMetadata } = require('../app/server/library');
const { createMobiDerivedStore } = require('../app/server/mobi-derived');
const { MOBI_CONVERTER_VERSION } = require('../app/server/mobi-convert');
const { createMobiFixture, createDrmMobiFixture } = require('./fixtures/mobi-fixtures');

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-mobi-derived-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function bookFor(root, name, bytes, id) {
  const file = path.join(root, name);
  await fs.writeFile(file, bytes);
  return { id, type: 'mobi', path: file, fingerprint: fingerprintBook(file, await fs.stat(file)) };
}

test('first use converts in a worker, then serves the cached artifact without reconverting', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root });
  const book = await bookFor(root, 'a.mobi', createMobiFixture({ title: '缓存' }), 'a'.repeat(64));
  const first = await store.ensure(book);
  assert.equal(first.status, 'ready');
  assert.match(path.basename(first.path), new RegExp(`^${book.id}\\.[a-f0-9]{16}\\.c${MOBI_CONVERTER_VERSION}\\.epub$`));
  assert.equal((await fs.stat(first.path)).mode & 0o777 & (process.platform === 'win32' ? 0 : 0o077), 0);
  assert.equal(extractEpubMetadata(await fs.readFile(first.path)).title, '缓存');
  const second = await store.ensure(book);
  assert.equal(second.path, first.path);
  assert.equal(store.stats.conversions, 1);
});

test('concurrent requests share one conversion', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root });
  const book = await bookFor(root, 'b.mobi', createMobiFixture(), 'b'.repeat(64));
  const results = await Promise.all([store.ensure(book), store.ensure(book), store.ensure(book)]);
  assert.deepEqual(new Set(results.map((result) => result.path)).size, 1);
  assert.equal(store.stats.conversions, 1);
});

test('a short wait reports preparing and the conversion still completes', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root });
  const book = await bookFor(root, 'c.mobi', createMobiFixture(), 'c'.repeat(64));
  assert.deepEqual(await store.ensure(book, { waitMs: 0 }), { status: 'preparing' });
  assert.equal((await store.ensure(book)).status, 'ready');
  assert.equal(store.stats.conversions, 1);
});

test('a changed source is refused instead of serving or caching stale content', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root });
  const book = await bookFor(root, 'd.mobi', createMobiFixture(), 'd'.repeat(64));
  await fs.appendFile(book.path, Buffer.from('changed'));
  await assert.rejects(store.ensure(book), (error) => error.code === 'SOURCE_CHANGED');
  assert.deepEqual(await fs.readdir(store.directory).catch(() => []), []);
});

test('worker failures surface typed codes, leave no files and are memoized', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root });
  const book = await bookFor(root, 'e.mobi', createDrmMobiFixture(), 'e'.repeat(64));
  await assert.rejects(store.ensure(book), (error) => error.code === 'DRM_PROTECTED');
  await assert.rejects(store.ensure(book), (error) => error.code === 'DRM_PROTECTED');
  assert.equal(store.stats.conversions, 1, 'failure is memoized');
  assert.deepEqual((await fs.readdir(store.directory).catch(() => [])).filter((name) => !name.startsWith('.')), []);
});

test('a conversion over its time limit is terminated with TIMEOUT', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root, limits: { maxDurationMs: 1 } });
  const book = await bookFor(root, 'f.mobi', createMobiFixture(), 'f'.repeat(64));
  await assert.rejects(store.ensure(book), (error) => error.code === 'TIMEOUT');
  assert.deepEqual(await fs.readdir(store.directory).catch(() => []), []);
});

test('prune keeps current artifacts and removes gone, changed and other-version files', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root });
  const keep = await bookFor(root, 'g.mobi', createMobiFixture(), '1'.repeat(64));
  const gone = await bookFor(root, 'h.mobi', createMobiFixture(), '2'.repeat(64));
  const kept = (await store.ensure(keep)).path;
  await store.ensure(gone);
  const oldVersion = path.join(store.directory, `${keep.id}.0000000000000000.c0.epub`);
  const stray = path.join(store.directory, 'notes.txt');
  await fs.writeFile(oldVersion, 'old');
  await fs.writeFile(stray, 'not ours');
  const result = await store.prune([keep, { ...gone, error: 'missing' }]);
  assert.equal(result.removed, 2);
  assert.deepEqual((await fs.readdir(store.directory)).sort(), [path.basename(kept), 'notes.txt'].sort());
});

test('prune trims least recently used artifacts to the cache size cap', async (t) => {
  const root = await sandbox(t);
  const store = createMobiDerivedStore({ dataRoot: root, limits: { maxCacheBytes: 1 } });
  const book = await bookFor(root, 'i.mobi', createMobiFixture(), '3'.repeat(64));
  await store.ensure(book);
  const result = await store.prune([book]);
  assert.equal(result.removed, 1);
  assert.equal(result.bytes, 0);
});

test('a conversion that exhausts its worker heap fails alone; the service process survives', async (t) => {
  const root = await sandbox(t);
  const { createLargeMobiFixture } = require('./fixtures/mobi-fixtures');
  const store = createMobiDerivedStore({ dataRoot: root, limits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2 } });
  const book = await bookFor(root, 'big.mobi', createLargeMobiFixture({ targetBytes: 4 * 1024 * 1024 }), '4'.repeat(64));
  await assert.rejects(store.ensure(book), (error) => ['TOO_LARGE', 'CONVERSION_FAILED'].includes(error.code));
  assert.ok(process.memoryUsage().rss > 0, 'main thread still running');
  assert.deepEqual((await fs.readdir(store.directory).catch(() => [])).filter((name) => name.endsWith('.epub')), []);
});
