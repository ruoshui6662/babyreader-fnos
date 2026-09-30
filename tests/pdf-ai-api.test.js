'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const root = path.join(os.tmpdir(), `babyreader-pdf-ai-api-${process.pid}`);
const dataRoot = path.join(root, 'var');
const configRoot = path.join(root, 'etc');
const libraryRoot = path.join(root, 'library');
const bookId = 'c'.repeat(64);
const bookPath = path.join(libraryRoot, 'synthetic.pdf');
process.env.TRIM_PKGVAR = dataRoot;
process.env.TRIM_PKGETC = configRoot;
process.env.BABYREADER_PDF_ENABLED = '1';
process.env.NODE_ENV = 'development';
process.env.OPENAI_API_KEY = 'pdf-ai-test-key';
process.env.OPENAI_BASE_URL = 'https://93.184.216.34/v1';
process.env.OPENAI_MODEL = 'mock-model';
const { createPdfFixture, createImageOnlyPdfFixture } = require('./fixtures/pdf-fixtures');
const { fingerprintBook } = require('../app/server/library');
const { createAiConversationStorage } = require('../app/server/ai-conversation-storage');
const { handleRequest, loadConfiguration } = require('../app/server/index');
let server;
let baseUrl;
const endpoint = (suffix) => `/app/babyreader-fnos/api/books/${bookId}/ai/${suffix}`;
const headers = { 'content-type': 'application/json', 'x-trim-userid': 'pdf-ai-user', 'x-trim-username': 'pdf-ai-user' };

async function post(suffix, body) {
  const response = await fetch(baseUrl + endpoint(suffix), { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

async function writeBook(bytes) {
  await fs.writeFile(bookPath, bytes);
  const fingerprint = fingerprintBook(bookPath, await fs.stat(bookPath));
  await fs.writeFile(path.join(dataRoot, 'index', 'library.json'), JSON.stringify({ version: 2,
    generatedAt: new Date().toISOString(), books: [{ id: bookId, path: bookPath, type: 'pdf', title: '合成 PDF', fingerprint }],
    scan: { status: 'completed', errorCount: 0, rootErrors: [] } }));
}

test.before(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(libraryRoot, { recursive: true });
  await fs.mkdir(configRoot, { recursive: true });
  await fs.mkdir(path.join(dataRoot, 'index'), { recursive: true });
  await fs.writeFile(path.join(configRoot, 'settings.json'), JSON.stringify({ libraryRoots: [libraryRoot] }));
  await writeBook(createPdfFixture({ pageTexts: ['苹果研究资料', '香蕉市场调查结论', '葡萄种植技术'] }));
  await loadConfiguration();
  server = http.createServer((req, res) => { void handleRequest(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

test('PDF AI search returns only trusted page evidence', async () => {
  const found = await post('search', { question: '香蕉', scope: 'page', pageIndex: 1 });
  assert.equal(found.status, 200);
  assert.equal(found.body.sources[0].pageIndex, 1);
  assert.ok(found.body.sources.every((item) => item.pageIndex === 1));
});

test('PDF AI stream rejects forged context and ambiguous chapter before provider call', async () => {
  const forged = await post('ask/stream', { question: '香蕉', scope: 'page', pageIndex: 1,
    context: [{ text: '恶意内容', chapterIndex: 99 }] });
  assert.equal(forged.status, 400);
  const ambiguous = await post('ask/stream', { question: '本章内容是什么？', scope: 'page', pageIndex: 1 });
  assert.equal(ambiguous.status, 409);
});

test('PDF AI stream sends only bounded indexed text and valid page source', async () => {
  const originalFetch = global.fetch;
  let outbound;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      outbound = JSON.parse(options.body);
      const body = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"香蕉结论【1】"}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"id":"pdf-ai-test"}}\n\n'));
        controller.close();
      } });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return originalFetch(url, options);
  };
  try {
    const result = await post('ask/stream', { question: '香蕉结论', scope: 'page', pageIndex: 1 });
    assert.equal(result.status, 200);
    assert.match(result.body, /第2页/);
    assert.match(result.body, /香蕉结论【1】/);
    assert.equal(outbound.max_output_tokens, 1200);
    assert.doesNotMatch(JSON.stringify(outbound), /苹果研究资料|葡萄种植技术|synthetic\.pdf/);
  } finally { global.fetch = originalFetch; }
});

