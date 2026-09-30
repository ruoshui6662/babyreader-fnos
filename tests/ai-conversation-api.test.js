'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SANDBOX = path.join(os.tmpdir(), 'babyreader-ai-conversation-api-' + process.pid);
const DATA_ROOT = path.join(SANDBOX, 'var');
const CONFIG_ROOT = path.join(SANDBOX, 'etc');
const LIBRARY_ROOT = path.join(SANDBOX, 'library');
const BOOK_ID = 'a'.repeat(64);
const OTHER_BOOK_ID = 'b'.repeat(64);
const BOOK_PATH = path.join(LIBRARY_ROOT, 'conversation-api-book.txt');
const OTHER_BOOK_PATH = path.join(LIBRARY_ROOT, 'conversation-api-other-book.txt');

process.env.TRIM_PKGVAR = DATA_ROOT;
process.env.TRIM_PKGETC = CONFIG_ROOT;
process.env.TRIM_DATA_ACCESSIBLE_PATHS = '';
process.env.TRIM_DATA_SHARE_PATHS = '';
process.env.NODE_ENV = 'development';
process.env.OPENAI_API_KEY = 'server-test-key';
process.env.OPENAI_BASE_URL = 'https://93.184.216.34/v1';
process.env.OPENAI_MODEL = 'stream-test-model';

const { createAiConversationStorage } = require('../app/server/ai-conversation-storage');
const { handleRequest, loadConfiguration } = require('../app/server/index');

let server;
let baseUrl;

function request(pathname, options = {}) {
  return fetch(baseUrl + pathname, options).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

function jsonRequest(pathname, body, options = {}) {
  return request(pathname, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: JSON.stringify(body)
  });
}

async function streamRequest(pathname, body, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    ...options,
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, text: await response.text() };
}

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((frame) => {
    const event = frame.match(/^event:\s*(.+)$/m)?.[1] || 'message';
    const data = frame.match(/^data:\s*(.+)$/m)?.[1] || '{}';
    return { event, data: JSON.parse(data) };
  });
}

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

async function withUpstreamFetch(handler, callback) {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://93.184.216.34/')) return handler(url, options);
    return originalFetch(url, options);
  };
  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

function streamBody(conversationId, overrides = {}) {
  return {
    question: '这本书说明了什么？',
    selectedText: '',
    chapter: { index: 0, href: '', label: '前言' },
    context: [{
      text: '会话 API 测试内容',
      chapterIndex: 0,
      chapterHref: '',
      chapterLabel: '前言'
    }],
    ...(conversationId ? { conversationId } : {}),
    ...overrides
  };
}

function userHeaders(uid) {
  return { 'x-trim-userid': uid, 'x-trim-username': uid };
}

const conversationPath = (bookId) => `/app/babyreader-fnos/api/books/${bookId}/ai/conversations`;

test.before(async () => {
  await fs.rm(SANDBOX, { recursive: true, force: true });
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, 'index'), { recursive: true });
  await fs.writeFile(BOOK_PATH, '会话 API 测试内容', 'utf8');
  await fs.writeFile(OTHER_BOOK_PATH, '另一本书测试内容', 'utf8');
  await fs.writeFile(path.join(CONFIG_ROOT, 'settings.json'), JSON.stringify({
    libraryRoots: [LIBRARY_ROOT]
  }));
  await fs.writeFile(path.join(DATA_ROOT, 'index', 'library.json'), JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    books: [
      { id: BOOK_ID, path: BOOK_PATH, type: 'txt', title: '会话 API 测试书' },
      { id: OTHER_BOOK_ID, path: OTHER_BOOK_PATH, type: 'txt', title: '另一本测试书' }
    ],
    scan: { status: 'completed', errorCount: 0, rootErrors: [] }
  }));
  await loadConfiguration();
  server = http.createServer((requestObject, response) => {
    void handleRequest(requestObject, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(SANDBOX, { recursive: true, force: true });
});

test('conversation API rejects unauthenticated access and invalid identifiers without disclosure', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const anonymous = await request(conversationPath(BOOK_ID));
    assert.equal(anonymous.status, 401);
    assert.doesNotMatch(JSON.stringify(anonymous.body), /DATA_ROOT|API_KEY|SQLite|stack|conversation-api-book/);
  } finally {
    process.env.NODE_ENV = previous;
  }

  const invalidBook = await request(conversationPath('not-a-book'), { headers: userHeaders('user-a') });
  assert.equal(invalidBook.status, 400);

  const invalidConversation = await request(`${conversationPath(BOOK_ID)}/not-a-conversation`, {
    headers: userHeaders('user-a')
  });
  assert.equal(invalidConversation.status, 400);
  assert.doesNotMatch(JSON.stringify(invalidConversation.body), /DATA_ROOT|API_KEY|SQLite|stack|conversation-api-book/);
});

