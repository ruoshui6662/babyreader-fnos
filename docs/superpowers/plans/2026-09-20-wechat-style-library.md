# WeChat-style Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized card shelf with a dense, white, WeChat Reading-inspired book grid while preserving every library action and reader behavior.

**Architecture:** Keep `renderLibrary(library)` as the sole owner of book rendering and retain all book objects, click handlers, and existing IDs. Add library-only presentation classes and CSS so the reader's document column, EPUB geometry, settings, API calls, and user preferences remain untouched. Use a dense left-aligned grid with book covers as the visual unit rather than elevated container cards.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Playwright Chromium E2E, Node test runner, fnOS FPK packaging.

**Spec:** User-approved in-chat design from 2026-09-20, informed by supplied WeChat Reading desktop screenshots.

## Global Constraints

- Do not change `/app/babyreader-fnos`, `browserHost.scanLibrary`, `browserHost.openBook`, authorization behavior, or book data formats.
- Preserve existing IDs, settings state, EPUB pagination variables, multi-user state, and reading/highlight behavior.
- Apply the white WeChat-like presentation only to the library in light and sepia themes; preserve a dark neutral variant for dark theme.
- Do not use `justify-content: space-between` for the desktop book grid.
- Keep book covers at a 2:3 aspect ratio and avoid cropping source covers.
- All product-code edits use `apply_patch`; no commit is created because the shared worktree contains unrelated user changes.

## Review Focus

- A four-book library on a 27-inch viewport must be compact and left-aligned, not stretched across a sparse row.
- A large library must wrap predictably without overlapping titles or making columns too narrow.
- A book with no cover must retain the same 2:3 visual slot and remain clickable.
- Narrow screens must remain usable with two and then one column.
- Opening a book from the redesigned library must still restore the normal reading layout rather than library-specific CSS.

---

### Task 1: Dense library presentation and neutral library surface

**Files:**
- Modify: `app/ui/styles.css:446-457,1205-1380`
- Modify: `app/ui/library/view.js:8-130`
- Test: `e2e/reader.spec.js:75-106`

**Interfaces:**
- Consumes: `renderLibrary(library)`, `book.coverUrl`, `book.title`, `book.author`, and the existing `.is-library` state class.
- Produces: A library-only `.wechat-library` presentation hook, left-aligned dense book grid, neutral light/sepia surface, and dark-theme equivalent without changing book-opening callbacks.

- [ ] **Step 1: Write failing E2E tests for the WeChat-style shelf contract**

```js
test('wide library keeps compact left-aligned WeChat-style cover slots', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP_PATH);
  await expect(page.locator('.library-grid')).toHaveCSS('justify-content', 'start');
  await expect(page.locator('.library-book').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.library-book-cover').first()).toHaveCSS('width', '152px');
});
```

- [ ] **Step 2: Run the new test and verify it fails because the current layout uses elevated 210px cards and distributed columns**

Run: `npx playwright test e2e/reader.spec.js --project=chromium --workers=1 --grep "WeChat-style cover slots"`

Expected: FAIL because the grid is `space-between`, cards have a shadow, and cover width is not `152px`.

- [ ] **Step 3: Implement the library-only CSS and minimal markup hook**

```css
body.is-library.theme-light,
body.is-library.theme-sepia {
  --library-stage: #fff;
  --library-muted: #888;
}

.library-grid {
  grid-template-columns: repeat(auto-fill, 152px);
  justify-content: start;
  gap: 36px 28px;
}

.library-book {
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
```

Keep `.library-book` buttons and their click callbacks intact. Preserve `img` source and `alt` behavior; for absent covers, keep the existing placeholder element at the same 2:3 ratio.

- [ ] **Step 4: Run the focused E2E test and verify it passes**

Run: `npx playwright test e2e/reader.spec.js --project=chromium --workers=1 --grep "WeChat-style cover slots"`

Expected: PASS with compact 152px cover slots, no elevated card shell, and left-aligned desktop grid.

### Task 2: Typography, responsive grid, and regression coverage

**Files:**
- Modify: `app/ui/styles.css:1205-1380`
- Modify: `e2e/reader.spec.js:75-106,383-400`

**Interfaces:**
- Consumes: The Task 1 library-only surface and existing `.library-book`, `.library-book-cover`, `.library-book-metadata` classes.
- Produces: 12px/13px metadata hierarchy, responsive 4/3/2/1 column grid thresholds, and tests proving the existing book-opening action still works.

- [ ] **Step 1: Write failing E2E tests for metadata density and responsive columns**

```js
test('WeChat-style library compacts metadata and keeps book opening intact', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP_PATH);
  await expect(page.locator('.library-book strong').first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('.library-book span').first()).toHaveCSS('font-size', '12px');
  await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
  await expect(page.locator('#fileName')).toHaveText('E2E Markdown');
});
```

- [ ] **Step 2: Run the new test and verify it fails because current metadata is larger than the approved hierarchy**

Run: `npx playwright test e2e/reader.spec.js --project=chromium --workers=1 --grep "compacts metadata"`

Expected: FAIL because the current book title and author styles are 15px and 13px.

- [ ] **Step 3: Implement compact typography and responsive thresholds**

```css
.library-book strong { font-size: 13px; line-height: 1.45; }
.library-book span { font-size: 12px; line-height: 1.4; }

@media (max-width: 900px) { .library-grid { grid-template-columns: repeat(3, 152px); } }
@media (max-width: 640px) { .library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .library-grid { grid-template-columns: minmax(0, 1fr); } }
```

Use `object-fit: contain` for real cover images, preserving their art rather than cropping it. Keep a quiet hover/focus lift that does not reintroduce an always-visible card shell.

- [ ] **Step 4: Run focused and full verification**

Run: `npx playwright test e2e/reader.spec.js --project=chromium --workers=1 && npm test && npm run check`

Expected: All Playwright library, reader, drawer, and mobile scenarios pass; Node tests pass with platform skips only; structure validation passes.

- [ ] **Step 5: Bump static asset query versions and build the FPK**

Update every first-party `?v=24` URL in `app/ui/index.html` to the next version and update the resource assertions in `e2e/reader.spec.js`. Then run:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' scripts/build-fpk.sh
Get-FileHash 'dist\babyreader-fnos.fpk' -Algorithm SHA256
```

Expected: Packaging succeeds, and extracting `ui/index.html` from the FPK shows the new asset version.
