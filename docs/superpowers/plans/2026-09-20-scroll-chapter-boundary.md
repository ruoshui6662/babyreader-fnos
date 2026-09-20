# Continuous Scroll Chapter Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EPUB 连续滚动改为微信读书式的单章节窗口：当前章独立滚动，章末显示“下一章”，章首左侧显示“上一章”，不再把整本书追加进 DOM。

**Architecture:** 保留现有 `openEpubArchive()`、`loadEpubChapter()` 和单章 generation 机制；移除连续滚动对 `renderEpubWholeBook()` 的依赖，使连续滚动和分页模式都通过 `renderEpubChapter()` 只挂载一个章节。新增连续滚动专用章节头/尾控件，旧顶栏章节控件继续服务分页模式，避免改变双页翻页的稳定路径。

**Tech Stack:** 原生浏览器 JavaScript、JSZip、现有 EPUB 清洗/资源预算、Node `node:test`、Playwright Chromium、现有 FPK 构建脚本。

**Spec:** `docs/superpowers/specs/2026-09-20-scroll-chapter-boundary-design.md`

## Global Constraints

- 连续滚动打开流程只等待当前章节；`#article` 中最多保留一个 `.epub-chapter`。
- 现有 ZIP 路径校验、HTML/CSS 清洗、单资源 8 MB 和会话 48 MB 资源预算保持不变。
- 既有服务端 progress/highlights 接口继续使用 JSON locator 和全量高亮数组。
- 双页分页不改变现有纸张几何、页组边界和顶栏章节按钮语义。
- 不引入新运行时依赖，不把真实用户 EPUB 放入仓库或 FPK。
- 所有行为修改先写失败测试，再写最小实现；不得以人工刷新代替回归测试。

## Review Focus

- 连续滚动不得因后台任务把第二章或整书追加进 DOM；由 Task 2 的 DOM 数量和 network/loader 断言覆盖。
- 快速连续点击目录或章节按钮时，旧异步结果不能覆盖最后一次目标；由 Task 2 的 generation 测试覆盖。
- 章节内比例与全书百分比不能混淆，旧 progress 必须能恢复到合理章节；由 Task 3 的 locator 测试覆盖。
- 章末按钮必须在最后一章隐藏，章首上一章按钮必须在第一章隐藏，加载期间控件必须禁用；由 Task 1/2 的状态 E2E 覆盖。
- 当前章节切换后高亮 overlay 不能残留，导出不能丢失其他章节；由 Task 3 的跨章高亮测试覆盖。

### Task 1: Add the scroll chapter header/footer shell and mode-specific controls

**Files:**
- Modify: `app/ui/index.html:194-214`
- Modify: `app/ui/styles.css:428-452`, plus the final reader-mode rules near `2436-2625`
- Modify: `app/ui/reader/highlights.js:124-199`
- Modify: `app/ui/reader/progress.js:96-150`
- Test: `e2e/reader.spec.js`

**Interfaces:**
- Consumes: existing `readerActions.previousChapter`, `readerActions.nextChapter`, `state.effectiveReadingMode`, `state.currentChapterIndex`, and `state.epubChapterCount`.
- Produces: `#scrollChapterHeader`, `#btnScrollPreviousChapter`, `#scrollChapterFooter`, and `#btnScrollNextChapter`, all using `data-reader-action="previousChapter|nextChapter"` so no second click-routing system is introduced.

- [ ] **Step 1: Write failing browser assertions for the new shell.**

Add a continuous-scroll test after opening the fixture EPUB and assert:

```js
await expect(page.locator('#scrollChapterHeader')).toBeVisible();
await expect(page.locator('#btnScrollPreviousChapter')).toBeHidden();
await expect(page.locator('#scrollChapterFooter')).toBeVisible();
await expect(page.locator('#btnScrollNextChapter')).toBeVisible();
await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
```

Also assert that the legacy `.topbar-right .chapter-nav-btn` controls are hidden while `body.continuous-scroll` is active, so the same chapter action is not rendered twice.

- [ ] **Step 2: Run the focused test and confirm the old shell fails.**

Run:

```powershell
npx playwright test e2e/reader.spec.js --project=chromium --workers=1 --grep "continuous scroll chapter boundary"
```

Expected: FAIL because the current HTML has no scroll chapter header/footer and continuous mode still exposes the topbar chapter buttons.

