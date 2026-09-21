# Reader Surfaces and Search Implementation Plan

> **For the implementer:** use the `superpowers:executing-plans` skill and execute tasks in order. Each task is intentionally small and testable.

**Goal:** Separate reader content navigation, display settings, and future search into independent in-app sheets while preserving all existing reader and AI behavior.

**Status:** Task 4 complete; Task 5 pending

**Architecture:** Keep one shared surface controller for exclusivity, backdrop, Escape, focus restoration, and responsive behavior. Use separate DOM roots and state namespaces for content, settings, and search. Keep AI as the existing independent modal.

**Tech Stack:** Vanilla JavaScript, HTML, CSS, Node.js test runner, happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-reader-surfaces-search-design.md`

**Global Constraints:** Do not change server routes or FTS ranking in this UI task. Do not change existing element IDs used by settings, AI, bookmarks, notes, or reading persistence unless an explicit compatibility alias is retained. Keep search disabled until its full-text API is implemented.

**Review Focus:** Surface boundaries, focus restoration, accessibility semantics, mobile bottom-sheet behavior, and regression safety for AI/bookmarks/notes/settings.

## Task 1: Split content and settings surfaces — complete

**Files:** `app/ui/index.html`, `app/ui/shell/drawer.js`, `app/ui/styles.css`, `tests/dom-regression.test.js`

1. Add failing DOM tests for three content tabs, a sibling settings sheet, one active surface, and focus restoration.
2. Add independent settings sheet markup while preserving existing settings control IDs.
3. Restrict the content tablist to TOC, bookmarks, and notes.
4. Update the reader controller so content tabs and settings use separate roots while keeping `readerActions` compatibility aliases.
5. Replace shared `settings-panel.reader-drawer` layout selectors with explicit sheet classes and a three-column content tab layout.
6. Run targeted DOM tests and existing reader tests.

## Task 2: Extract shared surface primitives

**Files:** `app/ui/shell/drawer.js`, `app/ui/index.html`, `app/ui/styles.css`, tests

1. Add tests for Escape, backdrop, focus restoration, and sibling-surface exclusivity across content and settings. — complete
2. Implement a small surface registry/controller without moving AI internals. — complete
3. Make launcher `aria-expanded` reflect the active surface and restore focus to the original launcher. — complete
4. Verify keyboard and touch close behavior on desktop and mobile. — complete

Task 2 boundary: AI remains an independent floating modal. The shared controller closes reader surfaces before AI opens, while reader surfaces can coexist with an already-open AI panel so the existing desktop AI workflow and conversation state remain stable.

## Task 3: Normalize the visual system

**Files:** `app/ui/styles.css`, relevant screenshots/tests

1. Add visual assertions for no tab wrapping and one scroll owner per sheet. — complete
2. Consolidate duplicate Drawer rules into canonical sheet classes and shared UI tokens. — complete
3. Align header, divider, close button, body padding, focus ring, and mobile safe-area rules. — complete
4. Verify desktop and mobile visual contracts in Chromium. — complete

Task 3 boundary: this pass changes only sheet chrome and layout ownership. It does not change reader content rendering, AI retrieval, server APIs, or persisted settings values.

## Task 4: Reserve the independent search surface

**Files:** `app/ui/index.html`, `app/ui/shell/drawer.js`, `app/ui/styles.css`, tests

1. Add a hidden search sheet root with query, scope, result, empty, and loading slots. — complete
2. Keep `btnSearch` disabled and assert no network calls are made. — complete
3. Define the future search API adapter boundary without connecting it to the AI route. — complete
4. Leave the full-text implementation for the search feature task. — complete

Task 4 boundary: the search form, scope options, status slots, and URL builder are reserved UI/API contracts only. Search remains unavailable, no submit handler is registered, no search endpoint is added, and the existing AI retrieval route is not reused.

## Task 5: Regression and release validation

**Files:** tests, docs, build outputs as needed

1. Run `npm test` and `npm run check`.
2. Run Playwright Chromium tests for desktop/mobile, single/double/continuous reading, AI, bookmarks, and notes.
3. Verify no existing settings, AI, bookmark, or annotation IDs/regressions are broken.
4. Build the FPK only after all tests pass and record the artifact hash.

## Future search implementation (not part of Task 1)

Implement a dedicated exact full-text search endpoint over the book index/SQLite FTS infrastructure, with book/chapter scope, bounded result count, snippets, semantic locators, and lifecycle/error handling. It must not consume AI tokens and must not reuse `/api/books/:id/ai/search` as a user search endpoint.
