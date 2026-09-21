# Reader Surfaces and Search Design Specification

**Status:** Approved for implementation
**Date:** 2026-09-21
**Scope:** Reader chrome surface separation; search surface reservation

## 1. Problem and goals

The reader currently renders table of contents, bookmarks, annotations/notes, display settings, and a reserved search destination inside one Drawer and one tab list. This creates three problems:

1. Four destinations are styled as one navigation group even though settings is not reader content navigation.
2. The tab list is configured for three columns while four tabs are present, so the display tab wraps and breaks the visual hierarchy.
3. The shared container is named and styled as `settings-panel`, which couples unrelated content and makes later responsive changes risky.

The goal is to establish a stable surface hierarchy that matches the existing Apple-like UI language without changing reading, AI, bookmark, highlight, note, or persistence behavior.

## 2. Surface architecture

The reader uses in-app sheets/panels, not browser or operating-system windows:

### 2.1 Content sheet

The existing `readerDrawer` becomes the reader content sheet. Its only tab destinations are:

- 目录
- 书签
- 标记与想法

The three tabs are a single semantic `tablist`. The sheet owns the content panel title, close behavior, backdrop, focus trapping, and mobile bottom-sheet presentation.

### 2.2 Display settings sheet

Display settings is a sibling sheet with its own root, title, close button, scroll viewport, and backdrop ownership. It is not a content tab and must not appear inside the content tablist.

Task 1 introduces the independent root and moves the existing settings DOM into it. The settings controls and their IDs remain stable so existing settings persistence and typography code continue to work.

### 2.3 Search sheet

Search is a separate sibling sheet, not a fourth content tab. It has a different interaction model: query input, scope, loading, result list, empty state, and result navigation.

Task 1 only reserves the independent surface boundary. The search button remains disabled until the full-text search API and result contract are implemented. The existing AI `/api/books/:id/ai/search` route is not exposed as ordinary user search because its ranking and response semantics are AI retrieval-specific.

### 2.4 AI modal

The existing AI modal remains independent. Opening AI must continue to close or hide reader surfaces without changing the conversation state.

## 3. Interaction and state contract

The controller separates:

- `activeContentPanel`: `toc | bookmarks | notes | null`
- `activeSurface`: `content | settings | search | ai | null`

The shared surface primitive is responsible only for backdrop, Escape, focus restoration, mutual exclusion, and responsive presentation. Each surface owns its own content and title.

Opening a new surface closes the currently visible sibling surface. Escape and backdrop close the active surface and restore focus to the launcher that opened it. Toolbar `aria-expanded` values reflect the active surface, not merely the last clicked tab.

Within the content sheet, selecting a tab changes only `activeContentPanel`; it must not change the sheet launcher or focus restoration target.

## 4. Visual and responsive rules

- Content tabs use exactly three equal columns and never wrap.
- Settings has no content tab strip.
- Search has no content tab strip.
- All sheets share neutral application chrome tokens and the existing Apple-like corner radius, separator, shadow, typography, and focus ring.
- Desktop sheets remain floating beside the reader toolbar.
- Mobile sheets remain bottom sheets with safe-area padding and an independent scroll viewport.
- A sheet header remains fixed within the sheet while only its content body scrolls.
- The reading paper theme remains independent from application chrome.
- Remove the broad `settings-panel` class from the shared content sheet; use explicit `reader-sheet`, `reader-content-sheet`, `reader-settings-sheet`, and future `reader-search-sheet` classes.

## 5. Search boundary and future contract

The future user search feature should use a dedicated endpoint and response model, for example:

`GET /api/books/:bookId/search?q=&scope=book|chapter&chapterIndex=&limit=`

The response should contain exact full-text matches, chapter identity, a short snippet, and a semantic locator. It should use the existing book index/SQLite FTS infrastructure where appropriate, but must not call the AI provider and must not consume AI tokens. Search history retention and index lifecycle remain separate from this UI refactor.

## 6. Compatibility and non-goals

This change must preserve:

- EPUB-only bookmark availability and server synchronization.
- Whole-book notes/annotations and their filters.
- TOC navigation and current-location rendering.
- AI modal, streaming state, sources, and conversation behavior.
- Existing settings IDs, persistence, typography sliders, reading modes, and themes.
- Single-page, double-page, continuous-scroll, desktop, mobile, keyboard, and touch entry points.

This change does not implement full-text search, change the AI retrieval algorithm, change server APIs, or alter book formats.

## 7. Acceptance criteria

1. The content sheet exposes exactly three content tabs and the display settings label is absent from that tablist.
2. Opening settings renders a sibling settings sheet with no content tabs.
3. Opening TOC, bookmarks, or notes renders only the content sheet.
4. Opening one reader surface hides the other reader surfaces and preserves focus restoration.
5. The reserved search button remains disabled and does not issue requests.
6. Existing AI, bookmark, notes, settings, and reading-mode regression tests remain green.
7. Desktop and mobile surfaces have one scroll owner per sheet and do not allow content to be hidden by the topbar.

