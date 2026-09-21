# 阅读批注功能开发进度

> 计划：`docs/superpowers/plans/2026-09-20-reader-annotations-and-notes-sidebar.md`

## 当前状态

- 阶段：Phase A（选区会话、六功能工具栏、复制、统一写想法编辑器）
- 状态：已完成，进入 Phase B 规划
- 进度：4/4 个 Phase A 任务完成
- 侧栏笔记：尚未进入本阶段，安排在 Phase C

## 进度记录

### 2026-09-20：阶段启动

- 已确认当前工作区为 `main` 分支，执行前无未提交修改。
- 已确认基线：`npm test` 57 通过、3 跳过；`npm run check` 通过。
- 本阶段只修改选区/批注相关文件，不修改右侧笔记侧栏功能。

### 2026-09-20：Task 1 完成

- 完成批注兼容数据字段：`kind`、`style`、`updatedAt`。
- 旧记录自动映射为 `kind: highlight`、`style: marker`。
- 服务端白名单校验、客户端加载归一化、保存序列化均已接入。
- RED/GREEN 已验证：新增兼容性测试先失败后通过。
- 当前测试：`npm test` 通过，69 项通过、3 项跳过。

### 2026-09-20：Task 2 完成

- 新增批注归一化入口，旧记录默认回退为马克笔；新记录保留 `marker/wave/line/none`。
- DOM 标记层写入 `data-annotation-style`；波浪线使用每个矩形内的 SVG 路径，直线使用底边线，不改写 EPUB 原文节点。
- 定向 DOM 测试通过；全量 `npm test` 通过，71 项通过、3 项跳过；`npm run check` 通过。

### 2026-09-20：Task 3 完成

- 新增 `SelectionSession` 和 `#selectionMenu`，选区菜单包含复制、马克笔、波浪线、直线、写想法、问 AI 六个入口。
- 选区限制在 `#article .epub-chapter` 内，文本上限 4000 字，菜单会避让视口边界，并在 Escape、滚动、缩放或点击外部时关闭。
- 复制优先使用 Clipboard API，失败时回退到 textarea + `execCommand`；写想法和问 AI 已接通阶段提示，实际编辑器/AI 逻辑留到后续阶段。
- 新增 DOM 选区菜单测试；迁移旧选区 E2E 契约后，真实鼠标/指针选区两条用例通过。

### 2026-09-20：波浪线定位修复

- 根因：全局 `.article svg` 样式设置了 `margin: 24px auto`，命中波浪线 SVG 后，绝对定位的 `margin-bottom` 将波浪线向上推约 24px。
- 修复：为 `.br-highlight-wave` 显式设置 `margin: 0`、`max-width: none`，隔离正文 SVG 样式。
- 回归：波浪线底部与选区行框底部误差控制在 2px 内；批注 E2E 10/10 通过。

### 2026-09-20：Task 4 完成——统一写想法

- 将原“备注”字段在用户界面统一为“想法”，编辑已有标记和选区菜单中的“写想法”共用同一个编辑器。
- 编辑器支持两种模式：编辑已有批注、从选区新建想法；新建想法默认“不标记”，也可选择马克笔、波浪线或直线。
- `thought` 为规范字段；服务端、客户端加载/保存及导出均优先使用 `thought`，旧 `note` 仅作为兼容镜像，不再作为独立 UI 功能。
- 新增兼容、编辑、独立想法、取消不落库和导出回归测试；定向测试通过，高亮 E2E 12/12，通过 Node 全量 71 项、3 项平台跳过，结构检查通过。
- 下一阶段建议：进入 Phase B，先实现右侧“标记与想法”侧栏的数据查询、筛选和定位，再补充整本书跨章节查看与删除/编辑联动。

### 2026-09-20：Markdown 导出样式优化完成

- 导出内容按 EPUB 目录分组；一级目录从 `##` 开始，嵌套目录按 `###`、`####` 递增，最深限制为 Markdown 支持的 `######`。
- 有想法的记录：标记原文使用引用块，想法使用普通段落；没有想法的记录继续使用普通列表条目。
- Nav 和 NCX 两种 EPUB 目录解析均保留嵌套深度；没有章节定位的旧记录归入“未定位章节”，不会在导出时丢失。
- 新增导出格式、目录深度和浏览器下载回归测试；Node 全量 73 通过、3 项平台跳过，结构检查通过，高亮/导出 E2E 12/12 通过。

### 2026-09-20：Task 5 完成——右侧标记与想法面板基础版

- 启用 EPUB 专用 `btnNotes`，桌面工具栏调整为目录、标记与想法、导出等内容操作优先；移动端增加笔记入口。
- 右侧抽屉新增“目录｜标记与想法｜显示”页签，面板展示当前书全部标记和想法、章节、样式、原文及想法摘要。
- 支持“全部 / 标记 / 想法”筛选和“按章节 / 按时间”排序；使用 `textContent` 渲染用户内容，避免将原文当作 HTML 注入。
- 当前阶段只完成列表基础版；跨章节定位、点击条目跳转、侧栏编辑/删除安排在 Task 6。
- 验证：Node 全量 75 通过、3 项平台跳过，结构检查通过，高亮与侧栏 E2E 13/13 通过。

### 2026-09-20：Task 5 排序控件布局修复

