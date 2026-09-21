# Reader surfaces and search progress

**Last updated:** 2026-09-21
**Current milestone:** Task 1 complete

## Completed

- [x] Formal surface architecture spec written.
- [x] Implementation plan written.
- [x] Content sheet retains the `readerDrawer` compatibility root and contains only 目录、书签、标记与想法.
- [x] Display settings moved to the independent `readerSettingsSheet` surface.
- [x] Search reserved as an independent `readerSearchSheet`; the button remains disabled until the full-text API exists.
- [x] Surface controller now separates content/settings/search state, backdrop, Escape, focus restoration, and mutual exclusion.
- [x] Settings custom-select initialization remains compatible after the DOM move.
- [x] Regression coverage updated for desktop, mobile, AI, bookmarks, notes, settings, keyboard, and touch entry points.

## Verification

- `npm test`: 130 passed, 3 skipped.
- `npm run test:core`: 114 passed, 2 skipped.
- `npm run check`: passed.
- Chromium Playwright: 67 passed, 2 optional real-EPUB tests skipped.

## Next work

- Task 2: extract the shared surface primitive and normalize `aria-expanded`, focus, backdrop, and Escape behavior across all sibling surfaces.
- Task 3: consolidate duplicate CSS into canonical sheet tokens and capture desktop/mobile visual evidence.
- Task 4: implement the independent search surface contract, then separately implement the full-text search API and SQLite FTS result semantics.

