# Reader surfaces and search progress

**Last updated:** 2026-09-21
**Current milestone:** Task 2 complete

## Completed

- [x] Formal surface architecture spec written.
- [x] Implementation plan written.
- [x] Content sheet retains the `readerDrawer` compatibility root and contains only 目录、书签、标记与想法.
- [x] Display settings moved to the independent `readerSettingsSheet` surface.
- [x] Search reserved as an independent `readerSearchSheet`; the button remains disabled until the full-text API exists.
- [x] Shared `readerSurfaceController` now separates content/settings/search state, backdrop, Escape, focus restoration, accessibility state, and mutual exclusion.
- [x] Reader launchers keep `aria-expanded` synchronized with the active reader surface; Escape/backdrop restore focus to the surface launcher.
- [x] AI remains an independent floating surface: opening AI closes reader surfaces, while opening reader surfaces does not destroy an existing AI conversation.
- [x] Settings custom-select initialization remains compatible after the DOM move.
- [x] Regression coverage updated for desktop, mobile, AI, bookmarks, notes, settings, keyboard, backdrop, and touch entry points.

## Verification

- `npm test`: 131 passed, 3 skipped.
- `npm run check`: passed.
- Chromium Playwright: 67 passed, 2 optional real-EPUB tests skipped.

## Next work

- Task 3: consolidate duplicate CSS into canonical sheet tokens and capture desktop/mobile visual evidence.
- Task 4: implement the independent search surface contract, then separately implement the full-text search API and SQLite FTS result semantics.