- 根因：排序字段中的无障碍辅助文本使用了 `visually-hidden` 类，但项目没有提供该类的隐藏规则，文字实际参与排版并导致选择框换行、整体下移；排序选择框自身也使用了独立的 32px/82px 规格。
- 修复：将排序字段固定为右侧 136px 控件，选择框与筛选胶囊统一为 40px 高度和胶囊圆角；辅助文本改为绝对定位裁剪，不再占用布局空间。
- 新增浏览器回归断言：排序区域与筛选区域顶部对齐、两者高度一致、选择框高度一致，辅助文本不参与可视布局。
- 当前验证：Node 全量 75 通过、3 项平台跳过；结构检查通过；完整高亮与侧栏 E2E 13/13 通过；新版 FPK 已重新打包并完成包内布局修复核对。
- 产物：`dist/babyreader-fnos.fpk`，4,272,396 bytes，SHA-256 `15090BF3AEC19BD706201D83C50C19F7EBE330B5493DBEBDE47323E464DE0161`。

### 2026-09-20：Task 5 排序字号统一

- 原因：排序框与筛选按钮虽有独立字号声明，但排序原生下拉及其 `option` 没有统一的明确字号，浏览器展开态容易按默认字号显示。
- 调整：工具栏统一使用 11px 控件字号；左侧“全部 / 标记 / 想法”、右侧“按章节 / 按时间”及展开选项均使用同一字号，并补充 1.2 行高设置。
- 回归：新增字号一致性断言；定向笔记面板 E2E 通过；Node 全量 75 通过、3 项平台跳过；结构检查通过；完整高亮/侧栏 E2E 13/13 通过。
- 新版产物：`dist/babyreader-fnos.fpk`，4,272,458 bytes，SHA-256 `6AD74E28860BFEF3751119A2F243C104B1D401C229D9C04ED3BBE547C5EF8055`，已核对包内包含字号统一规则。

### 2026-09-20：Task 5 颜色与尺寸微调

- 排序文字及下拉选项显式使用与“想法”按钮一致的次级文字色 `var(--color-text-2)`，并增加原生控件文本颜色覆盖。
- 筛选组由 40px 缩小为 36px；排序控件由 136×40px 调整为 128×36px，保持顶部对齐和整体比例。
- 新增颜色与尺寸回归断言；Node 全量 75 通过、3 项平台跳过；结构检查通过；完整高亮/侧栏 E2E 13/13 通过。
- 最新产物：`dist/babyreader-fnos.fpk`，4,272,646 bytes，SHA-256 `5B3BDD68B8EA4998EB67338B752B9C692901A18BC14693159E52053B133E5622`。

### 2026-09-20：Task 6 完成——侧栏跨章节定位与行级操作

- 代码审查确认可以复用现有单章节渲染器、分页 settlement、DOM Range locator 和 `/api/books/:bookId/highlights` 数据链路，不新增全书 DOM、不改持久化 API。
- 标记与想法侧栏条目现在支持点击定位：按规范化 `chapterHref` 找到章节，跨章节时等待 `navigateToEpubChapter()` 和分页完成，再恢复 Range、滚动/翻页到目标并显示 1.5 秒定位闪烁；滚动模式和双页模式均支持。
- 同章节点击跳过章节重载；章节加载中拒绝重复导航；损坏或失效定位不会抛异常，保留抽屉并在对应行显示“原文位置已变化”等错误状态。
- 每个条目增加“编辑”和“删除”操作：编辑复用统一“写想法”编辑器，删除按稳定 annotation ID 操作并立即刷新计数、列表和持久化状态；操作按钮不会触发行级跳转，重渲染后恢复焦点。
- TDD 证据：跨章节定位 E2E 先 RED（条目无交互）后 GREEN；编辑/删除 E2E 先 RED（无行操作按钮）后 GREEN。
- 验证结果：`npm test` 76 通过、3 个平台相关跳过；`npm run check` 通过；DOM 回归 51/51 通过；Task6 专项 E2E 4/4 通过；高亮/EPUB/视口全量 Chromium E2E 19/19 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，SHA-256 `54E5072EB9A1770EAE0D77C29930C00447D666A93C849E5AF00E19FAC031D178`；已核对外层 `manifest`、`app.tgz`、`cmd/main` 以及包内 `ui/reader/notes-panel.js`、`ui/reader/highlights.js`、`ui/styles.css` 均存在。
- 下一阶段建议：Task7 处理 AI 接入边界、移动端交互和完整 ARIA；Task8 做导出/大数据量性能、真机 fnOS 安装验收和发布构件追溯。

### 2026-09-20：Task6 定位闪现边框修复

- 现象：从“标记与想法”侧栏定位到原文后，阅读页面短暂出现蓝色边框，随后自动消失。
- 根因：定位流程把 `.annotation-focus-flash` 加到 Range 的共同祖先节点；跨多段或多栏时该节点可能是整章容器，CSS `box-shadow` 动画因此绘制出整页/整栏蓝色边框。
- 修复：保留章节跳转、Range 恢复、滚动/翻页定位和错误提示，删除定位闪烁的定时器、类名添加逻辑及对应 CSS 动画，不改变可访问的侧栏焦点和定位行为。
- 回归：先将连续滚动用例改为定位后立即断言无闪现类，旧代码稳定复现失败；修复后定位用例 2/2 通过。

