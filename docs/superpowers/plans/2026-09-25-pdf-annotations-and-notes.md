# PDF 划线与笔记（P3.2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes planning only; implementation starts on a later user request.

**Goal:** 让可选择文字的 PDF 拥有与 EPUB 一致的划线、想法、编辑、列表与定位体验，同时保持 PDF 原文件、EPUB 标注及阅读链路稳定。

**Architecture:** 共用现有选择菜单、编辑器、配色和「标记与想法」抽屉；以格式适配器分别处理 EPUB 的章节 DOM/CFI 和 PDF 的页内坐标。PDF 标注单独存放在按 UID、bookId 隔离的 `pdfAnnotations` 字段中，由原有原子 JSON 写入队列保存。PDF.js 继续只负责渲染和文本层，标记绘制在每页自己的覆盖层，不写入 PDF 文件。

**Tech Stack:** Node.js 22、现有 CommonJS 服务和原生浏览器 JavaScript、已锁定的 `pdfjs-dist@6.3.289`、`node:test`/happy-dom、Playwright Chromium、现有 fnOS FPK 流程。

**Spec:** `docs/superpowers/plans/2026-09-25-pdf-reader-quality-roadmap.md` 的 P3.2 节；本计划的「冻结的数据与交互契约」将前一轮代码审查和开源调研落成可执行约束。

## Global Constraints

- 当前 `main` 工作区包含大量用户原有的已修改/未跟踪文件，PDF 控制器本身尚未跟踪。执行时先记录精确路径基线，保留所有已有内容；不得重置、清理、批量格式化或自动提交。FPK 构建、NAS 安装/重启另按用户请求进行。
- 保持现有 fnOS 网关 UID、授权目录复核、PDF 开关、同源 Range、CSP、FTS、PDF.js 本地资源、EPUB/TXT 行为及 PDF 书签 `{version:1,type:'pdf',pageIndex}` 契约。
- 沿用服务器 `readJsonBody` 的 **2 MiB** 请求上限。P3.2 的 PDF 标注集合另外限制为单书 **1 MiB UTF-8 JSON**、**500 条**；单条最多 **8 页、512 个四边形、4000 字引文、4000 字想法**。超限返回明确错误，不截断坐标或静默丢条目；这些是首版保守预算，需在设备上复核。
- `pageIndex` 以 0 开始且只能是 `0..9999` 的整数；页面几何是 PDF 原始页面坐标的归一化四角点，每个坐标为 `0..1` 的有限数，存储前量化至 6 位小数。实际页数由已打开 PDF 控制器在客户端再次检查。
- PDF 每页标注只随当前书籍、代次、缩放、旋转和已渲染页面重投影；失效页面、文本层缺失、文件扫描指纹改变时不猜测文字位置，不把旧标记贴到新内容上。
- 创建标注必须来自可验证的 PDF 文本层选区；图片型 PDF 不自动 OCR。后续 AI、手写、图像区域批注及 PDF 原文件导出不属于本任务。

## Review Focus

1. 多栏、重复词、跨 Span/跨行/跨页文本：保存与恢复必须是选中的多段区域，不得变成整页或跨栏的大蓝块；Task 2、3、5 用真实指针测试。
2. 90°/180°/270° 旋转、50%–200% 缩放、单/双页和横竖屏：同一标记保持在原文上；Task 2、3、5 用几何断言和浏览器测试。
3. 页面虚拟化、取消中的渲染、快速切书及同路径替换 PDF：不能绘制旧代次标注，旧来源只在列表显示「原文已变化」；Task 1、3、5 测试。
4. 同一用户多标签页并发、不同 UID、原子写入失败、请求超 2 MiB：不得覆盖别人的标记或把未保存状态显示为已保存；Task 1、4、5 测试。
5. EPUB/TXT 原有划线、想法、导出、搜索、书签和选区颜色：PDF 的新增菜单/样式不得改变它们；Task 4、5 回归。

## 冻结的数据与交互契约

