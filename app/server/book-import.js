'use strict';

// Browser book import (MOBI/import plan Task 4). Streams one upload into the
// app's own fnOS share, validates it by content (never by extension alone),
// dedupes by SHA-256 and publishes it without overwriting anything. Catalog
// indexing is left to the caller so it can run under the library lock.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const path = require('node:path');
const { extractEpubMetadata, MAX_TEXT_BYTES } = require('./library');
const { decodeBookText } = require('./text-encoding');
const { readMobiMetadata, MobiFormatError } = require('./mobi-format');

const MiB = 1024 * 1024;
const IMPORT_FORMATS = Object.freeze({
  '.epub': { type: 'epub', maxBytes: 64 * MiB },
  '.pdf': { type: 'pdf', maxBytes: 256 * MiB },
  '.txt': { type: 'txt', maxBytes: MAX_TEXT_BYTES },
  '.md': { type: 'markdown', maxBytes: MAX_TEXT_BYTES },
  '.markdown': { type: 'markdown', maxBytes: MAX_TEXT_BYTES },
  '.mobi': { type: 'mobi', maxBytes: 64 * MiB },
  '.azw': { type: 'mobi', maxBytes: 64 * MiB },
  '.azw3': { type: 'mobi', maxBytes: 64 * MiB }
});
const IMPORT_DIRECTORY_NAME = '导入';
const MAX_NAME_BYTES = 200;
const DEFAULT_LIMITS = Object.freeze({ perUser: 1, global: 2 });

class ImportError extends Error {
  constructor(code, statusCode, message, details = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const importError = (code, statusCode, message, details) => new ImportError(code, statusCode, message, details);

/**
 * Turns a client-supplied (URI-encoded) name into a safe single path segment.
 * Returns { name, extension, format } or throws IMPORT_BAD_NAME / IMPORT_UNSUPPORTED.
 */
function sanitizeImportName(encoded) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(encoded || ''));
  } catch {
    throw importError('IMPORT_BAD_NAME', 400, '文件名无效。');
  }
  let name = decoded.split(/[\\/]/).pop()
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const extension = path.extname(name).toLowerCase();
  const format = IMPORT_FORMATS[extension];
  if (!format) throw importError('IMPORT_UNSUPPORTED', 415, '只支持导入 EPUB、PDF、TXT、Markdown、MOBI 和 AZW3。');
  let stem = name.slice(0, name.length - extension.length).trim();
  if (!stem || stem === '.' || stem === '..') throw importError('IMPORT_BAD_NAME', 400, '文件名无效。');
  while (Buffer.byteLength(stem + extension) > MAX_NAME_BYTES) stem = stem.slice(0, -1);
  name = `${stem.trim()}${extension}`;
  return { name, extension, format };
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of nodeFs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function validateContent(filePath, format, size) {
  if (size === 0) throw importError('IMPORT_INVALID_FILE', 422, '文件是空的。');
  if (format.type === 'pdf') {
    const handle = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!/%PDF-[0-9]\.[0-9]/.test(header.subarray(0, bytesRead).toString('latin1'))) {
        throw importError('IMPORT_INVALID_FILE', 422, '这不是有效的 PDF 文件。');
      }
    } finally {
      await handle.close();
    }
    return {};
  }
  if (format.type === 'epub') {
    try {
      extractEpubMetadata(await fs.readFile(filePath));
    } catch {
      throw importError('IMPORT_INVALID_FILE', 422, '这不是有效的 EPUB 文件。');
    }
    return {};
  }
  if (format.type === 'mobi') {
    let metadata;
    try {
      metadata = await readMobiMetadata(filePath);
    } catch (error) {
      if (error instanceof MobiFormatError && error.code === 'TOO_LARGE') {
        throw importError('IMPORT_TOO_LARGE', 413, '文件超过导入大小上限。');
      }
      throw importError('IMPORT_INVALID_FILE', 422, '这不是有效的 MOBI/AZW3 文件。');
    }
    if (metadata.drm) throw importError('IMPORT_DRM', 415, '这本书受 DRM 保护，无法导入。');
    return {};
  }
  // UTF-8, GBK/GB18030, Big5 and UTF-16 are all read; anything else is not text.
  if (!decodeBookText(await fs.readFile(filePath)).encoding) {
    throw importError('IMPORT_INVALID_FILE', 422, '无法识别文本编码（支持 UTF-8、GBK、Big5、UTF-16）。');
  }
  return {};
}

// Publishes the temp file under `name` without ever replacing an existing
// file: link() fails with EEXIST instead of overwriting, then (2), (3)…
async function publishWithoutOverwrite(temporary, directory, name, extension) {
  const stem = name.slice(0, name.length - extension.length);
  for (let attempt = 1; attempt <= 999; attempt += 1) {
    const candidate = path.join(directory, attempt === 1 ? name : `${stem} (${attempt})${extension}`);
    try {
      await fs.link(temporary, candidate);
      await fs.rm(temporary, { force: true });
      return candidate;
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      if (['EPERM', 'ENOTSUP', 'EXDEV', 'EOPNOTSUPP'].includes(error.code)) {
        // Filesystems without hard links: check-then-rename. Callers hold the
        // library lock, so no other import can race for the same name.
        try {
          await fs.access(candidate);
          continue;
        } catch {
          await fs.rename(temporary, candidate);
          return candidate;
        }
      }
      throw error;
    }
  }
  throw importError('IMPORT_NAME_EXHAUSTED', 409, '同名文件过多，请先重命名。');
}

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.resolveTarget absolute, authorized import directory (created if missing)
 * @param {(type: string) => boolean} [deps.isFormatEnabled]
 * @param {(size: number, sha256: string) => Promise<string|null>} [deps.findDuplicate] existing book id
 * @param {(fn: () => Promise<any>) => Promise<any>} [deps.runExclusive] library lock around dedupe/publish/index
 * @param {(result: object) => Promise<object>} [deps.afterPublish] indexes the published file; returns the book
 */