### 2026-09-20：Task 7 AI 右侧阅读面板布局优化

- 将桌面端 AI 从居中遮罩弹窗调整为顶栏下方的右侧固定面板，宽度固定为 360px，关闭后恢复原阅读布局。
- 桌面端取消 AI 背景遮罩、模糊和指针拦截；阅读容器同步收窄，分页/滚动阅读的正文不再被 AI 面板覆盖，浮动工具栏同步左移避让。
- 打开 AI 时自动关闭阅读 Drawer；打开目录、标记与想法或显示设置时自动关闭 AI，避免两个右侧面板重叠；移动端继续保留底部独立面板形态。
- 新增 E2E 回归：面板位置和宽度、阅读区安全边界、工具栏避让、透明遮罩、关闭后的布局恢复。
- 验证：`npm test` 82 通过、3 个平台相关跳过；`npm run test:e2e` 53 通过、2 个跳过；`npm run check` 通过。
- 构建：PowerShell 直接执行 `npm run build:fpk` 因环境缺少 `bash` 命令失败，使用 Git Bash 显式入口成功生成新版 FPK；产物为 `dist/babyreader-fnos.fpk`，4,273,020 bytes，SHA-256 `1F40AF673E244F6FA234BC970FED7133E324911DDD5EACF244A116976993F90A`；已核对包内包含 `manifest`、`app.tgz` 和 `cmd/main`。

### 2026-09-20：Task 7 AI 面板交互与视觉优化

- AI 问答内容区拆分为可滚动的聊天记录区和固定底部 composer；输入框始终贴在面板底部，发送按钮改为输入框右下角的浅蓝圆形上箭头，保留键盘发送和无障碍标签。
- AI 面板建立独立的 macOS 白色主题变量，强制使用白色背景、浅灰控件、深色文字和蓝色强调色，不再继承阅读页的深色或米黄色视觉。
- 隐藏 AI 面板打开时阅读区及 AI 内容区的滚动条，但保留滚轮、触控板和触摸滚动能力。
- 新增 E2E 回归：输入区贴底、发送按钮位置、AI 白色背景、聊天滚动区、阅读区滚动条隐藏；AI 相关用例 4/4 通过。
- 验证：`npm test` 82 通过、3 个平台相关跳过；`npm run test:e2e` 54 通过、2 个跳过；`npm run check` 通过；`git diff --check` 通过。
- 最新 FPK：`dist/babyreader-fnos.fpk`，4,274,564 bytes，SHA-256 `1D5E71F5CFD883BD1605CA9E6D08ECFF4B5197BA042ECAE4D850ED96E71661CD`；已核对包内包含 `manifest`、`app.tgz` 和 `cmd/main`。

### 2026-09-20：Task 7 AI 面板留白关闭与 Markdown 排版优化

- 桌面端 AI 面板改为独立浮层：宽度 360px，距窗口右侧 20px、距顶部和底部 12px，恢复完整圆角和阴影；阅读区与面板之间保留 20px，阅读正文、分页几何和浮动工具栏均不与面板相接或重叠。
- 桌面端透明遮罩恢复接收点击，点击 AI 面板外的空白区域即可关闭；面板内部操作不受影响，移动端原有底部面板行为保持不变。
- AI 回答接入已随项目打包的 `marked v15.0.7`，支持标题、段落、加粗、斜体、引用、列表、代码块、分隔线和安全链接；新增浏览器端白名单清洗，过滤脚本、危险标签、事件属性和 `javascript:` 链接，避免直接使用 `innerHTML` 带来注入风险。
- 新增 AI 回答排版样式，统一标题层级、段落间距、列表缩进、引用块和代码块，解决 Markdown 标记原样显示、内容挤成一块的问题。
- TDD/回归：DOM 测试验证 Markdown 结构与危险 HTML 过滤；AI 专项浏览器测试 4/4 通过；全量 Node 测试 82 通过、3 项平台相关跳过；全量 Chromium E2E 54 通过、2 项可选测试跳过；`npm run check` 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,276,141 bytes，SHA-256 `8E292C768F7818DA37F9F1564171A78F7749C2E6767956D205474F2E577CDBE4`；使用 Git Bash 构建成功。

### 2026-09-20：Task 7 AI 常驻悬浮窗口与 Drawer 共存避让

- 桌面端 AI 面板从右侧贴边布局调整为操作工具栏左侧的独立悬浮窗口：宽度约 320px，高度限制为约 620px，垂直居中，距离工具栏 12px，保留白色 macOS 表面、16px 圆角、浅灰边框和轻阴影。
- 打开 AI 不再收窄阅读区，正文和分页保持完整宽度；AI 面板与右侧竖向工具栏分离，避免形成大面积高面板。
- AI 只允许通过右上角关闭按钮关闭；移除点击空白关闭和 Esc 关闭，保证问答过程中可以持续阅读、输入和查看结果。
- 打开目录、标记与想法或设置 Drawer 时，AI 不被销毁，而是自动向左避让；关闭 Drawer 后恢复到工具栏左侧，避免两个面板发生覆盖。
- TDD/回归：AI 桌面悬浮窗口、仅手动关闭、Drawer 共存避让专项测试 2/2 通过；Node 全量测试 82 通过、3 个平台相关跳过；本轮全量 Chromium E2E 53 通过、2 个可选测试跳过，另有 1 个既有 EPUB 初始章节加载时序用例失败，单独复跑通过；结构检查和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,277,024 bytes，SHA-256 `7A1A496852653FBC8CA14910C20FC11C06916A43FE4BB65B668EA903E8C48E9A`；使用 Git Bash 构建成功。