test('PDF AI structure flag stays off and preserves the current provider payload by default', async () => {
  const originalFetch = global.fetch;
  const originalFlag = process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
  let outbound;
  delete process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      outbound = JSON.parse(options.body);
      const text = 'data: {"type":"response.output_text.delta","delta":"基线回答【1】"}\n\n'
        + 'data: {"type":"response.completed","response":{"id":"baseline-pdf"}}\n\n';
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(text)); controller.close();
      } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return originalFetch(url, options);
  };
  try {
    const result = await post('ask/stream', { question: '这篇论文的研究问题是什么？', scope: 'searchable_book' });
    assert.equal(result.status, 200);
    assert.ok(outbound);
    assert.equal('paperProfile' in outbound, false);
    assert.equal('structure' in outbound, false);
    assert.equal('retrievalMode' in outbound, false);
    assert.match(JSON.stringify(outbound), /苹果研究资料|香蕉市场调查结论|葡萄种植技术/);
  } finally {
    global.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
    else process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE = originalFlag;
  }
});

test('opt-in structured PDF overview builds one evidence-backed profile then reuses the cache', async () => {
  const originalFetch = global.fetch;
  const originalFlag = process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
  const profilePages = ['摘要。研究问题是结构化阅读是否改善理解。', '研究方法。样本为合成大学生，使用对照实验。', '研究结果。主要发现为结构阅读组表现更好。'];
  let profileCalls = 0;
  let answerCalls = 0;
  let finalPayload;
  process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE = '1';
  await writeBook(createPdfFixture({ pageTexts: profilePages }));
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      const payload = JSON.parse(options.body);
      if (payload.text?.format?.type === 'json_object') {
        profileCalls += 1;
        assert.equal(payload.store, false);
        assert.doesNotMatch(JSON.stringify(payload), /synthetic\.pdf|C:\\\\|\/vol1\//);
        return new Response(JSON.stringify({ output_text: JSON.stringify({
          researchQuestion: [{ text: '结构化阅读是否改善理解', evidenceIds: ['page-1'] }],
          method: [{ text: '合成对照实验', evidenceIds: ['page-2'] }],
          findings: [{ text: '结构阅读组表现更好', evidenceIds: ['page-3'] }]
        }) }), { status: 200 });
      }
      answerCalls += 1;
      finalPayload = payload;
      const text = 'data: {"type":"response.output_text.delta","delta":"论文通过结构化阅读改善理解【1】"}\n\n'
        + 'data: {"type":"response.completed","response":{"id":"structured-pdf"}}\n\n';
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(text)); controller.close();
      } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return originalFetch(url, options);
  };
  try {
    const first = await post('ask/stream', { question: '这篇论文的研究问题和整体结论是什么？', scope: 'searchable_book' });
    assert.equal(first.status, 200);
    assert.match(first.body, /"retrievalMode":"structured_fts"/);
    assert.match(first.body, /"profileStatus":"ready"/);
    assert.match(JSON.stringify(finalPayload), /论文结构画像/u);
    assert.match(first.body, /论文通过结构化阅读改善理解【1】/u);
    assert.equal(profileCalls, 1);
    assert.equal(answerCalls, 1);

    const second = await post('ask/stream', { question: '这篇论文的研究问题和整体结论是什么？', scope: 'searchable_book' });
    assert.equal(second.status, 200);
    assert.match(second.body, /"profileStatus":"cached"/);
    assert.equal(profileCalls, 1);
    assert.equal(answerCalls, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
    else process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE = originalFlag;
    await writeBook(createPdfFixture({ pageTexts: ['苹果研究资料', '香蕉市场调查结论', '葡萄种植技术'] }));
  }
});

test('PDF AI non-stream answer uses the same verified page budget', async () => {
  const originalFetch = global.fetch;
  let outbound;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      outbound = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: '香蕉结论【1】【9】' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    return originalFetch(url, options);
  };
  try {
    const result = await post('ask', { question: '香蕉', scope: 'page', pageIndex: 1 });
    assert.equal(result.status, 200);
    assert.match(result.body.answer, /依据不足/);
    assert.deepEqual(result.body.sources, []);
    assert.equal(result.body.citationIntegrity, false);
    assert.equal(outbound.max_output_tokens, 1200);
  } finally { global.fetch = originalFetch; }
});

