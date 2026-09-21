'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { safeUnzip } = require('./zip');
const { normalizeBookText } = require('./ai-book-context');
const { rankLexicalCandidates, fuseRankedMatches, assessRetrievalConfidence } = require('./ai-retrieval');

const AI_FTS_SCHEMA_VERSION = 2;
const AI_FTS_CHUNK_SIZE = 900;
const AI_FTS_CHUNK_OVERLAP = 120;
const AI_FTS_MAX_RESULTS = 6;
const AI_FTS_MAX_QUERY_TERMS = 48;
const AI_FTS_MIN_DIVERSE_DISTANCE = AI_FTS_CHUNK_SIZE;

let DatabaseSync = null;
let sqliteCapabilityChecked = false;
const buildLocks = new Map();

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

function normalizeArchivePath(value) {
  let raw;
  try {
    raw = decodeURIComponent(String(value || '').split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  } catch {
    return '';
  }
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return '';
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
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

function xmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : '';
}

function resolveArchivePath(base, href) {
  return normalizeArchivePath(`${base}${String(href || '').split(/[?#]/, 1)[0]}`);
}

function extractSpine(files) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const container = files['META-INF/container.xml'];
  if (!container) throw new Error('EPUB container.xml is missing');
  const rootfile = decoder.decode(container).match(/<rootfile\b[^>]*full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const opfPath = normalizeArchivePath(rootfile?.[1] ?? rootfile?.[2] ?? '');
  if (!opfPath || !files[opfPath]) throw new Error('EPUB package document is missing');

  const opf = decoder.decode(files[opfPath]);
  const opfDirectory = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = xmlAttribute(match[0], 'id');
    const href = xmlAttribute(match[0], 'href');
    if (id && href) manifest.set(id, resolveArchivePath(opfDirectory, href));
  }
  const spine = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const href = manifest.get(xmlAttribute(match[0], 'idref'));
    if (href) spine.push(href);
  }
  return spine;
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

async function readBookChapters(book) {
  const bytes = await fs.readFile(book.path);
  if (book.type !== 'epub') {
    return [{
      index: 0,
      href: '',
      label: book.title || '当前书本',
      headings: [],
      text: normalizeBookText(bytes.toString('utf8'))
    }];
  }

  const files = safeUnzip(bytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const spine = extractSpine(files);
  const chapters = [];
  for (let index = 0; index < spine.length; index += 1) {
    const href = spine[index];
    const html = files[href] ? decoder.decode(files[href]) : '';
    const chapter = extractChapter(html, `第${index + 1}章`);
    if (chapter.text) chapters.push({ index, href, ...chapter });
  }
  return chapters;
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
        start
      });
    }
    if (start + AI_FTS_CHUNK_SIZE >= chars.length) break;
  }
  return chunks;
}

function indexPath(dataRoot, bookId) {
  return path.join(path.resolve(dataRoot), 'ai-index', `${bookId}.sqlite`);
}

function currentFingerprint(book, stat) {
  return `${path.resolve(book.path)}\0${stat.size}\0${Math.trunc(stat.mtimeMs)}`;
}

function openDatabase(filePath) {
  const Constructor = getDatabaseSync();
  if (!Constructor) return null;
  const db = new Constructor(filePath);
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
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}

