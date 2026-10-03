'use strict';

const crypto = require('node:crypto');
const { ensureIndex, toFtsQuery } = require('./ai-fts');

const BOOK_SEARCH_MAX_QUERY_LENGTH = 80;
const BOOK_SEARCH_DEFAULT_LIMIT = 20;
const BOOK_SEARCH_MAX_LIMIT = 50;
const BOOK_SEARCH_MAX_CANDIDATES = 2000;
const BOOK_SEARCH_SNIPPET_CONTEXT = 64;
const BOOK_SEARCH_MAX_CURSOR_LENGTH = 512;

let DatabaseSync = null;
let sqliteCapabilityChecked = false;

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

function searchInputError(message) {
  return Object.assign(new Error(message), {
    code: 'SEARCH_QUERY_INVALID',
    statusCode: 400
  });
}

function searchCursorError(message, statusCode = 400) {
  return Object.assign(new Error(message), {
    code: statusCode === 409 ? 'SEARCH_CURSOR_STALE' : 'SEARCH_CURSOR_INVALID',
    statusCode
  });
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function decodeSearchCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) return validateSearchCursor(value);
  const token = String(value);
  if (token.length > BOOK_SEARCH_MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw searchCursorError('搜索游标无效，请重新搜索');
  }
  let cursor;
  try {
    const decoded = Buffer.from(token, 'base64url');
    if (decoded.toString('base64url') !== token) throw new Error('non-canonical');
    cursor = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw searchCursorError('搜索游标无效，请重新搜索');
  }
  return validateSearchCursor(cursor);
}

function validateSearchCursor(cursor) {
  const validDigest = (item) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
  const validPosition = Number.isSafeInteger(cursor?.r) && cursor.r > 0;
  const validKey = cursor?.k === null || (
    Array.isArray(cursor?.k)
    && cursor.k.length === 2
    && Number.isSafeInteger(cursor.k[0]) && cursor.k[0] >= 0
    && Number.isSafeInteger(cursor.k[1]) && cursor.k[1] >= 0
  );
  if (cursor?.v !== 1
    || !validDigest(cursor.b)
    || !validDigest(cursor.q)
    || !validDigest(cursor.f)
    || !['book', 'chapter'].includes(cursor.s)
    || !(cursor.c === null || (Number.isSafeInteger(cursor.c) && cursor.c >= 0))
    || !Number.isSafeInteger(cursor.l) || cursor.l < 1 || cursor.l > BOOK_SEARCH_MAX_LIMIT
    || !validPosition
    || typeof cursor.i !== 'boolean'
    || !validKey) {
    throw searchCursorError('搜索游标无效，请重新搜索');
  }
  return cursor;
}

function encodeSearchCursor(cursor) {
  const token = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  if (token.length > BOOK_SEARCH_MAX_CURSOR_LENGTH) {
    throw searchCursorError('搜索游标无效，请重新搜索');
  }
  return token;
}

function normalizeSearchText(value) {
  return String(value || '')
    .replace(/\s+/gu, '')
    .trim()
    .toLocaleLowerCase();
}

function normalizedTextWithOffsets(value) {
  const source = String(value || '');
  let normalized = '';
  const offsets = [];
  let sourceOffset = 0;

  for (const character of source) {
    const start = sourceOffset;
    sourceOffset += character.length;
    if (/\s/u.test(character)) continue;

    const folded = character.toLocaleLowerCase();
    normalized += folded;
    for (let index = 0; index < folded.length; index += 1) {
      offsets.push({ start, end: sourceOffset });
    }
  }

  return { normalized, offsets };
}

function normalizeBookSearchOptions(options = {}) {
  const query = String(options.query || '').trim();
  if (!query || Array.from(query).length > BOOK_SEARCH_MAX_QUERY_LENGTH) {
    throw searchInputError(`搜索内容不能为空且不能超过 ${BOOK_SEARCH_MAX_QUERY_LENGTH} 个字符`);
  }

  const scope = options.scope === undefined ? 'book' : String(options.scope);
  if (!['book', 'chapter'].includes(scope)) throw searchInputError('搜索范围无效');

  let chapterIndex = null;
  if (scope === 'chapter') {
    chapterIndex = Number(options.chapterIndex);
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0) throw searchInputError('章节范围无效');
  }

  const requestedLimit = Number(options.limit ?? BOOK_SEARCH_DEFAULT_LIMIT);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) throw searchInputError('搜索结果数量无效');

  const normalized = {
    query,
    scope,
    chapterIndex,
    limit: Math.max(1, Math.min(BOOK_SEARCH_MAX_LIMIT, Math.trunc(requestedLimit)))
  };
  normalized.cursor = decodeSearchCursor(options.cursor);
  return normalized;
}