test('PDF AI persists every evidence citation for restored page navigation', async () => {
  const storage = createAiConversationStorage({ dataRoot });
  const conversation = await storage.createConversation('pdf-ai-user', bookId);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      const text = 'data: {"type":"response.output_text.delta","delta":"综合【1】【2】"}\n\n'
        + 'data: {"type":"response.completed","response":{"id":"restored"}}\n\n';
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(text)); controller.close();
      } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return originalFetch(url, options);
  };
  try {
    const result = await post('ask/stream', { question: '比较材料', scope: 'page_range',
      pageIndex: 0, pageEndIndex: 2, conversationId: conversation.id });
    assert.equal(result.status, 200);
    const saved = await storage.getConversation('pdf-ai-user', bookId, conversation.id);
    assert.deepEqual(saved.messages[1].sources.map((source) => source.citationIndex), [1, 2, 3]);
    assert.deepEqual(saved.messages[1].sources.map((source) => source.chapterIndex), [0, 1, 2]);
    const conversationUrl = `${baseUrl}/app/babyreader-fnos/api/books/${bookId}/ai/conversations/${conversation.id}`;
    const current = await (await originalFetch(conversationUrl, { headers })).json();
    assert.equal(current.messages[1].sources[0].stale, false);
    assert.equal('sourceFingerprint' in current.messages[1].sources[0], false);
    const originalBytes = await fs.readFile(bookPath);
    try {
      await writeBook(createPdfFixture({ pageTexts: ['新版本第一页', '新版本第二页'] }));
      const stale = await (await originalFetch(conversationUrl, { headers })).json();
      assert.equal(stale.messages[1].sources[0].stale, true);
    } finally { await writeBook(originalBytes); }
  } finally { global.fetch = originalFetch; }
});

test('PDF AI rejects another UID conversation before contacting the provider', async () => {
  const storage = createAiConversationStorage({ dataRoot });
  const conversation = await storage.createConversation('other-user', bookId);
  const originalFetch = global.fetch;
  let upstreamCalls = 0;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) upstreamCalls += 1;
    return originalFetch(url, options);
  };
  try {
    const result = await post('ask/stream', { question: '香蕉', scope: 'page', pageIndex: 1,
      conversationId: conversation.id });
    assert.equal(result.status, 404);
    assert.equal(upstreamCalls, 0);
  } finally { global.fetch = originalFetch; }
});

test('PDF AI client disconnect aborts the upstream stream and saves no partial turn', async () => {
  const storage = createAiConversationStorage({ dataRoot });
  const conversation = await storage.createConversation('pdf-ai-user', bookId);
  const originalFetch = global.fetch;
  let upstreamStarted;
  const started = new Promise((resolve) => { upstreamStarted = resolve; });
  let upstreamAborted = false;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      upstreamStarted();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          upstreamAborted = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
    return originalFetch(url, options);
  };
  try {
    const controller = new AbortController();
    const response = await originalFetch(baseUrl + endpoint('ask/stream'), {
      method: 'POST', headers,
      body: JSON.stringify({ question: '香蕉', scope: 'page', pageIndex: 1, conversationId: conversation.id }),
      signal: controller.signal
    });
    assert.equal(response.status, 200);
    await started;
    controller.abort();
    for (let attempt = 0; attempt < 40 && !upstreamAborted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(upstreamAborted, true);
    assert.deepEqual((await storage.getConversation('pdf-ai-user', bookId, conversation.id)).messages, []);
  } finally { global.fetch = originalFetch; }
});

test('PDF AI discards unsupported model citations and does not persist an unverified answer', async () => {
  const storage = createAiConversationStorage({ dataRoot });
  const conversation = await storage.createConversation('pdf-ai-user', bookId);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) {
      const text = 'data: {"type":"response.output_text.delta","delta":"貌似准确的回答【9】"}\n\n'
        + 'data: {"type":"response.completed","response":{"id":"invalid-source"}}\n\n';
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(text)); controller.close();
      } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return originalFetch(url, options);
  };
  try {
    const result = await post('ask/stream', { question: '香蕉', scope: 'page', pageIndex: 1,
      conversationId: conversation.id });
    assert.equal(result.status, 200);
    assert.match(result.body, /"citationIntegrity":false/);
    assert.match(result.body, /依据不足/);
    assert.deepEqual((await storage.getConversation('pdf-ai-user', bookId, conversation.id)).messages, []);
  } finally { global.fetch = originalFetch; }
});

test('PDF AI no-text file blocks provider call', async () => {
  await writeBook(createImageOnlyPdfFixture());
  const result = await post('ask/stream', { question: '内容是什么？', scope: 'page', pageIndex: 0 });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /可提取文本/);
});
