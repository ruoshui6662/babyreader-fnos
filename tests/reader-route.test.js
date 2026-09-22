'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getReaderBookId,
  setReaderBookId,
  clearReaderBookId
} = require('../app/ui/core/reader-route');

const BOOK_ID = 'a'.repeat(64);

test('reader book URL survives a browser refresh and clears when returning to the library', () => {
  const start = new URL('http://localhost/app/babyreader-fnos/');
  const readerUrl = setReaderBookId(BOOK_ID, start);

  assert.equal(getReaderBookId(readerUrl), BOOK_ID);
  assert.equal(getReaderBookId(new URL(readerUrl.href)), BOOK_ID);

  const libraryUrl = clearReaderBookId(readerUrl);
  assert.equal(getReaderBookId(libraryUrl), null);
  assert.equal(libraryUrl.pathname, '/app/babyreader-fnos/');
});

test('reader book URL rejects malformed or unsafe book IDs', () => {
  const start = new URL('http://localhost/app/babyreader-fnos/?book=not-a-book');
  assert.equal(getReaderBookId(start), null);
  assert.throws(() => setReaderBookId('../escape', start), /Invalid reader book ID/);
});
