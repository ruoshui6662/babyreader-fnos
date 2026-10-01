'use strict';

// Semantic retrieval: embeddings for every passage of a book, stored per book
// and embedding model, searched by cosine similarity in memory.
//
// Vectors are int8-quantised (1 byte per dimension) in one SQLite file per
// book under <data>/ai-vectors/, keyed by the embedding model and a hash of
// the passage text — independent of the search index, shared by every reader
// who uses the same embedding model.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { resolveSafeAiBaseUrl } = require('./ai-config');

const LIMITS = Object.freeze({
  batchSize: 32,
  maxInputChars: 2000,
  requestTimeoutMs: 60000,
  autoMaxChars: 2000000, // larger books are embedded only on request
  cacheBooks: 3,
  charsPerToken: 1.4
});

let DatabaseSync = null;
function database() {
  if (DatabaseSync === null) {
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = false; }
  }
  return DatabaseSync || null;
}

function textHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 32);
}

function modelKey(settings) {
  return crypto.createHash('sha256').update(`${settings.baseUrl}\u0000${settings.model}`).digest('hex').slice(0, 16);
}

// Unit-length vector → int8 with a per-vector scale.
function quantize(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  let max = 0;
  for (const value of vector) max = Math.max(max, Math.abs(value / norm));
  const scale = max / 127 || 1;
  const bytes = new Int8Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) bytes[index] = Math.round(vector[index] / norm / scale);
  return { bytes: Buffer.from(bytes.buffer), scale };
}

function dequantize(buffer, scale) {
  const bytes = new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const vector = new Float32Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) vector[index] = bytes[index] * scale;
  return vector;
}

function normalize(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(vector, (value) => value / norm);
}

/** OpenAI-compatible /embeddings. Returns one Float32Array per input. */
async function embedTexts({ texts, settings, fetchImpl = globalThis.fetch, lookupImpl, signal, timeoutMs = LIMITS.requestTimeoutMs }) {
  if (!settings?.configured) throw Object.assign(new Error('语义检索尚未配置'), { code: 'EMBEDDING_NOT_CONFIGURED' });
  const baseUrl = await resolveSafeAiBaseUrl(settings.baseUrl, lookupImpl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/embeddings`, {
      method: 'POST',
      redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model: settings.model, input: texts.map((text) => String(text).slice(0, LIMITS.maxInputChars)) }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(`嵌入请求失败：${response.status}`), { code: 'EMBEDDING_FAILED', upstreamStatus: response.status });
    }
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const vectors = new Array(texts.length);
    for (const [position, item] of data.entries()) {
      const index = Number.isInteger(item?.index) ? item.index : position;
      if (Array.isArray(item?.embedding) && index >= 0 && index < texts.length) vectors[index] = Float32Array.from(item.embedding);
    }
    if (vectors.some((vector) => !vector || !vector.length)) {
      throw Object.assign(new Error('嵌入服务返回的数据不完整'), { code: 'EMBEDDING_FAILED' });
    }
    return vectors;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error(signal?.aborted ? '已取消' : '嵌入请求超时'), { code: signal?.aborted ? 'AI_ABORTED' : 'EMBEDDING_TIMEOUT' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

function createVectorStore({ dataRoot }) {
  const root = path.join(path.resolve(dataRoot), 'ai-vectors');
  const memory = new Map(); // `${bookId}:${model}` → Map(hash → Float32Array)

  async function open(bookId, { write = false } = {}) {
    const Database = database();
    if (!Database || !/^[a-f0-9]{64}$/.test(String(bookId))) return null;
    const file = path.join(root, `${bookId}.sqlite`);
    if (!write) {
      try { await fs.access(file); } catch { return null; }
    } else {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
    }
    const db = new Database(file, { timeout: 5000 });
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS vectors (model TEXT NOT NULL, hash TEXT NOT NULL, scale REAL NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (model, hash));`);
    return db;
  }

  async function load(bookId, model) {
    const key = `${bookId}:${model}`;
    if (memory.has(key)) {
      const value = memory.get(key);
      memory.delete(key);
      memory.set(key, value);
      return value;
    }
    const vectors = new Map();
    const db = await open(bookId);
    if (db) {
      try {
        for (const row of db.prepare('SELECT hash, scale, vec FROM vectors WHERE model = ?').iterate(model)) {
          vectors.set(row.hash, dequantize(Buffer.from(row.vec), Number(row.scale)));
        }
      } finally {
        db.close();
      }
    }
    memory.set(key, vectors);
    while (memory.size > LIMITS.cacheBooks) memory.delete(memory.keys().next().value);
    return vectors;
  }

  async function put(bookId, model, entries) {
    const db = await open(bookId, { write: true });
    if (!db) return;
    try {
      const insert = db.prepare('INSERT OR REPLACE INTO vectors(model, hash, scale, vec) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      for (const { hash, vector } of entries) {
        const { bytes, scale } = quantize(vector);
        insert.run(model, hash, scale, bytes);
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      db.close();
    }
    const cached = memory.get(`${bookId}:${model}`);
    if (cached) for (const { hash, vector } of entries) cached.set(hash, normalize(vector));
  }

  return { load, put };
}

