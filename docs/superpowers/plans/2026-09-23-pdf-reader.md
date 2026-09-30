# PDF Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely add local PDF reading and full-book search to BabyReader, using Mozilla PDF.js for browser rendering and the existing authorized-library, reader-shell, and local FTS infrastructure.

**Architecture:** Add PDF as an explicit book/content type. The server remains the authority for book IDs, authorized paths, byte-range streaming, and PDF text indexing. A dedicated browser PDF adapter owns PDF.js loading/rendering and releases all document, worker, canvas, and task resources on navigation or close. PDF page locators use zero-based `pageIndex`; existing EPUB CFI and text locators remain unchanged.

**Tech Stack:** Node.js 22, existing `node:test`/Playwright tests, Mozilla `pdfjs-dist` pinned to one audited release for browser and server parsing, SQLite FTS5, current BabyReader DOM/CSS and FPK packaging.

**Spec:** `docs/superpowers/specs/2026-09-23-pdf-reader-design.md`

## Global Constraints

- Treat the PDF design spec as the scope authority. First release includes scan/open/render, continuous vertical pages, navigation/zoom/outline, page and whole-book search, and per-user page progress only.
- Do not add PDF highlights, bookmarks, AI question answering, OCR, editing, conversion, upload, CDN access, or remote PDF services.
- Every read/search request uses an authorized `bookId`; resolve and validate the file against current authorized roots on every request. Never accept client paths or arbitrary URLs.
- PDF.js and its worker/assets must be local, exact-version matched, license-attributed, and configured with `isEvalSupported: false`; disable the viewer scripting subsystem explicitly (`enableScripting: false`) and do not load its scripting manager. Do not execute PDF JavaScript/actions, auto-follow links, or load document-controlled external resources.
- Bound file/range size, concurrency, page/canvas dimensions, render/cache depth, parser duration, extracted text, and index work. Task 0 records device evidence and freezes numeric limits before feature implementation; no unbounded defaults.
- Keep PDF locators and parser/index versioning separate from EPUB CFI and text offsets. Preserve current EPUB/Markdown/TXT behavior and shared FTS data for other books.
- Keep the feature fail-closed until release gates pass. Do not stage, commit, overwrite, or reformat unrelated existing worktree changes.
- Use generated minimal PDF fixtures only; never put a user book, NAS path, API key, or real library data in tests or FPK output.

## Review Focus

