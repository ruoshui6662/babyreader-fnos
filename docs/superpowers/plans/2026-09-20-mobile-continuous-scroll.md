# Mobile Continuous Scroll Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make continuous-scroll reading mobile-first without changing the PC reader surface.

**Architecture:** Add a centralized device profile, keep chapter navigation in document flow, and make the mobile toolbar a collapsed one-row HUD. Reuse the existing `data-reader-action` dispatcher so desktop and mobile buttons share the same actions.

**Tech Stack:** Vanilla browser JavaScript, CSS media/material variables, Node test runner, happy-dom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-mobile-continuous-scroll-design.md`

## Global Constraints

- PC layout and behavior must remain unchanged.
- Mobile profile targets Android, iPhone, iPad/iPadOS, including iPad desktop-mode UA.
- Continuous scroll must hide page navigation and show chapter navigation in document flow.
- Do not load the whole EPUB or alter progress/highlight data formats.
- Do not commit unrelated pre-existing worktree changes.

## Review Focus

- iPad desktop-mode UA with touch points must use mobile chrome; test in Task 1.
- A narrow desktop window must remain PC; test in Task 1.
- Continuous-scroll mobile must not show page actions; test in Task 2.
- Mobile toolbar must not reduce reader height while collapsed; test in Task 2.
- Clicking a mobile action must invoke the shared action dispatcher once; test in Task 3.

### Task 1: Device profile and mobile chrome state

**Files:**
- Create: `app/ui/reader/device-profile.js`
- Modify: `app/ui/index.html:232-249`
- Modify: `app/ui/app.js:150-175`
- Test: `tests/dom-regression.test.js`

**Interfaces:**
- Produces `getReaderDeviceProfile()` and `setupReaderDeviceProfile()` globals.
- Sets `document.documentElement.dataset.readerSurface` to `mobile` or `desktop`.
- Sets `document.body.dataset.mobileChrome` to `open` or `closed` through `setMobileChromeOpen()`.

- [ ] Add failing tests for Android, iPhone, iPad desktop-mode and narrow desktop classification.
- [ ] Run the focused tests and confirm the new profile functions are missing.
- [ ] Implement the profile module and load it before app boot.
- [ ] Add a compact `mobileReaderChromeToggle` button and mobile action data attributes.
- [ ] Run the focused and full Node test suites.

### Task 2: Continuous-scroll layout and mode-specific controls

**Files:**
- Modify: `app/ui/reader/highlights.js:176-215`
- Modify: `app/ui/reader/progress.js:150-176,255-280`
- Modify: `app/ui/styles.css:1148-1180,1986-2030,2444-2515`
- Test: `tests/dom-regression.test.js`

**Interfaces:**
- Consumes `getReaderDeviceProfile()` and `state.effectiveReadingMode`.
- Preserves existing `readerActions` and chapter navigation IDs.

- [ ] Add failing DOM assertions for scroll mode hiding page actions and keeping flow chapter controls visible.
- [ ] Run the assertions and confirm they fail against the fixed two-row toolbar/hide rules.
- [ ] Scope mobile-only styles to `html[data-reader-surface="mobile"]`.
- [ ] Remove the fixed 104px reader reservation and make the toolbar one-row overlay only when open.
- [ ] Re-enable mobile chapter header/footer controls and keep them in document flow.
- [ ] Update progress/pagination state to hide mobile page controls in scroll mode.
- [ ] Run Node tests and structure validation.

### Task 3: Shared mobile interaction and progressive disclosure

**Files:**
- Modify: `app/ui/reader/lifecycle.js:1-60,60-100`
- Modify: `app/ui/shell/drawer.js:133-154`
- Modify: `app/ui/reader/highlights.js:176-215`
- Modify: `app/ui/styles.css:1986-2030`
- Test: `tests/dom-regression.test.js`, `e2e/reader.spec.js`

**Interfaces:**
- Uses the existing `readerActions` dispatch map.
- `setMobileChromeOpen(open)` owns visibility and body state.

- [ ] Add a failing test proving mobile action buttons have `data-reader-action` and no duplicate direct listeners are needed.
- [ ] Run the focused test and confirm the legacy mobile listener path still exists.
- [ ] Remove duplicate mobile navigation/highlight listeners and rely on delegated actions.
- [ ] Add center-tap toggle, scroll auto-close and drawer auto-close behavior without hijacking text selection or controls.
- [ ] Add safe-area padding and minimum 44px touch targets to the single-row HUD.
- [ ] Run the full Node and Chromium suites.

### Task 4: Verification and FPK packaging

**Files:**
- Modify: `app/ui/index.html` cache-bust versions only if needed.
- Create: no new production files.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run `npm run test:e2e -- --project=chromium`.
- [ ] Run `npm run build:fpk`.
- [ ] Verify the generated FPK and record its SHA-256 without touching unrelated files.