现状依据：`selection-menu.js` 只捕获 `.epub-chapter`；`highlights.js` 的 `serializeDomRange`、`rangeFromHighlight` 和 `drawHighlightRects` 都依赖 EPUB 的章节 DOM；`notes-panel.js` 仅能跳 EPUB 章节；`actions.js:queueHighlightSave` 对非 EPUB 直接返回；`storage.js:replaceHighlights` 整组替换并仅保留 EPUB 字段。PDF 控制器的每页结构是 `.pdf-page > canvas + .pdf-page-text-layer`，文本层在缩放时重建。**不得把 PDF 记录写入既有 `highlights` 数组或调用既有 `replaceHighlights`。**

PDF 存储记录采用以下判别格式。`bookId` 是外层用户书籍键，不重复写入记录。`sourceFingerprint` 使用已扫描书籍的 `fingerprint`（当前实现按路径、大小、修改时间计算）；它是版本提示而非内容哈希。`targets` 为有序页面片段，每个四边形的 8 个数字按左上、右上、右下、左下的 PDF 页面坐标顺序保存：

```js
{
  version: 1,
  type: 'pdf',
  id: 'UUID',
  sourceFingerprint: '<indexed fingerprint>',
  kind: 'highlight',             // highlight | thought
  style: 'marker',               // marker | wave | line | none
  color: 'yellow',               // yellow | green | blue | pink
  text: '选中文本',
  contextBefore: '有限前文',
  contextAfter: '有限后文',
  thought: '',
  targets: [
    { pageIndex: 2, quads: [[x1,y1,x2,y2,x3,y3,x4,y4]] }
  ],
  createdAt: '<server ISO time>',
  updatedAt: '<server ISO time>'
}
```

共享的**视图模型**只包含 `id/format/kind/style/color/text/thought/locationLabel/updatedAt/stale`。EPUB 旧记录只在读取时投影成该视图模型，原 JSON、CFI、DOM Range、API 和导出格式不迁移。PDF 的原始坐标、引文和来源指纹留在 PDF 适配器中；共同 UI 不解析任何格式的定位器。后续 AI 等动作按 `format + capability` 控制入口，不显示不可执行的占位按钮。

选择文字后继续使用「复制、马克笔、波浪线、直线、写想法」的现有菜单、四种颜色、标注编辑框和「全部／标记／想法」筛选。PDF 列表显示页码，点击定位到第一个片段的原页；编辑颜色/样式/想法，删除按 ID。PDF 的 EPUB 专属 AI 动作暂不开放；导出 PDF 标记为独立后续能力，保留现有工具栏位置和抽屉结构。

## File Structure and Ownership

| 路径 | 单一职责 |
| --- | --- |
| `app/server/pdf-annotation-contract.js`（新） | 校验/规范化 PDF 标注和更新白名单、大小与坐标预算。 |
| `app/server/storage.js` | 在现有 UID 队列和 `reading-state.json` 中增删改查 `books[bookId].pdfAnnotations`；不碰 `highlights`。 |
| `app/server/index.js`、`app/server/library.js` | PDF 专属 API，复用 `findBook`、PDF 开关和 `fingerprintBook` 对授权文件做来源版本校验。 |
| `app/ui/reader/pdf-annotation-geometry.js`（新） | PDF 文本选区分页、逐行矩形→原页坐标，以及逆向重投影；不做网络或 UI。 |
| `app/ui/reader/pdf-annotations.js`（新） | PDF 标注会话、API 同步、当前页覆盖层、点击/列表定位及生命周期。 |
| `app/ui/reader/pdf.js` | 提供已渲染页的只读几何上下文和帧提交/撤销通知，保持当前渲染代次约束。 |
| `app/ui/reader/selection-menu.js`、`app/ui/reader/highlights.js` | 按格式捕获选区并分发动作；共用编辑器及按钮状态，不修改 EPUB 的定位算法。 |
| `app/ui/reader/notes-panel.js`、`app/ui/shell/drawer.js` | 共用列表与抽屉，格式适配器提供页码/章节标签和导航。 |
| `app/ui/core/api.js`、`app/ui/core/user-state.js`、`app/ui/index.html`、`app/ui/styles.css` | PDF API 和书籍状态、脚本加载、语义色及每页覆盖层样式。 |
| `tests/pdf-annotations.test.js`（新）、`tests/reader-core.test.js`、`tests/dom-regression.test.js`、`e2e/pdf-reader.spec.js` | 几何/预算/UID/API、共用 UI 及真实浏览器回归。 |
| `docs/superpowers/progress/2026-09-25-pdf-annotations-progress.md` | 每阶段记录 RED→GREEN 命令、结果、裁决、遗留真机证据。 |

