# Reader surfaces and search progress

**Last updated:** 2026-09-21
**Current milestone:** Task 4 complete

## Completed

- [x] Formal surface architecture spec written.
- [x] Implementation plan written.
- [x] Content sheet retains the `readerDrawer` compatibility root and contains only 目录、书签、标记与想法.
- [x] Display settings moved to the independent `readerSettingsSheet` surface.
- [x] Search reserved as an independent `readerSearchSheet`; the button remains disabled until the full-text API exists.
- [x] Shared `readerSurfaceController` now separates content/settings/search state, backdrop, Escape, focus restoration, accessibility state, and mutual exclusion.
- [x] Reader launchers keep `aria-expanded` synchronized with the active reader surface; Escape/backdrop restore focus to the surface launcher.
- [x] AI remains an independent floating surface: opening AI closes reader surfaces, while opening reader surfaces does not destroy an existing AI conversation.
- [x] Sheet visual system uses one canonical surface rule set for header, divider, close button, padding, focus ring, and neutral UI tokens.
- [x] Content/settings/search sheets each have one scroll owner; content tabs stay three-column and nowrap.
- [x] Mobile sheets share bottom-sheet geometry, full-screen backdrop coverage, and safe-area bottom padding.
- [x] Settings custom-select initialization remains compatible after the DOM move.
- [x] Regression coverage updated for desktop, mobile, AI, bookmarks, notes, settings, keyboard, backdrop, and touch entry points.
- [x] Independent search surface exposes reserved query, book/chapter scope, loading, empty, result, and error slots without enabling user search.
- [x] Future search URL contract is bounded and explicitly separate from the AI retrieval route; no search request is issued while reserved.

## Verification

- `npm test`: 132 passed, 3 skipped.
- `npm run check`: passed.
- Chromium Playwright: 69 passed, 2 optional real-EPUB tests skipped.

## Next work

- Task 5: release validation and FPK packaging, followed later by the separately scoped full-text search API and SQLite FTS result semantics.
