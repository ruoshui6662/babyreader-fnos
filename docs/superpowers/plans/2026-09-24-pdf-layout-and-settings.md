# PDF Layout and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PDF its own continuous/single/double layout setting, reliable spread navigation, responsive fit-width zoom, and format-appropriate settings without changing EPUB/TXT behavior or the PDF page locator.

**Architecture:** Keep PDF rendering in `createPdfReaderController`. Reparent existing `.pdf-page` nodes into spread rows only for effective double layout; never clone canvases or change the zero-based `pageIndex` contract. Store `pdfLayoutMode` beside existing per-user JSON settings, with an explicit server whitelist. The reader surface width determines a temporary narrow-screen fallback; the stored preference remains intact.

**Tech Stack:** Existing non-module BabyReader UI, local PDF.js 6.3.289, Node 22 `node:test`/happy-dom, Playwright Chromium, fnOS FPK packaging.

**Spec:** `docs/superpowers/specs/2026-09-24-pdf-layout-and-settings-design.md`

## Global Constraints

- Work in the **current dirty worktree**. Preserve unrelated modified/untracked files; no reset, checkout, broad formatting, commit, FPK build, or NAS deployment without a separate user request. Tests may create their normal temporary fixtures only.
- The immediately preceding PDF toolbar/zoom changes are an uncommitted baseline, not proof of device acceptance. Record `git status --short` and test results before editing.
- Do not alter book authorization, fnOS identity, PDF Range serving, FTS/schema/locator, PDF.js assets/CSP, EPUB CFI/pagination, TXT behavior, or reading-progress JSON shape.
- `pdfLayoutMode` accepts only `continuous | single | double`; it is distinct from EPUB `readingMode`. Missing/invalid stored values become `continuous`. No OCR, PDF annotation, AI, upload, remote URL, or file writeback.
- The explicit PDF page index remains exact after page-number entry, TOC, search, refresh, and a jump to the right side of a spread. Only a **user scroll into another row** or explicit previous/next changes it.
- Keep visible-page-plus-neighbor rendering, 10,000-page admission limit, 16M canvas-pixel budget, 8192-pixel edge limit, 250k text-layer-character limit, generation cancellation, and existing PDF feature flag. Do not add an unbounded page-dimension cache or fetch every page to determine fit width.
- All format-specific settings visibility must hide the *whole labeled field*, including its custom-select trigger and body-level menu. Never let a hidden PDF-inapplicable control persist an EPUB setting.

## Review Focus

1. Page-group boundary inputs: counts 1/2/3/4/444, first and trailing singleton, right-page direct jump, invalid and out-of-range index.
2. Async/lifecycle failures: rapid book switch, pending `getPage`, pending fit-width request, canceled render, resize during layout switch, and stale scroll events.
3. Geometry/resource failures: mixed portrait/landscape sizes, 899/900 CSS-pixel transition, manual zoom overflow, text-layer/search-rectangle alignment, bounded dimension fetch/cache and rendered-page count.
4. Persistence/security failures: old settings, illegal values, separate fnOS users, concurrent settings saves, PDF setting changes leaking into EPUB/TXT modes.
5. Interaction/regression failures: click/keyboard page controls, search result on right page with panel retained, outline jump, refresh restoration, light/dark mode, EPUB/TXT settings and search, and existing FPK/device gate.

## File Structure and Ownership

