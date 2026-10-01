'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeUserId, readJson, writeJsonAtomic } = require('./storage');

const STORE_VERSION = 1;
const BOOK_ID_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_FIELDS = ['parserVersion', 'structureVersion', 'strategyVersion', 'promptVersion'];
const PROFILE_FIELDS = ['sourceFingerprint', 'provider', 'baseUrl', 'model', ...VERSION_FIELDS];

function storeError(code, message) {
  const error = Object.assign(new Error(message), { code });
  if (code === 'AbortError') error.name = 'AbortError';
  return error;
}

function validBookId(value) {
  const bookId = String(value || '');
  if (!BOOK_ID_PATTERN.test(bookId)) throw storeError('INVALID_BOOK_ID', 'Invalid PDF book ID');
  return bookId;
}

function normalizedUid(uid) {
  try { return normalizeUserId(uid); } catch { throw storeError('INVALID_USER_ID', 'Invalid fnOS user ID'); }
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function requiredString(input, field) {
  const value = String(input?.[field] || '').trim();
  if (!value || value.length > 2048) throw storeError('INVALID_CACHE_KEY', `Invalid ${field}`);
  return value;
}

function buildPdfAiProfileCacheKey(input) {
  const uid = normalizedUid(input?.uid);
  const bookId = validBookId(input?.bookId);
  const fields = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, requiredString(input, field)]));
  const userKey = digest(uid);
  const cacheKey = digest(JSON.stringify({ uidHash: userKey, bookId, ...fields }));
  return { cacheKey, userKey };
}

