'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync, strToU8 } = require('fflate');
const http = require('node:http');
const crypto = require('node:crypto');
const { scanLibrary } = require('../app/server/library');
const { parseSingleByteRange } = require('../app/server/byte-range');
const { createInvalidPdfFixture, createPdfFixture } = require('./fixtures/pdf-fixtures');

const SANDBOX = path.join(os.tmpdir(), `babyreader-pdf-api-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const PDF_ID = 'a'.repeat(64);
const TEXT_ID = 'b'.repeat(64);
const OUTSIDE_ID = 'c'.repeat(64);
const LARGE_PDF_ID = 'd'.repeat(64);
const EPUB_ID = '7'.repeat(64);
const PDF_PATH = path.join(LIBRARY_ROOT, 'reader.pdf');
const LARGE_PDF_PATH = path.join(LIBRARY_ROOT, 'large.pdf');
const EPUB_PATH = path.join(LIBRARY_ROOT, 'legacy.epub');
const TEXT_PATH = path.join(LIBRARY_ROOT, 'legacy.txt');
const OUTSIDE_PATH = path.join(SANDBOX, 'outside.pdf');
const PDF_ANNOTATION_ID = '00000000-0000-4000-8000-000000000001';

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'production';
process.env.BABYREADER_PDF_ENABLED = 'true';
const { handleRequest, loadConfiguration } = require('../app/server/index');
let apiServer;
let apiBaseUrl;

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('single byte ranges normalize closed, open-ended, and suffix forms without allocating file-sized buffers', () => {
  assert.deepEqual(parseSingleByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseSingleByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseSingleByteRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.deepEqual(parseSingleByteRange('bytes=-99', 10), { start: 0, end: 9 });
});

test('single byte range parser rejects malformed, multipart, unsatisfiable, empty, and overflowing inputs distinctly', () => {
  for (const header of ['items=0-1', 'bytes=1', 'bytes=1-2-3', 'bytes= 1-2']) {
    assert.equal(parseSingleByteRange(header, 10).kind, 'invalid', header);
  }
  assert.equal(parseSingleByteRange('bytes=-0', 10).kind, 'unsatisfiable');
  assert.equal(parseSingleByteRange('bytes=0-1,4-5', 10).kind, 'multiple');
  assert.equal(parseSingleByteRange('bytes=10-', 10).kind, 'unsatisfiable');
  assert.equal(parseSingleByteRange('bytes=0-0', 0).kind, 'unsatisfiable');
  assert.equal(parseSingleByteRange('bytes=9007199254740992-', 10).kind, 'invalid');
});

test('library scan recognizes signature-valid PDFs without parsing their bytes as text', async (t) => {
  const root = await temporaryDirectory(t, 'babyreader-pdf-scan-');
  const pdfPath = path.join(root, 'synthetic.pdf');
  await fs.writeFile(pdfPath, createPdfFixture());
  const index = await scanLibrary([root]);
  assert.equal(index.scan.discoveredCount, 1);
  assert.equal(index.scan.indexedCount, 1);
  assert.equal(index.scan.errorCount, 0);
  assert.equal(index.books[0].type, 'pdf');
  assert.equal(index.books[0].title, 'synthetic');
  assert.equal(index.books[0].size, (await fs.stat(pdfPath)).size);
});

test('library scan discovers PDFs in nested authorized folders regardless of extension case', async (t) => {
  const root = await temporaryDirectory(t, 'babyreader-pdf-nested-');
  const nested = path.join(root, '分类', '子目录');
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, 'root.pdf'), createPdfFixture());
  await fs.writeFile(path.join(nested, 'chapter.PDF'), createPdfFixture());

  const index = await scanLibrary([root]);
  assert.equal(index.scan.discoveredCount, 2);
  assert.equal(index.scan.errorCount, 0);
  assert.equal(index.books.filter((book) => book.type === 'pdf').length, 2);
  assert.ok(index.books.some((book) => book.relativePath.replace(/\\/g, '/') === '分类/子目录/chapter.PDF'));
});

test('library scan rejects invalid PDF signatures and signatures hidden beyond the bounded header probe', async (t) => {
  const root = await temporaryDirectory(t, 'babyreader-invalid-pdf-');
  await fs.writeFile(path.join(root, 'plain.pdf'), Buffer.from('not a PDF', 'ascii'));
  await fs.writeFile(path.join(root, 'late-signature.pdf'), createInvalidPdfFixture());
  const index = await scanLibrary([root]);
  assert.equal(index.scan.discoveredCount, 2);
  assert.equal(index.scan.indexedCount, 0);
  assert.equal(index.scan.errorCount, 2);
  assert.ok(index.books.every((book) => book.error));
});

test('library scan ignores PDF symlinks and never discovers files outside an authorized root', async (t) => {
  const sandbox = await temporaryDirectory(t, 'babyreader-pdf-symlink-');
  const root = path.join(sandbox, 'authorized');
  const outside = path.join(sandbox, 'outside.pdf');
  await fs.mkdir(root);
  await fs.writeFile(outside, createPdfFixture());
  try {
    await fs.symlink(outside, path.join(root, 'linked.pdf'), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlink creation is unavailable in this environment');
    throw error;
  }
  const index = await scanLibrary([root]);
  assert.equal(index.scan.discoveredCount, 0);
  assert.equal(index.books.length, 0);
});

test('library scan ignores directories with a .pdf suffix instead of treating them as books', async (t) => {
  const root = await temporaryDirectory(t, 'babyreader-pdf-directory-');
  await fs.mkdir(path.join(root, 'not-a-file.pdf'));
  const index = await scanLibrary([root]);
  assert.equal(index.scan.discoveredCount, 0);
  assert.equal(index.books.length, 0);
});

test('library scan records large PDF size using bounded header inspection, not a whole-file text read', async (t) => {
  const root = await temporaryDirectory(t, 'babyreader-large-pdf-');
  const pdfPath = path.join(root, 'large.pdf');
  const handle = await fs.open(pdfPath, 'w');
  await handle.write(Buffer.from('%PDF-1.7\n', 'ascii'), 0, 9, 0);
  await handle.truncate(32 * 1024 * 1024);
  await handle.close();
  const index = await scanLibrary([root]);
  assert.equal(index.scan.indexedCount, 1);
  assert.equal(index.books[0].type, 'pdf');
  assert.equal(index.books[0].size, 32 * 1024 * 1024);
});

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.writeFile(PDF_PATH, createPdfFixture());
  const largePdfHandle = await fs.open(LARGE_PDF_PATH, 'w');
  await largePdfHandle.write(Buffer.from('%PDF-1.7\n', 'ascii'), 0, 9, 0);
  await largePdfHandle.truncate(32 * 1024 * 1024);
  await largePdfHandle.close();
  await fs.writeFile(TEXT_PATH, 'Legacy text content');
  const epubBytes = zipSync({
    'META-INF/container.xml': strToU8('<container><rootfile full-path="OPS/content.opf"/></container>'),
    'OPS/content.opf': strToU8('<package><metadata><dc:title>Legacy EPUB</dc:title></metadata></package>')
  });
  await fs.writeFile(EPUB_PATH, epubBytes);
  await fs.writeFile(OUTSIDE_PATH, createPdfFixture({ text: 'unauthorized outside content' }));
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({ libraryRoots: [LIBRARY_ROOT] }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    books: [
      { id: PDF_ID, path: PDF_PATH, type: 'pdf', title: 'reader', fingerprint: await sourceFingerprint(PDF_PATH) },
      { id: LARGE_PDF_ID, path: LARGE_PDF_PATH, type: 'pdf', title: 'large', fingerprint: await sourceFingerprint(LARGE_PDF_PATH) },
      { id: TEXT_ID, path: TEXT_PATH, type: 'txt', title: 'legacy' },
      { id: EPUB_ID, path: EPUB_PATH, type: 'epub', title: 'legacy epub' },
      { id: OUTSIDE_ID, path: OUTSIDE_PATH, type: 'pdf', title: 'outside' }
    ]
  }));
  await loadConfiguration();
  apiServer = http.createServer((request, response) => void handleRequest(request, response));
  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;
});

test.after(async () => {
  if (apiServer) {
    apiServer.closeAllConnections();
    await new Promise((resolve) => apiServer.close(resolve));
  }
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

function contentUrl(bookId) {
  return `${apiBaseUrl}/app/babyreader-fnos/api/books/${bookId}/content`;
}

function pdfAnnotationsUrl(bookId) {
  return `${apiBaseUrl}/app/babyreader-fnos/api/books/${bookId}/pdf-annotations`;
}

function pdfAnnotationInput(id = PDF_ANNOTATION_ID, overrides = {}) {
  return {
    version: 1,
    type: 'pdf',
    id,
    kind: 'highlight',
    style: 'marker',
    color: 'yellow',
    text: 'PDF selected phrase',
    contextBefore: 'preceding words',
    contextAfter: 'following words',
    thought: '',
    targets: [{ pageIndex: 2, quads: [[0.1, 0.2, 0.2, 0.2, 0.2, 0.23, 0.1, 0.23]] }],
    ...overrides
  };
}

async function sourceFingerprint(filePath) {
  const stat = await fs.stat(filePath);
  return crypto.createHash('sha256')
    .update(`${path.resolve(filePath)}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}`)
    .digest('hex');
}

test('PDF annotation API provides authenticated, user-isolated CRUD and rejects non-PDF books', async () => {
  const url = pdfAnnotationsUrl(PDF_ID);
  const unauthorized = await fetch(url);
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();

  const input = pdfAnnotationInput();
  const createdResponse = await fetch(url, {
    method: 'POST',
    headers: { 'x-trim-userid': 'alice', 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  assert.equal(createdResponse.status, 200);
  const createdPayload = await createdResponse.json();
  assert.equal(createdPayload.annotation.id, input.id);
  assert.match(createdPayload.annotation.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal('path' in createdPayload.annotation, false);

  const retry = await fetch(url, {
    method: 'POST',
    headers: { 'x-trim-userid': 'alice', 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).annotation.id, input.id);

  const conflict = await fetch(url, {
    method: 'POST',
    headers: { 'x-trim-userid': 'alice', 'content-type': 'application/json' },
    body: JSON.stringify(pdfAnnotationInput(input.id, { text: 'different text' }))
  });
  assert.equal(conflict.status, 409);
  await conflict.arrayBuffer();

  const aliceList = await fetch(url, { headers: { 'x-trim-userid': 'alice' } });
  assert.deepEqual((await aliceList.json()).annotations.map((item) => item.id), [input.id]);
  const bobList = await fetch(url, { headers: { 'x-trim-userid': 'bob' } });
  assert.deepEqual((await bobList.json()).annotations, []);

  const updateUrl = `${url}/${input.id}`;
  const update = await fetch(updateUrl, {
    method: 'PATCH',
    headers: { 'x-trim-userid': 'alice', 'content-type': 'application/json' },
    body: JSON.stringify({ style: 'wave', color: 'blue', thought: '我的想法' })
  });
  assert.equal(update.status, 200);
  const updatedAnnotation = (await update.json()).annotation;
  assert.equal(updatedAnnotation.style, 'wave');
  assert.equal(updatedAnnotation.thought, '我的想法');
  assert.equal(updatedAnnotation.sourceFingerprint, createdPayload.annotation.sourceFingerprint);

  const forbiddenEdit = await fetch(updateUrl, {
    method: 'PATCH',
    headers: { 'x-trim-userid': 'alice', 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'thought' })
  });
  assert.equal(forbiddenEdit.status, 400);
  await forbiddenEdit.arrayBuffer();

  const wrongFormat = await fetch(pdfAnnotationsUrl(EPUB_ID), {
    method: 'POST',
    headers: { 'x-trim-userid': 'alice', 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  assert.equal(wrongFormat.status, 415);
  await wrongFormat.arrayBuffer();

  const deleted = await fetch(updateUrl, { method: 'DELETE', headers: { 'x-trim-userid': 'alice' } });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true, id: input.id });
  const secondDelete = await fetch(updateUrl, { method: 'DELETE', headers: { 'x-trim-userid': 'alice' } });
  assert.deepEqual(await secondDelete.json(), { deleted: false, id: input.id });
});

test('PDF annotation API enforces PDF enablement, authorized books, JSON limits, and geometry validation', async () => {
  const url = pdfAnnotationsUrl(PDF_ID);
  const invalidRecords = [
    pdfAnnotationInput('00000000-0000-4000-8000-000000000010', { targets: [{ pageIndex: -1, quads: [[0, 0, 1, 0, 1, 1, 0, 1]] }] }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000011', { targets: [{ pageIndex: 0, quads: [[0, 0, 0, 0, 0, 0, 0, 0]] }] }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000012', { targets: [{ pageIndex: 0, quads: [[0, 0, 1.1, 0, 1, 1, 0, 1]] }] }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000013', { text: 'x'.repeat(4001) }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000017', { thought: 'x'.repeat(4001) }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000018', { targets: [{ pageIndex: 10000, quads: [[0, 0, 1, 0, 1, 1, 0, 1]] }] }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000019', { targets: [{ pageIndex: 0, quads: [[0, 0, null, 0, 1, 1, 0, 1]] }] }),
    pdfAnnotationInput('00000000-0000-4000-8000-000000000022', { targets: [
      { pageIndex: 0, quads: [[0, 0, 1, 0, 1, 1, 0, 1]] },
      { pageIndex: 0, quads: [[0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]] }
    ] }),
    { input: pdfAnnotationInput('00000000-0000-4000-8000-000000000014', { targets: Array.from({ length: 9 }, (_, pageIndex) => ({ pageIndex, quads: [[0, 0, 1, 0, 1, 1, 0, 1]] })) }), status: 400 },
    { input: pdfAnnotationInput('00000000-0000-4000-8000-000000000015', { targets: [{ pageIndex: 0, quads: Array.from({ length: 513 }, () => [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]) }] }), status: 413 },
    { input: pdfAnnotationInput('00000000-0000-4000-8000-000000000016', { sourceFingerprint: 'forged' }), status: 400 }
  ];
  for (const item of invalidRecords) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-trim-userid': 'api-limits', 'content-type': 'application/json' },
      body: JSON.stringify(item.input || item)
    });
    assert.equal(response.status, item.status || 400);
    await response.arrayBuffer();
  }

  const unknown = await fetch(pdfAnnotationsUrl('e'.repeat(64)), { headers: { 'x-trim-userid': 'api-limits' } });
  assert.equal(unknown.status, 404);
  await unknown.arrayBuffer();

  const tooLarge = await fetch(url, {
    method: 'POST',
    headers: { 'x-trim-userid': 'api-limits', 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })
  });
  assert.equal(tooLarge.status, 413);
  await tooLarge.arrayBuffer();

  const originalEnabled = process.env.BABYREADER_PDF_ENABLED;
  try {
    process.env.BABYREADER_PDF_ENABLED = 'false';
    const disabled = await fetch(url, { headers: { 'x-trim-userid': 'api-limits' } });
    assert.equal(disabled.status, 404);
    await disabled.arrayBuffer();
  } finally {
    process.env.BABYREADER_PDF_ENABLED = originalEnabled;
  }

  const settingsPath = path.join(CONFIG_ROOT, 'settings.json');
  const originalSettings = await fs.readFile(settingsPath, 'utf8');
  try {
    await fs.writeFile(settingsPath, JSON.stringify({ libraryRoots: [] }));
    await loadConfiguration();
    const revoked = await fetch(url, { headers: { 'x-trim-userid': 'api-limits' } });
    assert.notEqual(revoked.status, 200);
    await revoked.arrayBuffer();
  } finally {
    await fs.writeFile(settingsPath, originalSettings);
    await loadConfiguration();
  }
});

test('PDF annotation API makes source changes stale and permits cleanup without allowing edits', async () => {
  const url = pdfAnnotationsUrl(PDF_ID);
  const input = pdfAnnotationInput('00000000-0000-4000-8000-000000000020');
  const created = await fetch(url, {
    method: 'POST',
    headers: { 'x-trim-userid': 'stale-source', 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  assert.equal(created.status, 200);
  await created.arrayBuffer();

  const originalPdf = await fs.readFile(PDF_PATH);
  try {
    await fs.writeFile(PDF_PATH, createPdfFixture({ text: 'the replacement PDF source has changed size' }));
    const listed = await fetch(url, { headers: { 'x-trim-userid': 'stale-source' } });
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).annotations[0].sourceStale, true);

    const rejectedCreate = await fetch(url, {
      method: 'POST',
      headers: { 'x-trim-userid': 'stale-source', 'content-type': 'application/json' },
      body: JSON.stringify(pdfAnnotationInput('00000000-0000-4000-8000-000000000021'))
    });
    assert.equal(rejectedCreate.status, 409);
    await rejectedCreate.arrayBuffer();

    const rejectedEdit = await fetch(`${url}/${input.id}`, {
      method: 'PATCH',
      headers: { 'x-trim-userid': 'stale-source', 'content-type': 'application/json' },
      body: JSON.stringify({ thought: '不能改旧来源' })
    });
    assert.equal(rejectedEdit.status, 409);
    await rejectedEdit.arrayBuffer();

    const deleted = await fetch(`${url}/${input.id}`, { method: 'DELETE', headers: { 'x-trim-userid': 'stale-source' } });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true, id: input.id });
  } finally {
    await fs.writeFile(PDF_PATH, originalPdf);
  }
});

test('PDF content API serves ordinary GET, byte ranges, and HEAD with private PDF headers', async () => {
  const full = await fetch(contentUrl(PDF_ID), { headers: { 'x-trim-userid': 'reader' } });
  const expected = await fs.readFile(PDF_PATH);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'application/pdf');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), expected);

  const ranged = await fetch(contentUrl(PDF_ID), {
    headers: { 'x-trim-userid': 'reader', range: 'bytes=2-8' }
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 2-8/${expected.length}`);
  assert.equal(ranged.headers.get('content-length'), '7');
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), expected.subarray(2, 9));

  const head = await fetch(contentUrl(PDF_ID), {
    method: 'HEAD', headers: { 'x-trim-userid': 'reader', range: 'bytes=-4' }
  });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-range'), `bytes ${expected.length - 4}-${expected.length - 1}/${expected.length}`);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('PDF content API rejects malformed, multipart, and unsatisfiable ranges without returning bytes', async () => {
  for (const range of ['bytes=999999-', 'bytes=0-1,3-4', 'bytes=bad']) {
    const response = await fetch(contentUrl(PDF_ID), {
      headers: { 'x-trim-userid': 'reader', range }
    });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), `bytes */${(await fs.stat(PDF_PATH)).size}`);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const oversized = await fetch(contentUrl(LARGE_PDF_ID), {
    headers: { 'x-trim-userid': 'reader', range: 'bytes=0-8388608' }
  });
  assert.equal(oversized.status, 416);
  assert.equal(oversized.headers.get('content-range'), `bytes */${(await fs.stat(LARGE_PDF_PATH)).size}`);
  await oversized.arrayBuffer();
});

