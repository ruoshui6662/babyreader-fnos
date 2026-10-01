'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPdfFixture } = require('./fixtures/pdf-fixtures');

const SANDBOX = path.join(os.tmpdir(), `zhenshu-pdf-disabled-${process.pid}`);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const PDF_ID = 'f'.repeat(64);
const TEXT_ID = 'e'.repeat(64);
const PDF_PATH = path.join(LIBRARY_ROOT, 'disabled.pdf');
const TEXT_PATH = path.join(LIBRARY_ROOT, 'legacy.txt');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'production';
process.env.ZHENSHU_ENABLE_LIBRARY_ORGANIZATION = '1';
delete process.env.ZHENSHU_PDF_ENABLED;
const { handleRequest, loadConfiguration } = require('../app/server/index');
let server;
let baseUrl;

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.writeFile(PDF_PATH, createPdfFixture());
  await fs.writeFile(TEXT_PATH, 'Legacy readable text');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({ libraryRoots: [LIBRARY_ROOT] }));
  // What older versions left behind after any app-settings save.
  await fs.writeFile(path.join(CONFIG_ROOT, 'pdf-feature.json'), '{"version":1,"enabled":false}');
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    books: [
      { id: PDF_ID, path: PDF_PATH, type: 'pdf', title: 'disabled' },
      { id: TEXT_ID, path: TEXT_PATH, type: 'txt', title: 'legacy' }
    ]
  }));
  await loadConfiguration();
  server = http.createServer((request, response) => void handleRequest(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/app/zhenshu`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

function setPdfKillSwitch(disabled) {
  if (disabled) process.env.ZHENSHU_PDF_ENABLED = 'false';
  else delete process.env.ZHENSHU_PDF_ENABLED;
}

test('PDF reading is on by default, even with a stale disabled setting from the removed switch', async () => {
  setPdfKillSwitch(false);
  const library = await (await fetch(`${baseUrl}/api/library`, { headers: { 'x-trim-userid': 'reader' } })).json();
  assert.equal(library.features.pdfReader, true);
  assert.equal(library.features.hiddenPdfCount, 0);
  assert.ok(library.books.some((book) => book.id === PDF_ID));
});

test('the kill switch hides catalog entries and denies direct content requests', async () => {
  setPdfKillSwitch(true);
  const response = await fetch(`${baseUrl}/api/library`, { headers: { 'x-trim-userid': 'reader' } });
  assert.equal(response.status, 200);
  const library = await response.json();
  assert.equal(library.features.pdfReader, false);
  assert.equal(library.books.some((book) => book.id === PDF_ID), false);
  assert.equal(library.features.hiddenPdfCount, 1);

  const organizationResponse = await fetch(`${baseUrl}/api/library/organization`, {
    headers: { 'x-trim-userid': 'reader' }
  });
  assert.equal(organizationResponse.status, 200);
  const organization = await organizationResponse.json();
  assert.deepEqual(organization.allBookOrder, [TEXT_ID]);
  assert.deepEqual(organization.unassignedOrder, [TEXT_ID]);
  assert.equal(organization.features.hiddenPdfCount, 1);

  const content = await fetch(`${baseUrl}/api/books/${PDF_ID}/content`, {
    headers: { 'x-trim-userid': 'reader', range: 'bytes=0-9' }
  });
  assert.equal(content.status, 404);
  assert.notEqual(content.headers.get('content-type'), 'application/pdf');
});

test('the kill switch changes PDF catalog, organization, content and search without a service restart', async () => {
  const headers = { 'x-trim-userid': 'reader' };
  setPdfKillSwitch(false);

  const libraryResponse = await fetch(`${baseUrl}/api/library`, { headers });
  const library = await libraryResponse.json();
  assert.equal(library.features.pdfReader, true);
  assert.equal(library.features.hiddenPdfCount, 0);
  assert.ok(library.books.some((book) => book.id === PDF_ID));

  const organizationResponse = await fetch(`${baseUrl}/api/library/organization`, { headers });
  assert.equal(organizationResponse.status, 200);
  const organization = await organizationResponse.json();
  assert.ok(organization.books.some((book) => book.id === PDF_ID));
  assert.ok(organization.allBookOrder.includes(PDF_ID));
  assert.ok(organization.unassignedOrder.includes(PDF_ID));

  const content = await fetch(`${baseUrl}/api/books/${PDF_ID}/content`, {
    headers: { ...headers, range: 'bytes=0-0' }
  });
  assert.equal(content.status, 206);
  assert.equal(content.headers.get('content-type'), 'application/pdf');

  const withoutIdentity = await fetch(`${baseUrl}/api/books/${PDF_ID}/content`, {
    headers: { range: 'bytes=0-0' }
  });
  assert.equal(withoutIdentity.status, 401);

  setPdfKillSwitch(true);
  const disabledLibrary = await (await fetch(`${baseUrl}/api/library`, { headers })).json();
  assert.equal(disabledLibrary.features.pdfReader, false);
  assert.ok(!disabledLibrary.books.some((book) => book.id === PDF_ID));
  assert.ok(disabledLibrary.books.some((book) => book.id === TEXT_ID));

  const disabledOrganization = await (await fetch(`${baseUrl}/api/library/organization`, { headers })).json();
  assert.ok(!disabledOrganization.books.some((book) => book.id === PDF_ID));
  assert.deepEqual(disabledOrganization.allBookOrder, [TEXT_ID]);
  assert.deepEqual(disabledOrganization.unassignedOrder, [TEXT_ID]);

  const blockedContent = await fetch(`${baseUrl}/api/books/${PDF_ID}/content`, { headers });
  assert.equal(blockedContent.status, 404);
  const blockedSearch = await fetch(`${baseUrl}/api/books/${PDF_ID}/search?q=synthetic`, { headers });
  assert.equal(blockedSearch.status, 200);
  assert.equal((await blockedSearch.json()).unavailableReason, 'pdf_search_disabled');

  const textContent = await fetch(`${baseUrl}/api/books/${TEXT_ID}/content`, { headers });
  assert.equal(textContent.status, 200);
  assert.equal(await textContent.text(), 'Legacy readable text');
});

test('disabling PDF only hides saved collection placement and restores it when re-enabled', async () => {
  const headers = { 'x-trim-userid': 'collection-reader', 'content-type': 'application/json' };
  setPdfKillSwitch(false);
  const createdResponse = await fetch(`${baseUrl}/api/library/collections`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'PDF 分类', revision: 0 })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const collectionId = created.collections[0].id;
  const placedResponse = await fetch(`${baseUrl}/api/library/books/${PDF_ID}/placement`, {
    method: 'PUT', headers,
    body: JSON.stringify({ collectionId, beforeBookId: null, revision: created.revision })
  });
  assert.equal(placedResponse.status, 200);
  const placed = await placedResponse.json();
  assert.deepEqual(placed.collectionOrders[collectionId], [PDF_ID]);

  setPdfKillSwitch(true);
  const hidden = await (await fetch(`${baseUrl}/api/library/organization`, { headers })).json();
  assert.equal(hidden.revision, placed.revision);
  assert.deepEqual(hidden.collectionOrders[collectionId], []);
  assert.equal(hidden.bookAssignments[PDF_ID], undefined);
  assert.ok(!hidden.orphanedBookIds.includes(PDF_ID));

  setPdfKillSwitch(false);
  const restored = await (await fetch(`${baseUrl}/api/library/organization`, { headers })).json();
  assert.equal(restored.revision, placed.revision);
  assert.deepEqual(restored.collectionOrders[collectionId], [PDF_ID]);
  assert.equal(restored.bookAssignments[PDF_ID], collectionId);
});