/**
 * Background embedding per book (one job at a time) and similarity search.
 * `readPassages(book)` returns [{rowid, text}] for the whole book.
 */
function createEmbeddingService({ dataRoot, readPassages, embed = embedTexts }) {
  const store = createVectorStore({ dataRoot });
  const jobs = new Map();
  const passageCache = new Map();

  async function passages(book) {
    const cached = passageCache.get(book.id);
    if (cached && cached.path === book.path) return cached.list;
    const list = (await readPassages(book)).map((item) => ({ ...item, hash: textHash(item.text) }));
    passageCache.set(book.id, { path: book.path, list });
    while (passageCache.size > LIMITS.cacheBooks) passageCache.delete(passageCache.keys().next().value);
    return list;
  }

  async function status(book, settings) {
    if (!settings?.configured) return { state: 'off' };
    const list = await passages(book);
    const vectors = await store.load(book.id, modelKey(settings));
    const done = list.filter((item) => vectors.has(item.hash)).length;
    const missing = list.filter((item) => !vectors.has(item.hash));
    const job = jobs.get(book.id);
    const totalChars = list.reduce((sum, item) => sum + item.text.length, 0);
    return {
      state: job?.running ? 'running' : !list.length ? 'off' : done === list.length ? 'ready' : done ? 'partial' : 'none',
      progress: job?.running ? { done: job.done, total: job.total } : { done, total: list.length },
      estimateTokens: Math.ceil(missing.reduce((sum, item) => sum + Math.min(item.text.length, LIMITS.maxInputChars), 0) / LIMITS.charsPerToken),
      automatic: totalChars <= LIMITS.autoMaxChars,
      error: job && !job.running ? job.error : null
    };
  }

  function run(book, settings, { onProgress } = {}) {
    const existing = jobs.get(book.id);
    if (existing?.running) return existing.promise;
    const controller = new AbortController();
    const job = { running: true, done: 0, total: 0, error: null, controller };
    jobs.set(book.id, job);
    job.promise = (async () => {
      try {
        const model = modelKey(settings);
        const list = await passages(book);
        const vectors = await store.load(book.id, model);
        const missing = [...new Map(list.filter((item) => !vectors.has(item.hash)).map((item) => [item.hash, item])).values()];
        job.total = missing.length;
        for (let start = 0; start < missing.length; start += LIMITS.batchSize) {
          if (controller.signal.aborted) throw Object.assign(new Error('已取消'), { code: 'AI_ABORTED' });
          const batch = missing.slice(start, start + LIMITS.batchSize);
          const embedded = await embed({ texts: batch.map((item) => item.text), settings, signal: controller.signal });
          await store.put(book.id, model, batch.map((item, index) => ({ hash: item.hash, vector: embedded[index] })));
          job.done = Math.min(missing.length, start + batch.length);
          onProgress?.({ done: job.done, total: job.total });
        }
      } catch (error) {
        job.error = controller.signal.aborted || error.code === 'AI_ABORTED' ? '已取消' : (error.message || '语义索引建立失败');
        throw error;
      } finally {
        job.running = false;
      }
    })();
    job.promise.catch(() => {});
    return job.promise;
  }

  // Starts background embedding for an ordinary-sized book; never waits.
  async function ensureInBackground(book, settings) {
    if (!settings?.configured || jobs.get(book.id)?.running) return;
    const current = await status(book, settings);
    if ((current.state === 'none' || current.state === 'partial') && current.automatic) run(book, settings);
  }

  /**
   * Rows most similar to the query, limited to `rowRanges` ([[first, last]])
   * when given. Returns [] when the book has no vectors yet.
   */
  async function search(book, settings, query, { limit = 20, rowRanges = null, signal } = {}) {
    if (!settings?.configured || !String(query || '').trim()) return [];
    const vectors = await store.load(book.id, modelKey(settings));
    if (!vectors.size) return [];
    const list = await passages(book);
    const [queryVector] = await embed({ texts: [query], settings, signal, timeoutMs: 15000 });
    const target = normalize(queryVector);
    const inRange = (rowid) => !rowRanges || rowRanges.some(([first, last]) => rowid >= first && rowid <= last);
    const scored = [];
    for (const item of list) {
      if (!inRange(item.rowid)) continue;
      const vector = vectors.get(item.hash);
      if (!vector || vector.length !== target.length) continue;
      let dot = 0;
      for (let index = 0; index < target.length; index += 1) dot += vector[index] * target[index];
      scored.push({ rowid: item.rowid, score: dot });
    }
    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, limit);
  }

  function cancel(bookId) {
    const job = jobs.get(bookId);
    if (job?.running) job.controller.abort();
  }

  return { status, run, cancel, ensureInBackground, search, isRunning: (bookId) => Boolean(jobs.get(bookId)?.running) };
}

module.exports = {
  LIMITS,
  createEmbeddingService,
  createVectorStore,
  dequantize,
  embedTexts,
  modelKey,
  quantize,
  textHash
};
