'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildAiSummaryCacheKey, createAiSummaryCache } = require('../app/server/ai-summary-cache');
const {
  getOrCreateChapterSummary,
  getOrCreateChapterSummarySegment,
  indexPath,
  isFtsAvailable
} = require('../app/server/ai-fts');
const { createAiIndexManager } = require('../app/server/ai-index-manager');

function cacheDimensions(overrides = {}) {
  return {
    userId: 'user-a',
    bookFingerprint: 'book-content-v1',
    logicalChapterId: 'chapter-1',
    parserVersion: '2',
    strategyVersion: 'chapter-map-reduce-v1',
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'reader-model',
    promptVersion: 'chapter-summary-prompt-v1',
    ...overrides
  };
}

test('summary cache key is stable and every content, parser, strategy, model, prompt, and user dimension invalidates it', () => {
  const baseline = buildAiSummaryCacheKey(cacheDimensions());
  assert.deepEqual(buildAiSummaryCacheKey(cacheDimensions()), baseline);
  for (const field of [
    'userId', 'bookFingerprint', 'logicalChapterId', 'parserVersion',
    'strategyVersion', 'provider', 'baseUrl', 'model', 'promptVersion'
  ]) {
    assert.notEqual(buildAiSummaryCacheKey(cacheDimensions({ [field]: `changed-${field}` })).cacheKey, baseline.cacheKey, field);
  }
  assert.equal(baseline.userKey.length, 64);
  assert.equal(JSON.stringify(baseline).includes('user-a'), false);
});

test('concurrent identical chapter summaries share one build and persist only the completed result', async () => {
  let stored = null;
  let buildCount = 0;
  const cache = createAiSummaryCache();
  const options = {
    key: 'cache-key',
    read: async () => stored,
    write: async (_key, value) => { stored = value; },
    build: async () => {
      buildCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { answer: '章节总结', summaryMode: 'map_reduce', coverage: { ratio: 1 } };
    }
  };
  const [first, second] = await Promise.all([cache.getOrCreate(options), cache.getOrCreate(options)]);
  assert.equal(buildCount, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, false);
  assert.equal(stored.answer, '章节总结');
  const third = await cache.getOrCreate(options);
  assert.equal(third.cacheHit, true);
  assert.equal(buildCount, 1);
});

test('failed, cancelled, or empty summary builds are never written and can be retried', async () => {
  let writes = 0;
  const cache = createAiSummaryCache();
  const base = { key: 'failure-key', read: async () => null, write: async () => { writes += 1; } };
  await assert.rejects(cache.getOrCreate({ ...base, build: async () => { throw new Error('provider failed'); } }), /provider failed/);
  await assert.rejects(cache.getOrCreate({ ...base, build: async () => ({ answer: '   ' }) }), { code: 'AI_SUMMARY_EMPTY' });
  const success = await cache.getOrCreate({ ...base, build: async () => ({ answer: '重试成功' }) });
  assert.equal(success.answer, '重试成功');
  assert.equal(writes, 1);
});

test('SQLite cache partitions users and invalidates on fingerprint changes; index deletion removes its summaries', {
  skip: !isFtsAvailable()
}, async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-summary-cache-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const bookPath = path.join(dataRoot, 'cache-book.txt');
  await fs.writeFile(bookPath, '章节摘要缓存生命周期测试内容。', 'utf8');
  const book = { id: 'c'.repeat(64), path: bookPath, type: 'txt', title: '缓存生命周期' };
  let buildCount = 0;
  const getSummary = (overrides = {}) => getOrCreateChapterSummary({
    book,
    dataRoot,
    userId: 'user-a',
    logicalChapterId: 'chapter-a',
    bookFingerprint: 'fingerprint-a',
    parserVersion: '2',
    baseUrl: 'https://api.example.test/v1',
    model: 'reader-model',
    ...overrides,
    build: async () => {
      buildCount += 1;
      return { answer: `答案${buildCount}`, summaryMode: 'complete', coverage: { ratio: 1 } };
    }
  });
  assert.equal((await getSummary()).cacheHit, false);
  assert.equal((await getSummary()).cacheHit, true);
  assert.equal((await getSummary({ userId: 'user-b' })).cacheHit, false);
  assert.equal((await getSummary({ bookFingerprint: 'fingerprint-b' })).cacheHit, false);
  assert.equal(buildCount, 3);
  const mapTask = { text: '分段证据 A', sourceIds: ['source-1'], chapterHref: 'OPS/ch.xhtml', start: 0 };
  const mapOptions = {
    book,
    dataRoot,
    userId: 'user-a',
    logicalChapterId: 'chapter-a',
    parserVersion: '2',
    baseUrl: 'https://api.example.test/v1',
    model: 'reader-model',
    task: mapTask,
    build: async () => ({ answer: `分段摘要${buildCount += 1}` })
  };
  assert.equal((await getOrCreateChapterSummarySegment(mapOptions)).cacheHit, false);
  assert.equal((await getOrCreateChapterSummarySegment(mapOptions)).cacheHit, true);
  assert.equal((await getOrCreateChapterSummarySegment({
    ...mapOptions,
    task: { ...mapTask, text: '分段证据已更改' }
  })).cacheHit, false);
  assert.equal(buildCount, 5);

  await fs.writeFile(bookPath, '章节摘要缓存生命周期测试内容已更新。', 'utf8');
  await getSummary({ bookFingerprint: 'fingerprint-c' });
  assert.equal((await getOrCreateChapterSummarySegment(mapOptions)).cacheHit, true);

  const DatabaseSync = require('node:sqlite').DatabaseSync;
  const db = new DatabaseSync(indexPath(dataRoot, book.id), { readOnly: true });
  const count = Number(db.prepare('SELECT COUNT(*) AS count FROM ai_chapter_summary_cache').get().count);
  const serialized = db.prepare('SELECT summaryJson FROM ai_chapter_summary_cache').all().map((row) => row.summaryJson).join(' ');
  db.close();
  assert.equal(count, 3);
  assert.doesNotMatch(serialized, /user-a|user-b/);

  const manager = createAiIndexManager({ dataRoot, schemaVersion: 7 });
  await manager.deleteIndex(book.id);
  await assert.rejects(fs.stat(indexPath(dataRoot, book.id)), { code: 'ENOENT' });
});
