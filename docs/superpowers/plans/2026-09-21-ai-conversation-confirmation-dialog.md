# AI 会话破坏性操作确认弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以主题同步、可访问的应用内确认弹窗替代 AI 会话“清空”和“删除”的浏览器原生确认框，同时保持现有会话 API 与成功/失败语义不变。

**Architecture:** 在既有 `#aiModal .ai-modal-body` 内添加一个与会话列表同级的本地 `alertdialog` surface。`ai.js` 保存短生命周期的确认意图；行内动作只打开确认框，唯一的确认提交入口才调用抽出的现有 mutation 函数。该 surface 复用 `.ai-config-sheet` 的局部遮罩与主题变量，不接入阅读器的全局 `readerSurfaceController`。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js `node:test` + happy-dom、Playwright Chromium。

**Spec:** `docs/superpowers/specs/2026-09-21-ai-conversation-confirmation-dialog-design.md`

## Execution Status (2026-09-22)

- Task 1 implemented: application-owned `alertdialog` DOM and scoped theme styles are present; DOM contract regression passed.
- Task 2 implemented: native browser confirmation is removed from AI conversation actions; cancel, Escape, backdrop, single-submit locking, failure recovery, lifecycle cleanup and in-flight book-switch release are covered by DOM regressions.
- Task 3 implemented: focused Chromium flow passed with clear/delete, no native dialog, focus loop, three themes and a 390×844 viewport.
- Release note: `npm run check` and the full unit suite passed. A full 84-test Chromium run had two unrelated Highlight CRUD timing failures that both passed in isolated reruns; a second full run left the runner/server alive after workers exited and was stopped. Do not treat full E2E as green until the runner lifecycle and Highlight timing are revalidated separately.

## Global Constraints

- 仅迁移 AI 会话列表的“清空”和“删除”；`app/ui/reader/ai-index-manager.js` 以及其他模块的原生确认框不在本计划范围内。
- 不新增或修改 HTTP API、会话 JSON 文件、SQLite FTS、AI 回答、索引管理器和阅读进度。
- 不引入 UI 框架、第三方依赖或全局 modal 管理器。
- 动态会话标题和消息数必须通过 `textContent` 写入；不得把摘要或消息内容插入 HTML。
- 确认前、取消、Escape 和遮罩点击均不得调用 `browserHost.clearAiConversation` 或 `browserHost.deleteAiConversation`。
- 初始焦点必须为“取消”；确认提交时所有确认控件和会话列表操作均禁用；异步返回时必须验证请求书籍仍等于 `state.currentBookId`。
- 所有主题颜色必须来自既有 `--color-*` 变量；不得为深色主题写死白底或黑字。

## Review Focus

- 双击“清空会话”或“删除会话”时，只能提交一次 HTTP mutation；Task 2 的 deferred Promise DOM 测试固定此行为。
- 在确认框打开后切换书籍或关闭 AI 弹窗时，旧确认不得对新书籍执行；Task 2 的书籍切换/关闭测试固定此行为。
- 删除当前会话后仍必须保持既有“加载下一会话或显示空状态”语义；Task 2 的成功路径测试固定此行为。
- API 失败时不得乐观删除行或清空当前回答；Task 2 的失败测试固定此行为。
- 小屏、深色和护眼主题的卡片与两个动作均可见且可操作；Task 3 的 Chromium 多主题、小视口测试固定此行为。

---

## File Structure

- `app/ui/index.html`：在 AI 弹窗正文中声明确认 `alertdialog`、本地遮罩和明确的取消/确认控件；不改变会话列表与设置 sheet 的结构。
- `app/ui/styles.css`：新增限定在 `.ai-conversation-confirm-*` 的卡片、说明、按钮、忙碌与移动端样式，复用现有 AI 主题变量。
- `app/ui/reader/ai.js`：维护确认意图、焦点、焦点循环与关闭生命周期；将现有清空/删除网络逻辑抽至无确认副作用的 `perform*` 函数。
- `tests/dom-regression.test.js`：在 happy-dom 中覆盖确认 surface、取消路径、单次提交、成功/失败与生命周期边界。
- `e2e/reader.spec.js`：在 Chromium 中覆盖应用内确认、无原生浏览器 dialog、键盘路径、实际 mutation 更新和主题/小屏可用性。

### Task 1: 声明确认 surface 与主题同步视觉契约

**Files:**
- Modify: `app/ui/index.html:299-319`
- Modify: `app/ui/styles.css:3867-4155`
- Test: `tests/dom-regression.test.js:485-553`

