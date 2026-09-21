# Full-Text Search Task 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-level regression coverage for the active full-text search flow across supported book formats and desktop/mobile reader surfaces.

**Architecture:** Reuse the existing deterministic E2E library fixtures and reader helpers. Test search through visible controls and real HTTP responses; do not call internal search functions or change the server search/ranking implementation. Use a mobile-only Playwright describe block so the existing desktop project and unrelated E2E suites keep their current behavior.

**Tech Stack:** Playwright Chromium, existing E2E fixture server, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-21-full-text-search-design.md`

## Global Constraints

- Search remains independent from AI retrieval, prompts, streaming, conversation history, and token usage.
- Search results must be rendered as safe text and must navigate only within the currently opened book.
- Existing desktop, mobile, single-page, double-page, continuous-scroll, bookmark, annotation, and AI behavior must remain unchanged.
- E2E tests must use the existing temporary fixture library and must not copy user books into the repository.
- This task changes tests and test plans only; production search behavior is already delivered by Task 3.

## Review Focus

- The newly enabled search button must issue exactly one dedicated search request and must not call an AI route.
- A result containing HTML-looking text must remain plain text in the browser.
- An EPUB result from another chapter must load that chapter and expose the matching text.
- TXT and Markdown books must expose the same search surface and result contract as EPUB.
- A mobile user must be able to reveal the mobile toolbar and open search without relying on the desktop floating toolbar.

## File Map

- Modify: `e2e/reader.spec.js` — update the stale reserved-search test and include `reader/search.js` in module loading assertions.
- Create: `e2e/search.spec.js` — desktop multi-format and mobile search acceptance tests.
- Create: `.superpowers/sdd/2026-09-21-full-text-search-task4/progress.md` — ignored execution ledger.

### Task 4: Browser search acceptance

**Interfaces:**

- Consumes: `/api/books/:bookId/search`, the visible `#btnSearch` and `#btnMobileSearch` launchers, `#readerSearchForm`, and `.reader-search-result` rows.
- Produces: deterministic Playwright coverage for desktop Markdown/TXT/EPUB search, EPUB chapter navigation, safe result rendering, AI-route isolation, and mobile search entry.

- [x] **Step 1: Write failing browser assertions**

  Replace the existing reserved-search E2E test with active behavior assertions and add `e2e/search.spec.js` covering the cases listed above.

- [x] **Step 2: Run the focused browser tests and verify the expected RED state**

  Run:

  ```powershell
  npx playwright test e2e/reader.spec.js e2e/search.spec.js --project=chromium --workers=1 --grep "search|Search"
  ```

  Expected: the old reserved test fails against the now-enabled search behavior before its assertions are updated; after test updates, any failure must identify a real browser integration defect rather than a fixture or selector error.

- [x] **Step 3: Update only the E2E contracts**

  Keep the production search implementation unchanged. Add assertions for:

  ```js
  await page.locator('#btnSearch').click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await page.locator('#readerSearchQuery').fill('E2E Reader');
  await page.locator('#readerSearchForm').press('Enter');
  await expect(page.locator('.reader-search-result')).toContainText('E2E Reader');
  ```

  For EPUB, search `E2E EPUB Chapter 2`, click the result labelled `第二章`, and assert the article contains `E2E EPUB Chapter 2`. For TXT and Markdown, assert a result appears without requiring EPUB chapter state. Register request listeners and assert ordinary search requests match `/api/books/<64-hex-id>/search` while no `/ai/search` request is observed. Assert a result snippet containing `<img>` is text-only when returned by a route stub.

- [x] **Step 4: Run focused and full browser tests**

  Run:

  ```powershell
  npx playwright test e2e/reader.spec.js e2e/search.spec.js --project=chromium --workers=1 --grep "search|Search"
  npx playwright test e2e/reader.spec.js e2e/search.spec.js --project=chromium --workers=1
  ```

  Expected: all focused search tests and the selected reader/search E2E suite pass with no page errors.

- [x] **Step 5: Run Node regression and structure validation**

  Run:

  ```powershell
  npm test
  npm run check
  git diff --check
  ```

  Expected: zero failures, only documented platform skips, and structure validation passes.

- [x] **Step 6: Commit the browser acceptance task**

  ```powershell
  git add e2e/reader.spec.js e2e/search.spec.js docs/superpowers/plans/2026-09-21-full-text-search-task4.md
  git commit -m "test: cover reader full-text search"
  ```