test('conversation API creates, lists, reads, clears, and deletes only the current user and book data', async () => {
  const headers = userHeaders('user-a');
  const created = await jsonRequest(conversationPath(BOOK_ID), { title: '营养问题' }, { headers });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, '营养问题');
  assert.equal('path' in created.body, false);
  assert.equal('messages' in created.body, true);
  const conversationId = created.body.id;

  const storage = createAiConversationStorage({ dataRoot: DATA_ROOT });
  await storage.appendCompletedTurn('user-a', BOOK_ID, conversationId, {
    question: '这本书讲了什么？',
    answer: '回答不会被列表接口直接返回。',
    sources: [{
      citationIndex: 1,
      chapterIndex: 0,
      chapterHref: 'chapter.xhtml',
      chapterLabel: '前言',
      startOffset: 88
    }]
  });

  const listed = await request(conversationPath(BOOK_ID), { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.conversations.length, 1);
  assert.equal(listed.body.conversations[0].messageCount, 2);
  assert.equal('messages' in listed.body.conversations[0], false);
  assert.equal(listed.body.activeConversationId, conversationId);
  assert.doesNotMatch(JSON.stringify(listed.body), /回答不会被列表接口直接返回|chapter\.xhtml/);

  const read = await request(`${conversationPath(BOOK_ID)}/${conversationId}`, { headers });
  assert.equal(read.status, 200);
  assert.equal(read.body.messages.length, 2);
  assert.equal(read.body.messages[1].sources[0].chapterLabel, '前言');
  assert.equal(read.body.messages[1].sources[0].startOffset, 88);
  assert.doesNotMatch(JSON.stringify(read.body), new RegExp(DATA_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(read.body), /API_KEY|SQLite|检索片段|conversation-api-book/);

  const otherUserList = await request(conversationPath(BOOK_ID), { headers: userHeaders('user-b') });
  assert.equal(otherUserList.status, 200);
  assert.deepEqual(otherUserList.body.conversations, []);
  const otherUserRead = await request(`${conversationPath(BOOK_ID)}/${conversationId}`, {
    headers: userHeaders('user-b')
  });
  assert.equal(otherUserRead.status, 404);

  const otherBookList = await request(conversationPath(OTHER_BOOK_ID), { headers });
  assert.equal(otherBookList.status, 200);
  assert.deepEqual(otherBookList.body.conversations, []);

  const cleared = await request(`${conversationPath(BOOK_ID)}/${conversationId}/messages`, {
    method: 'DELETE',
    headers
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.messages, []);

  const deleted = await request(`${conversationPath(BOOK_ID)}/${conversationId}`, {
    method: 'DELETE',
    headers
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);

  const afterDelete = await request(conversationPath(BOOK_ID), { headers });
  assert.deepEqual(afterDelete.body.conversations, []);
  assert.equal(afterDelete.body.activeConversationId, null);
});

test('conversation API maps storage failures to sanitized status messages', async () => {
  const headers = userHeaders('user-c');
  const created = await jsonRequest(conversationPath(BOOK_ID), {}, { headers });
  const conversationId = created.body.id;
  const filePath = path.join(DATA_ROOT, 'users', 'user-c', 'ai-conversations', `${BOOK_ID}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{broken json', 'utf8');

  const response = await request(`${conversationPath(BOOK_ID)}/${conversationId}`, { headers });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: '会话暂时无法读取' });
});

test('completed stream answers persist one user turn and one assistant turn before done', async () => {
  const headers = userHeaders('stream-user');
  const created = await jsonRequest(conversationPath(BOOK_ID), {}, { headers });
  const conversationId = created.body.id;
  const storage = createAiConversationStorage({ dataRoot: DATA_ROOT });
  const streamPath = `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`;
  const successful = await withUpstreamFetch(
    async () => streamResponse([
      'data: {"type":"response.output_text.delta","delta":"完整"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"回答【1】"}\n\n',
      'data: {"type":"response.completed","response":{"id":"response-complete"}}\n\n'
    ]),
    () => streamRequest(streamPath, streamBody(conversationId), { headers })
  );
  assert.equal(successful.status, 200);
  const events = parseSse(successful.text);
  assert.deepEqual(events.map((item) => item.event), ['meta', 'delta', 'delta', 'done']);
  assert.equal(events.at(-1).data.answer, '完整回答【1】');
  assert.equal(events.at(-1).data.persisted, true);
  assert.equal('persistenceErrorCode' in events.at(-1).data, false);

  const conversation = await storage.getConversation('stream-user', BOOK_ID, conversationId);
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[0].role, 'user');
  assert.equal(conversation.messages[1].role, 'assistant');
  assert.equal(conversation.messages[1].content, '完整回答【1】');
  assert.equal(conversation.messages[1].sources[0].chapterLabel, '本书');
});

test('legacy stream requests without conversationId keep the existing response contract', async () => {
  const headers = userHeaders('legacy-stream-user');
  const streamPath = `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`;
  const response = await withUpstreamFetch(
    async () => streamResponse([
      'data: {"type":"response.output_text.delta","delta":"旧请求回答"}\n\n',
      'data: {"type":"response.completed","response":{"id":"legacy-response"}}\n\n'
    ]),
    () => streamRequest(streamPath, streamBody(null), { headers })
  );
  assert.equal(response.status, 200);
  const done = parseSse(response.text).at(-1).data;
  assert.equal(done.answer, '旧请求回答');
  assert.equal('persisted' in done, false);
  const storage = createAiConversationStorage({ dataRoot: DATA_ROOT });
  assert.deepEqual(await storage.listConversations('legacy-stream-user', BOOK_ID), []);
});

test('EPUB stream baseline provider payload contains no PDF structure fields', async () => {
  const headers = userHeaders('epub-isolation-baseline');
  const streamPath = `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`;
  let outbound;
  const originalFlag = process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
  delete process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
  try {
    const response = await withUpstreamFetch(
      async (_url, options) => {
        outbound = JSON.parse(options.body);
        return streamResponse([
          'data: {"type":"response.output_text.delta","delta":"EPUB 基线回答【1】"}\\n\\n',
          'data: {"type":"response.completed","response":{"id":"epub-isolation"}}\\n\\n'
        ]);
      },
      () => streamRequest(streamPath, streamBody(null), { headers })
    );
    assert.equal(response.status, 200);
    assert.ok(outbound);
    assert.doesNotMatch(JSON.stringify(outbound), /paperProfile|retrievalMode|structureCoverage/);
  } finally {
    if (originalFlag === undefined) delete process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE;
    else process.env.BABYREADER_ENABLE_PDF_AI_STRUCTURE = originalFlag;
  }
});

test('chapter-summary strategy is opt-in and empty context is accepted only behind that flag', async () => {
  const headers = userHeaders('summary-flag-user');
  const streamPath = `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`;
  const original = process.env.BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING;
  try {
    delete process.env.BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING;
    const disabled = await streamRequest(streamPath, streamBody(null, {
      question: '总结这本书的主要观点', context: []
    }), { headers });
    assert.equal(disabled.status, 400);
    assert.match(JSON.parse(disabled.text).error, /书本上下文无效|缺少书本上下文/);

    process.env.BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING = '1';
    const enabled = await streamRequest(streamPath, streamBody(null, {
      question: '总结这本书的主要观点', context: []
    }), { headers });
    assert.equal(enabled.status, 409);
    assert.match(JSON.parse(enabled.text).error, /目录/);
  } finally {
    if (original === undefined) delete process.env.BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING;
    else process.env.BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING = original;
  }
});

test('stream abort, upstream error, and empty answer do not persist assistant messages', async () => {
  const cases = [
    {
      uid: 'stream-abort-user',
      handler: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
      expectedEvent: 'meta'
    },
    {
      uid: 'stream-error-user',
      handler: async () => new Response(JSON.stringify({ error: { code: 'provider_error' } }), {
        status: 502,
        headers: { 'content-type': 'application/json' }
      }),
      expectedEvent: 'error'
    },
    {
      uid: 'stream-empty-user',
      handler: async () => streamResponse([
        'data: {"type":"response.completed","response":{"id":"empty-response"}}\n\n'
      ]),
      expectedEvent: 'error'
    }
  ];
  const storage = createAiConversationStorage({ dataRoot: DATA_ROOT });
  for (const item of cases) {
    const headers = userHeaders(item.uid);
    const created = await jsonRequest(conversationPath(BOOK_ID), {}, { headers });
    const response = await withUpstreamFetch(
      item.handler,
      () => streamRequest(
        `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`,
        streamBody(created.body.id),
        { headers }
      )
    );
    assert.equal(response.status, 200);
    const events = parseSse(response.text);
    assert.equal(events.at(-1).event, item.expectedEvent);
    const conversation = await storage.getConversation(item.uid, BOOK_ID, created.body.id);
    assert.deepEqual(conversation.messages, []);
  }
});

test('invalid book context is rejected before upstream access and persistence', async () => {
  const headers = userHeaders('invalid-context-user');
  const created = await jsonRequest(conversationPath(BOOK_ID), {}, { headers });
  let upstreamCalled = false;
  const response = await withUpstreamFetch(
    async () => {
      upstreamCalled = true;
      return streamResponse([]);
    },
    () => streamRequest(
      `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`,
      streamBody(created.body.id, {
        context: [{
          text: '不属于这本书的伪造内容',
          chapterIndex: 0,
          chapterHref: '',
          chapterLabel: '伪造章节'
        }]
      }),
      { headers }
    )
  );
  assert.equal(response.status, 400);
  assert.equal(upstreamCalled, false);
  const storage = createAiConversationStorage({ dataRoot: DATA_ROOT });
  assert.deepEqual((await storage.getConversation('invalid-context-user', BOOK_ID, created.body.id)).messages, []);
});

test('persistence failure does not hide the completed answer and exposes only a safe error code', async () => {
  const headers = userHeaders('stream-persistence-failure-user');
  const created = await jsonRequest(conversationPath(BOOK_ID), {}, { headers });
  const filePath = path.join(DATA_ROOT, 'users', 'stream-persistence-failure-user', 'ai-conversations', `${BOOK_ID}.json`);
  await fs.writeFile(filePath, '{broken json', 'utf8');
  const response = await withUpstreamFetch(
    async () => streamResponse([
      'data: {"type":"response.output_text.delta","delta":"仍然返回"}\n\n',
      'data: {"type":"response.completed","response":{"id":"response-not-saved"}}\n\n'
    ]),
    () => streamRequest(
      `/app/babyreader-fnos/api/books/${BOOK_ID}/ai/ask/stream`,
      streamBody(created.body.id),
      { headers }
    )
  );
  assert.equal(response.status, 200);
  const done = parseSse(response.text).at(-1).data;
  assert.equal(done.answer, '仍然返回');
  assert.equal(done.persisted, false);
  assert.equal(done.persistenceErrorCode, 'CONVERSATION_STORE_CORRUPT');
  assert.doesNotMatch(JSON.stringify(done), /broken json|DATA_ROOT|API_KEY|stack|检索片段/);
});

test('browserHost exposes only scoped conversation API adapters', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../app/ui/core/api.js'), 'utf8');
  for (const method of [
    'getAiConversations',
    'getAiConversation',
    'createAiConversation',
    'deleteAiConversation',
    'clearAiConversation'
  ]) {
    assert.match(source, new RegExp(`async ${method}\\(`));
  }
  assert.doesNotMatch(source, /conversation.*(?:path|file|DATA_ROOT)/i);
});
