'use strict';

// Derived-EPUB cache for MOBI books (MOBI plan Task 2).
//   ${dataRoot}/derived/<bookId>.<fingerprint16>.c<converterVersion>.epub
// The source is re-authorized by the caller (findBook) and its fingerprint is
// re-checked here, so a stale artifact is never served for a changed file.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { fingerprintBook } = require('./library');
const { MOBI_CONVERTER_VERSION, MOBI_CONVERSION_LIMITS } = require('./mobi-convert');
const { DEFAULT_MOBI_LIMITS, MobiFormatError } = require('./mobi-format');

const DERIVED_LIMITS = Object.freeze({
  ...MOBI_CONVERSION_LIMITS,
  maxSourceBytes: DEFAULT_MOBI_LIMITS.maxFileBytes,
  maxDurationMs: 60_000,
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  maxCacheBytes: 2 * 1024 * 1024 * 1024,
  failureMemoMs: 10 * 60_000
});
const NAME_PATTERN = /^([a-f0-9]{64})\.([a-f0-9]{16})\.c(\d+)\.epub$/;

function derivedError(code, message) {
  return new MobiFormatError(code, message);
}

function createMobiDerivedStore({ dataRoot, limits: overrides = {}, workerPath = path.join(__dirname, 'mobi-convert-worker.js') }) {
  const limits = { ...DERIVED_LIMITS, ...overrides };
  const directory = path.join(dataRoot, 'derived');
  const inflight = new Map();
  const failures = new Map();
  let queue = Promise.resolve();
  const stats = { conversions: 0 };

  function fileNameFor(book) {
    const key = crypto.createHash('sha256').update(String(book.fingerprint)).digest('hex').slice(0, 16);
    return `${book.id}.${key}.c${MOBI_CONVERTER_VERSION}.epub`;
  }

  async function readSource(book) {
    const flags = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0);
    const handle = await fs.open(book.path, flags);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw derivedError('SOURCE_CHANGED', 'MOBI source is no longer a regular file');
      if (fingerprintBook(book.path, stat) !== book.fingerprint) {
        throw derivedError('SOURCE_CHANGED', 'MOBI source changed; rescan the library');
      }
      if (stat.size > limits.maxSourceBytes) throw derivedError('TOO_LARGE', 'MOBI file exceeds the size limit');
      const bytes = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(bytes, 0, stat.size, 0);
      if (bytesRead !== stat.size) throw derivedError('SOURCE_CHANGED', 'MOBI source changed while reading');
      return bytes;
    } finally {
      await handle.close();
    }
  }

  function runWorker(sourceBytes, identifier) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let worker;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker?.terminate().catch(() => {});
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(derivedError('TIMEOUT', 'MOBI conversion exceeded its time limit')), limits.maxDurationMs);
      const transfer = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      try {
        worker = new Worker(workerPath, {
          workerData: {
            sourceBytes: transfer,
            identifier,
            limits: {
              maxTextBytes: limits.maxTextBytes,
              maxImageBytes: limits.maxImageBytes,
              maxTotalImageBytes: limits.maxTotalImageBytes,
              maxSections: limits.maxSections,
              maxSectionBytes: limits.maxSectionBytes,
              targetSectionBytes: limits.targetSectionBytes
            }
          },
          transferList: [transfer],
          resourceLimits: {
            maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
            maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb
          }
        });
      } catch {
        finish(derivedError('CONVERSION_FAILED', 'MOBI converter could not be started'));
        return;
      }
      worker.once('message', (message) => {
        if (message?.ok === true && message.epub instanceof ArrayBuffer) finish(null, Buffer.from(message.epub));
        else finish(derivedError(message?.code || 'CONVERSION_FAILED', message?.message || 'MOBI conversion failed'));
      });
      worker.once('error', (error) => finish(derivedError(
        error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'TOO_LARGE' : 'CONVERSION_FAILED',
        error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MOBI conversion exceeded its memory limit' : 'MOBI converter failed'
      )));
      worker.once('exit', (code) => {
        if (!settled) finish(derivedError('CONVERSION_FAILED', `MOBI converter stopped unexpectedly (${code})`));
      });
    });
  }

  async function writeAtomically(target, bytes) {
    const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, target);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async function removeOtherVersions(book, keep) {
    const names = await fs.readdir(directory).catch(() => []);
    await Promise.all(names
      .filter((name) => name.startsWith(`${book.id}.`) && name !== keep && NAME_PATTERN.test(name))
      .map((name) => fs.rm(path.join(directory, name), { force: true })));
  }

  async function convert(book, target) {
    stats.conversions += 1;
    const source = await readSource(book);
    const epub = await runWorker(source, `urn:zhenshu:book:${book.id}`);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await writeAtomically(target, epub);
    await removeOtherVersions(book, path.basename(target));
    return target;
  }

  async function existing(target) {
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile()) return null;
      const now = new Date();
      await fs.utimes(target, now, stat.mtime).catch(() => {}); // atime = recency for pruning
      return target;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Resolves the derived EPUB for a MOBI book, converting on first use.
   * @returns {Promise<{status:'ready', path:string}|{status:'preparing'}>}
   * @throws MobiFormatError with a stable `code` when conversion failed.
   */
  async function ensure(book, { waitMs = 15_000 } = {}) {
    if (book?.type !== 'mobi' || !/^[a-f0-9]{64}$/.test(String(book.id)) || !book.fingerprint) {
      throw derivedError('NOT_MOBI', 'Book is not an indexed MOBI book');
    }
    const target = path.join(directory, fileNameFor(book));
    const ready = await existing(target);
    if (ready) return { status: 'ready', path: ready };
    const failure = failures.get(target);
    if (failure && Date.now() - failure.at < limits.failureMemoMs) throw failure.error;

    let job = inflight.get(target);
    if (!job) {
      job = queue.then(() => convert(book, target));
      queue = job.catch(() => {});
      inflight.set(target, job);
      job.then(
        () => { inflight.delete(target); failures.delete(target); },
        (error) => {
          inflight.delete(target);
          if (error?.code !== 'SOURCE_CHANGED') failures.set(target, { at: Date.now(), error });
        }
      );
    }
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
    try {
      const result = await Promise.race([job, timeout]);
      return result ? { status: 'ready', path: result } : { status: 'preparing' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Removes artifacts of books that are gone, changed or built by another
   * converter version, then trims least-recently-used files to the size cap.
   */
  async function prune(books) {
    const wanted = new Set((books || [])
      .filter((book) => book?.type === 'mobi' && !book.error && book.fingerprint)
      .map((book) => fileNameFor(book)));
    const names = await fs.readdir(directory).catch(() => []);
    const kept = [];
    let removed = 0;
    for (const name of names) {
      const file = path.join(directory, name);
      if (name.endsWith('.tmp') && name.startsWith('.')) {
        if (![...inflight.keys()].some((target) => name.startsWith(`.${path.basename(target)}.`))) {
          await fs.rm(file, { force: true });
          removed += 1;
        }
        continue;
      }
      if (!wanted.has(name)) {
        if (NAME_PATTERN.test(name)) {
          await fs.rm(file, { force: true });
          removed += 1;
        }
        continue;
      }
      const stat = await fs.stat(file).catch(() => null);
      if (stat) kept.push({ file, size: stat.size, used: stat.atimeMs });
    }
    let total = kept.reduce((sum, item) => sum + item.size, 0);
    for (const item of kept.sort((a, b) => a.used - b.used)) {
      if (total <= limits.maxCacheBytes) break;
      await fs.rm(item.file, { force: true });
      total -= item.size;
      removed += 1;
    }
    return { removed, bytes: total };
  }

  return { ensure, prune, fileNameFor, directory, stats };
}

module.exports = { createMobiDerivedStore, MOBI_DERIVED_LIMITS: DERIVED_LIMITS };
