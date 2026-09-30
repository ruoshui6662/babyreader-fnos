'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { safeUnzip } = require('./zip');
const { normalizeBookText } = require('./ai-book-context');
const { PDF_TEXT_LIMITS, PDF_TEXT_PARSER_VERSION, extractPdfText } = require('./pdf-text');
const { AI_EPUB_PARSER_VERSION, parseEpubStructure, resolveLogicalChapter } = require('./ai-epub-structure');
const { rankLexicalCandidates, fuseRankedMatches, assessRetrievalConfidence } = require('./ai-retrieval');
const { createAiIndexManager } = require('./ai-index-manager');
const {
  SUMMARY_STRATEGY_VERSION,
  SUMMARY_PROMPT_VERSION,
  buildAiSummaryCacheKey,
  buildAiSummaryModelKey,
  hashAiSummaryUserId,
  createAiSummaryCache
} = require('./ai-summary-cache');

const AI_FTS_SCHEMA_VERSION = 7;
const AI_FTS_CHUNK_SIZE = 900;
const AI_FTS_CHUNK_OVERLAP = 120;
const AI_FTS_MAX_RESULTS = 6;
const AI_FTS_MAX_QUERY_TERMS = 48;
const AI_FTS_MIN_DIVERSE_DISTANCE = AI_FTS_CHUNK_SIZE;
const AI_SUMMARY_CACHE_MAX_ROWS = 200;

let DatabaseSync = null;
let sqliteCapabilityChecked = false;
const indexManagers = new Map();
const summaryCaches = new Map();

function getDatabaseSync() {
  if (!sqliteCapabilityChecked) {
    sqliteCapabilityChecked = true;
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      DatabaseSync = null;
    }
  }
  return DatabaseSync;
}

function getIndexManager(dataRoot) {
  const key = path.resolve(dataRoot);
  let manager = indexManagers.get(key);
  if (!manager) {
    manager = createAiIndexManager({ dataRoot, schemaVersion: AI_FTS_SCHEMA_VERSION });
    indexManagers.set(key, manager);
  }
  return manager;
}

function getSummaryCache(dataRoot) {
  const key = path.resolve(dataRoot);
  let cache = summaryCaches.get(key);
  if (!cache) {
    cache = createAiSummaryCache();
    summaryCaches.set(key, cache);
  }
  return cache;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractChapter(html, fallbackLabel) {
  const source = String(html || '');
  const headings = [...source.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((match) => normalizeBookText(decodeEntities(match[1])))
    .filter(Boolean)
    .slice(0, 24);
  return {
    text: normalizeBookText(source),
    headings,
    label: headings[0] || fallbackLabel
  };
}

async function readBookChapters(book, { signal } = {}) {
  if (book.type === 'pdf') {
    const extracted = await extractPdfText(book, { signal });
    return {
      chapters: extracted.pages.map(({ pageIndex, text }) => ({
        index: pageIndex,
        href: '',
        label: `第${pageIndex + 1}页`,
        headings: [],
        text
      })),
      structure: null,
      parserVersion: extracted.parserVersion,
      searchStatus: extracted.status
    };
  }
  const bytes = await fs.readFile(book.path);
  if (book.type !== 'epub') {
    return { chapters: [{
      index: 0,
      href: '',
      label: book.title || '当前书本',
      headings: [],
      text: normalizeBookText(bytes.toString('utf8'))
    }], structure: null };
  }

  const files = safeUnzip(bytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const structure = parseEpubStructure(files);
  const chapters = [];
  for (const item of structure.spine) {
    const { index, href } = item;
    const html = files[href] ? decoder.decode(files[href]) : '';
    const chapter = extractChapter(html, `第${index + 1}章`);
    if (chapter.text) chapters.push({ index, href, ...chapter });
  }
  return { chapters, structure };
}

function* buildPdfIndexChunks(pages) {
  const chunkSize = AI_FTS_CHUNK_SIZE;
  const step = AI_FTS_CHUNK_SIZE - AI_FTS_CHUNK_OVERLAP;
  for (const page of pages) {
    const text = String(page.text || '');
    for (let start = 0; start < text.length; start += step) {
      let end = Math.min(text.length, start + chunkSize);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] || '')
          && /[\uDC00-\uDFFF]/.test(text[end] || '')) end -= 1;
      const chunkText = text.slice(start, end);
      if (chunkText.trim()) {
        yield {
          text: chunkText,
          title: '',
          headings: [],
          chapterIndex: page.index,
          chapterHref: '',
          chapterLabel: page.label,
          logicalChapterId: '',
          logicalSectionId: '',
          start
        };
      }
      if (end >= text.length) break;
    }
  }
}

function expectedParserVersion(book) {
  if (book?.type === 'epub') return String(AI_EPUB_PARSER_VERSION);
  if (book?.type === 'pdf') return PDF_TEXT_PARSER_VERSION;
  return 'none';
}

function aiTerms(value) {
  const text = normalizeBookText(value).toLocaleLowerCase();
  const terms = new Set(text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2}/gi) || []);
  for (const phrase of text.match(/[\u3400-\u9fff]{1,}/g) || []) {
    const chars = Array.from(phrase);
    for (let index = 0; index < chars.length - 1; index += 1) terms.add(chars[index] + chars[index + 1]);
  }
  return [...terms];
}

function toFtsDocument(value) {
  return aiTerms(value).join(' ');
}