---

### Task 0：冻结基线与失效语义

**Files:** Read `app/server/library.js`, `app/server/index.js`, `app/server/storage.js`, `app/ui/reader/pdf.js`, EPUB 标注相关文件；Update `docs/superpowers/progress/2026-09-25-pdf-annotations-progress.md`。

**Interfaces:** Consumes 当前 `bookId=hash(absolutePath)`、`fingerprint=hash(path,size,mtime)`、PDF `getCurrentBookId/getCurrentPageIndex/getPageCount/getGeneration`。Produces 后续任务使用的字段清单和测试基线。

- [x] **Step 1:** 记录 `git status --short` 中上述精确路径的既有更改；用 `git diff --` 检查重叠 tracked 文件，未跟踪的 PDF 源码只读记录大小/哈希。
- [x] **Step 2:** 跑 `node --test tests/reader-core.test.js tests/dom-regression.test.js tests/pdf-reader.test.js`、`npx playwright test e2e/pdf-reader.spec.js --project=chromium`、`npm run check:portable`；在进度文件记录完整计数与跳过原因。Expected：若现有基线失败，先记录原因，不归因于 P3.2。
- [x] **Step 3:** 固定同路径换文件的行为：保留侧车记录并在列表提示「原文已变化」；覆盖层和精准跳转停止，用户仍可删除旧条目。对来源未变化但暂缺文本层的页，保留几何覆盖层并提示引文暂不可核验。

### Task 1：隔离的 PDF 标注存储与 API

**Files:** Create `app/server/pdf-annotation-contract.js`; Modify `app/server/storage.js`, `app/server/index.js`, `app/server/library.js`; Test `tests/reader-core.test.js`, `tests/pdf-content-api.test.js`。

**Interfaces:** Produces `normalizePdfAnnotationCreate(input, sourceFingerprint)`、`normalizePdfAnnotationEdit(input)`；`storage.listPdfAnnotations(uid,bookId)`、`createPdfAnnotation(uid,bookId,input,fingerprint)`、`updatePdfAnnotation(uid,bookId,id,patch)`、`deletePdfAnnotation(uid,bookId,id)`。API：`GET/POST /api/books/:id/pdf-annotations`，`PATCH/DELETE /api/books/:id/pdf-annotations/:annotationId`。Client receives full sanitized records and a `sourceStale` view flag; storage keeps original fingerprint unchanged.

