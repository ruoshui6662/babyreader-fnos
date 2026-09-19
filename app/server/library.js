'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveAuthorizedPath, isPathInside } = require('./security');
const { safeUnzip } = require('./zip');

const SUPPORTED_EXTENSIONS = new Set(['.epub', '.md', '.markdown', '.txt']);
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeXml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripTags(match[1]) : '';
}

function normalizeZipPath(value) {
  const parts = [];
  for (const part of String(value || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('EPUB path escapes archive root');
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function resolveZipPath(base, href) {
  const clean = decodeURIComponent(String(href || '').split(/[?#]/, 1)[0]);
  return normalizeZipPath(`${base}${clean}`);
}

function getAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeXml(match[1] ?? match[2] ?? '') : '';
}

function hashBook(realPath) {
  return crypto
    .createHash('sha256')
    .update(path.resolve(realPath))
    .digest('hex');
}

function fingerprintBook(realPath, stat) {
  return crypto
    .createHash('sha256')
    .update(`${path.resolve(realPath)}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}`)
    .digest('hex');
}

function extractTextMetadata(fileName, content) {
  const extension = path.extname(fileName).toLowerCase();
  const fallback = path.basename(fileName, extension);
  if (extension !== '.md' && extension !== '.markdown') {
    return { title: fallback, author: '' };
  }

  const frontMatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  const heading = content.match(/^#\s+(.+)$/m);
  let title = heading ? heading[1].trim() : fallback;
  let author = '';

  if (frontMatter) {
    for (const line of frontMatter[1].split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key === 'title' && value) title = value;
      if ((key === 'author' || key === 'creator') && value) author = value;
    }
  }

  return { title: title.slice(0, 500), author: author.slice(0, 500) };
}

function extractEpubMetadata(buffer) {
  const files = safeUnzip(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const container = files['META-INF/container.xml'];
  if (!container) throw new Error('EPUB container.xml is missing');

  const containerXml = decoder.decode(container);
  const rootfile = containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  if (!rootfile) throw new Error('EPUB package path is missing');

  const opfPath = normalizeZipPath(rootfile[1] ?? rootfile[2]);
  const opfBytes = files[opfPath];
  if (!opfBytes) throw new Error('EPUB package document is missing');

  const opf = decoder.decode(opfBytes);
  const opfDirectory = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  let coverPath = '';

  const coverId = (opf.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1];
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = getAttribute(tag, 'id');
    const href = getAttribute(tag, 'href');
    const properties = getAttribute(tag, 'properties');
    const mediaType = getAttribute(tag, 'media-type');
    if (!href) continue;
    if (id === coverId || /\bcover-image\b/i.test(properties)) {
      coverPath = resolveZipPath(opfDirectory, href);
      if (/^image\//i.test(mediaType)) break;
    }
  }

  const cover = coverPath && files[coverPath]
    ? { bytes: Buffer.from(files[coverPath]), extension: path.extname(coverPath).toLowerCase() || '.bin' }
    : null;

  return {
    title: xmlValue(opf, 'dc:title'),
    author: xmlValue(opf, 'dc:creator'),
    language: xmlValue(opf, 'dc:language'),
    publisher: xmlValue(opf, 'dc:publisher'),
    cover
  };
}

async function collectFiles(root) {
  const realRoot = await fs.realpath(root);
  const output = [];

  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) continue;

      const realCandidate = await fs.realpath(candidate);
      if (!isPathInside(realRoot, realCandidate)) continue;
      if (stat.isDirectory()) {
        await walk(realCandidate);
      } else if (stat.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        output.push(realCandidate);
      }
    }
  }

  await walk(realRoot);
  return { realRoot, files: output };
}

async function scanLibrary(authorizedRoots, options = {}) {
  const coverDirectory = options.coverDirectory ? path.resolve(options.coverDirectory) : null;
  const previousBooks = Array.isArray(options.previousIndex?.books) ? options.previousIndex.books : [];
  const previousById = new Map(previousBooks.filter((book) => book?.id).map((book) => [book.id, book]));
  if (coverDirectory) await fs.mkdir(coverDirectory, { recursive: true, mode: 0o700 });

  const books = [];
  const rootErrors = [];
  const validRoots = [];
  let discoveredCount = 0;
  let reusedCount = 0;
  let indexedCount = 0;

  for (const configuredRoot of authorizedRoots) {
    try {
      validRoots.push(await fs.realpath(configuredRoot));
    } catch (error) {
      rootErrors.push({ root: String(configuredRoot), error: String(error.message || error) });
    }
  }

  for (const configuredRoot of validRoots) {
    let discovered;
    try {
      const root = await resolveAuthorizedPath(configuredRoot, validRoots, { allowDirectory: true });
      discovered = await collectFiles(root);
    } catch (error) {
      rootErrors.push({ root: String(configuredRoot), error: String(error.message || error) });
      continue;
    }

    discoveredCount += discovered.files.length;
    for (const filePath of discovered.files) {
      const relativePath = path.relative(discovered.realRoot, filePath).split(path.sep).join('/');
      let id = hashBook(filePath);
      try {
        const safePath = await resolveAuthorizedPath(filePath, validRoots);
        const stat = await fs.stat(safePath);
        const extension = path.extname(safePath).toLowerCase();
        id = hashBook(safePath);
        const fingerprint = fingerprintBook(safePath, stat);
        const previous = previousById.get(id);

        if (previous && !previous.error && previous.fingerprint === fingerprint) {
          books.push({
            ...previous,
            root: discovered.realRoot,
            path: safePath,
            relativePath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          });
          reusedCount += 1;
          continue;
        }

        let metadata;
        let coverUrl = null;
        if (extension === '.epub') {
          const bytes = await fs.readFile(safePath);
          metadata = extractEpubMetadata(bytes);
          if (coverDirectory) {
            const oldCovers = await fs.readdir(coverDirectory).catch(() => []);
            await Promise.all(oldCovers
              .filter((name) => name.startsWith(id))
              .map((name) => fs.rm(path.join(coverDirectory, name), { force: true })));
            if (metadata.cover) {
              const safeExtension = metadata.cover.extension.replace(/[^.a-z0-9]/gi, '') || '.bin';
              const coverName = `${id}${safeExtension}`;
              await fs.writeFile(path.join(coverDirectory, coverName), metadata.cover.bytes, { mode: 0o600 });
              coverUrl = `/app/babyreader-fnos/api/books/${id}/cover`;
            }
          }
        } else {
          if (stat.size > MAX_TEXT_BYTES) throw new Error('Text document exceeds size limit');
          metadata = extractTextMetadata(safePath, await fs.readFile(safePath, 'utf8'));
        }

        books.push({
          id,
          fingerprint,
          type: extension === '.epub' ? 'epub' : extension === '.txt' ? 'txt' : 'markdown',
          title: metadata.title || path.basename(safePath, extension),
          author: metadata.author || '',
          language: metadata.language || '',
          publisher: metadata.publisher || '',
          relativePath,
          root: discovered.realRoot,
          path: safePath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          coverUrl
        });
        indexedCount += 1;
      } catch (error) {
        books.push({ id, relativePath, root: discovered.realRoot, path: filePath, error: String(error.message || error) });
      }
    }
  }

  books.sort((left, right) => String(left.title || left.relativePath).localeCompare(String(right.title || right.relativePath), 'zh-CN'));
  const activeIds = new Set(books.filter((book) => book.id && !book.error).map((book) => book.id));
  if (coverDirectory) {
    const cachedCovers = await fs.readdir(coverDirectory).catch(() => []);
    await Promise.all(cachedCovers
      .filter((name) => /^[a-f0-9]{64}/.test(name) && !activeIds.has(name.slice(0, 64)))
      .map((name) => fs.rm(path.join(coverDirectory, name), { force: true })));
  }

  const errorCount = books.filter((book) => book.error).length + rootErrors.length;
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    books,
    scan: {
      status: errorCount ? 'completed-with-errors' : 'completed',
      discoveredCount,
      indexedCount,
      reusedCount,
      errorCount,
      rootErrors
    }
  };
}

module.exports = {
  MAX_TEXT_BYTES,
  SUPPORTED_EXTENSIONS,
  extractEpubMetadata,
  extractTextMetadata,
  scanLibrary
};
