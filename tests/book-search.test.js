'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync } = require('fflate');
const { createPdfFixture, createCorruptPdfFixture } = require('./fixtures/pdf-fixtures');

const {
  BOOK_SEARCH_MAX_CANDIDATES,
  findExactMatches,
  makeSearchSnippet,
  normalizeBookSearchOptions,
  searchBookText
} = require('../app/server/book-search');
const { AI_FTS_SCHEMA_VERSION, AI_FTS_CHUNK_SIZE, ensureIndex, indexPath, isFtsAvailable, toFtsDocument, toFtsQuery } = require('../app/server/ai-fts');

const BOOK_ID = 'c'.repeat(64);

async function temporaryDirectory(t, prefix = 'zhenshu-search-') {
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
    limit: 50,
    cursor: null
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

test('EPUB indexing follows nested encoded spine hrefs and excludes non-spine resources', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'coverage.epub');
  const files = {
    'META-INF/container.xml': new TextEncoder().encode(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/Package/content.opf"/></rootfiles></container>'
    ),
    'OPS/Package/content.opf': new TextEncoder().encode(`
      <package><manifest>
        <item id="intro" href="../Text%20Files/intro%20one.xhtml?edition=1#body" media-type="application/xhtml+xml"/>
        <item id="blank" href="../Text%20Files/blank.xhtml" media-type="application/xhtml+xml"/>
        <item id="missing" href="../Text%20Files/missing.xhtml" media-type="application/xhtml+xml"/>
        <item id="middle" href="../Text%20Files/middle.xhtml" media-type="application/xhtml+xml"/>
        <item id="last" href="../Text%20Files/final%20chapter.xhtml" media-type="application/xhtml+xml"/>
        <item id="appendix" href="../Text%20Files/appendix.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine>
        <itemref idref="intro"/><itemref idref="blank"/><itemref idref="missing"/>
        <itemref idref="middle"/><itemref idref="last"/>
      </spine></package>
    `),
    'OPS/Text Files/intro one.xhtml': new TextEncoder().encode('<html><body><h1>前言</h1><p>首章覆盖标记。</p></body></html>'),
    'OPS/Text Files/blank.xhtml': new TextEncoder().encode('<html><body></body></html>'),
    'OPS/Text Files/middle.xhtml': new TextEncoder().encode('<html><body><h1>中间章</h1><p>普通内容。</p></body></html>'),
    'OPS/Text Files/final chapter.xhtml': new TextEncoder().encode('<html><body><h1>末章</h1><p>远端唯一标记。</p></body></html>'),
    'OPS/Text Files/appendix.xhtml': new TextEncoder().encode('<html><body><h1>非 spine 附录</h1><p>附录独立标记。</p></body></html>')
  };
  await fs.writeFile(bookPath, zipSync(files));

  const book = createBook(BOOK_ID, bookPath, 'epub', 'fixture');
  const finalChapter = await searchBookText(book, root, { query: '远端唯一标记' });
  const nonSpine = await searchBookText(book, root, { query: '附录独立标记' });
  const db = new (require('node:sqlite').DatabaseSync)(indexPath(root, BOOK_ID), { readOnly: true });
  const indexed = db.prepare('SELECT DISTINCT chapterIndex, chapterHref FROM ai_chunks ORDER BY chapterIndex').all();
  const byRowId = db.prepare('SELECT rowid, chapterIndex, startOffset FROM ai_chunks ORDER BY rowid').all();
  const byReadingOrder = db.prepare(`
    SELECT rowid, chapterIndex, startOffset FROM ai_chunks
    ORDER BY CAST(chapterIndex AS INTEGER), CAST(startOffset AS INTEGER), rowid
  `).all();
  const rowIdSeekPlan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT rowid, chapterIndex, startOffset FROM ai_chunks
    WHERE ai_chunks MATCH ? AND rowid > ? ORDER BY rowid LIMIT ?
  `).all(toFtsQuery('普通'), 0, 20).map((row) => row.detail);
  db.close();

  t.diagnostic(JSON.stringify({
    fixtureSpineItems: 5,
    indexedSpineItems: indexed.length,
    skippedSpineItems: 5 - indexed.length,
    nonSpineResourceIndexed: nonSpine.results.length > 0,
    terminalSpineMatchReachable: finalChapter.results.length === 1,
    rowIdPreservesReadingOrder: JSON.stringify(byRowId) === JSON.stringify(byReadingOrder),
    rowIdSeekPlan
  }));
  assert.deepEqual(indexed.map(({ chapterIndex, chapterHref }) => [chapterIndex, chapterHref]), [
    [0, 'OPS/Text Files/intro one.xhtml'],
    [3, 'OPS/Text Files/middle.xhtml'],
    [4, 'OPS/Text Files/final chapter.xhtml']
  ]);
  assert.equal(finalChapter.results[0]?.chapterIndex, 4);
  assert.equal(finalChapter.results[0]?.chapterHref, 'OPS/Text Files/final chapter.xhtml');
  assert.equal(nonSpine.results.length, 0);
  assert.deepEqual(byRowId, byReadingOrder);
});

test('EPUB index stores logical chapter structure without changing spine-index retrieval fields', { skip: !isFtsAvailable() }, async (t) => {
  const root = await temporaryDirectory(t, 'zhenshu-ai-chapter-structure-');
  const bookPath = path.join(root, 'chapter-structure.epub');
  const files = {
    'META-INF/container.xml': new TextEncoder().encode(
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    'OPS/book.opf': new TextEncoder().encode(`<package><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="text" href="content.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine><itemref idref="text"/></spine></package>`),
    'OPS/nav.xhtml': new TextEncoder().encode(`<html><body><nav epub:type="toc"><ol>
      <li><a href="content.xhtml#one">第一测试章</a></li>
      <li><a href="content.xhtml#two">第二测试章</a></li>
      </ol></nav></body></html>`),
    'OPS/content.xhtml': new TextEncoder().encode(`<html><body>
      <h1 id="one">第一测试章</h1><p>第一章唯一检索词。</p>
      <h1 id="two">第二测试章</h1><p>第二章唯一检索词。</p>
      </body></html>`)
  };
  await fs.writeFile(bookPath, zipSync(files));

  const book = createBook(BOOK_ID, bookPath, 'epub', '结构测试书');
  const filePath = await ensureIndex(book, root);
  const db = new (require('node:sqlite').DatabaseSync)(filePath, { readOnly: true });
  const metadata = Object.fromEntries(db.prepare('SELECT key, value FROM ai_meta').all().map((row) => [row.key, row.value]));
  const structureRow = db.prepare('SELECT parserVersion, structureJson FROM ai_epub_structure WHERE id = 1').get();
  const rows = db.prepare('SELECT DISTINCT chapterIndex, chapterHref FROM ai_chunks ORDER BY chapterIndex').all()
    .map((row) => ({ chapterIndex: Number(row.chapterIndex), chapterHref: String(row.chapterHref) }));
  db.close();

  assert.equal(AI_FTS_SCHEMA_VERSION, 7);
  assert.equal(metadata.schemaVersion, '7');
  assert.equal(metadata.parserVersion, '2');
  assert.equal(structureRow.parserVersion, '2');
  assert.deepEqual(JSON.parse(structureRow.structureJson).chapters.map((chapter) => chapter.label), ['第一测试章', '第二测试章']);
  assert.deepEqual(rows, [{ chapterIndex: 0, chapterHref: 'OPS/content.xhtml' }]);
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

  const allOffsets = result.results.map((item) => item.locator.offset);
  let cursor = result.nextCursor;
  while (cursor) {
    const page = await searchBookText(createBook(BOOK_ID, bookPath, 'txt'), root, {
      query: '蛋白质', limit: 2, cursor
    });
    allOffsets.push(...page.results.map((item) => item.locator.offset));
    cursor = page.nextCursor;
  }
  const expectedOffsets = [...text.matchAll(/蛋白质/g)].map((match) => match.index);
  assert.deepEqual(allOffsets, expectedOffsets);
  assert.equal(new Set(allOffsets).size, allOffsets.length);
});

