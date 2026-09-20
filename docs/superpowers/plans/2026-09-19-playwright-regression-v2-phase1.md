# Playwright Chromium E2E Regression V2 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将附件要求的第一批 Chromium 真实行为回归（划线 CRUD、备注、导出、阅读进度 reload 恢复）从当前未提交草稿收口为隔离、稳定、可在 CI 阻断回归的门禁。

**Architecture:** Playwright 只通过用户可见 DOM、真实 Selection、真实点击/键盘和 HTTP 响应观察行为，不调用前端内部函数。测试服务器继续生成临时书库和确定性 EPUB；每个测试在动作前注册对应的 response/download waiter，并在测试前清空本测试书籍的用户状态，避免单个 webServer 进程造成跨测试污染。生产代码只在一个失败被证明是产品缺陷时做最小兼容修复。

**Tech Stack:** Node.js 22；CommonJS；`@playwright/test` 1.63；Chromium；原生 HTTP API；`fflate` fixture EPUB；现有 `e2e/start-server.js` 与 `e2e/helpers/reader.js`。

**Spec:** `C:\Users\admin\Downloads\PLAYWRIGHT_REGRESSION_V2_PLAN.md`

## Global Constraints

- 本轮目标是把最容易被前端重构破坏、且用户能直接感知的核心阅读行为固化为真实 Chromium 回归契约。
- 测试优先验证用户行为，不依赖内部函数名、临时 DOM 或实现细节；只有新测试暴露真实缺陷时，才最小修改生产代码。
- 第一批完成前暂停全文搜索、书签、笔记、PDF/MOBI 和新的 UI 功能扩展。
- 第一批门禁必须同时通过新增 E2E、`npm test`、`npm run check`、`npm run test:e2e`，并更新实时 plan、commit、推送后等待 GitHub Actions 全绿。
- E2E 永远使用临时配置、临时书库、`BABYREADER_DEV_UID=playwright-user`，不得读取 NAS 或真实用户数据。
- 服务器状态以 `/api/state` 返回的数据为准；不把 `localStorage` 当作服务器持久化成功的证据。
- 保留现有 API 路径、稳定 DOM ID、用户状态 schema、UID 隔离和高亮 stable ID 语义。

## Review Focus

- 真实 Selection 与异步 PUT 的时序：动作前注册 waiter，测试等待 200 响应后再验证 DOM/状态。
- 相同文本的定位：两个高亮必须按 stable `data-highlight-id` 删除，不得按文本或 overlay 数量误删。
- 跨 reload 的服务器权威状态：颜色、备注、章节/页组 locator 必须从 reload 后的应用状态恢复。
- 导出行为：下载内容包含书名、作者、章节、正文和备注，且导出不追加/删除/修改服务器高亮。
- 测试隔离与稳定性：同一个 Playwright webServer 会服务整个运行，测试必须显式清理自己使用的 EPUB 用户状态。

## Current Handoff Facts

- 项目实际根目录是 `babyreader-fnos/`，当前分支为 `work/engineering-baseline`。
- 工作区存在未提交 E2E 改动：`e2e/reader.spec.js`、`e2e/start-server.js`，以及 `e2e/fixtures/`、`e2e/helpers/`、`e2e/highlights.spec.js`。
- 当前 `npm test`：49 项，46 通过，0 失败，3 个条件跳过；`npm run check` 通过。
- 当前 `npm run test:e2e` 的新高亮草稿失败：选择 helper 没有触发 `highlight-pill` 的 mouseup/selectionchange 事件；部分 waiter 在点击之后才注册；fixture 生成的是 `第一章第1段` 而断言使用了带空格的 `第一章第 1 段`；`readHighlightState()` 返回数组但测试按对象访问；测试之间没有清空服务端状态。
- 已提交的基础 Chromium 场景仍是 5 个：模块加载、设置持久化、TOC、Drawer/ID、移动端工具栏。附件要求的第一批 6 个场景尚未完成。

### Task 1: Stabilize the fixture and test-state helpers

