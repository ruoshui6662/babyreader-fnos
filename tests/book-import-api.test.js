'use strict';

// MOBI/import plan Task 4: PUT /api/library/imports end to end against a real
// server, a synthetic fnOS share and the library lock shared with scans.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync, strToU8 } = require('fflate');
const { createMobiFixture } = require('./fixtures/mobi-fixtures');

const SANDBOX = path.join(os.tmpdir(), `babyreader-import-api-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const SHARE_ROOT = path.join(SANDBOX, 'share', 'babyreader-fnos', 'library');
const IMPORT_DIR = path.join(SHARE_ROOT, '导入');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = SHARE_ROOT;
process.env.NODE_ENV = 'production';
process.env.BABYREADER_ENABLE_LIBRARY_ORGANIZATION = '1';
delete process.env.BABYREADER_IMPORT_ENABLED;
delete process.env.BABYREADER_MOBI_ENABLED;
const { handleRequest, loadConfiguration } = require('../app/server/index');

const ADMIN = { 'x-trim-userid': 'admin', 'x-trim-isadmin': 'true' };
const READER = { 'x-trim-userid': 'reader', 'x-trim-isadmin': 'false' };
let server;
let baseUrl;
// Built once: ZIP entries record the build time (2 s resolution), so rebuilding
// "the same" book can yield different bytes and must not be relied on as a
// duplicate.
let firstBookBytes;

function epubBytes(title) {
  return Buffer.from(zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>导入作者</dc:creator></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`),
    'OEBPS/c.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${title} 正文</p></body></html>`)
  }));
}

async function upload(bytes, name, headers = ADMIN, extra = {}) {
  const response = await fetch(`${baseUrl}/api/library/imports`, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      'x-babyreader-request': 'import',
      'x-babyreader-filename': encodeURIComponent(name),
      ...extra
    },
    body: bytes
  });
  return { status: response.status, body: await response.json() };
}