test('searchBookText returns a capped first page while more exact matches remain', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'many-matches.txt');
  const fixtureText = Array.from({ length: 25 }, (_, index) => `第${index + 1}处：蛋白质。`).join('\n');
  await fs.writeFile(bookPath, fixtureText, 'utf8');

  const result = await searchBookText(createBook(BOOK_ID, bookPath, 'txt'), root, { query: '蛋白质' });

  t.diagnostic(JSON.stringify({ fixtureMatches: 25, returnedMatches: result.results.length, continuationAvailable: result.truncated }));
  assert.equal(result.results.length, 20);
  assert.equal(result.hasMore, true);
  assert.equal(typeof result.nextCursor, 'string');
  assert.equal(result.truncated, true);
  assert.equal(result.results[0].locator.offset, 4);
  const expectedOffsets = [...fixtureText.matchAll(/蛋白质/g)].map((match) => match.index);
  assert.deepEqual(result.results.map(({ locator }) => locator.offset), expectedOffsets.slice(0, 20));

  const secondPage = await searchBookText(createBook(BOOK_ID, bookPath, 'txt'), root, {
    query: '蛋白质',
    cursor: result.nextCursor
  });
  assert.deepEqual(secondPage.results.map(({ locator }) => locator.offset), expectedOffsets.slice(20));
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(secondPage.truncated, false);
});