**Files:**
- Modify: `e2e/start-server.js`
- Modify: `e2e/helpers/reader.js`
- Modify: `e2e/highlights.spec.js`
- Modify: `e2e/reader.spec.js`

**Interfaces:**
- Consumes: the existing temporary EPUB, `/api/library`, `/api/state`, `/api/settings`, `/api/books/:id/highlights`, and `/api/books/:id/progress`.
- Produces: deterministic text constants, a known EPUB book id, state reset helpers, and response waiters that are always armed before the triggering action.

- [ ] **Step 1: Record the current failure before changing the harness.**

Run:

```powershell
npx playwright test e2e/highlights.spec.js --project=chromium
```

Expected before the fix: the first scenario times out on `.highlight-pill`; later scenarios may time out waiting for a highlight PUT. Keep the failure output as local evidence; do not classify it as a production regression yet.

- [ ] **Step 2: Make fixture text single-sourced.**

Export exact constants from `e2e/fixtures/reader-fixtures.js` and use the same values in `start-server.js` and tests:

```js
const FIXTURE_TEXT = Object.freeze({
  firstParagraph: '第一章第1段',
  secondParagraph: '第二章第1段',
  repeatedPhrase: '重复文本甲乙丙'
});

module.exports = { FIXTURE_TEXT };
```

`start-server.js` must interpolate `FIXTURE_TEXT.repeatedPhrase` into every long chapter, and tests must stop spelling alternate versions of these strings.

- [ ] **Step 3: Add book-id and per-test reset helpers.**

Implement these exact helper contracts in `e2e/helpers/reader.js`:

```js
async function getEpubFixtureId(page) { /* returns the 64-char id from GET /api/library */ }
async function resetEpubFixtureState(page) { /* PUT [] highlights and PUT progress at 0 */ }
async function readHighlightState(page) { /* returns an array of highlights for the E2E EPUB only */ }
```

`resetEpubFixtureState` must locate the book by title `E2E EPUB`, send `PUT /api/books/<id>/highlights` with `{ highlights: [] }`, and send `PUT /api/books/<id>/progress` with `{ locator: JSON.stringify({ version: 2, type: 'semantic-position', href: '', anchor: '', textBefore: '', pageNumber: 1, scrollTop: 0, percentage: 0 }), percentage: 0 }`. It must assert both responses are successful. It must not add a production reset endpoint.

`readHighlightState` must return `[]` or the array of the selected book’s highlights, never an object with a hidden `.highlights` property. Tests must call `state.length` and `state.find(...)` directly.

- [ ] **Step 4: Make action waiters precede actions.**

Keep `waitForHighlightsSave(page)` as a predicate-only waiter and use it in this order everywhere:

```js
const savePromise = waitForHighlightsSave(page);
await page.locator('#btnHighlight').click();
await savePromise;
```

For downloads use the same ordering:

```js
const downloadPromise = page.waitForEvent('download');
await page.locator('#btnExportHighlights').click();
const download = await downloadPromise;
```

Remove the assertion that a programmatic `page.evaluate()` Selection creates `.highlight-pill`; the pill is produced by a browser selection event, while the toolbar action intentionally consumes the current Selection directly.

- [ ] **Step 5: Reset state in every mutating test and rerun the focused file.**

Add a `beforeEach` that opens the fixture, calls `resetEpubFixtureState(page)`, reloads, and waits for `#article` to contain `E2E EPUB Chapter 1`. Then run:

```powershell
npx playwright test e2e/highlights.spec.js --project=chromium --workers=1
```

Expected: the focused file reaches the product assertions instead of failing from stale state or missed responses. If it exposes a real product failure, record the exact request/state/DOM evidence before touching `app/`.

### Task 2: Complete the first-batch highlight CRUD and export contract

**Files:**
- Modify: `e2e/highlights.spec.js`
- Modify: `e2e/helpers/reader.js`
- Modify: `e2e/start-server.js` only if a fixture correction is required