### 2026-09-20：Task 7 AI 选中文本状态与常用问题优化

- AI 面板在没有选中文本时不再显示“未选择文本，可直接提问当前书本。”；只有从正文选中内容并点击“问 AI”时，才显示选中文本摘要。
- 直接从工具栏打开 AI 时，问题区切换为“常用问题”，提供“本章主要讲了什么？”、“这本书的核心观点是什么？”、“作者提出了哪些关键概念？”等问题。
- 选中文本打开时继续提供上下文问题；点击任意问题会自动写入底部输入框并聚焦，不会自动发送。
- 修复输入框点击后出现粗蓝色外框的问题：移除 textarea 的实心蓝色焦点轮廓，改为浅灰边框和低透明度蓝色柔和光晕，同时保留键盘焦点可识别性。
- 回归：AI 相关 Chromium E2E 5/5 通过；Node 全量测试 82 通过、3 个平台相关跳过；结构检查和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,276,354 bytes，SHA-256 `4AE9325D654FCEBE9CF72F80CA5B2DCF3AA9D1EA0E304E9C6D2958C0548309BC`；使用 Git Bash 构建成功。

### 2026-09-20：Task 7 AI 浮窗尺寸与问答层级优化

- 桌面端 AI 浮窗由约 `320×620` 调整为 `400×648`，宽高比约 `0.617`，接近 `0.618` 黄金分割比例；仍受视口高度限制，避免小屏溢出。问答滚动区继续与底部输入区分离，输入框保持固定在面板底部。
- 移除正常状态下的“已连接 · 模型名”、读取进度和成功状态文字；这些状态仍保留为无障碍状态更新，只有未配置、请求失败等需要用户处理的 warning/error 才显示可见提示。
- 删除“书本回答”标题及空回答卡片的背景、边框和内边距，AI 回答直接以 Markdown 内容流呈现，避免打开面板后出现无内容的大块空框。
- 设置保存后继续直接回到正常问答界面，不改变 AI 配置、书本检索、选中文本问答和 Markdown 渲染逻辑。
- 回归：`npm test` 82 通过、3 个平台相关跳过；AI 专项 Chromium E2E 5/5 通过；`npm run check` 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,277,086 bytes，SHA-256 `B0CFEAFF5C91C53411E53699A218DC8688F4DDDE0AE81258E1BF40065DCA136C`；构建溯源文件 `dist/build-provenance.json` 已同步生成。

### 2026-09-20：应用操作界面中性色统一

- 根因：浅色主题的 `--color-elevated: #FCF8F1` 同时被阅读纸张、设置卡片、目录和标记列表使用，而 AI 面板内部独立使用纯白、系统灰和蓝色，导致右侧 Drawer 出现偏黄割裂感。
- 新增独立的 `--ui-*` 应用界面色彩令牌：背景、表面、填充、主/次级文字、分割线、强调色和焦点色。浅色与护眼主题的操作面板统一为 Apple 风格白灰蓝；深色主题继续保持深色层级。
- 显示设置、目录、标记与想法、筛选胶囊、排序控件、自定义下拉菜单、滑块和开关改用应用界面令牌；阅读正文和阅读纸张主题保持不变，护眼米黄不再污染操作面板。
- 当前章节、选中筛选、错误提示和标记样式保留蓝色语义强调，卡片改为白色表面、浅灰分割线和低强度阴影，和 AI 问书视觉层级一致。
- 回归：`npm test` 82 通过、3 个平台相关跳过；设置/目录/标记/AI/双页翻页/Drawer Chromium 定向用例 14/14 通过；`npm run check` 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,280,263 bytes，SHA-256 `5D166D75406471C0874E4F9C818E4E1CBF24AA00295617A07310903A761A9BC3`；已核对外层 `manifest`、`app.tgz`、`cmd/main`。

### 2026-09-20：AI 问答发送按钮与 Enter 发送优化

- 将底部发送按钮从系统字体字符 `↑` 改为内嵌 SVG 线性箭头，统一 34px 圆形按钮、系统蓝启用态、浅灰禁用态、悬停和按下反馈，避免不同平台字体导致箭头偏移或形状不一致。
- 输入框支持普通 `Enter` 发送，`Shift + Enter` 换行；保留点击按钮和 Ctrl/⌘ 兼容行为，并在中文输入法组合阶段（`isComposing` / keyCode 229）阻止误发送。
- 更新隐藏辅助提示为“Enter 发送 · Shift + Enter 换行”，保留无障碍标签和 AI 忙碌状态下的禁用逻辑。
- 回归：`npm test` 82 通过、3 个平台相关跳过；AI 专项 Chromium E2E 6/6 通过；`npm run check` 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,280,774 bytes，SHA-256 `2EF11104FCF71D6DCD2F1E3B9FF47487771B40929F36258B3C012D1BE6F49ED6`；已核对外层 `manifest`、`app.tgz`、`cmd/main`。