**Interfaces:**
- Consumes: 既有 `#aiModal`、`.ai-config-sheet`、`.ai-config-sheet-backdrop`、`.ai-secondary-button` 和主题变量。
- Produces: `#aiConversationConfirmView`、`#aiConversationConfirmTitle`、`#aiConversationConfirmDescription`、`#btnCloseAiConversationConfirmBackdrop`、`#btnCancelAiConversationConfirm`、`#btnConfirmAiConversationAction`，供 Task 2 的控制器使用。

- [ ] **Step 1: 写入失败的 DOM 结构回归测试**

在 `tests/dom-regression.test.js` 的会话管理测试之前增加如下测试，确保页面契约先于脚本实现存在：

```js
test('AI conversation confirmation surface exposes an app-owned alertdialog contract', async () => {
  const { window } = await createReaderDom();
  const view = window.document.getElementById('aiConversationConfirmView');
  assert.ok(view);
  assert.equal(view.getAttribute('role'), 'alertdialog');
  assert.equal(view.getAttribute('aria-modal'), 'true');
  assert.equal(view.hidden, true);
  assert.equal(window.document.getElementById('btnCancelAiConversationConfirm').textContent, '取消');
  assert.ok(window.document.getElementById('btnConfirmAiConversationAction'));
});
```

- [ ] **Step 2: 运行 DOM 测试，确认结构契约尚不存在**

Run: `node --test tests/dom-regression.test.js --test-name-pattern "confirmation surface exposes"`

Expected: FAIL，原因是 `#aiConversationConfirmView` 为 `null`。

- [ ] **Step 3: 在 AI modal 内加入语义化确认 DOM**

在 `#aiConversationsView` 之后、`#aiConfigView` 之前添加同级节点；遮罩必须是按钮，卡片必须具有下列可访问性关系：

```html
<section id="aiConversationConfirmView" class="ai-config-sheet ai-conversation-confirm-sheet"
  data-ai-view="conversation-confirm" hidden role="alertdialog" aria-modal="true"
  aria-labelledby="aiConversationConfirmTitle" aria-describedby="aiConversationConfirmDescription">
  <button type="button" class="ai-config-sheet-backdrop" id="btnCloseAiConversationConfirmBackdrop" aria-label="取消会话操作"></button>
  <div class="ai-config-sheet-card ai-conversation-confirm-card">
    <div class="ai-conversation-confirm-content">
      <h3 id="aiConversationConfirmTitle"></h3>
      <p id="aiConversationConfirmDescription"></p>
    </div>
    <div class="ai-config-actions ai-conversation-confirm-actions">
      <button type="button" class="ai-secondary-button" id="btnCancelAiConversationConfirm">取消</button>
      <button type="button" class="reader-action-button ai-conversation-confirm-danger" id="btnConfirmAiConversationAction"></button>
    </div>
  </div>
</section>
```

- [ ] **Step 4: 添加局部、主题变量驱动的样式**

在既有 `.ai-config-sheet` 规则附近追加以下限定选择器，不改动公共 `.ai-config-sheet` 尺寸与行为：

```css
.ai-conversation-confirm-sheet { z-index: 5; }
.ai-conversation-confirm-card { width: min(360px, calc(100% - 28px)); max-height: none; }
.ai-conversation-confirm-content { display: grid; gap: 8px; padding: 20px 18px 16px; }
.ai-conversation-confirm-content h3 { margin: 0; color: var(--color-text); font-size: 17px; letter-spacing: -.01em; }
.ai-conversation-confirm-content p { margin: 0; color: var(--color-text-2); font-size: 13px; line-height: 1.5; }
.ai-conversation-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ai-conversation-confirm-danger { color: #fff; background: var(--color-destructive); border-color: var(--color-destructive); }
.ai-conversation-confirm-danger:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.ai-conversation-confirm-sheet.is-pending .ai-config-sheet-backdrop,
.ai-conversation-confirm-sheet.is-pending button { pointer-events: none; }
```

为 `@media (max-width: 640px)` 添加 `.ai-conversation-confirm-sheet .ai-config-sheet-card` 的 `max-height` 和 `margin-bottom`，计算中包含 `env(safe-area-inset-bottom)`，两个按钮使用既有最小触控高度 `34px`。

- [ ] **Step 5: 运行结构测试，确认页面契约通过**

Run: `node --test tests/dom-regression.test.js --test-name-pattern "confirmation surface exposes"`

Expected: PASS。

- [ ] **Step 6: 审核本任务变更**

Run: `git diff --check -- app/ui/index.html app/ui/styles.css tests/dom-regression.test.js`

Expected: 无输出且退出码为 0。

- [ ] **Step 7: 提交 Task 1**

