# Full-Text Search Task 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side, exact-match book search service over the existing per-book SQLite FTS index, with bounded results and chapter-aware locators, without changing the API or AI retrieval flow.

**Architecture:** Create `app/server/book-search.js` as a narrow search-service boundary. It reuses the existing `ensureIndex()` and `toFtsQuery()` helpers only for local candidate retrieval, then verifies matches against the original `ai_chunk_text.bodyText`, deduplicates overlapping chunks, creates short plain-text snippets, and returns results in reading order. The service has no HTTP, AI-provider, user-session, or UI dependencies; those are later tasks.

**Tech Stack:** Node.js CommonJS, built-in `node:sqlite` through the existing FTS module, Node test runner, `fflate` EPUB fixtures.

**Spec:** `docs/superpowers/specs/2026-09-21-full-text-search-design.md`

## Global Constraints

- Reuse the existing SQLite FTS5 index and do not change its schema or AI ranking behavior.
- Do not add or call an AI route/provider; this service must not consume AI tokens.
- Search only a supplied, already-authorized book object; never accept a filesystem path from a query option.
- Bound query length to 80 Unicode code points, result count to 1..50, candidate rows to 2000, and snippet context to 64 characters per side.
- Use prepared statements for every SQL query and never interpolate user-controlled values into SQL.
- Return snippets and locator metadata only; never return the raw SQLite path or an entire chapter/book.
- Do not persist query text or search history.
- Preserve the existing `searchBook()` AI function and all current tests.

## Review Focus

- A query that matches FTS candidate tokens but not the literal original text must not appear in results; Task 1 tests exact original-text verification.
- Overlapping 900-character AI chunks must not duplicate one literal occurrence; Task 1 tests absolute-offset deduplication.
- A chapter-scoped query must not return another chapter; Task 1 tests SQL scope filtering and result metadata.
- A one-character/punctuation-heavy query with no FTS terms must use the bounded fallback path rather than silently returning unrelated results; Task 1 tests the fallback.
- A book with more matching candidates than the cap must return a deterministic reading-order prefix and `truncated: true`; Task 1 tests the cap and flag.

## File Map

- Create `app/server/book-search.js`: validation, candidate retrieval, exact matching, deduplication, snippets, and result contract.
- Create `tests/book-search.test.js`: pure helper tests plus real temporary TXT/EPUB SQLite FTS integration tests.
- Do not modify `app/server/ai-fts.js`, `app/server/index.js`, `app/ui`, or package dependencies in this task.
- Create `.superpowers/sdd/full-text-search-task1/progress.md` as the execution ledger; it is ignored workspace state and is not part of the product release.

## Task 1: Independent search service

**Interfaces:**

- Consumes from existing code: `ensureIndex(book, dataRoot) -> Promise<string|null>` and `toFtsQuery(value) -> string` from `app/server/ai-fts.js`.
- Produces for later API/UI tasks: `searchBookText(book, dataRoot, options) -> Promise<SearchResult>` where `options` is `{ query, scope?: 'book'|'chapter', chapterIndex?: number|null, limit?: number }` and `SearchResult` is `{ available: boolean, query: string, scope: string, results: SearchMatch[], truncated: boolean }`.
- Produces for tests and later callers: `normalizeBookSearchOptions(options)`, `findExactMatches(text, query)`, and `makeSearchSnippet(text, start, end, context?)`.

### Step 1: Write the failing tests

- Create `tests/book-search.test.js`.
- Add tests for `findExactMatches()` covering Chinese and English literal matches, case folding, whitespace normalization, and the returned local offsets.
- Add a temporary TXT integration test that creates a 64-character book ID, writes a book with repeated Chinese text, calls `searchBookText()`, and asserts reading-order results, plain snippets, and a locator with `type: 'text-search'`.
- Add a temporary EPUB integration test using `fflate.zipSync()` with two spine chapters, then assert `scope: 'chapter'` returns only the requested chapter and preserves `chapterHref`/`chapterLabel`.
- Add a fallback test with a one-character query that produces no FTS terms and still returns only literal matches.
- Add overlap and cap tests using repeated text longer than `AI_FTS_CHUNK_SIZE`; assert unique absolute offsets and `truncated === true` when the candidate cap is exceeded.