function createPdfAiProfileStore({ dataRoot } = {}) {
  const root = path.resolve(String(dataRoot || ''));
  if (!dataRoot) throw storeError('INVALID_DATA_ROOT', 'PDF AI data root is required');
  const structureDirectory = path.join(root, 'pdf-ai', 'structures');
  const inFlight = new Map();

  function structurePath(bookId) {
    return path.join(structureDirectory, `${validBookId(bookId)}.json`);
  }

  function profilePath(uid, bookId) {
    return path.join(root, 'users', normalizedUid(uid), 'pdf-ai-profiles', `${validBookId(bookId)}.json`);
  }

  async function readMatching(filePath, expected, payloadKey) {
    let value;
    try { value = await readJson(filePath, null); } catch { return null; }
    if (!value || typeof value !== 'object' || value.version !== STORE_VERSION) return null;
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (value[key] !== expectedValue) return null;
    }
    return value[payloadKey] ?? null;
  }

  async function getStructure({ bookId, sourceFingerprint, parserVersion, structureVersion } = {}) {
    const expected = {
      bookId: validBookId(bookId),
      sourceFingerprint: requiredString({ sourceFingerprint }, 'sourceFingerprint'),
      parserVersion: requiredString({ parserVersion }, 'parserVersion'),
      structureVersion: requiredString({ structureVersion }, 'structureVersion')
    };
    return readMatching(structurePath(bookId), expected, 'structure');
  }

  async function putStructure({ bookId, sourceFingerprint, parserVersion, structureVersion, structure } = {}) {
    if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
      throw storeError('INVALID_STRUCTURE', 'Invalid PDF structure cache value');
    }
    const value = {
      version: STORE_VERSION,
      bookId: validBookId(bookId),
      sourceFingerprint: requiredString({ sourceFingerprint }, 'sourceFingerprint'),
      parserVersion: requiredString({ parserVersion }, 'parserVersion'),
      structureVersion: requiredString({ structureVersion }, 'structureVersion'),
      structure
    };
    await writeJsonAtomic(structurePath(bookId), value);
  }

  async function getProfile(input = {}) {
    let metadata;
    let keys;
    try {
      keys = buildPdfAiProfileCacheKey(input);
      metadata = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, requiredString(input, field)]));
    } catch { return null; }
    return readMatching(profilePath(input.uid, input.bookId), {
      bookId: validBookId(input.bookId),
      uidHash: keys.userKey,
      cacheKey: keys.cacheKey,
      ...metadata
    }, 'profile');
  }

  async function putProfile(input = {}) {
    const { profile } = input;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw storeError('INVALID_PROFILE', 'Invalid PDF AI profile cache value');
    }
    const keys = buildPdfAiProfileCacheKey(input);
    const value = {
      version: STORE_VERSION,
      bookId: validBookId(input.bookId),
      uidHash: keys.userKey,
      cacheKey: keys.cacheKey,
      ...Object.fromEntries(PROFILE_FIELDS.map((field) => [field, requiredString(input, field)])),
      profile
    };
    await writeJsonAtomic(profilePath(input.uid, input.bookId), value);
  }

  async function getOrCreateProfile({ build, validateBeforeWrite = null, signal, ...input } = {}) {
    if (typeof build !== 'function') throw storeError('INVALID_BUILDER', 'Profile builder is required');
    if (signal?.aborted) throw storeError('AbortError', 'PDF profile build was cancelled');
    const keys = buildPdfAiProfileCacheKey(input);
    const inFlightKey = `${keys.cacheKey}`;
    // An entry whose build was already cancelled must never gain new waiters:
    // they would inherit an AbortError they did not ask for.
    const liveEntry = () => {
      const current = inFlight.get(inFlightKey);
      return current && !current.controller.signal.aborted ? current : null;
    };
    // Join a live build synchronously, before any disk read: it will publish
    // the profile, and joining in call order keeps waiter counts deterministic.
    let entry = liveEntry();
    if (!entry) {
      const cached = await getProfile(input);
      if (cached) return cached;
      // Cancelled while reading the cache: leave the shared build alone.
      if (signal?.aborted) throw storeError('AbortError', 'PDF profile build was cancelled');
      entry = liveEntry();
    }
    if (!entry) {
      const controller = new AbortController();
      const created = { bookId: validBookId(input.bookId), controller, waiters: 0, promise: null };
      created.promise = Promise.resolve().then(async () => {
        if (controller.signal.aborted) throw storeError('AbortError', 'PDF profile build was cancelled');
        const profile = await build(controller.signal);
        if (controller.signal.aborted) throw storeError('AbortError', 'PDF profile build was cancelled');
        if (typeof validateBeforeWrite === 'function' && await validateBeforeWrite(controller.signal) !== true) {
          throw storeError('PDF_SOURCE_CHANGED', 'PDF source changed while building its profile');
        }
        await putProfile({ ...input, profile });
        return profile;
      }).finally(() => {
        // A cancelled build may settle after a fresh one took its key.
        if (inFlight.get(inFlightKey) === created) inFlight.delete(inFlightKey);
      });
      inFlight.set(inFlightKey, created);
      entry = created;
    }
    entry.waiters += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        entry.waiters = Math.max(0, entry.waiters - 1);
        if (entry.waiters === 0 && inFlight.get(inFlightKey) === entry) entry.controller.abort();
      };
      const abort = () => {
        release();
        reject(storeError('AbortError', 'PDF profile build was cancelled'));
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      entry.promise.then((value) => { release(); resolve(value); }, (error) => { release(); reject(error); });
    });
  }

  async function deleteBook(bookId) {
    const validBookIdValue = validBookId(bookId);
    for (const entry of inFlight.values()) {
      if (entry.bookId === validBookIdValue) entry.controller.abort();
    }
    await fs.rm(structurePath(validBookIdValue), { force: true });
    const usersDirectory = path.join(root, 'users');
    let entries = [];
    try { entries = await fs.readdir(usersDirectory, { withFileTypes: true }); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.name)) continue;
      const directory = path.join(usersDirectory, entry.name, 'pdf-ai-profiles');
      try {
        const directoryStat = await fs.lstat(directory);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) continue;
        const target = path.join(directory, `${validBookIdValue}.json`);
        const targetStat = await fs.lstat(target).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
        if (targetStat && !targetStat.isSymbolicLink() && targetStat.isFile()) await fs.rm(target);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  return { getStructure, putStructure, getProfile, putProfile, getOrCreateProfile, deleteBook };
}

module.exports = { STORE_VERSION, buildPdfAiProfileCacheKey, createPdfAiProfileStore };
