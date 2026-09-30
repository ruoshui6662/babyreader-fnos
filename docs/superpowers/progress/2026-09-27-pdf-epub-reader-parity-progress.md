# PDF 与 EPUB 阅读功能对齐进度

计划：`docs/superpowers/plans/2026-09-27-pdf-epub-reader-parity.md`

## 基线

- 执行基线：2026-09-27 当前工作区，分支 `main`，HEAD `578785fb5d47e57309fa65a38e482ba12e7cdf72`。开始时有 186 个已修改或未跟踪路径；不覆盖与本计划无关的内容。
- Task 0 已完成；Node 单测及浏览器基线和差异矩阵见下文。

## Task 0–4

| Task | 状态 | 结果/证据 |
| --- | --- | --- |
| Task 0：冻结共同能力与差异基线 | 完成 | Node 186/186 通过；Chromium 103 通过、3 失败（2 项 PDF AI/书签基线、1 项既有 AI composer 对齐），已记录，不把无关失败归因于本轮。视口 1600/1100/800/430/375/320px 的 PDF 工具栏几何断言通过。 |
| Task 1：统一入口、状态反馈和设置说明 | 完成 | 新增 DOM 断言先 RED 后 GREEN（4/4 目标用例通过）；PDF 桌面顶栏几何用例 Chromium 1/1 通过。修正静态书签辅助标签并增加 PDF 固定版面设置提示；没有增加重复页码状态。 |
| Task 2：PDF 笔记精确定位 | 完成 | RED 后 GREEN；188 项 DOM/PDF reader/annotation Node 测试通过；PDF annotation/export Chromium 5/5 通过，缩放后真实标注定位及编辑流程 1/1 通过。定位按当前 bookId/generation/pageIndex/frame 投影 quad；无当前几何安全降级到页级并提示，切书取消。存储契约未变。 |
| Task 3：选区、移动端与 AI 能力提示 | 完成 | 新增提示/焦点测试；DOM/PDF annotation 154/154 通过；同页 PDF AI、真实鼠标选文标注及手机模拟触摸选文 3/3 Chromium 通过。AI 服务端、EPUB 快捷键/提示词、PDF 资源预算不变。 |
| Task 4：共同功能回归与差异收口 | 完成（NAS 实机待验收） | Node 282/282 通过；Chromium 106/107 通过。PDF 全书 AI 页码来源缺失已确认为渲染器就绪门槛错误并修复；书签 E2E 共享进度造成“不发生变化就不保存”的测试夹具问题已加确定性复位并通过全套复测。剩余 1 项 AI composer 几何断言差 8.8px，Task 0 基线已存在、与本计划无关，未修改。`npm run check:portable` 通过。 |

## 未覆盖验收

- fnOS NAS 实机与真实触屏设备验收尚未进行；完成前持续标记待验收。

## Task 0 验收矩阵

| 共同能力 | EPUB 操作/预期 | PDF 操作/预期 | 当前结果与自动化证据 |
| --- | --- | --- | --- |
| 目录 | 打开共同目录抽屉，nav/NCX 项定位章节 | 打开共同目录抽屉，outline 项定位页；无 outline 显示空态 | DOM/Chromium 现有目录与空态用例通过；PDF 具体覆盖 `e2e/pdf-reader.spec.js` 目录测试组 |
| 书签 | 顶栏新增/取消语义位置书签，列表回章节 | 同入口新增/取消页级书签，列表回页 | `tests/reader-core.test.js` PDF locator 单测通过；书签保存/恢复/删除浏览器用例通过。E2E 启动时只在进度非第 1 页时复位，避免共享服务端状态造成无变化导航不发保存请求 |
| 搜索 | 全书本地 FTS，精确跳到命中且保留搜索面板 | 全书本地 FTS，按页/可确认文字定位 | `e2e/search.spec.js` 全组通过；PDF 搜索定位用例通过 |
| 标记/想法 | 选文建标记/想法、颜色及列表回原文 | 文本层选区建标记/想法、归一化几何位置 | `tests/pdf-annotations.test.js` 和 PDF 鼠标选区/标注用例通过；Task 2 精确位置仍待实现 |
| 导出 | 从共同标记面板导出 | 相同入口导出 PDF 标记 | PDF 导出用例及 `tests/pdf-notes-export.test.js` 通过 |
| AI 问书 | EPUB 全书/章节证据与章节来源 | PDF 可检索全文或受限选区、来源页码 | PDF 全书搜索与可信页码来源浏览器用例通过；`pdfAiScopeInput()` 不再让全书范围等待 PDF.js 页面计数，renderer 尚未 ready 时全书检索也可发送。选区范围仍需页面几何 |
| 阅读模式/外观 | 连续滚动/双页分页，字体、字号、行高等影响重排 | 连续/单页/双页及缩放、适宽，固定原页版面 | PDF 响应式工具栏及布局设置用例通过；窄屏双页回退已覆盖；不适用 EPUB 排版参数 |
| 进度 | 章节/语义位置保存和重开恢复 | 页码保存和恢复 | Node 阅读器/PDF 进度单测通过；PDF 阅读进度刷新恢复及页书签保存/恢复浏览器用例通过 |

## Task 4 复核与验收

- 全书 PDF AI 来源标签缺失是真实逻辑缺陷：`pdfAiScopeInput()` 原先无论搜索范围如何都等待 PDF.js `getPageCount()`。页面渲染器未 ready 时，即使服务端全文 FTS 已可用也会返回空范围。现将 renderer 页数校验限制在页内选区路径；增加“renderer 尚未 ready 仍允许全书 AI”的 DOM 回归，并验证 PDF AI 来源/导航 Chromium 用例。
- PDF 书签等待失败来自 E2E 共享后端保留 fixture 阅读进度：如果测试进入时已在第 3 页，再输入第 3 页属于 no-op，不会产生 progress PUT。测试现读取当前页，仅在非第 1 页时复位，然后验证第 3 页保存；书签测试隔离通过，全套 Chromium 中也通过。
- Node 最终回归：`node --test --test-concurrency=1 tests/dom-regression.test.js tests/reader-core.test.js tests/pdf-reader.test.js tests/pdf-annotations.test.js tests/pdf-notes-export.test.js tests/book-search.test.js tests/pdf-ai-api.test.js`，282/282 通过。
- Chromium 最终回归：`npx playwright test e2e/pdf-reader.spec.js e2e/reader.spec.js e2e/search.spec.js --project=chromium`，106/107 通过。唯一失败是 `e2e/reader.spec.js:1506` AI composer 发送按钮与输入框中心差 8.796875px；同一断言已在 Task 0 基线失败，与 PDF/EPUB 对齐范围无关，保留为既有项，未改生产 UI 或放宽断言。
- `npm run check:portable`：通过（61 个必需文件、9 个生命周期脚本；Windows 跳过 POSIX shell 语法检查）。
- 设备验收：fnOS NAS、真实触屏未在本轮访问；待用已授权目录里的 EPUB、文本型 PDF、图像型合成 PDF 进行人工验收。Chromium 模拟不等同真机触摸/NAS 验收。