### Step 2: Run the focused tests and verify the expected RED state

Run:

```powershell
node --test tests/book-search.test.js
```

Expected: FAIL because `../app/server/book-search` does not exist. Fix only test setup mistakes if the failure is an import/setup error; do not add production code before the missing-module failure is observed.

### Step 3: Implement the minimal pure helpers

Create `app/server/book-search.js` with these boundaries:

```js
const BOOK_SEARCH_MAX_QUERY_LENGTH = 80;
const BOOK_SEARCH_DEFAULT_LIMIT = 20;
const BOOK_SEARCH_MAX_LIMIT = 50;
const BOOK_SEARCH_MAX_CANDIDATES = 2000;
const BOOK_SEARCH_SNIPPET_CONTEXT = 64;

function normalizeBookSearchOptions(options = {}) { /* validate and clamp */ }
function findExactMatches(text, query) { /* return [{ start, end, text }] */ }
function makeSearchSnippet(text, start, end, context = BOOK_SEARCH_SNIPPET_CONTEXT) { /* plain text */ }
```

The normalization must trim, collapse whitespace, and compare case-insensitively while retaining original-text offsets. Reject empty or overlong queries with an error carrying `code: 'SEARCH_QUERY_INVALID'` and `statusCode: 400`; reject invalid scope, chapter index, or limit with the same code.

### Step 4: Implement bounded FTS candidate retrieval and exact result assembly

Implement `searchBookText()` as follows:

1. Normalize options before opening an index.
2. Call `ensureIndex(book, dataRoot)`; return `{ available: false, query, scope, results: [], truncated: false }` when no SQLite/FTS index is available.
3. Open the returned SQLite file with `node:sqlite` and a 5-second busy timeout.
4. If `toFtsQuery(query)` is non-empty, select at most `BOOK_SEARCH_MAX_CANDIDATES + 1` rows from `ai_chunks JOIN ai_chunk_text` with `ai_chunks MATCH ?`, optional parameterized `chapterIndex = ?`, and `ORDER BY CAST(chapterIndex AS INTEGER), CAST(startOffset AS INTEGER), rowid`.
5. If no FTS terms exist, use the same bounded, parameterized chapter filter over the original text table and verify matches in JavaScript; do not interpolate the query into SQL.
6. Scan each original `bodyText` with `findExactMatches()`. Convert each local match to an absolute offset using `startOffset + start`.
7. Deduplicate by `chapterIndex:absoluteOffset:end`, create a plain snippet, and return no more than `limit` results in reading order. Set `truncated` when the candidate cap or result cap proves that more matches exist.
8. Always close the database in `finally`. Never expose the index path or database error details.

The result object must use the exact contract:

```js
{
  id: `${chapterIndex}:${absoluteOffset}:${matchLength}`,
  chapterIndex,
  chapterHref,
  chapterLabel,
  snippet,
  matchText,
  matchOffset: localOffset,
  locator: {
    version: 1,
    type: 'text-search',
    chapterIndex,
    chapterHref,
    offset: absoluteOffset,
    text: matchText
  }
}
```

### Step 5: Run focused tests, then the full Node suite

Run:

```powershell
node --test tests/book-search.test.js
npm test
npm run check
```

Expected: the new search tests pass; the existing suite remains at zero failures; structure validation passes. If a failure is caused by an existing FTS assumption, diagnose it before changing production code and record a ruling in the ledger.

### Step 6: Refactor only after green and commit

- Remove duplicated test fixtures or helper code only if all tests remain green.
- Confirm `git diff --check` is clean.
- Commit only `app/server/book-search.js` and `tests/book-search.test.js` for the implementation, with message:

```text
feat: add bounded independent book search service
```

- The plan and spec commits remain separate from the implementation commit.