```bash
git add app/ui/index.html app/ui/styles.css tests/dom-regression.test.js
git commit -m "feat: add AI conversation confirmation surface"
```

### Task 2: 以本地确认控制器替换原生确认并保留 mutation 语义

**Files:**
- Modify: `app/ui/reader/ai.js:470-720,1346-1431`
- Modify: `tests/dom-regression.test.js:485-575`

**Interfaces:**
- Consumes: Task 1 产生的六个 DOM id；`browserHost.clearAiConversation(conversationId, bookId)` 与 `browserHost.deleteAiConversation(conversationId, bookId)`；`state.currentBookId`。
- Produces: `requestAiConversationConfirmation(action, conversationId, trigger) -> boolean`、`closeAiConversationConfirmation({ restoreFocus = true } = {}) -> void`、`executeAiConversationConfirmation() -> Promise<boolean>`、`performClearAiConversationItem(conversationId, bookId) -> Promise<boolean>`、`performDeleteAiConversationItem(conversationId, bookId) -> Promise<boolean>`。

- [ ] **Step 1: 将原生 confirm 成功路径替换为失败测试**

删除现有测试中的 `window.confirm = () => true`，并把当前“delete and clear update”测试改为先验证确认框出现且 mutation 尚未发生：

```js
window.document.querySelector('[data-ai-conversation-id="conversation-1"] .ai-conversation-clear').click();
assert.equal(calls.length, 0);
assert.equal(window.document.getElementById('aiConversationConfirmView').hidden, false);
assert.equal(window.document.getElementById('aiConversationConfirmTitle').textContent, '清空此会话？');
assert.match(window.document.getElementById('aiConversationConfirmDescription').textContent, /当前会话.*2 条消息/);
window.document.getElementById('btnConfirmAiConversationAction').click();
await waitFor(() => calls.some(([kind]) => kind === 'clear'), 'clear conversation did not call the server');
```

增加取消和 Escape 的测试：从删除行打开确认框，分别点击取消和派发 `new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })`，断言 `calls` 未新增、确认框隐藏且 `window.document.activeElement` 是原来的删除按钮。

增加遮罩取消测试：点击 `#btnCloseAiConversationConfirmBackdrop`，断言确认框关闭且没有 mutation。

- [ ] **Step 2: 运行测试，确认现有原生确认实现不能满足它**

Run: `node --test tests/dom-regression.test.js --test-name-pattern "AI conversation delete and clear|confirmation cancel"`

Expected: FAIL，原因是点击行按钮调用 `window.confirm` 或没有显示应用内确认框。

- [ ] **Step 3: 新增确认状态、开启/关闭与焦点循环函数**

在 `_aiConversationManageBusy` 相邻的模块状态区定义：

```js
let _aiConversationConfirmation = null;
let _aiConversationConfirmationPending = false;
```

实现 `requestAiConversationConfirmation`：从 `_aiConversationList` 中以 `String(item.id) === String(conversationId)` 查找并运行 `normalizeAiConversationSummary`；没有摘要、忙碌、无有效书籍或 action 不是 `clear`/`delete` 时返回 `false`。用 `textContent` 写入标题和说明，用 `dataset.action` 保存动作，保存 `{ action, conversationId, title, messageCount, bookId: state.currentBookId, trigger }`，将会话 sheet 加 `aria-hidden="true"`，显示确认 sheet，并在 `queueMicrotask` 中聚焦取消按钮。

实现 `closeAiConversationConfirmation`：隐藏确认 sheet、移除会话 sheet 的 `aria-hidden`、清空 pending class 和 `_aiConversationConfirmation`；当 `restoreFocus` 为真且保存的 `trigger.isConnected` 时聚焦 trigger。关闭 AI modal、重置会话状态和书籍变更的现有路径必须先调用该函数且使用 `{ restoreFocus: false }`。

为确认 sheet 添加 `keydown` 处理：Tab 时只在 `#btnCancelAiConversationConfirm` 与 `#btnConfirmAiConversationAction` 间循环；如果 pending 或 event 不是 Tab，不处理。全局 Escape 处理调整为先检查确认 sheet，再检查会话列表和设置 sheet。

- [ ] **Step 4: 抽离无确认副作用的 mutation 函数**

删除 `confirmAiConversationAction`。保留现有成功/失败文案与列表更新，将函数改为：