function toFtsQuery(value) {
  return aiTerms(value)
    .slice(0, AI_FTS_MAX_QUERY_TERMS)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function chunkChapter(chapter) {
  const chars = Array.from(normalizeBookText(chapter.text));
  const chunks = [];
  const step = Math.max(1, AI_FTS_CHUNK_SIZE - AI_FTS_CHUNK_OVERLAP);
  for (let start = 0; start < chars.length; start += step) {
    const text = chars.slice(start, start + AI_FTS_CHUNK_SIZE).join('').trim();
    if (text) {
      chunks.push({
        text,
        title: chapter.label,
        headings: chapter.headings,
        chapterIndex: chapter.index,
        chapterHref: chapter.href,
        chapterLabel: chapter.label,
        logicalChapterId: chapter.logicalChapterId || '',
        logicalSectionId: chapter.logicalSectionId || '',
        start
      });
    }
    if (start + AI_FTS_CHUNK_SIZE >= chars.length) break;
  }
  return chunks;
}

function codePointOffset(value, utf16Offset) {
  return Array.from(String(value || '').slice(0, utf16Offset)).length;
}

function* buildEpubIndexChunks(spineItems, structure) {
  const nodes = Array.isArray(structure?.chapters) ? structure.chapters : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const startsBySpine = new Map();
  const endsBySpine = new Map();
  for (const node of nodes) {
    const starts = startsBySpine.get(node.start.spineIndex) || [];
    starts.push(node);
    startsBySpine.set(node.start.spineIndex, starts);
    const ends = endsBySpine.get(node.end.spineIndex) || [];
    ends.push(node);
    endsBySpine.set(node.end.spineIndex, ends);
  }
  const activeNodes = new Map();
  for (const source of spineItems) {
    const text = normalizeBookText(source.text);
    const anchors = structure?.anchors?.[source.href] || { headings: [] };
    const boundaries = new Set([0, text.length]);
    const startsAt = new Map();
    const endsAt = new Map();
    for (const node of startsBySpine.get(source.index) || []) {
      if (node.start.offset < 0 || node.start.offset > text.length) continue;
      boundaries.add(node.start.offset);
      const list = startsAt.get(node.start.offset) || [];
      list.push(node);
      startsAt.set(node.start.offset, list);
    }
    for (const node of endsBySpine.get(source.index) || []) {
      if (!Number.isInteger(node.end.offset) || node.end.offset < 0 || node.end.offset > text.length) continue;
      boundaries.add(node.end.offset);
      const list = endsAt.get(node.end.offset) || [];
      list.push(node);
      endsAt.set(node.end.offset, list);
    }
    const headingsAt = new Map();
    for (const heading of anchors.headings || []) {
      if (!Number.isInteger(heading.offset) || heading.offset < 0 || heading.offset >= text.length) continue;
      boundaries.add(heading.offset);
      const list = headingsAt.get(heading.offset) || [];
      list.push(heading.label);
      headingsAt.set(heading.offset, list);
    }
    const orderedBoundaries = [...boundaries]
      .filter((offset) => Number.isInteger(offset) && offset >= 0 && offset <= text.length)
      .sort((left, right) => left - right);
    for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
      const startOffset = orderedBoundaries[index];
      const endOffset = orderedBoundaries[index + 1];
      if (endOffset <= startOffset) continue;
      for (const node of endsAt.get(startOffset) || []) activeNodes.delete(node.id);
      for (const node of startsAt.get(startOffset) || []) activeNodes.set(node.id, node);
      const covering = [...activeNodes.values()];
      const depth = covering.length ? Math.max(...covering.map((node) => Number(node.depth) || 0)) : -1;
      const selected = covering.filter((node) => (Number(node.depth) || 0) === depth);
      const logical = selected.length === 1 ? selected[0] : null;
      let root = logical;
      while (root?.parentId && nodeById.has(root.parentId)) root = nodeById.get(root.parentId);
      const segmentHeadings = headingsAt.get(startOffset) || [];
      const segmentText = text.slice(startOffset, endOffset);
      const chunks = chunkChapter({
        ...source,
        label: root?.label || source.label,
        headings: segmentHeadings,
        text: segmentText,
        logicalChapterId: root?.id || '',
        logicalSectionId: logical?.depth > 0 ? logical.id : ''
      });
      const baseOffset = codePointOffset(text, startOffset);
      for (const chunk of chunks) {
        chunk.start += baseOffset;
        yield chunk;
      }
    }
  }
}

function indexPath(dataRoot, bookId) {
  return path.join(path.resolve(dataRoot), 'ai-index', `${bookId}.sqlite`);
}

function currentFingerprint(book, stat) {
  return `${path.resolve(book.path)}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}`;
}

