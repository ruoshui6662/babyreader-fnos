# 移动端触摸选区工具菜单实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Android、iOS、iPad 及 fnOS WebView 的触摸长按选中文本后，稳定进入 BabyReader 自己的复制、马克笔、波浪线、直线、写想法、问 AI 工具菜单，同时不破坏系统文本选择、正文滚动和分页手势。

**Architecture:** 增加统一的选区协调层，将新 DOM 章节和旧 iframe EPUB 路径产生的选区转换为同一种 `SelectionSession`。移动端以 `selectionchange` 作为选区稳定的主要信号，以 `touchend`、`pointerup`、`pointercancel` 作为手势确认和清理信号；桌面端继续兼容 `mouseup`、`pointerup` 和键盘选择。页面层无法替换 fnOS 原生 ActionMode 时，保留明确的降级策略，并单独评估是否需要宿主 WebView 原生桥接。

**Tech Stack:** Vanilla JavaScript、DOM Range/Selection API、EPUB.js 兼容 rendition、现有 CSS、Node.js test runner、Happy DOM、Playwright Chromium、fnOS 真机/WebView 验证。

**Spec:** 本计划中的“现状审查”“问题边界”“验收标准”和“原生能力决策门”即本功能的执行规格；执行前必须先完成真实移动设备事件采集，不能直接依据桌面浏览器测试结果修改触摸行为。

## Global Constraints

- 本计划仅描述后续工作，当前不修改功能代码、不构建 FPK、不创建执行任务。
- 正文必须继续允许系统原生文本选中；不得用全局 `user-select: none` 代替选区菜单方案。
- 不得在 `touchstart` 或 `pointerdown` 上无条件 `preventDefault()`，避免长按变成无法选中文字或无法滚动。
- 新 DOM 路径与旧 iframe/rendition 路径必须最终进入同一套六功能菜单；不得继续保留两套用户可见的选区工具行为。
- 选区菜单只能操作 `#article .epub-chapter` 内的文本，不得误处理目录、侧栏、AI 窗口、输入框或标记图层。
- 选区定位必须保留现有 DOM locator/章节信息，确保标记、写想法、问 AI 和整本书笔记功能继续使用相同文本上下文。
- 所有触摸策略必须兼容连续滚动；分页模式只作为兼容场景验证，不改变当前移动端默认连续滚动策略。
- 如果 fnOS WebView 强制接管原生 ActionMode，页面层不得宣称可以完全隐藏或替换系统菜单；必须在产品层确认降级方案后再实现。

## Review Focus

- **纯触摸长按选区：** 选区产生后应能读取正文文本，并在系统菜单不阻断页面事件时显示六功能菜单；测试归属 Task 2、Task 4。
- **触摸滚动与长按取消：** 短触摸滚动不能误打开菜单，移动超过阈值后必须取消未完成的选区手势；测试归属 Task 3。
- **系统 ActionMode 抢占：** 当 WebView 不允许页面替换系统操作栏时，不能重复显示或误报自定义菜单已接管；测试归属 Task 1、Task 5。
- **DOM 与 iframe 路径一致性：** 两种渲染路径都必须产生相同的菜单动作和保存结果；测试归属 Task 2、Task 4。
- **分页手势状态残留：** 选区触发 `pointerup` 或 `pointercancel` 后，不得复用旧的翻页起点影响下一次滑动；测试归属 Task 3、Task 5。

## 现状与根因记录

### 已确认的代码事实