```js
async function performClearAiConversationItem(conversationId, bookId) {
  if (!bookId || typeof browserHost?.clearAiConversation !== 'function') return false;
  setAiConversationManagementBusy(true);
  setAiConversationManagementStatus('正在清空会话…', 'busy');
  try {
    await browserHost.clearAiConversation(conversationId, bookId);
    if (state.currentBookId !== bookId) return false;
    // 保留原有：当前会话 reset、消息数更新、render、ready 状态。
    return true;
  } catch (error) {
    if (state.currentBookId === bookId) setAiConversationManagementStatus(error.message || '清空失败，请重试。', 'error');
    return false;
  } finally {
    if (state.currentBookId === bookId) setAiConversationManagementBusy(false);
  }
}
```

`performDeleteAiConversationItem` 使用相同书籍 guard，保留既有“当前会话删除后载入 next，否则清空状态”的分支。它在调用 `loadAiConversationDetail(next.id, { closeOnSuccess: false })` 前必须释放 busy，并仅在 `state.currentBookId === bookId` 时继续。

行内事件改为保存原始按钮：

```js
clear.addEventListener('click', (event) => {
  requestAiConversationConfirmation('clear', summary.id, event.currentTarget);
});
remove.addEventListener('click', (event) => {
  requestAiConversationConfirmation('delete', summary.id, event.currentTarget);
});
```

`executeAiConversationConfirmation` 复制当前意图，在请求前关闭视觉确认框但不恢复焦点，设置 pending 和会话管理 busy，随后仅当 `intent.bookId === state.currentBookId` 时调用对应 `perform*`。finally 中清空 pending；不让过期书籍的回调重写新书籍的状态。

- [ ] **Step 5: 绑定控件并锁定重复操作**

在 `setupAiPanel()` 中绑定遮罩、取消和确认按钮：取消与遮罩调用 `closeAiConversationConfirmation()`；确认调用 `void executeAiConversationConfirmation()`。更新 `setAiConversationManagementBusy`，当确认存在时禁用其取消和确认按钮、给 sheet 加/去 `.is-pending`，并保持既有刷新与行按钮禁用。确认执行期间，`requestAiConversationConfirmation` 直接返回 `false`。

- [ ] **Step 6: 扩充生命周期、重复提交和失败的 DOM 测试**

添加以下三组测试：

```js
test('AI conversation confirmation submits only once while a mutation is pending', async () => {
  // clearAiConversation 返回 deferred Promise；连续 click 两次确认按钮。
  // 断言 clear 调用次数为 1，两个确认控件 disabled 为 true；resolve 后恢复为 false。
});

test('AI conversation confirmation closes without mutation when the book changes or AI modal closes', async () => {
  // 打开确认后变更 api.state.currentBookId，再触发确认；断言 calls.length === 0。
  // 重新打开确认后 closeAiModal()；断言 confirmation hidden 且 state 为清空状态。
});

test('AI conversation confirmation preserves list and reports mutation failure', async () => {
  // clear/delete reject；确认后断言行数与消息数不变、sheet 可见、status 包含“清空失败”或“删除失败”。
});
```

现有失败测试也改为先点击 `#btnConfirmAiConversationAction` 后再等待错误，确保原生浏览器确认再无测试替身。

- [ ] **Step 7: 运行本任务 DOM 回归**

Run: `node --test tests/dom-regression.test.js`

Expected: PASS，包含旧会话持久化、列表、失败重试和新增确认框测试。

- [ ] **Step 8: 执行静态与完整单元回归**

Run: `npm run check && npm test && git diff --check`

Expected: 三项均成功；没有 `window.confirm` 出现在 `app/ui/reader/ai.js`，且现有会话 API/存储测试全部通过。

- [ ] **Step 9: 提交 Task 2**

```bash
git add app/ui/reader/ai.js tests/dom-regression.test.js
git commit -m "feat: replace AI conversation native confirms"
```

### Task 3: Chromium 行为、主题与小屏验收

**Files:**
- Modify: `e2e/reader.spec.js:881-933`
- Modify: `tests/dom-regression.test.js:485-575`（仅在 Chromium 发现并需固定的 DOM 边界时）

**Interfaces:**
- Consumes: Task 1 的 `#aiConversationConfirmView` DOM 契约和 Task 2 的应用内确认控制器。
- Produces: 不依赖 `page.on('dialog')` 的 AI 会话管理 E2E 覆盖。

- [ ] **Step 1: 将原生 dialog E2E 依赖替换为失败断言**

删除：

```js
page.on('dialog', (dialog) => dialog.accept());
```

在现有会话列表 E2E 中为清空操作先写入：