1. Authorization/range edge cases: unauthorized identity, revoked root, stale `bookId`, malformed and multipart ranges, zero-length/truncated files, client aborts, and resource exhaustion.
2. Untrusted PDF handling: vulnerable or mismatched PDF.js assets, eval configuration, PDF actions/links, external resource loading, malicious text insertion, corrupt/encrypted input.
3. Large-document lifecycle: peak memory, visible-page-only rendering, render cancellation, worker/document teardown, rapid book switches, and failed partial loads.
4. Locator/search correctness: 0-based page contract, normalized text version, Chinese and multi-column text, repeated terms, image-only pages, exact-hit fallback messaging, and pagination.
5. Compatibility: EPUB/Markdown/TXT scan/open/progress/search/AI/highlight/bookmark behavior, UID isolation, static MIME/CSP, FPK contents, and upgrade/rollback.

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `docs/superpowers/progress/2026-09-23-pdf-reader-progress.md` | Create in Task 0 | Evidence, frozen limits, decisions, and per-task test results. |
| `package.json`, `package-lock.json` | Modify in Task 0/2/4 only after compatibility gate | Exact PDF.js dependency and reproducible build metadata; do not update unrelated dependencies. |
| `app/server/library.js` | Modify in Task 1 | PDF extension discovery and bounded PDF metadata/signature handling; no whole-file UTF-8 parsing. |
| `app/server/index.js` | Modify in Task 1/2 | Authenticated PDF content endpoint and single-range streaming; serve local `.mjs` modules with a nosniff-compatible JavaScript MIME. |
| `app/server/pdf-text.js` | Create in Task 4 | Bounded, versioned server-side PDF page-text extraction adapter. |
| `app/server/ai-fts.js` | Modify in Task 4 | PDF-only page records and parser-version invalidation while preserving shared-index isolation. |
| `app/server/book-search.js` | Modify in Task 4 | PDF page locator and response normalization for existing search API. |
| `app/ui/core/state.js` | Modify in Task 2 | Explicit `pdf` content type and isolated document generation/lifecycle state. |
| `app/ui/core/api.js` | Modify in Task 2 | Open PDF by authorized content URL instead of downloading the whole file into JS memory. |
| `app/ui/app.js` | Modify in Task 2 | Route PDF documents into the PDF adapter and preserve text/EPUB receive behavior. |
| `app/ui/reader/pdf.js` | Create in Task 2 | PDF.js loading, continuous page surface, navigation, zoom, outline, visible-page rendering, cancellation and teardown. |
| `app/ui/reader/progress.js` | Modify in Task 3 | Save/restore the PDF page locator without changing existing locator formats. |
| `app/ui/reader/search.js` | Modify in Task 4 | Page-target routing and exact text-layer match, retaining the search surface after navigation. |
| `app/ui/index.html`, `app/ui/styles.css` | Modify in Task 2 | Local PDF.js resources, reader surface, responsive/theme styling; no default viewer wholesale embedding. |
| `tests/fixtures/pdf-fixtures.js` | Create in Task 0 | Small deterministic valid, multi-page, textless, malformed and encrypted/unsupported fixtures as permitted by generator. |
| `tests/reader-core.test.js`, `tests/pdf-content-api.test.js` | Modify/create in Task 1 | PDF scan, authorization, range parsing/streaming, and supported-format compatibility assertions. |
| `tests/search-api.test.js` | Modify in Task 1/4 | Authorized content, Range, PDF search API contract and limits. |
| `tests/pdf-reader.test.js` | Create in Task 2/3 | PDF adapter unit/DOM lifecycle, page locator and teardown tests. |
| `tests/book-search.test.js` | Modify in Task 4 | FTS page extraction, parser-version rebuild, pagination and existing-format regression. |
| `tests/dom-regression.test.js` | Modify in Task 2/3/4 | Reader lifecycle, search result navigation, progress and shell compatibility. |
| `e2e/fixtures/reader-fixtures.js`, `e2e/start-server.js` | Modify in Task 2 | Serve a generated PDF fixture from an authorized test library. |
| `e2e/pdf-reader.spec.js` | Create in Task 2/3/4 | Browser open/render/navigation/progress/search lifecycle tests. |
| `scripts/validate-structure.js` | Modify only if its required-file/MIME checks need PDF resources | Validate local resources and expected package structure. |
| `docs/FNOS_DEVICE_ACCEPTANCE.md`, `scripts/fnos-device-acceptance.sh` | Modify in Task 5 | Reproducible NAS acceptance for PDF dependencies, permissions, Range, FTS and resource limits. |

## Task 0: Capability, Budget, and Contract Freeze

**Boundary:** Documentation and disposable test probes only. Do not change production code, install a dependency, or build an FPK in this task.

### Steps

- [x] Record baseline and supported runtime. Run `node --version`, `npm --version`, `npm test`, `npm run check`, and `git status --short`; save outputs and note pre-existing failures/changes in the progress record. Expected: runtime is Node 22 compatible, baseline commands have explicit pass/fail results, and existing worktree changes are not modified.
- [ ] Verify the selected exact `pdfjs-dist` release from official release/package metadata against browser Chromium and Node 22. Confirm browser module format, Node parser entry point, worker pairing, CMap/standard-font/WASM requirements, license/NOTICE, known advisories, and package size. Expected: one version and exact local asset list are written in progress notes, or Task 0 is blocked with a specific incompatibility and no fallback to CDN.
- [ ] Probe target fnOS gateway behavior for a representative authorized file: `Range: bytes=0-0`, open-ended and suffix ranges, ordinary GET, HEAD, 416, and client disconnect. Expected: evidence records whether the gateway preserves Range and response headers; if it strips Range, define a bounded fallback that does not buffer the whole file, or stop for a design decision.
- [x] Confirm static serving supports the chosen local module/worker MIME and existing CSP can permit only the required same-origin PDF worker/resources. Expected: exact MIME/CSP delta is specified; do not add wildcard origins or broader `connect-src`.
- [ ] Generate deterministic synthetic fixtures and benchmark small, many-page, large, textless, corrupt, and encrypted PDFs on available Chromium/Node targets. Expected: choose and document explicit limits for source bytes, one range response, concurrent ranges, pages, scale/canvas pixel area, concurrent renders, retained pages, extraction characters/page/book, parser/index time and memory, with test rationale; no numeric cap remains implicit.
- [x] Freeze API and locator contracts in the progress document: supported content type/MIME; single-range semantics; `pageIndex` zero-based; page-normalization/parser version; PDF search fallback when text cannot be verified; feature-flag default and rollback behavior. Expected: endpoint and locator examples match the approved spec and no ambiguity remains for Task 1.
- [x] Run `npm run check` after documentation/fixture-only additions. Expected: structural validation passes; no production behavior changes.

