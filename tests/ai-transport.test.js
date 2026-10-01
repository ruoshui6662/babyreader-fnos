'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeResponse,
  normalizeUsage,
  resolveApiFormat,
  toChatPayload
} = require('../app/server/ai-transport');
const {
  buildResponsesPayload,
  requestOpenAiAnswer,
  requestOpenAiStream,
  testOpenAiConnection
} = require('../app/server/ai-service');

const lookupImpl = async () => ({ address: '93.184.216.34' });
const chatConfig = {
  baseUrl: 'https://llm.example/v1',
  model: 'chat-model',
  apiKey: 'secret-key',
  apiFormat: 'chat'
};
const request = {
  question: '这本书讲了什么？',
  selectedText: '',
  chapter: null,
  context: [{ text: '第一章讲蛋白质。', chapterIndex: 0, chapterHref: 'c1.xhtml', chapterLabel: '第一章' }],
  history: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好，请提问。' }]
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
}

function sseResponse(frames) {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => encoder.encode(frame));
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader() {
        return {
          read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }),
          cancel: async () => {}
        };
      }
    }
  };
}

test('Responses payloads convert to Chat Completions messages', () => {
  const payload = buildResponsesPayload({ model: 'chat-model', ...request, maxOutputTokens: 300 });
  const body = toChatPayload({ ...payload, stream: true, text: { format: { type: 'json_object' } } });
  assert.equal(body.model, 'chat-model');
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /阅读助手/);
  assert.deepEqual(body.messages.slice(1, 3), [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，请提问。' }
  ]);
  assert.match(body.messages.at(-1).content, /第一章讲蛋白质/);
  assert.equal(body.max_tokens, 300);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.stream, true);
  assert.equal('store' in body, false);
  assert.equal('input' in body, false);
});

test('replies and token usage decode from both protocols', () => {
  assert.deepEqual(decodeResponse('chat', {
    id: 'c1',
    choices: [{ message: { content: '回答' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 }
  }), { text: '回答', id: 'c1', status: 'completed', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 80 } });
  assert.equal(decodeResponse('responses', { output_text: '答' }).text, '答');
  assert.deepEqual(normalizeUsage({ input_tokens: 5, output_tokens: 2, input_tokens_details: { cached_tokens: 3 } }),
    { inputTokens: 5, outputTokens: 2, cachedTokens: 3 });
  assert.equal(normalizeUsage({}), null);
});

test('protocol defaults: saved or env-configured setups keep /responses, new ones use chat', () => {
  assert.equal(resolveApiFormat({}, {}), 'chat');
  assert.equal(resolveApiFormat({ apiKey: 'k' }, {}), 'responses');
  assert.equal(resolveApiFormat({}, { OPENAI_API_KEY: 'k' }), 'responses');
  assert.equal(resolveApiFormat({ apiKey: 'k', apiFormat: 'chat' }, {}), 'chat');
  assert.equal(resolveApiFormat({}, { OPENAI_API_FORMAT: 'responses' }), 'responses');
});

test('a chat-format answer posts to /chat/completions and reports usage', async () => {
  let captured;
  let usage;
  const answer = await requestOpenAiAnswer({
    env: {},
    savedConfig: chatConfig,
    request,
    lookupImpl,
    onUsage: (value) => { usage = value; },
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse(200, { id: 'x', choices: [{ message: { content: '讲蛋白质【1】' } }], usage: { prompt_tokens: 50, completion_tokens: 9 } });
    }
  });
  assert.equal(answer, '讲蛋白质【1】');
  assert.equal(captured.url, 'https://llm.example/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret-key');
  assert.equal(captured.body.model, 'chat-model');
  assert.ok(Array.isArray(captured.body.messages));
  assert.deepEqual(usage, { inputTokens: 50, outputTokens: 9, cachedTokens: 0 });
});

test('the summary role uses the configured economy model', async () => {
  let model;
  await requestOpenAiAnswer({
    env: {},
    savedConfig: { ...chatConfig, summaryModel: 'cheap-model' },
    request,
    lookupImpl,
    modelRole: 'summary',
    fetchImpl: async (_url, options) => {
      model = JSON.parse(options.body).model;
      return jsonResponse(200, { choices: [{ message: { content: '好' } }] });
    }
  });
  assert.equal(model, 'cheap-model');
});

test('a model that rejects max_tokens is retried once with max_completion_tokens', async () => {
  const bodies = [];
  const answer = await requestOpenAiAnswer({
    env: {},
    savedConfig: chatConfig,
    request: { ...request, maxOutputTokens: 200 },
    lookupImpl,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if ('max_tokens' in body) {
        return jsonResponse(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.", param: 'max_tokens' } });
      }
      return jsonResponse(200, { choices: [{ message: { content: '可以' } }] });
    }
  });
  assert.equal(answer, '可以');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].max_completion_tokens, 200);
});

test('chat streams yield text deltas, ignore reasoning text and keep usage', async () => {
  const deltas = [];
  const result = await requestOpenAiStream({
    env: {},
    savedConfig: chatConfig,
    request,
    lookupImpl,
    onEvent: async (event) => { if (event.type === 'response.output_text.delta') deltas.push(event.delta); },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://llm.example/v1/chat/completions');
      assert.equal(JSON.parse(options.body).stream, true);
      return sseResponse([
        'data: {"id":"s1","choices":[{"delta":{"reasoning_content":"先想想"}}]}\n\n',
        'data: {"id":"s1","choices":[{"delta":{"content":"讲"}}]}\n\ndata: {"choices":[{"delta":{"content":"蛋白质【1】"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":40,"completion_tokens":6}}\n\n',
        'data: [DONE]\n\n'
      ]);
    }
  });
  assert.deepEqual(deltas, ['讲', '蛋白质【1】']);
  assert.equal(result.answer, '讲蛋白质【1】');
  assert.equal(result.streamed, true);
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 6, cachedTokens: 0 });
});

test('a chat stream without [DONE] still completes; an error frame fails', async () => {
  const ok = await requestOpenAiStream({
    env: {}, savedConfig: chatConfig, request, lookupImpl,
    fetchImpl: async () => sseResponse(['data: {"choices":[{"delta":{"content":"完整回答"}}]}\n\n'])
  });
  assert.equal(ok.answer, '完整回答');
  await assert.rejects(requestOpenAiStream({
    env: {}, savedConfig: chatConfig, request, lookupImpl,
    fetchImpl: async () => sseResponse(['data: {"error":{"message":"quota"}}\n\n'])
  }), /未能完成回答/);
});

test('chat streams that fall back to JSON are decoded', async () => {
  const result = await requestOpenAiStream({
    env: {}, savedConfig: chatConfig, request, lookupImpl,
    fetchImpl: async () => jsonResponse(200, { choices: [{ message: { content: '非流式回答' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } })
  });
  assert.equal(result.answer, '非流式回答');
  assert.equal(result.streamed, false);
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 1, cachedTokens: 0 });
});

test('connection test uses the chat endpoint for chat configurations', async () => {
  let url;
  const result = await testOpenAiConnection({
    savedConfig: chatConfig,
    lookupImpl,
    fetchImpl: async (target) => {
      url = target;
      return jsonResponse(200, { choices: [{ message: { content: 'OK' } }] });
    }
  });
  assert.equal(url, 'https://llm.example/v1/chat/completions');
  assert.deepEqual(result, { ok: true, model: 'chat-model', apiFormat: 'chat' });
});
