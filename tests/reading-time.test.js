'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UserStorage } = require('../app/server/storage');
const { normalizeReadingTimeReport } = require('../app/server/reading-time');

const BOOK_A = 'a'.repeat(64);
const BOOK_B = 'b'.repeat(64);
const NOW = new Date('2026-10-02T12:00:00Z');

async function storage(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-reading-time-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const instance = new UserStorage(root);
  await instance.initialize();
  return instance;
}

test('reports are validated: real dates, book ids, whole seconds, at most a day', () => {
  const ok = normalizeReadingTimeReport({ entries: [
    { date: '2026-10-02', bookId: BOOK_A, seconds: 60 },
    { date: '2026-10-02', bookId: BOOK_A, seconds: 30 },
    { date: '2026-10-01', bookId: BOOK_B, seconds: 15 }
  ] }, NOW);
  assert.deepEqual(ok, [
    { date: '2026-10-02', bookId: BOOK_A, seconds: 90 },
    { date: '2026-10-01', bookId: BOOK_B, seconds: 15 }
  ]);
  // Up to a day ahead of the server (time zones east of UTC).
  assert.equal(normalizeReadingTimeReport({ entries: [{ date: '2026-10-03', bookId: BOOK_A, seconds: 1 }] }, NOW).length, 1);
  for (const entry of [
    { date: '2026-10-05', bookId: BOOK_A, seconds: 1 },
    { date: '2026-02-30', bookId: BOOK_A, seconds: 1 },
    { date: '1999-12-31', bookId: BOOK_A, seconds: 1 },
    { date: '2026-10-02', bookId: 'not-a-book', seconds: 1 },
    { date: '2026-10-02', bookId: BOOK_A, seconds: 0 },
    { date: '2026-10-02', bookId: BOOK_A, seconds: 1.5 },
    { date: '2026-10-02', bookId: BOOK_A, seconds: 86401 }
  ]) {
    assert.throws(() => normalizeReadingTimeReport({ entries: [entry] }, NOW), /Invalid reading time entry/);
  }
  assert.throws(() => normalizeReadingTimeReport({}, NOW), /Invalid reading time report/);
  assert.throws(() => normalizeReadingTimeReport({ entries: Array.from({ length: 501 }, () => ({})) }, NOW), /report/);
});

test('reading time adds up per day and book, capped at 24 hours, per user', async (t) => {
  const store = await storage(t);
  await store.addReadingTime('reader_1', { entries: [{ date: '2026-10-01', bookId: BOOK_A, seconds: 600 }] }, NOW);
  // Two devices reporting at once both count.
  await Promise.all([
    store.addReadingTime('reader_1', { entries: [{ date: '2026-10-02', bookId: BOOK_A, seconds: 120 }] }, NOW),
    store.addReadingTime('reader_1', { entries: [{ date: '2026-10-02', bookId: BOOK_A, seconds: 60 }, { date: '2026-10-02', bookId: BOOK_B, seconds: 45 }] }, NOW)
  ]);
  await store.addReadingTime('reader_1', { entries: [{ date: '2026-10-01', bookId: BOOK_B, seconds: 86400 }] }, NOW);
  await store.addReadingTime('reader_1', { entries: [{ date: '2026-10-01', bookId: BOOK_B, seconds: 60 }] }, NOW);

  const range = await store.getReadingTime('reader_1', '2026-10-01', '2026-10-02');
  assert.deepEqual(range.days, {
    '2026-10-01': { [BOOK_A]: 600, [BOOK_B]: 86400 },
    '2026-10-02': { [BOOK_A]: 180, [BOOK_B]: 45 }
  });
  assert.deepEqual((await store.getReadingTime('reader_1', '2026-10-02', '2026-10-02')).days, {
    '2026-10-02': { [BOOK_A]: 180, [BOOK_B]: 45 }
  });
  assert.deepEqual((await store.getReadingTime('reader_2', '2026-10-01', '2026-10-02')).days, {});
  await assert.rejects(store.getReadingTime('reader_1', '2026-10-03', '2026-10-01'), /Invalid date range/);

  // Kept apart from the reading state file.
  const state = await store.getState('reader_1');
  assert.deepEqual(state.books, {});
});

test('a book records when it was first read to the end', async (t) => {
  const store = await storage(t);
  await store.updateProgress('reader_1', BOOK_A, { locator: '{}', percentage: 0.5 });
  assert.equal((await store.getState('reader_1')).books[BOOK_A].finishedAt, undefined);
  await store.updateProgress('reader_1', BOOK_A, { locator: '{}', percentage: 0.985 });
  const finished = (await store.getState('reader_1')).books[BOOK_A].finishedAt;
  assert.match(finished, /^\d{4}-\d{2}-\d{2}T/);
  // Going back and finishing again keeps the first time.
  await store.updateProgress('reader_1', BOOK_A, { locator: '{}', percentage: 0.2 });
  await store.updateProgress('reader_1', BOOK_A, { locator: '{}', percentage: 1 });
  assert.equal((await store.getState('reader_1')).books[BOOK_A].finishedAt, finished);
});
