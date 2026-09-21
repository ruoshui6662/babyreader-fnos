# Full-Text Search Task 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing independent search surface in the reader UI, call the new search API, render bounded results safely, and navigate to the matched chapter/text without touching AI behavior.

**Architecture:** Add `reader/search.js` as the search-surface controller. It owns request cancellation, state rendering, result DOM creation, and text-target lookup; it delegates HTTP to `browserHost.searchBook()` and delegates chapter/page movement to existing navigation functions. The existing Drawer surface controller remains the only owner of opening, closing, focus, and modal state.

**Tech Stack:** Browser DOM APIs, existing Reader Shell surface controller, `fetch`/`AbortController`, Node test runner with happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-21-full-text-search-design.md`

## Global Constraints

- Search is an independent reader utility, not an AI retrieval mode.
- Server text is inserted with `textContent`; result snippets are never interpreted as HTML.
- The UI requests at most 20 results and relies on the server's 50-result upper bound.
- Search supports EPUB, Markdown, and TXT books already open in the reader.
- `scope=chapter` uses the current chapter index; `scope=book` is the default.
- A stale or aborted request must not overwrite a newer search state.
- Existing AI, bookmark, annotation, reading-mode, and surface behaviors remain unchanged.

## Review Focus

- A result containing HTML-looking text must render as text, not create DOM elements.
- A second query finishing before the first must keep the second query's results visible.
- Clicking an EPUB result in another chapter must load that chapter before text lookup.
- Empty, unavailable, and truncated responses must have distinct recoverable states.
- Opening search without a current book must remain disabled and must not issue a request.

## File Map

- Modify `app/ui/core/api.js`: add the API adapter for the new GET endpoint.
- Create `app/ui/reader/search.js`: search controller, result rendering, cancellation, and locator navigation.
- Modify `app/ui/shell/drawer.js`: enable search when a document is open and expose the search controller through the existing surface.
- Modify `app/ui/reader/highlights.js`: update desktop/mobile search trigger state.
- Modify `app/ui/index.html`: enable search form controls and add the mobile search entry.
- Modify `app/ui/app.js`: initialize and reset search state with document transitions.
- Modify `app/ui/styles.css`: style result rows, match metadata, and the enabled search form.
- Modify `tests/dom-regression.test.js`: replace the reserved search contract with active UI/API/safe-rendering assertions.

### Task 3: Enable the search surface and result navigation

**Interfaces:**
- Consumes: `window.browserHost.searchBook(bookId, options) -> Promise<SearchResult>`, `readerSurfaceController`, `navigateToEpubChapter()`, `navigateToSemanticTarget()`, and the server result locator.
- Produces: `setupReaderSearch()`, `resetReaderSearch()`, `navigateToSearchResult(result)`, enabled `readerPanels.search`, and a working desktop/mobile `openSearch` action.

- [x] **Step 1: Write the failing DOM contract test**
- [x] **Step 2: Run the focused test and observe the missing-module RED state**
- [x] **Step 3: Add the browser API adapter and search controller**
- [x] **Step 4: Enable the surface and update document/mobile wiring**
- [x] **Step 5: Add search-result styles and run focused DOM tests**
- [x] **Step 6: Run full regression and commit**
