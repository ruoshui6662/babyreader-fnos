# PDF 阅读器质量与后续功能路线图

日期：2026-09-25；2026-09-26 更新后续路线。状态：P0–P2、P3.1 页书签、P3.2 划线与笔记、Task 7 阅读体验已完成本地实现与自动化回归，实际设备验收范围分别以进度文件为准。用户已反馈 PDF 封面、单/双栏及缩放正常；这只确认所测场景，不等同于 444 页大文件、旋转页、长时内存、不同设备/用户均已验收。P3.3 笔记导出与 P3.4 PDF AI 问书列入后续规划，**尚未实施或授权实施**。

## 目标和现有契约

BabyReader 继续使用本地锁定版本的 PDF.js 6.3.289：Canvas 负责显示 PDF 原貌，透明文本层负责选择与搜索定位，书库授权、用户身份、阅读状态和本地 FTS 由 BabyReader 负责。保持当前 EPUB/TXT 阅读路径、PDF 页索引从 0 开始的 API/存储语义，以及现有的 PDF 开关。现有 PDF 阅读支持扫描和授权读取、Range 加载、连续/单页/双页、翻页和缩放、目录、按用户恢复页码、可提取文本的本地全文搜索、页级书签及 PDF 划线/笔记。PDF 笔记导出、AI 问书、OCR 和 PDF 内链接交互尚未实施。

本轮遮字回归的直接原因：`app/ui/styles.css` 把 PDF 文本层的 `::selection` 字色改为透明，选区底色却继承不透明的 `--selection-bg`。下层 Canvas 字形被实色矩形盖住。修正为基于该语义色的 28% 不透明度，并让 `br::selection` 透明。`e2e/pdf-reader.spec.js` 以真实 Chromium 读取选区背景 alpha：修复前为 1、修复后在 0.15–0.4 内；同时保持文本层选中字符和跨缓冲区选择不丢失。此本地验证不能替代用户所示多栏 PDF 的 NAS 实机验收。

## 开源实现取舍