test('PDF content API rechecks the bounded signature after the indexed file changes', async () => {
  const original = await fs.readFile(PDF_PATH);
  try {
    await fs.writeFile(PDF_PATH, Buffer.from('replaced by non-PDF data'));
    const response = await fetch(contentUrl(PDF_ID), { headers: { 'x-trim-userid': 'reader' } });
    assert.equal(response.status, 409);
    assert.notEqual(response.headers.get('content-type'), 'application/pdf');
    await response.arrayBuffer();
  } finally {
    await fs.writeFile(PDF_PATH, original);
  }
});

test('PDF content API requires gateway identity and an indexed authorized book ID', async () => {
  const unauthenticated = await fetch(contentUrl(PDF_ID));
  assert.equal(unauthenticated.status, 401);

  const unknown = await fetch(contentUrl('e'.repeat(64)), { headers: { 'x-trim-userid': 'reader' } });
  assert.equal(unknown.status, 404);

  const outside = await fetch(contentUrl(OUTSIDE_ID), { headers: { 'x-trim-userid': 'reader' } });
  assert.notEqual(outside.status, 200);
  assert.notEqual(outside.headers.get('content-type'), 'application/pdf');
  assert.notEqual(Buffer.from(await outside.arrayBuffer()).toString('ascii'), OUTSIDE_PATH);

  const settingsPath = path.join(CONFIG_ROOT, 'settings.json');
  const originalSettings = await fs.readFile(settingsPath, 'utf8');
  try {
    await fs.writeFile(settingsPath, JSON.stringify({ libraryRoots: [] }));
    await loadConfiguration();
    const revoked = await fetch(contentUrl(PDF_ID), {
      headers: { 'x-trim-userid': 'reader', range: 'bytes=0-9' }
    });
    assert.notEqual(revoked.status, 200);
    assert.notEqual(revoked.headers.get('content-type'), 'application/pdf');
    await revoked.arrayBuffer();
  } finally {
    await fs.writeFile(settingsPath, originalSettings);
    await loadConfiguration();
  }
});