### 2026-09-20：AI 发送按钮 SVG 垂直居中修复

- 根因：发送按钮内的 SVG 使用 `display: block; margin: auto`，只能可靠实现水平居中，按钮未建立 flex/grid 对齐上下文，导致 SVG 从内容区顶部开始布局。
- 修复：按钮改为 `inline-flex`，显式使用 `align-items: center` 和 `justify-content: center`；SVG 移除自动外边距并固定为 17px，箭头路径保持原有几何中心。
- 回归：新增按钮与 SVG 水平/垂直中心偏差不超过 1px 的 Chromium 断言；AI 专项 E2E 6/6 通过；Node 全量测试 82 通过、3 个平台相关跳过；结构校验和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,281,314 bytes，SHA-256 `1B40FD0917942150322A6BC68094403730EA198FA2A74898B9DD580F3C38FF2B`；已核对外层 `manifest`、`app.tgz`、`cmd/main`。

### 2026-09-20：AI 发送后清空输入与思考状态提示

- 修复发送后输入框仍保留原问题的 bug：问题通过校验并进入请求后立即清空 `#aiQuestion`，避免重复提交和视觉残留。
- 新增可见 `busy` 状态：索引读取阶段显示“正在思考并读取本书内容（x/y）…”，AI 请求阶段显示“正在思考并检索本书内容…”，并配合 Apple 风格的轻量旋转指示器。
- 未发送或回答成功后不显示状态；warning/error 仍保留可见提示，配置连接状态继续隐藏，避免状态信息干扰问答内容。
- 回归：AI 专项 Chromium E2E 6/6 通过，覆盖输入清空、思考状态可见、答案完成后状态消失；Node 全量测试 82 通过、3 个平台相关跳过；结构校验和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,281,477 bytes，SHA-256 `1C6232508E3AC51788318691D47EB2FEE8A0374B017BB012AD9D2116595E8A84`；已核对外层 `manifest`、`app.tgz`、`cmd/main`。

### 2026-09-20：排版滑杆方案执行（第一阶段）

- 移除排版设置中永久显示的 `2字`、`2.2em`、`100%`、`2.4`、`36px` 参数胶囊，改为 Apple 风格的中性灰滑杆、8px 粗轨道、20px 圆形滑块和两端语义标签。
- 保留现有字号百分比、行高、段间距、首行缩进和页边距的内部存储字段，避免影响已有用户配置、EPUB 样式和分页逻辑；字号提示按阅读基准换算为 px，但不迁移底层数据。
- 新增统一 `TYPOGRAPHY_SLIDER_CONFIG`：支持常用档位、连续拖动预览、松开/提交时吸附最近档位、键盘操作和临时值提示。拖动时只显示悬浮提示，停止操作后自动隐藏；保存只在 `change` 事件执行，减少连续拖动产生的持久化压力。
- 为滑杆增加 `aria-valuetext`、端点语义标签和键盘可识别的焦点样式；`settings.js` 缓存版本升级为 `v=29`。
- TDD/回归：排版静态契约和滑杆交互专项测试通过；Node 全量测试 84 通过、3 个平台相关跳过；设置相关 Chromium E2E 7/7 通过；全量 Chromium E2E 55 通过、2 个可选测试跳过，另有 1 个既有 EPUB 初始章节恢复时序用例失败，非本次排版改动引入；结构检查和 `git diff --check` 已通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,283,010 bytes，SHA-256 `E6558ABD79BB723AB9567F5498BE00AD9D16632DEF0881C347B5738802245353`；已生成 `dist/build-provenance.json` 并核对外层归档。

### 2026-09-20：排版滑杆方案执行（第二阶段）

- 在排版设置标题旁增加“恢复默认”，恢复现有推荐值：字号 100%、行高 1.9、页边距 40px、首行缩进 2 字、段间距 1.1em；不改变旧配置格式。
- 根据统一档位配置动态生成轻量刻度点，刻度只表达可吸附的常用位置，不显示技术参数，避免面板底部继续出现数字胶囊。
- 为恢复按钮和刻度增加 Apple 风格的轻量视觉、焦点态和无障碍语义；连续拖动、临时值提示和提交吸附逻辑保持不变。
- 回归：Node 全量测试 85 通过、3 个平台相关跳过；设置/目录相关 Chromium E2E 7/7 通过；结构检查和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,284,468 bytes，SHA-256 `C4576EAFA52D19C096A1595ED80A5172C0268BE4C55D536ABF3F6598EBAD3777`；已生成并核对 `dist/build-provenance.json`。

### 2026-09-20：排版滑杆方案执行（第三阶段：吸附与临时提示）

- 审查确认：连续拖动预览、提交时吸附最近常用档位、字号常用档位换算提示和 800ms 自动隐藏逻辑已在第一阶段实现，本阶段不重复改写生产逻辑。
- 新增专项回归：字号 `111%` 吸附为常用 `20px`；`aria-valuetext` 同步更新；临时提示在交互后自动隐藏；此前段间距吸附和恢复默认测试继续保留。
- 验证：Node 全量测试 86 通过、3 个平台相关跳过；设置/目录相关 Chromium E2E 7/7 通过；结构检查和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,284,347 bytes，SHA-256 `DD2601E718D6244D4B2969BE4818A45214118BE3E6DA8699C0BB4529B85BCD06`；已生成并核对 `dist/build-provenance.json`。

