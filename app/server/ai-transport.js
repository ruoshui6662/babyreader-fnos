'use strict';

// One request shape, two OpenAI wire protocols.
//
// The AI code builds requests in the Responses API shape (`instructions`,
// `input`, `max_output_tokens`). Most OpenAI-compatible providers only serve
// `/chat/completions`, so this module converts the request, decodes replies
// and turns Chat Completions stream chunks into the Responses-style events the
// rest of the server already understands.

const API_FORMATS = Object.freeze(['chat', 'responses']);

function normalizeApiFormat(value, fallback = 'chat') {
  const format = String(value || '').trim().toLowerCase();
  return API_FORMATS.includes(format) ? format : fallback;
}

// Configurations saved before the protocol choice existed used `/responses`;
// a brand-new configuration defaults to the widely supported Chat Completions.
function resolveApiFormat(saved = {}, env = process.env) {
  const explicit = saved?.apiFormat || env?.OPENAI_API_FORMAT;
  if (explicit) return normalizeApiFormat(explicit, 'chat');
  return saved?.apiKey || saved?.baseUrl || saved?.model || env?.OPENAI_API_KEY ? 'responses' : 'chat';
}

function endpointFor(apiFormat) {
  return normalizeApiFormat(apiFormat) === 'responses' ? '/responses' : '/chat/completions';
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part === 'string' ? part : String(part?.text ?? ''))).join('\n');
}

// Converts a Responses-shaped payload to a Chat Completions body.
function toChatPayload(payload, { tokenParameter = 'max_tokens' } = {}) {
  const messages = [];
  if (payload?.instructions) messages.push({ role: 'system', content: String(payload.instructions) });
  for (const item of Array.isArray(payload?.input) ? payload.input : []) {
    const role = ['system', 'user', 'assistant'].includes(item?.role) ? item.role : 'user';
    messages.push({ role, content: contentText(item?.content) });
  }
  const body = { model: payload?.model, messages };
  const maxTokens = Number(payload?.max_output_tokens);
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) body[tokenParameter] = maxTokens;
  if (payload?.text?.format?.type === 'json_object') body.response_format = { type: 'json_object' };
  if (payload?.stream) body.stream = true;
  return body;
}

function encodeRequest(apiFormat, payload, options = {}) {
  return normalizeApiFormat(apiFormat) === 'responses' ? payload : toChatPayload(payload, options);
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const number = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : 0);
  const inputTokens = number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = number(usage.output_tokens ?? usage.completion_tokens);
  const cachedTokens = number(
    usage.input_tokens_details?.cached_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
    ?? usage.prompt_cache_hit_tokens
  );
  if (!inputTokens && !outputTokens) return null;
  return { inputTokens, outputTokens, cachedTokens };
}

function addUsage(total, usage) {
  if (!usage) return total;
  const base = total || { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  return {
    inputTokens: base.inputTokens + (usage.inputTokens || 0),
    outputTokens: base.outputTokens + (usage.outputTokens || 0),
    cachedTokens: base.cachedTokens + (usage.cachedTokens || 0)
  };
}

function responsesText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output.flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

// Normalizes a complete (non-streamed) reply from either protocol.
function decodeResponse(apiFormat, payload) {
  if (normalizeApiFormat(apiFormat) === 'responses') {
    return {
      text: responsesText(payload),
      id: payload?.id || null,
      status: payload?.status || 'completed',
      usage: normalizeUsage(payload?.usage)
    };
  }
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  return {
    text: contentText(choice?.message?.content).trim(),
    id: payload?.id || null,
    status: choice ? 'completed' : 'failed',
    finishReason: choice?.finish_reason || null,
    usage: normalizeUsage(payload?.usage)
  };
}

// Chat Completions stream chunks → the Responses event names used upstream.
// Reasoning text (`reasoning_content`) is never shown as answer text.
function createChatStreamTranslator() {
  let id = null;
  let usage = null;
  let text = '';
  let finished = false;
  return {
    translate(event) {
      if (event?.done) {
        if (finished) return [];
        finished = true;
        return [{ type: 'response.completed', response: { id, status: 'completed', output_text: text, usage } }];
      }
      if (event?.error) return [{ type: 'error', error: event.error }];
      if (event?.id) id = event.id;
      if (event?.usage) usage = event.usage;
      const events = [];
      for (const choice of Array.isArray(event?.choices) ? event.choices : []) {
        const delta = contentText(choice?.delta?.content);
        if (delta) {
          text += delta;
          events.push({ type: 'response.output_text.delta', delta });
        }
      }
      return events;
    },
    get usage() { return normalizeUsage(usage); }
  };
}

// Some OpenAI models reject `max_tokens` in favour of `max_completion_tokens`.
function wantsCompletionTokenParameter(status, errorPayload) {
  if (status !== 400) return false;
  const error = errorPayload?.error || errorPayload || {};
  const text = `${error.param || ''} ${error.code || ''} ${error.message || ''}`;
  return /max_completion_tokens/i.test(text) || (/max_tokens/i.test(text) && /unsupported/i.test(text));
}

module.exports = {
  API_FORMATS,
  addUsage,
  createChatStreamTranslator,
  decodeResponse,
  encodeRequest,
  endpointFor,
  normalizeApiFormat,
  normalizeUsage,
  resolveApiFormat,
  toChatPayload,
  wantsCompletionTokenParameter
};