**Gate:** Do not begin Task 1 until PDF.js compatibility, Range propagation/fallback, resource ceilings, and locator/API contracts are recorded and reviewable.

## Task 1: PDF Discovery and Authorized Range Content API

**Boundary:** Server scan/content path only; no reader UI, index, or progress changes.

### Steps

- [x] Add failing scan tests first in `tests/reader-core.test.js` and focused `tests/pdf-content-api.test.js` using `tests/fixtures/pdf-fixtures.js`: valid signature PDF is discovered as `type: 'pdf'`; invalid signature, non-file, symlink, and unauthorized path cases are covered. Existing EPUB/MD/TXT indexed counts remain 3; an invalid `.pdf` is counted as a scan error.
- [x] Add a pure single-range parser and boundary tests in `tests/pdf-content-api.test.js`: closed, open-ended, suffix, malformed, unsatisfiable, multipart, empty file, and overflow ranges. Expected: one normalized inclusive interval or a typed rejection, with no allocation proportional to file size.
- [x] Update `app/server/library.js` to recognize PDFs and read at most 1 KiB from the header for the PDF signature; no embedded PDF metadata is parsed and PDF bytes never enter the generic UTF-8 branch. A sparse 32 MiB PDF fixture verifies scan size remains metadata-only.
- [x] Update `app/server/index.js` to revalidate the authorized indexed path and regular-file handle on every PDF request, verify the bounded PDF signature, and stream full or single-range bytes with correct `200/206/416`, `Content-Range`, `Accept-Ranges`, exact `Content-Length`, private cache headers and `nosniff`; support HEAD and close streams on client disconnect.
- [x] Add API tests for missing identity, revoked/out-of-root paths, alternate bookId, symlink replacement, GET/HEAD, 206/416, multipart and oversized ranges, aborted clients, default-off flag, and legacy EPUB/text responses. Windows cannot create symlinks in this environment, so those two symlink assertions are present but skipped here; Linux/NAS verification remains required.
- [x] Run the focused API/scan tests, the full `npm test` suite, and `npm run check`. Expected: regression suite and structure validation pass; no PDF UI, PDF.js dependency, FTS, or progress implementation is introduced in Task 1.

**Gate:** Server security review confirms no path input, no unbounded PDF buffer and current authorization is checked on every request.

## Task 2: Local PDF.js Vendor and Dedicated Reader Surface

**Boundary:** Browser rendering and static assets only; reading progress and search integration remain unchanged.

### Steps