- [ ] **Step 3: Add the semantic header/footer markup without changing action routing.**

Place the new header before `#article` and footer after `#article` inside `#reader`. Give both buttons `type="button"`, accessible Chinese labels, `data-reader-action`, and the same SVG chapter icons as the existing buttons. Keep the existing topbar button IDs unchanged for paged mode and keep the mobile toolbar unchanged.

- [ ] **Step 4: Add mode-scoped layout rules.**

Create a centered wrapper matching the reading column width. In continuous mode, the header reserves a small top rhythm and aligns the previous button to the article’s left edge; the footer is normal flow, centered, and padded below the chapter. In paged mode, hide the new header/footer completely. Do not add these controls to the article’s HTML, because replacing `article.innerHTML` must only replace chapter content.

- [ ] **Step 5: Synchronize visibility and disabled state.**

Extend `updateTopbarState()` and `updateReadingProgress()` to update both legacy topbar controls and the new scroll controls. The previous scroll button is hidden at index 0; the next footer is hidden at the last index; both are disabled while `isEpubChapterLoading()` is true. Re-run the focused E2E test and expect PASS.

### Task 2: Replace whole-book continuous rendering with one-chapter rendering

**Files:**
- Modify: `app/ui/reader/epub.js:596-863`
- Modify: `app/ui/reader/document.js:173-297`
- Modify: `app/ui/reader/pagination.js:325-390`, `535-559`
- Modify: `app/ui/core/state.js`
- Test: `tests/dom-regression.test.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: `EpubArchive`, `loadEpubChapter()`, the generation guard in `renderEpubChapter()`, and the shell from Task 1.
- Produces: continuous mode calls `renderEpubChapter(0)` on open; `navigateToEpubChapter(index, options)` always loads the target chapter when it is not already mounted; `renderEpubWholeBook()` has no production callers and is removed after its old background-render regression is replaced.

- [ ] **Step 1: Write the failing DOM regression for the new loading contract.**

Replace the existing “later chapters load in the background” test with a contract that stubs a four-chapter archive, calls the production open/render path in scroll mode, and asserts that after the open promise settles only chapter 1 exists and chapter 4 has not been read. Then call `navigateToEpubChapter(1)` and assert exactly one chapter remains in the DOM and its source path is chapter 2.

- [ ] **Step 2: Run the focused DOM tests and record the expected failure.**

Run:

```powershell
node --test tests/dom-regression.test.js
```

Expected: FAIL because `renderEpubDocument()` still calls `renderEpubWholeBook()` for scroll mode and `navigateToEpubChapter()` searches the whole-book DOM instead of loading the target.

- [ ] **Step 3: Change EPUB open to mount only the first chapter.**

In `renderEpubDocument()`, keep archive metadata and TOC setup, then call `await renderEpubChapter(0)` for both effective modes. Remove the scroll-only `INITIAL_CHAPTER_COUNT`, background concurrency, append batches, and fire-and-forget whole-book load. `destroyEpub()` must invalidate the old generation and release the archive as it does today.

- [ ] **Step 4: Make chapter navigation mode-independent at the DOM boundary.**

In `navigateToEpubChapter()`, remove the scroll-mode `querySelector()`/`scrollIntoView()` branch. If the requested index is the current mounted chapter, resolve the fragment locally; otherwise call `renderEpubChapter(index, options)`. On successful scroll-mode replacement, set `reader.scrollTop = 0` before the next paint and let locator restoration apply an explicit target position.

- [ ] **Step 5: Remove whole-book rehydration from reading-mode switches.**

In `setReadingMode()`, delete the `renderEpubWholeBook()` branch. When switching modes for an EPUB, keep the current chapter and run `measurePagination({ preserveLocator: true })`; if the mode switch needs a clean chapter layout, re-render only `state.epubChapterIndex` with the saved locator. There must be no path that appends another `.epub-chapter`.

- [ ] **Step 6: Run the DOM and Node gates.**

Run:

```powershell
node --test tests/dom-regression.test.js
npm test
```

Expected: the new single-chapter contract passes, parser/resource/security tests remain green, and the old whole-book test is no longer present.

### Task 3: Make chapter boundaries, TOC links, progress, and restoration explicit

**Files:**
- Modify: `app/ui/reader/progress.js:32-240`
- Modify: `app/ui/reader/navigation.js:153-225`
- Modify: `app/ui/reader/document.js:222-273`
- Modify: `app/ui/core/user-state.js:80-135`
- Test: `tests/dom-regression.test.js`
- Test: `e2e/persistence.spec.js`
- Test: `e2e/reader.spec.js`

**Interfaces:**
- Consumes: one-chapter DOM and `state.epubArchive.chapterIndexByPath` from Task 2.
- Produces: `currentReadingLocator()` with `readingScope: 'chapter'` and `chapterPercentage`; restoration that loads `href` before applying anchor/text/scroll; TOC and internal links that work when the target is not mounted.

- [ ] **Step 1: Add failing locator tests for chapter-local and legacy progress.**

Add DOM tests that set a chapter-local scroll position and assert `currentReadingLocator()` returns both `chapterPercentage` and a full-book `percentage` based on `(chapterIndex + localRatio) / chapterCount`. Add a legacy locator without `chapterPercentage` and assert restoration uses its valid `href` and anchor instead of applying the old whole-book scrollTop to the new chapter.

- [ ] **Step 2: Run the focused locator tests and verify the old semantics fail.**

Run:

```powershell
node --test tests/dom-regression.test.js --test-name-pattern "chapter-local|legacy progress"
```

Expected: FAIL because current scroll progress treats `reader.scrollTop / reader.scrollHeight` as the full-book percentage and has no `chapterPercentage` field.

- [ ] **Step 3: Implement chapter-local progress calculation.**

Add a helper in `progress.js` that derives the current chapter’s local scroll range from the reader viewport and mounted article. Store `chapterPercentage` for restoration and compute `percentage` as the clamped full-book ratio. Keep `href`, `anchor`, `textBefore`, and `scrollTop` unchanged for server compatibility.

- [ ] **Step 4: Restore chapter before position.**

Update `restoreTextScroll()`/`restoreReadingLocator()` to map the saved normalized href through `chapterIndexByPath`, call `navigateToEpubChapter()` when necessary, then restore the anchor, text context, `chapterPercentage`, or local scrollTop in that order. Invalid/missing href falls back to chapter 0 and clears loading state.

- [ ] **Step 5: Route TOC and EPUB internal links through the chapter loader.**

In `navigateEpubTarget()`, remove the scroll-mode requirement that `#br-chapter-${index}` already exists. For a different target chapter, call `navigateToEpubChapter(chapterIndex, { page: 1, fragment })`; after it resolves, locate the fragment in the one mounted section, update the current TOC target, and update progress. Invalid paths/fragments must leave the current chapter untouched.