**Interfaces:**
- Consumes: Task 1 fixture constants, reset helper, `selectArticleText`, `selectNthArticleText`, and the existing stable DOM/API contract.
- Produces: six stable Chromium behaviors matching attachment items 1–5, with server-state assertions after reload.

- [ ] **Step 1: Pin creation and reload persistence.**

Select `FIXTURE_TEXT.firstParagraph`, arm the highlight PUT waiter, click `#btnHighlight`, and assert after the 200 response that the rendered overlay set contains exactly one unique `data-highlight-id`. Reload and assert the same id is still present in both the overlay set and `readHighlightState(page)`.

- [ ] **Step 2: Pin color edit without id replacement.**

Capture the original id, open its `.br-highlight-box`, change `#highlightEditorColor` to `green`, arm the waiter before `#btnSaveHighlight`, and assert both before and after reload:

```js
expect(saved.id).toBe(originalId);
expect(saved.color).toBe('green');
```

The test must not treat the presence of a green box alone as proof that the id was retained.

- [ ] **Step 3: Pin note creation and modification.**

Create a highlight, open the editor by its id, fill `#highlightEditorNote` with `This is a new note for testing.`, arm the PUT waiter before saving, reload, and assert the selected book’s server state contains that exact note on the original id.

- [ ] **Step 4: Pin deletion by stable id with duplicate text.**

Create two highlights by selecting `FIXTURE_TEXT.repeatedPhrase` occurrence 0 and occurrence 1 with `selectNthArticleText`. Collect unique ids from the rendered boxes. Open the first id, arm the PUT waiter before `#btnDeleteHighlight`, then assert the server state after reload contains exactly the second id and never deletes by comparing text alone.

- [ ] **Step 5: Pin multi-chapter export without mutation.**

Create one highlighted passage and note in chapter 1, navigate through the visible TOC to chapter 2, create a second highlight, and capture the complete server-state array before export. Capture a download as shown in Task 1. Assert the downloaded Markdown contains `《E2E EPUB》划线笔记`, `作者：Playwright`, both chapter passages, and the note. Fetch state again and assert ids, colors, notes, and count are byte-equivalent to the pre-export state.

- [ ] **Step 6: Run the first-batch file and the full Node gate.**

```powershell
npx playwright test e2e/highlights.spec.js --project=chromium --workers=1
npm test
npm run check
```

Expected: focused highlight tests pass; Node tests remain `0 failed`; portable structure validation remains passing. Do not proceed to pagination tests with a red highlight batch.

### Task 3: Add progress reload and complete-spread persistence

**Files:**
- Create: `e2e/persistence.spec.js`
- Modify: `e2e/helpers/reader.js`
- Modify: `e2e/start-server.js` only if the fixture needs a deterministic locator anchor

**Interfaces:**
- Consumes: Task 1 reset helper and the existing progress/settings APIs.
- Produces: the attachment item 6 contract: later chapter, page/spread, locator, percentage, and persisted reading-mode preference survive reload/reopen.

- [ ] **Step 1: Write the failing progress test.**

At `1200x800`, open the EPUB, select `double` in `#settingReadingMode` with the settings PUT waiter armed before the selection, wait for `#article[data-pagination-track]` and a visible `#paginationStatus`, navigate to a later TOC chapter, then move one page with the next-page action. Arm a progress PUT waiter before each user action that is expected to persist. Capture:

```js
const expected = {
  progress: await page.locator('#readingProgress').textContent(),
  spread: await page.locator('#paginationStatus').textContent(),
  scrollLeft: await page.locator('#article').evaluate((el) => el.scrollLeft)
};
```

Reload and assert the same chapter (`2/3`), the same spread text, a non-zero aligned `scrollLeft`, and `#settingReadingMode === 'double'`. Reopen the book from the library once and repeat the assertions.

- [ ] **Step 2: Run only the new test and classify the failure.**

```powershell
npx playwright test e2e/persistence.spec.js --project=chromium --workers=1
```

