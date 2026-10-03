'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBookNotes, buildNotesSummary, searchNotes } = require('../app/server/notes');
const { chapterForHref, resolveHref } = require('../app/server/epub-toc');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const locator = (offset) => JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: offset });

const readingState = {
  books: {
    [A]: {
      progress: { percentage: 0.4 },
      highlights: [
        { id: 'a3', text: '第二章里的句子', chapterHref: 'OEBPS/ch2.xhtml', locator: locator(10), createdAt: '2026-10-01T01:00:00Z' },
        { id: 'a2', text: '第一章靠后', thought: '我的想法', chapterHref: 'OEBPS/ch1.xhtml', locator: locator(500), createdAt: '2026-09-30T01:00:00Z' },
        { id: 'a1', text: '第一章开头', chapterHref: 'OEBPS/ch1.xhtml', locator: locator(5), createdAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T05:00:00Z' },
        { id: 'a4', text: '附录内容', chapterHref: 'OEBPS/appendix-part2.xhtml', locator: locator(0), createdAt: '2026-09-01T01:00:00Z' }
      ]
    },
    [B]: {
      pdfAnnotations: [
        { id: 'b2', kind: 'highlight', text: '第三页', createdAt: '2026-09-20T01:00:00Z', targets: [{ pageIndex: 2, quads: [] }] },
        { id: 'b1', kind: 'thought', text: '第一页', thought: 'PDF 想法', createdAt: '2026-09-21T01:00:00Z', targets: [{ pageIndex: 0, quads: [] }] }
      ]
    },
    [C]: { progress: { percentage: 0.1 } }
  }
};
const titles = { [A]: '甲书', [B]: '乙书' };
const bookInfo = (id) => (titles[id] ? { title: titles[id], author: '作者', type: id === B ? 'pdf' : 'epub', coverUrl: null } : null);
const toc = {
  spine: ['OEBPS/cover.xhtml', 'OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/appendix.xhtml', 'OEBPS/appendix-part2.xhtml'],
  toc: [
    { label: '第一章 起点', href: 'OEBPS/ch1.xhtml', depth: 0 },
    { label: '第一节', href: 'OEBPS/ch1.xhtml', depth: 1 },
    { label: '第二章 远行', href: 'OEBPS/ch2.xhtml', depth: 0 },
    { label: '附录', href: 'OEBPS/appendix.xhtml', depth: 0 }
  ]
};

test('book cards: counts, thoughts, last update, reading time; books without notes are left out', () => {
  const summary = buildNotesSummary({ readingState, bookInfo, readingDays: { '2026-10-01': { [A]: 600 }, '2026-10-02': { [A]: 300, [B]: 120 } } });
  assert.deepEqual(summary.totals, { books: 2, notes: 6, thoughts: 2 });
  assert.deepEqual(summary.books.map((book) => [book.bookId, book.count, book.thoughtCount, book.updatedAt, book.seconds]), [
    [A, 4, 1, '2026-10-02T05:00:00Z', 900],
    [B, 2, 1, '2026-09-21T01:00:00Z', 120]
  ]);
  assert.equal(summary.books[0].percentage, 0.4);
});

test('a book document is in reading order, grouped by table-of-contents chapter or PDF page', () => {
  const doc = buildBookNotes({ bookId: A, readingState, bookInfo, toc });
  assert.deepEqual(doc.notes.map((note) => [note.id, note.chapter]), [
    ['a1', '第一章 起点'],
    ['a2', '第一章 起点'],
    ['a3', '第二章 远行'],
    // A file without its own entry belongs to the last chapter before it.
    ['a4', '附录']
  ]);
  assert.equal(doc.notes[1].thought, '我的想法');
  assert.equal(doc.notes[0].locator, undefined);
  assert.equal(doc.book.title, '甲书');

  const pdf = buildBookNotes({ bookId: B, readingState, bookInfo });
  assert.deepEqual(pdf.notes.map((note) => [note.id, note.chapter]), [['b1', '第 1 页'], ['b2', '第 3 页']]);

  // Without a table of contents the notes still come back.
  assert.equal(buildBookNotes({ bookId: A, readingState, bookInfo, toc: null }).notes.length, 4);
});

test('search finds text, thoughts and book titles', () => {
  assert.deepEqual(searchNotes({ readingState, bookInfo, query: '想法' }).results.map((note) => note.id).sort(), ['a2', 'b1']);
  assert.deepEqual(searchNotes({ readingState, bookInfo, query: '乙书' }).results.map((note) => note.id).sort(), ['b1', 'b2']);
  assert.deepEqual(searchNotes({ readingState, bookInfo, query: '  ' }).results, []);
});

test('chapter lookup and archive paths', () => {
  assert.deepEqual(chapterForHref(toc, 'OEBPS/cover.xhtml'), { label: '第 1 部分', order: 0 });
  assert.deepEqual(chapterForHref(toc, 'OEBPS/missing.xhtml'), { label: '其他', order: Number.MAX_SAFE_INTEGER });
  assert.equal(resolveHref('OEBPS/Text/', '../Text/ch%201.xhtml#p3'), 'OEBPS/Text/ch 1.xhtml');
});