- [ ] **Step 6: Add boundary E2E coverage.**

Extend `e2e/reader.spec.js` to open continuous mode, assert chapter 1 has no previous button and has a next footer, click next, assert chapter 2 is the only mounted chapter and the previous header is visible, then click previous and assert chapter 1 is restored. Extend `e2e/persistence.spec.js` to reload a saved later-chapter locator and assert one mounted chapter plus restored local position.

- [ ] **Step 7: Run focused E2E coverage.**

Run:

```powershell
npx playwright test e2e/reader.spec.js e2e/persistence.spec.js --project=chromium --workers=1 --grep "chapter|restor"
```

Expected: chapter buttons, TOC/internal links, boundary transitions, and reload restoration pass without loading all chapters.

### Task 4: Preserve highlights and prevent scroll-mode regressions

**Files:**
- Modify: `app/ui/reader/highlights.js:270-380`, `500-550`, `680-730`
- Modify: `app/ui/reader/settings.js:1-48`
- Modify: `app/ui/reader/lifecycle.js:60-80`
- Modify: `e2e/highlights.spec.js`
- Modify: `e2e/real-epub-investigation.spec.js`

**Interfaces:**
- Consumes: `state.epubChapterIndex`, mounted chapter path, and chapter-load generation from Task 2.
- Produces: current-chapter-only overlay drawing; all stored highlights remain available for export; scroll events save local chapter positions without initiating chapter loads.

- [ ] **Step 1: Add failing cross-chapter highlight assertions.**

Create one highlight in chapter 1, navigate to chapter 2, assert chapter 1 overlay nodes are gone, create a chapter 2 highlight, navigate back and assert only chapter 1 overlay nodes exist. Export and assert both highlight texts are present.

- [ ] **Step 2: Run the focused highlight test and confirm stale overlays remain.**

Run:

```powershell
npx playwright test e2e/highlights.spec.js --project=chromium --workers=1 --grep "chapter"
```

