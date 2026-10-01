'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.join(os.tmpdir(), `zhenshu-planned-pdf-${process.pid}`);
const dataRoot = path.join(root, 'var');
const configRoot = path.join(root, 'etc');
const libraryRoot = path.join(root, 'library');
const bookId = 'f'.repeat(64);
const bookPath = path.join(libraryRoot, 'pages.pdf');

process.env.TRIM_PKGVAR = dataRoot;
process.env.TRIM_PKGETC = configRoot;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.ZHENSHU_PDF_ENABLED = '1';
process.env.NODE_ENV = 'development';
process.env.OPENAI_API_KEY = 'pdf-planned-key';
process.env.OPENAI_BASE_URL = 'https://93.184.216.34/v1';
process.env.OPENAI_MODEL = 'answer-model';
process.env.OPENAI_API_FORMAT = 'chat';

const { createPdfFixture } = require('./fixtures/pdf-fixtures');
const { fingerprintBook } = require('../app/server/library');
const { handleRequest, loadConfiguration } = require('../app/server/index');

const PAGES = Array.from({ length: 12 }, (_, index) => `第${index + 1}页的内容：${index === 9 ? '香蕉市场调查的结论是价格上涨' : `普通资料编号${index + 1}`}`);
let server;
let baseUrl;
const headers = { 'content-type': 'application/json', 'x-trim-userid': 'pdf-reader', 'x-trim-username': 'pdf-reader' };

async function withUpstream(callback) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://93.184.216.34/')) return originalFetch(url, options);
    const body = JSON.parse(options.body);
    calls.push(body);
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '依据在原文【1】。' } }] })}\n\ndata: [DONE]\n\n`));
        controller.close();
      }
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    return { result: await callback(), calls };
  } finally {
    global.fetch = originalFetch;
  }
}

async function ask(body) {
  const response = await fetch(`${baseUrl}/app/zhenshu/api/books/${bookId}/ai/ask/stream`, {
    method: 'POST', headers, body: JSON.stringify({ mode: 'planned', selectedText: '', history: [], ...body })
  });
  const text = await response.text();
  return { status: response.status, events: text.split('\n\n').filter(Boolean).map((frame) => ({
    event: frame.match(/^event:\s*(.+)$/m)?.[1],
    data: JSON.parse(frame.match(/^data:\s*(.+)$/m)?.[1] || '{}')
  })) };
}

test.before(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(libraryRoot, { recursive: true });
  await fs.mkdir(configRoot, { recursive: true });
  await fs.mkdir(path.join(dataRoot, 'index'), { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({ libraryRoots: [libraryRoot] }));
  await fs.writeFile(bookPath, createPdfFixture({ pageTexts: PAGES }));
  const fingerprint = fingerprintBook(bookPath, await fs.stat(bookPath));
  await fs.writeFile(path.join(dataRoot, 'index', 'library.json'), JSON.stringify({
    version: 2, generatedAt: new Date().toISOString(),
    books: [{ id: bookId, path: bookPath, type: 'pdf', title: '页面资料', fingerprint }],
    scan: { status: 'completed', errorCount: 0, rootErrors: [] }
  }));
  await loadConfiguration();
  server = http.createServer((request, response) => void handleRequest(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

test('a PDF without bookmarks gets page-window chapters in the 导读 outline', async () => {
  const status = await fetch(`${baseUrl}/app/zhenshu/api/books/${bookId}/ai/map`, { headers }).then((response) => response.json());
  assert.deepEqual(status.nodes.map((node) => node.label), ['第 1–8 页', '第 9–12 页']);
  assert.ok(status.nodes.every((node) => Number.isInteger(node.anchor?.chapterIndex)));
});

test('“第N页” questions read those pages and cite them by page', async () => {
  const { result, calls } = await withUpstream(() => ask({ question: '第10页讲了什么？' }));
  const meta = result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'pages');
  assert.match(meta.plan.scopeLabel, /第 10 页（全文）/);
  assert.equal(meta.sources[0].chapterIndex, 9);
  const text = calls[0].messages.at(-1).content;
  assert.match(text, /香蕉市场调查的结论是价格上涨/);
  assert.doesNotMatch(text, /普通资料编号3/);
});

test('“本页” uses the reader’s current page; lookups search the whole PDF', async () => {
  const current = await withUpstream(() => ask({ question: '本页讲了什么？', chapter: { index: 2, href: '', label: '' } }));
  assert.match(current.calls[0].messages.at(-1).content, /普通资料编号3/);
  const lookup = await withUpstream(() => ask({ question: '香蕉的价格怎么变化？' }));
  const meta = lookup.result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'lookup');
  assert.match(lookup.calls[0].messages.at(-1).content, /价格上涨/);
});

test('PDF answers are saved with page sources tied to the file', async () => {
  const created = await fetch(`${baseUrl}/app/zhenshu/api/books/${bookId}/ai/conversations`, {
    method: 'POST', headers, body: JSON.stringify({ title: 'PDF' })
  }).then((response) => response.json());
  const { result } = await withUpstream(() => ask({ question: '第10页讲了什么？', conversationId: created.id }));
  assert.equal(result.events.find((event) => event.event === 'done').data.persisted, true);
  const conversation = await fetch(`${baseUrl}/app/zhenshu/api/books/${bookId}/ai/conversations/${created.id}`, { headers })
    .then((response) => response.json());
  const source = conversation.messages.find((message) => message.role === 'assistant').sources[0];
  assert.equal(source.chapterIndex, 9);
  assert.equal(source.stale, false);
});