- [x] Add failing `tests/pdf-reader.test.js` lifecycle cases and a Playwright smoke test using a generated authorized PDF: valid document opens, unsupported/corrupt/encrypted errors are controlled, render task is cancelled on close, and a second rapid open cannot be overwritten by the first load. Expected: tests fail before adapter implementation.
- [x] Add only the exact Task 0-approved PDF.js release and audited browser assets to `package.json`/lockfile and the application’s vendor output. Keep license and provenance files adjacent to the vendor assets. Expected: browser library and worker report the same pinned version; package installation does not update unrelated dependencies.
- [x] Extend `app/ui/core/state.js`, `app/ui/core/api.js`, and `app/ui/app.js` with a distinct `pdf` lifecycle. The PDF open path passes the same-origin book content URL to PDF.js and does not call `response.arrayBuffer()` or `response.text()` for the full PDF. Expected: EPUB and text open paths remain byte-for-byte contract compatible.
- [x] Create `app/ui/reader/pdf.js` with `openPdf(bookId)`, `goToPdfPage(pageIndex)`, `setPdfScale(scale)`, `renderVisiblePdfPages()`, and idempotent `destroyPdfReader()`. Reject stale async work using a monotonically increasing document generation; cancel loading/render tasks and release PDFDocument, worker, canvases and page cache on close/switch/error. Expected: only visible pages plus the Task 0-bounded neighboring pages render.
- [x] Implement vertical continuous layout, previous/next and validated page input, fit-width/zoom controls, and PDF outline navigation when present. Page internals use zero-based `pageIndex`; visible page labels add one. Unsupported outline entries cannot trigger arbitrary URL navigation. Outline target normalization is unit-tested; E2E validates page controls and zoom.
- [x] Set PDF.js options explicitly: local worker/resources, `isEvalSupported: false`, disable the viewer scripting subsystem with `enableScripting: false` and do not load its scripting manager, no automatic external network/resource loading, and no document JavaScript/action execution. Render extracted text as text nodes; do not interpolate PDF text into HTML.
- [x] Add minimal same-origin worker/module MIME/CSP changes, `app/ui/index.html` script wiring and `app/ui/styles.css` PDF-specific responsive/theme styles. Expected: no CDN URLs, no wildcard CSP changes, and no EPUB pagination CSS leakage into PDF pages.
- [x] Extend E2E fixtures and run `node --test tests/pdf-reader.test.js tests/dom-regression.test.js tests/reader-core.test.js`, then `npx playwright test e2e/pdf-reader.spec.js --project=chromium`. Expected: open, page navigation, zoom, outline handling, controlled failure, rapid switch, close and teardown pass; existing reader tests pass. Mobile/theme styling has shared CSS-token and static contract coverage; target-device visual acceptance remains a release gate.

**Task 2 local verification (2026-09-23):** `npm test` passed (334 tests, 327 passed, 7 skipped); focused reader/PDF suite passed (171/171); `npx playwright test e2e/pdf-reader.spec.js --project=chromium` passed (4/4, including narrow-screen/mobile-profile and dark-theme checks); the user-provided local PDF sample passed the isolated `e2e/pdf-sample.spec.js` (1/1; temporary copy removed after test); `npm run check` passed (46 required files, 9 lifecycle scripts). No FPK build or NAS install was performed. Task 0 gateway/resource-budget gates remain open.

**Gate:** Browser rendering works from authorized Range responses and teardown/memory behavior passes repeat-open tests before progress or search is connected.

## Task 3: Per-User PDF Reading Progress and Reload Recovery

**Boundary:** Add PDF locator handling to existing progress lifecycle only; do not migrate existing stored locators.

### Steps

- [x] Add `tests/dom-regression.test.js` and `e2e/pdf-reader.spec.js` cases for first/last/out-of-range page, refresh, close/reopen, and user isolation. Expected: current code does not restore PDF location, while EPUB CFI/text progress tests continue to pass. The browser persistence regression was observed red before implementation; the DOM test verifies the exact save payload/generation gate, and existing storage tests verify per-UID progress isolation.
- [x] Extend `app/ui/reader/progress.js` to save `{ type: 'pdf', pageIndex }` through the existing per-user progress API with debounce and document-generation checks. Clamp invalid persisted values to page zero and to the current document page count after metadata resolves. `pagehide` flush uses a small `fetch(..., { keepalive: true })` through the same authenticated endpoint.
- [x] Restore PDF page only after the correct PDF document has loaded; a delayed response from the previous book must not change the new document’s page. Keep EPUB CFI and text page/scroll branches unchanged.
- [x] Run `node --test tests/dom-regression.test.js tests/reader-core.test.js` and `npx playwright test e2e/pdf-reader.spec.js --project=chromium`. Expected: PDF reload/reopen restores page for the same UID, another UID sees its own/default progress, invalid locators fail closed, and existing EPUB/text progress regression tests pass.

**Task 3 local verification (2026-09-23):** focused `node --test tests/dom-regression.test.js tests/reader-core.test.js tests/pdf-reader.test.js` passed (174/174); `npx playwright test e2e/pdf-reader.spec.js --project=chromium` passed (5/5); full `npm test` passed (337 tests, 330 passed, 7 environment skips, 0 failed); `npm run check` passed (46 required files, 9 lifecycle scripts); `git diff --check` clean. The full suite includes the existing fnOS UID-isolation progress test. No FPK build or NAS deployment was performed.

**Gate:** Persistence and per-user isolation are verified before search navigation uses the PDF page surface.

