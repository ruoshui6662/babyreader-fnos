'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SANDBOX = path.join(os.tmpdir(), 'zhenshu-ai-book-map-' + process.pid);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const BOOK_ID = 'e'.repeat(64);
const BOOK_PATH = path.join(LIBRARY_ROOT, 'shanju.epub');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';
process.env.OPENAI_API_KEY = 'map-test-key';
process.env.OPENAI_BASE_URL = 'https://93.184.216.34/v1';
process.env.OPENAI_MODEL = 'answer-model';
process.env.OPENAI_API_FORMAT = 'chat';
process.env.OPENAI_SUMMARY_MODEL = 'summary-model';

const { buildEpub } = require('./fixtures/ai-book-qa/book');
const { readBookOutline } = require('../app/server/ai-fts');
const { createBookMapStore } = require('../app/server/ai-book-map-store');
const { LIMITS, ROOT_ID, createBookMapService, estimate, parseSummary, planBookMap } = require('../app/server/ai-book-map');
const { handleRequest, loadConfiguration } = require('../app/server/index');

const book = { id: BOOK_ID, path: BOOK_PATH, type: 'epub', title: '山居茶事', author: '测试作者' };
const savedConfig = { baseUrl: 'https://93.184.216.34/v1', model: 'answer-model', summaryModel: 'summary-model', apiKey: 'k', apiFormat: 'chat' };
let server;
let baseUrl;

// Fake service: 导读 calls get a JSON summary naming the part they read;
// everything else is a streamed answer.
async function withUpstream(callback, { failSummaries = false, delayMs = 0 } = {}) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://93.184.216.34/')) return originalFetch(url, options);
    const body = JSON.parse(options.body);
    calls.push(body);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const system = body.messages[0]?.content || '';
    if (body.response_format && /图书编辑/.test(system)) {
      if (failSummaries) return new Response('{}', { status: 500 });
      const where = /位置：(.+)/.exec(body.messages.at(-1).content)?.[1] || /「(.+?)」/.exec(system)?.[1] || (/全书/.test(system) ? '全书' : '本部分');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ summary: `导读摘要：${where}`, points: ['要点一'], terms: ['陈守义'], structure: '五章' }) } }],
        usage: { prompt_tokens: 2000, completion_tokens: 200 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body.response_format) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"type":"lookup","nodes":[],"queries":[]}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '全书讲茶与生活【1】。' } }] })}\n\ndata: [DONE]\n\n`));
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

const summaryCalls = (calls) => calls.filter((call) => /图书编辑/.test(call.messages[0]?.content || ''));

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.writeFile(BOOK_PATH, buildEpub());
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({ libraryRoots: [LIBRARY_ROOT] }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2, generatedAt: new Date().toISOString(),
    books: [{ id: BOOK_ID, path: BOOK_PATH, type: 'epub', title: '山居茶事', author: '测试作者' }],
    scan: { status: 'completed', errorCount: 0, rootErrors: [] }
  }));
  await loadConfiguration();
  server = http.createServer((request, response) => void handleRequest(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

test('the map follows the table of contents and splits only over-long chapters', async () => {
  const { nodes } = await readBookOutline(book, DATA_ROOT);
  const plan = planBookMap(nodes);
  const describe = plan.tasks.map((task) => `${task.kind}:${task.level}:${task.label}`);
  assert.deepEqual(describe, [
    'text:chapter:第一章 初到云岭',
    'text:chapter:第二章 采茶的时令',
    'text:section:一、拜师陈守义',
    'text:section:二、杀青与揉捻',
    'text:section:三、失败的一锅',
    'children:chapter:第三章 制茶的手艺',
    'text:chapter:第四章 茶与邻里',
    'text:chapter:第五章 离开与回望',
    'children:book:全书'
  ]);
  assert.equal(plan.sampled, false);
  const cost = estimate(plan);
  assert.equal(cost.calls, 9);
  assert.ok(cost.inputTokens > 40000 && cost.inputTokens < 50000, String(cost.inputTokens));
});

test('very long books read an evenly sampled, bounded share of every chapter', () => {
  const nodes = Array.from({ length: 400 }, (_, index) => ({ id: `c${index}`, label: `第${index + 1}章`, depth: 0, parentId: null, chars: 25000 }));
  const plan = planBookMap(nodes);
  assert.equal(plan.sampled, true);
  assert.equal(plan.unitCap, LIMITS.minUnitChars);
  // 400 sampled chapters plus the book-level summary of their summaries.
  assert.ok(estimate(plan).inputTokens < 1400000, String(estimate(plan).inputTokens));
});

test('summaries tolerate a model that ignores JSON mode', () => {
  assert.deepEqual(parseSummary('{"summary":"讲茶","points":["a"],"terms":["b"]}'), { summary: '讲茶', points: ['a'], terms: ['b'] });
  assert.equal(parseSummary('这一章讲茶。').summary, '这一章讲茶。');
  assert.equal(parseSummary(''), null);
});

test('generation stores every unit once, shared, and reuses it', async () => {
  const store = createBookMapStore({ dataRoot: DATA_ROOT });
  const service = createBookMapService({ dataRoot: DATA_ROOT, store });
  const progress = [];
  const { calls } = await withUpstream(() => service.run(book, { savedConfig, onProgress: (item) => progress.push(item) }));
  assert.equal(summaryCalls(calls).length, 9);
  assert.ok(calls.every((call) => call.model === 'summary-model'));
  assert.deepEqual(progress.at(-1), { done: 9, total: 9 });
  const status = await service.status(book);
  assert.equal(status.state, 'ready');
  assert.match(status.book.summary, /导读摘要：全书/);
  assert.equal(status.estimate.calls, 0);
  const chapter = status.nodes.find((node) => node.label === '第三章 制茶的手艺');
  assert.match(chapter.summary, /第三章/);
  // A fresh service (another request, another user) reuses the stored map.
  const again = createBookMapService({ dataRoot: DATA_ROOT, store: createBookMapStore({ dataRoot: DATA_ROOT }) });
  const second = await withUpstream(() => again.ensure(book, 'book', { savedConfig }));
  assert.equal(second.result.ok, true);
  assert.equal(summaryCalls(second.calls).length, 0);
  await fs.access(path.join(DATA_ROOT, 'ai-map', `${BOOK_ID}.json`));
});

test('lazy generation refuses books over the token limit', async () => {
  const service = createBookMapService({ dataRoot: DATA_ROOT, store: createBookMapStore({ dataRoot: path.join(SANDBOX, 'other') }) });
  const { result, calls } = await withUpstream(() => service.ensure(book, 'book', { savedConfig, maxInputTokens: 1000 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-large');
  assert.ok(result.estimate.inputTokens > 1000);
  assert.equal(calls.length, 0);
});

test('a running job can be cancelled', async () => {
  const service = createBookMapService({ dataRoot: DATA_ROOT, store: createBookMapStore({ dataRoot: path.join(SANDBOX, 'cancel') }) });
  await withUpstream(async () => {
    const running = service.run(book, { savedConfig });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(service.isRunning(BOOK_ID), true);
    service.cancel(BOOK_ID);
    await assert.rejects(running);
    assert.equal(service.isRunning(BOOK_ID), false);
    assert.equal((await service.status(book)).error, '已取消');
  }, { delayMs: 60 });
});

async function ask(question, uid = 'reader-a') {
  const response = await fetch(`${baseUrl}/app/zhenshu/api/books/${BOOK_ID}/ai/ask/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trim-userid': uid, 'x-trim-username': uid },
    body: JSON.stringify({ mode: 'planned', question, selectedText: '', history: [] })
  });
  return (await response.text()).split('\n\n').filter(Boolean).map((frame) => ({
    event: frame.match(/^event:\s*(.+)$/m)?.[1],
    data: JSON.parse(frame.match(/^data:\s*(.+)$/m)?.[1] || '{}')
  }));
}