1. 新 DOM 路径由 [app/ui/reader/highlights.js](../../app/ui/reader/highlights.js) 中的 `setupDomHighlightInteraction()` 处理，监听 `mouseup`、`pointerup`、`keyup` 和延迟 120ms 的 `touchend`。
2. 新菜单由 [app/ui/reader/selection-menu.js](../../app/ui/reader/selection-menu.js) 通过 `window.getSelection()`、DOM Range 和 `.epub-chapter` 归属判断生成。
3. 新 DOM 路径没有监听 `selectionchange`。
4. 旧 iframe/rendition 路径由 [app/ui/reader/navigation.js](../../app/ui/reader/navigation.js) 中的 `setupEpubContentSelection()` 处理，虽然监听了 `selectionchange`，但只调用旧的 `setPendingHighlight()`，不会进入六功能菜单。
5. [app/ui/reader/device-profile.js](../../app/ui/reader/device-profile.js) 收集 `pointer: coarse` 和 `hover: none`，但这些能力没有参与选区菜单决策。
6. [app/ui/reader/lifecycle.js](../../app/ui/reader/lifecycle.js) 维护翻页用的 `pointerdown`、`pointerup`、`pointercancel` 状态，但选区状态没有和翻页状态统一管理。
7. [app/ui/styles.css](../../app/ui/styles.css) 只对自定义菜单设置 `user-select: none`，没有针对正文触摸选择建立策略。
8. Playwright 当前只有 Desktop Chrome 项目，现有“touch”测试主要是手动创建 Range 后派发合成 `pointerup`，不是真实长按选区。

### 第一性原理判断

移动浏览器的长按选区属于 WebView/浏览器优先处理的系统交互。当前页面代码只实现了“选区已经存在后创建网页浮层”，没有实现“长按手势、选区稳定、系统菜单与网页菜单之间的控制权协商”。鼠标连接后，输入转为普通拖选，绕开了原生长按 ActionMode，因此现有 `mouseup/pointerup` 路径能够工作。

### 不确定项与决策门

以下问题必须在真实设备上采集后再决定实现路径：

- fnOS 当前 FPK 使用新 DOM 章节路径还是旧 iframe/rendition 路径；
- 长按时是否产生 `selectionchange`、`touchend`、`pointerup` 或 `pointercancel`；
- 系统 ActionMode 是否完全吞掉了页面层的后续事件；
- 页面自定义菜单是否出现过但被系统菜单遮挡或被捕获阶段的 `pointerdown` 关闭；
- fnOS 宿主是否提供禁用/扩展原生文本选择菜单的能力。

## 文件与职责地图

计划执行时预计涉及以下文件；本次创建计划时不修改它们：

- Modify: `app/ui/reader/selection-menu.js` — 只负责六功能菜单的展示、菜单动作分发和已确认的 `SelectionSession` 消费。
- Create: `app/ui/reader/selection-controller.js` — 负责 DOM/iframe 两类选区事件归一化、去重、稳定性判断和触摸状态机。
- Modify: `app/ui/reader/highlights.js` — 接入 DOM 选区控制器，移除重复的 DOM 选区触发逻辑，保留标记定位和绘制职责。
- Modify: `app/ui/reader/navigation.js` — 将 iframe 选区转换为统一会话，不再直接进入旧的单按钮划线气泡。
- Modify: `app/ui/reader/lifecycle.js` — 修复选区与翻页指针状态之间的清理边界。
- Modify: `app/ui/reader/device-profile.js` — 暴露输入能力快照和能力变更通知，仅用于选择策略，不改变设备分类规则。
- Modify: `app/ui/styles.css` — 只补充正文选择、菜单触摸目标和降级状态所需的最小样式；不得全局禁用正文选择。
- Modify: `app/ui/app.js` — 在启动时初始化统一控制器，并在文档切换/销毁时清理。
- Test: `tests/dom-regression.test.js` — 验证事件去重、触摸状态机、DOM 选区和菜单行为。
- Test: `tests/reader-core.test.js` — 验证选区会话与已有标记/想法/AI 上下文的兼容性。
- Modify: `e2e/helpers/reader.js` — 增加可复用的真实触摸事件注入和事件日志读取辅助函数。
- Modify: `e2e/highlights.spec.js` — 增加移动触摸选区、菜单动作和滚动取消场景。
- Modify: `e2e/reader.spec.js` — 验证移动端工具栏、侧栏和阅读状态不受选区菜单影响。
- Modify: `playwright.config.js` — 增加 Android/iOS 模拟项目，仅用于事件链回归，不替代 fnOS 真机测试。
- Create: `e2e/mobile-selection.spec.js` — 集中维护移动端选区专项用例。
- Create: `docs/superpowers/progress/mobile-touch-selection.md` — 执行开始后记录设备、事件序列、结论和兼容性结果；本次不创建进度记录。