test('searchBookText continues after the candidate cap without repeating candidates', async (t) => {
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
  assert.equal(result.hasMore, true);
  assert.equal(typeof result.nextCursor, 'string');
  assert.equal(result.truncated, true);
  assert.equal(result.results[0].locator.offset, 10);

  const secondPage = await searchBookText(book, root, {
    query: '蛋白质',
    limit: 2,
    cursor: result.nextCursor
  });
  assert.equal(secondPage.results.length, 2);
  assert.ok(secondPage.results[0].locator.offset > result.results.at(-1).locator.offset);
  assert.equal(secondPage.results[0].matchText, '蛋白质');
  assert.equal(secondPage.hasMore, true);
});

test('searchBookText can hide a later exact match behind earlier FTS false positives at the candidate cap', async (t) => {
  assert.equal(isFtsAvailable(), true, 'Node runtime must provide SQLite FTS5 for this test');
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'late-match.txt');
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
  for (let index = 0; index < BOOK_SEARCH_MAX_CANDIDATES; index += 1) {
    const inserted = insertChunk.run('索引', '', toFtsDocument('蛋白质'), 0, '', '前段', index);
    insertText.run(Number(inserted.lastInsertRowid), '错误候选', '前段', '');
  }
  const lastCandidate = insertChunk.run('索引', '', toFtsDocument('蛋白质'), 9, '', '末章', 0);
  insertText.run(Number(lastCandidate.lastInsertRowid), '末章唯一蛋白质命中', '末章', '');
  db.exec('COMMIT');
  db.close();

  const result = await searchBookText(book, root, { query: '蛋白质', limit: 20 });

  t.diagnostic(JSON.stringify({ earlierCandidates: BOOK_SEARCH_MAX_CANDIDATES, lateExactMatchExists: true, returnedMatches: result.results.length, reportsMore: result.truncated }));
  assert.equal(result.results.length, 0);
  assert.equal(result.hasMore, true);
  assert.equal(typeof result.nextCursor, 'string');
  assert.equal(result.truncated, true);

  const secondPage = await searchBookText(book, root, {
    query: '蛋白质',
    limit: 20,
    cursor: result.nextCursor
  });
  assert.equal(secondPage.results.length, 1);
  assert.equal(secondPage.results[0].chapterIndex, 9);
  assert.equal(secondPage.results[0].matchText, '蛋白质');
  assert.equal(secondPage.hasMore, false);
});