test('the map API reports status and starts generation; overview questions then use the map', async () => {
  const headers = { 'x-trim-userid': 'reader-a', 'x-trim-username': 'reader-a', 'content-type': 'application/json' };
  const status = await fetch(`${baseUrl}/app/zhenshu/api/books/${BOOK_ID}/ai/map`, { headers }).then((response) => response.json());
  assert.ok(['ready', 'none', 'partial'].includes(status.state));
  assert.ok(Array.isArray(status.nodes));

  const { result: events, calls } = await withUpstream(() => ask('这本书主要讲了什么？'));
  const meta = events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.mode, 'map');
  assert.match(meta.plan.scopeLabel, /本书导读/);
  const answerCall = calls.find((call) => !call.response_format);
  assert.match(answerCall.messages.at(-1).content, /导读 · 全书/);
  assert.match(answerCall.messages[0].content, /全书导读：导读摘要/);
  assert.equal(summaryCalls(calls).length, 0, 'the map generated earlier is reused');

  // Start a forced regeneration and cancel it while the fake service is still in place.
  const { result: control } = await withUpstream(async () => {
    const started = await fetch(`${baseUrl}/app/zhenshu/api/books/${BOOK_ID}/ai/map`, {
      method: 'POST', headers, body: JSON.stringify({ force: true })
    });
    const cancelled = await fetch(`${baseUrl}/app/zhenshu/api/books/${BOOK_ID}/ai/map/job`, { method: 'DELETE', headers });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { started: started.status, startedBody: await started.json(), cancelled: cancelled.status };
  }, { delayMs: 50 });
  assert.equal(control.started, 202);
  assert.equal(control.startedBody.state, 'running');
  assert.equal(control.cancelled, 200);
});