function openDatabase(filePath, options = {}) {
  const Constructor = getDatabaseSync();
  if (!Constructor) return null;
  const db = new Constructor(filePath, { timeout: 5000, ...options });
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

async function secureIndexPermissions(filePath) {
  await fs.chmod(path.dirname(filePath), 0o700);
  await fs.chmod(filePath, 0o600);
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE IF NOT EXISTS ai_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_chunk_text (
      rowid INTEGER PRIMARY KEY,
      bodyText TEXT NOT NULL,
      titleText TEXT NOT NULL,
      headingsText TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS ai_chunks USING fts5(
      title,
      headings,
      body,
      chapterIndex UNINDEXED,
      chapterHref UNINDEXED,
      chapterLabel UNINDEXED,
      startOffset UNINDEXED,
      logicalChapterId UNINDEXED,
      logicalSectionId UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS ai_epub_structure (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      parserVersion TEXT NOT NULL,
      structureJson TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_chapter_summary_cache (
      cacheKey TEXT PRIMARY KEY,
      cacheKind TEXT NOT NULL,
      logicalChapterId TEXT NOT NULL,
      userKey TEXT NOT NULL,
      bookFingerprint TEXT NOT NULL,
      parserVersion TEXT NOT NULL,
      modelKey TEXT NOT NULL,
      summaryJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
}

function writeMeta(db, values) {
  const statement = db.prepare('INSERT OR REPLACE INTO ai_meta(key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(values)) statement.run(key, String(value));
}

async function readIndexMeta(filePath) {
  if (!getDatabaseSync()) return null;
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return null;
  let db;
  try {
    db = openDatabase(filePath, { readOnly: true });
    if (!db) return null;
    const rows = db.prepare('SELECT key, value FROM ai_meta').all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function readIndexSummaryCache(filePath) {
  if (!getDatabaseSync()) return [];
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    return [];
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return [];
  let db;
  try {
    db = openDatabase(filePath, { readOnly: true });
    return db.prepare(`
      SELECT cacheKey, cacheKind, logicalChapterId, userKey, bookFingerprint, parserVersion, modelKey, summaryJson, createdAt FROM ai_chapter_summary_cache
      ORDER BY createdAt DESC LIMIT ?
    `).all(AI_SUMMARY_CACHE_MAX_ROWS).filter((row) => (
      /^[a-f0-9]{64}$/.test(String(row.cacheKey || ''))
      && row.cacheKind === 'map-segment'
      && typeof row.logicalChapterId === 'string'
      && typeof row.userKey === 'string'
      && typeof row.bookFingerprint === 'string'
      && typeof row.parserVersion === 'string'
      && /^[a-f0-9]{64}$/.test(String(row.modelKey || ''))
      && typeof row.summaryJson === 'string'
      && row.summaryJson.length <= 20000
      && typeof row.createdAt === 'string'
      && row.createdAt.length <= 40
    ));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

async function buildIndex(book, dataRoot, filePath, fingerprint, manager, { signal } = {}) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let db;
  try {
    const priorSummaryCache = await readIndexSummaryCache(filePath);
    const { chapters, structure, parserVersion, searchStatus } = await readBookChapters(book, { signal });
    db = openDatabase(temporaryPath);
    if (!db) return false;
    createSchema(db);
    writeMeta(db, {
      schemaVersion: AI_FTS_SCHEMA_VERSION,
      bookId: book.id,
      fingerprint,
      parserVersion: parserVersion || (structure ? String(AI_EPUB_PARSER_VERSION) : 'none'),
      ...(book.type === 'pdf' ? { pdfSearchStatus: searchStatus || 'ready' } : {})
    });
    if (structure) {
      db.prepare('INSERT OR REPLACE INTO ai_epub_structure(id, parserVersion, structureJson) VALUES (1, ?, ?)')
        .run(String(AI_EPUB_PARSER_VERSION), JSON.stringify(structure));
    }
    const insert = db.prepare(`
      INSERT INTO ai_chunks(title, headings, body, chapterIndex, chapterHref, chapterLabel, startOffset, logicalChapterId, logicalSectionId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertText = db.prepare(`
      INSERT INTO ai_chunk_text(rowid, bodyText, titleText, headingsText)
      VALUES (?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    try {
      const insertSummaryCache = db.prepare(`
        INSERT OR REPLACE INTO ai_chapter_summary_cache(
          cacheKey, cacheKind, logicalChapterId, userKey, bookFingerprint, parserVersion, modelKey, summaryJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of priorSummaryCache) {
        insertSummaryCache.run(
          row.cacheKey, row.cacheKind, row.logicalChapterId, row.userKey,
          row.bookFingerprint, row.parserVersion, row.modelKey, row.summaryJson, row.createdAt
        );
      }
      const chunks = structure
        ? buildEpubIndexChunks(chapters, structure)
        : book.type === 'pdf'
          ? buildPdfIndexChunks(chapters)
          : chapters.flatMap((chapter) => chunkChapter(chapter));
      const pdfIndexStartedAt = book.type === 'pdf' ? Date.now() : 0;
      let pdfIndexRows = 0;
      for (const chunk of chunks) {
        if (book.type === 'pdf') {
          pdfIndexRows += 1;
          if (signal?.aborted) throw Object.assign(new Error('PDF index build was cancelled'), { code: 'PDF_EXTRACTION_ABORTED' });
          if (pdfIndexRows > PDF_TEXT_LIMITS.maxIndexRows
              || Date.now() - pdfIndexStartedAt > PDF_TEXT_LIMITS.maxIndexDurationMs) {
            throw Object.assign(new Error('PDF index build exceeded its resource limit'), { code: 'PDF_EXTRACTION_BUDGET' });
          }
        }
        const inserted = insert.run(
          toFtsDocument(chunk.title),
          toFtsDocument(chunk.headings.join(' ')),
          toFtsDocument(chunk.text),
          chunk.chapterIndex,
          chunk.chapterHref,
          chunk.chapterLabel,
          chunk.start,
          chunk.logicalChapterId,
          chunk.logicalSectionId
        );
        insertText.run(
          Number(inserted.lastInsertRowid),
          chunk.text,
          chunk.title,
          chunk.headings.join('\n')
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.close();
    db = null;
    await fs.chmod(temporaryPath, 0o600);
    await manager.publishIndex(temporaryPath, filePath);
    await secureIndexPermissions(filePath);
    return true;
  } finally {
    db?.close();
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function ensureIndex(book, dataRoot, { signal } = {}) {
  if (!book?.id || !book?.path || !getDatabaseSync()) return null;
  const stat = await fs.stat(book.path);
  const fingerprint = currentFingerprint(book, stat);
  const filePath = indexPath(dataRoot, book.id);
  const manager = getIndexManager(dataRoot);
  return manager.withBuildLease(book.id, async () => {
    const metadata = await readIndexMeta(filePath);
    if (metadata?.schemaVersion === String(AI_FTS_SCHEMA_VERSION)
      && metadata.bookId === book.id
      && metadata.fingerprint === fingerprint
      && metadata.parserVersion === expectedParserVersion(book)) {
      await secureIndexPermissions(filePath);
      await manager.recordAccess(book.id).catch(() => {});
      return filePath;
    }

    const built = await buildIndex(book, dataRoot, filePath, fingerprint, manager, { signal });
    if (!built) return null;
    await manager.recordBuildSuccess(book, {
      filePath,
      fingerprint,
      schemaVersion: AI_FTS_SCHEMA_VERSION
    }).catch(() => {});
    return filePath;
  });
}

async function resolveBookPosition(book, dataRoot, locator) {
  if (book?.type !== 'epub' || !locator || !getDatabaseSync()) {
    return { status: 'unresolved', reason: 'position_unavailable' };
  }
  try {
    const filePath = await ensureIndex(book, dataRoot);
    if (!filePath) return { status: 'unresolved', reason: 'index_unavailable' };
    const manager = getIndexManager(dataRoot);
    return manager.withReadLease(book.id, async () => {
      let db;
      try {
        db = openDatabase(filePath, { readOnly: true });
        const row = db.prepare('SELECT parserVersion, structureJson FROM ai_epub_structure WHERE id = 1').get();
        if (!row || row.parserVersion !== String(AI_EPUB_PARSER_VERSION)) {
          return { status: 'unresolved', reason: 'structure_unavailable' };
        }
        const structure = JSON.parse(row.structureJson);
        return resolveLogicalChapter(structure, locator);
      } catch {
        return { status: 'unresolved', reason: 'structure_unavailable' };
      } finally {
        db?.close();
      }
    });
  } catch {
    return { status: 'unresolved', reason: 'index_unavailable' };
  }
}

async function readChapterEvidence(book, dataRoot, logicalChapterId) {
  if (book?.type !== 'epub' || typeof logicalChapterId !== 'string' || !logicalChapterId || logicalChapterId.length > 256) {
    return { available: false, chunks: [] };
  }
  try {
    const filePath = await ensureIndex(book, dataRoot);
    if (!filePath) return { available: false, chunks: [] };
    const manager = getIndexManager(dataRoot);
    return manager.withReadLease(book.id, async () => {
      let db;
      try {
        db = openDatabase(filePath, { readOnly: true });
        const meta = Object.fromEntries(db.prepare('SELECT key, value FROM ai_meta').all().map((row) => [row.key, row.value]));
        const rows = db.prepare(`
          SELECT ai_chunks.chapterIndex, ai_chunks.chapterHref, ai_chunks.chapterLabel,
            ai_chunks.logicalSectionId, ai_chunks.startOffset,
            ai_chunk_text.bodyText, ai_chunk_text.titleText, ai_chunk_text.headingsText
          FROM ai_chunks
          INNER JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
          WHERE ai_chunks.logicalChapterId = ?
          ORDER BY CAST(ai_chunks.chapterIndex AS INTEGER), CAST(ai_chunks.startOffset AS INTEGER), ai_chunks.rowid
          LIMIT 129
        `).all(logicalChapterId);
        if (rows.length > 128) return { available: true, chunks: [], truncated: true };
        return {
          available: true,
          truncated: false,
          bookFingerprint: meta.fingerprint || '',
          parserVersion: meta.parserVersion || '',
          chunks: rows.map((row) => ({
            text: decodeIndexedText(row.bodyText),
            title: decodeIndexedText(row.titleText),
            headings: decodeIndexedText(row.headingsText).split('\n').filter(Boolean),
            chapterIndex: Number(row.chapterIndex),
            chapterHref: String(row.chapterHref || ''),
            chapterLabel: String(row.chapterLabel || ''),
            logicalSectionId: String(row.logicalSectionId || ''),
            start: Number(row.startOffset || 0)
          })).filter((row) => row.text)
        };
      } finally {
        db?.close();
      }
    });
  } catch {
    return { available: false, chunks: [] };
  }
}

async function readBookNavigation(book, dataRoot) {
  if (book?.type !== 'epub') return { available: false, chapters: [] };
  try {
    const filePath = await ensureIndex(book, dataRoot);
    if (!filePath) return { available: false, chapters: [] };
    const manager = getIndexManager(dataRoot);
    return manager.withReadLease(book.id, async () => {
      let db;
      try {
        db = openDatabase(filePath, { readOnly: true });
        const row = db.prepare('SELECT parserVersion, structureJson FROM ai_epub_structure WHERE id = 1').get();
        if (!row || row.parserVersion !== String(AI_EPUB_PARSER_VERSION)) return { available: false, chapters: [] };
        const structure = JSON.parse(row.structureJson);
        const chapters = (Array.isArray(structure.chapters) ? structure.chapters : [])
          .filter((chapter) => chapter.depth === 0 && chapter.start && chapter.end)
          .sort((left, right) => left.start.spineIndex - right.start.spineIndex || left.start.offset - right.start.offset)
          .map((chapter, order) => ({
            id: String(chapter.id || ''),
            label: String(chapter.label || '').slice(0, 300),
            depth: 0,
            order,
            mappingQuality: chapter.mappingQuality === 'exact' ? 'exact' : 'inferred'
          }))
          .filter((chapter) => chapter.id && chapter.label);
        return { available: true, chapters };
      } catch {
        return { available: false, chapters: [] };
      } finally {
        db?.close();
      }
    });
  } catch {
    return { available: false, chapters: [] };
  }
}

async function listCachedChapterSummaries({ book, dataRoot, userId, baseUrl, model } = {}) {
  if (book?.type !== 'epub' || !userId) return [];
  try {
    const filePath = await ensureIndex(book, dataRoot);
    if (!filePath) return [];
    const userKey = hashAiSummaryUserId(userId);
    const modelKey = buildAiSummaryModelKey({
      provider: 'openai-compatible',
      baseUrl,
      model,
      strategyVersion: SUMMARY_STRATEGY_VERSION,
      promptVersion: SUMMARY_PROMPT_VERSION
    });
    const manager = getIndexManager(dataRoot);
    return manager.withReadLease(book.id, async () => {
      let db;
      try {
        db = openDatabase(filePath, { readOnly: true });
        const rows = db.prepare(`
          SELECT logicalChapterId, summaryJson
          FROM ai_chapter_summary_cache
          WHERE cacheKind = 'chapter-summary' AND userKey = ? AND modelKey = ?
          ORDER BY createdAt DESC LIMIT ?
        `).all(userKey, modelKey, AI_SUMMARY_CACHE_MAX_ROWS);
        return rows.flatMap((row) => {
          try {
            const summary = JSON.parse(row.summaryJson);
            const text = String(summary?.answer || '').slice(0, 12000);
            return text ? [{ chapterId: String(row.logicalChapterId), text }] : [];
          } catch {
            return [];
          }
        });
      } finally {
        db?.close();
      }
    });
  } catch {
    return [];
  }
}

async function getOrCreateChapterSummary({
  book,
  dataRoot,
  userId,
  logicalChapterId,
  bookFingerprint,
  parserVersion,
  baseUrl,
  model,
  cachePurpose = 'chapter-summary',
  build
} = {}) {
  if (!['chapter-summary', 'book-summary', 'map-segment'].includes(cachePurpose)) throw new Error('章节摘要缓存类型无效');
  const filePath = await ensureIndex(book, dataRoot);
  if (!filePath || typeof build !== 'function') throw new Error('章节摘要缓存不可用');
  const strategyVersion = cachePurpose === 'map-segment'
    ? `${SUMMARY_STRATEGY_VERSION}:map-segment`
    : cachePurpose === 'book-summary' ? `${SUMMARY_STRATEGY_VERSION}:book` : SUMMARY_STRATEGY_VERSION;
  const promptVersion = cachePurpose === 'map-segment'
    ? `${SUMMARY_PROMPT_VERSION}:map-v1`
    : cachePurpose === 'book-summary' ? `${SUMMARY_PROMPT_VERSION}:book-v1` : SUMMARY_PROMPT_VERSION;
  const { cacheKey } = buildAiSummaryCacheKey({
    userId,
    bookFingerprint,
    logicalChapterId,
    parserVersion,
    strategyVersion,
    provider: 'openai-compatible',
    baseUrl,
    model,
    promptVersion
  });
  const cacheIdentity = {
    logicalChapterId,
    userKey: hashAiSummaryUserId(userId),
    bookFingerprint,
    parserVersion: String(parserVersion || ''),
    modelKey: buildAiSummaryModelKey({
      provider: 'openai-compatible', baseUrl, model, strategyVersion, promptVersion
    })
  };
  const manager = getIndexManager(dataRoot);
  const cache = getSummaryCache(dataRoot);
  const read = async () => manager.withReadLease(book.id, async () => {
    let db;
    try {
      db = openDatabase(filePath, { readOnly: true });
      const row = db.prepare('SELECT summaryJson FROM ai_chapter_summary_cache WHERE cacheKey = ? AND cacheKind = ?').get(cacheKey, cachePurpose);
      return row ? JSON.parse(row.summaryJson) : null;
    } finally {
      db?.close();
    }
  });
  const write = async (_key, summary) => manager.withReadLease(book.id, async () => {
    let db;
    try {
      db = openDatabase(filePath);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`
          INSERT OR REPLACE INTO ai_chapter_summary_cache(
            cacheKey, cacheKind, logicalChapterId, userKey, bookFingerprint, parserVersion, modelKey, summaryJson, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          cacheKey, cachePurpose, cacheIdentity.logicalChapterId, cacheIdentity.userKey,
          cacheIdentity.bookFingerprint, cacheIdentity.parserVersion, cacheIdentity.modelKey,
          JSON.stringify(summary), new Date().toISOString()
        );
        db.prepare(`
          DELETE FROM ai_chapter_summary_cache
          WHERE cacheKey NOT IN (
            SELECT cacheKey FROM ai_chapter_summary_cache ORDER BY createdAt DESC LIMIT ?
          )
        `).run(AI_SUMMARY_CACHE_MAX_ROWS);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db?.close();
    }
    await secureIndexPermissions(filePath);
  });
  return cache.getOrCreate({ key: cacheKey, read, write, build });
}

async function getOrCreateChapterSummarySegment({
  book,
  dataRoot,
  userId,
  logicalChapterId,
  parserVersion,
  baseUrl,
  model,
  task,
  build
} = {}) {
  if (!task || typeof task.text !== 'string') throw new Error('章节摘要分段无效');
  const segmentFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    text: task.text,
    sourceIds: task.sourceIds,
    chapterHref: task.chapterHref,
    start: task.start
  }), 'utf8').digest('hex');
  return getOrCreateChapterSummary({
    book,
    dataRoot,
    userId,
    logicalChapterId,
    bookFingerprint: segmentFingerprint,
    parserVersion,
    baseUrl,
    model,
    cachePurpose: 'map-segment',
    build
  });
}

function normalizeLimit(value) {
  return Math.max(1, Math.min(AI_FTS_MAX_RESULTS, Number.isFinite(Number(value)) ? Number(value) : AI_FTS_MAX_RESULTS));
}

function rankFtsCandidates(rows, currentChapterIndex) {
  return rows.map((row) => {
    const bm25Score = Number(row.score);
    const relevanceScore = Number.isFinite(bm25Score) ? -bm25Score : 0;
    const chapterScore = Number.isInteger(currentChapterIndex) && Number(row.chapterIndex) === currentChapterIndex ? 2 : 0;
    return {
      text: row.bodyText,
      title: row.titleText,
      headings: row.headingsText ? row.headingsText.split('\n').filter(Boolean) : [],
      chapterIndex: Number(row.chapterIndex),
      chapterHref: String(row.chapterHref || ''),
      chapterLabel: String(row.chapterLabel || ''),
      logicalChapterId: String(row.logicalChapterId || ''),
      logicalSectionId: String(row.logicalSectionId || ''),
      start: Number(row.startOffset || 0),
      ftsScore: relevanceScore + chapterScore,
      score: relevanceScore + chapterScore
    };
  }).sort((left, right) => (
    right.ftsScore - left.ftsScore
    || left.chapterIndex - right.chapterIndex
    || left.start - right.start
  ));
}

function decodeIndexedText(value) {
  // The index stores tokens for matching. Return original text from the FTS
  // row's unindexed bodyText column when available, never tokenized text.
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function coverageMetadata(indices, totalChunks) {
  if (totalChunks > 0 && indices.length >= totalChunks) {
    return {
      mode: 'chapter-sample',
      totalChunks,
      selectedChunks: totalChunks,
      coveredRegions: ['beginning', 'middle', 'ending'],
      ratio: 1
    };
  }
  const regions = new Set(indices.map((index) => (
    totalChunks <= 1 ? 'middle' : index / (totalChunks - 1) < 1 / 3 ? 'beginning' : index / (totalChunks - 1) < 2 / 3 ? 'middle' : 'ending'
  )));
  return {
    mode: 'chapter-sample',
    totalChunks,
    selectedChunks: indices.length,
    coveredRegions: [...regions],
    ratio: regions.size / 3
  };
}

function readCoverageMatches(db, scopeColumn, scopeId, limit) {
  const rowIndexes = db.prepare(`
    SELECT rowid, chapterIndex, chapterHref, chapterLabel, logicalChapterId, logicalSectionId, startOffset
    FROM ai_chunks
    WHERE ${scopeColumn} = ?
    ORDER BY CAST(chapterIndex AS INTEGER), CAST(startOffset AS INTEGER), rowid
  `).all(scopeId);
  if (!rowIndexes.length) return { matches: [], coverage: coverageMetadata([], 0) };
  const chosen = rowIndexes.length <= limit
    ? rowIndexes
    : Array.from({ length: limit }, (_, index) => {
      const selectedIndex = limit === 1
        ? Math.floor((rowIndexes.length - 1) / 2)
        : Math.round(index * (rowIndexes.length - 1) / (limit - 1));
      return { ...rowIndexes[selectedIndex], __coverageIndex: selectedIndex };
    });
  const readable = db.prepare(`
    SELECT ai_chunks.rowid, ai_chunk_text.bodyText, ai_chunk_text.titleText, ai_chunk_text.headingsText
    FROM ai_chunks INNER JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
    WHERE ai_chunks.rowid IN (${chosen.map(() => '?').join(',')})
  `).all(...chosen.map((row) => row.rowid));
  const readableById = new Map(readable.map((row) => [row.rowid, row]));
  const matches = chosen.map((row) => {
    const text = readableById.get(row.rowid) || {};
    return {
      text: decodeIndexedText(text.bodyText),
      title: decodeIndexedText(text.titleText),
      headings: decodeIndexedText(text.headingsText).split('\n').filter(Boolean),
      chapterIndex: Number(row.chapterIndex),
      chapterHref: String(row.chapterHref || ''),
      chapterLabel: String(row.chapterLabel || ''),
      logicalChapterId: String(row.logicalChapterId || ''),
      logicalSectionId: String(row.logicalSectionId || ''),
      start: Number(row.startOffset || 0),
      retrievalSources: ['coverage'],
      score: 0
    };
  }).filter((row) => row.text);
  const indices = chosen.map((row, index) => row.__coverageIndex ?? index);
  return { matches, coverage: coverageMetadata(indices, rowIndexes.length) };
}

async function searchBook(book, dataRoot, {
  query = '',
  selectedText = '',
  currentChapterIndex = null,
  logicalChapterId = null,
  logicalSectionId = null,
  intent = 'lookup',
  limit = AI_FTS_MAX_RESULTS
} = {}) {
  const resultLimit = normalizeLimit(limit);
  let filePath;
  try {
    filePath = await ensureIndex(book, dataRoot);
  } catch {
    return { available: false, matches: [] };
  }
  if (!filePath) return { available: false, matches: [], confidence: assessRetrievalConfidence([]) };

  const sectionIntent = intent === 'section_summary' || intent === 'section_lookup';
  const requiresScope = ['chapter_summary', 'chapter_lookup', 'section_summary', 'section_lookup'].includes(intent);
  const scopeColumn = sectionIntent
    ? (logicalSectionId ? 'logicalSectionId' : '')
    : logicalChapterId ? 'logicalChapterId' : '';
  const scopeId = sectionIntent ? (logicalSectionId || '') : (logicalChapterId || '');
  if (requiresScope && !scopeId) {
    return {
      available: true,
      matches: [],
      confidence: assessRetrievalConfidence([]),
      coverage: coverageMetadata([], 0),
      retrievalStatus: 'insufficient_scope'
    };
  }
  const manager = getIndexManager(dataRoot);
  return manager.withReadLease(book.id, async () => {
    let db;
    try {
      db = openDatabase(filePath, { readOnly: true });
      if (intent === 'chapter_summary' || intent === 'section_summary') {
        if (!scopeColumn || !scopeId) {
          return {
            available: true,
            matches: [],
            confidence: assessRetrievalConfidence([]),
            coverage: coverageMetadata([], 0),
            retrievalStatus: 'insufficient_scope'
          };
        }
        const sampled = readCoverageMatches(db, scopeColumn, scopeId, resultLimit);
        return {
          available: true,
          matches: sampled.matches,
          confidence: assessRetrievalConfidence(sampled.matches, { query, selectedText, termize: aiTerms }),
          coverage: sampled.coverage,
          retrievalStatus: sampled.matches.length ? 'ok' : 'insufficient_scope'
        };
      }
      const ftsQuery = toFtsQuery(`${query} ${selectedText}`);
      if (!ftsQuery) return { available: true, matches: [], confidence: assessRetrievalConfidence([]), coverage: null };
      const scopeSql = scopeColumn ? ` AND ${scopeColumn} = ?` : '';
      const scopeParams = scopeColumn ? [scopeId] : [];
    const rows = db.prepare(`
      SELECT
        rowid,
        title AS titleText,
        headings AS headingsText,
        chapterIndex,
        chapterHref,
        chapterLabel,
        logicalChapterId,
        logicalSectionId,
        startOffset,
        bm25(ai_chunks, 4.0, 3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0) AS score
      FROM ai_chunks
      WHERE ai_chunks MATCH ?${scopeSql}
      ORDER BY score ASC
      LIMIT ?
    `).all(ftsQuery, ...scopeParams, Math.max(resultLimit * 4, resultLimit));

    // FTS stores tokenized values to make Chinese matching deterministic. The
    // companion table keeps the original chunk text for the model context.
    // Keep the normal path bounded to the FTS candidate pool; only the empty
    // FTS result path scans all chunks for a lexical fallback.
    const readableRows = db.prepare(`
      SELECT rowid, bodyText, titleText, headingsText
      FROM ai_chunk_text
      WHERE rowid IN (${rows.map(() => '?').join(',') || 'NULL'})
    `).all(...rows.map((row) => row.rowid));
    const readableById = new Map(readableRows.map((row) => [row.rowid, row]));
    const ftsCandidates = rankFtsCandidates(rows.map((row) => {
      const readable = readableById.get(row.rowid) || {};
      return {
        ...row,
        bodyText: decodeIndexedText(readable.bodyText),
        titleText: decodeIndexedText(readable.titleText),
        headingsText: decodeIndexedText(readable.headingsText)
      };
    }), currentChapterIndex);
    let lexicalPool = ftsCandidates;
    if (!ftsCandidates.length) {
      const allRows = db.prepare(`
        SELECT
          ai_chunks.rowid,
          ai_chunks.chapterIndex,
          ai_chunks.chapterHref,
          ai_chunks.chapterLabel,
          ai_chunks.logicalChapterId,
          ai_chunks.logicalSectionId,
          ai_chunks.startOffset,
          ai_chunk_text.bodyText,
          ai_chunk_text.titleText,
          ai_chunk_text.headingsText
        FROM ai_chunks
        INNER JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
        ${scopeColumn ? `WHERE ai_chunks.${scopeColumn} = ?` : ''}
      `).all(...scopeParams);
      lexicalPool = allRows.map((row) => ({
        text: decodeIndexedText(row.bodyText),
        title: decodeIndexedText(row.titleText),
        headings: decodeIndexedText(row.headingsText),
        chapterIndex: Number(row.chapterIndex),
        chapterHref: String(row.chapterHref || ''),
        chapterLabel: String(row.chapterLabel || ''),
        logicalChapterId: String(row.logicalChapterId || ''),
        logicalSectionId: String(row.logicalSectionId || ''),
        start: Number(row.startOffset || 0)
      }));
    }
    const lexicalCandidates = rankLexicalCandidates(lexicalPool.map((row) => ({
      text: row.text || decodeIndexedText(row.bodyText),
      title: row.title || decodeIndexedText(row.titleText),
      headings: row.headings || decodeIndexedText(row.headingsText),
      chapterIndex: Number(row.chapterIndex),
      chapterHref: String(row.chapterHref || ''),
      chapterLabel: String(row.chapterLabel || ''),
      logicalChapterId: String(row.logicalChapterId || ''),
      logicalSectionId: String(row.logicalSectionId || ''),
      start: Number(row.start || row.startOffset || 0)
    })), {
      query,
      selectedText,
      currentChapterIndex,
      termize: aiTerms
    });
    const matches = fuseRankedMatches({
      ftsMatches: ftsCandidates,
      lexicalMatches: lexicalCandidates,
      limit: resultLimit,
      minDiverseDistance: AI_FTS_MIN_DIVERSE_DISTANCE,
      sourceWeights: { fts: 3, lexical: 1 }
    });
    return {
      available: true,
      matches,
      confidence: assessRetrievalConfidence(matches, { query, selectedText, termize: aiTerms }),
      coverage: null,
      retrievalStatus: matches.length ? 'ok' : 'no_matches'
    };
    } catch {
      return { available: false, matches: [], confidence: assessRetrievalConfidence([]) };
    } finally {
      db?.close();
    }
  });
}

// PDF AI intentionally bypasses EPUB chapter inference and the lexical whole-index
// fallback. A page predicate is applied in SQLite before the bounded candidate
// limit, so evidence from an adjacent page cannot enter a scoped request.
async function searchPdfEvidenceRows(book, dataRoot, {
  query = '', selectedText = '', pageStart = null, pageEnd = null, limit = 6, signal
} = {}) {
  if (book?.type !== 'pdf') return { status: 'unavailable', rows: [] };
  let filePath;
  try {
    filePath = await ensureIndex(book, dataRoot, { signal });
  } catch (error) {
    const status = error?.code === 'PDF_PASSWORD_REQUIRED' ? 'password-protected'
      : error?.code === 'PDF_EXTRACTION_BUDGET' ? 'extraction-limit' : 'unavailable';
    return { status, rows: [] };
  }
  if (!filePath) return { status: 'unavailable', rows: [] };
  return getIndexManager(dataRoot).withReadLease(book.id, async () => {
    let db;
    try {
      db = openDatabase(filePath, { readOnly: true });
      const indexStatus = db.prepare("SELECT value FROM ai_meta WHERE key = 'pdfSearchStatus'").get()?.value;
      if (indexStatus === 'no-text') return { status: 'no-text', rows: [] };
      const boundedLimit = Math.min(6, Math.max(1, Number(limit) || 6));
      const scoped = Number.isSafeInteger(pageStart) && Number.isSafeInteger(pageEnd);
      const scopeSql = scoped ? ' AND ai_chunks.chapterIndex BETWEEN ? AND ?' : '';
      const scopeParams = scoped ? [pageStart, pageEnd] : [];
      const queryText = toFtsQuery(`${query} ${selectedText}`);
      const hits = queryText ? db.prepare(`
        SELECT ai_chunks.chapterIndex AS pageIndex, ai_chunks.startOffset AS start,
          ai_chunk_text.bodyText AS text, bm25(ai_chunks) AS score
        FROM ai_chunks JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
        WHERE ai_chunks MATCH ?${scopeSql}
        ORDER BY score ASC LIMIT ?
      `).all(queryText, ...scopeParams, boundedLimit * 5) : [];
      const rows = [];
      // Reserve one bounded sample per explicitly requested page. This keeps a
      // range question from silently omitting a page simply because a generic
      // FTS term ranked hits from another page higher.
      if (scoped && (pageStart !== pageEnd || !hits.length)) {
        for (let page = pageStart; page <= pageEnd && rows.length < boundedLimit; page += 1) {
          rows.push(...db.prepare(`
            SELECT ai_chunks.chapterIndex AS pageIndex, ai_chunks.startOffset AS start,
              ai_chunk_text.bodyText AS text, 0 AS score
            FROM ai_chunks JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
            WHERE ai_chunks.chapterIndex = ? ORDER BY ai_chunks.startOffset LIMIT ?
          `).all(page, pageStart === pageEnd ? 2 : 1));
        }
      }
      for (const hit of hits) {
        if (rows.length >= boundedLimit) break;
        if (rows.some((row) => Number(row.pageIndex) === Number(hit.pageIndex)
            && Number(row.start) === Number(hit.start))) continue;
        rows.push(hit);
      }
      if (selectedText && scoped) {
        const pageRows = db.prepare(`
          SELECT ai_chunks.startOffset AS start, ai_chunk_text.bodyText AS text
          FROM ai_chunks JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
          WHERE ai_chunks.chapterIndex = ? ORDER BY ai_chunks.startOffset
        `).all(pageStart);
        let reconstructed = '';
        for (const row of pageRows) {
          const start = Number(row.start);
          const part = String(row.text || '');
          if (start > reconstructed.length) reconstructed += ' '.repeat(start - reconstructed.length);
          reconstructed += part.slice(Math.max(0, reconstructed.length - start));
        }
        const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const pageText = compact(reconstructed);
        const verifiedQuote = compact(selectedText);
        const quoteOffset = pageText.indexOf(verifiedQuote);
        if (quoteOffset < 0) {
          return { status: 'selection-not-found', rows: [] };
        }
        const verifiedRows = [];
        for (let offset = 0; offset < verifiedQuote.length; offset += 700) {
          verifiedRows.push({ pageIndex: pageStart, start: quoteOffset + offset,
            text: pageText.slice(quoteOffset + offset, quoteOffset + Math.min(verifiedQuote.length, offset + 700)),
            score: -Infinity });
        }
        rows.unshift(...verifiedRows);
      }
      return { status: 'ready', rows: rows.slice(0, boundedLimit).map((row) => ({
        pageIndex: Number(row.pageIndex), start: Number(row.start), text: String(row.text || '')
      })) };
    } catch {
      return { status: 'unavailable', rows: [] };
    } finally {
      db?.close();
    }
  });
}

function normalizePdfPageRanges(ranges) {
  const normalized = (Array.isArray(ranges) ? ranges : []).flatMap((range) => {
    const pageStart = Number(range?.pageStart);
    const pageEnd = Number(range?.pageEnd);
    if (!Number.isSafeInteger(pageStart) || !Number.isSafeInteger(pageEnd) || pageStart < 0
      || pageEnd < pageStart || pageEnd >= 5000) return [];
    return [{ pageStart, pageEnd }];
  }).sort((a, b) => a.pageStart - b.pageStart || a.pageEnd - b.pageEnd);
  const merged = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous && range.pageStart <= previous.pageEnd) previous.pageEnd = Math.max(previous.pageEnd, range.pageEnd);
    else merged.push({ ...range });
  }
  return merged.length <= 6 ? merged : null;
}

async function searchPdfEvidenceRowsByRanges(book, dataRoot, { query = '', ranges = [], limit = 6, signal } = {}) {
  if (book?.type !== 'pdf') return { status: 'unavailable', rows: [] };
  const normalizedRanges = normalizePdfPageRanges(ranges);
  if (!normalizedRanges || !normalizedRanges.length) return { status: 'unavailable', rows: [] };
  if (signal?.aborted) return { status: 'cancelled', rows: [] };
  let filePath;
  try { filePath = await ensureIndex(book, dataRoot, { signal }); } catch (error) {
    const status = error?.code === 'PDF_PASSWORD_REQUIRED' ? 'password-protected'
      : error?.code === 'PDF_EXTRACTION_BUDGET' ? 'extraction-limit' : 'unavailable';
    return { status, rows: [] };
  }
  if (!filePath) return { status: 'unavailable', rows: [] };
  return getIndexManager(dataRoot).withReadLease(book.id, async () => {
    let db;
    try {
      db = openDatabase(filePath, { readOnly: true });
      const indexStatus = db.prepare("SELECT value FROM ai_meta WHERE key = 'pdfSearchStatus'").get()?.value;
      if (indexStatus === 'no-text') return { status: 'no-text', rows: [] };
      const boundedLimit = Math.min(6, Math.max(1, Number(limit) || 6));
      const queryText = toFtsQuery(query);
      const batches = [];
      for (const range of normalizedRanges) {
        if (signal?.aborted) return { status: 'cancelled', rows: [] };
        const candidates = queryText ? db.prepare(`
          SELECT ai_chunks.chapterIndex AS pageIndex, ai_chunks.startOffset AS start,
            ai_chunk_text.bodyText AS text, bm25(ai_chunks) AS score
          FROM ai_chunks JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
          WHERE ai_chunks MATCH ? AND ai_chunks.chapterIndex BETWEEN ? AND ?
          ORDER BY score ASC LIMIT ?
        `).all(queryText, range.pageStart, range.pageEnd, boundedLimit) : [];
        if (candidates.length) batches.push(candidates);
        else {
          batches.push(db.prepare(`
            SELECT ai_chunks.chapterIndex AS pageIndex, ai_chunks.startOffset AS start,
              ai_chunk_text.bodyText AS text, 0 AS score
            FROM ai_chunks JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
            WHERE ai_chunks.chapterIndex BETWEEN ? AND ?
            ORDER BY ai_chunks.chapterIndex, ai_chunks.startOffset LIMIT ?
          `).all(range.pageStart, range.pageEnd, boundedLimit));
        }
      }
      const rows = [];
      const seen = new Set();
      for (let offset = 0; rows.length < boundedLimit; offset += 1) {
        let added = false;
        for (const batch of batches) {
          const row = batch[offset];
          if (!row) continue;
          const key = `${Number(row.pageIndex)}:${Number(row.start)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ pageIndex: Number(row.pageIndex), start: Number(row.start), text: String(row.text || '') });
          added = true;
          if (rows.length >= boundedLimit) break;
        }
        if (!added) break;
      }
      return { status: 'ready', rows };
    } catch {
      return { status: 'unavailable', rows: [] };
    } finally {
      db?.close();
    }
  });
}

// Kept as a separate helper so tests and future migrations can inspect the
// runtime capability without opening a user database.
function isFtsAvailable() {
  if (!getDatabaseSync()) return false;
  let db;
  try {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE VIRTUAL TABLE ai_fts_capability_check USING fts5(value);');
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

module.exports = {
  AI_FTS_SCHEMA_VERSION,
  AI_FTS_MAX_RESULTS,
  AI_FTS_CHUNK_SIZE,
  AI_FTS_CHUNK_OVERLAP,
  aiTerms,
  toFtsDocument,
  toFtsQuery,
  chunkChapter,
  indexPath,
  isFtsAvailable,
  ensureIndex,
  resolveBookPosition,
  readChapterEvidence,
  readBookNavigation,
  listCachedChapterSummaries,
  getOrCreateChapterSummary,
  getOrCreateChapterSummarySegment,
  searchBook,
  searchPdfEvidenceRows,
  searchPdfEvidenceRowsByRanges
};