```js
let nativeDialogSeen = false;
page.on('dialog', () => { nativeDialogSeen = true; });
await page.locator('[data-ai-conversation-id="conversation-1"] .ai-conversation-clear').click();
await expect(page.locator('#aiConversationConfirmView')).toBeVisible();
await expect(page.locator('#aiConversationConfirmTitle')).toHaveText('清空此会话？');
await expect(page.locator('#aiConversationConfirmDescription')).toContainText('当前会话');
await expect(page.locator('#aiConversationConfirmDescription')).toContainText('2 条消息');
await expect(page.locator('[data-ai-conversation-id="conversation-1"] .ai-conversation-meta')).toContainText('2 条消息');
await page.locator('#btnConfirmAiConversationAction').click();
await expect(page.locator('[data-ai-conversation-id="conversation-1"] .ai-conversation-meta')).toContainText('0 条消息');
expect(nativeDialogSeen).toBe(false);
```

- [ ] **Step 2: 运行 E2E，确认旧实现无法显示应用内 surface**

Run: `npx playwright test e2e/reader.spec.js --project=chromium --grep "AI conversation sheet lists summaries"`

Expected: FAIL，旧实现只有浏览器 dialog，不存在可见 `#aiConversationConfirmView`。

- [ ] **Step 3: 完成取消、键盘焦点和删除成功 E2E**

在同一测试或邻近独立测试加入：

```js
await page.locator('[data-ai-conversation-id="conversation-2"] .ai-conversation-delete').click();
await expect(page.locator('#btnCancelAiConversationConfirm')).toBeFocused();
await page.keyboard.press('Escape');
await expect(page.locator('#aiConversationConfirmView')).toBeHidden();
await expect(page.locator('[data-ai-conversation-id="conversation-2"]')).toBeVisible();

await page.locator('[data-ai-conversation-id="conversation-2"] .ai-conversation-delete').click();
await page.keyboard.press('Tab');
await expect(page.locator('#btnConfirmAiConversationAction')).toBeFocused();
await page.keyboard.press('Tab');
await expect(page.locator('#btnCancelAiConversationConfirm')).toBeFocused();
await page.locator('#btnConfirmAiConversationAction').click();
await expect(page.locator('.ai-conversation-row')).toHaveCount(1);
```

- [ ] **Step 4: 增加主题与小视口可用性 E2E**

创建独立测试：打开 AI 会话确认框，依次调用页面现有主题入口切换到深色与护眼主题，读取卡片 `backgroundColor`、标题 `color` 和取消/确认按钮的 bounding box；设定 `page.setViewportSize({ width: 390, height: 844 })` 后断言确认卡片与两个按钮的 box 均位于 `0..390`、`0..844`，且确认按钮高度 `>= 34`。仅断言有可见、非透明的计算色值，不断言浏览器专有 RGB 常量。

- [ ] **Step 5: 运行 Chromium 回归**

Run: `npm run test:e2e -- --grep "AI conversation"`

Expected: PASS；没有由会话清空/删除引发的 Playwright `dialog` 事件，确认、取消、Escape、焦点循环、清空与删除均正常。

- [ ] **Step 6: 执行发布前完整验证**

Run: `npm run check && npm test && npm run test:e2e && git diff --check`

Expected: 所有命令成功且无 diff 空白错误。

- [ ] **Step 7: 提交 Task 3**

```bash
git add e2e/reader.spec.js tests/dom-regression.test.js
git commit -m "test: cover AI conversation confirmation dialog"
```

## Spec Coverage Self-Review

- 应用内、主题同步的确认 UI：Task 1 的 HTML/CSS 与 Task 3 的多主题、小视口检查。
- 清空和删除的不同标题、文案与动作：Task 2 的 `requestAiConversationConfirmation` 及 DOM/E2E 断言。
- 无原生 confirm、确认前零请求、取消无副作用：Task 2 和 Task 3。
- 焦点初始位置、Escape、遮罩、Tab 循环和焦点恢复：Task 2 DOM 测试与 Task 3 Chromium 测试。
- 成功、失败、重复点击、当前会话删除与书籍生命周期：Task 2 的 mutation 抽离和专门 DOM 回归。
- 不改变服务端/API/索引器：Global Constraints；实现文件清单中没有服务端或 `ai-index-manager.js`。

## Placeholder and Interface Self-Review

- 已扫描计划：不存在未指定实现内容、未指定测试命令或要求后续补充的步骤。
- Task 1 定义的 DOM id 被 Task 2 的控制器精确消费；Task 2 输出的确认控制器被 Task 3 的选择器和行为断言精确消费。
- 所有 mutation 接口统一使用 `(conversationId, bookId)`，异步 guard 统一比较 `state.currentBookId === bookId`。
- Review Focus 的五项风险均被 Task 2 或 Task 3 的显式测试步骤覆盖。