---

## 阶段一：真实设备事件采集与路径确认

### Task 1: 建立移动端诊断基线

**Files:**
- Create: `docs/superpowers/progress/mobile-touch-selection.md`
- Modify temporarily during execution: `app/ui/reader/selection-controller.js` or a dedicated debug-only instrumentation seam
- Test: `e2e/mobile-selection.spec.js`

**Interfaces:**
- Produces an event trace containing `rendererPath`, `pointerCoarse`, `hoverNone`, `maxTouchPoints`, selection text length, selection range count, and ordered events.
- Produces a decision record: `pageEventsAvailable`, `legacyIframePath`, or `nativeActionModeRequiresHostSupport`.

- [ ] **Step 1: Record the runtime renderer path on a real fnOS device.**

  Record whether `#article .epub-chapter` exists, whether `#epubViewer iframe` exists, and which document owns `window.getSelection()` after opening an EPUB.

- [ ] **Step 2: Record input capability values before selection.**

  Record `navigator.maxTouchPoints`, `matchMedia('(pointer: coarse)').matches`, `matchMedia('(hover: none)').matches`, user-agent family, viewport size, and whether a mouse is connected.

- [ ] **Step 3: Trace one pure-touch long press.**

  Capture the ordered sequence of `touchstart`, `pointerdown`, `selectionchange`, `touchend`, `pointerup`, `pointercancel`, and `contextmenu`, including selection text and `rangeCount` at each event.

- [ ] **Step 4: Trace the same text with a mouse connected.**

  Use the same book, chapter, text range, viewport and theme. Record the event sequence and the first timestamp at which `#selectionMenu` becomes visible.

- [ ] **Step 5: Classify the implementation path.**

  The result must explicitly choose one of these outcomes: page-layer event timing problem, iframe path mismatch, or native ActionMode limitation. Do not implement a touch fix before this classification exists in the progress document.

- [ ] **Step 6: Run the existing regression suite before implementation.**

  Run `npm run test:core`, `npm run test:e2e -- --project=chromium`, and `npm run check:portable`.

  Expected: the pre-change baseline is recorded; any unrelated existing failure is listed separately from the touch issue.

## 阶段二：统一选区会话

### Task 2: Implement the shared selection controller

**Files:**
- Create: `app/ui/reader/selection-controller.js`
- Modify: `app/ui/reader/highlights.js`
- Modify: `app/ui/reader/navigation.js`
- Modify: `app/ui/reader/selection-menu.js`
- Modify: `app/ui/app.js`
- Test: `tests/dom-regression.test.js`

**Interfaces:**
- `setupSelectionController({ article, getEpubContents, onStableSelection, onDismiss }) -> { destroy() }`
- `captureSelectionSession({ selection, source, ownerWindow, chapter }) -> SelectionSession | null`
- `SelectionSession = { text, range, locator, anchor, source: 'dom' | 'iframe', chapterPath, createdAt }`
- `onStableSelection(session, { inputType, reason })` is called at most once for the same selection fingerprint until the selection changes.

- [ ] **Step 1: Write tests for identical-selection de-duplication.**

  Create a DOM Range, dispatch `selectionchange`, `touchend`, and `pointerup`, then assert that the stable-selection callback is called once and contains the same normalized text and locator.

- [ ] **Step 2: Write tests for DOM and iframe session shape parity.**

  Feed equivalent text ranges from the outer document and an iframe-like document fixture. Assert that both outputs contain `text`, `range`, `locator`, `anchor`, `source`, and `chapterPath`.

- [ ] **Step 3: Implement source-aware selection capture.**

  Reuse the existing boundary rules from `selection-menu.js`: only accept non-collapsed selections inside an EPUB chapter, reject selections outside `#article`, reject empty text, and retain the 4000-character limit.

- [ ] **Step 4: Implement event coalescing.**

  Treat `selectionchange` as the primary signal, schedule one microtask or animation-frame read, and let `touchend`, `pointerup`, and `keyup` request the same read rather than invoking separate menu flows.

