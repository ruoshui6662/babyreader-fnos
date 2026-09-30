# PDF 阅读体验优化（Task 7）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes planning only; implementation starts on a later user request.

**Goal:** 在不替换现有 PDF.js 集成、不改变书库授权与用户数据契约的前提下，让 PDF 滚动、缩放、横竖屏切换、文本选择、搜索和标注呈现保持连续、稳定、低延迟，并让顶部操作区在桌面宽屏、桌面竖屏和移动端形成一致且可操作的阅读体验。

**Architecture:** 保留 BabyReader 自有阅读外壳与本地 `pdfjs-dist@6.3.289`。在现有 `pdf.js` 上补一层轻量页面调度器和“页面帧”提交契约：只按优先级渲染当前可见页与有限邻页，Canvas、文本层、搜索命中层和标注层共享 `bookId/generation/pageIndex/scale/rotation`，旧帧在新帧完整就绪前继续显示。长文档只保留有限页面视图和尺寸元数据。顶部栏继续复用现有设计 token，但改为单一响应式布局状态机，不再靠多组互相覆盖的 media query 拼接。

**Tech Stack:** Node.js 22、原生浏览器 JavaScript、锁定的 `pdfjs-dist@6.3.289`、CSS design tokens、`node:test`/happy-dom、Playwright Chromium、现有 fnOS FPK 与设备验收脚本。

**Spec:** `docs/superpowers/plans/2026-09-25-pdf-reader-quality-roadmap.md`；PDF 标注已完成状态以 `docs/superpowers/progress/2026-09-25-pdf-annotations-progress.md` 为准。

## 审查结论

### 当前可保留的基础

- `app/ui/reader/pdf.js` 已采用 detached staging canvas，只有 PDF.js 渲染完成后才替换可见 Canvas；缩放会取消旧 render task，并以 `generation + scale` 拒绝过期结果。
- 当前可见区前后各一屏是渲染缓冲区，离屏 Canvas、文本层和标注层可回收；活动文本选区另有 8 页与 32M Canvas 像素上限。
- PDF 页进度、单页/双页、适宽/手动缩放、搜索精确命中、书签、划线和笔记均已有独立回归，EPUB 数据结构没有被 PDF 定位器替换。
- 控件已有 44px 最小点击区、语义颜色和焦点样式，适合作为视觉优化基线，不需要重做设计系统。

### 已确认的问题与根因

| 现象 | 代码根因 | 风险 |
| --- | --- | --- |
| 快速滚动或缩放仍可能掉帧、短暂空白或层间错位 | `renderVisiblePdfPages()` 对缓冲区内所有页直接 `void renderPage()`，没有可见页优先队列；Canvas 与文本层在同步语句中替换，但标注层下一帧绘制，搜索层另有自己的提交时序 | 多个高分辨率页争用主线程；用户看到旧/新层混合的一帧 |
| 超长 PDF 初次打开的 DOM 与观察器成本随页数线性增长 | `makePageSlots()` 一次创建最多 10,000 个 section、canvas、text layer，并让 `IntersectionObserver` 观察全部页 | 即使 Canvas 已虚拟化，数千空节点仍占内存和布局时间 |
| 窄桌面/竖屏顶部控件与标题割裂 | 宽屏使用 fixed 透明覆盖，≤1100px 改 sticky+wrap，mobile 再改 column；同一控件存在三套布局规则 | 竖屏出现两排胶囊，首屏高度增加，标题和控件的视觉归属不稳定 |
| 状态信息重复占位 | 总页数同时出现在页码组 `/ 9` 与单独的 `9 页` 状态胶囊中；状态胶囊一直参与首屏布局 | 阅读内容下移，加载状态、错误状态与普通元信息没有层级差异 |
| 缩放/布局切换的锚点只到“页顶” | 当前仅记录活动页相对顶部偏移，布局切换调用 `scrollIntoView({block:'start'})` | 阅读到页面中部时，缩放、横竖屏或单双页切换可能丢失页内位置 |
| 文本层和可访问性生命周期较薄 | 自建 `TextLayer` 使用整页 `getTextContent()`；没有 PDF.js Viewer 的可见页优先、文本流、选择管理与统一 abort 生命周期 | 复杂页、跨页拖选、快速切书时更容易出现等待或中断，读屏状态提示不足 |

