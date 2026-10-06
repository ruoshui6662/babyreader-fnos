'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveAuthorizedPath } = require('./security');
const { openZipFile, safeUnzip } = require('./zip');
const { decodeBookText } = require('./text-encoding');
const { MOBI_EXTENSIONS, readMobiMetadata } = require('./mobi-format');

const SUPPORTED_EXTENSIONS = new Set(['.epub', '.md', '.markdown', '.txt', '.pdf']);
const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const MAX_PDF_HEADER_BYTES = 1024;
// Markdown takes its title from front matter or the first heading, both near
// the top; the rest of the file is not needed to list it.
const MARKDOWN_HEAD_BYTES = 256 * 1024;
// Books indexed at once. Most of the work is waiting on the disk (a NAS
// array), so a few reads in flight keep it busy without flooding it.
const SCAN_CONCURRENCY = 6;

async function validatePdfHeader(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(MAX_PDF_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const signature = header.subarray(0, bytesRead).toString('latin1');
    if (!/%PDF-[0-9]\.[0-9]/.test(signature)) throw new Error('Invalid PDF signature');
  } finally {
    await handle.close();
  }
}

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

function sourceRootId(realRoot) {
  return crypto
    .createHash('sha256')
    .update(`zhenshu-source-root\0${path.resolve(realRoot)}`)
    .digest('hex');
}

function sourcePathSegments(relativePath) {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(0, -1).filter((part) => part !== '.' && part !== '..').slice(0, 64);
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

function epubPackagePath(containerBytes) {
  if (!containerBytes) throw new Error('EPUB container.xml is missing');
  const containerXml = new TextDecoder('utf-8', { fatal: false }).decode(containerBytes);
  const rootfile = containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  if (!rootfile) throw new Error('EPUB package path is missing');
  return normalizeZipPath(rootfile[1] ?? rootfile[2]);
}

// Title, author and the like from the package document, and where its cover
// image is inside the archive.
function epubPackageMetadata(opfPath, opfBytes) {
  if (!opfBytes) throw new Error('EPUB package document is missing');
  const opf = new TextDecoder('utf-8', { fatal: false }).decode(opfBytes);
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

  return {
    title: xmlValue(opf, 'dc:title'),
    author: xmlValue(opf, 'dc:creator'),
    language: xmlValue(opf, 'dc:language'),
    publisher: xmlValue(opf, 'dc:publisher'),
    coverPath
  };
}

function epubCover(coverPath, bytes) {
  return coverPath && bytes
    ? { bytes: Buffer.from(bytes), extension: path.extname(coverPath).toLowerCase() || '.bin' }
    : null;
}

function extractEpubMetadata(buffer) {
  const files = safeUnzip(buffer);
  const opfPath = epubPackagePath(files['META-INF/container.xml']);
  const { coverPath, ...metadata } = epubPackageMetadata(opfPath, files[opfPath]);
  return { ...metadata, cover: epubCover(coverPath, coverPath && files[coverPath]) };
}

// The same metadata, read from the file entry by entry: the container, the
// package document and the cover image, nothing else. A scan of a large
// library no longer reads and inflates every page of every book.
async function readEpubMetadata(filePath) {
  const zip = await openZipFile(filePath);
  try {
    const opfPath = epubPackagePath(await zip.read('META-INF/container.xml'));
    const { coverPath, ...metadata } = epubPackageMetadata(opfPath, await zip.read(opfPath));
    return { ...metadata, cover: epubCover(coverPath, coverPath ? await zip.read(coverPath) : null) };
  } finally {
    await zip.close();
  }
}

// NAS housekeeping folders (thumbnails, recycle bins, metadata) never hold
// books, and the app user often may not open them.
const SYSTEM_DIRECTORY = /^(?:[.@#].*|\$RECYCLE\.BIN|System Volume Information|lost\+found)$/i;
const MAX_SKIPPED_REPORTED = 20;

// Kindle files are only parsed when the MOBI switch is on; otherwise they are
// counted by extension so the UI can say how many are hidden, and the scan is
// otherwise identical to a library without them.
//
// One unreadable folder or file is skipped and reported; it no longer drops
// every book in the library folder. Only the folder itself being unreadable
// fails the folder.
//
// Each entry's type comes from the directory listing itself; only an entry
// whose type the file system does not report is looked up separately. The
// folders walked are real paths and links are skipped, so every file found
// is inside the library folder without resolving it again.
async function collectFiles(root, { mobiEnabled = false, onFound = null } = {}) {
  const realRoot = await fs.realpath(root);
  const output = [];
  const skipped = [];
  let skippedCount = 0;
  let hiddenMobiCount = 0;
  const skip = (candidate, error) => {
    skippedCount += 1;
    if (skipped.length < MAX_SKIPPED_REPORTED) {
      skipped.push({ path: path.relative(realRoot, candidate) || '.', code: error?.code ? String(error.code) : null });
    }
  };

  async function walk(directory, isRoot = false) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isRoot) throw error;
      skip(directory, error);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDirectory && !isFile) {
        try {
          const stat = await fs.lstat(candidate);
          if (stat.isSymbolicLink()) continue;
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch (error) {
          skip(candidate, error);
          continue;
        }
      }
      if (isDirectory) {
        if (SYSTEM_DIRECTORY.test(entry.name)) continue;
        await walk(candidate);
      } else if (isFile && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        output.push(candidate);
      } else if (isFile && MOBI_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (mobiEnabled) output.push(candidate);
        else hiddenMobiCount += 1;
      }
    }
    if (onFound) onFound(output.length);
  }

  await walk(realRoot, true);
  return { realRoot, files: output, hiddenMobiCount, skipped, skippedCount };
}

