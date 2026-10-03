'use strict';

// 笔记: every book's highlights and thoughts (EPUB/TXT highlights and PDF
// annotations) as summaries, as one book's document in reading order, and as
// search results. Notes are only read here; they are edited in the reader.

const { notesOf } = require('./reading-stats-summary');
const { chapterForHref } = require('./epub-toc');

const MAX_SEARCH_RESULTS = 200;

function hasThought(note) {
  return Boolean(String(note.thought || '').trim());
}

function bookSummary(bookId, bookState, info, seconds) {
  const notes = notesOf(bookState).filter((note) => note.text || hasThought(note));
  if (!notes.length) return null;
  const updatedAt = notes
    .map((note) => note.updatedAt || note.createdAt)
    .filter((value) => Date.parse(value || '') > 0)
    .sort()
    .pop() || null;
  const progress = bookState?.progress?.percentage;
  return {
    bookId,
    title: info?.title || null,
    author: info?.author || '',
    type: info?.type || null,
    coverUrl: info?.coverUrl || null,
    available: Boolean(info),
    count: notes.length,
    highlightCount: notes.filter((note) => note.text).length,
    thoughtCount: notes.filter(hasThought).length,
    updatedAt,
    seconds: seconds || 0,
    percentage: Number.isFinite(progress) ? progress : null,
    finishedAt: bookState?.finishedAt || null
  };
}

function readingSecondsByBook(days = {}) {
  const totals = new Map();
  for (const books of Object.values(days)) {
    for (const [bookId, seconds] of Object.entries(books)) totals.set(bookId, (totals.get(bookId) || 0) + seconds);
  }
  return totals;
}

function buildNotesSummary({ readingState = { books: {} }, bookInfo = () => null, readingDays = {} }) {
  const seconds = readingSecondsByBook(readingDays);
  const books = Object.entries(readingState.books || {})
    .map(([bookId, bookState]) => bookSummary(bookId, bookState, bookInfo(bookId), seconds.get(bookId)))
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  return {
    books,
    totals: {
      books: books.length,
      notes: books.reduce((sum, book) => sum + book.count, 0),
      thoughts: books.reduce((sum, book) => sum + book.thoughtCount, 0)
    },
    updatedAt: books[0]?.updatedAt || null
  };
}

// Position inside a chapter, from the saved DOM-range locator.
function textPosition(note) {
  try {
    const locator = JSON.parse(note.locator || '{}');
    return Number.isFinite(locator.startTextOffset) ? locator.startTextOffset : null;
  } catch {
    return null;
  }
}

// One book's notes in reading order, each with the chapter (EPUB) or page
// (PDF) it belongs to. `toc` is epub-toc's { spine, toc } (EPUB only).
function buildBookNotes({ bookId, readingState = { books: {} }, bookInfo = () => null, toc = null, readingDays = {} }) {
  const bookState = readingState.books?.[bookId];
  const info = bookInfo(bookId);
  const summary = bookSummary(bookId, bookState, info, readingSecondsByBook(readingDays).get(bookId));
  const notes = notesOf(bookState)
    .filter((note) => note.text || hasThought(note))
    .map((note) => {
      let chapter;
      let order;
      if (Number.isInteger(note.pageIndex)) {
        chapter = `第 ${note.pageIndex + 1} 页`;
        order = note.pageIndex;
      } else if (toc && note.chapterHref) {
        ({ label: chapter, order } = chapterForHref(toc, note.chapterHref));
      } else {
        chapter = note.chapterHref ? '正文' : '其他';
        order = Number.MAX_SAFE_INTEGER;
      }
      const { locator, ...rest } = note;
      return { ...rest, chapter, chapterOrder: order, position: textPosition(note) };
    })
    .sort((left, right) => left.chapterOrder - right.chapterOrder
      || (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
      || String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
  return { book: summary || { bookId, title: info?.title || null, available: Boolean(info), count: 0 }, notes };
}

function searchNotes({ readingState = { books: {} }, bookInfo = () => null, query = '' }) {
  const needle = String(query || '').normalize('NFKC').toLocaleLowerCase().trim();
  if (!needle) return { query: '', results: [], truncated: false };
  const results = [];
  for (const [bookId, bookState] of Object.entries(readingState.books || {})) {
    const info = bookInfo(bookId);
    const title = info?.title || '';
    const titleMatches = title.normalize('NFKC').toLocaleLowerCase().includes(needle);
    for (const note of notesOf(bookState)) {
      const haystack = `${note.text}\n${note.thought}`.normalize('NFKC').toLocaleLowerCase();
      if (!titleMatches && !haystack.includes(needle)) continue;
      const { locator, ...rest } = note;
      results.push({ ...rest, bookId, title: info?.title || null, coverUrl: info?.coverUrl || null, available: Boolean(info) });
    }
  }
  results.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  return { query, results: results.slice(0, MAX_SEARCH_RESULTS), truncated: results.length > MAX_SEARCH_RESULTS };
}

module.exports = { buildBookNotes, buildNotesSummary, searchNotes };