test('search cursors reject malformed, oversized, and mismatched context', async (t) => {
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'cursor-context.txt');
  await fs.writeFile(bookPath, '蛋白质。蛋白质。', 'utf8');
  const book = createBook(BOOK_ID, bookPath, 'txt');
  const first = await searchBookText(book, root, { query: '蛋白质', limit: 1 });

  assert.throws(() => normalizeBookSearchOptions({ query: 'x', cursor: 'not base64!' }), { statusCode: 400 });
  assert.throws(() => normalizeBookSearchOptions({ query: 'x', cursor: 'a'.repeat(513) }), { statusCode: 400 });
  const decodedCursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'));
  const negativePosition = Buffer.from(JSON.stringify({ ...decodedCursor, r: -1 })).toString('base64url');
  assert.throws(() => normalizeBookSearchOptions({ query: '蛋白质', cursor: negativePosition }), { statusCode: 400 });
  await assert.rejects(searchBookText(book, root, { query: '不同', limit: 1, cursor: first.nextCursor }), { statusCode: 400 });
  await assert.rejects(searchBookText(book, root, {
    query: '蛋白质', scope: 'chapter', chapterIndex: 0, limit: 1, cursor: first.nextCursor
  }), { statusCode: 400 });
  await assert.rejects(searchBookText(book, root, { query: '蛋白质', limit: 2, cursor: first.nextCursor }), { statusCode: 400 });
  await assert.rejects(searchBookText({ ...book, id: 'b'.repeat(64) }, root, {
    query: '蛋白质', limit: 1, cursor: first.nextCursor
  }), { statusCode: 400 });
});

test('search cursors become stale when the indexed source changes', async (t) => {
  const root = await temporaryDirectory(t);
  const bookPath = path.join(root, 'stale-cursor.txt');
  await fs.writeFile(bookPath, '蛋白质。蛋白质。', 'utf8');
  const book = createBook(BOOK_ID, bookPath, 'txt');
  const first = await searchBookText(book, root, { query: '蛋白质', limit: 1 });
  await fs.writeFile(bookPath, '蛋白质。新的内容。蛋白质。', 'utf8');

  await assert.rejects(
    searchBookText(book, root, { query: '蛋白质', limit: 1, cursor: first.nextCursor }),
    { statusCode: 409 }
  );
});

test('PDF search indexes exact Chinese matches by zero-based page and UTF-16 page offset', { skip: !isFtsAvailable() }, async (t) => {
  const root = await temporaryDirectory(t, 'zhenshu-pdf-search-');
  const bookPath = path.join(root, 'multi-page.pdf');
  const pages = [
    '第一页前文。目标词在这里；目标词再次出现。',
    '第二页开头。其他内容。目标词位于第二页末尾。',
    '第三页不包含关键词。'
  ];
  await fs.writeFile(bookPath, createPdfFixture({ pageTexts: pages }));

  const book = createBook('1'.repeat(64), bookPath, 'pdf', '多页测试');
  const first = await searchBookText(book, root, { query: '目标词', limit: 2 });
  assert.equal(first.available, true);
  assert.deepEqual(first.results.map(({ locator }) => [locator.type, locator.pageIndex]), [
    ['pdf', 0], ['pdf', 0]
  ]);
  assert.equal(first.results[0].locator.textOffset, pages[0].indexOf('目标词'));
  assert.equal(first.results[0].matchText, '目标词');
  assert.equal(first.hasMore, true);

  const second = await searchBookText(book, root, {
    query: '目标词', limit: 2, cursor: first.nextCursor
  });
  assert.deepEqual(second.results.map(({ locator }) => locator.pageIndex), [1]);
  assert.equal(second.results[0].locator.textOffset, pages[1].indexOf('目标词'));
  assert.equal(second.hasMore, false);
});