## Task 4: Bounded Page Text Extraction and Local FTS Search

**Boundary:** Server-side PDF extraction/index/search and client navigation only. No AI endpoint changes, OCR, or shared schema rewrite without a separately reviewed migration.

### Steps

- [x] Add failing extractor/index/search tests in `tests/book-search.test.js` and `tests/search-api.test.js`: multi-page Chinese text, repeated terms on one page, same terms on separate pages, textless/image-only PDF, malformed/encrypted PDF, parser-version change, result pagination, cancellation and extraction budget exhaustion. Expected: current generic non-EPUB reader fails PDF fixtures without corrupting existing EPUB/text indexes.
- [x] Create `app/server/pdf-text.js` using the Task 0-approved Node PDF.js entry point. Read only an authorized local file, process pages sequentially, normalize text deterministically, and enforce explicit source/page/book/time/memory budgets. Return page text plus parser/normalization version and status; do not log text or path. Expected: an image-only PDF is marked non-searchable rather than indexed as empty successful content.
- [x] Update `app/server/ai-fts.js` so PDF dispatches to the PDF extractor, while EPUB and text keep their existing extractors. Store one logical searchable unit per page in the existing per-book index where the present schema permits; avoid schema changes if the page-index mapping and versioning can be expressed safely. Publish rebuilt indexes atomically using existing lock/temp/permission behavior; on failure retain the last valid index or mark the PDF stale according to the established index contract, never publish partial rows.
- [x] Update `app/server/book-search.js` to return a format-specific locator `{ type: 'pdf', pageIndex, textOffset, quote/context }`, with `pageIndex` normalized to zero-based integer and context bounded by existing search limits. Preserve existing pagination/cursor and response shapes for non-PDF books.
- [x] Add PDF search in `app/ui/reader/search.js`: keep the search surface open, navigate to `pageIndex`, wait for that page’s text layer, verify the query at normalized offset/context, and apply transient styling only to the verified hit. When no exact match can be confirmed, navigate to the page and show page-only status; do not flash/highlight the whole page. Reject results from stale document generations.
- [x] Add browser tests proving the indexed page and exact phrase—not merely a nearby page—are targeted; page-only fallback is explicit for text mismatch/image-only pages. Assert no network request outside same origin and no AI endpoint invocation.
- [x] Run `node --test tests/book-search.test.js tests/search-api.test.js tests/dom-regression.test.js tests/pdf-reader.test.js` and `npx playwright test e2e/pdf-reader.spec.js e2e/search.spec.js --project=chromium`. Expected: PDF pagination/exact navigation/unsupported-text and rebuild cases pass; EPUB/TXT full-text search and locator regressions pass.

**Task 4 local verification (2026-09-23):** focused parser/index/API/reader suite passed (162/162); Chromium PDF + general search E2E passed (18/18); full `npm test` passed (349 tests, 342 passed, 7 environment skips, 0 failed); `npm run check` passed (46 required files, 9 lifecycle scripts); `git diff --check` passed. One legacy PDF API test was updated from the pre-Task-4 “search unavailable” contract to assert page-aware FTS locators while retaining the AI-route rejection assertion. No FPK was built and no NAS was modified.

**Task 4 provisional-limit ruling:** Task 0 target-NAS memory/latency and gateway Range checks are still open. To continue the explicitly requested phase without treating guesses as certified capacity, extraction/index limits are explicit conservative ceilings in `app/server/pdf-text.js` (64 MiB source, 5,000 pages, 250,000 UTF-16 chars/page, 8 MiB extracted chars/book, 20 s parser, 15 s indexing, 20,000 index rows, Worker old/young heap 128/32 MiB and 4 MiB stack). Overrides may only lower these limits. These are fail-closed implementation guardrails, not device-calibrated release limits; PDF remains behind its runtime feature flag and Task 5 must measure/revise them before enabling it in a release FPK.

**Gate:** FTS review confirms PDF-only invalidation/deletion/rebuild cannot remove or rewrite another book’s records, and extraction limits have been exercised.

**Task 4 gate status:** Local isolation, atomic rebuild, exact-locator, bounded-resource, cancel, and regression tests pass. fnOS gateway Range, target NAS memory/latency, and device browser acceptance remain unverified and block release; continue to Task 5 only as a separate package/device-validation phase.

