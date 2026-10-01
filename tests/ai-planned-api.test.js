'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SANDBOX = path.join(os.tmpdir(), 'zhenshu-ai-planned-api-' + process.pid);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const EPUB_ID = 'c'.repeat(64);
const TXT_ID = 'd'.repeat(64);
const EPUB_PATH = path.join(LIBRARY_ROOT, 'shanju.epub');
const TXT_PATH = path.join(LIBRARY_ROOT, 'shanju.txt');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';
process.env.OPENAI_API_KEY = 'planned-test-key';
process.env.OPENAI_BASE_URL = 'https://93.184.216.34/v1';
process.env.OPENAI_MODEL = 'answer-model';
process.env.OPENAI_API_FORMAT = 'chat';
process.env.OPENAI_SUMMARY_MODEL = 'navigator-model';

const { buildEpub, buildText } = require('./fixtures/ai-book-qa/book');
const { handleRequest, loadConfiguration } = require('../app/server/index');

let server;
let baseUrl;

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((frame) => ({
    event: frame.match(/^event:\s*(.+)$/m)?.[1] || 'message',
    data: JSON.parse(frame.match(/^data:\s*(.+)$/m)?.[1] || '{}')
  }));
}

function chatStream(content, usage = { prompt_tokens: 1000, completion_tokens: 50 }) {
  const encoder = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({ id: 'r1', choices: [{ delta: { content } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
    'data: [DONE]\n\n'
  ];
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// A fake OpenAI-compatible service: JSON-mode calls are navigator calls,
// everything else is the streamed answer.
async function withUpstream({ navigator = null } = {}, callback) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://93.184.216.34/')) return originalFetch(url, options);
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (body.response_format?.type === 'json_object') {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(navigator || { type: 'lookup', nodes: [], queries: [] }) } }],
        usage: { prompt_tokens: 300, completion_tokens: 20 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return chatStream('根据书中内容回答【1】。');
  };
  try {
    return { result: await callback(), calls };
  } finally {
    global.fetch = originalFetch;
  }
}

async function ask(bookId, body, uid = 'reader-a') {
  const response = await fetch(`${baseUrl}/app/zhenshu/api/books/${bookId}/ai/ask/stream`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'content-type': 'application/json', 'x-trim-userid': uid, 'x-trim-username': uid },
    body: JSON.stringify({ mode: 'planned', selectedText: '', history: [], ...body })
  });
  return { status: response.status, events: parseSse(await response.text()) };
}

const answerCall = (calls) => calls.find((call) => !call.body.response_format);
const userText = (call) => call.body.messages.at(-1).content;

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.writeFile(EPUB_PATH, buildEpub());
  await fs.writeFile(TXT_PATH, buildText(), 'utf8');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({ libraryRoots: [LIBRARY_ROOT] }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    books: [
      { id: EPUB_ID, path: EPUB_PATH, type: 'epub', title: '山居茶事', author: '测试作者' },
      { id: TXT_ID, path: TXT_PATH, type: 'txt', title: '山居茶事' }
    ],
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

test('a chapter question reads the whole chapter, past the old 22,000-character cap', async () => {
  const { result, calls } = await withUpstream({}, () => ask(EPUB_ID, { question: '第三章讲了什么？' }));
  assert.equal(result.status, 200);
  const names = result.events.map((event) => event.event);
  assert.ok(names.includes('progress'));
  assert.deepEqual(names.filter((name) => name !== 'progress'), ['meta', 'delta', 'done']);
  const meta = result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'chapter_summary');
  assert.match(meta.plan.scopeLabel, /第三章 制茶的手艺（全文）/);
  assert.equal(calls.length, 1, 'explicit references need no navigator call');
  const call = answerCall(calls);
  assert.equal(call.url, 'https://93.184.216.34/v1/chat/completions');
  assert.equal(call.body.model, 'answer-model');
  assert.match(call.body.messages[0].content, /《山居茶事》/);
  for (const fact of ['松枝的余火', '轻—重—轻', '火候是熬出来的']) assert.match(userText(call), new RegExp(fact));
  const done = result.events.find((event) => event.event === 'done').data;
  assert.equal(done.answer, '根据书中内容回答【1】。');
  assert.deepEqual(done.usage, { inputTokens: 1000, outputTokens: 50, cachedTokens: 0 });
});