test('image-only PDF is explicitly non-searchable rather than an empty successful index', { skip: !isFtsAvailable() }, async (t) => {
  const root = await temporaryDirectory(t, 'zhenshu-pdf-textless-');
  const bookPath = path.join(root, 'image-only.pdf');
  await fs.writeFile(bookPath, createPdfFixture({ pageTexts: [null, ''] }));

  const result = await searchBookText(createBook('2'.repeat(64), bookPath, 'pdf'), root, { query: '任意词' });
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, 'pdf_no_searchable_text');
  assert.deepEqual(result.results, []);
});

test('PDF parser-version mismatch rebuilds only that book index and malformed PDFs fail closed', { skip: !isFtsAvailable() }, async (t) => {
  const root = await temporaryDirectory(t, 'zhenshu-pdf-version-');
  const bookPath = path.join(root, 'versioned.pdf');
  await fs.writeFile(bookPath, createPdfFixture({ text: '当前版本唯一词' }));
  const book = createBook('3'.repeat(64), bookPath, 'pdf');
  const initial = await searchBookText(book, root, { query: '当前版本唯一词' });
  assert.equal(initial.results.length, 1);

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(indexPath(root, book.id));
  db.prepare("UPDATE ai_meta SET value = 'stale-pdf-parser' WHERE key = 'parserVersion'").run();
  db.close();
  const rebuilt = await searchBookText(book, root, { query: '当前版本唯一词' });
  assert.equal(rebuilt.results.length, 1);

  const corruptPath = path.join(root, 'corrupt.pdf');
  await fs.writeFile(corruptPath, createCorruptPdfFixture());
  const corrupt = await searchBookText(createBook('4'.repeat(64), corruptPath, 'pdf'), root, { query: '任意词' });
  assert.equal(corrupt.available, false);
  assert.equal(corrupt.results.length, 0);
  assert.equal(await fs.stat(indexPath(root, '4'.repeat(64))).then(() => true, () => false), false);
});

test('failed PDF rebuild retains the last complete index and does not modify another book index', { skip: !isFtsAvailable() }, async (t) => {
  const root = await temporaryDirectory(t, 'zhenshu-pdf-atomic-');
  const pdfPath = path.join(root, 'atomic.pdf');
  const textPath = path.join(root, 'unrelated.txt');
  const pdfBook = createBook('5'.repeat(64), pdfPath, 'pdf');
  const textBook = createBook('6'.repeat(64), textPath, 'txt');
  await fs.writeFile(pdfPath, createPdfFixture({ text: '旧的完整索引目标' }));
  await fs.writeFile(textPath, '旁边的普通书籍内容', 'utf8');
  await searchBookText(textBook, root, { query: '普通书籍' });
  const validResult = await searchBookText(pdfBook, root, { query: '完整索引目标' });
  assert.equal(validResult.results.length, 1);
  const otherIndexBefore = await fs.stat(indexPath(root, textBook.id));

  await fs.writeFile(pdfPath, createCorruptPdfFixture());
  const failed = await searchBookText(pdfBook, root, { query: '完整索引目标' });
  const retained = await searchBookText(pdfBook, root, { query: '完整索引目标' });
  const otherIndexAfter = await fs.stat(indexPath(root, textBook.id));

  assert.equal(failed.available, false);
  assert.equal(retained.available, false);
  assert.equal(otherIndexAfter.mtimeMs, otherIndexBefore.mtimeMs);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(indexPath(root, pdfBook.id), { readOnly: true });
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM ai_meta').all().map(({ key, value }) => [key, value]));
  db.close();
  assert.match(meta.parserVersion, /^pdfjs-6\.3\.289-/);
  assert.equal(meta.fingerprint === undefined, false);
});
