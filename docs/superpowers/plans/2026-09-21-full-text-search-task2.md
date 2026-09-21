# Full-Text Search Task 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing independent book-search service through a safe, authenticated GET API without enabling the frontend search surface or touching AI retrieval.

**Architecture:** Add a small query-parameter adapter in `book-search.js`, pass `URLSearchParams` from the request dispatcher into `handleApi`, and add a dedicated `/api/books/:bookId/search` route. The route resolves the book through the existing `findBook()` authorization path, calls `searchBookText()`, returns its bounded contract, and reports unavailable indexes without exposing filesystem or database details.

**Tech Stack:** Node.js CommonJS, built-in HTTP server, `URLSearchParams`, Node test runner, temporary authorized library roots, existing SQLite FTS service.

**Spec:** `docs/superpowers/specs/2026-09-21-full-text-search-design.md`

## Global Constraints

- The endpoint is `GET /app/babyreader-fnos/api/books/:bookId/search`.
- Required query parameter: `q`; optional parameters are `scope=book|chapter`, `chapterIndex`, and `limit`.
- Search is independent from AI configuration, prompts, streaming, conversations, network calls, and token usage.
- Book IDs remain restricted to 64 lowercase hexadecimal characters and books are resolved only by `findBook()`.
- Query, scope, chapter index, and limit validation must produce controlled `400` responses; no user-controlled value is interpolated into SQL.
- Search results remain bounded by the Task 1 service; the API never returns paths, raw SQLite errors, or full book/chapter text.
- Existing `POST /api/books/:bookId/ai/search` behavior and all existing routes remain unchanged.
- The reserved search UI stays disabled; no frontend adapter or FPK change belongs to this task.

## Review Focus

- A request without fnOS identity must be rejected before book/search work with `401`.
- An unknown or unauthorized book ID must not cause filesystem access outside the existing library resolver and must return `404`.
- Invalid `q`, `scope`, `chapterIndex`, or `limit` must return `400` without creating an index.
- Query strings must reach the API dispatcher through `URLSearchParams`; ignoring the URL query would silently turn every request into an empty search.
- An unavailable SQLite/FTS service must produce a controlled response and must not expose an exception message or local path.

## File Map

- Modify `app/server/book-search.js`: add the pure query-parameter adapter used by the API.
- Modify `app/server/index.js`: import the independent service, pass URL search parameters to the API handler, and add the dedicated GET route.
- Create `tests/search-api.test.js`: real HTTP-level tests against a temporary authorized library and the development server handler.
- Create `.superpowers/sdd/2026-09-21-full-text-search-task2/progress.md`: ignored execution ledger.

### Task 2: Add the independent search API

**Files:**
- Modify: `app/server/book-search.js`
- Modify: `app/server/index.js`
- Create: `tests/search-api.test.js`

**Interfaces:**
- Consumes: `searchBookText(book, dataRoot, options) -> Promise<SearchResult>` from Task 1 and `findBook(bookId)` from the existing server.
- Produces: `parseBookSearchParams(searchParams) -> { query, scope, chapterIndex, limit }` and `GET /app/babyreader-fnos/api/books/:bookId/search` returning the Task 1 `SearchResult` JSON contract.

- [x] **Step 1: Write failing adapter and HTTP tests**

  Add tests that assert:

  ```js
  parseBookSearchParams(new URLSearchParams('q=%E8%9B%8B%E7%99%BD%E8%B4%A8&scope=chapter&chapterIndex=2&limit=50'))
  // { query: '蛋白质', scope: 'chapter', chapterIndex: 2, limit: 50 }
  ```

  Start a real `http.createServer()` around exported `handleRequest()` with a temporary `TRIM_PKGVAR`, a temporary `TRIM_PKGETC/settings.json`, and one authorized 64-hex-ID TXT book in `index/library.json`. Cover:

  - authenticated success returning `200`, `available`, bounded result fields, and no `path`/`raw` fields;
  - missing fnOS identity returning `401`;
  - invalid/missing query parameters returning `400`;
  - unknown book returning `404`;
  - chapter scope reaching the search service and returning the requested scope.

- [x] **Step 2: Run the focused tests and verify the RED state**

  Run:

  ```powershell
  node --test tests/search-api.test.js
  ```

  Expected: FAIL because `parseBookSearchParams` and the `/search` route do not yet exist; the test must not pass through a different endpoint.

- [x] **Step 3: Implement the query adapter and route**

  In `book-search.js`, parse only the declared query keys and delegate validation to `normalizeBookSearchOptions`:

  ```js
  function parseBookSearchParams(searchParams) {
    const params = searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams || '');
    return normalizeBookSearchOptions({
      query: params.get('q') || '',
      scope: params.get('scope') || 'book',
      chapterIndex: params.get('chapterIndex'),
      limit: params.get('limit') || undefined
    });
  }
  ```

  Export the adapter. In `index.js`, import `searchBookText` and `parseBookSearchParams`, change `handleApi(request, response, pathname)` to accept an optional fourth `searchParams` argument, and pass `url.searchParams` from `handleRequest`. Add the GET route after `gatewayUser()` and before AI routes:

  ```js
  const searchMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/search$`));
  if (request.method === 'GET' && searchMatch) {
    const book = await findBook(searchMatch[1]);
    const options = parseBookSearchParams(searchParams);
    const result = await searchBookText(book, DATA_ROOT, options);
    return sendJson(response, 200, result);
  }
  ```

  Let the existing top-level error boundary convert `SEARCH_QUERY_INVALID` to `400`; keep unavailable search as a `200` response with `available: false` so the client can show a recoverable local-index state without a server error page.

- [x] **Step 4: Run focused tests and fix only implementation defects**

  Run:

  ```powershell
  node --test tests/search-api.test.js
  ```

  Expected: all API tests pass, including the real search result and the security/error cases.

- [x] **Step 5: Run regression verification**

  Run:

  ```powershell
  npm test
  npm run check
  git diff --check
  ```

  Expected: zero failures, structure validation passes, and no whitespace errors. Confirm existing AI route tests still pass and no UI/search-button files changed.

- [x] **Step 6: Commit the API task**

  Commit only the Task 2 implementation and tests with:

  ```text
  feat: expose independent book search api
  ```