async function library(headers = ADMIN) {
  return (await fetch(`${baseUrl}/api/library`, { headers })).json();
}

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(SHARE_ROOT, { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.writeFile(path.join(LIBRARY_ROOT, 'existing.txt'), '已有的书');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({ libraryRoots: [LIBRARY_ROOT] }));
  // What older versions left behind after any app-settings save: ignored now.
  await fs.writeFile(path.join(CONFIG_ROOT, 'import-feature.json'), '{"version":1,"enabled":false}');
  await fs.writeFile(path.join(CONFIG_ROOT, 'mobi-feature.json'), '{"version":1,"enabled":false}');
  await loadConfiguration();
  server = http.createServer((request, response) => void handleRequest(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/app/babyreader-fnos`;
  await fetch(`${baseUrl}/api/library/scan`, { method: 'POST', headers: ADMIN });
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

test('the import kill switch refuses uploads and stops advertising import', async () => {
  process.env.BABYREADER_IMPORT_ENABLED = 'false';
  const result = await upload(epubBytes('关闭时'), 'off.epub', ADMIN);
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'IMPORT_DISABLED');
  assert.equal((await library(ADMIN)).features.bookImport, false);
  delete process.env.BABYREADER_IMPORT_ENABLED;
});

test('import is on by default, but only administrators, from this origin and with the import header, may upload', async () => {
  assert.equal((await library(ADMIN)).features.bookImport, true);
  assert.equal((await library(READER)).features.bookImport, false);
  assert.equal((await upload(epubBytes('x'), 'x.epub', READER)).body.code, 'IMPORT_FORBIDDEN');
  assert.equal((await upload(epubBytes('x'), 'x.epub', ADMIN, { 'x-babyreader-request': 'other' })).status, 403);
  assert.equal((await upload(epubBytes('x'), 'x.epub', ADMIN, { 'sec-fetch-site': 'cross-site' })).body.code, 'IMPORT_BAD_REQUEST');
  assert.deepEqual(await fs.readdir(IMPORT_DIR).catch(() => []), []);
});

test('an EPUB import lands in the share, joins the catalog at once and is readable', async () => {
  firstBookBytes = epubBytes('导入的书');
  const bytes = firstBookBytes;
  const result = await upload(bytes, '我的书.epub');
  assert.equal(result.status, 201);
  assert.equal(result.body.name, '我的书.epub');
  assert.equal(result.body.book.title, '导入的书');
  assert.equal(result.body.book.author, '导入作者');
  assert.equal(result.body.book.path, undefined, 'paths stay redacted');
  assert.deepEqual(await fs.readFile(path.join(IMPORT_DIR, '我的书.epub')), bytes);

  const catalog = await library(READER);
  const book = catalog.books.find((item) => item.id === result.body.book.id);
  assert.ok(book, 'visible to every user without a rescan');
  assert.ok(catalog.books.some((item) => item.title === 'existing'), 'existing books are untouched');
  const content = await fetch(`${baseUrl}/api/books/${book.id}/content`, { headers: READER });
  assert.equal(content.status, 200);
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);

  const organization = await (await fetch(`${baseUrl}/api/library/organization`, { headers: READER })).json();
  assert.ok(organization.unassignedOrder.includes(book.id), 'new books start unassigned');
});

test('the same content is refused as a duplicate; a new book with the same name is renamed', async () => {
  const first = (await library()).books.find((item) => item.title === '导入的书');
  const duplicate = await upload(firstBookBytes, '另一个名字.epub');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'IMPORT_DUPLICATE');
  assert.equal(duplicate.body.bookId, first.id);

  const renamed = await upload(epubBytes('同名不同书'), '我的书.epub');
  assert.equal(renamed.status, 201);
  assert.equal(renamed.body.name, '我的书 (2).epub');
});

test('MOBI imports follow the MOBI kill switch and are read through the derived EPUB', async () => {
  const bytes = createMobiFixture({ title: '导入的 Kindle 书' });
  process.env.BABYREADER_MOBI_ENABLED = 'false';
  const disabled = await upload(bytes, 'kindle.mobi');
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.code, 'IMPORT_FORMAT_DISABLED');

  delete process.env.BABYREADER_MOBI_ENABLED;
  const imported = await upload(bytes, 'kindle.mobi');
  assert.equal(imported.status, 201);
  assert.equal(imported.body.book.type, 'epub');
  assert.equal(imported.body.book.format, 'mobi');
  const content = await fetch(`${baseUrl}/api/books/${imported.body.book.id}/content`, { headers: READER });
  assert.equal(content.headers.get('content-type'), 'application/epub+zip');
});

test('an import racing a full rescan is kept by both', async () => {
  const [scan, imported] = await Promise.all([
    fetch(`${baseUrl}/api/library/scan`, { method: 'POST', headers: ADMIN }),
    upload(epubBytes('与扫描并发'), 'race.epub')
  ]);
  assert.equal(scan.status, 200);
  assert.equal(imported.status, 201);
  assert.ok((await library()).books.some((item) => item.id === imported.body.book.id));
});

test('an oversized declared length is refused before the body is read', async () => {
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/api/library/imports`, {
      method: 'PUT',
      headers: {
        ...ADMIN,
        'x-babyreader-request': 'import',
        'x-babyreader-filename': 'huge.epub',
        'content-length': String(512 * 1024 * 1024)
      }
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.write(Buffer.alloc(1024));
  });
  assert.equal(status, 413);
  assert.equal((await fs.readdir(IMPORT_DIR)).some((name) => name.startsWith('.babyreader-import')), false);
});

test('a missing share makes import unavailable instead of writing elsewhere', async () => {
  const parked = `${SHARE_ROOT}-parked`;
  await fs.rename(SHARE_ROOT, parked);
  try {
    const result = await upload(epubBytes('无处可去'), 'nowhere.epub');
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'IMPORT_NO_TARGET');
  } finally {
    await fs.rename(parked, SHARE_ROOT);
  }
});