### 现场体验基线（2026-09-25）

1. 约 380px 宽的竖屏视口中，页码与缩放形成上下两排，标题被截断，顶部栏加控制区占据明显首屏高度；PDF 本身可继续滚动和选择。
2. 显示设置抽屉可正常打开，PDF 只暴露背景、布局和目录选项；抽屉在窄屏覆盖大部分页面，后续应保证关闭按钮、焦点和滚动位置稳定，但不在本任务重做整个抽屉。
3. 当前 9 页双栏样本可提取文本并显示多页，证明问题主要在调度、响应式和层同步，而不是 PDF 解码失败。

## 开源调研与本地取舍

| 来源 | 可借鉴机制 | BabyReader 取舍 |
| --- | --- | --- |
| [Mozilla PDF.js `pdf_rendering_queue.js`](https://github.com/mozilla/pdf.js/blob/master/web/pdf_rendering_queue.js) | 优先渲染可见页，其次才是滚动方向上的邻页；渲染结束后再调度下一页，并在空闲期清理 | 实现轻量串行/有限并发队列，不引入完整 Viewer 事件总线 |
| [Mozilla PDF.js `pdf_viewer.js`](https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js) | 默认页面缓存大小为 10；对 250/5000/10000 页文档分别暂停 eager init、强制 lazy init、限制模式 | 采用“可见页 + 邻页 + LRU”预算；超过阈值懒创建页面壳，不复制完整 Viewer |
| [Mozilla PDF.js `pdf_page_view.js`](https://github.com/mozilla/pdf.js/blob/master/web/pdf_page_view.js) | 缩放时可保留 Canvas wrapper、文本层和注释层，先做 CSS 变换并延后重绘，避免空白 | 继续保留旧位图；将 Canvas、文本、搜索和标注统一为一次页面帧提交，不依赖不稳定的 master 私有 API |
| [Mozilla PDF.js `text_layer_builder.js`](https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.js) | 文本层独立取消/更新，使用流式文本内容，并统一管理选择状态和 copy 规范化 | 先给本地 TextLayer 增加 AbortController 和同帧提交；流式接口只在确认 6.3.289 兼容后启用 |
| [react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter/blob/main/src/components/PdfHighlighter.tsx) | 标注存储缩放坐标，显示时按当前 viewport 重投影，选区提示与永久标注分层 | 保留现有归一化 PDF 坐标与独立覆盖层；不引入 React |
| [Apple HIG — Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) | 控件按 leading/center/trailing 分组，最多三组；窗口变窄时维持核心操作可用并减少拥挤 | PDF 页码与缩放作为一个中心控制簇；窄屏只做紧凑化和渐进披露，不拆成多排悬浮胶囊 |
| [Apple HIG — Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) | 保留系统滚动行为和键盘操作，控制层与滚动内容需要清晰但连续的边界 | 不自造翻页手势；滚轮/触控板/触摸滚动为主，按钮与键盘为等价入口 |
| [Apple HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | 反馈应短促、可取消，并响应 Reduce Motion | 仅做 120–180ms 淡化/状态过渡；`prefers-reduced-motion` 下取消非必要动画 |

调研中的 PDF.js `master` 仅用于验证设计模式。实际实现必须以仓库内锁定的 6.3.289 构件和公开 API 为准，不复制 master 的私有字段，不在线加载 CDN。

## Global Constraints

- 当前 `main` 工作区包含大量用户已有的修改和未跟踪文件，`app/ui/reader/pdf.js` 等 PDF 文件本身仍未跟踪。执行时只编辑本计划列出的路径；不得 reset、clean、批量格式化、删除已有 FPK 或自动提交。
- 继续只读取 fnOS 授权目录中的本地 PDF；保留网关 UID、路径复核、同源 Range、CSP、本地 Worker、PDF 开关和 no-follow 文件读取。Task 7 不增加任意 URL、CDN、脚本执行、附件打开或原 PDF 写回。
- 不改变现有进度 `{version:1,type:'pdf',pageIndex}`、书签、`pdfAnnotations`、本地 FTS、搜索 locator 和 EPUB/TXT 数据格式。页内滚动锚点若新增，只能作为向后兼容的可选字段，旧记录仍可恢复。
- Canvas 继续限制 16M 像素、8192 边长，文本层每页 250k 字符，选区最多 8 页/512 quad/4000 字；优化只能降低资源占用，不能静默放宽上限。
- 不引入 React、完整 PDF.js Viewer、OCR、PDF 表单、附件、外链、打印、导出写回或 AI。它们需要独立安全设计和授权。
- 所有视觉优化复用现有设计 token；不得为了 PDF 改坏 EPUB 顶栏、抽屉、主题、搜索面板、书签或标注编辑器。
- 每阶段先写会失败的自动化断言，再做最小实现；本地测试通过不等于 fnOS 设备通过。打包与 NAS 安装仅在用户另行要求时执行。

## 目标指标与验收门

| 指标 | 首版门槛 |
| --- | --- |
| 首个可读页 | 本地合成 4 页样本中，打开后首个 Canvas 与文本层均 ready；不等待所有邻页 |
| 渲染并发 | 默认最多 1 个高分辨率页面 render task；允许文本层跟随同页，不并发启动整个缓冲区 |
| 页面缓存 | 正常文档默认最多保留 10 个完整页面帧；活动选区页受既有 8 页/32M 像素预算约束 |
| 帧一致性 | 任一可见页的 Canvas、文本、搜索、标注都必须属于同一 `bookId/generation/pageIndex/scale/rotation/frameId` |
| 缩放连续性 | 新帧完成前保留旧位图；活动阅读锚点的屏幕位置偏差 ≤ 12 CSS px |
| 竖屏布局 | 720–1100px 桌面竖屏中标题与控件不重叠；控制区单排且所有按钮可点击 |
| 移动布局 | 320/375/430px 下无横向溢出，页码与缩放核心操作单排；次要动作进入现有设置/更多入口 |
| 交互延迟 | 页码、缩放、适宽按下后立即有状态反馈；连续滚动不因邻页预渲染阻塞当前页 |
| 无障碍 | 键盘可操作翻页/缩放/适宽，焦点可见，页码和缩放变化有非打断式状态；减少动态效果生效 |

## 文件职责

| 路径 | Task 7 职责 |
| --- | --- |
| `app/ui/reader/pdf.js` | 页面调度、帧状态、缓存、页内锚点、缩放/布局/销毁生命周期 |
| `app/ui/reader/pdf-render-scheduler.js`（新） | 纯调度器：可见度、滚动方向、优先级、并发和 LRU 决策；不操作网络/UI |
| `app/ui/reader/pdf-annotations.js` | 接受统一页面帧提交，在同一 frameId 上重绘或撤销标注 |
| `app/ui/reader/search.js` | 搜索命中层接受统一页面帧上下文，不对旧 scale/page DOM 绘制 |
| `app/ui/index.html` | 维持语义化控制组和脚本顺序；仅在必要时增加紧凑“更多”入口 |
| `app/ui/styles.css` | 单一响应式顶部控制簇、阅读内容安全区、过渡与 reduced motion |
| `tests/pdf-reader.test.js`（或新 scheduler 单测） | 优先级、并发、取消、LRU、页内锚点和代次隔离 |
| `tests/pdf-annotations.test.js` | 统一 frameId、缩放/旋转重投影和选区缓存预算 |
| `tests/dom-regression.test.js` | EPUB/PDF 控件显隐、ARIA、主题和 DOM 契约 |
| `e2e/pdf-reader.spec.js` | 真实滚动、缩放、横竖屏、选择、搜索、标注和键盘回归 |
| `docs/superpowers/progress/2026-09-25-pdf-reading-experience-task7-progress.md`（新） | 每阶段 RED→GREEN、性能数据、失败复盘、设备边界 |

---

### Task 7.0：冻结基线与可测性能信号

**Files:** Read PDF 相关源文件；Create `docs/superpowers/progress/2026-09-25-pdf-reading-experience-task7-progress.md`; Modify tests only if needed for observability.

**Interfaces:** 只新增测试态可读指标，如 `getDebugState()` → `{generation,activeRenderCount,queuedPages,renderedPages,currentPage,scale,layoutMode}`；生产 UI 不显示调试数据。

- [x] **Step 1:** 记录当前分支、工作树精确状态、相关未跟踪文件 SHA-256 和现有 FPK 边界；核对质量路线图与 P3.2 进度文件的一致性，不改产品代码。
- [x] **Step 2:** 跑 `node --test tests/pdf-reader.test.js tests/pdf-annotations.test.js tests/dom-regression.test.js`、`npx playwright test e2e/pdf-reader.spec.js --project=chromium`、`npm run check:portable`，记录总数、失败和跳过原因。
- [x] **Step 3:** 在 E2E 中增加只记录不设宽松结论的 baseline：首次页 ready、快速滚动期间最大活跃 render 数、缩放前后锚点偏移、缓存页数、320/375/800/1100/1600 宽度几何。
- [x] **Step 4:** 用合成 4 页、100 页和用户本地真实双栏样本分开记录；真实书籍只用于本机/设备人工验收，不复制进仓库。

### Task 7.1：可见页优先的有界渲染调度器

**Files:** Create `app/ui/reader/pdf-render-scheduler.js`; Modify `app/ui/reader/pdf.js`, `app/ui/index.html`, structure/provenance/acceptance manifests; Test scheduler and `e2e/pdf-reader.spec.js`.

**Interfaces:** `createPdfRenderScheduler({maxConcurrent:1,maxFrames:10})`; `update({visible,buffered,selected,currentPage,scrollDirection,generation})`; `next()`；`markRunning/markReady/markFailed/evict/destroy`。排序为：当前可见未完成页 → 其他可见页 → 当前滚动方向邻页 → 反方向邻页；选区页只影响回收，不抢占当前可见页。

- [x] **Step 1 (RED):** 纯单测断言可见页优先、向下/向上邻页顺序、同页去重、最多 1 个 active、切代次丢弃旧队列、失败页不无限重试。
- [x] **Step 2 (GREEN):** 用调度器替换缓冲区内 `void renderPage()` 并发启动；render settle 后再请求下一页。`IntersectionObserver`/scroll 只更新优先级，不直接发起所有渲染。
- [x] **Step 3:** 当前页失败显示页级错误；邻页失败不覆盖全局阅读状态。快速反向滚动时取消低优先级未提交任务，但保留已显示旧帧。
- [x] **Step 4:** 验证快速滚动时当前可见页先 ready，`activeRenderCount <= 1`，旧书/旧 generation 不提交。

### Task 7.2：Canvas、文本、搜索与标注的原子页面帧

**Files:** Modify `app/ui/reader/pdf.js`, `pdf-annotations.js`, `search.js`, `styles.css`; Test `tests/pdf-reader.test.js`, `tests/pdf-annotations.test.js`, E2E.

**Interfaces:** `PdfPageFrame = {frameId,bookId,generation,pageIndex,scale,rotation,viewport,canvas,textLayer,textLayerState}`；`commitPdfPageFrame(frame)`；`onPdfPageFrameCommitted(frameContext)`。搜索和标注只消费 frame context，不自行推断当前 scale。

- [x] **Step 1 (RED):** 测试 Canvas 完成但 text layer 未完成、缩放中取消、切书后旧 promise 返回、标注 rAF 晚到、搜索命中旧页 DOM 等竞态；任何情况都不能提交混合 frameId。
- [x] **Step 2 (GREEN):** Canvas 和文本层均在 detached 容器生成；在一个 animation frame 内交换页面视觉层并发布 frame context。标注/搜索在同一提交回调中同步失效旧层，再排队绘制新层。
- [x] **Step 3:** 缩放期间给旧完整帧做临时 CSS 尺寸适配，设置 `aria-busy=true`，新帧 ready 后淡化替换；失败则保留旧帧并提供重试，不清成黑/白块。
- [x] **Step 4:** `prefers-reduced-motion: reduce` 下取消淡化；新旧页不做位移或弹性动画。

### Task 7.3：长文档页面壳、缓存和选区预算

**Files:** Modify `pdf.js`, scheduler, `styles.css`; Test 100/500/5000 页合成元数据场景和现有选择测试。

**Interfaces:** `PdfPageShellStore` 只保存 `{pageIndex,width,height,state}`；完整 DOM/Canvas/TextLayer 由窗口化层创建/回收。尺寸未知时使用首个可靠页面比例，占位尺寸更新必须补偿 scroll anchor。

- [x] **Step 1 (RED):** 129/500/5000 页测试断言首开不会同步创建同页数的 Canvas/TextLayer 或观察同页数节点；稳定占位与页码跳转仍正确。真实浏览器总滚动高度仍需设备验收。
- [x] **Step 2 (GREEN):** 文档较小时沿用当前简单路径；超过保守阈值 250 页懒创建可见页前后窗口。页面元数据仍可按需缓存，完整帧 LRU 默认 10。
- [x] **Step 3:** 活动文本选区覆盖的页面暂不销毁，但继续受 8 页/32M 像素限制；达到限制时清楚提示并结束选区，不把页面永久钉住。
- [x] **Step 4:** 页码跳转、目录、搜索命中可直接物化目标页窗口；不得通过从第一页逐页滚动实现。

### Task 7.4：顶部操作区和响应式阅读壳统一

**Files:** Modify `app/ui/index.html`, `app/ui/styles.css`; Test DOM and Playwright viewport matrix.

**Interfaces:** 仅保留三个稳定区域：leading（返回+短标题）、center（页码+缩放核心控制簇）、trailing（现有搜索/书签/主题/设置工具栏）。`data-pdf-toolbar-mode="wide|compact|mobile"` 由同一断点函数设置，CSS 不再用互相覆盖的 fixed/sticky/column 规则猜测状态。

- [x] **Step 1 (RED):** 1600×900、1100×900、800×1000、430×932、375×812、320×568 断言标题与控制不相交、核心控件单排、无横向溢出、44px 点击区、页面起点不被遮住。
- [x] **Step 2 (GREEN):** 宽屏继续与顶栏融为一体；竖屏桌面将标题压缩为安全宽度但不覆盖控件；移动端合并“页码 + 缩放值 + 适宽”到一条紧凑控制簇，减少重复边框和状态胶囊。
- [x] **Step 3:** 普通“9 页”信息并入页码组；只有加载、受限、失败或降级状态才显示独立 status。状态出现/消失不得推动当前阅读页跳动。
- [ ] **Step 4:** 统一图标 18px、圆角、边框、hover/pressed/focus 和深浅/护眼主题；不改 EPUB 控件结构，只复用同一 token 和高度。现有两组工具控件已共享 token/44px 命中区；全部图标和三主题逐项视觉验收仍待设备。

### Task 7.5：页内锚点、自然滚动与输入方式

**Files:** Modify `pdf.js`, progress adapter if optional anchor is approved, `styles.css`; Test unit/E2E.

**Interfaces:** `captureReadingAnchor()` → `{pageIndex,normalizedY,viewportOffset}`；`restoreReadingAnchor(anchor,{reason})`。页码仍是持久化最低契约；新增 `normalizedY` 时为可选且无效值回退页顶。

- [ ] **Step 1 (RED):** 阅读到页面 60% 处后缩放、适宽、单双页切换、800↔1600 和横竖屏变化，目标文字/归一化位置仍在同一视觉区域，偏差 ≤12px。已自动化验证手动缩放、单双页与 1000→800；适宽导致页面不足一屏时不可物理保持 60%，其余组合待设备验证。
- [x] **Step 2 (GREEN):** 在改变尺寸前记录页内归一化锚点，页面壳与新帧尺寸更新后恢复；用 scroll guard 阻止中间 scroll 事件写错当前页。
- [x] **Step 3:** 保留系统滚轮、触控板、触摸、PageUp/PageDown、方向键和 `Ctrl/Cmd +/-/0`；按钮只是等价入口，不加入自定义惯性滚动或拦截浏览器选择手势。
- [x] **Step 4:** 单/双页的上一页、下一页继续以 spread 语义移动；连续模式自然滚动，不强制 snap 到页顶。

### Task 7.6：文本选择、搜索、标注和无障碍联动

**Files:** Modify `pdf.js`, `pdf-annotation-geometry.js`, `pdf-annotations.js`, `search.js`, `styles.css`; Test真实指针和键盘。

**Interfaces:** 所有选择/搜索/标注操作先校验统一 frame context。文本层重建时如存在活动选区，延迟该页重建或明确结束选区，不尝试把 stale DOM Range 静默映射到新节点。

- [ ] **Step 1:** 多栏中文、英文连字符、旋转页、跨 Span/行/页真实拖选；复制内容、原生蓝色、永久标注和搜索命中不得相互叠色或跨栏扩张。
- [x] **Step 2:** 搜索结果面板保持打开；精确命中只在 ready 文本层绘制。页面可到达但文本无法确认时保持“仅定位到页面”，不伪造高亮。
- [x] **Step 3:** 工具栏、页码输入和设置抽屉按视觉顺序获得焦点；页码/缩放变化用 `aria-live="polite"` 的单一状态节点播报，滚动过程中不连续刷屏。
- [ ] **Step 4:** 检查 200% 浏览器缩放、系统高对比、深色/护眼主题及 reduced motion；Canvas 内容不可读时，文本层仍保留可选择和可访问文本，不把它设为 `aria-hidden`。

### Task 7.7：全回归、性能证据和设备交付

**Files:** Update tests and `docs/superpowers/progress/2026-09-25-pdf-reading-experience-task7-progress.md`; no automatic package/install.

- [x] **Step 1:** 运行 `npm test`、`npx playwright test --project=chromium`、`npm run check:portable`、相关 JS 语法检查和 `git diff --check`；完整记录通过/失败/跳过，不只报告专项测试。
- [ ] **Step 2:** 连续执行 5 轮快速滚动→缩放→横竖屏→搜索→选择→标注→切书；检查控制台、active tasks、rendered frames、DOM 节点与 Canvas 像素预算无持续增长。
- [x] **Step 3:** EPUB/TXT 回归书库打开、滚动/分页、搜索、书签、划线/笔记、AI 面板和设置；PDF 修改不能改变 EPUB 的阅读位置与主题设置。
- [ ] **Step 4:** 用户另行要求后才生成隔离 `dist-fpk-*`，记录 dirty source commit、build id、包内清单、大小和 SHA-256；包内不得含真实书籍、测试 Cookie、NAS 路径或临时截图。
- [ ] **Step 5:** fnOS 设备验收覆盖 9 页双栏样本、444 页大 PDF、长文档快速滚动、竖屏显示器、320/375 移动视口、深浅/护眼主题、两标签切换。设备失败时回退 Task 7 独立变更，不回滚书库、搜索、书签或标注数据。

## 明确不做的内容

- 不把 Task 7 扩展为 PDF.js 完整 Viewer 迁移。
- 不实现 OCR、手写、橡皮擦、图像区域批注、表单填写、签名、打印、下载或写回原 PDF。
- 不因性能优化删除现有搜索索引、书签、标注或阅读进度。
- 不使用用户真实 PDF 作为自动化夹具提交仓库。
- 不把本地 Chromium 通过写成 NAS、Safari、Firefox 或移动真机通过。

## 执行顺序与回退点

`7.0 基线 → 7.1 调度 → 7.2 原子帧 → 7.3 长文档 → 7.4 顶栏 → 7.5 锚点/输入 → 7.6 选择/无障碍 → 7.7 交付`

每个阶段都必须可单独回退。7.1–7.3 只改变 PDF 渲染内部；7.4 只改变布局；7.5 的可选页内进度字段必须向后兼容；7.6 不迁移已有标注。任一阶段出现 EPUB 回归、授权绕过、来源指纹失效、旧书数据不可读或内存持续增长，立即停止后续阶段并保留上一阶段稳定实现。
