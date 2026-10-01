'use strict';

// Storage for book maps (导读图): AI summaries of a book's chapters, sections
// and the whole book. One JSON file per book under <data>/ai-map/, shared by
// every reader on this NAS — summaries depend only on the book's text, so the
// same book is never paid for twice. Entries are keyed by node id + a hash of
// the text (or child summaries) they were made from, so they stay valid when
// the search index is rebuilt and are ignored automatically when a book's
// text changes.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAP_VERSION = 'book-map-v1';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 20000;
const BOOK_ID = /^[a-f0-9]{64}$/;

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 32);
}

function createBookMapStore({ dataRoot }) {
  const root = path.join(path.resolve(dataRoot), 'ai-map');
  const queues = new Map();
  const cache = new Map();

  function filePath(bookId) {
    if (!BOOK_ID.test(String(bookId || ''))) throw Object.assign(new Error('Invalid book ID'), { code: 'INVALID_BOOK_ID' });
    return path.join(root, `${bookId}.json`);
  }

  async function read(bookId) {
    if (cache.has(bookId)) return cache.get(bookId);
    let data = { version: MAP_VERSION, entries: {} };
    try {
      const file = filePath(bookId);
      const stat = await fs.lstat(file);
      if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        if (parsed?.version === MAP_VERSION && parsed.entries && typeof parsed.entries === 'object') data = parsed;
      }
    } catch (error) {
      if (error.code === 'INVALID_BOOK_ID') throw error;
    }
    cache.set(bookId, data);
    return data;
  }

  // Writes are serialised per book; every write rewrites the file atomically.
  function update(bookId, mutate) {
    const previous = queues.get(bookId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const data = structuredClone(await read(bookId));
      mutate(data);
      const keys = Object.keys(data.entries);
      if (keys.length > MAX_ENTRIES) {
        keys.sort((left, right) => String(data.entries[left].createdAt).localeCompare(String(data.entries[right].createdAt)));
        for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete data.entries[key];
      }
      const serialized = `${JSON.stringify(data)}\n`;
      if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw Object.assign(new Error('Book map is too large'), { code: 'BOOK_MAP_TOO_LARGE' });
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const target = filePath(bookId);
      const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, serialized, { mode: 0o600 });
      await fs.rename(temporary, target);
      cache.set(bookId, data);
      return data;
    });
    queues.set(bookId, next);
    next.finally(() => { if (queues.get(bookId) === next) queues.delete(bookId); }).catch(() => {});
    return next;
  }

  const key = (nodeId, contentHash) => `${nodeId}\u0000${contentHash}`;

  return {
    async get(bookId, nodeId, contentHash) {
      const data = await read(bookId);
      return data.entries[key(nodeId, contentHash)] || null;
    },
    // Latest entry for a node regardless of its content hash (for display).
    async latest(bookId) {
      const data = await read(bookId);
      const byNode = new Map();
      for (const entry of Object.values(data.entries)) {
        const current = byNode.get(entry.nodeId);
        if (!current || String(entry.createdAt) > String(current.createdAt)) byNode.set(entry.nodeId, entry);
      }
      return byNode;
    },
    async put(bookId, nodeId, contentHash, value) {
      await update(bookId, (data) => {
        // One entry per node: a newer summary of changed text replaces the old one.
        for (const [entryKey, entry] of Object.entries(data.entries)) {
          if (entry.nodeId === nodeId && entryKey !== key(nodeId, contentHash)) delete data.entries[entryKey];
        }
        data.entries[key(nodeId, contentHash)] = { nodeId, contentHash, createdAt: new Date().toISOString(), ...value };
      });
    },
    async clear(bookId) {
      await update(bookId, (data) => { data.entries = {}; });
    },
    async remove(bookId) {
      cache.delete(bookId);
      await fs.rm(filePath(bookId), { force: true });
    }
  };
}

module.exports = { MAP_VERSION, createBookMapStore, hashText };