- [x] **Step 1 (RED):** 单测先断言 UID A/B 隔离、`highlights` 与 `pdfAnnotations` 互不覆盖、同 UUID 相同内容重试幂等而冲突内容返回 409、PATCH 只能改 `style/color/thought`（`kind` 在创建时固定）、DELETE 按 ID。执行 `node --test tests/reader-core.test.js`；Expected：新方法不存在而失败。
- [x] **Step 2 (RED):** API 测试覆盖非 PDF 书籍、PDF 开关关闭、撤销授权、路径变更或当前文件指纹不同、无效页索引、NaN/Infinity/越界坐标、退化四边形、重复页、超过 8 页/512 quad/500 条/1 MiB、请求 >2 MiB。执行 `node --test tests/pdf-content-api.test.js`；Expected：新端点不存在而失败。
- [x] **Step 3 (GREEN):** 纯校验器返回白名单字段。示例：`normalizePdfAnnotationCreate({version:1,type:'pdf',id,kind:'highlight',style:'marker',color:'yellow',text:'一句话',thought:'',targets:[{pageIndex:0,quads:[[.1,.2,.2,.2,.2,.23,.1,.23]]}]}, fingerprint)`；用 `Buffer.byteLength(JSON.stringify(nextCollection),'utf8') <= 1048576` 作为集合预算。拒绝任何非法字段/几何，不沿用 EPUB 的 `chapterHref`。
- [x] **Step 4 (GREEN):** 所有增删改在现有 `mutateUserState(uid, …)` 队列内读最新集合并原子写入。API 调用 `findBook` 后强制 `type==='pdf'`、PDF 开关、授权路径复核及 no-follow 文件 stat；当前文件与索引指纹不一致时拒绝创建/编辑并提示重扫。重扫后 GET 仍返回旧记录供用户查看/删除，由服务端标记 `sourceStale`；旧记录的 PATCH 拒绝，按 ID DELETE 允许以便清理，不重写旧 `sourceFingerprint`。POST 的 `sourceFingerprint` 只由服务端当前书籍确定，不信任客户端传值。
- [x] **Step 5:** 重跑上述两组测试、`npm run check:portable` 和 `git diff --check`；Expected：新增失败用例转绿，旧 EPUB/书签断言不变。在进度文件记录实际输出，不自动提交。

### Task 2：PDF 文本选择与持久化几何

**Files:** Create `app/ui/reader/pdf-annotation-geometry.js`; Modify `app/ui/reader/pdf.js`, `app/ui/index.html`, `scripts/validate-structure.js`, `scripts/write-build-provenance.py`, `scripts/fnos-device-acceptance.sh`; Test `tests/pdf-annotations.test.js`, `tests/pdf-reader.test.js`。

**Interfaces:** Produces `capturePdfAnnotationSelection(selection, getRenderedPageGeometry)` → `{text,contextBefore,contextAfter,targets,anchor,bookId,generation}` or `null`；`projectPdfAnnotationTarget(target, pageGeometry)` → 当前页像素四边形。PDF 控制器提供 `getRenderedPageGeometry(pageIndex)` → `{bookId,generation,pageIndex,pageElement,pageView,viewport,scale}` or `null`；仅返回仍属当前书籍和代次的已渲染页。

- [x] **Step 1 (RED):** 用合成跨 Span/多行/两页 Range 写测试，断言每页分拆、每行独立 quad，`text` 不含相邻栏的文字；非法或跨到非 PDF 区域的 Range 返回 `null`。执行 `node --test tests/pdf-annotations.test.js`；Expected：新模块不存在而失败。
- [x] **Step 2 (RED):** 对 0°/90°/180°/270° 和 50%/100%/200% viewport 写逆变换测试；同一 PDF quad 往返误差 ≤0.5 CSS px，坐标从未为 NaN、负数或超过 1。执行同一命令；Expected：转换函数不存在而失败。
- [x] **Step 3 (GREEN):** 按 `.pdf-page-text-layer` 把 DOM Range 截成每页子 Range，逐页 `getClientRects()`、过滤空/重叠块，并相对该页 viewport 将四角通过 PDF.js `convertToPdfPoint` 转为 PDF page.view 归一化坐标。使用现有 `MAX_PDF_SELECTION_PAGES=8` 的限制，再检查 512 quad 和文本 4000 字预算；冻结会话的 `bookId/generation`，点击保存前复核。
- [x] **Step 4:** 反向投影到当前 viewport；验证双页右页的 `pageIndex` 不会被布局行号替代。运行 `node --test tests/pdf-annotations.test.js tests/pdf-reader.test.js`；Expected：新几何/旧翻页测试通过。失败时不新增全文匹配降级。

### Task 3：每页覆盖层与渲染生命周期

**Files:** Create `app/ui/reader/pdf-annotations.js`; Modify `app/ui/reader/pdf.js`, `app/ui/styles.css`, `app/ui/index.html`, `scripts/validate-structure.js`, `scripts/write-build-provenance.py`, `scripts/fnos-device-acceptance.sh`; Test `tests/pdf-annotations.test.js`, `e2e/pdf-reader.spec.js`。

