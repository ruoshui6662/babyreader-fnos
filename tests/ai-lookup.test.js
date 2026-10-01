'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildEpub } = require('./fixtures/ai-book-qa/book');
const { searchBook, toFtsAllTermsQuery } = require('../app/server/ai-fts');
const { evaluatePlan, searchKeywords } = require('../app/server/ai-answer-pipeline');

function sandboxBook(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-lookup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'book.epub');
  fs.writeFileSync(file, buildEpub());
  return { dataRoot: dir, book: { id: crypto.createHash('sha256').update(dir).digest('hex'), path: file, type: 'epub', title: '山居茶事' } };
}

test('question wording is stripped before searching', () => {
  assert.deepEqual(searchKeywords('明前尖的价格是雨前茶的几倍？'), ['明前尖', '价格', '雨前茶']);
  assert.deepEqual(searchKeywords('这本书的作者是谁？'), []);
  assert.deepEqual(searchKeywords('请问陈平安的师父是谁'), ['陈平安', '师父']);
});

test('the all-keywords query requires every keyword but any of its terms', () => {
  assert.equal(toFtsAllTermsQuery(['明前尖', '价格']), '("明前" OR "前尖") AND ("价格")');
  assert.equal(toFtsAllTermsQuery([]), '');
});

test('a strict search that finds nothing does not fall back to scanning the book', async (t) => {
  const { book, dataRoot } = sandboxBook(t);
  const strict = await searchBook(book, dataRoot, { query: '不存在', ftsQuery: toFtsAllTermsQuery(['量子', '纠缠']), lexicalFallback: false });
  assert.deepEqual(strict.matches, []);
  const strictHit = await searchBook(book, dataRoot, { query: '明前尖 价格', ftsQuery: toFtsAllTermsQuery(['明前尖', '价格']), lexicalFallback: false });
  assert.ok(strictHit.matches[0].text.includes('明前尖'));
  assert.ok(Number.isSafeInteger(strictHit.matches[0].rowid));
});

test('lookup evidence grows each hit into its surrounding passage', async (t) => {
  const { book, dataRoot } = sandboxBook(t);
  const outcome = await evaluatePlan({ book, dataRoot, question: '陈守义用什么来烘焙茶叶？' });
  assert.equal(outcome.type, 'lookup');
  const first = outcome.evidence[0];
  assert.match(first.text, /松枝的余火/);
  // Index chunks are 900 characters; an expanded passage spans its neighbours.
  assert.ok(first.text.length > 1200, String(first.text.length));
  assert.ok(outcome.evidence.reduce((sum, item) => sum + item.text.length, 0) <= 14000);
});