## Task 5: FPK Audit, fnOS Device Acceptance, and Release Decision

**Boundary:** Build/release candidate only after Tasks 0–4 pass. Do not install over a user system without the normal device-test authorization and rollback path.

### Steps

- [x] Add PDF device checks to `docs/FNOS_DEVICE_ACCEPTANCE.md` and `scripts/fnos-device-acceptance.sh`: runtime version, local PDF.js/worker pairing, MIME/CSP, authorized Range GET/206/416, FTS capability/index permissions, and absence of temporary/partial indexes. Expected: script clearly distinguishes required PASS from environment-dependent SKIP.
- [x] Run the full baseline `npm test`, `npm run check`, targeted Playwright PDF/search tests, and the portable/POSIX structural checks available in this repository. Expected: no failures in pre-existing EPUB, text, search, progress, organization, AI, or lifecycle tests. Windows host limitation: POSIX lifecycle execution is skipped; acceptance/build shell scripts pass `bash -n` and portable validation passes.
- [x] Build with `npm run build:fpk`; inspect the archive manifest and unpacked contents. Expected: exact local PDF.js assets and licenses are included; no test PDFs, real books, API keys, temp indexes, user data, CDN references or unrelated build output is included. Candidate package content and PDF runtime assets/licenses were audited; no PDFs, maps or private runtime paths were present.
- [x] Audit runtime dependency inventory and PDF.js advisories/license against the pinned Task 0 decision. Expected: build metadata documents source/version/checksum and required notices; no implicit `latest` resolution. Provenance records the exact 6.3.289 registry tarball URL, sha512 integrity and Apache-2.0 license; packaged production dependency audit reports zero vulnerabilities. The local `fnpack` executable is unversioned/unverified, so this is an auditable candidate build, not a reproducible signed release.
- [ ] Run on the target fnOS NAS using only a dedicated synthetic test library: small and large PDFs, text and image-only PDFs, corrupt/encrypted cases, reader refresh/reopen, search and pagination, quick book switching, service restart, and authorization revocation. Record load latency, peak process/browser memory where measurable, file/range counts, and failure recovery against Task 0 limits.
- [ ] Verify rollback by disabling the PDF feature flag and reopening EPUB/Markdown/TXT books; verify no existing progress, indexes, categories, annotations, bookmarks or AI sessions changed. Expected: the app returns to pre-PDF behavior without deleting existing state.
- [x] Update the progress record with every command/result and a release decision: accepted, rejected, or blocked with evidence. Do not call it fnOS-device-accepted unless the NAS matrix passes.

**Task 5 local verification (2026-09-23):** `npm test` passed (354 tests: 347 passed, 7 environment skips, 0 failed); `npm run check` and `npm run check:portable` passed; `bash -n` passed for the acceptance/build scripts; `git diff --check` passed; PDF + search Chromium E2E passed (18/18); packaged production `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities. FPK candidate: `dist-fpk-20260923-pdf-task5-candidate/babyreader-fnos.fpk`, manifest version 1.1.7, SHA-256 `82cb7b84d0eacddb3bd81f9bbd3d94be712b71d34c89fa10902955c03f71f452`; provenance is alongside the package. Archive audit found 1,797 app members, all required PDF parser/browser/worker/license assets, no `.map` files, no PDF fixture/book files, and no private runtime-data paths. PDF.js is pinned to registry tarball 6.3.289 with the lockfile SHA-512 integrity. The PDF.js advisory affecting scripting is addressed by the pinned fixed release and `enableScripting:false`; the current upstream release listing was checked during this task.

**Release decision: blocked pending target fnOS acceptance.** The target gateway Range proxy, PDF feature-flag lifecycle, x86/ARM runtime behavior, actual NAS memory/latency limits, browser visual behavior, authorization revocation and rollback have not been exercised. The user’s live NAS browser is currently on a real reading session, so the candidate was not installed or used to modify that system. Keep PDF disabled by default; do not call this candidate device-accepted or release-ready. `fnpack` provenance reports an unversioned local binary with unknown checksum, so a toolchain-verified reproducible release also remains open.

**Final gate:** Release only when automated tests, package/license/security audit, and target-device acceptance all pass. Otherwise keep PDF disabled and preserve the failure evidence for the next revision.
