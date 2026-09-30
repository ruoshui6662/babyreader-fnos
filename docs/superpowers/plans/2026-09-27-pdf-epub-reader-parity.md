# PDF 与 EPUB 阅读功能细节对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PDF 与 EPUB 的共同阅读操作拥有一致的入口、状态反馈和可恢复行为，同时保留固定版面与流式排版各自合理的差异。

**Architecture:** 保留现有共享阅读外壳、搜索面板、书签面板、标记与想法面板及 AI 面板；在现有格式适配器和 PDF 控制器中分别处理定位。只对用户可见的共同操作建立统一契约，不合并 EPUB 的 CFI/DOM 位置与 PDF 的页坐标存储。

**Tech Stack:** 原生 JavaScript/CSS、EPUB.js/现有 EPUB 章节渲染、锁定的 `pdfjs-dist@6.3.289`、Node.js 22 测试、Playwright Chromium、fnOS 本地服务。

**Spec:** 本计划的“基线和对齐原则”部分；现有格式边界见 `docs/superpowers/specs/2026-09-23-pdf-reader-design.md` 与 `docs/superpowers/specs/2026-09-24-pdf-layout-and-settings-design.md`。以当前工作区代码为实施基线；旧路线图中“尚未实施”的文字不能覆盖现有实现。

## 基线和对齐原则

用户目标是从 EPUB 切换到 PDF 时，不必重新学习搜索、目录、书签、标记、笔记、AI 与返回书架的基本操作。成功标准是共同功能的入口、可用/禁用原因、完成反馈、焦点及错误提示一致；定位单位仍按 EPUB 章节/语义位置、PDF 页/页内几何位置呈现。

| 能力 | 当前 EPUB | 当前 PDF | 本计划结论 |
| --- | --- | --- | --- |
| 阅读模式 | 连续滚动、双页分页 | 连续、单页、双页；窄屏双页自动回退 | 保留两套模式值，统一设置措辞、切换反馈和窄屏说明；不为对齐而重写分页器 |
| 页面外观 | 字体、字号、行高、缩进、段距、页边距、主题可影响正文 | 固定页面，支持缩放、适宽和阅读器主题；EPUB 排版控件已隐藏 | 明示固定版面限制，不提供无效的字体/行高控件，不反色改写 PDF 原文 |
| 目录 | EPUB nav/NCX 解析与章节定位 | PDF outline 解析与页定位 | 已有共同目录面板；无 outline 时显示统一空态，不伪造章节 |
| 搜索 | 本地全文搜索、章节内精确命中 | 本地全文搜索、页内可核实的精确命中；无法核实时仅定位页 | 维持同一面板及结果/错误反馈，测试格式边界，不改索引协议 |
| 书签 | 章节/语义位置 | `{version:1,type:'pdf',pageIndex}` 页级位置 | 已有共同新增、删除、列表与跳转；页级精度须如实表达 |
| 标记与想法 | EPUB DOM/CFI 位置，通用 highlights 存储 | PDF 文本层选区/归一化四边形，独立 pdfAnnotations 存储 | 已有共同菜单、颜色、样式、编辑和导出；继续分别存储，改进 PDF 列表回原文位置的体验 |
| 阅读进度 | 章节/百分比提示与语义位置恢复 | 页码保存/恢复，顶部 EPUB 进度提示被隐藏 | 给 PDF 提供紧凑且不重复的进度反馈；不把 PDF 页码冒充 EPUB 章节 |
| AI 问书 | 章节/全书证据，来源章节 | 所选同页文字或可检索全书，来源页码；结构化 PDF 路径受独立默认关闭开关控制 | 对齐入口、范围说明与来源跳转反馈；不改 EPUB 检索，也不借此开启 PDF 结构化实验路径 |

**已知细节差距：** `index.html` 的书签初始 ARIA/标题仍称“仅支持 EPUB”，运行时才改写；PDF 标记列表点击后仅 `goToPdfPage()`，EPUB 会继续定位原文；PDF 选区的 AI 动作只允许同页、至多 1200 字，条件不满足时菜单直接隐藏；移动端 PDF 的“划线”快捷按钮禁用，但 PDF 文本选中后的菜单可建标记。对齐时优先解释真实能力并改进共同流程，不用一个看似可点击但必然失败的控件。

## Global Constraints