### 2026-09-20：排版滑杆方案执行（第四阶段：优化保存逻辑）

- 将排版设置保存改为“最新快照串行队列”：保留 250ms 防抖，当前请求未完成时不再并发发起下一次请求，后续变更会在前一个请求完成后读取最新界面状态再保存，避免响应乱序覆盖新设置。
- 新增 `flushUserSettings()`，离开阅读页时同时等待防抖任务和进行中的设置请求，确保用户最后一次排版调整不会因返回书库或关闭页面而丢失。
- 新增 DOM 并发回归，覆盖“首个请求阻塞期间修改主题，最终第二个请求只提交最新主题”的场景；静态契约同步检查生命周期使用新的 flush API。
- 验证：Node 全量测试 88 通过、3 个平台相关跳过；设置抽屉 Chromium E2E 2/2 通过；`npm run check` 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,286,300 bytes，SHA-256 `3821C17E6A80D5B9AFF066E81C0DD1A6FA2B8382BEB5FE9AD0D75A66C5045C94`；已生成并核对 `dist/build-provenance.json`。

### 2026-09-20：修复滚动模式与双页模式主题颜色不一致

- 根因：连续滚动正文使用 `var(--bg)`，双页分页卡片使用 `var(--surface)`；深色、浅色和护眼主题中这两个语义变量的颜色定义不同，因此切换阅读模式会改变正文纸面颜色。
- 修复：双页分页正文统一使用 `var(--bg)`，保留阅读舞台、圆角和阴影层次；护眼主题继续使用独立阴影，但不再覆盖正文表面颜色。主题切换和分页计算逻辑未改动。
- 新增真实浏览器回归：深色、浅色、护眼三种主题下，连续滚动与双页分页正文背景色必须一致。
- 验证：Node 全量测试 88 通过、3 个平台相关跳过；阅读器 Chromium E2E 34/34 通过；`npm run check` 通过；`git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,286,471 bytes，SHA-256 `593849E9B72F4B20E0B8AB3D0155C80452714AEFA95F9A46D6451BCAA75047AD`；已生成并核对 `dist/build-provenance.json`。

### 2026-09-20：第五阶段——测试与兼容性验证

- 完成核心兼容回归：旧标记记录自动回退、新字段保留、旧阅读定位恢复、连续滚动/双页分页边界、主题切换、排版滑杆保存、AI 未配置降级、EPUB 资源安全限制均通过。
- 完成真实 Chromium 全量回归：59 项中 57 项通过，2 项真实 EPUB 调查用例按可选条件跳过；桌面、移动视口、主题、Drawer、标记/想法、Markdown 导出和 AI 对话均未出现新增回归。
- 完成核心测试：83 通过、2 个平台相关跳过；`npm run check:portable` 通过；`git diff --check` 通过。
- 兼容边界：当前环境无法替代真实 fnOS x86_64/ARM64 设备安装验证，FPK 已完成结构打包，仍需设备侧安装后验收触摸选择、剪贴板、字体、WebView 和文件授权行为。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,287,589 bytes，SHA-256 `77CC263FB90EB5D14EB4FB503F020A1AAF1230C553BB36937572C31D539F0AF0`；已生成并核对 `dist/build-provenance.json`。

### 2026-09-20：Task 7——多轮对话与流式输出

- 服务端新增 `POST /api/books/:bookId/ai/ask/stream`，将 OpenAI-compatible Responses 流转换为稳定的 `meta`、`delta`、`done`、`error` SSE 事件；旧版 JSON `/ai/ask` 接口保持不变。
- AI 请求新增有上限的临时历史：最多 12 条消息、单条 4000 字符、总计 12000 字符；每轮仍重新检索书本片段并重复书本约束指令，不把对话写入 localStorage 或用户阅读状态。
- 前端问答区升级为临时多消息会话：用户问题和 AI 回答按轮次展示，每轮独立显示来源；保留原有 `#aiAnswer`、`#aiSources` 兼容选择器，并增加“新对话”清空入口。
- 流式回答按 `requestAnimationFrame` 合并渲染 Markdown；生成中发送按钮切换为停止按钮，停止、关闭面板、新建对话和切换书本会取消活动请求，未完成回答不会进入下一轮历史。
- 新增服务层、浏览器 SSE、两轮历史和停止生成回归；`npm run test:core`：87 通过、2 个平台相关跳过；AI 专项 Chromium：8/8 通过。
- 全量 Chromium：61 项中 58 通过、2 个可选真实 EPUB 跳过；1 个既有“无效章节回退”用例在全量运行中出现时序失败，单独复跑通过，暂列为既有测试波动。
- `npm run check:portable` 和 `git diff --check` 通过。新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,304,847 bytes，SHA-256 `C56DF10DE4D66C5EAA3CDB09DB70F8146785C62C5AD6703668900AB7BCFBFED9`；已核对外层归档及包内 AI 服务、SSE API、AI UI 文件。

### 2026-09-20：AI 来源章节引用细化

