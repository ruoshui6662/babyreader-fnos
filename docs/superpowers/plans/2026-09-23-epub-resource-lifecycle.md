# EPUB Resource Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make repeated EPUB assets cheap to reuse and safely release them across chapter navigation while preserving resource and archive safety limits.

**Architecture:** Keep JSZip and the existing custom chapter renderer. Add an archive-owned resource manager that normalizes keys, coalesces inflation, issues per-chapter leases over bounded Blob-URL cache entries, and revokes URLs on safe eviction or archive destruction. The renderer transfers a lease only after its DOM commit and releases stale/uncommitted leases.

**Tech Stack:** Existing browser JavaScript, JSZip, Blob/Object URL APIs, Node.js `node:test`, existing Playwright Chromium E2E.

**Spec:** `docs/superpowers/specs/2026-09-23-epub-resource-lifecycle.md`

## Global Constraints

- Keep the single-resource limit at 8 MiB.
- Preserve existing server-side ZIP bounds and path normalization; do not relax either.
- Do not add dependencies, endpoints, or migrate the reader renderer.
- Preserve text rendering and existing pagination, AI text extraction, search, bookmark, and annotation behavior.
- Do not stage or commit changes; the checkout has unrelated user modifications.
- Limit code changes to EPUB resource conversion/lifecycle and directly related tests/docs.

## Review Focus

- Concurrent requests for the same path while inflation is pending must not double-inflate, double-charge, or race URL creation.
- A chapter render superseded during asynchronous loading must release only its own lease and must not revoke visible chapter resources.
- CSS resources and XHTML resources must resolve against their own containing archive paths.
- A cache full of pinned resources must omit a new resource safely rather than evicting an in-use URL or exceeding the bound.
- Destroy/reopen must revoke old archive URLs once and create fresh URLs without cross-book cache reuse.

---

### Task 0: Freeze contract and establish baseline

**Files:**
- Read: `app/ui/reader/epub.js`, `app/ui/reader/document.js`, `tests/reader-core.test.js`, `e2e/epub-resilience.spec.js`, `e2e/start-server.js`, `app/server/zip.js`, `app/server/security.js`
- Create: `docs/superpowers/specs/2026-09-23-epub-resource-lifecycle.md`
- Create: `docs/superpowers/plans/2026-09-23-epub-resource-lifecycle.md`
- Test: existing `tests/reader-core.test.js` and `tests/dom-regression.test.js`

**Interfaces:**
- Produces: the limits, root cause, file scope, and acceptance contract consumed by Tasks 1–5.

- [x] Record the archive-lifetime repeated-reference budget behavior and preserve ZIP/per-resource boundaries.
- [x] Run `node --test tests/reader-core.test.js` and `node --test tests/reader-core.test.js tests/dom-regression.test.js`.
- [x] Compare existing oversized-resource test semantics against the spec; preserve the 8 MiB case.

Expected baseline: reader-core 39/39 and combined reader-core/dom-regression 154/154.

### Task 1: Add archive resource manager and Blob URL adapter

**Files:**
- Modify: `app/ui/reader/epub.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: `normalizeZipPath()`, `getZipFile()`, `zipEntryUncompressedSize()`, existing `EPUB_RESOURCE_LIMITS`.
- Produces: `createEpubResourceManager(zip, mediaTypes, options, urlApi)` exposing `createLease()`, `acquire(resourcePath, lease)`, `release(lease)`, `destroy()`, and `snapshot()` for bounded diagnostics. `acquire` returns a Promise for the Blob URL or `null` for safe omission.

- [x] Add failing tests proving same-path concurrent and sequential acquisition produces one `file.async('uint8array')`, one `URL.createObjectURL`, and one unique-byte charge.
- [x] Add failing tests proving path traversal is rejected and resources above 8 MiB are rejected before inflation.
- [x] Implement the archive manager with normalized path keys, shared in-flight promises, Blob construction using manifest MIME/fallback MIME, a bounded unique-byte LRU, and pin counts by lease.
- [x] On capacity pressure, evict/revoke the least-recently-used unpinned resources; if all candidates are pinned, return `null` without exceeding limits.
- [x] On failed inflation, remove the in-flight/cache entry so a later attempt is not poisoned; record only bounded path/reason/byte diagnostics.
- [x] Verify failed inflation can be retried and unknown declared sizes are checked against the single-resource limit after reading.
- [x] Run `node --test tests/reader-core.test.js` and verify all new tests plus existing size-limit tests pass.

Expected: focused tests show RED before implementation and GREEN after; duplicate references do not consume duplicate cache bytes.

### Task 2: Route XHTML and CSS resources through the adapter

**Files:**
- Modify: `app/ui/reader/epub.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: Task 1 manager API.
- Produces: `inlineCssResources(css, cssPath, manager, lease)` and `inlineResourceRefs(html, chapterPath, manager, lease)` emit Blob URLs while preserving sanitized external-reference behavior. `loadEpubChapter()` returns the created `{ paths, released }` resource lease for Task 3 lifecycle ownership.