- 本计划阶段执行前保留当前工作区所有未提交与未跟踪内容；只编辑当阶段列出的文件，不执行 `reset`、`clean`、批量格式化、自动提交、自动合并或删除旧 FPK。
- PDF 开关、fnOS 授权目录、UID 隔离、来源指纹、同源 Range、CSP、本地 PDF.js Worker 和现有资源上限保持有效；不得读取未授权路径或把书籍内容发给新外部服务。
- 保持 EPUB `highlights`、CFI/DOM locator、阅读进度和 PDF `pdfAnnotations`、页索引、书签的持久化格式；内部页索引 0 基，UI 页码 1 基。若未来确需新增可选位置字段，旧记录仍必须可读、可跳转至原有页级位置。
- 不修改 PDF 原文件，不引入 OCR、PDF 内外链接执行、附件、表单、打印或完整 PDF.js Viewer；图像型 PDF 不承诺可选择/搜索/标记文字。
- PDF 固定版面不承诺 EPUB 字体重排；EPUB 排版变更不得调用 PDF 缩放逻辑，PDF 颜色偏好变更不得触发 EPUB 重新分页。
- 本计划只规划；执行各 Task 时分别记录本地自动化、真实指针/键盘、NAS 设备验收状态。未经设备测试不得写“NAS 已通过”。打包/安装不在本计划自动执行范围内。

## Review Focus

- PDF 无 outline：目录显示清楚的空态，不误报内容损坏；Task 1 的浏览器测试固定。
- 图片型 PDF 无文本层：搜索/划线/AI 提示能力边界，不出现空白成功态；Task 3 的浏览器测试固定。
- PDF 标记来源过期或当前渲染帧被缩放替换：列表仍可查看/删除，但不错误滚动到别人的文字；Task 2 的单测和浏览器测试固定。
- 双页、窄屏回退、连续滚动之间切换：当前页/原文位置及手动缩放不被被动滚动事件覆盖；Task 1 和 Task 2 固定。
- 快速切书、关面板或刷新后旧异步结果返回：不得把 A 书命中、标记或 AI 来源绘制到 B 书；Task 2、3、4 固定。

## 文件结构与职责

| 路径 | 职责 |
| --- | --- |
| `app/ui/index.html`、`app/ui/styles.css` | 共同控件语义、PDF 顶部状态、响应式布局和可访问状态 |
| `app/ui/reader/highlights.js`、`app/ui/reader/settings.js` | 格式能力显隐、设置值及文案，不改变 EPUB 专有排版算法 |
| `app/ui/reader/pdf.js`、`app/ui/reader/progress.js` | PDF 页/布局状态、渲染帧与进度反馈；现有进度存储契约不变 |
| `app/ui/reader/notes-panel.js`、`app/ui/reader/pdf-annotation-geometry.js` | PDF 标记页内定位；EPUB 原文导航仍使用现有分支 |
| `app/ui/reader/selection-menu.js`、`app/ui/reader/ai.js`、`app/ui/reader/navigation.js` | 格式能力提示、选区动作与键盘/移动端路径；不改服务端 AI 模型 |
| `app/ui/reader/search.js`、`app/ui/reader/bookmarks.js`、`app/ui/reader/actions.js` | 只在回归发现可复现差异时做局部修正，不重写既有 API |
| `tests/dom-regression.test.js`、`tests/pdf-reader.test.js`、`tests/pdf-annotations.test.js`、`e2e/pdf-reader.spec.js`、`e2e/reader.spec.js`、`e2e/search.spec.js` | 共同能力、格式隔离、真实浏览器交互和回归门禁 |
| `docs/superpowers/progress/2026-09-27-pdf-epub-reader-parity-progress.md` | 每 Task 的基线、RED/GREEN、人工验收和残余差异；执行时新建 |

---

### Task 0：冻结当前共同能力与差异验收基线

**Files:** Create `docs/superpowers/progress/2026-09-27-pdf-epub-reader-parity-progress.md`; Test `tests/dom-regression.test.js`, `e2e/pdf-reader.spec.js`, `e2e/reader.spec.js`, `e2e/search.spec.js`（仅为缺失的基线断言补测试）。

**Interfaces:** Consumes current `state.contentType`, `window.pdfReaderController`, `currentAnnotationAdapter(format)`；Produces 一张通过/差异/不适用矩阵，以及每项对应的测试 ID 和当前结果。

