# EPUB 章节窗口阅读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EPUB 阅读从整书 DOM/全书分页改为惰性解析的单章节窗口，使《吃的营养科学观》在低性能 fnOS 设备上首章可交互并可稳定换章。

**Architecture:** 保留 ZIP 索引、OPF、manifest、spine 与目录元数据，但只按需读取和清洗当前章节。`#article` 始终只挂载一个 `.epub-chapter`，现有分页、划线覆盖层和图片监听只服务当前章节；章节边界由导航层异步加载下一/上一章节。进度使用现有 semantic-position 格式保存当前章节路径和章节内页码，高亮记录仍是全量服务端数据但只绘制当前章节。

**Tech Stack:** 原生浏览器 JavaScript；JSZip；sanitize-html；现有 CSS multi-column 分页；Node `node:test`；Playwright Chromium；现有 FPK 构建脚本。

**Spec:** `docs/superpowers/specs/2026-09-19-epub-chapter-window-design.md`

## Global Constraints

- 打开 EPUB 时只读取 EPUB 容器、OPF、目录和首个可读 spine 项；首章完成后即可翻页、选择与划线。
- 每次 DOM 中只保留当前章节；双页计算、图片解码、划线覆盖层和布局重排只针对该章节。
- 既有服务端进度接口与高亮数据格式保持兼容。
- 大资源限制维持单文件 8 MB、单书会话 48 MB；被跳过资源不得阻塞正文。
- 不把真实用户 EPUB 复制到仓库、测试夹具或 FPK。
- 真实 fnOS 安装测试由用户执行，不以桌面 Chromium 替代。

## Review Focus

- 连续快速点击目录时，旧章节异步结果不能覆盖最后一次选择；由 Task 2 的 generation 回归覆盖。
- 不含 nav 的 NCX 目录与带 fragment 的目录项必须仍能定位到 spine；由 Task 1 的解析回归覆盖。
- 章节边界的上一页/下一页必须只切换一次且不丢失当前方向；由 Task 2 的边界 E2E 覆盖。
- 旧 progress 没有 `href` 或指向不存在章节时必须回退首章，不得卡在 loading；由 Task 3 的恢复回归覆盖。
- 当前章节外的高亮不得在换章时残留，跨两个章节的高亮导出必须仍完整；由 Task 3 的高亮 E2E 覆盖。

### Task 1: Create a lazy EPUB archive and single-chapter loader

**Files:**
- Modify: `app/ui/reader/epub.js`
- Modify: `app/ui/core/state.js`
- Modify: `app/ui/app.js`
- Modify: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: existing binary EPUB input, `JSZip`, `sanitizeEpubHtml`, `inlineResourceRefs`, `parseNavToc`, `parseNcxToc`.
- Produces: `openEpubArchive(data) -> Promise<EpubArchive>`, `loadEpubChapter(archive, index) -> Promise<{ index, href, html }>`, and `state.epubArchive`, `state.epubChapterIndex`, `state.epubChapterCount`.

- [ ] **Step 1: Add a failing parser contract test.**

Add a deterministic EPUB fixture with three spine XHTML entries to `tests/reader-core.test.js` and assert the extracted parser source contains a lazy archive contract while rejecting the old whole-book return shape:

```js
assert.match(epubSource, /async function openEpubArchive\s*\(/);
assert.match(epubSource, /async function loadEpubChapter\s*\(/);
assert.doesNotMatch(epubSource, /return \{[\s\S]*chapters\.join\(/);
```

The source-level assertion is intentional here because the browser parser is loaded through script tags and cannot be imported directly by Node.

- [ ] **Step 2: Run the focused test and verify it fails for the old parser.**

Run `node --test tests/reader-core.test.js`.

Expected: FAIL because `openEpubArchive` and `loadEpubChapter` do not exist and the current parser joins all chapters.

- [ ] **Step 3: Implement archive metadata parsing without loading spine bodies.**

Extract the current container/OPF/manifest/spine code into `openEpubArchive(data)`. The returned object must contain:

```js
{
  zip,
  opfPath,
  manifest,
  mediaTypes,
  spine: [{ index, id, href, fullPath, mediaType }],
  chapterIndexByPath,
  toc,
  metadata: { title, creator },
  resourceBudget,
  diagnostics: { chapterCount, inlinedResourceBytes: 0, skippedResourceCount: 0, skippedResources: [] }
}
```

Use normalized full paths for `chapterIndexByPath`. Build TOC targets as `epub-path:<normalized-path>#<fragment>` so TOC construction does not require creating every chapter DOM node.

- [ ] **Step 4: Implement one-chapter loading and keep resource budgets per archive.**

Implement `loadEpubChapter(archive, index)` to validate the index, read only `archive.spine[index]`, extract `<body>`, sanitize and inline its resources, wrap the result in one section with `id="br-chapter-${index + 1}"`, and return the chapter path plus HTML. Throw a user-readable error for a missing spine file. Yield once before ZIP text extraction and once after resource inlining. Update archive diagnostics from the shared budget.

- [ ] **Step 5: Switch `renderEpubDocument` to open metadata and load only index zero.**

