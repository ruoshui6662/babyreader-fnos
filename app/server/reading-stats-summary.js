'use strict';

// The 阅读统计 page in one response: a week (Monday first) or calendar month
// around an anchor date, the period before it for comparison, reading time
// per day and per book, books read and finished, notes added, and the latest
// notes. Dates are the reader's local dates; ISO timestamps (finishedAt, note
// createdAt) are moved into local time with the browser's UTC offset.

const { isCalendarDate } = require('./reading-time');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANKED_BOOKS = 20;
const MAX_RECENT_NOTES = 10;

function statsError(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_STATS_QUERY' });
}

function utcDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return isoDate(new Date(utcDate(date).getTime() + days * DAY_MS));
}

function periodFor(range, anchor) {
  if (!isCalendarDate(anchor)) throw statsError('Invalid anchor date');
  const day = utcDate(anchor);
  if (range === 'week') {
    const offset = (day.getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(anchor, -offset);
    return { from, to: addDays(from, 6) };
  }
  if (range === 'month') {
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth();
    return {
      from: isoDate(new Date(Date.UTC(year, month, 1))),
      to: isoDate(new Date(Date.UTC(year, month + 1, 0)))
    };
  }
  throw statsError('Invalid range');
}

function previousPeriodFor(range, period) {
  return periodFor(range, addDays(period.from, -1));
}

function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// The browser's Date#getTimezoneOffset(): minutes to add to local time to
// reach UTC (UTC+8 is -480).
function localDateOf(iso, timezoneOffset) {
  const time = Date.parse(String(iso || ''));
  if (!Number.isFinite(time)) return null;
  return isoDate(new Date(time - timezoneOffset * 60 * 1000));
}

function notesOf(bookState) {
  const notes = [];
  for (const item of Array.isArray(bookState?.highlights) ? bookState.highlights : []) {
    notes.push({
      id: item.id,
      kind: item.kind === 'thought' ? 'thought' : 'highlight',
      text: item.text || '',
      thought: item.thought || item.note || '',
      color: item.color || 'yellow',
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      chapterHref: item.chapterHref || '',
      locator: item.locator || ''
    });
  }
  for (const item of Array.isArray(bookState?.pdfAnnotations) ? bookState.pdfAnnotations : []) {
    notes.push({
      id: item.id,
      kind: item.kind === 'thought' ? 'thought' : 'highlight',
      text: item.text || '',
      thought: item.thought || item.note || '',
      color: item.color || 'yellow',
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      pageIndex: Number.isInteger(item.targets?.[0]?.pageIndex) ? item.targets[0].pageIndex : null
    });
  }
  return notes;
}

function periodTotals({ days, readingState, period, timezoneOffset }) {
  let seconds = 0;
  const books = new Set();
  for (const date of datesBetween(period.from, period.to)) {
    for (const [bookId, value] of Object.entries(days[date] || {})) {
      seconds += value;
      if (value > 0) books.add(bookId);
    }
  }
  let finished = 0;
  let notes = 0;
  for (const bookState of Object.values(readingState.books || {})) {
    const finishedOn = localDateOf(bookState?.finishedAt, timezoneOffset);
    if (finishedOn && finishedOn >= period.from && finishedOn <= period.to) finished += 1;
    for (const note of notesOf(bookState)) {
      const on = localDateOf(note.createdAt, timezoneOffset);
      if (on && on >= period.from && on <= period.to) notes += 1;
    }
  }
  return { seconds, booksRead: books.size, booksFinished: finished, notes };
}

/**
 * @param {object} input
 * @param {object} input.days          reading-stats days covering both periods
 * @param {object} input.readingState  the user's reading-state.json
 * @param {(bookId: string) => object|null} input.bookInfo  public book data
 */
function buildReadingStats({ days = {}, readingState = { books: {} }, bookInfo = () => null, range, anchor, timezoneOffset = 0 }) {
  const offset = Number(timezoneOffset);
  if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60) throw statsError('Invalid timezone offset');
  const period = periodFor(range, anchor);
  const previous = previousPeriodFor(range, period);
  const current = periodTotals({ days, readingState, period, timezoneOffset: offset });
  const before = periodTotals({ days, readingState, period: previous, timezoneOffset: offset });

  const perBook = new Map();
  const daily = datesBetween(period.from, period.to).map((date) => {
    const books = Object.entries(days[date] || {})
      .map(([bookId, seconds]) => ({ bookId, seconds }))
      .sort((left, right) => right.seconds - left.seconds);
    for (const { bookId, seconds } of books) perBook.set(bookId, (perBook.get(bookId) || 0) + seconds);
    return { date, seconds: books.reduce((sum, book) => sum + book.seconds, 0), books };
  });

  const books = [...perBook]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_RANKED_BOOKS)
    .map(([bookId, seconds]) => {
      const info = bookInfo(bookId);
      const progress = readingState.books?.[bookId]?.progress?.percentage;
      return {
        bookId,
        seconds,
        title: info?.title || null,
        author: info?.author || '',
        type: info?.type || null,
        coverUrl: info?.coverUrl || null,
        available: Boolean(info),
        percentage: Number.isFinite(progress) ? progress : null,
        finishedAt: readingState.books?.[bookId]?.finishedAt || null
      };
    });

  const recentNotes = Object.entries(readingState.books || {})
    .flatMap(([bookId, bookState]) => notesOf(bookState).map((note) => ({ ...note, bookId })))
    .filter((note) => Date.parse(note.createdAt || '') > 0)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_RECENT_NOTES)
    .map((note) => {
      const info = bookInfo(note.bookId);
      return { ...note, title: info?.title || null, coverUrl: info?.coverUrl || null, type: info?.type || null, available: Boolean(info) };
    });

  return {
    range,
    from: period.from,
    to: period.to,
    previous,
    totals: current,
    previousTotals: before,
    daily,
    books,
    recentNotes,
    firstRecordedDate: Object.keys(days).sort()[0] || null
  };
}

module.exports = { buildReadingStats, notesOf, periodFor, previousPeriodFor, localDateOf };