- [x] **Step 1:** 记录 `git status --short`、现有 PDF/EPUB 相关测试结果与 Windows 环境跳过项；不覆盖已有进度文件。
- [x] **Step 2:** 为目录、书签、搜索、标记、导出、AI、模式/设置和进度各列一条“EPUB 操作 → PDF 操作 → 预期反馈”的验收行；把 PDF 固定版面和同页选区限制作“不适用/有条件”，不记作缺陷。
- [x] **Step 3:** 运行 `node --test tests/dom-regression.test.js tests/pdf-reader.test.js tests/pdf-annotations.test.js` 与完整 Chromium 相关基线，精确结果见进度文档。已有共同入口由现存用例覆盖；发现书签初始静态 ARIA 仍为 EPUB-only，将其作为 Task 1 的回归修复。
- [x] **Step 4:** 通过 Chromium 响应式几何测试核对 PDF 顶栏/状态区在 1600/1100/800/430/375/320px；竖屏 720–1100px 的完整 EPUB/PDF 抽屉与触屏菜单仍需 NAS/真机验收，作为未覆盖项记录。

### Task 1：统一阅读入口、状态反馈和设置说明

**Files:** Modify `app/ui/index.html`, `app/ui/styles.css`, `app/ui/reader/highlights.js`, `app/ui/reader/settings.js`, `app/ui/reader/progress.js`；Test `tests/dom-regression.test.js`, `e2e/pdf-reader.spec.js`, `e2e/reader.spec.js`。

**Interfaces:** Consumes existing `updateTopbarState()`, `syncSettingsPanel()`, `pdfReaderController.getCurrentPageIndex()/getPageCount()`；Produces 共同入口的准确标签/禁用原因、PDF 紧凑进度状态和格式差异说明；不新增服务端字段。

- [x] **Step 1:** 为已确认差距写失败的 DOM 断言：书签初始文案不声称仅 EPUB；PDF 固定版面说明随格式切换显隐。顶部单一页码提示已有 Chromium 几何测试。
- [x] **Step 2:** 两项新断言均先以具体差距失败（旧 EPUB-only ARIA、缺少 PDF 说明）；既有书签格式能力和工具栏保护测试通过。
- [x] **Step 3:** 只调整初始书签 ARIA/title 与设置文案/CSS；PDF 页码继续由控制栏单一呈现，不添加重复进度文本。
- [x] **Step 4:** 新增/调整 DOM 回归 4 项通过，PDF 顶栏 Chromium 几何用例通过；EPUB 字体/行高现有覆盖在 Task 4 总回归复跑。响应式全面数据承接 Task 0 基线，后续 320/375/430/800/1100/1600px 用例将在 Task 4 再跑。

### Task 2：PDF 笔记从页级跳转改为尽可能回到标记原文

**Files:** Modify `app/ui/reader/notes-panel.js`，必要时 `app/ui/reader/pdf.js` 或 `app/ui/reader/pdf-annotation-geometry.js` 仅增加可复用的当前帧定位接口；Test `tests/pdf-annotations.test.js`, `tests/pdf-reader.test.js`, `e2e/pdf-reader.spec.js`, `e2e/reader.spec.js`。

**Interfaces:** Consumes existing `annotation.targets[]`, `pdfReaderController.goToPdfPage(pageIndex)`, `getRenderedPageGeometry(pageIndex)`, `pdfAnnotationGeometry.projectPdfAnnotationTarget(target, geometry)`；Produces `navigateToPdfAnnotation(annotation)` 在可用当前帧上把第一条有效 quad 滚动到阅读安全区并给短暂可见定位反馈。原有页级返回值/旧存储不变。

- [x] **Step 1:** 为页内定位、精确 quad、缺帧安全回退及切书代次保护加回归断言；目标页缺帧时保持页级返回并显示清晰提示。
- [x] **Step 2:** 新增断言先因当前仅翻到 PDF 页而失败；基线 PDF reader/annotation 相关 Node 测试 188 项通过。
- [x] **Step 3:** `navigateToPdfAnnotation()` 等待匹配 `bookId/generation/pageIndex` 的当前帧，通过现有 `projectPdfAnnotationTarget` 投影，并在 PDF 页内以 pointer-events:none 的短暂框提示定位；无有效帧保留页级，切书/换代取消。没有改变 PDF annotations 存储、页书签或 EPUB locator。
- [x] **Step 4:** Node PDF/DOM 测试通过；真实鼠标标注、放大后按最新 viewport 定位与编辑/删除 Chromium 用例 1/1 通过；PDF annotation/export 浏览器组 5/5 通过。EPUB locator 行为由 DOM 回归覆盖，完整 suite 留待 Task 4。

### Task 3：对齐选区动作、移动端与 AI 能力边界的表达