function createBookImporter({
  resolveTarget,
  isFormatEnabled = () => true,
  findDuplicate = async () => null,
  runExclusive = (fn) => fn(),
  afterPublish = null,
  limits = {}
}) {
  const effective = { ...DEFAULT_LIMITS, ...limits };
  const perUser = new Map();
  let active = 0;

  function reserve(userId) {
    if (active >= effective.global || (perUser.get(userId) || 0) >= effective.perUser) {
      throw importError('IMPORT_BUSY', 429, '已有导入正在进行，请稍后再试。');
    }
    active += 1;
    perUser.set(userId, (perUser.get(userId) || 0) + 1);
    return () => {
      active -= 1;
      const next = (perUser.get(userId) || 1) - 1;
      if (next > 0) perUser.set(userId, next);
      else perUser.delete(userId);
    };
  }

  async function receive(stream, temporary, maxBytes, expectedBytes) {
    const hash = crypto.createHash('sha256');
    let received = 0;
    const handle = await fs.open(temporary, 'wx', 0o640);
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (error) => {
          if (settled) return;
          settled = true;
          stream.removeListener('data', onData);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          stream.removeListener('aborted', onAborted);
          stream.removeListener('close', onClose);
          if (error) reject(error);
          else resolve();
        };
        let writing = Promise.resolve();
        const onData = (chunk) => {
          received += chunk.length;
          if (received > maxBytes || received > expectedBytes) {
            stream.pause?.();
            done(importError('IMPORT_TOO_LARGE', 413, '文件超过导入大小上限。'));
            return;
          }
          hash.update(chunk);
          stream.pause?.();
          writing = writing.then(() => handle.write(chunk)).then(() => stream.resume?.(), done);
        };
        const onEnd = () => writing.then(() => done(), done);
        const onError = () => done(importError('IMPORT_ABORTED', 400, '上传中断。'));
        const onAborted = () => done(importError('IMPORT_ABORTED', 400, '上传中断。'));
        const onClose = () => { if (!stream.readableEnded) onAborted(); };
        stream.on('data', onData);
        stream.once('end', onEnd);
        stream.once('error', onError);
        stream.once('aborted', onAborted);
        stream.once('close', onClose);
      });
      if (received !== expectedBytes) throw importError('IMPORT_ABORTED', 400, '上传内容不完整。');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { size: received, sha256: hash.digest('hex') };
  }

  /**
   * @param {import('node:stream').Readable} stream request body
   * @returns {Promise<{path:string, name:string, size:number, sha256:string, type:string}>}
   */
  async function importStream(stream, { userId, encodedName, contentLength }) {
    const { name, extension, format } = sanitizeImportName(encodedName);
    if (!isFormatEnabled(format.type)) {
      throw importError('IMPORT_FORMAT_DISABLED', 409, format.type === 'pdf'
        ? '管理员已关闭 PDF 阅读，暂时无法导入 PDF。'
        : '管理员已关闭 MOBI/AZW3 阅读，暂时无法导入 Kindle 书。');
    }
    const declared = Number(contentLength);
    if (contentLength === undefined || contentLength === null || contentLength === '' || !Number.isSafeInteger(declared) || declared < 0) {
      throw importError('IMPORT_LENGTH_REQUIRED', 411, '缺少文件大小信息。');
    }
    if (declared > format.maxBytes) throw importError('IMPORT_TOO_LARGE', 413, '文件超过导入大小上限。');

    const release = reserve(userId);
    let temporary = null;
    try {
      let directory;
      try {
        directory = await resolveTarget();
      } catch (error) {
        if (error instanceof ImportError) throw error;
        throw importError('IMPORT_NO_TARGET', 503, '导入目录不可用，请检查 fnOS 共享目录权限。');
      }
      temporary = path.join(directory, `.zhenshu-import-${crypto.randomUUID()}.part`);
      const { size, sha256 } = await receive(stream, temporary, format.maxBytes, declared);
      await validateContent(temporary, format, size);
      // Dedupe, publish and catalog under the library lock so scans and other
      // imports never interleave with this book's catalog merge.
      return await runExclusive(async () => {
        const duplicate = await findDuplicate(size, sha256);
        if (duplicate) throw importError('IMPORT_DUPLICATE', 409, '书库中已有这本书。', { bookId: duplicate });
        const published = await publishWithoutOverwrite(temporary, directory, name, extension);
        temporary = null;
        const result = { path: published, name: path.basename(published), size, sha256, type: format.type };
        if (!afterPublish) return result;
        try {
          return { ...result, book: await afterPublish(result) };
        } catch (error) {
          // A file the catalog cannot hold must not linger in the library.
          await fs.rm(published, { force: true }).catch(() => {});
          if (error instanceof ImportError) throw error;
          throw importError('IMPORT_INDEX_FAILED', 422, '文件已接收，但无法加入书库。');
        }
      });
    } finally {
      if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
      release();
    }
  }

  return { importStream };
}

module.exports = {
  IMPORT_DIRECTORY_NAME,
  IMPORT_FORMATS,
  ImportError,
  createBookImporter,
  hashFile,
  sanitizeImportName
};
