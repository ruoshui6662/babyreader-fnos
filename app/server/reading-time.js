'use strict';

// Reading time: seconds actually spent reading, per local date and book.
// The browser decides what counts as reading (visible page, recent activity)
// and reports increments; the server only checks they are plausible and adds
// them up. Stored per user in reading-stats.json, apart from
// reading-state.json so frequent increments never rewrite every highlight.

const DAY_SECONDS = 24 * 60 * 60;
const MAX_ENTRIES_PER_REPORT = 500;
const BOOK_ID = /^[a-f0-9]{64}$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function readingTimeError(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_READING_TIME' });
}

function isCalendarDate(value) {
  const match = LOCAL_DATE.exec(String(value || ''));
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// A local date the browser could plausibly be on: not before 2000, and not
// more than a day ahead of the server's UTC date (time zones reach +14h).
function isReportableDate(value, now = new Date()) {
  if (!isCalendarDate(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return time >= Date.parse('2000-01-01T00:00:00Z') && time <= now.getTime() + DAY_SECONDS * 1000;
}

function normalizeReadingTimeReport(body, now = new Date()) {
  const entries = Array.isArray(body?.entries) ? body.entries : null;
  if (!entries || entries.length > MAX_ENTRIES_PER_REPORT) throw readingTimeError('Invalid reading time report');
  const merged = new Map();
  for (const entry of entries) {
    const date = String(entry?.date || '');
    const bookId = String(entry?.bookId || '').toLowerCase();
    const seconds = Number(entry?.seconds);
    if (!isReportableDate(date, now) || !BOOK_ID.test(bookId)
        || !Number.isInteger(seconds) || seconds < 1 || seconds > DAY_SECONDS) {
      throw readingTimeError('Invalid reading time entry');
    }
    const key = `${date}|${bookId}`;
    merged.set(key, Math.min(DAY_SECONDS, (merged.get(key) || 0) + seconds));
  }
  return [...merged].map(([key, seconds]) => {
    const [date, bookId] = key.split('|');
    return { date, bookId, seconds };
  });
}

function emptyReadingStats() {
  return { version: 1, days: {} };
}

function normalizeReadingStats(value) {
  const stats = emptyReadingStats();
  const days = value && typeof value === 'object' && value.days && typeof value.days === 'object' ? value.days : {};
  for (const [date, books] of Object.entries(days)) {
    if (!isCalendarDate(date) || !books || typeof books !== 'object') continue;
    for (const [bookId, seconds] of Object.entries(books)) {
      const value = Number(seconds);
      if (!BOOK_ID.test(bookId) || !Number.isFinite(value) || value <= 0) continue;
      (stats.days[date] ||= {})[bookId] = Math.min(DAY_SECONDS, Math.round(value));
    }
  }
  if (value?.updatedAt) stats.updatedAt = String(value.updatedAt).slice(0, 64);
  return stats;
}

// Adds increments in place; a book never exceeds 24 hours on one day.
function addReadingTime(stats, entries, now = new Date()) {
  for (const { date, bookId, seconds } of entries) {
    const day = (stats.days[date] ||= {});
    day[bookId] = Math.min(DAY_SECONDS, (day[bookId] || 0) + seconds);
  }
  stats.updatedAt = now.toISOString();
  return stats;
}

// Days from..to inclusive (local dates as the browser reported them).
function readingTimeBetween(stats, from, to) {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) throw readingTimeError('Invalid date range');
  const days = {};
  for (const [date, books] of Object.entries(stats.days)) {
    if (date >= from && date <= to) days[date] = { ...books };
  }
  return days;
}

module.exports = {
  DAY_SECONDS,
  addReadingTime,
  emptyReadingStats,
  isCalendarDate,
  normalizeReadingStats,
  normalizeReadingTimeReport,
  readingTimeBetween
};
