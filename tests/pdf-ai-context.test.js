'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPdfFixture, createImageOnlyPdfFixture } = require('./fixtures/pdf-fixtures');
const { searchPdfEvidenceRows } = require('../app/server/ai-fts');
const { extractPdfText } = require('../app/server/pdf-text');
const { buildPdfResponsesPayload } = require('../app/server/ai-service');
const {
  PDF_AI_LIMITS,
  PDF_AI_STRUCTURE_LIMITS,
  pdfAiStructuredRetrievalEnabled,
  validatePdfAiRequest,
  buildPdfAiContext,
  pdfAiSources
} = require('../app/server/pdf-ai-context');

test('PDF AI request rejects fake evidence and ambiguous chapter scope', () => {
  assert.throws(() => validatePdfAiRequest({ question: '本章讲什么', scope: 'page', pageIndex: 0 }), /页码范围/);
  assert.throws(() => validatePdfAiRequest({ question: '提问', scope: 'page', pageIndex: 0, context: [{ text: '伪造' }] }), /上下文/);
  assert.throws(() => validatePdfAiRequest({ question: '提问', scope: 'page_range', pageIndex: 0, pageEndIndex: 5 }), /5 页/);
  assert.throws(() => validatePdfAiRequest({ question: '提问', scope: 'page', pageIndex: -1 }), /页码/);
});

test('PDF AI request fixes small limits and accepts explicit page range', () => {
  const input = validatePdfAiRequest({ question: '第几页讲了算法？', scope: 'page_range', pageIndex: 2, pageEndIndex: 4,
    history: [{ role: 'user', content: '前文' }] });
  assert.equal(input.pageIndex, 2);
  assert.equal(input.pageEndIndex, 4);
  assert.equal(PDF_AI_LIMITS.maxEvidenceItems, 6);
  assert.throws(() => validatePdfAiRequest({ question: 'x'.repeat(1001), scope: 'searchable_book' }), /问题过长/);
});

test('PDF AI structure budgets are frozen before implementation', () => {
  assert.deepEqual(PDF_AI_STRUCTURE_LIMITS, {
    maxStructureNodes: 256,
    maxOutlineDepth: 8,
    maxHeadingChars: 160,
    maxProfileSourceChars: 24000,
    maxMapInputChars: 8000,
    maxMapTasks: 3,
    maxReduceInputChars: 8000,
    maxProfileOutputTokens: 1600,
    maxProfileDurationMs: 45000
  });
  assert.ok(Object.isFrozen(PDF_AI_STRUCTURE_LIMITS));
});

test('PDF structured retrieval feature flag is explicit and defaults off', () => {
  assert.equal(typeof pdfAiStructuredRetrievalEnabled, 'function');
  assert.equal(pdfAiStructuredRetrievalEnabled({}), false);
  for (const value of ['1', 'true', 'yes', 'on']) {
    assert.equal(pdfAiStructuredRetrievalEnabled({ BABYREADER_ENABLE_PDF_AI_STRUCTURE: value }), true);
  }
  for (const value of ['', '0', 'false', 'enabled']) {
    assert.equal(pdfAiStructuredRetrievalEnabled({ BABYREADER_ENABLE_PDF_AI_STRUCTURE: value }), false);
  }
});

test('synthetic academic paper fixture covers core paper sections and edge variants', () => {
  const { paper, cases, variants } = require('./fixtures/pdf-ai-paper-cases');
  assert.deepEqual(paper.pages.map((page) => page.section), [
    'abstract', 'introduction', 'introduction', 'method', 'method', 'results', 'discussion', 'limitations', 'conclusion'
  ]);
  assert.deepEqual(cases.map((item) => item.intent), [
    'paper_overview', 'method', 'findings', 'limitations', 'lookup'
  ]);
  assert.ok(cases.every((item) => item.expectedPages.every((page) => page >= 0 && page < paper.pages.length)));
  assert.equal(variants.noOutline.outline, null);
  assert.ok(Array.isArray(variants.multiColumn.pageColumns));
  assert.equal(variants.imageOnly.imageOnly, true);
});

test('PDF AI evidence is bounded and cites only indexed pages', () => {
  const context = buildPdfAiContext([
    { pageIndex: 3, start: 0, text: '第一页内容 '.repeat(100) },
    { pageIndex: 4, start: 120, text: '下一页内容 '.repeat(100) }
  ]);
  assert.equal(context.length, 2);
  assert.equal(context[0].chapterLabel, '第4页');
  assert.ok(context[0].text.length <= PDF_AI_LIMITS.maxEvidenceChars);
  assert.deepEqual(pdfAiSources(context).map((source) => source.pageIndex), [3, 4]);
  const payload = buildPdfResponsesPayload({ model: 'test-model', question: '为什么？', context, history: [] });
  assert.equal(payload.max_output_tokens, 1200);
  assert.match(payload.input.at(-1).content[0].text, /第4页/);
  assert.doesNotMatch(payload.instructions, /当前章节|第.*章/);
  const lateHit = buildPdfAiContext([{ pageIndex: 0, start: 20,
    text: `${'前文'.repeat(400)}香蕉结论` }], { query: '香蕉结论是什么' });
  assert.match(lateHit[0].text, /香蕉结论/);
  assert.ok(lateHit[0].startOffset > 20);
});

test('PDF AI page query never leaks a different page, and image-only PDF reports no text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-pdf-ai-'));
  try {
    const file = path.join(root, 'book.pdf');
    await fs.writeFile(file, createPdfFixture({ pageTexts: ['苹果营养研究', '香蕉市场调查', '葡萄栽培技术'] }));
    const book = { id: 'e'.repeat(64), path: file, type: 'pdf', title: 'test' };
    const scoped = await searchPdfEvidenceRows(book, root, { query: '香蕉', pageStart: 1, pageEnd: 1 });
    assert.equal(scoped.status, 'ready');
    assert.ok(scoped.rows.length > 0);
    assert.ok(scoped.rows.every((row) => row.pageIndex === 1));
    const wrongPage = await searchPdfEvidenceRows(book, root, { query: '苹果', pageStart: 1, pageEnd: 1 });
    assert.ok(wrongPage.rows.every((row) => row.pageIndex === 1));
    const range = await searchPdfEvidenceRows(book, root, { query: '香蕉', pageStart: 0, pageEnd: 2 });
    assert.deepEqual([...new Set(range.rows.map((row) => row.pageIndex))].sort(), [0, 1, 2]);
    const selection = await searchPdfEvidenceRows(book, root, { query: '无关问题',
      selectedText: '香蕉市场调查', pageStart: 1, pageEnd: 1 });
    assert.equal(selection.status, 'ready');
    assert.match(selection.rows[0].text, /香蕉市场调查/);
    const longQuote = Array(20).fill('真实选文'.repeat(10)).join('\n');
    await fs.writeFile(file, createPdfFixture({ pageTexts: [longQuote] }));
    const selectedText = (await extractPdfText(book)).pages[0].text.replace(/\s+/g, ' ').trim();
    assert.ok(selectedText.length > 750 && selectedText.length <= 1200);
    const longSelection = await searchPdfEvidenceRows(book, root, { query: '概述选文',
      selectedText, pageStart: 0, pageEnd: 0 });
    assert.equal(longSelection.status, 'ready');
    assert.equal(longSelection.rows[0].text + longSelection.rows[1].text, selectedText);
    await fs.writeFile(file, createImageOnlyPdfFixture());
    const empty = await searchPdfEvidenceRows(book, root, { query: '香蕉', pageStart: 0, pageEnd: 0 });
    assert.equal(empty.status, 'no-text');
    assert.deepEqual(empty.rows, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