test('PDF search and AI evidence use page-aware FTS locators', async () => {
  // Earlier content tests rewrite and restore this fixture, changing mtime.
  // Simulate the required rescan before asking AI for fingerprint-bound pages.
  const libraryFile = path.join(DATA_ROOT, 'index', 'library.json');
  const libraryIndex = JSON.parse(await fs.readFile(libraryFile, 'utf8'));
  libraryIndex.books.find((book) => book.id === PDF_ID).fingerprint = await sourceFingerprint(PDF_PATH);
  await fs.writeFile(libraryFile, JSON.stringify(libraryIndex));
  const search = await fetch(`${contentUrl(PDF_ID).replace('/content', '/search')}?q=fixture`, {
    headers: { 'x-trim-userid': 'reader' }
  });
  assert.equal(search.status, 200);
  const payload = await search.json();
  assert.equal(payload.available, true);
  assert.equal(payload.results[0]?.matchText, 'fixture');
  assert.equal(payload.results[0]?.locator.type, 'pdf');
  assert.equal(payload.results[0]?.locator.pageIndex, 0);
  assert.equal(typeof payload.results[0]?.locator.textOffset, 'number');
  assert.equal('path' in payload.results[0], false);

  const ai = await fetch(contentUrl(PDF_ID).replace('/content', '/ai/search'), {
    method: 'POST',
    headers: { 'x-trim-userid': 'reader', 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'fixture', scope: 'page', pageIndex: 0 })
  });
  assert.equal(ai.status, 200);
  const evidence = await ai.json();
  assert.equal(evidence.sources[0]?.pageIndex, 0);
  assert.equal('path' in evidence.sources[0], false);
});