If the request was not sent, fix the test action/waiter ordering. If the request contains the expected locator but reload chooses the wrong chapter/spread, add a minimal production fix in `app/ui/reader/progress.js` or `app/ui/reader/pagination.js` only after adding a Node/DOM regression that describes the exact broken contract.

- [ ] **Step 3: Verify the full first batch together.**

```powershell
npx playwright test e2e/reader.spec.js e2e/highlights.spec.js e2e/persistence.spec.js --project=chromium --workers=1
```

Expected: existing 5 scenarios plus the new first-batch scenarios pass in one server run, proving the reset helper prevents cross-file state contamination.

### Task 4: Turn the first batch into a CI release gate and update project state

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `playwright.config.js` only if the final artifact path needs explicit configuration
- Modify: `docs/superpowers/plans/2026-09-18-babyreader-fnos-handover.md`
- Modify: `CHANGELOG_WORK.md`

**Interfaces:**
- Consumes: passing E2E/Node/structure results and the current branch/commit.
- Produces: CI evidence, a truthful real-time status, and a reversible commit that can be reviewed independently from future pagination/accessibility work.

- [ ] **Step 1: Upload failure evidence from CI.**

Keep the existing Chromium job and add an `actions/upload-artifact@v4` step with `if: always()` for `test-results/` and `playwright-report/`, using a name containing `${{ github.sha }}`. Do not upload `.runtime` or real book data.

- [ ] **Step 2: Run the complete local gate.**

```powershell
npm test
npm run check
npm run test:e2e
```

Expected: all non-platform-conditional Node tests pass, structure validation passes, and all Chromium scenarios pass in a single run.

- [ ] **Step 3: Update the live plan with evidence, not intention.**

In the existing handover plan’s realtime section, change Task 6 from “基础已完成/待补” to the exact measured result only after the full run. Record the branch, commit, total E2E count, pass/fail count, CI run URL/number, and any platform skips. Correct the stale “工作区已同步/无改动” statement while this WIP is still uncommitted.

- [ ] **Step 4: Update the working changelog.**

Add one dated entry listing fixture changes, first-batch scenarios, local results, CI result, and the remaining scope: pagination/input, cache, accessibility, and performance. Do not claim fnOS x86/ARM, Gateway, ACL, or Socket acceptance from Chromium evidence.

- [ ] **Step 5: Commit only the phase.**

```powershell
git add e2e .github/workflows/ci.yml playwright.config.js docs/superpowers/plans/2026-09-18-babyreader-fnos-handover.md CHANGELOG_WORK.md
git commit -m "test: complete Playwright regression v2 phase one"
git push origin work/engineering-baseline
```

Expected: no `dist/`, `.runtime/`, `test-results/`, `playwright-report/`, `node_modules/`, or FPK files are committed. Wait for the GitHub Actions Chromium and core jobs to be green before starting the next batch.

## Next Phases After This Gate

1. V2 second batch: double-page first/last boundary, 800px automatic single-column fallback without changing stored preference, keyboard paging, Drawer Escape/focus restoration, and input/textarea shortcut suppression.
2. V2 third batch: ETag/304 cache contract, accessibility tree/ARIA/reduced-motion checks, then measurement-only performance artifacts with no hard threshold until a baseline is approved.
3. Only after V2 is green: return to the larger handover roadmap—real fnOS x86/ARM system-contract acceptance first, then any approved bookmarks/notes/search design. AI remains a privacy decision gate.

## Self-Review

- Spec coverage for the immediate next step: attachment items 1–6 map to Tasks 1–3; CI/realtime-plan/commit requirements map to Task 4.
- No production change is presumed. The current observed failures are test-harness defects and are fixed in E2E helpers first.
- Type/shape consistency: `readHighlightState()` returns `Highlight[]`; `getEpubFixtureId()` returns a 64-character book id; all response waiters are armed before the triggering action.
- Review-focus failures are tested in Tasks 1–3: async ordering, duplicate text IDs, reload authority, export immutability, and cross-test isolation.
- Out-of-scope items are explicitly deferred to the next phases and are not allowed to enter this commit.
