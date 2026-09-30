'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { classifyPdfQuestion, planPdfRetrieval, composePdfEvidence } = require('../app/server/pdf-ai-retrieval');
const { createPdfFixture } = require('./fixtures/pdf-fixtures');
const { searchPdfEvidenceRowsByRanges } = require('../app/server/ai-fts');

const structure = { mode: 'outline', pageCount: 9, sections: [
  { id: 'abstract', title: '摘要', pageStart: 0, pageEnd: 0 },
  { id: 'intro', title: '引言', pageStart: 1, pageEnd: 2 },
  { id: 'method', title: '研究方法', pageStart: 3, pageEnd: 4 },
  { id: 'results', title: '研究结果', pageStart: 5, pageEnd: 6 },
  { id: 'limitations', title: '研究局限', pageStart: 7, pageEnd: 7 },
  { id: 'conclusion', title: '结论', pageStart: 8, pageEnd: 8 }
] };

test('PDF question intent is explicit, bilingual, selection-first and conservative', () => {
  assert.equal(classifyPdfQuestion('方法和样本是什么？'), 'method');
  assert.equal(classifyPdfQuestion('What are the main findings?'), 'findings');
  assert.equal(classifyPdfQuestion('主要研究发现和数据结果是什么？'), 'findings');
  assert.equal(classifyPdfQuestion('论文有哪些局限？'), 'limitations');
  assert.equal(classifyPdfQuestion('整体研究问题和结论是什么？'), 'paper_overview');
  assert.equal(classifyPdfQuestion('随机对照设计用了多少人？'), 'lookup');
  assert.equal(classifyPdfQuestion('与现有研究相比有什么不同？'), 'comparison');
  assert.equal(classifyPdfQuestion('论文主要讲什么？', { hasSelection: true }), 'selection');
  assert.equal(classifyPdfQuestion('随便问点什么'), 'lookup');
});

test('PDF retrieval plans prefer relevant structures and keep ranges sorted, merged and bounded', () => {
  const method = planPdfRetrieval({ intent: 'method', structure, currentPage: 0 });
  assert.ok(method.ranges.some(({ pageStart, pageEnd }) => pageStart <= 3 && pageEnd >= 4));
  const overview = planPdfRetrieval({ intent: 'paper_overview', structure });
  assert.ok(overview.ranges.length >= 2);
  assert.ok(overview.ranges.length <= 6);
  assert.ok(overview.ranges.every((range, index, list) => index === 0 || list[index - 1].pageEnd < range.pageStart));
  const fallback = planPdfRetrieval({ intent: 'findings', structure: { mode: 'page_windows', pageCount: 20, sections: [] }, currentPage: 10 });
  assert.deepEqual(fallback.ranges, [{ pageStart: 8, pageEnd: 15 }]);
});

test('range FTS fusion returns only selected pages, deduplicates overlap and remains bounded', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-pdf-ai-ranges-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'ranges.pdf');
  await fs.writeFile(file, createPdfFixture({ pageTexts: [
    '摘要 研究问题与主要结论。', '引言 研究背景与目标。', '研究方法 样本数据与流程。',
    '结果 研究发现与统计结果。', '局限 样本规模与研究不足。'
  ] }));
  const book = { id: 'f'.repeat(64), path: file, type: 'pdf', title: 'synthetic' };
  const result = await searchPdfEvidenceRowsByRanges(book, path.join(root, 'var'), {
    query: '研究方法 样本', ranges: [{ pageStart: 2, pageEnd: 3 }, { pageStart: 3, pageEnd: 4 }], limit: 6
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual([...new Set(result.rows.map((row) => row.pageIndex))].sort(), [2, 3, 4]);
  assert.ok(result.rows.length <= 6);
  assert.equal(new Set(result.rows.map((row) => `${row.pageIndex}:${row.start}`)).size, result.rows.length);
});

test('composed answers carry only original page evidence and report honest structure coverage', () => {
  const composed = composePdfEvidence({
    rows: [{ pageIndex: 3, start: 12, text: '研究方法采用随机对照设计。' }, { pageIndex: 5, start: 30, text: '研究结果显示主要差异。' }],
    structure,
    intent: 'paper_overview',
    question: '总体观点是什么？',
    profile: { findings: [{ text: '合成归纳，不是来源', evidenceIds: ['page-6'] }] }
  });
  assert.equal(composed.sources.length, composed.context.length);
  assert.ok(composed.context.every((item) => /研究方法|研究结果/u.test(item.text)));
  assert.equal(composed.coverage.sections.length, 2);
  assert.equal(composed.coverage.claimsWholePaper, false);
  assert.doesNotMatch(JSON.stringify(composed.context), /合成归纳/u);
});
