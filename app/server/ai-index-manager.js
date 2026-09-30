'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const BOOK_ID_PATTERN = /^[a-f0-9]{64}$/;
const MANIFEST_VERSION = 1;
const DEFAULT_SCHEMA_VERSION = 2;
const REQUIRED_TABLES = ['ai_meta', 'ai_chunk_text', 'ai_chunks'];

function managerError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = {
    INVALID_REQUEST: 400,
    INVALID_BOOK_ID: 400,
    INDEX_UNSAFE_TARGET: 409,
    INDEX_BUSY: 409,
    LIBRARY_SCAN_UNAVAILABLE: 503,
    INDEX_MANAGER_UNAVAILABLE: 503
  }[code] || 500;
  return error;
}

function validateBookId(bookId) {
  const value = String(bookId || '');
  if (!BOOK_ID_PATTERN.test(value)) {
    throw managerError('INVALID_BOOK_ID', 'bookId must be 64 lowercase hexadecimal characters');
  }
  return value;
}

function isoDate(value) {
  return new Date(value == null ? Date.now() : value).toISOString();
}

function emptyManifest() {
  return { version: MANIFEST_VERSION, entries: {} };
}

function isManifest(value) {
  return Boolean(
    value
    && value.version === MANIFEST_VERSION
    && value.entries
    && typeof value.entries === 'object'
    && !Array.isArray(value.entries)
  );
}

function normalizeManifestEntry(bookId, value) {
  if (!value || typeof value !== 'object') return null;
  return {
    bookId,
    sizeBytes: Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 0 ? value.sizeBytes : 0,
    indexedAt: typeof value.indexedAt === 'string' ? value.indexedAt : null,
    lastAccessedAt: typeof value.lastAccessedAt === 'string' ? value.lastAccessedAt : null,
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : '',
    schemaVersion: Number.isInteger(value.schemaVersion) ? value.schemaVersion : null
  };
}

function normalizeManifest(value) {
  if (!isManifest(value)) return emptyManifest();
  const entries = {};
  for (const [bookId, entry] of Object.entries(value.entries)) {
    if (!BOOK_ID_PATTERN.test(bookId)) continue;
    const normalized = normalizeManifestEntry(bookId, entry);
    if (normalized) entries[bookId] = normalized;
  }
  return { version: MANIFEST_VERSION, entries };
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readPragma(db, name) {
  const row = db.prepare('PRAGMA ' + name).get();
  return Number(row?.[name] ?? 0);
}

function summaryFor(items) {
  const summary = {
    total: items.length,
    ready: 0,
    building: 0,
    stale: 0,
    orphan: 0,
    corrupt: 0,
    missing: 0,
    temporary: 0,
    unknown: 0,
    sizeBytes: 0
  };
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(summary, item.status)) summary[item.status] += 1;
    summary.sizeBytes += Number.isSafeInteger(item.sizeBytes) ? item.sizeBytes : 0;
  }
  return summary;
}