- AI 提示词现在要求按实际使用的书本片段输出 `【1】`、`【2】` 引用标记，不再把所有检索片段默认视为来源。
- 前端将引用标记渲染为 `①`、`②` 等可点击超链接，并跳转到对应章节；代码块中的标记不会被误处理为链接。
- 来源章节不再在流式 `meta` 阶段显示，只有收到回答完成事件后才扫描引用编号并展示实际被引用的章节；没有引用时整个来源区域隐藏。
- 来源列表与正文引用编号保持一一对应，保留原有章节导航能力；多轮对话、流式输出和停止生成逻辑未改变。
- 回归：新增引用提示词、引用链接、来源过滤和多轮来源锚点隔离测试；全量 `npm test` 97 项中 94 通过、3 个平台相关跳过；AI 专项 Chromium 4/4 通过；`npm run check:portable` 和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,307,292 bytes，SHA-256 `3DDE3006039DC048957364B7DBC725CE8CF19C8CF69EF6994035A2F272844718`；已重新打包并完成结构校验。

### 2026-09-20：AI 来源章节标签视觉统一

- 来源标签由单一文本节点拆分为固定编号徽标和章节标题两个元素，单数字、双数字使用同一布局槽位。
- 编号徽标固定最小宽度和高度，采用等宽数字特性；章节标题固定行高，超长标题使用省略号，标签内部不拆行，多个标签仍按容器自动换行。
- 统一标签高度、内边距、间距、字体大小、颜色和圆角；焦点状态改为轻量 Apple 风格外环，避免出现突兀的蓝色实线边框。
- 新增来源标签结构回归测试；全量 `npm test` 98 项中 95 通过、3 个平台相关跳过；AI 专项 Chromium 4/4 通过；`npm run check:portable` 和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,308,303 bytes，SHA-256 `32AC3F30FD909400A3B33B86BBC43040B5DCE75769128655B4558DBBF99582AE`；已重新打包并完成结构校验。

### 2026-09-20：AI 停止按钮与来源编号细节优化

- 修复停止生成按钮图标：行内 `span` 改为稳定的块级实心圆角方块，固定 10px 尺寸，解决原来显示为细竖条的问题。
- 来源编号徽标缩小为固定 16px、9px 字号，单数字和双数字共享同一尺寸槽位，降低视觉重量并贴合截图中的小号编号风格。
- 新增浏览器回归断言，验证停止图标尺寸、来源编号字号和几何尺寸；全量 `npm test` 98 项中 95 通过、3 个平台相关跳过；AI 专项 Chromium 4/4 通过；`npm run check:portable` 和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,307,167 bytes，SHA-256 `78D2FB260ED85531A3A7DC6EF3B7BD82E439DF8C98C2D5BA5D1E576CBEA12529`；已重新打包并完成结构校验。

### 2026-09-20：AI 来源编号单一视觉体系

- 来源标签展示层现在只显示 AI 引用编号；EPUB 目录标题中原有的 `⑦`、`⑧`、`⑩` 等前缀不再与引用编号叠加显示。
- 原始章节标题仍保留在 `aria-label` 和悬停提示中，不改变章节跳转目标，也不修改目录数据。
- 焦点状态只显示浅色 Apple 风格外环，不再把当前标签文字和边框变成另一套蓝色编号样式。
- 新增带目录编号前缀的 DOM 和 Chromium 回归；全量 `npm test` 98 项中 95 通过、3 个平台相关跳过；AI 专项 Chromium 4/4 通过；`npm run check:portable` 和 `git diff --check` 通过。
- 新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,308,146 bytes，SHA-256 `1CD7BE7CF4111FFBE69153DA97041CC3B0C92B3C06B257454705EB2B3A51AC67`；已重新打包并完成结构校验。

### 2026-09-20：AI 服务设置改为独立浮层

- 设置不再替换 AI 问答页面：问答区保持挂载，当前回答和多轮对话不会因进入设置而丢失。
- 设置改为 AI 问答内部的 Apple 风格次级浮层：半透明毛玻璃遮罩、居中圆角卡片、独立标题栏、紧凑表单和底部操作区，避免原设置内容占据问答页一半造成割裂。
- 增加关闭按钮、遮罩点击和 Esc 退出；保存成功后自动关闭设置浮层并恢复焦点，保存失败则保留浮层和错误提示，API Key 仍不会回显。
- 新增 DOM 回归，覆盖“设置打开后问答仍可见、回答内容保留、保存后自动关闭”；AI 配置 Chromium 1/1 通过，AI 专项 Chromium 5/5 通过；Node 全量 99 项中 96 通过、3 个平台相关跳过。
- `git diff --check` 和 `npm run check:portable` 已通过。新版 FPK：[`dist/babyreader-fnos.fpk`](D:/AI编程/reader/babyreader-fnos/dist/babyreader-fnos.fpk)，4,311,030 bytes，SHA-256 `082A323DBDBD4E1BBD45FBC4A5E4E1323280A9DD6C05F316CE5021006DBB2A3B`；已重新打包并核对 `dist/build-provenance.json`。

### 2026-09-20：AI 服务设置按钮视觉统一