test('a whole-book question on a plain-text book draws on every chapter', async () => {
  const { result, calls } = await withUpstream({}, () => ask(TXT_ID, { question: '这本书主要讲了什么？' }));
  const meta = result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'overview');
  const text = userText(answerCall(calls));
  for (const chapter of ['第一章 初到云岭', '第二章 采茶的时令', '第三章 制茶的手艺', '第四章 茶与邻里', '第五章 离开与回望']) {
    assert.ok(text.includes(chapter), chapter);
  }
});

test('an ambiguous question asks the summary model to navigate the table of contents', async () => {
  const { result, calls } = await withUpstream({ navigator: { type: 'chapter_summary', nodes: ['n4'], queries: ['明前'] } },
    () => ask(EPUB_ID, { question: '核心观点是什么' }));
  const navigatorCall = calls.find((call) => call.body.response_format);
  assert.ok(navigatorCall, 'navigator call');
  assert.equal(navigatorCall.body.model, 'navigator-model');
  assert.match(navigatorCall.body.messages.at(-1).content, /n4\. 第二章 采茶的时令/);
  const meta = result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'chapter_summary');
  assert.equal(meta.plan.navigated, true);
  assert.match(userText(answerCall(calls)), /明前尖/);
  const done = result.events.find((event) => event.event === 'done').data;
  assert.deepEqual(done.usage, { inputTokens: 1300, outputTokens: 70, cachedTokens: 0 });
});

test('the reading position places “本章” for a plain-text book from the visible paragraph', async () => {
  const { result, calls } = await withUpstream({}, () => ask(TXT_ID, {
    question: '本章的核心观点是什么？',
    chapter: { index: 0, href: '', label: '', position: { text: '村里有以茶换物的旧俗：一斤春茶可以换十斤新米。' } }
  }));
  const meta = result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'chapter_summary');
  assert.match(meta.plan.scopeLabel, /第四章 茶与邻里/);
  assert.match(userText(answerCall(calls)), /祠堂前举办茶会/);
});

test('explaining a selection sends the passage around it', async () => {
  const { result, calls } = await withUpstream({}, () => ask(EPUB_ID, {
    question: '这句话什么意思？',
    selectedText: '火候是熬出来的'
  }));
  const meta = result.events.find((event) => event.event === 'meta').data;
  assert.equal(meta.plan.type, 'explain_selection');
  const text = userText(answerCall(calls));
  assert.match(text, /读者选中的文字：火候是熬出来的/);
  assert.match(text, /炒焦了整整一锅/);
});

test('a planned answer is saved to the conversation with only cited sources', async () => {
  const headers = { 'content-type': 'application/json', 'x-trim-userid': 'reader-b', 'x-trim-username': 'reader-b' };
  const created = await fetch(`${baseUrl}/app/zhenshu/api/books/${EPUB_ID}/ai/conversations`, {
    method: 'POST', headers, body: JSON.stringify({ title: '问书' })
  }).then((response) => response.json());
  const { result } = await withUpstream({}, () => ask(EPUB_ID, { question: '这本书主要讲了什么？', conversationId: created.id }, 'reader-b'));
  const done = result.events.find((event) => event.event === 'done').data;
  assert.equal(done.persisted, true);
  const conversation = await fetch(`${baseUrl}/app/zhenshu/api/books/${EPUB_ID}/ai/conversations/${created.id}`, { headers })
    .then((response) => response.json());
  const assistant = conversation.messages.find((message) => message.role === 'assistant');
  assert.equal(assistant.content, '根据书中内容回答【1】。');
  assert.deepEqual(assistant.sources.map((source) => source.citationIndex), [1]);
});

test('planned requests validate their input', async () => {
  const empty = await ask(EPUB_ID, { question: '' });
  assert.equal(empty.status, 400);
  const tooLong = await ask(EPUB_ID, { question: '问'.repeat(4001) });
  assert.equal(tooLong.status, 400);
});
