# Reader Annotations and Notes Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WeRead-style EPUB selection actions and a right-side, whole-book annotations and notes view without regressing EPUB pagination, persistence, or accessibility.

**Architecture:** Introduce a short-lived `SelectionSession` for menu actions, evolve persisted highlight records into backwards-compatible annotations, and use the existing right Drawer as the book-level notes browser. Keep DOM Range locators and the existing server `highlights` collection in the first release; drawing remains an article overlay so it works with the project's paged and scrolling DOM renderers.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js server storage, Happy DOM unit tests, Playwright Chromium E2E, fnOS FPK packaging.

**Spec:** `docs/superpowers/specs/2026-09-20-reader-annotations-and-notes-sidebar-design.md`

## Global Constraints

- EPUB only; do not add persistent annotations to Markdown/TXT in this plan.
- Preserve the current `locator`, `chapterHref`, `text`, `contextBefore`, `contextAfter`, `note`, `color`, and `createdAt` fields and default old records to `highlight/marker`.
- Do not add a browser-visible AI key, provider SDK, or fake AI response; AI must remain local-configuration aware until a server adapter exists.
- Keep the existing `/api/books/:bookId/highlights` API compatible during tasks 1–5.
- Use the DOM Range path as the only new feature path. Do not extend the legacy `epubRendition`/CFI selection branch.
- Preserve the paged-mode `article.scrollLeft` coordinate correction in annotation rendering.
- Keep full-book records scoped by the current `bookId` and existing fnOS user identity.
- Product-code edits use `apply_patch`; do not stage or modify unrelated working-tree changes.

## Review Focus

- A cross-chapter selection must not create a corrupt locator; show an explanatory hint and no menu action.
- A note entry in a later, unmounted paged chapter must load that chapter before calculating its target page.
- A note entry in a scrolling book whose background chapter has not yet appended must still navigate or show a recoverable error, not silently fail.
- A long multi-line selection must draw every line and place the menu on-screen without covering the action that dismisses it.
- Old marker-only records must survive style-schema normalization and export with unchanged quote and note text.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/ui/reader/selection-menu.js` | Capture/validate selection, own `SelectionSession`, position the fixed menu, copy text, and dispatch annotation/thought/AI actions. |
| `app/ui/reader/highlights.js` | Maintain locator serialization and recovery; create, normalize, render, edit, and delete annotations. |
| `app/ui/reader/notes-panel.js` | Render/filter/sort whole-book annotations and navigate a selected entry to its quote. |
| `app/ui/shell/drawer.js` | Enable notes panel, add tab switching and action mapping without changing Drawer focus behavior. |
| `app/ui/index.html` | Add menu/dialog/panel markup, the Notes Drawer tab, and mobile Notes launcher. |
| `app/ui/styles.css` | Style menu, marker/wave/line overlays, notes rows, focus flash, responsive Drawer and mobile controls. |
| `app/ui/core/user-state.js` | Normalize old and new annotation records while loading the authoritative server state. |
| `app/ui/reader/actions.js` | Serialize `kind`, `style`, and `updatedAt`; extend export labels. |
| `app/server/storage.js` | Validate and persist compatible annotation fields. |
| `e2e/selection-menu.spec.js` | Exercise real selection, menu actions, placement, persistence, and accessibility states. |
| `e2e/notes-panel.spec.js` | Exercise whole-book list, filters, cross-chapter navigation, and mobile launcher. |
| `tests/dom-regression.test.js` | Keep markup/action contracts and pure DOM helpers covered. |
| `tests/reader-core.test.js` | Verify storage validation and backwards-compatible normalization. |

## Interfaces

```js
// selection-menu.js
function captureSelectionSession(): SelectionSession | null;
function openSelectionMenu(session: SelectionSession): void;
function dismissSelectionMenu(reason?: string): void;

// highlights.js
function createAnnotationFromSession(session, { kind, style, note? }): Annotation | null;
function normalizeAnnotation(record): Annotation;
function redrawDomHighlights(): void;

// notes-panel.js
function renderNotesPanel({ filter, sort } = {}): void;
async function navigateToAnnotation(annotationId): Promise<boolean>;