**Interfaces:** Consumes Task 2 `projectPdfAnnotationTarget`；Produces `renderPdfAnnotationPage({bookId,generation,pageIndex,scale})`、`clearPdfAnnotationSurface()`。PDF 控制器在有效 Canvas+文本层帧提交后通知当前页，在页驱逐/切书时通知撤销；可见页+邻页以外不绘制、不固定 Canvas。

- [x] **Step 1 (RED):** DOM 测试先因覆盖层模块不存在而失败；随后验证 Canvas/textLayer 同页兄弟关系、隔离页绘制、页面回收、切书和过期 generation/scale 结果拒绝。执行 `node --test tests/pdf-annotations.test.js`。
- [x] **Step 2 (RED):** Chromium 真实指针测试先因覆盖层不存在而失败；GREEN 场景跨两行拖选并清除浏览器选区，确认 Canvas 字形数据不变、可重复选取、缩放后几何对齐、虚拟化回收与返回书库清理。执行 `npx playwright test e2e/pdf-reader.spec.js --project=chromium --grep "PDF annotation"`。
- [x] **Step 3 (GREEN):** `.pdf-page` 内独立 `.pdf-annotation-layer`，`pointer-events:none` 且绘制于 PDF Canvas 与文字层之间；线/波浪/半透明马克笔用 PDF 标注语义色，未改 `.pdf-page-text-layer::selection`。本任务不实现菜单/编辑/抽屉控制点（归 Task 4）。
- [x] **Step 4:** 按书籍 ID、代次、来源指纹、页号和缩放上下文过滤/丢弃过期帧；来源已失效的记录不绘制；缩放只按当前 viewport 重投影，不改保存的 quads；文字层不可用时仍按已验证来源几何绘制。`node --test tests/pdf-annotations.test.js tests/pdf-reader.test.js`：34/34；完整 `npm test`：404 总计、397 通过、0 失败、7 环境跳过；PDF Chromium E2E：28/28；portable 结构校验：51 文件、9 生命周期脚本；JS 语法与 `git diff --check` 通过。

### Task 4：共用 EPUB 风格的菜单、编辑器与列表

**Files:** Modify `app/ui/reader/selection-menu.js`, `app/ui/reader/highlights.js`, `app/ui/reader/notes-panel.js`, `app/ui/shell/drawer.js`, `app/ui/core/api.js`, `app/ui/core/user-state.js`, `app/ui/index.html`, `app/ui/styles.css`; Test `tests/dom-regression.test.js`, `e2e/pdf-reader.spec.js`, `e2e/reader.spec.js`。

**Interfaces:** Consumes Task 1 PDF API、Task 2 选择会话、Task 3 页面覆盖层。Produces `annotationViewModel(record, format)` 统一列表呈现，以及 `currentAnnotationAdapter(state.contentType)` 返回 `captureSelection/create/edit/remove/navigate/list`；`notes-panel.js` 只消费适配器的 `list` 和视图模型，不直接解析 PDF 坐标或 EPUB CFI。EPUB 适配器仍调用原有 `loadHighlights/queueHighlightSave/navigateToAnnotation`，不改变它们的读写契约。