function bookType(extension) {
  if (extension === '.epub') return 'epub';
  if (extension === '.pdf') return 'pdf';
  if (extension === '.txt') return 'txt';
  if (MOBI_EXTENSIONS.has(extension)) return 'mobi';
  return 'markdown';
}

// coverNames, when given, is this book's part of the cover folder's listing,
// taken once for a whole scan (a listing per book made large libraries slow).
async function writeCover(coverDirectory, id, cover, coverNames = null) {
  const oldCovers = coverNames || await fs.readdir(coverDirectory).catch(() => []);
  await Promise.all(oldCovers
    .filter((name) => name.startsWith(id))
    .map((name) => fs.rm(path.join(coverDirectory, name), { force: true })));
  if (!cover) return null;
  const safeExtension = cover.extension.replace(/[^.a-z0-9]/gi, '') || '.bin';
  await fs.writeFile(path.join(coverDirectory, `${id}${safeExtension}`), cover.bytes, { mode: 0o600 });
  return `/app/zhenshu/api/books/${id}/cover`;
}

async function readHead(filePath, length) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Runs task(item, index) over items with at most `limit` at a time.
async function forEachLimited(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Indexes one authorized file. Shared by full scans and single-book imports so
// both produce identical catalog entries.
// Returns { kind: 'reused'|'indexed'|'error', book } or { kind: 'drm', relativePath }.
async function indexBookFile({ filePath, realRoot, validRoots, coverDirectory = null, previousById = new Map(), coverNames = null }) {
  const relativePath = path.relative(realRoot, filePath).split(path.sep).join('/');
  const safeSourceRootId = sourceRootId(realRoot);
  const safeSourcePathSegments = sourcePathSegments(relativePath);
  let id = hashBook(filePath);
  try {
    const safePath = await resolveAuthorizedPath(filePath, validRoots);
    const stat = await fs.stat(safePath);
    const extension = path.extname(safePath).toLowerCase();
    id = hashBook(safePath);
    const fingerprint = fingerprintBook(safePath, stat);
    const previous = previousById.get(id);

    if (previous && !previous.error && previous.fingerprint === fingerprint) {
      return {
        kind: 'reused',
        book: {
          ...previous,
          root: realRoot,
          path: safePath,
          relativePath,
          sourceRootId: safeSourceRootId,
          sourcePathSegments: safeSourcePathSegments,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        }
      };
    }

    let metadata;
    let coverUrl = null;
    if (extension === '.pdf') {
      // PDF discovery is intentionally metadata-only. Do not feed potentially
      // large binary documents into the generic UTF-8 metadata path.
      await validatePdfHeader(safePath);
      metadata = { title: path.basename(safePath, extension), author: '' };
    } else if (extension === '.epub') {
      metadata = await readEpubMetadata(safePath);
      if (coverDirectory) coverUrl = await writeCover(coverDirectory, id, metadata.cover, coverNames ? coverNames.get(id) || [] : null);
    } else if (MOBI_EXTENSIONS.has(extension)) {
      // Metadata only: the PDB table, record 0 and the cover record.
      metadata = await readMobiMetadata(safePath);
      // DRM is an expected state for Kindle users, not a scan failure:
      // counting it as an error would mark the whole library unhealthy
      // and block category editing and index cleanup.
      if (metadata.drm) return { kind: 'drm', relativePath };
      if (coverDirectory) coverUrl = await writeCover(coverDirectory, id, metadata.cover, coverNames ? coverNames.get(id) || [] : null);
    } else {
      if (stat.size > MAX_TEXT_BYTES) throw new Error('Text document exceeds size limit');
      // A TXT book is listed under its file name, so its text is not read
      // here at all; Markdown needs only its first part.
      metadata = extension === '.txt'
        ? extractTextMetadata(safePath, '')
        : extractTextMetadata(safePath, decodeBookText(await readHead(safePath, MARKDOWN_HEAD_BYTES)).text);
    }

    return {
      kind: 'indexed',
      book: {
        id,
        fingerprint,
        type: bookType(extension),
        ...(metadata.format ? { sourceFormat: metadata.format } : {}),
        title: metadata.title || path.basename(safePath, extension),
        author: metadata.author || '',
        language: metadata.language || '',
        publisher: metadata.publisher || '',
        relativePath,
        sourceRootId: safeSourceRootId,
        sourcePathSegments: safeSourcePathSegments,
        root: realRoot,
        path: safePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        coverUrl
      }
    };
  } catch (error) {
    return {
      kind: 'error',
      book: {
        id,
        relativePath,
        sourceRootId: safeSourceRootId,
        sourcePathSegments: safeSourcePathSegments,
        root: realRoot,
        path: filePath,
        error: String(error.message || error)
      }
    };
  }
}

async function scanLibrary(authorizedRoots, options = {}) {
  const coverDirectory = options.coverDirectory ? path.resolve(options.coverDirectory) : null;
  const previousBooks = Array.isArray(options.previousIndex?.books) ? options.previousIndex.books : [];
  const previousById = new Map(previousBooks.filter((book) => book?.id).map((book) => [book.id, book]));
  const mobiEnabled = options.mobiEnabled === true;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  if (coverDirectory) await fs.mkdir(coverDirectory, { recursive: true, mode: 0o700 });
  // The cover folder's listing, by book: taken once for the whole scan.
  const coverNames = coverDirectory ? new Map() : null;
  if (coverDirectory) {
    for (const name of await fs.readdir(coverDirectory).catch(() => [])) {
      const id = name.slice(0, 64);
      if (!coverNames.has(id)) coverNames.set(id, []);
      coverNames.get(id).push(name);
    }
  }

  const books = [];
  const rootErrors = [];
  const validRoots = [];
  let discoveredCount = 0;
  let reusedCount = 0;
  let indexedCount = 0;
  let hiddenMobiCount = 0;
  let skippedCount = 0;
  const drmProtected = [];
  // Per library folder: where it is, how many books it holds, what it skipped.
  const roots = [];

  for (const configuredRoot of authorizedRoots) {
    try {
      validRoots.push(await fs.realpath(configuredRoot));
    } catch (error) {
      rootErrors.push({ root: String(configuredRoot), error: String(error.message || error) });
    }
  }

  // Progress, for the scan indicator: first the folders are walked to find
  // the books (the total is not known yet), then each book is read.
  const progress = { phase: 'discovering', discovered: 0, processed: 0, total: 0, indexed: 0, reused: 0, errors: 0 };
  const report = () => { if (onProgress) onProgress({ ...progress }); };
  report();

  const found = [];
  for (const configuredRoot of validRoots) {
    let discovered;
    try {
      const root = await resolveAuthorizedPath(configuredRoot, validRoots, { allowDirectory: true });
      const before = progress.discovered;
      discovered = await collectFiles(root, {
        mobiEnabled,
        onFound: (count) => { progress.discovered = before + count; report(); }
      });
    } catch (error) {
      rootErrors.push({ root: String(configuredRoot), error: String(error.message || error) });
      continue;
    }

    discoveredCount += discovered.files.length;
    progress.discovered = discoveredCount;
    hiddenMobiCount += discovered.hiddenMobiCount;
    skippedCount += discovered.skippedCount;
    const rootSummary = {
      root: discovered.realRoot,
      bookCount: 0,
      skippedCount: discovered.skippedCount,
      skipped: discovered.skipped
    };
    roots.push(rootSummary);
    for (const filePath of discovered.files) found.push({ filePath, realRoot: discovered.realRoot, rootSummary });
  }

  progress.phase = 'indexing';
  progress.total = found.length;
  report();
  // Several books at once; each result goes back to its own slot, so the
  // catalog does not depend on which read finished first.
  const outcomes = new Array(found.length);
  await forEachLimited(found, SCAN_CONCURRENCY, async ({ filePath, realRoot }, index) => {
    const outcome = await indexBookFile({
      filePath, realRoot, validRoots, coverDirectory, previousById, coverNames
    });
    outcomes[index] = outcome;
    progress.processed += 1;
    if (outcome.kind === 'reused') progress.reused += 1;
    else if (outcome.kind === 'indexed') progress.indexed += 1;
    else if (outcome.kind === 'error') progress.errors += 1;
    report();
  });
  found.forEach(({ rootSummary }, index) => {
    const outcome = outcomes[index];
    if (outcome.kind === 'drm') {
      drmProtected.push({ relativePath: outcome.relativePath });
      return;
    }
    books.push(outcome.book);
    if (!outcome.book?.error) rootSummary.bookCount += 1;
    if (outcome.kind === 'reused') reusedCount += 1;
    if (outcome.kind === 'indexed') indexedCount += 1;
  });
  progress.phase = 'finishing';
  report();

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
      rootErrors,
      roots,
      skippedCount,
      ...(hiddenMobiCount || mobiEnabled ? { hiddenMobiCount } : {}),
      ...(drmProtected.length ? { drmProtectedCount: drmProtected.length, drmProtected: drmProtected.slice(0, 50) } : {})
    }
  };
}

module.exports = {
  MAX_TEXT_BYTES,
  MAX_PDF_HEADER_BYTES,
  SUPPORTED_EXTENSIONS,
  extractEpubMetadata,
  extractTextMetadata,
  readEpubMetadata,
  fingerprintBook,
  indexBookFile,
  sourcePathSegments,
  sourceRootId,
  scanLibrary
};
