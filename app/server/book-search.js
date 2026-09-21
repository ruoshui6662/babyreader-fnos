'use strict';

const { ensureIndex, toFtsQuery } = require('./ai-fts');

const BOOK_SEARCH_MAX_QUERY_LENGTH = 80;
const BOOK_SEARCH_DEFAULT_LIMIT = 20;
const BOOK_SEARCH_MAX_LIMIT = 50;
const BOOK_SEARCH_MAX_CANDIDATES = 2000;
const BOOK_SEARCH_SNIPPET_CONTEXT = 64;

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

  return {
    query,
    scope,
    chapterIndex,
    limit: Math.max(1, Math.min(BOOK_SEARCH_MAX_LIMIT, Math.trunc(requestedLimit)))
  };
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

function buildSearchMatch(row, match) {
  const chapterIndex = Number(row.chapterIndex);
  const startOffset = Number(row.startOffset || 0);
  const absoluteOffset = startOffset + match.start;
  const chapterHref = String(row.chapterHref || '');
  const chapterLabel = String(row.chapterLabel || '');
  return {
    id: `${chapterIndex}:${absoluteOffset}:${match.text.length}`,
    chapterIndex,
    chapterHref,
    chapterLabel,
    snippet: makeSearchSnippet(row.bodyText, match.start, match.end),
    matchText: match.text,
    matchOffset: match.start,
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
    truncated: false
  };

  let filePath;
  try {
    filePath = await ensureIndex(book, dataRoot);
  } catch {
    return unavailable;
  }
  if (!filePath) return unavailable;

  let db;
  try {
    db = openSearchDatabase(filePath);
    if (!db) return unavailable;

    const scope = searchScopeClause(normalized.scope, normalized.chapterIndex);
    const ftsQuery = toFtsQuery(normalized.query);
    const candidateLimit = BOOK_SEARCH_MAX_CANDIDATES + 1;
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
        WHERE ai_chunks MATCH ?${scope.sql}
        ORDER BY CAST(ai_chunks.chapterIndex AS INTEGER), CAST(ai_chunks.startOffset AS INTEGER), ai_chunks.rowid
        LIMIT ?`).all(ftsQuery, ...scope.params, candidateLimit);
    } else {
      rows = db.prepare(`${baseSelect}
        WHERE 1 = 1${scope.sql}
        ORDER BY CAST(ai_chunks.chapterIndex AS INTEGER), CAST(ai_chunks.startOffset AS INTEGER), ai_chunks.rowid
        LIMIT ?`).all(...scope.params, candidateLimit);
    }

    const candidateTruncated = rows.length > BOOK_SEARCH_MAX_CANDIDATES;
    const unique = new Map();
    for (const row of rows.slice(0, BOOK_SEARCH_MAX_CANDIDATES)) {
      for (const match of findExactMatches(row.bodyText, normalized.query)) {
        const result = buildSearchMatch(row, match);
        const key = result.id;
        if (!unique.has(key)) unique.set(key, result);
        if (unique.size > normalized.limit) break;
      }
      if (unique.size > normalized.limit) break;
    }

    const allResults = [...unique.values()].sort((left, right) => (
      left.chapterIndex - right.chapterIndex
      || left.locator.offset - right.locator.offset
      || left.matchOffset - right.matchOffset
    ));
    return {
      available: true,
      query: normalized.query,
      scope: normalized.scope,
      results: allResults.slice(0, normalized.limit),
      truncated: candidateTruncated || allResults.length > normalized.limit
    };
  } catch {
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
  normalizeBookSearchOptions,
  searchBookText
};