test('aborting a large PDF range does not prevent subsequent authorized reads', async () => {
  await new Promise((resolve, reject) => {
    const request = http.get(`${apiBaseUrl}/app/babyreader-fnos/api/books/${LARGE_PDF_ID}/content`, {
      headers: { 'x-trim-userid': 'reader', range: 'bytes=0-8388607' }
    }, (response) => {
      response.once('data', () => {
        response.destroy();
        request.destroy();
        resolve();
      });
      response.once('error', () => {});
    });
    request.once('error', (error) => {
      if (error.code === 'ECONNRESET') resolve();
      else reject(error);
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const next = await fetch(contentUrl(PDF_ID), {
    headers: { 'x-trim-userid': 'reader', range: 'bytes=0-3' }
  });
  assert.equal(next.status, 206);
  assert.equal((await next.arrayBuffer()).byteLength, 4);
});

test('replacing an indexed PDF path with a symlink is rejected before content is served', async (t) => {
  const backup = `${PDF_PATH}.backup`;
  await fs.rename(PDF_PATH, backup);
  try {
    try {
      await fs.symlink(OUTSIDE_PATH, PDF_PATH, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlink creation is unavailable in this environment');
      throw error;
    }
    const response = await fetch(contentUrl(PDF_ID), {
      headers: { 'x-trim-userid': 'reader', range: 'bytes=0-9' }
    });
    assert.equal(response.status, 404);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  } finally {
    await fs.rm(PDF_PATH, { force: true });
    try {
      await fs.access(backup);
      await fs.rename(backup, PDF_PATH);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
});

test('legacy text content remains a full text/plain response', async () => {
  const response = await fetch(contentUrl(TEXT_ID), { headers: { 'x-trim-userid': 'reader' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(await response.text(), 'Legacy text content');
});

test('legacy EPUB content remains an unmodified application/epub+zip response', async () => {
  const response = await fetch(contentUrl(EPUB_ID), { headers: { 'x-trim-userid': 'reader' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/epub+zip');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(EPUB_PATH));
});
