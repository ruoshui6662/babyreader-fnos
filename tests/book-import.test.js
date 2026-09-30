'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable, PassThrough } = require('node:stream');
const { zipSync, strToU8 } = require('fflate');
const { createBookImporter, sanitizeImportName } = require('../app/server/book-import');
const { createPdfFixture } = require('./fixtures/pdf-fixtures');
const { createMobiFixture, createDrmMobiFixture } = require('./fixtures/mobi-fixtures');

function epubBytes(title = '导入 EPUB') {
  return Buffer.from(zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`),
    'OEBPS/c.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p></body></html>')
  }));
}

async function sandbox(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function importer(directory, options = {}) {
  return createBookImporter({ resolveTarget: async () => directory, ...options });
}

async function run(instance, bytes, name, extra = {}) {
  return instance.importStream(Readable.from([bytes]), {
    userId: 'admin', encodedName: encodeURIComponent(name), contentLength: String(bytes.length), ...extra
  });
}

async function listing(directory) {
  return (await fs.readdir(directory)).sort();
}

test('file names are reduced to one safe segment with an allowed extension', () => {
  assert.equal(sanitizeImportName(encodeURIComponent('../../etc/我的书.EPUB')).name, '我的书.epub');
  assert.equal(sanitizeImportName(encodeURIComponent('C:\\books\\a<b>:c.txt')).name, 'abc.txt');
  assert.equal(sanitizeImportName(encodeURIComponent('.hidden.md')).name, 'hidden.md');
  assert.equal(sanitizeImportName(encodeURIComponent(`${'长'.repeat(200)}.pdf`)).name.length <= 70, true);
  for (const bad of ['..epub', '.epub', '%E0%A4%A', encodeURIComponent('a/..'), '']) {
    assert.throws(() => sanitizeImportName(bad), (error) => ['IMPORT_BAD_NAME', 'IMPORT_UNSUPPORTED'].includes(error.code), bad);
  }
  assert.throws(() => sanitizeImportName('virus.exe'), (error) => error.code === 'IMPORT_UNSUPPORTED');
});

test('valid EPUB, PDF, text and MOBI uploads are published with no temp files left', async (t) => {
  const directory = await sandbox(t);
  const instance = importer(directory);
  const cases = [
    [epubBytes(), '小说.epub', 'epub'],
    [createPdfFixture(), 'paper.pdf', 'pdf'],
    [Buffer.from('# 标题\n\n正文'), 'notes.md', 'markdown'],
    [Buffer.from('纯文本'), 'plain.txt', 'txt'],
    [createMobiFixture(), 'kindle.azw3', 'mobi']
  ];
  for (const [bytes, name, type] of cases) {
    const result = await run(instance, bytes, name);
    assert.equal(result.type, type);
    assert.equal(result.name, name);
    assert.deepEqual(await fs.readFile(result.path), bytes);
  }
  assert.deepEqual(await listing(directory), ['kindle.azw3', 'notes.md', 'paper.pdf', 'plain.txt', '小说.epub'].sort());
});

test('an existing file is never overwritten: the upload gets a numbered name', async (t) => {
  const directory = await sandbox(t);
  await fs.writeFile(path.join(directory, 'a.txt'), 'original');
  const result = await run(importer(directory), Buffer.from('new'), 'a.txt');
  assert.equal(result.name, 'a (2).txt');
  assert.equal(await fs.readFile(path.join(directory, 'a.txt'), 'utf8'), 'original');
});

test('content is validated, not the extension', async (t) => {
  const directory = await sandbox(t);
  const instance = importer(directory);
  const cases = [
    [Buffer.from('MZ\u0090 not a book'), 'virus.epub', 'IMPORT_INVALID_FILE'],
    [Buffer.from('%NOT-PDF'), 'fake.pdf', 'IMPORT_INVALID_FILE'],
    [Buffer.from([0xff, 0xfe, 0x00, 0xd8]), 'binary.txt', 'IMPORT_INVALID_FILE'],
    [Buffer.from('plain words'), 'fake.mobi', 'IMPORT_INVALID_FILE'],
    [createDrmMobiFixture(), 'locked.azw', 'IMPORT_DRM'],
    [Buffer.alloc(0), 'empty.txt', 'IMPORT_INVALID_FILE']
  ];
  for (const [bytes, name, code] of cases) {
    await assert.rejects(run(instance, bytes, name), (error) => error.code === code, name);
  }
  assert.deepEqual(await listing(directory), []);
});

test('size limits apply before and during the upload; a lying Content-Length is refused', async (t) => {
  const directory = await sandbox(t);
  const instance = importer(directory);
  await assert.rejects(run(instance, Buffer.from('x'), 'a.txt', { contentLength: String(64 * 1024 * 1024) }), (error) => error.code === 'IMPORT_TOO_LARGE');
  await assert.rejects(run(instance, Buffer.from('longer than declared'), 'b.txt', { contentLength: '3' }), (error) => error.code === 'IMPORT_TOO_LARGE');
  await assert.rejects(run(instance, Buffer.from('short'), 'c.txt', { contentLength: '50' }), (error) => error.code === 'IMPORT_ABORTED');
  await assert.rejects(run(instance, Buffer.from('x'), 'd.txt', { contentLength: undefined }), (error) => error.code === 'IMPORT_LENGTH_REQUIRED');
  assert.deepEqual(await listing(directory), []);
});

test('a client that disconnects mid-upload leaves nothing behind', async (t) => {
  const directory = await sandbox(t);
  const stream = new PassThrough();
  const pending = importer(directory).importStream(stream, { userId: 'admin', encodedName: 'cut.txt', contentLength: '1000' });
  stream.write(Buffer.from('partial'));
  setTimeout(() => stream.destroy(), 20);
  await assert.rejects(pending, (error) => error.code === 'IMPORT_ABORTED');
  assert.deepEqual(await listing(directory), []);
});

test('duplicates by content are refused with the existing book id', async (t) => {
  const directory = await sandbox(t);
  const seen = [];
  const instance = importer(directory, { findDuplicate: async (size, sha256) => { seen.push([size, sha256]); return 'b'.repeat(64); } });
  await assert.rejects(run(instance, Buffer.from('same'), 'dup.txt'), (error) => error.code === 'IMPORT_DUPLICATE' && error.details.bookId === 'b'.repeat(64));
  assert.equal(seen[0][0], 4);
  assert.match(seen[0][1], /^[a-f0-9]{64}$/);
  assert.deepEqual(await listing(directory), []);
});

test('disabled formats, concurrency and a missing target are refused cleanly', async (t) => {
  const directory = await sandbox(t);
  const disabled = importer(directory, { isFormatEnabled: (type) => type !== 'mobi' });
  await assert.rejects(run(disabled, createMobiFixture(), 'k.mobi'), (error) => error.code === 'IMPORT_FORMAT_DISABLED');

  const instance = importer(directory);
  const slow = new PassThrough();
  const first = instance.importStream(slow, { userId: 'admin', encodedName: 'slow.txt', contentLength: '4' });
  await assert.rejects(run(instance, Buffer.from('b'), 'b.txt'), (error) => error.code === 'IMPORT_BUSY' && error.statusCode === 429);
  slow.end(Buffer.from('done'));
  assert.equal((await first).name, 'slow.txt');
  assert.equal((await run(instance, Buffer.from('c'), 'c.txt')).name, 'c.txt', 'slot released');

  const nowhere = createBookImporter({ resolveTarget: async () => { throw new Error('EACCES'); } });
  await assert.rejects(run(nowhere, Buffer.from('x'), 'x.txt'), (error) => error.code === 'IMPORT_NO_TARGET' && error.statusCode === 503);
});

test('dedupe, publish and cataloging run inside the exclusive section; a catalog failure removes the file', async (t) => {
  const directory = await sandbox(t);
  const events = [];
  const instance = importer(directory, {
    runExclusive: async (fn) => { events.push('lock'); try { return await fn(); } finally { events.push('unlock'); } },
    findDuplicate: async () => { events.push('dedupe'); return null; },
    afterPublish: async (result) => { events.push('index'); return { id: 'x', title: result.name }; }
  });
  const result = await run(instance, Buffer.from('ok'), 'ok.txt');
  assert.deepEqual(events, ['lock', 'dedupe', 'index', 'unlock']);
  assert.deepEqual(result.book, { id: 'x', title: 'ok.txt' });

  const failing = importer(directory, { afterPublish: async () => { throw new Error('index down'); } });
  await assert.rejects(run(failing, Buffer.from('bad'), 'bad.txt'), (error) => error.code === 'IMPORT_INDEX_FAILED');
  assert.deepEqual(await listing(directory), ['ok.txt']);
});
