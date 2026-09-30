'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPdfStructure,
  resolvePdfOutlinePageIndex,
  PDF_AI_STRUCTURE_VERSION
} = require('../app/server/pdf-ai-structure');

test('PDF outline destinations resolve to physical zero-based pages', async () => {
  const document = {
    getDestination: async (name) => name === 'methods' ? [{ ref: 'page-4' }, { name: 'Fit' }] : null,
    getPageIndex: async (ref) => ref.ref === 'page-4' ? 4 : -1
  };
  assert.equal(await resolvePdfOutlinePageIndex('methods', document), 4);
  assert.equal(await resolvePdfOutlinePageIndex([{ ref: 'page-2' }], {
    getPageIndex: async () => 1
  }), 1);
  assert.equal(await resolvePdfOutlinePageIndex('missing', document), null);
});

test('PDF outline map removes empty and repeated labels, caps depth and nodes', () => {
  const nested = { title: '方法', pageIndex: 3, items: [] };
  let current = nested;
  for (let depth = 1; depth < 12; depth += 1) {
    const child = { title: `层级${depth}`, pageIndex: Math.min(10, depth + 3), items: [] };
    current.items.push(child);
    current = child;
  }
  const signals = {
    pageCount: 12,
    outline: [
      { title: '摘要', pageIndex: 0 },
      { title: '摘要', pageIndex: 1 },
      { title: '  ', pageIndex: 2 },
      nested,
      ...Array.from({ length: 300 }, (_, index) => ({ title: `章节${index}`, pageIndex: index % 12 }))
    ],
    headings: []
  };
  const structure = buildPdfStructure(signals);
  assert.equal(structure.mode, 'outline');
  assert.ok(structure.sections.length <= 256);
  assert.ok(structure.sections.every((section) => section.level <= 8));
  assert.ok(structure.sections.every((section) => section.title.trim()));
  assert.equal(structure.sections.some((section) => section.title === ' '), false);
  assert.equal(structure.sections.filter((section) => section.title === '摘要').length, 1);
  assert.ok(structure.sections.every((section) => section.pageStart >= 0 && section.pageEnd < 12));
});

test('high-confidence title candidates make ordered non-overlapping PDF sections', () => {
  const structure = buildPdfStructure({
    pageCount: 10,
    outline: [],
    headings: [
      { title: '引言', pageIndex: 1, confidence: 0.96, level: 1 },
      { title: '引言', pageIndex: 1, confidence: 0.96, level: 1 },
      { title: '研究方法', pageIndex: 4, confidence: 0.9, level: 1 },
      { title: '普通大字正文', pageIndex: 6, confidence: 0.42, level: 1 },
      { title: '结果', pageIndex: 7, confidence: 0.95, level: 1 }
    ]
  });
  assert.equal(structure.mode, 'headings');
  assert.deepEqual(structure.sections.map(({ title, pageStart, pageEnd }) => [title, pageStart, pageEnd]), [
    ['引言', 1, 3], ['研究方法', 4, 6], ['结果', 7, 9]
  ]);
  for (let index = 1; index < structure.sections.length; index += 1) {
    assert.ok(structure.sections[index - 1].pageEnd < structure.sections[index].pageStart);
  }
});

test('ambiguous or absent headings fall back to fixed page windows without invented sections', () => {
  const structure = buildPdfStructure({ pageCount: 19, outline: [], headings: [
    { title: '疑似标题', pageIndex: 2, confidence: 0.6 }
  ] });
  assert.equal(structure.mode, 'page_windows');
  assert.deepEqual(structure.sections.map(({ id, title, pageStart, pageEnd }) => [id, title, pageStart, pageEnd]), [
    ['pages-0-7', '第 1–8 页', 0, 7],
    ['pages-8-15', '第 9–16 页', 8, 15],
    ['pages-16-18', '第 17–19 页', 16, 18]
  ]);
  assert.ok(structure.sections.every((section) => section.source === 'page_window' && section.confidence === 0));
  assert.equal(typeof PDF_AI_STRUCTURE_VERSION, 'string');
});

test('invalid structure signals fail closed to bounded page windows', () => {
  assert.deepEqual(buildPdfStructure({ pageCount: 0, outline: [], headings: [] }), {
    mode: 'unavailable', pageCount: 0, sections: []
  });
  const structure = buildPdfStructure({ pageCount: 3, outline: [
    { title: '越界', pageIndex: 20 }, { title: '负页', pageIndex: -2 }
  ], headings: [] });
  assert.equal(structure.mode, 'page_windows');
  assert.ok(structure.sections.every(({ pageStart, pageEnd }) => pageStart >= 0 && pageEnd < 3));
});