**Files:** Modify `app/ui/reader/selection-menu.js`, `app/ui/reader/ai.js`, `app/ui/reader/highlights.js`, `app/ui/reader/navigation.js`，仅在布局确有需要时改 `app/ui/index.html`/`app/ui/styles.css`；Test `tests/dom-regression.test.js`, `e2e/pdf-reader.spec.js`, `e2e/reader.spec.js`。

**Interfaces:** Consumes `currentAnnotationAdapter(format).captureSelection()`, `pdfAiScopeInput()`, existing mobile toolbar and PDF text-layer selection budget；Produces 两格式一致的复制/标记/想法/可用时问 AI 的菜单顺序、禁用解释和焦点返回。PDF AI 请求仍仅使用现有 `selection` 或 `searchable_book` 范围。

- [x] **Step 1:** 增加跨页/超过 1200 字 AI 限制说明、超过 4000 字的缩小选区提示、Escape 焦点返回测试，以及移动端选文后划线入口用例。
- [x] **Step 2:** 真实 Chromium 鼠标 PDF 选文、既有同页 AI 入口及移动设备模拟下的选文菜单均验证；此处不把 EPUB `Ctrl+H` 改接 PDF。
- [x] **Step 3:** 菜单保留可用复制/标记/想法动作，按限制隐藏 AI 动作并显示原因；移动端快捷划线按钮仍禁用，真实 PDF 选区菜单可划线。AI 服务端和 EPUB 提示词未改。
- [x] **Step 4:** DOM/PDF annotation 154 项通过；Chromium PDF 同页 AI、真实鼠标标注与手机选择菜单 3/3 通过。手机用 Chromium 模拟触摸事件及原生文本 Range 验证入口；真实设备长按、无文本 PDF NAS 验收仍列为设备待测。

### Task 4：共同功能回归与差异收口

**Files:** Modify only tests with reproducible gaps: `tests/dom-regression.test.js`, `tests/pdf-reader.test.js`, `tests/pdf-annotations.test.js`, `e2e/pdf-reader.spec.js`, `e2e/reader.spec.js`, `e2e/search.spec.js`；if a failing test exposes a regression, modify only its owning existing reader file; Update `docs/superpowers/progress/2026-09-27-pdf-epub-reader-parity-progress.md`。

**Interfaces:** Consumes Tasks 0–3's matrix and interfaces；Produces 每行“已对齐/格式合理差异/仍待设备验收”的最终记录，不产生新 API。

- [x] **Step 1:** 对每种格式按相同操作序列验收：开书 → 翻页/滚动 → 目录 → 搜索并返回命中 → 加/删书签 → 建/改/删标记 → 导出 → AI 来源跳转 → 返回书架/重开恢复。PDF 无 outline、无文字、来源过期单列预期提示；相关操作序列由 DOM、reader-core、PDF annotation/export、PDF/EPUB/search Chromium 用例覆盖。细项结果见 progress 矩阵。
- [x] **Step 2:** 全书 PDF AI 来源用例证实是真实逻辑缺陷，先写 renderer 未就绪回归再修复：全书 FTS 不再依赖 PDF.js 页数；PDF 选区仍校验页数。书签用例原失败是共享后端残留进度与 no-op 导航的夹具时序问题，复位为确定起点。未将 PDF 页级书签、EPUB 字体重排、图像型 PDF OCR 列为缺陷。
- [x] **Step 3:** Node 指定回归 282/282；完整 Chromium 106/107，唯一失败 AI composer 垂直对齐 8.796875px，Task 0 基线已有且与本计划无关；`npm run check:portable` 通过。实测结果与处理决定已记入 progress，未掩盖失败。
- [x] **Step 4:** fnOS NAS 与真实触屏设备本阶段不可访问，故明确记录为“待 NAS/真机验收”，不声称完全验收。自动化验收结论不替代设备验收；打包和安装仍由用户另行请求。

## 阶段顺序与发布判断

按 Task 0 → 1 → 2 → 3 → 4 顺序实施；每个 Task 的测试和人工检查通过后再进入下一 Task。Task 1 先消除误导文案和顶部反馈差异；Task 2 是 PDF 页内精确导航；Task 3 处理选区和移动端可达性；Task 4 只关掉剩余可复现差异。若 Task 0 发现共同功能存在新的数据契约冲突，暂停对应 Task，先在计划中补充格式适配决策与回滚条件。验收通过也不自动触发打包、安装、提交或合并。