- “清除 Key”改为与“保存并关闭”同规格的次级描边按钮：统一 34px 高度、胶囊圆角、字号和水平内边距；保存继续保持蓝色主按钮层级。
- 未配置 API Key 时清除按钮禁用；已有 Key 时点击仅进入“待清除”状态，按钮变为“取消清除”，并提示保存后才会真正清除，避免误操作。
- 增加系统红色语义色，仅用于待清除状态；默认状态仍保持中性灰，符合 Apple 风格的弱化次级操作和明确破坏性状态原则。
- 新增 Chromium 回归：无 Key 禁用、清除状态可切换、保存提交 `clearApiKey`；AI 全专项 9/9 通过，Node 全量 99 项中 96 通过、3 个平台相关跳过。

### 2026-09-20：顶部状态栏与右侧阅读面板关系优化

- 根因：右侧 Drawer 原本自身承担全部滚动，标题栏和 Tab 与目录/标记内容处于同一个滚动容器；同时顶部栏、浮动工具栏和 Drawer 使用了不同的表面色 Token，工具栏也没有为 Drawer 预留空间。
- 重构 Drawer 结构：标题栏和 Tab 保持固定，新增 `readerDrawerContent` 作为唯一内容滚动区，避免目录和标记列表滚动到顶部状态栏下面。
- 桌面端 Drawer 改为顶部栏下方的浮动面板，右侧为工具栏预留 74px + 16px 间距；工具栏保持可见并使用选中态与 Drawer 建立操作关系。
- 顶部栏、浮动工具栏和 Drawer 统一使用中性 `--ui-*` 颜色体系；移动端保留底部 Sheet 形态，并同样让标题/Tab 与内容滚动分离。
- 回归：新增 Drawer 结构约束测试；Node 全量 100 项中 97 通过、3 个平台相关跳过；设置/目录/Drawer Chromium 6/6 通过；桌面与移动视口视觉复核截图已保存。

### 2026-09-20：AI 阶段 1——安全稳定

- AI 设置新增“测试连接”，只提交 URL、模型名和 API Key，不提交 `bookId`、选中文本、书本片段或对话历史；测试成功/失败在设置浮层内给出可操作提示，且不保存配置。
- AI 服务 URL 增加 HTTP(S)、凭据、查询参数、端口、localhost、回环、私有网段、链路本地和保留地址校验；请求前做 DNS 解析检查，禁止重定向。
- 上游普通 JSON、连接测试和 SSE 响应增加大小边界；错误正文不再直接透传，API Key 不进入返回内容或 AI 错误记录。
- 新增服务端书本可信校验：根据已授权 `bookId` 重新读取 TXT/EPUB，验证 EPUB 的章节路径、OPF spine 序号、书本片段和选中文本属于当前书籍后才允许访问模型；伪造上下文在上游请求前返回 400。
- 修复本次回归中发现的 Drawer 打开时 AI 面板与右侧面板重叠问题，保留两者同时打开时的间距关系。
- 新增端点安全、连接测试、TXT/EPUB 上下文校验、上游响应边界和 UI 连接测试；Node 全量 107 项中 104 通过、3 个平台条件跳过；AI 相关 Chromium 11/11 通过；`npm run check:portable` 和 `git diff --check` 通过。
### 2026-09-20：AI 阶段 2——检索质量阶段 1

- 使用用户提供的《吃的营养科学观.epub》做基线分析：126 个 spine 章节、约 20 万字、155 个标题节点；
- 当前检索仍限定在当前书本，最多返回 6 个片段，不增加 AI 请求上下文预算；
- 章节标题和 EPUB 小节标题加入本地排序，当前章节加分只有在存在正文/标题匹配时生效；
- 相邻重叠片段延迟选择，优先覆盖不同章节或不同内容区段；
- SQLite FTS、混合排序和 Embeddings 暂未执行，记录在 `2026-09-20-ai-retrieval-quality-staged.md`；
- 下一步先确认 fnOS SQLite 运行时和跨架构打包方式，再接入本地 FTS 并保留关键词回退。

### 2026-09-20：修复 DeepSeek 测试连接误报

- 根因：连接测试把“非流式响应必须包含可读正文”当成成功条件；DeepSeek 在连接探测返回 HTTP 200 但输出为空时，被错误判定为失败，而实际问答流式请求正常。
- 修复：连接测试现在以 HTTP 成功、无上游错误对象为准，不要求探测请求产生正文；正常问答仍继续校验可读回答，避免空回答进入对话。
- 新增 DeepSeek 风格空输出响应回归测试；Node 全量 110 项中 107 通过、3 个平台条件跳过；AI 相关 Chromium 11/11 通过。
- FPK 已重新生成：`dist/babyreader-fnos.fpk`，5,217,007 bytes，SHA-256 `B2376CF930B5CEA26EFC3B21C3A00F5792D6D4F4F4CE3C5AAA80D5939C2F9D28`。

### 2026-09-20：记录 AI 会话持久化后续计划

- 当前临时多轮会话行为保持不变，不修改运行代码。
- 已完成接口和数据结构规划：按 `userId + bookId` 隔离，多会话、完成后保存、流式中断不保存半截回答、来源只保存章节元数据。
- 已规划会话列表、会话详情、创建、保存消息、删除和清空接口，以及刷新/关书/切书/跨用户访问测试。
- 详细方案见 `docs/superpowers/plans/2026-09-20-ai-conversation-persistence.md`，等待用户后续明确执行。