function writeMeta(db, values) {
  const statement = db.prepare('INSERT OR REPLACE INTO ai_meta(key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(values)) statement.run(key, String(value));
}

async function readIndexMeta(filePath) {
  if (!getDatabaseSync()) return null;
  let db;
  try {
    db = openDatabase(filePath);
    if (!db) return null;
    const rows = db.prepare('SELECT key, value FROM ai_meta').all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function buildIndex(book, dataRoot, filePath, fingerprint) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let db;
  try {
    const chapters = await readBookChapters(book);
    db = openDatabase(temporaryPath);
    if (!db) return false;
    createSchema(db);
    writeMeta(db, {
      schemaVersion: AI_FTS_SCHEMA_VERSION,
      bookId: book.id,
      fingerprint
    });
    const insert = db.prepare(`
      INSERT INTO ai_chunks(title, headings, body, chapterIndex, chapterHref, chapterLabel, startOffset)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertText = db.prepare(`
      INSERT INTO ai_chunk_text(rowid, bodyText, titleText, headingsText)
      VALUES (?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    try {
      for (const chapter of chapters) {
        for (const chunk of chunkChapter(chapter)) {
          const inserted = insert.run(
            toFtsDocument(chunk.title),
            toFtsDocument(chunk.headings.join(' ')),
            toFtsDocument(chunk.text),
            chunk.chapterIndex,
            chunk.chapterHref,
            chunk.chapterLabel,
            chunk.start
          );
          insertText.run(
            Number(inserted.lastInsertRowid),
            chunk.text,
            chunk.title,
            chunk.headings.join('\n')
          );
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.close();
    db = null;
    await fs.chmod(temporaryPath, 0o600);
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
    await secureIndexPermissions(filePath);
    return true;
  } finally {
    db?.close();
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function ensureIndex(book, dataRoot) {
  if (!book?.id || !book?.path || !getDatabaseSync()) return null;
  const stat = await fs.stat(book.path);
  const fingerprint = currentFingerprint(book, stat);
  const filePath = indexPath(dataRoot, book.id);
  const metadata = await readIndexMeta(filePath);
  if (metadata?.schemaVersion === String(AI_FTS_SCHEMA_VERSION)
    && metadata.bookId === book.id
    && metadata.fingerprint === fingerprint) {
    await secureIndexPermissions(filePath);
    return filePath;
  }

  const existing = buildLocks.get(filePath);
  if (existing) {
    await existing;
    return (await readIndexMeta(filePath))?.fingerprint === fingerprint ? filePath : null;
  }
  const build = buildIndex(book, dataRoot, filePath, fingerprint)
    .finally(() => buildLocks.delete(filePath));
  buildLocks.set(filePath, build);
  const built = await build;
  return built ? filePath : null;
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

async function searchBook(book, dataRoot, { query = '', selectedText = '', currentChapterIndex = null, limit = AI_FTS_MAX_RESULTS } = {}) {
  const resultLimit = normalizeLimit(limit);
  let filePath;
  try {
    filePath = await ensureIndex(book, dataRoot);
  } catch {
    return { available: false, matches: [] };
  }
  if (!filePath) return { available: false, matches: [], confidence: assessRetrievalConfidence([]) };

  const ftsQuery = toFtsQuery(`${query} ${selectedText}`);
  if (!ftsQuery) return { available: true, matches: [], confidence: assessRetrievalConfidence([]) };
  let db;
  try {
    db = openDatabase(filePath);
    const rows = db.prepare(`
      SELECT
        rowid,
        title AS titleText,
        headings AS headingsText,
        chapterIndex,
        chapterHref,
        chapterLabel,
        startOffset,
        bm25(ai_chunks, 4.0, 3.0, 1.0) AS score
      FROM ai_chunks
      WHERE ai_chunks MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `).all(ftsQuery, Math.max(resultLimit * 4, resultLimit));

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
          ai_chunks.startOffset,
          ai_chunk_text.bodyText,
          ai_chunk_text.titleText,
          ai_chunk_text.headingsText
        FROM ai_chunks
        INNER JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
      `).all();
      lexicalPool = allRows.map((row) => ({
        text: decodeIndexedText(row.bodyText),
        title: decodeIndexedText(row.titleText),
        headings: decodeIndexedText(row.headingsText),
        chapterIndex: Number(row.chapterIndex),
        chapterHref: String(row.chapterHref || ''),
        chapterLabel: String(row.chapterLabel || ''),
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
      confidence: assessRetrievalConfidence(matches, { query, selectedText, termize: aiTerms })
    };
  } catch {
    return { available: false, matches: [], confidence: assessRetrievalConfidence([]) };
  } finally {
    db?.close();
  }
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
  searchBook
};