function parseBookSearchParams(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');
  return normalizeBookSearchOptions({
    query: params.get('q') || '',
    scope: params.get('scope') || 'book',
    chapterIndex: params.get('chapterIndex'),
    limit: params.get('limit') || undefined,
    cursor: params.get('cursor') || undefined
  });
}

function findExactMatches(text, query) {
  const { normalized: normalizedText, offsets } = normalizedTextWithOffsets(text);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery || !normalizedText) return [];

  const matches = [];
  let cursor = 0;
  while (cursor < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedQuery, cursor);
    if (index < 0) break;
    const first = offsets[index];
    const last = offsets[index + normalizedQuery.length - 1];
    if (first && last) {
      matches.push({
        start: first.start,
        end: last.end,
        text: String(text).slice(first.start, last.end)
      });
    }
    cursor = index + Math.max(1, normalizedQuery.length);
  }
  return matches;
}

function makeSearchSnippet(text, start, end, context = BOOK_SEARCH_SNIPPET_CONTEXT) {
  const source = String(text || '');
  const safeStart = Math.max(0, Math.min(source.length, Number(start) || 0));
  const safeEnd = Math.max(safeStart, Math.min(source.length, Number(end) || safeStart));
  const before = Array.from(source.slice(0, safeStart)).slice(-context).join('');
  const match = source.slice(safeStart, safeEnd);
  const after = Array.from(source.slice(safeEnd)).slice(0, context).join('');
  const snippet = `${safeStart > 0 ? '…' : ''}${before}${match}${after}${safeEnd < source.length ? '…' : ''}`;
  return snippet.replace(/\s+/gu, ' ').trim();
}

/*
 * Which occurrence of the query a result is, counted through its whole
 * chapter (PDF: page). The reader picks the same occurrence in the rendered
 * text when the snippet context cannot tell repeated phrases apart; a count
 * does not depend on code-point versus UTF-16 offsets.
 *
 * Chunks overlap and text chunks are trimmed, so the chapter is rebuilt row
 * by row: each row's leading trimmed whitespace is read from the text the
 * previous row already placed. Units are code points for text books (chunk
 * starts are code-point counts) and UTF-16 code units for PDF pages.
 */
function rebuildChapterUnits(rows, { pdf }) {
  const units = [];
  const lead = new Map();
  for (const row of rows) {
    const start = Number(row.startOffset) || 0;
    const chars = pdf ? String(row.bodyText || '').split('') : Array.from(String(row.bodyText || ''));
    // A chunk's start falls inside the previous chunk's text (they overlap
    // by AI_FTS_CHUNK_OVERLAP), so whitespace trimmed off its front is
    // already in place there.
    let trimmed = 0;
    if (!pdf) {
      while (units[start + trimmed] !== undefined && /\s/u.test(units[start + trimmed])) trimmed += 1;
    }
    lead.set(Number(row.rowid), trimmed);
    chars.forEach((char, index) => { units[start + trimmed + index] = char; });
  }
  return { units, lead };
}

function occurrencesInUnits(units, query) {
  const needle = normalizeSearchText(query);
  let normalized = '';
  const unitAt = [];
  for (let index = 0; index < units.length; index += 1) {
    const char = units[index];
    if (char === undefined || /\s/u.test(char)) continue;
    const folded = char.toLocaleLowerCase();
    normalized += folded;
    for (let fold = 0; fold < folded.length; fold += 1) unitAt.push(index);
  }
  const found = [];
  if (!needle) return { found, length: normalized.length };
  let cursor = 0;
  while (cursor < normalized.length) {
    const at = normalized.indexOf(needle, cursor);
    if (at < 0) break;
    found.push({ unit: unitAt[at], normalized: at });
    cursor = at + Math.max(1, needle.length);
  }
  return { found, length: normalized.length };
}

/**
 * Places each match in its chapter: the position in chapter units (the same
 * for a match seen in two overlapping chunks) and which occurrence it is.
 * Chapters are rebuilt lazily, once per search request.
 */
function chapterOccurrenceLocator(db, query, bookType) {
  const pdf = bookType === 'pdf';
  const chapters = new Map();
  const select = db.prepare(`
    SELECT ai_chunks.rowid, ai_chunks.startOffset, ai_chunk_text.bodyText
    FROM ai_chunks INNER JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
    WHERE ai_chunks.chapterIndex = ?
    ORDER BY ai_chunks.rowid`);
  const chapterFor = (chapterIndex) => {
    if (!chapters.has(chapterIndex)) {
      const { units, lead } = rebuildChapterUnits(select.all(chapterIndex), { pdf });
      const occurrences = occurrencesInUnits(units, query);
      chapters.set(chapterIndex, { ...occurrences, lead, byUnit: new Map(occurrences.found.map((item, index) => [item.unit, index])) });
    }
    return chapters.get(chapterIndex);
  };
  return (row, match) => {
    const chapter = chapterFor(Number(row.chapterIndex));
    const inRow = pdf ? match.start : Array.from(String(row.bodyText || '').slice(0, match.start)).length;
    const unit = (Number(row.startOffset) || 0) + (chapter.lead.get(Number(row.rowid)) || 0) + inRow;
    const occurrence = chapter.byUnit.get(unit);
    if (occurrence === undefined) return { unit };
    return {
      unit,
      occurrence,
      occurrences: chapter.found.length,
      position: chapter.length ? Math.round((chapter.found[occurrence].normalized / chapter.length) * 1e6) / 1e6 : 0
    };
  };
}

