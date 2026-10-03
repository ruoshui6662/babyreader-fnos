'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReadingStats, periodFor, localDateOf } = require('../app/server/reading-stats-summary');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

test('weeks start on Monday; months are calendar months; the previous period is right before', () => {
  assert.deepEqual(periodFor('week', '2026-10-02'), { from: '2026-09-28', to: '2026-10-04' }); // Friday
  assert.deepEqual(periodFor('week', '2026-10-04'), { from: '2026-09-28', to: '2026-10-04' }); // Sunday
  assert.deepEqual(periodFor('week', '2026-09-28'), { from: '2026-09-28', to: '2026-10-04' }); // Monday
  assert.deepEqual(periodFor('month', '2026-02-14'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodFor('month', '2028-02-29'), { from: '2028-02-01', to: '2028-02-29' });
  const stats = buildReadingStats({ range: 'month', anchor: '2026-03-10' });
  assert.deepEqual(stats.previous, { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(stats.daily.length, 31);
  assert.throws(() => periodFor('year', '2026-10-02'), /Invalid range/);
  assert.throws(() => periodFor('week', '2026-13-01'), /Invalid anchor/);
});

test('UTC timestamps land on the reader\'s local day', () => {
  // 2026-10-02 18:30 UTC is already 10-03 in UTC+8 (offset -480).
  assert.equal(localDateOf('2026-10-02T18:30:00Z', -480), '2026-10-03');
  assert.equal(localDateOf('2026-10-02T18:30:00Z', 0), '2026-10-02');
  assert.equal(localDateOf('2026-10-02T03:00:00Z', 300), '2026-10-01');
  assert.equal(localDateOf('not a date', 0), null);
});

test('a week: totals against the previous week, daily series, ranking and recent notes', () => {
  const days = {
    '2026-09-21': { [A]: 600 },                 // previous week
    '2026-09-27': { [B]: 300 },                 // previous week (Sunday)
    '2026-09-28': { [A]: 1200, [B]: 60 },       // this week
    '2026-10-01': { [C]: 1800 },
    '2026-10-05': { [A]: 999 }                  // next week
  };
  const readingState = {
    books: {
      [A]: {
        progress: { percentage: 0.42 },
        highlights: [
          { id: 'h1', kind: 'highlight', text: '旧划线', createdAt: '2026-09-20T10:00:00Z' },
          { id: 'h2', kind: 'highlight', text: '新划线', thought: '想法', color: 'green', chapterHref: 'ch1.xhtml', createdAt: '2026-09-29T10:00:00Z' }
        ]
      },
      [B]: { finishedAt: '2026-09-30T23:30:00Z', progress: { percentage: 1 } },
      [C]: {
        finishedAt: '2026-09-27T12:00:00Z',
        pdfAnnotations: [{ id: 'p1', kind: 'highlight', text: 'PDF 摘录', color: 'blue', createdAt: '2026-10-01T08:00:00Z', targets: [{ pageIndex: 4, quads: [] }] }]
      }
    }
  };
  const titles = { [A]: '甲书', [B]: '乙书' };
  const stats = buildReadingStats({
    days,
    readingState,
    bookInfo: (id) => (titles[id] ? { title: titles[id], author: '作者', type: 'epub', coverUrl: `/cover/${id}` } : null),
    range: 'week',
    anchor: '2026-10-02',
    timezoneOffset: -480
  });

  assert.equal(stats.from, '2026-09-28');
  assert.equal(stats.to, '2026-10-04');
  assert.deepEqual(stats.totals, { seconds: 3060, booksRead: 3, booksFinished: 1, notes: 2 });
  // B finished on 10-01 local (UTC+8); C on 09-27 local, the week before.
  assert.deepEqual(stats.previousTotals, { seconds: 900, booksRead: 2, booksFinished: 1, notes: 0 });
  assert.equal(stats.daily.length, 7);
  assert.deepEqual(stats.daily[0], { date: '2026-09-28', seconds: 1260, books: [{ bookId: A, seconds: 1200 }, { bookId: B, seconds: 60 }] });
  assert.equal(stats.daily[3].seconds, 1800);
  assert.equal(stats.daily[6].seconds, 0);

  assert.deepEqual(stats.books.map((book) => [book.bookId, book.seconds, book.title, book.available]), [
    [C, 1800, null, false],
    [A, 1200, '甲书', true],
    [B, 60, '乙书', true]
  ]);
  assert.equal(stats.books[1].percentage, 0.42);

  assert.deepEqual(stats.recentNotes.map((note) => [note.id, note.title, note.pageIndex ?? null]), [
    ['p1', null, 4],
    ['h2', '甲书', null],
    ['h1', '甲书', null]
  ]);
  assert.equal(stats.recentNotes[1].thought, '想法');
  assert.equal(stats.firstRecordedDate, '2026-09-21');
});

test('no reading time yet gives an empty but complete page', () => {
  const stats = buildReadingStats({ range: 'week', anchor: '2026-10-02' });
  assert.deepEqual(stats.totals, { seconds: 0, booksRead: 0, booksFinished: 0, notes: 0 });
  assert.equal(stats.daily.length, 7);
  assert.deepEqual(stats.books, []);
  assert.deepEqual(stats.recentNotes, []);
  assert.equal(stats.firstRecordedDate, null);
  assert.throws(() => buildReadingStats({ range: 'week', anchor: '2026-10-02', timezoneOffset: 2000 }), /timezone/);
});
