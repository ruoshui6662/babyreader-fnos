'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildEpub } = require('./fixtures/ai-book-qa/book');
const { readAllPassages, readBookOutline } = require('../app/server/ai-fts');
const { createEmbeddingService, dequantize, embedTexts, quantize } = require('../app/server/ai-embeddings');
const { evaluatePlan } = require('../app/server/ai-answer-pipeline');

const settings = { configured: true, model: 'embed-model', baseUrl: 'https://93.184.216.34/v1', apiKey: 'embed-key' };

// A deterministic stand-in for an embedding model: a few “concepts”, each a
// set of phrases that mean the same thing, become vector dimensions.
const CONCEPTS = [
  ['七年', '多少年', '住了多久'],
  ['松枝', '烘焙'],
  ['茶会', '聚会'],
  ['明前', '价格']
];
function fakeVector(text) {
  const vector = CONCEPTS.map((phrases) => (phrases.some((phrase) => String(text).includes(phrase)) ? 1 : 0));
  vector.push(0.05);
  return Float32Array.from(vector);
}
function fakeEmbed(calls) {
  return async ({ texts }) => {
    calls.push(texts.length);
    return texts.map(fakeVector);
  };
}

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-embeddings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'book.epub');
  fs.writeFileSync(file, buildEpub());
  return { dataRoot: dir, book: { id: crypto.createHash('sha256').update(dir).digest('hex'), path: file, type: 'epub', title: '山居茶事' } };
}

test('int8 quantisation keeps cosine similarity', () => {
  const random = (seed) => Float32Array.from({ length: 256 }, (_, index) => Math.sin(seed * 31 + index * 7.3));
  const left = random(1);
  const right = random(2);
  const cosine = (a, b) => {
    let dot = 0; let na = 0; let nb = 0;
    for (let index = 0; index < a.length; index += 1) { dot += a[index] * b[index]; na += a[index] ** 2; nb += b[index] ** 2; }
    return dot / Math.sqrt(na * nb);
  };
  const ql = quantize(left);
  const qr = quantize(right);
  assert.equal(ql.bytes.length, 256);
  const approx = cosine(dequantize(ql.bytes, ql.scale), dequantize(qr.bytes, qr.scale));
  assert.ok(Math.abs(approx - cosine(left, right)) < 0.02, `${approx} vs ${cosine(left, right)}`);
});

test('the embeddings client posts to /embeddings and keeps the input order', async () => {
  let captured;
  const vectors = await embedTexts({
    texts: ['甲', '乙'],
    settings,
    lookupImpl: async () => ({ address: '93.184.216.34' }),
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body), auth: options.headers.Authorization };
      return { ok: true, status: 200, json: async () => ({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }) };
    }
  });
  assert.equal(captured.url, 'https://93.184.216.34/v1/embeddings');
  assert.deepEqual(captured.body, { model: 'embed-model', input: ['甲', '乙'] });
  assert.equal(captured.auth, 'Bearer embed-key');
  assert.deepEqual([...vectors[0]], [1, 0]);
  await assert.rejects(embedTexts({
    texts: ['甲'], settings, lookupImpl: async () => ({ address: '93.184.216.34' }),
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
  }), /401/);
  await assert.rejects(embedTexts({ texts: ['甲'], settings: { configured: false } }), /尚未配置/);
});

test('a book is embedded once in batches, stored, and searched by meaning', async (t) => {
  const { book, dataRoot } = sandbox(t);
  const calls = [];
  const service = createEmbeddingService({ dataRoot, readPassages: (target) => readAllPassages(target, dataRoot), embed: fakeEmbed(calls) });
  assert.equal((await service.status(book, settings)).state, 'none');
  assert.equal((await service.status(book, { configured: false })).state, 'off');
  await service.run(book, settings);
  const passages = await readAllPassages(book, dataRoot);
  assert.equal(calls.reduce((sum, count) => sum + count, 0) <= passages.length, true);
  assert.ok(calls.every((count) => count <= 32));
  assert.equal((await service.status(book, settings)).state, 'ready');

  const hits = await service.search(book, settings, '作者在山里住了多久？', { limit: 3 });
  const rows = new Map(passages.map((item) => [item.rowid, item.text]));
  assert.match(rows.get(hits[0].rowid), /七年/);

  // Limited to a chapter's rows.
  const { nodes } = await readBookOutline(book, dataRoot);
  const chapter = nodes.find((node) => node.label === '第二章 采茶的时令');
  const scoped = await service.search(book, settings, '松枝烘焙', { rowRanges: [[chapter.firstRow, chapter.lastRow]] });
  assert.ok(scoped.every((hit) => hit.rowid >= chapter.firstRow && hit.rowid <= chapter.lastRow));

  // Another service (another request) reuses the stored vectors.
  const again = [];
  const second = createEmbeddingService({ dataRoot, readPassages: (target) => readAllPassages(target, dataRoot), embed: fakeEmbed(again) });
  await second.run(book, settings);
  assert.deepEqual(again, []);
  assert.ok(fs.existsSync(path.join(dataRoot, 'ai-vectors', `${book.id}.sqlite`)));
});

test('semantic matches join keyword search for differently worded questions', async (t) => {
  const { book, dataRoot } = sandbox(t);
  const service = createEmbeddingService({ dataRoot, readPassages: (target) => readAllPassages(target, dataRoot), embed: fakeEmbed([]) });
  await service.run(book, settings);
  const question = '作者在山里住了多久？';
  const keywordOnly = await evaluatePlan({ book, dataRoot, question });
  const hybrid = await evaluatePlan({ book, dataRoot, question, live: { semantic: { service, settings } } });
  const rank = (outcome) => outcome.evidence.findIndex((item) => item.text.includes('住满七年'));
  assert.ok(rank(hybrid) >= 0, 'the passage is found with semantic retrieval');
  assert.ok(rank(keywordOnly) === -1 || rank(hybrid) <= rank(keywordOnly));
});

test('background embedding starts only for ordinary-sized books', async (t) => {
  const { book, dataRoot } = sandbox(t);
  const calls = [];
  const huge = createEmbeddingService({
    dataRoot,
    readPassages: async () => Array.from({ length: 3000 }, (_, index) => ({ rowid: index + 1, text: `段落${index}`.padEnd(900, '文') })),
    embed: fakeEmbed(calls)
  });
  const status = await huge.status(book, settings);
  assert.equal(status.automatic, false);
  await huge.ensureInBackground(book, settings);
  assert.equal(huge.isRunning(book.id), false);
  assert.deepEqual(calls, []);
});