| Path | Responsibility |
|---|---|
| `app/ui/reader/pdf.js` | Spread mapping, effective layout, page-node regrouping, page controls, scroll/zoom sequencing, bounded dimension reads. |
| `app/ui/styles.css` | PDF-only row, snap, overflow, narrow-state, and dark-compatible styling. |
| `app/ui/core/state.js` | In-memory `pdfLayoutMode` preference; no change to EPUB `readingMode`. |
| `app/ui/core/user-state.js` | Restore and serialize `pdfLayoutMode` through the existing queued settings save. |
| `app/server/storage.js` | Whitelist/normalize `pdfLayoutMode` in atomic per-user settings update. |
| `app/ui/index.html` | PDF-only layout select, field format markers, appropriate script cache versions. |
| `app/ui/reader/settings.js` | Format-specific visibility and PDF mode change; preserve custom-select lifecycle. |
| `app/ui/app.js` | Apply restored PDF preference when opening PDF; refresh settings visibility after content type switches. |
| `tests/pdf-reader.test.js` | Spread/layout/fit-width/cancellation DOM tests, extending current happy-dom harness. |
| `tests/reader-core.test.js`, `tests/dom-regression.test.js` | UID isolation, settings normalization, EPUB/TXT non-regression. |
| `e2e/pdf-reader.spec.js` | Real-browser geometry, controls, search/TOC, persistence, narrow-width and theme checks. |
| `docs/superpowers/progress/2026-09-23-pdf-reader-progress.md` | Record per-task evidence and any unresolved baseline failures. |

The existing `reader/pdf.js` already owns `pages`, `pageSizes`, `renderedPages`, `generation`, `zoomRevision`, `fitRequestId`, `goToPdfPage`, `fitPdfWidth`, and `setPageFromScroll`. Reuse those mechanisms. Do not add a second PDF viewer or a new server endpoint.

## Task 0 — Freeze the Current Contract and Baseline

- [ ] Inspect `git status --short` and `git diff --` for each overlapping tracked file above; note pre-existing changes in the progress document without staging them.
- [ ] Run `node --test tests/pdf-reader.test.js tests/reader-core.test.js tests/dom-regression.test.js`; record counts and failures. Run `npx playwright test e2e/pdf-reader.spec.js --project=chromium` and `npm run check:portable`; record exact output.
- [ ] Confirm the existing page locator is `{version:1,type:'pdf',pageIndex}` and search/TOC ultimately call `goToPdfPage(pageIndex)`; preserve these call sites.
- [ ] Freeze expected layout API: `controller.setLayoutMode(mode)`, `controller.getEffectiveLayoutMode()`, and `controller.getCurrentPageIndex()`; `setLayoutMode` returns `false` for unsupported values and never writes settings itself.
- [ ] Do **not** correct unrelated baseline failures here. In particular, distinguish a stale `e2e/reader.spec.js` script-version assertion from a PDF regression. Stop and report if the PDF-specific baseline fails before implementation.

## Task 1 — Pure Spread Mapping and Controller Layout

**Files:** `app/ui/reader/pdf.js`, `app/ui/styles.css`, `tests/pdf-reader.test.js`.

- [ ] Add a failing table-driven unit test for `pdfSpreadForPage(pageIndex, pageCount)` with examples below; run `node --test tests/pdf-reader.test.js` and verify this new test fails for the absent helper.

```js
assert.deepEqual(pdfSpreadForPage(0, 4), { firstPageIndex: 0, pageIndices: [0] });
assert.deepEqual(pdfSpreadForPage(2, 4), { firstPageIndex: 1, pageIndices: [1, 2] });
assert.deepEqual(pdfSpreadForPage(3, 4), { firstPageIndex: 3, pageIndices: [3] });
assert.deepEqual(pdfSpreadForPage(443, 444), { firstPageIndex: 443, pageIndices: [443] });
```

- [ ] Implement the pure mapping in `pdf.js`: page 0 is alone; for `pageIndex >= 1`, start at `1 + 2 * Math.floor((pageIndex - 1) / 2)` and include `start + 1` only if `< pageCount`. Reject non-integer/out-of-range inputs instead of fabricating a page. Test page counts 1, 2, 3, 4, 444 and adjacent-group boundaries.
- [ ] Add a failing DOM test that opens a four-page fake PDF, switches to double, asserts rows `[0]`, `[1,2]`, `[3]`, asserts the **same original page DOM nodes** remain in `pages`, and switches back to continuous without losing nodes/text-layer state.
- [ ] Implement `setLayoutMode` with `layoutPreference` and `effectiveLayoutMode`. Base effective double on `availablePageWidth() >= 900`; otherwise use single while preserving preference. Only rebuild row wrappers when the effective mode changes, using a `DocumentFragment` to reparent existing nodes. On close, clear row state and associated dataset; on reopen, reapply the current preference. Do not reparent on every resize tick.
- [ ] Add PDF-only CSS for `.pdf-spread` as a centered flex row, first/trailing singletons centered, `single`/`double` scroll snap and horizontal overflow. Keep continuous mode's existing children/appearance unchanged. `single` must retain all pages in the DOM and navigate one page at a time.
- [ ] Run `node --test tests/pdf-reader.test.js`; require all PDF unit tests green before continuing. No commit is requested.