Store the archive in state, set `epubChapterCount` from `archive.spine.length`, set `currentChapterIndex` to zero, render the TOC, then call the new chapter renderer interface from Task 2. Remove assignments that retain `epub.chapters` or `epub.html` for the full book. Ensure `destroyEpub()` clears the archive and chapter index/count.

- [ ] **Step 6: Run the focused parser and existing Node suite.**

Run `node --test tests/reader-core.test.js` and then `npm test`.

Expected: the new parser contract passes, all existing Node tests pass, and no test contains the real user EPUB.

### Task 2: Render and navigate one EPUB chapter at a time

**Files:**
- Modify: `app/ui/reader/document.js`
- Modify: `app/ui/reader/navigation.js`
- Modify: `app/ui/reader/pagination.js`
- Modify: `app/ui/reader/progress.js`
- Modify: `app/ui/reader/epub.js`
- Modify: `app/ui/core/state.js`
- Modify: `tests/dom-regression.test.js`
- Modify: `e2e/real-epub-investigation.spec.js`

**Interfaces:**
- Consumes: `state.epubArchive`, `loadEpubChapter`, and `state.epubChapterIndex` from Task 1.
- Produces: `renderEpubChapter(index, options) -> Promise<boolean>`, `navigateToEpubChapter(index, options) -> Promise<boolean>`, `isEpubChapterLoading() -> boolean`, and boundary-aware `setPageGroup`/chapter navigation.

- [ ] **Step 1: Add failing DOM tests for single-chapter rendering and stale-load rejection.**

Extend the DOM regression fixture so two chapter loads are resolved out of order. Assert that after requesting chapter 2 and then chapter 3, only chapter 3 exists in `#article`, `state.epubChapterIndex === 2`, and the old result cannot restore chapter 2. Also assert that `#article .epub-chapter` count is exactly one after a successful render.

- [ ] **Step 2: Run the focused DOM tests and verify the old multi-chapter renderer fails.**

Run `node --test tests/dom-regression.test.js`.

Expected: FAIL because the current renderer appends the full `state.epubChapters` list and has no chapter-load generation contract.

- [ ] **Step 3: Implement `renderEpubChapter` with generation and loading state.**

The function must increment a module generation before awaiting `loadEpubChapter`, set `state.epubChapterLoading = true`, disable pagination controls, update `#paginationStatus` with `正在打开第 ${index + 1}/${state.epubChapterCount} 章`, and ignore any resolved result whose generation is stale. On success, replace `article.innerHTML` with exactly the returned chapter HTML, clear the article scroll position, call `measurePagination({ preserveLocator: false })` once after the next animation frame, redraw current-chapter highlights, then restore the requested locator. On failure, preserve the old chapter when one exists and show the error through `showHighlightHint`.

- [ ] **Step 4: Make page navigation cross the chapter boundary.**

In the next/previous page actions, detect `state.pageGroup` at the first/last group. At the last group call `navigateToEpubChapter(state.epubChapterIndex + 1, { page: 1 })`; at the first group call the previous chapter with the last page after it has been measured. Keep ordinary intra-chapter calls on `setPageGroup`. While loading, return false and keep all page/chapter buttons disabled.

- [ ] **Step 5: Resolve TOC and internal links through archive paths.**

Change `navigateEpubTarget` to parse the existing `target` path and fragment, map the path with `state.epubArchive.chapterIndexByPath`, await `navigateToEpubChapter`, and then locate the fragment in the single current chapter. Preserve the current chapter when a target is invalid. `setCurrentTocTarget` must still mark the selected TOC entry.

- [ ] **Step 6: Run DOM tests and the standard E2E suite.**

Run `node --test tests/dom-regression.test.js` and `npx playwright test --project=chromium --workers=1`.

Expected: focused DOM tests pass; existing reader, viewport, highlight, persistence, and resilience E2E scenarios pass without requiring all EPUB chapters in the DOM.

### Task 3: Preserve progress, highlights, and export across chapter windows

**Files:**
- Modify: `app/ui/reader/progress.js`
- Modify: `app/ui/reader/highlights.js`
- Modify: `app/ui/reader/actions.js`
- Modify: `app/ui/app.js`
- Modify: `e2e/helpers/reader.js`
- Modify: `e2e/highlights.spec.js`
- Modify: `e2e/persistence.spec.js`

**Interfaces:**
- Consumes: one-chapter DOM, archive path map, `renderEpubChapter`, and existing server highlight/progress APIs.
- Produces: reload restoration by chapter path, chapter-filtered highlight redraw, and cross-chapter export assertions.

- [ ] **Step 1: Add failing progress restoration tests for a missing and a valid chapter href.**

Extend `e2e/persistence.spec.js` to save a valid later-chapter locator, reload, and assert that only that chapter is mounted with the saved page. Add a second case that saves `href: 'missing.xhtml'` and asserts the reader mounts chapter 1 with no permanent loading status.

- [ ] **Step 2: Run the focused persistence tests and record the old failure.**

Run `npx playwright test e2e/persistence.spec.js --project=chromium --workers=1`.

Expected before the fix: the old restore logic searches the full DOM; after the window change it cannot find a later chapter or can leave a stale loading state.