- [x] **Step 1 (RED):** DOM 测试 PDF 有选区时显示「复制/马克笔/波浪线/直线/写想法」；PDF 无选区、无文本层和书籍切换时不生成记录；EPUB 原菜单及既有 AI 动作不变。执行 `node --test tests/dom-regression.test.js`；PDF 列表/API 的新断言起初失败，随后真实鼠标选区浏览器测试暴露并修复了 PDF 上误显示 AI 动作；无效选区沿用 Task 2 几何测试，切书写入由本阶段 DOM 测试覆盖。
- [x] **Step 2 (RED):** 测试 PDF 抽屉显示页码、全部/标记/想法筛选、按页/时间排序；点击条目跳到第一个有效 `pageIndex`；来源过期只显示提示和删除按钮，不执行精确跳转。编辑框改色、换样式、写/删想法、删除按 ID，失败提示保持草稿。PDF 抽屉新断言起初失败，随后 DOM 和 Chromium 用例转绿。
- [x] **Step 3 (GREEN):** 选择菜单调用按格式的 `captureSelection` 和 `create`；共用编辑器只修改 `style/color/thought`，记录类型 `kind` 创建后不变，定位交给对应适配器。保留 EPUB 旧记录和原导出函数，PDF 抽屉启用；桌面/移动工具栏能力标识保持一致，未开放的 AI/导出动作不显示为可用。
- [x] **Step 4:** API `get/create/update/deletePdfAnnotation` 返回服务器规范化记录；成功后更新当前书籍缓存，失败不覆盖服务器数据。只更新 PDF `pdfAnnotations`，不调用 EPUB 的 whole-array PUT。DOM、PDF/EPUB Chromium 专项及结构检查通过；准确计数和设备边界见进度文档。

### Task 5：全链路、设备前检查与交付记录

**Files:** Modify `e2e/pdf-reader.spec.js`, `tests/pdf-annotations.test.js`, `tests/reader-core.test.js`, `tests/dom-regression.test.js`; Update `docs/superpowers/progress/2026-09-25-pdf-annotations-progress.md`。

**Interfaces:** Consumes Task 1–4 的稳定接口；Produces 本地可审阅的测试/风险记录。此任务不自动打包或安装。

- [x] **Step 1 (RED→GREEN):** 浏览器测试依次创建→刷新→重开→列表定位→编辑→删除；覆盖双页右页、多栏重复文本、真实鼠标拖选、快速缩放/切书、过期来源、图像型 PDF 无文字、窄屏工具栏与深浅主题。刷新恢复断言先因目标缺陷失败再转绿；新增的既有契约保护用例初次即通过，夹具/测试时序失败另见进度记录。合成与模拟覆盖边界及未做的实机视觉检查见进度记录。
- [x] **Step 2:** API/存储测试覆盖两 UID、同用户两标签页并发 CRUD、字段白名单、配额、写入失败和 EPUB 全量保存不改变 `pdfAnnotations`；设备模拟不得复用用户书籍、Cookie 或绝对 NAS 路径。两标签由交错存储调用模拟，真实浏览器双标签留 fnOS 手工验收。
- [x] **Step 3:** 运行 `npm test`、`npx playwright test --project=chromium`、`npm run check:portable`、`git diff --check`；记录总数/跳过/失败和变更路径。对实机多栏 PDF 的视觉/选区问题仍单列手工验收，不以合成样本代替。
- [x] **Step 4:** 复查本计划的五项 Review Focus；逐项标记证据与未覆盖条件。写进度文件：每任务的日期、RED→GREEN 命令、接口裁决、失败复盘及剩余 fnOS 验收，不把本地通过写成设备通过。
- [ ] **Step 5:** 用户另行要求打包时才使用新 `dist-fpk-*` 隔离目录；验包须含 PDF 标注模块、UI、锁定的 PDF.js/许可证且不含用户书籍。NAS 升级后验证 UID、刷新恢复、多栏与跨页选择、旋转/缩放、来源替换和 EPUB 回归，记录包 SHA-256 与设备结果。

## 开源参考与本地取舍

- [Mozilla PDF.js Viewer/文本层](https://github.com/mozilla/pdf.js)：保留 Canvas/文本层分层和 viewport 转换；不把完整 Viewer 或它的编辑器接入 BabyReader，也不写回原 PDF。实际 API 对照本地锁定的 6.3.289。
- [react-pdf-highlighter 的 `PdfHighlighter.tsx`](https://github.com/agentcooper/react-pdf-highlighter/blob/main/src/components/PdfHighlighter.tsx)：参考逐页选区、多矩形位置和 viewport ↔ scaled 坐标转换；不引入 React 运行时。
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)：引文及前后文只用于恢复/校验，几何和来源版本是 PDF 的主锚点；限制复制长度，避免大段原文进入用户状态。