## Task 2 — Spread Navigation with Exact Page Identity

**Files:** `app/ui/reader/pdf.js`, `tests/pdf-reader.test.js`, `e2e/pdf-reader.spec.js`.

- [ ] Write failing tests: in double, explicit `goToPdfPage(2)` records/display page 3 (right page); a synthetic scroll event in the **same spread** keeps pageIndex 2; next goes to index 3; previous returns to index 1. In single/continuous, previous/next move exactly one page. Test disabled controls on first/last groups.
- [ ] In `updatePageControls`, derive previous/next disabled from group boundaries only for effective double. Route the existing PDF toolbar buttons through a shared `stepPdfPage(direction)`; do not introduce a new global keyboard shortcut. Leave page-number entry, TOC and search wired to the exact `goToPdfPage` target.
- [ ] In `setPageFromScroll`, identify the visible row. If it is the current row, **do not** replace a right-page selection with its left-page sibling. If the user moves to another row, record its first real page. Ignore layout/zoom-induced transient scroll until the new geometry has stabilized; use the existing generation/zoom-revision guards, not a fixed arbitrary timeout.
- [ ] Preserve `pageIndex` while switching modes and through `setPdfScale`. Add an E2E assertion that a search hit on page index 2 remains selected with the search drawer open after the PDF is switched to double; the visible hit remains aligned with its text layer.
- [ ] Run `node --test tests/pdf-reader.test.js` and `npx playwright test e2e/pdf-reader.spec.js --project=chromium`; require new navigation tests green before continuing.

## Task 3 — PDF-Only Setting and Per-User Persistence

**Files:** `app/ui/core/state.js`, `app/ui/core/user-state.js`, `app/server/storage.js`, `app/ui/index.html`, `app/ui/reader/settings.js`, `app/ui/app.js`, `tests/reader-core.test.js`, `tests/dom-regression.test.js`, `e2e/pdf-reader.spec.js`.

- [ ] Write a failing server unit test: user A sets `pdfLayoutMode:'double'`, user B remains `continuous`; an invalid value on A retains the previous valid value; an old settings object without the field restores `continuous`. Confirm `readingMode` and other preferences remain unchanged.

```js
const a = await storage.updateSettings('reader_a', { pdfLayoutMode: 'double' });
assert.equal(a.pdfLayoutMode, 'double');
assert.equal((await storage.getState('reader_b')).settings.pdfLayoutMode ?? 'continuous', 'continuous');
```

- [ ] Add server whitelist normalization: `pdfLayoutMode = allowed.has(input) ? input : allowed.has(previous) ? previous : 'continuous'`; merge it into the existing per-user JSON write. Add matching client normalization to `applyUserState` and `currentUserSettings`, without coupling it to `readingMode` or mobile EPUB defaults.
- [ ] Add `#settingPdfLayoutMode` to the existing 阅读 card with options 连续/单页/双页. Mark EPUB-only fields/groups and the PDF-only field explicitly; theme and default TOC stay shared. In `syncSettingsPanel`, hide whole inapplicable labels/groups and close any open custom-select portal before changing formats. Keep native select + existing custom-select behavior and keyboard access.
- [ ] Add one change handler that validates the select value, asks `pdfReaderController.setLayoutMode(value)` for immediate visual feedback, updates `state.pdfLayoutMode`, and calls the existing queued `persistUserSettings()`. On PDF open, apply the restored preference **before** the initial saved-page scroll/render; on EPUB/TXT open, only resync visibility. The controller must not itself write user settings.
- [ ] Add DOM/E2E checks that PDF never shows EPUB font/line-height/paragraph/highlight controls; EPUB/TXT still show their old settings and remain unaffected after toggling the PDF setting. Check click and keyboard select, close/reopen, refresh, and per-user restoration.
- [ ] Run `node --test tests/reader-core.test.js tests/dom-regression.test.js tests/pdf-reader.test.js` and the PDF E2E file. Require all new tests green.