function createAiIndexManager({
  dataRoot,
  getLibraryIndex = null,
  onIndexDeleted = null,
  now = () => new Date(),
  schemaVersion = DEFAULT_SCHEMA_VERSION
} = {}) {
  const resolvedDataRoot = path.resolve(String(dataRoot || ''));
  const directory = path.join(resolvedDataRoot, 'ai-index');
  const manifestPath = path.join(directory, 'manifest.json');
  let manifestCache = null;
  let manifestRecovered = false;
  const leases = new Map();

  function getIndexPath(bookId) {
    const validBookId = validateBookId(bookId);
    return path.join(directory, validBookId + '.sqlite');
  }

  function managedBookIdFromPath(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    const relative = path.relative(directory, resolved);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw managerError('INDEX_UNSAFE_TARGET', 'index path is outside the managed directory');
    }
    const fileName = path.basename(resolved);
    if (!fileName.endsWith('.sqlite')) {
      throw managerError('INDEX_UNSAFE_TARGET', 'index path is not a SQLite index');
    }
    const bookId = fileName.slice(0, -'.sqlite'.length);
    validateBookId(bookId);
    if (resolved !== getIndexPath(bookId)) {
      throw managerError('INDEX_UNSAFE_TARGET', 'index path is not canonical');
    }
    return bookId;
  }

  function leaseEntry(bookId) {
    const validBookId = validateBookId(bookId);
    let entry = leases.get(validBookId);
    if (!entry) {
      entry = { buildPromise: null, readers: 0 };
      leases.set(validBookId, entry);
    }
    return { bookId: validBookId, entry };
  }

  function clearLeaseIfIdle(bookId, entry) {
    if (!entry.buildPromise && entry.readers === 0) leases.delete(bookId);
  }

  async function withBuildLease(bookId, operation) {
    const { bookId: validBookId, entry } = leaseEntry(bookId);
    if (entry.buildPromise) return entry.buildPromise;
    const promise = Promise.resolve()
      .then(() => operation())
      .finally(() => {
        entry.buildPromise = null;
        clearLeaseIfIdle(validBookId, entry);
      });
    entry.buildPromise = promise;
    return promise;
  }

  async function withReadLease(bookId, operation) {
    const { bookId: validBookId, entry } = leaseEntry(bookId);
    entry.readers += 1;
    try {
      return await operation();
    } finally {
      entry.readers -= 1;
      clearLeaseIfIdle(validBookId, entry);
    }
  }

  function leaseState(bookId) {
    const validBookId = validateBookId(bookId);
    const entry = leases.get(validBookId) || { buildPromise: null, readers: 0 };
    return {
      building: Boolean(entry.buildPromise),
      readers: entry.readers
    };
  }

  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
  }

  async function loadManifest() {
    if (manifestCache) return manifestCache;
    try {
      const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (!isManifest(parsed)) throw new Error('invalid manifest');
      manifestCache = normalizeManifest(parsed);
      return manifestCache;
    } catch (error) {
      if (error?.code !== 'ENOENT') manifestRecovered = true;
      manifestCache = emptyManifest();
      return manifestCache;
    }
  }

  async function publishManifest(manifest) {
    await ensureDirectory();
    const temporaryPath = manifestPath + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.chmod(temporaryPath, 0o600);
    try {
      if (await pathExists(manifestPath)) {
        const backupPath = manifestPath + '.' + process.pid + '.' + Date.now() + '.bak';
        await fs.rename(manifestPath, backupPath);
        try {
          await fs.rename(temporaryPath, manifestPath);
        } catch (error) {
          await fs.rename(backupPath, manifestPath).catch(() => {});
          throw error;
        }
        await fs.rm(backupPath, { force: true });
      } else {
        await fs.rename(temporaryPath, manifestPath);
      }
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
    await fs.chmod(manifestPath, 0o600);
    manifestCache = manifest;
    manifestRecovered = false;
  }

  async function inspectIndexFile(filePath) {
    const bookId = managedBookIdFromPath(filePath);
    let stat;
    try {
      const linkStat = await fs.lstat(filePath);
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        return {
          bookId,
          status: 'unsafe',
          exists: true,
          sizeBytes: 0,
          modifiedAt: null,
          requiredTables: []
        };
      }
      stat = linkStat;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { bookId, status: 'missing', exists: false, sizeBytes: 0, modifiedAt: null, requiredTables: [] };
      }
      return { bookId, status: 'unavailable', exists: false, sizeBytes: 0, modifiedAt: null, requiredTables: [] };
    }

    const modifiedAt = stat.mtime instanceof Date ? stat.mtime.toISOString() : null;

    if (!DatabaseSync) {
      return { bookId, status: 'unavailable', exists: true, sizeBytes: stat.size, modifiedAt, requiredTables: [] };
    }

    let db;
    try {
      db = new DatabaseSync(filePath, { readOnly: true, timeout: 5000 });
      const tableRows = db.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'shadow') AND name IN (?, ?, ?)"
      ).all(...REQUIRED_TABLES);
      const requiredTables = tableRows.map((row) => String(row.name));
      if (requiredTables.length !== REQUIRED_TABLES.length) {
        return { bookId, status: 'corrupt', exists: true, sizeBytes: stat.size, modifiedAt, requiredTables };
      }
      const metaRows = db.prepare('SELECT key, value FROM ai_meta').all();
      const metadata = Object.fromEntries(metaRows.map((row) => [String(row.key), String(row.value)]));
      if (metadata.bookId !== bookId || !metadata.fingerprint || !metadata.schemaVersion) {
        return { bookId, status: 'corrupt', exists: true, sizeBytes: stat.size, modifiedAt, requiredTables };
      }
      return {
        bookId,
        status: Number(metadata.schemaVersion) === schemaVersion ? 'ready' : 'stale',
        exists: true,
        sizeBytes: stat.size,
        modifiedAt,
        pageCount: await readPragma(db, 'page_count'),
        pageSize: await readPragma(db, 'page_size'),
        freelistCount: await readPragma(db, 'freelist_count'),
        requiredTables,
        metadata
      };
    } catch {
      return { bookId, status: 'corrupt', exists: true, sizeBytes: stat.size, modifiedAt, requiredTables: [] };
    } finally {
      db?.close();
    }
  }

  async function recordBuildSuccess(book, metadata = {}) {
    const bookId = validateBookId(book?.id);
    const filePath = metadata.filePath || getIndexPath(bookId);
    if (path.resolve(filePath) !== getIndexPath(bookId)) {
      throw managerError('INDEX_UNSAFE_TARGET', 'build file is outside the managed index path');
    }
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw managerError('INDEX_UNSAFE_TARGET', 'build target cannot be a symbolic link');
    }
    if (!stat.isFile()) throw managerError('INDEX_UNSAFE_TARGET', 'build target is not a file');
    const manifest = await loadManifest();
    const timestamp = isoDate(metadata.indexedAt ?? now());
    const entry = {
      bookId,
      sizeBytes: stat.size,
      indexedAt: timestamp,
      lastAccessedAt: isoDate(metadata.lastAccessedAt ?? timestamp),
      fingerprint: String(metadata.fingerprint || ''),
      schemaVersion: Number.isInteger(metadata.schemaVersion) ? metadata.schemaVersion : schemaVersion
    };
    manifest.entries[bookId] = entry;
    await publishManifest(manifest);
    return entry;
  }

  async function recordAccess(bookId) {
    const validBookId = validateBookId(bookId);
    const manifest = await loadManifest();
    const entry = manifest.entries[validBookId];
    if (!entry) return false;
    entry.lastAccessedAt = isoDate(now());
    await publishManifest(manifest);
    return true;
  }

  async function deleteIndex(bookId) {
    const validBookId = validateBookId(bookId);
    const state = leaseState(validBookId);
    if (state.building || state.readers > 0) {
      throw managerError('INDEX_BUSY', 'index is active');
    }
    const filePath = getIndexPath(validBookId);
    let deleted = false;
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw managerError('INDEX_UNSAFE_TARGET', 'index target is not a regular file');
      }
      await fs.rm(filePath);
      deleted = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const manifest = await loadManifest();
    if (manifest.entries[validBookId]) {
      delete manifest.entries[validBookId];
      await publishManifest(manifest);
    }
    if (deleted && typeof onIndexDeleted === 'function') {
      try { await onIndexDeleted(validBookId); } catch { /* Cache cleanup must not undo index deletion. */ }
    }
    return { bookId: validBookId, deleted };
  }

  async function publishIndex(temporaryPath, targetPath) {
    const targetBookId = managedBookIdFromPath(targetPath);
    const resolvedTemporaryPath = path.resolve(String(temporaryPath || ''));
    const temporaryRelative = path.relative(directory, resolvedTemporaryPath);
    if (!temporaryRelative || temporaryRelative.startsWith('..' + path.sep)
      || path.isAbsolute(temporaryRelative) || resolvedTemporaryPath === getIndexPath(targetBookId)) {
      throw managerError('INDEX_UNSAFE_TARGET', 'temporary index path is outside the managed directory');
    }
    const temporaryStat = await fs.lstat(resolvedTemporaryPath);
    if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile()) {
      throw managerError('INDEX_UNSAFE_TARGET', 'temporary index target is not a regular file');
    }
    let targetStat = null;
    try {
      targetStat = await fs.lstat(targetPath);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw managerError('INDEX_UNSAFE_TARGET', 'existing index target is not a regular file');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (process.platform !== 'win32' || !targetStat) {
      await fs.rename(resolvedTemporaryPath, targetPath);
      return targetPath;
    }

    const backupPath = targetPath + '.' + process.pid + '.' + Date.now() + '.bak';
    await fs.rename(targetPath, backupPath);
    try {
      await fs.rename(resolvedTemporaryPath, targetPath);
    } catch (error) {
      await fs.rename(backupPath, targetPath).catch(() => {});
      throw error;
    }
    await fs.rm(backupPath, { force: true });
    return targetPath;
  }

  async function listIndexFiles() {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
        .map((entry) => path.join(directory, entry.name));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function cleanup({ kind = '', libraryIndex = null, scanHealthy = false, confirm = false } = {}) {
    if (confirm !== true) throw managerError('INVALID_REQUEST', 'cleanup requires confirmation');
    if (!['orphans', 'temporary', 'all'].includes(kind)) {
      throw managerError('INVALID_REQUEST', 'cleanup kind is invalid');
    }
    if ((kind === 'orphans' || kind === 'all') && !scanHealthy) {
      throw managerError('LIBRARY_SCAN_UNAVAILABLE', 'library scan is not healthy');
    }
    const suppliedLibrary = Array.isArray(libraryIndex)
      ? libraryIndex
      : (typeof getLibraryIndex === 'function' ? await getLibraryIndex() : []);
    const books = new Set(
      suppliedLibrary
        .filter((book) => BOOK_ID_PATTERN.test(String(book?.id || '')))
        .map((book) => book.id)
    );
    const deleted = [];
    const skipped = [];
    const manifestRemoved = [];
    let bytesFreed = 0;

    if (kind === 'orphans' || kind === 'all') {
      for (const filePath of await listIndexFiles()) {
        const fileName = path.basename(filePath);
        const bookId = fileName.slice(0, -'.sqlite'.length);
        if (!BOOK_ID_PATTERN.test(bookId) || books.has(bookId)) continue;
        try {
          const stat = await fs.lstat(filePath);
          const result = await deleteIndex(bookId);
          if (result.deleted) {
            deleted.push({ kind: 'orphan', bookId });
            bytesFreed += stat.size;
          }
        } catch (error) {
          if (error.code === 'INDEX_BUSY') skipped.push({ kind: 'orphan', bookId, reason: error.code });
          else throw error;
        }
      }

      const manifest = await loadManifest();
      let manifestChanged = false;
      for (const bookId of Object.keys(manifest.entries)) {
        if (books.has(bookId)) continue;
        let exists = false;
        try {
          await fs.lstat(getIndexPath(bookId));
          exists = true;
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        if (exists) continue;
        delete manifest.entries[bookId];
        manifestRemoved.push(bookId);
        manifestChanged = true;
      }
      if (manifestChanged) await publishManifest(manifest);
    }

    if (kind === 'temporary' || kind === 'all') {
      const cutoff = new Date(now()).getTime() - 24 * 60 * 60 * 1000;
      let entries = [];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue;
        const match = entry.name.match(/^([a-f0-9]{64})\.sqlite\./);
        const bookId = match?.[1] || null;
        if (bookId && leaseState(bookId).building) {
          skipped.push({ kind: 'temporary', bookId, reason: 'INDEX_BUSY' });
          continue;
        }
        const filePath = path.join(directory, entry.name);
        const stat = await fs.lstat(filePath);
        if (stat.mtimeMs >= cutoff) continue;
        await fs.rm(filePath);
        deleted.push({ kind: 'temporary' });
        bytesFreed += stat.size;
      }
    }
    return { kind, deleted, skipped, manifestRemoved, bytesFreed };
  }

  async function listIndexes({ libraryIndex = null, scanHealthy = true } = {}) {
    const manifest = await loadManifest();
    const suppliedLibrary = Array.isArray(libraryIndex)
      ? libraryIndex
      : (typeof getLibraryIndex === 'function' ? await getLibraryIndex() : []);
    const books = new Map(
      suppliedLibrary
        .filter((book) => BOOK_ID_PATTERN.test(String(book?.id || '')))
        .map((book) => [book.id, book])
    );
    const items = [];
    const seen = new Set();

    for (const filePath of await listIndexFiles()) {
      const fileName = path.basename(filePath);
      const rawBookId = fileName.slice(0, -'.sqlite'.length);
      if (!BOOK_ID_PATTERN.test(rawBookId)) continue;
      const inspection = await inspectIndexFile(filePath);
      const book = books.get(rawBookId);
      let status = inspection.status;
      if (status === 'ready' && !book) status = scanHealthy ? 'orphan' : 'unknown';
      if (status === 'ready' && book && typeof book.fingerprint === 'string'
        && inspection.metadata?.fingerprint !== book.fingerprint) {
        status = 'stale';
      }
      const entry = manifest.entries[rawBookId];
      items.push({
        bookId: rawBookId,
        title: book?.title || '',
        format: book?.type || '',
        status,
        sizeBytes: inspection.sizeBytes || entry?.sizeBytes || 0,
        indexedAt: entry?.indexedAt || inspection.modifiedAt || null,
        indexedAtSource: entry?.indexedAt ? 'manifest' : inspection.modifiedAt ? 'file-mtime' : null,
        lastAccessedAt: entry?.lastAccessedAt || null,
        schemaVersion: Number(inspection.metadata?.schemaVersion || entry?.schemaVersion || 0) || null,
        fingerprint: inspection.metadata?.fingerprint || entry?.fingerprint || '',
        pageCount: inspection.pageCount || 0,
        pageSize: inspection.pageSize || 0,
        freelistCount: inspection.freelistCount || 0
      });
      seen.add(rawBookId);
    }

    for (const [bookId, entry] of Object.entries(manifest.entries)) {
      if (seen.has(bookId)) continue;
      items.push({
        bookId,
        title: books.get(bookId)?.title || '',
        format: books.get(bookId)?.type || '',
        status: 'missing',
        sizeBytes: 0,
        indexedAt: entry.indexedAt,
        indexedAtSource: entry.indexedAt ? 'manifest' : null,
        lastAccessedAt: entry.lastAccessedAt,
        schemaVersion: entry.schemaVersion,
        fingerprint: entry.fingerprint,
        pageCount: 0,
        pageSize: 0,
        freelistCount: 0
      });
    }

    items.sort((left, right) => left.bookId.localeCompare(right.bookId));
    return {
      items,
      summary: summaryFor(items),
      scanHealthy: Boolean(scanHealthy),
      manifestRecovered
    };
  }

  return {
    indexDirectory: () => directory,
    getIndexPath,
    inspectIndexFile,
    listIndexes,
    recordBuildSuccess,
    recordAccess,
    withBuildLease,
    withReadLease,
    leaseState,
    publishIndex,
    deleteIndex,
    cleanup,
    getManifestPath: () => manifestPath
  };
}

module.exports = {
  BOOK_ID_PATTERN,
  MANIFEST_VERSION,
  createAiIndexManager
};