Expected before the fix: the old whole-book assumptions either keep an overlay from the previous chapter or cannot create the second chapter highlight without all chapters mounted.

- [ ] **Step 3: Filter redraw by the mounted chapter path.**

Before drawing, remove all `.br-highlight-box` nodes. Resolve locators only against the current `.epub-chapter` and compare normalized `chapterHref` with its `data-source-path`. Keep `loadHighlights()` and export serialization untouched so off-screen chapters remain in the persisted array.

- [ ] **Step 4: Keep scroll tracking cheap and local.**

Retain the existing debounced save path, but make its locator calculation chapter-scoped. Do not call `updateReadingProgress()` with a full-book DOM query on every scroll; it should inspect the one mounted chapter and update controls from state.

- [ ] **Step 5: Run highlights plus full reader tests.**

Run:

```powershell
npx playwright test e2e/highlights.spec.js e2e/reader.spec.js --project=chromium --workers=1
npm test
npm run check
```

Expected: no stale overlays, complete export, all existing reader UI and structure tests pass.

### Task 5: Real-book performance validation and FPK release gate

**Files:**
- Modify: `e2e/real-epub-investigation.spec.js`
- Modify: `CHANGELOG_WORK.md`
- Modify: `docs/investigations/2026-09-19-eating-nutrition-epub-double-page.md`
- Modify: `docs/superpowers/plans/2026-09-18-babyreader-fnos-handover.md`

**Interfaces:**
- Consumes: the single-chapter scroll contract and boundary controls from Tasks 1–4.
- Produces: a real-sample regression proving first-chapter interactivity and chapter-boundary loading on a throttled desktop browser, plus a reproducible FPK artifact record.

- [ ] **Step 1: Add a real-sample scroll readiness assertion.**

With `BABYREADER_E2E_SAMPLE_EPUB` set, open in scroll mode under `BABYREADER_E2E_CPU_THROTTLE=12` and assert within 8 seconds that exactly one chapter is mounted, it has readable text, the loading label is gone, and the next-chapter footer is available when the sample has another spine item. Assert that the fourth chapter request has not happened before clicking next by recording the fixture/server chapter reads.

- [ ] **Step 2: Add the boundary transition assertion.**

Scroll the reader to the bottom of the mounted chapter, click `#btnScrollNextChapter`, and assert within 8 seconds that the source path changes, the new chapter is readable, exactly one chapter remains in the DOM, and the reader returns to the new chapter’s top.

- [ ] **Step 3: Run the optional real-sample regression.**

Run:

```powershell
$env:BABYREADER_E2E_SAMPLE_EPUB = 'C:\Users\admin\Desktop\吃的营养科学观.epub'
$env:BABYREADER_E2E_SAMPLE_TITLE = '吃的营养科学观'
$env:BABYREADER_E2E_START_MODE = 'scroll'
$env:BABYREADER_E2E_CPU_THROTTLE = '12'
npx playwright test e2e/real-epub-investigation.spec.js --project=chromium --workers=1
```

Expected: first chapter is interactive without waiting for the 126-chapter book, and clicking the explicit footer loads only the next chapter.

- [ ] **Step 4: Run the complete verification gate.**

Run `npm test`, `npm run check`, `npx playwright test --project=chromium --workers=1`, and `git diff --check`. Treat the known optional real-EPUB skip as a skip when the sample path is not configured; do not claim physical fnOS validation from Chromium.

- [ ] **Step 5: Build the FPK and record evidence.**

Run:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' scripts/build-fpk.sh
```

Record the generated `dist/babyreader-fnos.fpk` byte size and SHA-256 in the work changelog. Do not copy the real EPUB into `dist/`.

## Self-Review

- Spec coverage: the shell and visibility rules are Task 1; single-chapter loading is Task 2; progress/TOC/restoration are Task 3; highlights and scroll performance are Task 4; real-book verification and FPK evidence are Task 5.
- No current production caller is allowed to append the whole book after Task 2; `renderEpubWholeBook()` is removed only after its regression is replaced.
- The planned locator fields preserve old `href`, `anchor`, `textBefore`, `scrollTop`, and `percentage` fields while adding explicit chapter scope.
- Review focus has a named regression test in the owning task for each likely failure mode.
- Scope is limited to continuous scroll chapter boundaries; library styling, double-page geometry, and unrelated reserved toolbar actions remain untouched.