## Task 4 — Fit Width, Responsive Fallback, and Lifecycle

**Files:** `app/ui/reader/pdf.js`, `app/ui/styles.css`, `tests/pdf-reader.test.js`, `e2e/pdf-reader.spec.js`.

- [ ] Write failing tests for double fit width: at 1000 CSS-pixel available width with two 400px pages plus 16px gap, expected scale is approximately `1000 / 816`; at 899px effective mode is single, at 900px double; manual scale must not change across resize. Use a fake PDF whose two pages have different widths to verify the wider page governs fit.
- [ ] For fit width, read dimensions only for the current spread (one or two `getPage` calls), calculate `(availableWidth - gap) / sum(pageWidths)` for two pages, and use the existing scale bounds (allow at least 0.35 for automatic/fit). Guard each await with `generation`, `zoomRevision`, `fitRequestId`, book/document identity and effective layout; avoid reusing a stale request after mode/width changes. Cache only a bounded number of dimensions (e.g. LRU 128 entries), or document reuse of an existing bounded cache with an equivalent test.
- [ ] On width crossing 900, recompute effective mode, regroup once, recalculate fit if active, then restore the same exact `pageIndex`. Do not overwrite preference or progress due to temporary fallback. Manual zoom keeps scale and permits horizontal scroll inside `#pdfPages` with Canvas/text-layer alignment.
- [ ] Add tests for a failed right-page `getPage`, a pending fit request followed by manual zoom, rapid book switch while fitting/rendering, and a zoomed right-page search rectangle. Failures remain sanitized and must not leave the old page in a new book.
- [ ] Run PDF unit/E2E tests plus `npm run check:portable`; require zero new failures.

## Task 5 — Full Regression and Device Handoff

**Files:** `e2e/pdf-reader.spec.js`, `tests/dom-regression.test.js`, `docs/superpowers/progress/2026-09-23-pdf-reader-progress.md`; add a focused test only where a gap remains.

- [ ] Exercise a real-browser matrix: 4-page generated fixture with 1/[2,3]/4 pairing; enter page 3, search and TOC to right page, previous/next, refresh, close/reopen, light/dark, narrow/wide viewport, manual/fit zoom, and search panel retained. For 444-page mapping use pure/unit fixtures, not a massive browser PDF.
- [ ] Run `npm test`, `npm run check:portable`, and `npx playwright test --project=chromium`. Record total/pass/skip/fail and identify any unrelated pre-existing failure without changing unrelated worktree content to make the suite appear green.
- [ ] Inspect `git diff --check` and an exact-path `git diff --` for all touched tracked files. Confirm no auth/Range/FTS/PDF.js vendor/EPUB locator changes and no unexpected generated files. Confirm there is no FPK or NAS mutation in this task.
- [ ] Record outcomes, remaining risk, and manual NAS acceptance steps in the PDF progress document. A later packaging/install request must separately verify the PDF feature flag, scan/open, per-user settings, page progress, search, and resource behavior on the NAS; local green tests are **not** device acceptance.

## Plan Review Gate

Before product-code execution, review the five `Review Focus` classes against the steps above, check the 900px threshold and double-page pairing against the approved spec, and confirm every shared-file change has an EPUB/TXT regression assertion. Execute natively in this same worktree only after the user reviews this plan and chooses that execution method. Do not silently commit, package, install, or restart the NAS.
