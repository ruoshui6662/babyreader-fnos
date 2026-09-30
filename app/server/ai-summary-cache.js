'use strict';

const crypto = require('node:crypto');

const SUMMARY_STRATEGY_VERSION = 'chapter-map-reduce-v1';
const SUMMARY_PROMPT_VERSION = 'chapter-summary-prompt-v1';
const SUMMARY_CACHE_MAX_ANSWER_LENGTH = 12000;

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hashAiSummaryUserId(userId) {
  return digest(userId || '');
}

function buildAiSummaryModelKey({
  provider = 'openai-compatible',
  baseUrl,
  model,
  strategyVersion = SUMMARY_STRATEGY_VERSION,
  promptVersion = SUMMARY_PROMPT_VERSION
} = {}) {
  return digest(JSON.stringify({
    provider: String(provider || ''),
    baseUrl: String(baseUrl || ''),
    model: String(model || ''),
    strategyVersion: String(strategyVersion || ''),
    promptVersion: String(promptVersion || '')
  }));
}

function buildAiSummaryCacheKey({
  userId,
  bookFingerprint,
  logicalChapterId,
  parserVersion,
  strategyVersion = SUMMARY_STRATEGY_VERSION,
  provider = 'openai-compatible',
  baseUrl,
  model,
  promptVersion = SUMMARY_PROMPT_VERSION
} = {}) {
  const normalized = {
    userKey: hashAiSummaryUserId(userId),
    bookFingerprint: String(bookFingerprint || ''),
    logicalChapterId: String(logicalChapterId || ''),
    parserVersion: String(parserVersion || ''),
    strategyVersion: String(strategyVersion || ''),
    provider: String(provider || ''),
    baseUrl: String(baseUrl || ''),
    model: String(model || ''),
    promptVersion: String(promptVersion || '')
  };
  if (Object.entries(normalized).some(([key, value]) => key !== 'userKey' && !value)) {
    throw Object.assign(new Error('章节摘要缓存指纹不完整'), { code: 'AI_SUMMARY_CACHE_KEY_INVALID' });
  }
  return { cacheKey: digest(JSON.stringify(normalized)), userKey: normalized.userKey };
}

function normalizeSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const answer = String(value.answer || '').trim().slice(0, SUMMARY_CACHE_MAX_ANSWER_LENGTH);
  if (!answer) return null;
  return {
    answer,
    summaryMode: value.summaryMode === 'complete' ? 'complete' : 'map_reduce',
    coverage: value.coverage && typeof value.coverage === 'object' ? value.coverage : null,
    citationIntegrity: value.citationIntegrity === true
  };
}

function createAiSummaryCache() {
  const inFlight = new Map();

  async function getOrCreate({ key, read, write, build } = {}) {
    const cacheKey = String(key || '');
    if (!cacheKey || typeof read !== 'function' || typeof write !== 'function' || typeof build !== 'function') {
      throw Object.assign(new Error('章节摘要缓存操作无效'), { code: 'AI_SUMMARY_CACHE_KEY_INVALID' });
    }
    let cached = null;
    try {
      cached = normalizeSummary(await read(cacheKey));
    } catch {
      // Cache read failures are a miss; they must not prevent a safe fresh answer.
    }
    if (cached) return { ...cached, cacheHit: true };
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const pending = (async () => {
      const built = normalizeSummary(await build());
      if (!built) throw Object.assign(new Error('AI 未返回可缓存的章节概述'), { code: 'AI_SUMMARY_EMPTY' });
      try {
        await write(cacheKey, built);
      } catch {
        // Persistence is best-effort after a completed answer; provider output remains usable.
      }
      return { ...built, cacheHit: false };
    })().finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
    return pending;
  }

  return { getOrCreate };
}

module.exports = {
  SUMMARY_STRATEGY_VERSION,
  SUMMARY_PROMPT_VERSION,
  SUMMARY_CACHE_MAX_ANSWER_LENGTH,
  hashAiSummaryUserId,
  buildAiSummaryModelKey,
  buildAiSummaryCacheKey,
  createAiSummaryCache
};