// drawer.js
function openReaderPanel(panelName, trigger?): boolean;
```

## Tasks

### Task 1: Define annotation compatibility and server validation

**Files:**
- Modify: `app/ui/core/user-state.js:151-195`
- Modify: `app/ui/reader/actions.js:70-91`
- Modify: `app/server/storage.js:190-239`
- Modify: `tests/reader-core.test.js:110-151`

**Consumes:** Existing persisted `highlights` array and DOM-range `locator` JSON.

**Produces:** Normalized `Annotation` objects whose old records resolve to `kind: 'highlight'`, `style: 'marker'`, with allowed new values `highlight|thought` and `marker|wave|line|none`.

- [ ] **Step 1: Write a failing storage test for old and new records**

```js
const saved = await storage.replaceHighlights('alice', BOOK_ID, [{
  id: 'old-marker', locator: 'legacy', chapterHref: 'OPS/1.xhtml', text: '旧划线',
  contextBefore: '', contextAfter: '', note: '', color: 'yellow', createdAt: '2026-09-20T00:00:00.000Z'
}, {
  id: 'wave-thought', locator: 'locator', chapterHref: 'OPS/2.xhtml', text: '新笔记',
  contextBefore: '', contextAfter: '', note: '我的想法', color: 'blue',
  kind: 'thought', style: 'wave', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:01:00.000Z'
}]);
assert.equal(saved[0].style, 'marker');
assert.equal(saved[1].kind, 'thought');
assert.equal(saved[1].style, 'wave');
```

- [ ] **Step 2: Run the focused test and confirm the new fields are absent or rejected before implementation**

Run: `node --test tests/reader-core.test.js --test-name-pattern "annotation compatibility"`

Expected: FAIL because `replaceHighlights()` currently discards `kind`, `style`, and `updatedAt`.

- [ ] **Step 3: Normalize and whitelist the schema**

```js
const allowedKinds = new Set(['highlight', 'thought']);
const allowedStyles = new Set(['marker', 'wave', 'line', 'none']);
const kind = allowedKinds.has(item.kind) ? item.kind : 'highlight';
const style = allowedStyles.has(item.style) ? item.style : 'marker';
```

Persist these fields in `storage.js`; have `loadHighlights()` return them for old and new records; include them in `serializeHighlightForServer()` without changing the endpoint.

- [ ] **Step 4: Re-run focused tests and the existing persistence tests**

Run: `node --test tests/reader-core.test.js && npx playwright test e2e/highlights.spec.js --project=chromium --workers=1`

Expected: Existing marker and note persistence remains green; new schema test passes.

### Task 2: Extract annotation creation and support all three drawing styles

**Files:**
- Modify: `app/ui/reader/highlights.js:274-696`
- Modify: `app/ui/styles.css:636-651,1844-1866`
- Modify: `tests/dom-regression.test.js`
- Test: `e2e/selection-menu.spec.js`

**Consumes:** `SelectionSession.locator`, cloned DOM `Range`, current color preference, and normalized annotations.

**Produces:** `createAnnotationFromSession(session, options)` and style-aware overlay elements using `data-annotation-style`.

- [ ] **Step 1: Add a failing DOM test for style normalization and per-line rendering contract**

```js
const annotation = api.normalizeAnnotation({ id: 'a', text: 'text', color: 'yellow', style: 'wave' });
assert.equal(annotation.style, 'wave');
assert.match(highlightsSource, /data-annotation-style/);
```

- [ ] **Step 2: Run it before changing rendering**

Run: `node --test tests/dom-regression.test.js --test-name-pattern "annotation style"`

Expected: FAIL because rendered rectangles carry only `data-highlight-color`.

- [ ] **Step 3: Replace single-purpose creation with a session-based factory**

```js
function createAnnotationFromSession(session, { kind = 'highlight', style = 'marker', note = '' } = {}) {
  if (!session?.locator || !session?.range || !state.currentBookId) return null;
  const annotation = { id: highlightId(), kind, style, color: state.highlightColor,
    chapterHref: session.locator.chapterHref, text: session.text, domRange: session.locator,
    contextBefore: session.locator.contextBefore, contextAfter: session.locator.contextAfter,
    note: String(note).slice(0, 4000), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  // append, render, queue existing save chain, then return annotation
}
```

Use CSS classes for marker and line. Render wave decoration with a child SVG path or a CSS background on each rectangle; do not change text nodes or wrap EPUB source HTML.

- [ ] **Step 4: Add focused E2E cases and run them**

```js
test('marker, wave, and line preserve their style through reload', async ({ page }) => {
  for (const style of ['marker', 'wave', 'line']) {
    await selectArticleText(page, FIXTURE_TEXT.firstParagraph);
    await page.locator(`[data-selection-action="${style}"]`).click();
  }
  await expect(page.locator('[data-annotation-style="wave"]')).toHaveCountGreaterThan(0);
});
```

Run: `npx playwright test e2e/selection-menu.spec.js --project=chromium --workers=1 --grep "preserve their style"`

Expected: PASS before and after reload, with distinct persisted styles.

### Task 3: Implement SelectionSession and the six-action fixed menu

**Files:**
- Create: `app/ui/reader/selection-menu.js`
- Modify: `app/ui/index.html`
- Modify: `app/ui/app.js`
- Modify: `app/ui/reader/highlights.js`
- Modify: `app/ui/styles.css`
- Test: `e2e/selection-menu.spec.js`

**Consumes:** Browser `Selection`, `Range`, `serializeDomRange()`, and annotation factory from Task 2.

**Produces:** A body-level `#selectionMenu[role="toolbar"]` with copy, marker, wave, line, thought, and ask-AI actions.

- [ ] **Step 1: Write failing real-selection tests**

```js
test('real selection opens the six-action menu inside the viewport', async ({ page }) => {
  await selectArticleText(page, FIXTURE_TEXT.firstParagraph);
  await expect(page.locator('#selectionMenu')).toBeVisible();
  await expect(page.locator('#selectionMenu [data-selection-action]')).toHaveCount(6);
  const box = await page.locator('#selectionMenu').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: Run and verify it fails because only `.highlight-pill` exists**

Run: `npx playwright test e2e/selection-menu.spec.js --project=chromium --workers=1 --grep "six-action menu"`

Expected: FAIL because `#selectionMenu` is absent.

- [ ] **Step 3: Create and validate sessions before menu display**

`captureSelectionSession()` must reject a collapsed selection, a selection outside `#article`, a selection whose common ancestor has no `.epub-chapter`, or normalized text over 4,000 characters. Clone the Range, serialize its locator before opening UI, calculate the preferred anchor with `range.getBoundingClientRect()`, and store no selection in global persistent state.

- [ ] **Step 4: Implement actions with a single dispatch table**

```js
const selectionActions = Object.freeze({
  copy: () => copySelectionText(activeSelectionSession.text),
  marker: () => createAnnotationFromSession(activeSelectionSession, { style: 'marker' }),
  wave: () => createAnnotationFromSession(activeSelectionSession, { style: 'wave' }),
  line: () => createAnnotationFromSession(activeSelectionSession, { style: 'line' }),
  thought: () => openThoughtComposer(activeSelectionSession),
  ai: () => openAiForSelection(activeSelectionSession)
});
```

Close the visual menu after a terminal action, but preserve the copied session while the thought or AI dialog is open. Use `navigator.clipboard.writeText()` first and an explicit fallback/error message second.

- [ ] **Step 5: Verify menu lifecycle**

Run: `npx playwright test e2e/selection-menu.spec.js --project=chromium --workers=1 --grep "six-action|outside|Escape|copy"`

Expected: PASS for click-outside, Escape, copy success/failure, and scroll/resize dismissal.

### Task 4: Turn the highlight editor into a thought composer

**Files:**
- Modify: `app/ui/index.html:163-187`
- Modify: `app/ui/reader/highlights.js:360-470`
- Modify: `app/ui/styles.css:1866-1975`
- Test: `e2e/selection-menu.spec.js`

**Consumes:** `SelectionSession` and `Annotation` factory.

**Produces:** A composer that can create a `thought` with optional visual style, edit notes, or cancel without mutation.

- [ ] **Step 1: Add failing tests for create/cancel/edit thought flow**

```js
test('write thought saves a quoted note and cancel creates nothing', async ({ page }) => {
  await selectArticleText(page, FIXTURE_TEXT.firstParagraph);
  await page.locator('[data-selection-action="thought"]').click();
  await page.locator('#highlightEditorNote').fill('这是一条想法');
  await page.locator('#btnSaveHighlight').click();
  await expect.poll(() => readHighlightState(page)).toContainEqual(expect.objectContaining({ kind: 'thought', note: '这是一条想法' }));
});
```

- [ ] **Step 2: Run focused test and confirm current editor has no pending-session create path**

Run: `npx playwright test e2e/selection-menu.spec.js --project=chromium --workers=1 --grep "write thought"`

Expected: FAIL before implementation.

- [ ] **Step 3: Add explicit editor modes**

Use `openThoughtComposer(session)` for creation and `openHighlightEditor(id)` for existing records. The save button must branch on mode, use the same queued save chain, restore focus correctly, and never create an empty thought.

- [ ] **Step 4: Run focused and existing note tests**

Run: `npx playwright test e2e/selection-menu.spec.js e2e/highlights.spec.js --project=chromium --workers=1 --grep "thought|note"`

Expected: New thought flow and existing highlight-note editing both pass.

### Task 5: Build the whole-book Notes Drawer panel and controls

**Files:**
- Create: `app/ui/reader/notes-panel.js`
- Modify: `app/ui/index.html:39-196`
- Modify: `app/ui/shell/drawer.js:3-160`
- Modify: `app/ui/reader/highlights.js`
- Modify: `app/ui/app.js`
- Modify: `app/ui/styles.css`
- Test: `e2e/notes-panel.spec.js`
- Test: `tests/dom-regression.test.js`

**Consumes:** `loadHighlights()`, current book metadata, TOC data, and Drawer open/close behavior.

**Produces:** Enabled `btnNotes`, a “目录｜笔记｜显示” tab set, counters, filters, list rows, empty state, and mobile Notes launcher.

- [ ] **Step 1: Write failing Drawer contract tests**

```js
test('Notes is an enabled Drawer panel and the toolbar uses the planned position', async ({ page }) => {
  await openEpubFixture(page);
  await expect(page.locator('#btnNotes')).toBeEnabled();
  await page.locator('#btnNotes').click();
  await expect(page.locator('#readerPanelNotes')).toBeVisible();
  await expect(page.locator('[data-reader-panel-target="notes"]')).toHaveAttribute('aria-selected', 'true');
});
```

- [ ] **Step 2: Run it before enabling the reserved control**

Run: `npx playwright test e2e/notes-panel.spec.js --project=chromium --workers=1 --grep "enabled Drawer"`

Expected: FAIL because `btnNotes` is disabled and `readerPanels.notes.enabled()` returns false.

- [ ] **Step 3: Implement the panel and planned control order**

Change the toolbar order to TOC, Notes, Export, divider, Theme, Settings. Add `drawerTabNotes`, set `readerPanels.notes.enabled` to `state.contentType === 'epub'`, and make `openReaderPanel('notes')` call `renderNotesPanel()`. Preserve old action IDs until related features are separately implemented.

- [ ] **Step 4: Implement deterministic data view**

`renderNotesPanel()` must derive chapter labels, sort by chapter+position by default, render quote and optional note safely via `textContent`, show counts, and filter by `all`, `marks`, or `thoughts`. Render an empty state instead of a placeholder when the collection is empty.

- [ ] **Step 5: Add and run tests for filters and reload persistence**

Run: `npx playwright test e2e/notes-panel.spec.js --project=chromium --workers=1 --grep "filter|whole book|reload"`

Expected: Entries from two chapters are visible in one panel, filters change row count, and reload retains rows.

### Task 6: Implement cross-chapter navigation from note rows

**Files:**
- Modify: `app/ui/reader/notes-panel.js`
- Modify: `app/ui/reader/document.js:191-302`
- Modify: `app/ui/reader/epub.js:775-850`
- Modify: `app/ui/reader/pagination.js`
- Test: `e2e/notes-panel.spec.js`
- Test: `e2e/epub-resilience.spec.js`

**Consumes:** Annotation locator, `state.epubArchive.chapterIndexByPath`, `navigateToEpubChapter()`, `rangeFromHighlight()`, and pagination settlement.

**Produces:** `navigateToAnnotation(annotationId)` that supports mounted scroll chapters, unmounted scroll chapters, and paged chapter windows.

- [ ] **Step 1: Write failing two-chapter E2E navigation test**

```js
test('a whole-book note opens its later chapter and focuses the quote in double-page mode', async ({ page }) => {
  // create chapter 1 and chapter 2 annotations, return to chapter 1, open Notes
  await page.locator('[data-annotation-id="chapter-2-id"]').click();
  await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', /chapter-2/);
  await expect(page.locator('.annotation-focus-flash')).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm current notes placeholder cannot navigate**

Run: `npx playwright test e2e/notes-panel.spec.js --project=chromium --workers=1 --grep "later chapter"`

Expected: FAIL before implementation.

- [ ] **Step 3: Implement page-mode navigation sequence**

Await `navigateToEpubChapter(index)`, recover the range only after the chapter and pagination settle, use the current semantic navigation helper, redraw, then add a 1.5-second `.annotation-focus-flash` class. On locator failure, keep the Drawer open and render a visible row-level error.

- [ ] **Step 4: Implement scrolling-mode unmounted chapter fallback**

Expose a narrow helper from the whole-book renderer that waits until a requested chapter is appended or loads that chapter into the reader without clearing annotation state. Do not call `scrollIntoView()` until the target chapter exists.

- [ ] **Step 5: Run navigation and resilience suites**

Run: `npx playwright test e2e/notes-panel.spec.js e2e/epub-resilience.spec.js e2e/viewport.spec.js --project=chromium --workers=1`

Expected: Cross-chapter note navigation works in scroll and double modes without breaking page alignment or async chapter generation rules.

### Task 7: Add AI boundary, mobile notes entry, and accessibility checks

**Files:**
- Modify: `app/ui/reader/selection-menu.js`
- Modify: `app/ui/index.html`
- Modify: `app/ui/shell/drawer.js`
- Modify: `app/ui/styles.css`
- Test: `e2e/selection-menu.spec.js`
- Test: `e2e/notes-panel.spec.js`

**Consumes:** SelectionSession, Drawer infrastructure, and current feature-availability state.

**Produces:** A non-networked AI unavailable state, mobile Notes entry, and keyboard-operable menu/panel behavior.

- [ ] **Step 1: Write failing tests for safe AI and mobile Notes**

```js
test('Ask AI exposes configuration state and sends no request when unavailable', async ({ page }) => {
  await selectArticleText(page, FIXTURE_TEXT.firstParagraph);
  await page.locator('[data-selection-action="ai"]').click();
  await expect(page.locator('[role="status"]')).toContainText('未配置 AI 服务');
});
```

- [ ] **Step 2: Run test before adding the boundary**

Run: `npx playwright test e2e/selection-menu.spec.js e2e/notes-panel.spec.js --project=chromium --workers=1 --grep "AI|mobile Notes"`

Expected: FAIL because no selection menu or mobile Notes control exists.

- [ ] **Step 3: Add safe unavailable behavior and responsive entry**

Implement `openAiForSelection(session)` with an injected `window.browserHost.aiStatus?.()` capability check. If absent/unconfigured, show a local status message only. Add `btnMobileNotes` and make it open the Notes Drawer bottom sheet; do not expose a provider URL or credential field in this task.

- [ ] **Step 4: Validate keyboard and ARIA behavior**

Add assertions for `role="toolbar"`, six labelled buttons, Escape ordering, tab focus remaining inside the Drawer, selected Notes tab attributes, and focus return to the initiating toolbar button.

- [ ] **Step 5: Run focused accessibility scenarios**

Run: `npx playwright test e2e/selection-menu.spec.js e2e/notes-panel.spec.js --project=chromium --workers=1 --grep "Escape|focus|ARIA|mobile"`

Expected: PASS across desktop and 390px mobile viewport scenarios.

### Task 8: Export, performance, regression, and fnOS verification

**Files:**
- Modify: `app/ui/reader/actions.js`
- Modify: `app/ui/reader/highlights.js`
- Modify: `e2e/highlights.spec.js`
- Modify: `e2e/real-epub-investigation.spec.js`
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`

**Consumes:** Complete annotation schema and Notes Drawer implementation.

**Produces:** Style-aware Markdown export, bounded sidebar rendering, and complete desktop/fnOS verification evidence.

- [ ] **Step 1: Write failing export assertion**

```js
expect(content).toContain('类型：波浪线');
expect(content).toContain('想法：我的想法');
```

- [ ] **Step 2: Run export test before format change**

Run: `npx playwright test e2e/highlights.spec.js --project=chromium --workers=1 --grep "export highlights"`

Expected: FAIL because current export emits only quote and optional generic note.

- [ ] **Step 3: Implement bounded rendering and export labels**

Render Notes rows in chunks of 50, with a “加载更多” button after the first 50. Keep export deterministic by chapter order and include type labels only for new styles; preserve old quote-only export text.

- [ ] **Step 4: Run complete automated gates**

Run: `npm test && npm run check && npx playwright test --project=chromium --workers=1 && npm run build:fpk`

Expected: Node tests, structure validation, all Chromium E2E tests, and FPK build succeed.

- [ ] **Step 5: Perform target-device acceptance**

Follow `docs/FNOS_DEVICE_ACCEPTANCE.md` on x86_64 and ARM64 fnOS devices. Record selection, clipboard, wave rendering, Drawer navigation, later-chapter jump, reload recovery, and AI-unconfigured behavior separately from desktop Chromium results.

## Plan Self-Review

- Spec coverage: Tasks 1–4 implement selection, persistence, three styles and thoughts; Tasks 5–6 implement whole-book notes and cross-chapter jumps; Task 7 defines AI and mobile boundaries; Task 8 covers export, performance and target verification.
- Compatibility: every new stored field has a defined old-record default; endpoint names and existing locator fields remain intact.
- High-risk inputs: cross-chapter selections, unmounted chapters, multi-line rectangles, old records, and unconfigured AI each have owning tests.
- Scope: provider-specific AI implementation and Markdown/TXT anchors are intentionally excluded from this plan.
