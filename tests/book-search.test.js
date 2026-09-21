'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync } = require('fflate');

const {
  BOOK_SEARCH_MAX_CANDIDATES,
  findExactMatches,
  makeSearchSnippet,
  normalizeBookSearchOptions,
  searchBookText
} = require('../app/server/book-search');
const { AI_FTS_CHUNK_SIZE, ensureIndex, indexPath, isFtsAvailable, toFtsDocument } = require('../app/server/ai-fts');

const BOOK_ID = 'c'.repeat(64);

async function temporaryDirectory(t, prefix = 'babyreader-search-') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function createBook(id, filePath, type, title = '测试书') {
  return { id, path: filePath, type, title };
}

function createEpubArchive(chapters) {
  const manifest = chapters.map((_, index) => (
    `<item id="chapter-${index}" href="chapter-${index}.xhtml" media-type="application/xhtml+xml"/>`
  )).join('');
  const spine = chapters.map((_, index) => `<itemref idref="chapter-${index}"/>`).join('');
  const files = {
    'META-INF/container.xml': new TextEncoder().encode(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
    ),
    'OEBPS/content.opf': new TextEncoder().encode(
      `<package><manifest>${manifest}</manifest><spine>${spine}</spine></package>`
    )
  };
  chapters.forEach((chapter, index) => {
    files[`OEBPS/chapter-${index}.xhtml`] = new TextEncoder().encode(
      `<html><body><h1>${chapter.label}</h1><p>${chapter.text}</p></body></html>`
    );
  });
  return zipSync(files);
}

test('findExactMatches keeps original offsets while normalizing case and whitespace', () => {
  const matches = findExactMatches('前文\n蛋白 质与 HEALTH 有关。蛋白质也很重要。', '蛋白质');

  assert.deepEqual(matches.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 3, end: 7, text: '蛋白 质' },
    { start: 19, end: 22, text: '蛋白质' }
  ]);
  assert.deepEqual(findExactMatches('Health and HEALTH', 'health').map((match) => match.text), [
    'Health',
    'HEALTH'
  ]);
});

test('makeSearchSnippet returns bounded plain text around a match', () => {
  const text = '前文内容。'.repeat(20) + '蛋白质' + '。后文内容'.repeat(20);
  const start = text.indexOf('蛋白质');
  const snippet = makeSearchSnippet(text, start, start + 3, 8);

  assert.equal(snippet.includes('<'), false);
  assert.equal(snippet.includes('蛋白质'), true);
  assert.equal(snippet.startsWith('…'), true);
  assert.equal(snippet.endsWith('…'), true);
  assert.ok(snippet.length <= 8 + 3 + 8 + 2);
});

test('normalizeBookSearchOptions applies the search bounds and rejects invalid input', () => {
  assert.deepEqual(normalizeBookSearchOptions({ query: '  蛋白质  ', scope: 'chapter', chapterIndex: 2, limit: 99 }), {
    query: '蛋白质',
    scope: 'chapter',
    chapterIndex: 2,
    limit: 50
  });
  assert.throws(
    () => normalizeBookSearchOptions({ query: '' }),
    (error) => error.code === 'SEARCH_QUERY_INVALID' && error.statusCode === 400
  );
  assert.throws(
    () => normalizeBookSearchOptions({ query: '蛋白质', scope: 'chapter' }),
    (error) => error.code === 'SEARCH_QUERY_INVALID' && error.statusCode === 400
  );
});

test('searchBookText returns exact TXT matches in reading order with a safe locator', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'book.txt');
  await fs.writeFile(bookPath, '第一段没有命中。\n蛋白质位于第二段。\n第三段再次提到蛋白质。', 'utf8');

  const result = await searchBookText(createBook(BOOK_ID, bookPath, 'txt', '营养书'), root, {
    query: '蛋白质',
    limit: 10
  });

  assert.equal(result.available, true);
  assert.equal(result.query, '蛋白质');
  assert.equal(result.scope, 'book');
  assert.equal(result.truncated, false);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((item) => item.matchText), ['蛋白质', '蛋白质']);
  assert.ok(result.results[0].locator.offset < result.results[1].locator.offset);
  assert.equal(result.results[0].locator.type, 'text-search');
  assert.equal(result.results[0].chapterIndex, 0);
  assert.equal(result.results[0].chapterHref, '');
  assert.match(result.results[0].snippet, /蛋白质/);
});

test('searchBookText restricts EPUB results to the requested chapter', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'book.epub');
  await fs.writeFile(bookPath, createEpubArchive([
    { label: '第一章', text: '蛋白质在第一章出现。' },
    { label: '第二章', text: '蛋白质在第二章出现。' }
  ]));

  const result = await searchBookText(createBook(BOOK_ID, bookPath, 'epub'), root, {
    query: '蛋白质',
    scope: 'chapter',
    chapterIndex: 1
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].chapterIndex, 1);
  assert.equal(result.results[0].chapterHref, 'OEBPS/chapter-1.xhtml');
  assert.equal(result.results[0].chapterLabel, '第二章');
});

test('searchBookText uses a bounded original-text fallback for a query without FTS terms', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'book.txt');
  await fs.writeFile(bookPath, 'a\nb\n蛋白质\nc', 'utf8');

  const result = await searchBookText(createBook(BOOK_ID, bookPath, 'txt'), root, { query: 'a' });

  assert.equal(result.available, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].matchText, 'a');
  assert.equal(result.results[0].locator.offset, 0);
});

test('searchBookText deduplicates overlapping chunks and marks a limited result set', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'long.txt');
  const repeated = `${'前置内容。'.repeat(250)}蛋白质${'。后置内容。'.repeat(250)}`;
  const text = repeated.repeat(Math.max(5, Math.ceil((AI_FTS_CHUNK_SIZE * 2) / repeated.length)));
  await fs.writeFile(bookPath, text, 'utf8');

  const result = await searchBookText(createBook(BOOK_ID, bookPath, 'txt'), root, {
    query: '蛋白质',
    limit: 2
  });

  const offsets = result.results.map((item) => item.locator.offset);
  assert.equal(new Set(offsets).size, offsets.length);
  assert.ok(offsets.every((offset, index) => index === 0 || offset > offsets[index - 1]));
  assert.equal(result.results.length, 2);
  assert.equal(result.truncated, true);
  assert.ok(BOOK_SEARCH_MAX_CANDIDATES > result.results.length);
});

test('searchBookText stops at the candidate cap and reports truncation', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'many.txt');
  await fs.writeFile(bookPath, '索引起点', 'utf8');
  const book = createBook(BOOK_ID, bookPath, 'txt');
  await ensureIndex(book, root);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(indexPath(root, BOOK_ID));
  const insertChunk = db.prepare(`
    INSERT INTO ai_chunks(title, headings, body, chapterIndex, chapterHref, chapterLabel, startOffset)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertText = db.prepare(`
    INSERT INTO ai_chunk_text(rowid, bodyText, titleText, headingsText)
    VALUES (?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  for (let index = 0; index < BOOK_SEARCH_MAX_CANDIDATES + 1; index += 1) {
    const inserted = insertChunk.run('索引', '', toFtsDocument('蛋白质'), 0, '', '当前书', index + 10);
    insertText.run(Number(inserted.lastInsertRowid), '蛋白质', '当前书', '');
  }
  db.exec('COMMIT');
  db.close();

  const result = await searchBookText(book, root, { query: '蛋白质', limit: 2 });

  assert.equal(result.results.length, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.results[0].locator.offset, 10);
});
