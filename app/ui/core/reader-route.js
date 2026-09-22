/* BabyReader UI module: core/reader-route */

'use strict';

const READER_BOOK_ID_PATTERN = /^[a-f0-9]{64}$/;

function normalizeReaderUrl(input) {
  if (input instanceof URL) return new URL(input.href);
  return new URL(String(input || ''), typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
}

function getReaderBookId(input) {
  let url;
  try {
    url = normalizeReaderUrl(input);
  } catch {
    return null;
  }
  const bookId = url.searchParams.get('book');
  return READER_BOOK_ID_PATTERN.test(bookId || '') ? bookId : null;
}

function setReaderBookId(bookId, input) {
  const value = String(bookId || '');
  if (!READER_BOOK_ID_PATTERN.test(value)) throw new TypeError('Invalid reader book ID');
  const url = normalizeReaderUrl(input);
  url.searchParams.set('book', value);
  return url;
}

function clearReaderBookId(input) {
  const url = normalizeReaderUrl(input);
  url.searchParams.delete('book');
  return url;
}

const readerRouteApi = { getReaderBookId, setReaderBookId, clearReaderBookId };

if (typeof window !== 'undefined') window.readerRoute = readerRouteApi;
if (typeof module !== 'undefined' && module.exports) module.exports = readerRouteApi;