| 来源 | 已核实机制 | BabyReader 的决定 |
| --- | --- | --- |
| [Mozilla PDF.js 文本层 CSS](https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.css) | 文本层的选区前景透明、背景半透明；`br::selection` 透明，避免 Chrome 多余选区。 | 复用层次关系与透明度原则；继续使用项目语义蓝色，不直接复制整份 Viewer CSS。升级 PDF.js 时重新对照对应版本。 |
| [Mozilla PDF.js 页面视图](https://github.com/mozilla/pdf.js/blob/master/web/pdf_page_view.js) | Canvas、文本层、注释层分层；重绘时可保留文本层，渲染任务有取消和状态管理。 | 维持独立层与生命周期；缩放、切书、滚动时检查选区、位图和文本层是否一致。暂不直接接入完整 Viewer。 |
| [Mozilla PDF.js 查找控制器](https://github.com/mozilla/pdf.js/blob/master/web/pdf_find_controller.js) | 页内匹配和当前命中独立管理；查找输入可延迟处理。 | 现有本地 FTS 继续承担全书搜索；只借鉴页内命中状态和定位验证，不重复构建全书索引。 |
| [React-PDF 文本层样式与渲染](https://github.com/wojtekmaj/react-pdf/blob/main/packages/react-pdf/src/Page/TextLayer.css)、[组件](https://github.com/wojtekmaj/react-pdf/blob/main/packages/react-pdf/src/Page/TextLayer.tsx) | 选区背景半透明；文本层随当前 viewport 渲染，异步任务可取消。 | 用作第二份对照；不引入 React 或替换现有无框架 UI。 |
| [react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter/blob/main/src/components/PdfHighlighter.tsx) | 选中文本后提取 Range 矩形，换算为页面坐标，再显示独立标注层。 | 若以后支持 PDF 划线，仅借鉴坐标变换与独立覆盖层；先定用户隔离的侧车存储和定位迁移，不写回原 PDF。 |

上游 `master/main` 代表调研时实现，不保证与已锁定的 PDF.js 6.3.289 接口逐行兼容；实现阶段必须再核对本地 vendor 构件和许可证。

## 阶段与验收门

### P0：恢复可读选区与发布验收（本轮代码已做，设备验收待做）

1. 保持 Canvas 字形可见，选区蓝色半透明，文字层前景透明；`br` 不形成蓝块。覆盖浅色、暗色、不同缩放、多栏中文和英文混排。
2. 在真实浏览器用鼠标从上到下、跨栏及跨页拖选，复制结果与可见内容一致；滚动期间选区不丢失，收起选区后页面缓存可回收。
3. 将最新构建安装到 fnOS 后，用用户提供的多栏 PDF 复现截图位置；检查选中前/中/后的相同字形、文字对比度、浏览器刷新和控制台。失败时回退该 CSS 规则，不变更书籍或索引数据。验收候选：`dist-fpk-20260925-pdf-quality-acceptance/babyreader-fnos.fpk`；SHA-256 `638bf492a7793f65da47ec7a0ad1f46d4c044159b8f5854cd862033eec4f633d`。该包来自 dirty 工作树快照，安装前应确认纳入的其他未提交功能符合预期。

### P1：文本层与滚动/缩放生命周期

1. 给 Canvas、文本层、搜索命中层明确同一 viewport/scale/generation 契约；仅在新一帧完成后换入位图与对应文本层，避免闪黑、闪字和错位。
2. 当前 `selectionIntersectsTextLayer` 会暂留活动选区经过的已渲染页。评估长距离跨页拖选的缓存增长；设计页数/内存上限和温和退出提示，确保不让 10,000 页文档把所有 Canvas 固定在内存。
3. 横竖屏、窗口窄宽、适宽/手动缩放、双页/单页切换后恢复同一页位置；标题与控件保持可点击。所有缩放响应必须取消过期渲染，不污染新书的页面。
4. 增加真实指针 E2E：选区、滚动虚拟化、清除后缩放重选；核对 DOM Selection 文本、背景 alpha 与页面几何。跨页缓存上限由单测覆盖。合成 PDF 用于自动化，多栏用户样本只做本地/实机人工验收，不提交仓库。**本地自动化完成；跨页持续拖动和多栏样本文档仍需人工验收。**

### P2：查找、目录与导航细节

1. 保持 FTS 服务端授权和每书索引；将页内命中、当前命中和滚动定位单独管理。搜索结果只在页内文本可确认时高亮具体词；无法确认时明确提示“仅定位到页面”。
2. 建立 PDF.js 文本层多 Span/换行/重复词的定位回归；搜索面板点击命中后保留，重复词依据片段定位。多栏、连字符、旋转页、混排文本真实样本仍需扩充/人工验收。**确定性自动化及既有双页命中通过。**
3. PDF 内部目录与内部链接只允许定位当前文档有效页；外部 URL/附件/动作维持关闭，若将来提供链接交互，先完成明确的可见提示、白名单策略和隔离验收。
4. 图像型 PDF 明确显示无可搜索文本，OCR 独立立项和资源预算，不把空检索结果解释为全书无相关内容。

### P3：可选的阅读能力（逐项另立任务）

1. PDF 书签：以 `{type:'pdf',pageIndex}` 和可选受限页内位置存入现有 UID 隔离数据；删除 PDF/索引时分别核对既有生命周期，不将书签混入 EPUB CFI。**P3.1 首版已完成：仅保存 `{version:1,type:'pdf',pageIndex}` 页级定位，不含页内位置。**
2. PDF 划线/笔记：持久化页索引、归一化页面矩形、有限文本引文和来源版本；缩放/旋转后重投影，丢失文本层时可显示位置但不伪造原文。存储为用户侧车数据，不修改原始 PDF。
   **P3.2 开发计划与进度基线：** `2026-09-25-pdf-annotations-and-notes.md`、`../progress/2026-09-25-pdf-annotations-progress.md`；Task 0–5 已完成本地实现和自动化回归，设备验收边界见进度文件。
3. **P3.3 PDF 笔记导出（下一功能阶段）：** 复用 EPUB 的 Markdown 下载交互和现有 PDF「标记与想法」列表，但单独把 PDF 标注按页码生成导出文本；不写回原 PDF，也不把 PDF 记录写入 EPUB `highlights`。
4. **P3.4 PDF AI 问书（P3.3 验收后）：** 复用已授权的逐页 FTS 与现有 AI 服务配置/会话外壳，建立 PDF 专用页引用与证据预算；不得沿用 EPUB 的“本章”解析。仅把明确检索并展示的有限文本片段发送给用户配置的供应商。无文本 PDF 不自动 OCR 或上传图片。
5. 辅助功能与键盘：工具栏焦点顺序、页码输入、搜索结果朗读、`prefers-reduced-motion`、文本层阅读顺序分别验收。PDF 画布本身不等同于可重排 HTML；不能承诺所有文档具备完整无障碍阅读顺序。

### P3.3：PDF 笔记导出——拟定契约与阶段门

详细实施计划：`2026-09-26-pdf-notes-export.md`；本地实现与自动化回归已完成，NAS 真机验收待做，见 `../progress/2026-09-26-pdf-notes-export-progress.md`。

- **现状/复用点：** `app/ui/reader/actions.js:exportHighlights()`、`formatHighlightsMd()` 和 `app/ui/reader/navigation.js` 的导出快捷键仅处理 EPUB；PDF 记录通过 `GET /api/books/:id/pdf-annotations` 按 UID 隔离，`annotationViewModel()` 已提供页码标签、引文、想法及来源失效状态。导出前应重新读取**当前 UID、当前书**的服务端记录，不能把另一书的旧 UI 缓存导出。
- **首版输出：** UTF-8 Markdown，书名标题、按原 PDF 0 基 `pageIndex + 1` 显示的页码小节、每条有限引文和想法；多页标记保留起止页，不重复导出一条记录。与 EPUB 相同的下载入口和文件名安全规则，但使用 PDF 独立格式化函数；明确“来源已变化”的旧记录，仍允许导出已保存的文字，不暗示可精确定位。导出范围首版为当前书全部笔记，当前筛选仅影响列表、不静默缩小文件；空书不生成空文件。
- **安全边界：** 不把标注坐标、UID、NAS 路径、API 密钥、PDF 原文整页或 PDF 二进制写入 Markdown；限定总条数/输出字节，按文本处理 Markdown 特殊字符与换行，防止引文冒充标题或注入链接；生成 Blob 后释放对象 URL，不上传到外部。API 无权/失败时不降级为未经核对的跨用户缓存。EPUB 导出内容、快捷键和存储协议保持原样。
- **实施节奏（另立详细计划，执行需再次确认）：** 先冻结导出字段和 Markdown 样例并写失败测试；再做纯格式化函数；最后接入按钮/快捷键和服务端刷新，跑 Node 格式/权限/上限测试、真实浏览器下载测试及 EPUB 导出回归。完成后用 NAS 上含双栏/跨页/旧来源标注的 PDF 验证文件内容、页码和可读性。

### P3.4：PDF AI 问书——拟定契约与阶段门

详细实施计划：`2026-09-26-pdf-ai-ask-book.md`（仅计划，未执行）。

- **现状/复用点：** `app/server/ai-fts.js` 已把可提取 PDF 文本按页建立 FTS，`book-search.js` 可返回页码和可用性；但 `app/server/index.js` 的 `/ai/search`、`/ai/ask/stream`、`/ai/ask` 仍对 PDF 返回 415，`app/ui/reader/ai.js` 也只开放 EPUB。不能仅删除这几处格式判断：现有 `resolveBookPosition`、章节摘要和 EPUB 上下文验证并不等于 PDF 章节识别。
- **首版问答范围：** 明确区分“所选文字”“当前页/指定页码范围”“本 PDF 可检索部分”；回答引用真实 `pageIndex + 1` 页码及有限证据片段，点击引用返回该页。首版**不提供“本章”语义**，除非日后另有经验证的 PDF 目录到正文页映射；用户问“本章”时要求确认页码范围，而不是猜。图像型、加密/损坏、文本提取被预算截断、索引过期或缺失时分别说明可用范围，不把“未检索到”说成“书中没有”。
- **成本与隐私：** 只在用户主动提问后构建/查询现有本地索引；优先当前页/所选文字，再用有界页片段检索，限制检索条数、单段字数、总输入 token/字符及输出长度；发送前维持现有供应商配置提示。服务端再次核对 fnOS UID、授权 bookId、PDF 开关、来源指纹和片段所属页；不得把整份 PDF、页面图片、无关书籍文本或 NAS 路径发给供应商。引用无法与索引页核对时拒绝伪造引用，并降级为“证据不足”。
- **实施节奏（单独 spec/计划并再次确认）：** Task 0 冻结页级证据/错误和费用预算；Task 1 建 PDF 检索适配器及索引完整性/来源测试；Task 2 接有界服务端问答、流式取消和用户隔离；Task 3 接现有 AI 面板的 PDF 能力提示与页码引用导航；Task 4 全回归、费用/延迟基线、NAS 真机验收。分别覆盖多栏重复词、跨页、无文字、截断大 PDF、错误页引用、切书/撤权、并发会话和 EPUB 既有章节问答。

**推荐顺序：** 先把本次用户确认的封面/单栏/双栏/缩放记录为有限设备反馈，并继续保留 Task 7 未完的长文档与长时资源门禁；随后优先实施风险较小的 P3.3 导出，再进入需独立来源与成本审查的 P3.4 AI。OCR、PDF 内链接、将笔记写回 PDF、自动整书摘要不夹带到这两阶段。

### Task 7：PDF 阅读体验优化（执行中）

实施计划：`2026-09-25-pdf-reading-experience-task7.md`。范围限定为渲染调度、页面帧一致性、长文档缓存、响应式顶部操作区、页内锚点、自然滚动、选择/搜索/标注联动和无障碍；不包含 OCR、表单、附件、外链、打印、原 PDF 写回或完整 Viewer 迁移。

## 安全与变更边界

- 继续只从授权书库 `bookId` 读取，保留 fnOS 网关身份验证、每次请求的路径复核、同源 Range、私有缓存与本地 PDF.js Worker；不引入任意 URL、CDN、PDF 脚本或原 PDF 写回。
- 保留现有 PDF 页数、Canvas 像素/边长、文本层字符数和服务端提取预算；调整缓存/选区策略前量化最差内存与取消行为。大文件测试不能用真实用户书籍提交仓库。
- PDF 的主题、按钮、抽屉样式复用现有语义变量；新增设置只在 PDF 模式显示，不改 EPUB/TXT 的分页、书签、划线、搜索和阅读进度契约。
- 每阶段先用针对性自动化复现，再在浏览器检查真实指针和可视对比；涉及授权、数据格式或新存储时另设 API/UID 隔离测试。仅在具体功能需求明确后实施 P1–P3；发布另需 FPK 内容核验与 fnOS 设备验收。

## 相关本地文件

- 阅读渲染与选区缓存：`app/ui/reader/pdf.js`；PDF 选区视觉：`app/ui/styles.css`。
- 页内搜索定位：`app/ui/reader/search.js`；FTS 与有界提取：`app/server/ai-fts.js`、`app/server/pdf-text.js`。
- 阅读状态：`app/ui/reader/progress.js`；视图与工具栏：`app/ui/index.html`。
- 现有详细计划：`docs/superpowers/plans/2026-09-23-pdf-reader.md` 与 `2026-09-24-pdf-layout-and-settings.md`。本路线图供后续需求选择阶段，不覆盖已完成计划的验收记录。