- [ ] **Step 3: Restore progress by loading the saved chapter first.**

Update `restoreReadingLocator(saved)` so it maps `saved.href` through `state.epubArchive.chapterIndexByPath`, awaits `navigateToEpubChapter`, then applies anchor/text/page restoration against the single mounted chapter. If mapping fails, use index zero and page one. Keep old text/scroll fallbacks for non-EPUB documents.

- [ ] **Step 4: Filter and redraw highlights for the mounted chapter only.**

Update highlight redraw and locator resolution to compare normalized `chapterHref` with the current archive spine path. Clear old overlay nodes before a chapter swap, draw only current-chapter records, and keep `loadHighlights()`/`formatHighlightsMd()` reading the full stored array so export remains complete.

- [ ] **Step 5: Add cross-chapter highlight and export assertions.**

In `e2e/highlights.spec.js`, create one highlight in chapter 1, navigate to chapter 2, create another, navigate back and forth to verify each overlay appears only in its own chapter, then export and assert both passages are present while the server array remains unchanged.

- [ ] **Step 6: Run focused and full application tests.**

Run `npx playwright test e2e/persistence.spec.js e2e/highlights.spec.js --project=chromium --workers=1`, `npm test`, and `npm run check`.

Expected: progress fallback, chapter restoration, highlight persistence, export immutability, Node tests, and structure validation all pass.

### Task 4: Add real-book low-performance regression and release artifact

**Files:**
- Modify: `e2e/real-epub-investigation.spec.js`
- Modify: `e2e/start-server.js`
- Modify: `CHANGELOG_WORK.md`
- Modify: `docs/investigations/2026-09-19-eating-nutrition-epub-double-page.md`
- Modify: `docs/superpowers/plans/2026-09-18-babyreader-fnos-handover.md`

**Interfaces:**
- Consumes: lazy archive/chapter navigation and the existing optional absolute-path sample hook.
- Produces: a real-book regression that proves first-chapter interactivity under CPU pressure and a documented FPK-ready state.

- [ ] **Step 1: Change the real sample test to assert first-chapter readiness, not 126 mounted nodes.**

Use `BABYREADER_E2E_CPU_THROTTLE=12` and assert within 8 seconds that `#article .epub-chapter` count is one, the first chapter has readable text, the status leaves `正在打开`, and the next-page action is enabled or the chapter-boundary action is available. Do not assert that the real sample body or images are committed anywhere.

- [ ] **Step 2: Add a real sample chapter-boundary assertion.**

Use the mounted chapter’s `data-source-path` and current pagination track to navigate to its last page, click next, and assert the source path changes to the next spine item while the DOM still contains one chapter. Capture long tasks and require no task over 1000 ms at 4x throttle and no first-chapter timeout at 12x throttle.

- [ ] **Step 3: Run the real sample regression before rebuilding.**

Run:

```powershell
$env:BABYREADER_E2E_SAMPLE_EPUB = 'C:\Users\admin\Desktop\吃的营养科学观.epub'
$env:BABYREADER_E2E_SAMPLE_TITLE = '吃的营养科学观'
$env:BABYREADER_E2E_START_MODE = 'double'
$env:BABYREADER_E2E_CPU_THROTTLE = '12'
npx playwright test e2e/real-epub-investigation.spec.js --project=chromium --workers=1
```

Expected: first chapter becomes interactive within 8 seconds, chapter boundary changes the source path, and no test waits for 126 DOM chapters.

- [ ] **Step 4: Run the complete verification gate.**

Run `npm test`, `npm run check`, `npx playwright test --project=chromium --workers=1`, and `git diff --check`.

Expected: all application tests pass, the optional real-book test passes when its environment variables are present, the ordinary suite skips it when absent, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Build the FPK and record exact artifact evidence.**

Run `& 'C:\Program Files\Git\bin\bash.exe' scripts/build-fpk.sh`, then record the generated `dist/babyreader-fnos.fpk` byte size and SHA-256 in the changelog and investigation report. Do not copy the real EPUB into `dist/`.

- [ ] **Step 6: Update project handoff status.**

Document the changed page-number semantics, low-performance test result, ordinary suite result, FPK hash, and the remaining fnOS physical-device acceptance step. Do not claim physical device success until the user installs and tests this new FPK.

## Self-Review

- Spec coverage: lazy metadata parse and one-chapter loading are Task 1; DOM/generation/boundary navigation are Task 2; progress/highlights/export compatibility are Task 3; real-book regression, verification, build, and documentation are Task 4.
- Placeholder scan: no `TODO`, `TBD`, or unspecified “handle edge cases” step remains; each task names files, interfaces, commands, and expected results.
- Type consistency: Task 1 produces `EpubArchive`, `loadEpubChapter`, and chapter-count state; Task 2 consumes those and produces `renderEpubChapter`/`navigateToEpubChapter`; Task 3 consumes those navigation interfaces; Task 4 consumes the final behavior.
- Review focus: all five failure modes listed above are assigned to concrete tests in Tasks 1–3.
- Scope: no new dependency, server endpoint, user-state schema, or real-book fixture is introduced.