function openSearchDatabase(filePath) {
  const Constructor = getDatabaseSync();
  if (!Constructor) return null;
  const db = new Constructor(filePath);
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function searchScopeClause(scope, chapterIndex) {
  return scope === 'chapter'
    ? { sql: ' AND ai_chunks.chapterIndex = ?', params: [chapterIndex] }
    : { sql: '', params: [] };
}

function buildSearchMatch(row, match, bookType = 'text', placed = null) {
  const chapterIndex = Number(row.chapterIndex);
  const startOffset = Number(row.startOffset || 0);
  // Placed: the match's position in its rebuilt chapter, identical for a
  // match seen in two overlapping chunks (chunk starts are code points while
  // in-chunk offsets are UTF-16, so the plain sum was not).
  const absoluteOffset = Number.isSafeInteger(placed?.unit) ? placed.unit : startOffset + match.start;
  const chapterHref = String(row.chapterHref || '');
  const chapterLabel = String(row.chapterLabel || '');
  const pageIndex = chapterIndex;
  const common = {
    chapterIndex,
    chapterHref,
    chapterLabel,
    snippet: makeSearchSnippet(row.bodyText, match.start, match.end),
    matchText: match.text,
    matchOffset: match.start,
    ...(Number.isInteger(placed?.occurrence)
      ? { occurrence: placed.occurrence, occurrences: placed.occurrences, position: placed.position }
      : {})
  };
  if (bookType === 'pdf') {
    return {
      id: `pdf:${pageIndex}:${absoluteOffset}:${match.text.length}`,
      ...common,
      locator: {
        version: 1,
        type: 'pdf',
        pageIndex,
        textOffset: absoluteOffset,
        quote: match.text
      }
    };
  }
  return {
    id: `${chapterIndex}:${absoluteOffset}:${match.text.length}`,
    ...common,
    locator: {
      version: 1,
      type: 'text-search',
      chapterIndex,
      chapterHref,
      offset: absoluteOffset,
      text: match.text
    }
  };
}

async function searchBookText(book, dataRoot, options = {}) {
  const normalized = normalizeBookSearchOptions(options);
  const unavailable = {
    available: false,
    query: normalized.query,
    scope: normalized.scope,
    results: [],
    hasMore: false,
    nextCursor: null,
    truncated: false
  };
  const unavailableForBook = (reason = null) => ({
    ...unavailable,
    ...(book.type === 'pdf' && reason ? { unavailableReason: reason } : {})
  });

  let filePath;
  try {
    filePath = await ensureIndex(book, dataRoot, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw Object.assign(new Error('PDF search was cancelled'), { code: 'PDF_EXTRACTION_ABORTED' });
    const reason = book.type === 'pdf'
      ? error?.code === 'PDF_EXTRACTION_BUDGET' ? 'pdf_extraction_limit'
        : error?.code === 'PDF_PASSWORD_REQUIRED' ? 'pdf_password_protected'
          : 'pdf_text_unavailable'
      : null;
    return unavailableForBook(reason);
  }
  if (!filePath) return unavailableForBook(book.type === 'pdf' ? 'pdf_text_unavailable' : null);
  if (options.signal?.aborted) throw Object.assign(new Error('PDF search was cancelled'), { code: 'PDF_EXTRACTION_ABORTED' });

  let db;
  try {
    db = openSearchDatabase(filePath);
    if (!db) return unavailable;

    if (book.type === 'pdf') {
      const statusRow = db.prepare("SELECT value FROM ai_meta WHERE key = 'pdfSearchStatus'").get();
      if (statusRow?.value === 'no-text') return unavailableForBook('pdf_no_searchable_text');
    }

    const context = normalized.cursor;
    if (context && (context.b !== digest(book.id)
      || context.q !== digest(normalized.query)
      || context.s !== normalized.scope
      || context.c !== normalized.chapterIndex
      || context.l !== normalized.limit)) {
      throw searchCursorError('搜索条件已变化，请重新搜索');
    }
    const fingerprintRow = db.prepare("SELECT value FROM ai_meta WHERE key = 'fingerprint'").get();
    const fingerprint = fingerprintRow?.value;
    if (context && (!fingerprint || context.f !== digest(fingerprint))) {
      throw searchCursorError('书籍索引已更新，请重新搜索', 409);
    }

    const scope = searchScopeClause(normalized.scope, normalized.chapterIndex);
    const ftsQuery = toFtsQuery(normalized.query);
    const candidateLimit = BOOK_SEARCH_MAX_CANDIDATES + 1;
    const rowidClause = context ? ` AND ai_chunks.rowid ${context.i ? '>=' : '>'} ?` : '';
    const seekParams = context ? [context.r] : [];
    const baseSelect = `
      SELECT
        ai_chunks.rowid,
        ai_chunks.chapterIndex,
        ai_chunks.chapterHref,
        ai_chunks.chapterLabel,
        ai_chunks.startOffset,
        ai_chunk_text.bodyText
      FROM ai_chunks
      INNER JOIN ai_chunk_text ON ai_chunk_text.rowid = ai_chunks.rowid
    `;
    let rows;
    if (ftsQuery) {
      rows = db.prepare(`${baseSelect}
        WHERE ai_chunks MATCH ?${scope.sql}${rowidClause}
        ORDER BY ai_chunks.rowid
        LIMIT ?`).all(ftsQuery, ...scope.params, ...seekParams, candidateLimit);
    } else {
      rows = db.prepare(`${baseSelect}
        WHERE 1 = 1${scope.sql}${rowidClause}
        ORDER BY ai_chunks.rowid
        LIMIT ?`).all(...scope.params, ...seekParams, candidateLimit);
    }

    const candidateTruncated = rows.length > BOOK_SEARCH_MAX_CANDIDATES;
    const page = [];
    const unique = new Set();
    let resultTruncated = false;
    let lastScannedRowId = context?.r || 0;
    let continuationRowId = null;
    let continuationInclusive = false;
    const previousKey = context?.k || null;
    const isAfterKey = (result) => !previousKey
      || result.chapterIndex > previousKey[0]
      || (result.chapterIndex === previousKey[0]
        && (result.locator.type === 'pdf' ? result.locator.textOffset : result.locator.offset) > previousKey[1]);
    const place = chapterOccurrenceLocator(db, normalized.query, book.type);
    for (const row of rows.slice(0, BOOK_SEARCH_MAX_CANDIDATES)) {
      lastScannedRowId = Number(row.rowid);
      for (const match of findExactMatches(row.bodyText, normalized.query)) {
        const result = buildSearchMatch(row, match, book.type, place(row, match));
        if (!isAfterKey(result) || unique.has(result.id)) continue;
        unique.add(result.id);
        page.push({ result, rowid: Number(row.rowid) });
        if (page.length > normalized.limit) {
          resultTruncated = true;
          break;
        }
      }
      if (resultTruncated) break;
    }

    const hasMore = resultTruncated || candidateTruncated;
    if (resultTruncated) {
      continuationRowId = page[normalized.limit - 1].rowid;
      continuationInclusive = true;
    } else if (candidateTruncated) {
      continuationRowId = lastScannedRowId;
    }
    const visible = page.slice(0, normalized.limit);
    const lastVisible = visible.at(-1)?.result;
    const cursorKey = lastVisible
      ? [lastVisible.chapterIndex, lastVisible.locator.type === 'pdf'
        ? lastVisible.locator.textOffset
        : lastVisible.locator.offset]
      : previousKey;
    const nextCursor = hasMore && continuationRowId
      ? encodeSearchCursor({
        v: 1,
        b: digest(book.id),
        q: digest(normalized.query),
        s: normalized.scope,
        c: normalized.chapterIndex,
        l: normalized.limit,
        f: digest(fingerprint || ''),
        r: continuationRowId,
        i: continuationInclusive,
        k: cursorKey
      })
      : null;
    return {
      available: true,
      query: normalized.query,
      scope: normalized.scope,
      results: visible.map(({ result }) => result),
      hasMore,
      nextCursor,
      truncated: hasMore
    };
  } catch (error) {
    if (error?.code === 'SEARCH_CURSOR_INVALID' || error?.code === 'SEARCH_CURSOR_STALE') throw error;
    return unavailable;
  } finally {
    db?.close();
  }
}

module.exports = {
  BOOK_SEARCH_MAX_CANDIDATES,
  BOOK_SEARCH_MAX_LIMIT,
  BOOK_SEARCH_MAX_QUERY_LENGTH,
  BOOK_SEARCH_SNIPPET_CONTEXT,
  findExactMatches,
  makeSearchSnippet,
  rebuildChapterUnits,
  occurrencesInUnits,
  normalizeBookSearchOptions,
  parseBookSearchParams,
  searchBookText
};
