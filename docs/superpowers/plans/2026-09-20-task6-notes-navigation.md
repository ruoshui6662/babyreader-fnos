# Task 6 Notes Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every whole-book note row navigate to its exact EPUB source text across continuous-scroll and paged reading modes, with stable failure feedback and editor/delete synchronization.

**Architecture:** Keep the existing `highlights` collection and DOM Range locator as the source of truth. `notes-panel.js` resolves an annotation ID to a normalized chapter path, awaits `navigateToEpubChapter()` when the chapter is not mounted, restores the Range only after pagination settles, and then calls `navigateToSemanticTarget()` on the Range's containing element. Existing `openHighlightEditor()` and highlight persistence remain the editing path; the notes panel only supplies row actions and re-renders after state changes.

**Tech Stack:** Vanilla JavaScript, DOM Range locators, existing EPUB chapter-window renderer, existing pagination settlement, Node.js tests, Playwright Chromium E2E, fnOS FPK packaging.

**Spec:** `docs/superpowers/specs/2026-09-20-reader-annotations-and-notes-sidebar-design.md`

## Global Constraints

- EPUB annotations remain scoped by the current `bookId` and fnOS user identity.
- Keep the existing `/api/books/:bookId/highlights` persistence API unchanged.
- Do not scan or mutate EPUB source text to implement navigation; recover the saved DOM Range instead.
- Await chapter rendering and pagination settlement before calling `rangeFromHighlight()`.
- Preserve the current reading mode, page geometry, and pending save chains.
- Use `textContent` for annotation text and explicit `data-*` IDs for row actions.

## Review Focus

- A note in a different chapter must wait for chapter replacement before Range recovery; test both scroll and double-page modes.
- A same-chapter note must not trigger an unnecessary chapter reload; test that navigation still changes the current target position.
- A stale or malformed locator must keep the drawer open and show a row-level error without throwing.
- Clicking edit/delete must not navigate or create duplicate persistence requests; test state and list counters after each action.
- Rapid clicks during chapter loading must not race two chapter renders; test the second request is rejected while loading.

## File Structure

| File | Responsibility |
| --- | --- |
| `app/ui/reader/notes-panel.js` | Resolve rows, navigate to annotations, focus flash, row action delegation, error state. |
| `app/ui/reader/highlights.js` | Expose a stable delete-by-ID path if row deletion cannot reuse the editor, and keep render/save synchronization. |
| `app/ui/styles.css` | Interactive note row, action buttons, focus flash, and error state. |
| `tests/dom-regression.test.js` | Verify the notes navigation contract and safe row action markup. |
| `e2e/highlights.spec.js` | Verify later-chapter navigation, edit/delete refresh, and persistence. |
| `e2e/epub-resilience.spec.js` | Verify navigation while chapter loading and malformed locator recovery. |
| `docs/superpowers/progress/2026-09-20-reader-annotations-progress.md` | Record review findings, RED/GREEN evidence, and release status. |

## Task 6A: Cross-chapter annotation navigation

**Interfaces:**

- Consumes: `loadHighlights()`, `state.epubArchive.chapterIndexByPath`, `navigateToEpubChapter(index, options)`, `rangeFromHighlight(annotation)`, `navigateToSemanticTarget(element)`, and `redrawDomHighlights()`.
- Produces: `navigateToAnnotation(annotationId): Promise<boolean>` exposed through `window.__babyReaderNotesPanelApi` for tests and called by note-row activation.

- [x] Write a failing E2E test that creates an annotation in chapter 2, returns to chapter 1, opens the Notes panel, clicks the chapter 2 row, and expects chapter 2 without a focus-border flash.
- [x] Run the focused test and confirm it fails because note rows are currently non-interactive.
- [x] Add normalized chapter-path resolution and the async navigation sequence: locate index, await chapter navigation when needed, recover Range, derive containing element, call semantic navigation, and redraw without adding a focus-border flash.
- [x] Keep the drawer open on failure and add `data-notes-error` text to the affected row; return `false` without throwing.
- [x] Add same-chapter and rapid-loading guards, then run scroll and double-page focused E2E tests.

## Task 6B: Row editing and deletion synchronization

**Interfaces:**

- Consumes: `openHighlightEditor(id)`, `deleteActiveHighlight()`, `saveHighlights()`, `queueHighlightSave()`, and `renderNotesPanel()`.
- Produces: row-level edit/delete controls with accessible labels; list counts and rows update after persistence.

- [x] Write a failing E2E test that opens a row editor, changes its thought, saves, deletes the row, and verifies the server-backed list is empty after reload.
- [x] Run the focused test and confirm the current row has no action controls.
- [x] Add delegated row actions and a safe delete-by-ID path, preserving the existing editor save chain and preventing row-click navigation when an action button is clicked.
- [x] Add focus restoration to the surviving row or Notes tab after re-render.
- [x] Run focused edit/delete E2E plus the existing highlight CRUD suite.

## Task 6C: Full verification and packaging

- [x] Run `npm test` and inspect all failures, including platform skips.
- [x] Run `npm run check` and `git diff --check`.
- [x] Run `npx playwright test e2e/highlights.spec.js e2e/epub-resilience.spec.js e2e/viewport.spec.js --project=chromium --workers=1`.
- [x] Rebuild `dist/babyreader-fnos.fpk`, verify the archive contains the updated notes panel, and record the SHA-256 in the progress ledger.