- [ ] **Step 5: Route both renderers into `showSelectionMenuForRange` or its equivalent.**

  Remove the user-visible divergence where iframe selection opens only the old “划线” pill. Preserve CFI data for legacy annotations while constructing the common session consumed by the six-action menu.

- [ ] **Step 6: Run the focused tests.**

  Run `node --test tests/dom-regression.test.js --test-name-pattern="selection|iframe|highlight"`.

  Expected: DOM selection, iframe selection, session de-duplication and six-action menu tests pass.

## 阶段三：移动端触摸状态机与手势边界

### Task 3: Add touch selection arbitration without disabling text selection

**Files:**
- Modify: `app/ui/reader/selection-controller.js`
- Modify: `app/ui/reader/lifecycle.js`
- Modify: `app/ui/reader/device-profile.js`
- Modify: `app/ui/styles.css`
- Test: `tests/dom-regression.test.js`
- Test: `e2e/mobile-selection.spec.js`

**Interfaces:**
- `touchState = 'idle' | 'touching' | 'moving' | 'selection-stable' | 'menu-visible'`
- `getSelectionInputMode() -> 'mouse' | 'touch' | 'hybrid'`
- `resetSelectionGesture(reason) -> void`

- [ ] **Step 1: Write tests for short tap, scroll, long press and canceled long press.**

  Assert that a short tap and a drag exceeding the configured movement threshold do not open the menu; a stable non-collapsed selection does; `pointercancel` clears the pending gesture.

- [ ] **Step 2: Implement capability-based input mode detection.**

  Use the existing device profile plus the actual event `pointerType`; do not infer “mouse mode” solely from the user-agent and do not change the existing mobile/desktop surface classification.

- [ ] **Step 3: Make selectionchange the mobile primary path.**

  When a touch selection becomes non-collapsed and belongs to an EPUB chapter, freeze the session and request the menu after the selection has remained stable for one frame. `touchend` only confirms or cleans up the gesture.

- [ ] **Step 4: Define cancellation behavior.**

  Cancel pending selection handling on `touchmove` beyond the scroll threshold, `pointercancel`, chapter replacement, reader navigation, and selection collapse.

- [ ] **Step 5: Repair pagination pointer cleanup.**

  Ensure every early return from pagination `pointerup` clears `pointerStartX`, `pointerStartY`, and `pointerBlocked` when the gesture was consumed by text selection. Verify that a later horizontal swipe starts from fresh coordinates.

- [ ] **Step 6: Add only minimal CSS touch rules.**

  Keep正文 `user-select: text` behavior intact. Apply `user-select: none` only to the custom menu and controls. Do not add a global `touch-action: none`; any `touch-action` rule must be scoped to a specific non-reading control and covered by a scroll regression test.

- [ ] **Step 7: Run unit and browser tests.**

  Run `npm run test:core` and `npm run test:e2e -- --project=chromium`.

  Expected: existing desktop selection, paging, scrolling and mobile chrome tests pass before moving to real-device testing.

## 阶段四：系统原生菜单兼容与降级决策

### Task 4: Decide whether page-only control is sufficient

**Files:**
- Modify: `docs/superpowers/progress/mobile-touch-selection.md`
- Potentially modify later: `app/ui/reader/selection-controller.js`
- Potentially create later: `app/ui/host-selection-bridge.js` or the fnOS host integration file identified during Task 1
- Test: `e2e/mobile-selection.spec.js`

**Interfaces:**
- `selectionControlMode = 'page-menu' | 'native-menu-with-reader-entry' | 'host-bridge'`
- The selected mode must be persisted only as a diagnostic/product capability decision, not as user content state.

- [ ] **Step 1: Test whether fnOS exposes a WebView ActionMode hook.**

  Use only the existing host APIs and integration points. Record whether the host can suppress, replace, extend or observe the native text-selection menu without disabling selection.

- [ ] **Step 2: Verify page-only behavior after Task 3.**

  On Android Chrome, iOS Safari/iPad touch mode, and fnOS WebView, record whether the six-action menu appears and whether the system menu remains visible.

