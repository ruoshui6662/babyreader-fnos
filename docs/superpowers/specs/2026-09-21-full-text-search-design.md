# Full-Text Search Design Specification

**Status:** Approved design, pending implementation-plan review
**Date:** 2026-09-21
**Scope:** Search inside the currently opened book using the existing local SQLite FTS index

## 1. Goal

Enable the existing independent reader search surface for EPUB, TXT, and Markdown books. A user can search the whole book or the current chapter, see short safe excerpts, and navigate to the matching chapter and reading position.

The feature is a normal reader utility. It is not an AI retrieval mode and must remain independent from AI configuration, AI prompts, AI streaming, conversation history, and token usage.

## 2. Existing constraints and reuse

The server already builds one SQLite FTS5 index per book under the application data root. The index contains:

- tokenized `ai_chunks` data for candidate retrieval;
- original chunk text in `ai_chunk_text`;
- chapter index, chapter href, chapter label, and chunk start offset;
- schema and source fingerprint metadata.

The first search implementation reuses this index and does not add a second index or change the existing AI retrieval schema. The search module may call the existing index builder/reader through an explicit server-side helper boundary, but it must not call `requestOpenAiAnswer`, `requestOpenAiStream`, or the AI search route.

## 3. User-facing behavior

### 3.1 Entry and scope

- Enable the reserved search toolbar action when a book is open.
- Keep search as the existing independent sheet, not a content tab and not the AI modal.
- Provide two scopes: `全书` and `本章`.
- Default to `全书`.
- When `本章` is selected, use the current reader chapter index; if no valid chapter is available, show a recoverable validation message and do not issue a request.

### 3.2 Results

Each result contains only:

- chapter index and display label;
- a short plain-text excerpt around the exact match;
- a semantic search locator sufficient for navigation;
- a stable result identity for DOM rendering.

Results are returned in reading order: chapter index, source offset, and match offset. The server removes duplicate matches caused by overlapping index chunks. The response is bounded to 50 displayed results and may include `truncated: true` when more matches exist.

The UI renders all returned text with `textContent` or equivalent safe DOM APIs. Server-provided text is never treated as HTML.

### 3.3 Navigation

- EPUB results load the target chapter and navigate to the matching text when possible.
- TXT/Markdown results navigate within the rendered article when possible.
- If an exact DOM match cannot be found after the chapter is loaded, fall back to the chapter start and show a non-blocking hint.
- Navigation must work in single-page, double-page, and continuous-scroll modes without changing the saved reading mode.

## 4. Server API

Add a dedicated endpoint:

```text
GET /app/babyreader-fnos/api/books/:bookId/search
```

Query parameters:

```text
q             required search text
scope         book | chapter; defaults to book
chapterIndex  required and validated for chapter scope
limit         optional, bounded to 1..50, default 20
```

Success response shape:

```json
{
  "available": true,
  "query": "蛋白质",
  "scope": "book",
  "results": [
    {
      "id": "chapter-0:123:4",
      "chapterIndex": 0,
      "chapterHref": "OPS/chapter.xhtml",
      "chapterLabel": "第一章",
      "snippet": "……有关蛋白质的内容……",
      "matchText": "蛋白质",
      "matchOffset": 4,
      "locator": {
        "version": 1,
        "type": "text-search",
        "chapterIndex": 0,
        "chapterHref": "OPS/chapter.xhtml",
        "offset": 123,
        "text": "蛋白质"
      }
    }
  ],
  "truncated": false
}
```

The existing `POST /api/books/:bookId/ai/search` contract remains unchanged.

## 5. Matching and ranking

The first version uses a two-step search:

1. SQLite FTS5 retrieves a bounded candidate set using parameterized `MATCH` queries and the existing tokenized index.
2. The server verifies the original `ai_chunk_text.bodyText` against the normalized query, extracts exact occurrences, removes overlap duplicates, and orders matches by reading position.

Normalization is deliberately conservative: trim input, normalize whitespace for matching, and use locale-aware case folding where applicable. It must not rewrite or expose the book text. The maximum query length must be small enough that the existing chunk overlap remains sufficient for exact matching. Queries that produce no FTS terms use a separately bounded original-text scan; this path is still limited by the candidate cap and never reads outside the selected book index.

The server does not use BM25 relevance as the final user-visible order. Relevance is useful for candidate retrieval; reader search results should be predictable and navigable in book order.

## 6. Security and resource boundaries

- Authenticate through the existing fnOS gateway identity.
- Resolve the book only through the existing `findBook()` path and authorized roots.
- Accept only a 64-character hexadecimal book ID in the route.
- Reject empty or overlong queries with `400`.
- Validate `scope`, `chapterIndex`, and `limit`; never interpolate them into SQL.
- Use prepared statements for all FTS and metadata queries.
- Never return the source file path, raw SQLite path, complete chapter, or complete book.
- Cap candidate rows, output results, excerpt length, and query length.
- Do not persist query text or search history in this phase.
- If SQLite/FTS is unavailable, return a controlled search-unavailable response; AI local fallback and normal reading remain unchanged.
- Do not add network access or provider calls.

## 7. Compatibility and non-goals

This phase does not:

- modify AI retrieval ranking, prompts, source citations, streaming, or conversations;
- add embeddings, vector search, fuzzy search, OCR, or cross-library search;
- change the existing SQLite schema or index lifecycle;
- persist search history;
- add MOBI, AZW3, or PDF parsing;
- change bookmark, annotation, settings, or reading-progress data.

## 8. Verification requirements

The implementation is accepted only when all of the following are covered:

- pure search tests for exact matching, CJK text, English text, whitespace normalization, overlapping chunks, result limits, scope filtering, and no-result behavior;
- API tests for authentication, book ownership/path validation, malformed parameters, and controlled FTS failure;
- DOM tests for opening the sheet, loading/empty/error states, safe text rendering, cancellation/race handling, and result navigation;
- Playwright coverage for desktop and mobile, EPUB/TXT/Markdown, single/double/continuous modes;
- regression runs proving no AI request is made by ordinary search and existing AI/bookmark/annotation tests remain green;
- FPK build and fnOS x86_64 acceptance before release.