- [x] Add failing fixtures where two chapters and one stylesheet reference the same archive asset; assert all rewritten URLs are identical and one inflation occurred.
- [x] Add failing coverage for XHTML-relative `src`/`href`/`xlink:href`/`poster` and stylesheet-relative `url(...)` resolution.
- [x] Replace data URL conversion with manager acquisition and thread the chapter lease through both markup and CSS rewriting.
- [x] Ensure absent/invalid/over-limit resources remain non-fatal and diagnostics include a reason without logging document contents.
- [x] Run `node --test tests/reader-core.test.js`.

Expected: rendered markup and stylesheet contain `blob:` URLs for local assets; no new network requests are introduced.

### Task 3: Bind resource leases to render and archive lifecycle

**Files:**
- Modify: `app/ui/reader/epub.js`, `app/ui/reader/document.js`
- Test: `tests/reader-core.test.js`, `tests/dom-regression.test.js`

**Interfaces:**
- Consumes: Task 1 manager and Task 2 rewriting functions.
- Produces: `loadEpubChapter()` returns `{ ..., resourceLease }`; `archive.resourceManager.release(lease)` and `.destroy()` govern disposal.

- [x] Add failing render tests for the old visible chapter remaining valid while a replacement loads, and for stale/failed replacement leases being released.
- [x] Add failing tests proving successful DOM replacement releases the old lease only after the new markup is mounted.
- [x] Transfer the new chapter lease to the archive's active chapter only after render generation checks and DOM commit; release local lease in all stale, fragment-rejection, and error paths.
- [x] Release active chapter lease and destroy the manager in `destroyEpub()` before dropping the archive reference.
- [x] Preserve the legacy direct load path and ensure `loadEpubChapterText()` never acquires visual assets.
- [x] Run `node --test tests/reader-core.test.js tests/dom-regression.test.js`.

Expected: lease pin counts return to zero after replacement/destruction; no visible chapter URL is revoked early.

### Task 4: Add duplicate-image navigation and lifecycle browser coverage

**Files:**
- Modify: `e2e/start-server.js`, `e2e/epub-resilience.spec.js`
- Test: existing Playwright Chromium project

**Interfaces:**
- Consumes: rendered Blob URLs and lifecycle diagnostics from Tasks 1–3.
- Produces: deterministic E2E EPUB fixture with multiple spine items referencing a shared in-limit image and an oversized asset sentinel.

- [x] Add a failing E2E assertion that the shared image remains loaded after navigating across the chapters whose cumulative references previously exceeded the budget.
- [x] Add assertions that replacing chapters does not increase live resource count without bound, and returning to library destroys all archive resource URLs.
- [x] Keep the oversized asset E2E scenario to confirm unsafe/oversized resources still do not block first-page text or pagination.
- [x] Run `npx playwright test e2e/epub-resilience.spec.js --project=chromium`.

Expected: duplicate-image chapters render their image; oversized resource remains safely omitted; browser console has no uncaught errors.

### Task 5: Full regression, resource stress, and delivery review

**Files:**
- Modify only if required by failing coverage: EPUB files and their focused tests from Tasks 1–4.

**Interfaces:**
- Consumes: completed archive resource manager and lifecycle behavior.
- Produces: verified implementation evidence; packaging/device acceptance is separate and only when requested.

- [x] Run the complete `npm test` suite and inspect all failures, including unrelated baseline failures.
- [x] Run `npm run check`.
- [x] Run the EPUB resilience Playwright test with Chromium and verify URL cleanup, chapter reuse, and over-limit omission.
- [x] Review the focused diff to confirm no server limits, APIs, reader feature contracts, or unrelated dirty changes were modified.
- [x] Record final test results and any deferred device-only checks in the progress ledger.

Expected: all project tests/checks pass or any pre-existing unrelated failure is precisely identified; no FPK is produced in this task.