- [ ] **Step 3: Select the control mode.**

  Choose `page-menu` only when the page can reliably present the reader menu; choose `native-menu-with-reader-entry` when native copy must remain; choose `host-bridge` only when the host has a supported and testable extension point.

- [ ] **Step 4: Document the fallback UI contract.**

  If native menu cannot be replaced, specify exactly how users reach标记、波浪线、写想法和问 AI after selection, and ensure the UI does not claim that the system menu has been replaced.

- [ ] **Step 5: Block implementation until the decision is recorded.**

  No native interception code may be added based only on desktop Chromium behavior.

## 阶段五：专项测试与兼容验证

### Task 5: Add mobile selection regression coverage

**Files:**
- Modify: `playwright.config.js`
- Modify: `e2e/helpers/reader.js`
- Create: `e2e/mobile-selection.spec.js`
- Modify: `e2e/highlights.spec.js`
- Modify: `e2e/reader.spec.js`
- Modify: `tests/dom-regression.test.js`

**Interfaces:**
- `selectArticleTextByTouch(page, text, options) -> Promise<{ selectionText, menuVisible }>`
- `readSelectionEventTrace(page) -> Promise<Array<{ type, time, text, rangeCount, pointerType }>>`

- [ ] **Step 1: Add a mobile Chromium project.**

  Configure an Android-like device with `hasTouch: true`, a mobile viewport and the existing server. Keep the existing Desktop Chrome project unchanged.

- [ ] **Step 2: Add tests for real touch event injection.**

  Use a real touch sequence or the project’s supported CDP input method: press, hold long enough for selection, move only within the target text, release, then inspect selection text and menu visibility.

- [ ] **Step 3: Add tests for scroll preservation.**

  Perform a vertical swipe without selecting text. Assert that the article scrolls and the menu remains hidden.

- [ ] **Step 4: Add tests for all six menu actions.**

  Verify copy, marker, wave, line, thought and AI each receive the same selected text and chapter locator on a touch-generated session.

- [ ] **Step 5: Add tests for navigation cleanup.**

  Select text, navigate to another chapter, return, and assert that no stale menu or stale selection session remains.

- [ ] **Step 6: Run the full verification set.**

  Run:

  ```text
  npm run test:core
  npm run test:e2e
  npm run check:portable
  ```

  Expected: all existing tests pass, mobile selection tests pass in emulation, and any fnOS-only limitation is recorded separately rather than hidden by a skipped test.

- [ ] **Step 7: Perform fnOS acceptance testing.**

  Test at minimum: pure touch, touch plus mouse, Android-like WebView, iPad touch mode, continuous scroll, theme light/dark/sepia, and a book containing long paragraphs plus nested chapter markup.

## 完成定义

本计划只有在以下条件全部满足后，才可以标记为完成：

1. 已有真实设备事件链记录，并明确区分页面事件问题、iframe 路径问题和原生 ActionMode 限制。
2. DOM 与 iframe 路径使用同一套 `SelectionSession` 和六功能菜单。
3. 触摸长按不会因为页面新增监听而失去文本选择能力。
4. 正常滚动、分页、翻章和工具栏点击不受影响。
5. 系统菜单是否保留有明确产品策略，不以“看起来没有弹出”为验收依据。
6. 桌面、触摸模拟和 fnOS 真机测试结果分别记录。
7. 所有代码变更通过现有核心测试、E2E 测试和便携结构检查。
8. FPK 重新打包前，必须先经过用户明确要求执行；本计划本身不触发打包。

## 当前状态

- [x] 完成静态代码审查和第一性原理分析。
- [x] 识别 DOM/iframe 双路径、触摸事件缺口、系统菜单控制权和测试盲区。
- [x] 建立后续开发计划。
- [ ] 未采集真实设备事件。
- [ ] 未修改功能代码。
- [ ] 未创建执行任务。
- [ ] 未构建新版 FPK。

这份文档是待用户主动授权后再执行的独立计划。后续只有用户明确要求“执行移动端触摸选区方案”或指定其中某个阶段时，才进入任务流程。
