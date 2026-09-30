# PDF 划线与笔记（P3.2）进度与经验记录

日期：2026-09-25。状态：**Task 0–5 已完成本地实现与自动化回归；设备验收边界见下文。** 实现和验证运行于当前含大量未提交内容的 `main` 工作区。对应计划：`docs/superpowers/plans/2026-09-25-pdf-annotations-and-notes.md`。

## 当前基线与证据等级

| 项目 | 当前事实 | 尚缺证据 |
| --- | --- | --- |
| PDF 阅读 P0–P2 | 已实现并有本地 Node/Chromium 回归记录，见 `2026-09-23-pdf-reader-progress.md`。 | 多栏实书的跨页拖选、旋转与大文档内存，仍需真机/真实样本核验。 |
| PDF 书签 P3.1 | 首版页级书签已本地实现；用户在 2026-09-25 表示「书签验证通过」。 | 未收到本次书签验收的设备日志/身份隔离细节；不据此推断批注已可用。 |
| P3.2 Task 1–4 | PDF 专属契约/API、按页选择几何、独立页面覆盖层及共用菜单/编辑器/笔记抽屉已本地实现并通过 Node/Chromium 测试。 | Task 5 全链路边界与设备验收尚未完成；无本阶段 FPK。 |

当前 `main` 工作区含用户原有的大量已修改/未跟踪代码和多个 FPK 目录；计划文件及本进度文件的建立不代表这些改动已提交或进入正式发布。未来执行时记录精确基线并保留原有内容。

## 执行看板

- [x] Task 0：冻结基线、文件来源失效语义与本地测试输出。
- [x] Task 1：PDF 专属标注 API、UID 隔离、白名单与原子存储。
- [x] Task 2：PDF 文本选择按页/行拆分及稳定页面坐标。
- [x] Task 3：逐页覆盖层、缩放旋转重投影和虚拟化生命周期。
- [x] Task 4：共用 EPUB 风格菜单、编辑器、抽屉和能力标识。
- [x] Task 5：浏览器全链路、EPUB 回归、完整验证和设备前记录。

每完成一项，在此追加：`任务/日期/实际改动/RED 命令与失败原因/GREEN 命令与计数/裁决/遗留风险/下一项`。不预填通过结果。FPK、NAS 安装及设备结果作为单独验收条目，记录包哈希和真实输出。

## 本轮代码审查结论

1. EPUB 的 `selection-menu.js` 只识别 `.epub-chapter`；`highlights.js` 的定位依赖章节路径和 DOM Range。PDF 的文字选择来自每页可被替换的 PDF.js 文本层，不能序列化为 EPUB CFI 或 DOM 路径。
2. EPUB `drawHighlightRects` 将 Range 视口矩形转换为整篇文章的滚动坐标。PDF 需要每页独立坐标与每行四边形；沿用文章覆盖层会在缩放、双页和虚拟化时漂移。
3. `actions.js:queueHighlightSave` 只写 EPUB；服务器 `replaceHighlights` 整组替换并只保留 EPUB 字段。PDF 若复用这个请求会丢几何或覆盖其他记录，所以选独立 `pdfAnnotations` 字段和按 ID CRUD。
4. `library.js` 中 `bookId` 由绝对路径计算，扫描 `fingerprint` 另由路径、大小和修改时间计算。同路径替换 PDF 后书籍 ID 不变，因此保存的坐标必须携带来源指纹并在变化时停止绘制和精准跳转。该指纹不是内容校验和；需要在接收写入时复核当前授权文件。
5. API 的 JSON 请求上限为 2 MiB。P3.2 单书集合 1 MiB 是单独的首版预算，避免把批注无限堆进每用户的 `reading-state.json`；达到限制必须清楚告诉用户。

## 经验反思：问题 → 原因 → 本计划的防线

| 已有开发经验 | 反思 | P3.2 对策 |
| --- | --- | --- |
| PDF 选中文字曾出现大片不透明蓝色，遮住 Canvas 字形；修复后仍曾有局部蓝色叠加。 | 选区是文本层的临时反馈，永久划线是另一种可视层；两者混用或重复着色会掩盖原文。 | 单独每页覆盖层，半透明语义色；`::selection` 规则维持原状。Chromium 对比选中前/中/后的字形和 alpha。 |
| 长距离选择曾跳到多余区域；PDF 只有可见页会按需渲染。 | 一个全局 Range 的大包围框不等于真实选择的逐行区域，选区与缓存必须共同限额。 | 每页子 Range + 每行四边形；继承 8 页选择限制并设 quad、字数和集合预算。 |
| PDF 旧滚动逻辑曾把深页位置误写为首页；双页右侧页也容易丢失精确索引。 | 视口坐标、文档滚动坐标和 0 基页索引是不同量纲。 | 批注定位始终以 `pageIndex` + 页内归一化 PDF 坐标表示，测试深页/双页右页。 |
| 缩放重绘的 Canvas 和文本层曾不同步、闪黑或破坏选择。 | 异步帧可能在切书或新缩放后才返回。 | 覆盖层随同一 `bookId/generation/scale` 帧提交或清除，过期结果丢弃；不固定全部页面。 |
| PDF 书签能复用 UID 隔离与原子 JSON，但 EPUB 划线现有 API 是全量替换。 | 共用交互不等于共用持久化格式。 | 共享编辑器/列表视图模型，EPUB 和 PDF 定位/存储分离；按 ID 原子增删改避免多标签页丢失更新。 |
| 历次测试 FPK 来自含多项未提交变更的工作区。 | 通过局部测试不等于包里只有该项功能，也不等于 NAS 已验收。 | 后续记录源状态、包哈希及关键包内文件；真实 PDF 手动回归与本地合成用例分开报告。 |
| 旧 JSON 字段或客户端提交的版本号可能伪造/污染新记录。 | 兼容性存储很难区分历史记录、未知字段和客户端视图状态。 | 创建字段白名单；来源指纹只由服务端取值；损坏的旧侧车记录 fail closed，不静默丢弃后重写。 |

## Task 0 执行结果（2026-09-25）

- 基线提交：`578785fb5d47e57309fa65a38e482ba12e7cdf72`（分支 `main`）。
- Step 1：相关 tracked 文件在测试前已有修改；PDF 阅读器、PDF 测试和 E2E 文件有未跟踪实现。测试前快照及 PDF 源文件 SHA-256 已写入该计划专属的 `.superpowers/sdd/2026-09-25-pdf-annotations-and-notes/progress.md`。该工作区包含大量其他用户更改，测试结果只说明当前组合状态。
- Step 2：
  - `node --test tests/reader-core.test.js tests/dom-regression.test.js tests/pdf-reader.test.js`：200 passed，0 failed，0 skipped。
  - `npx playwright test e2e/pdf-reader.spec.js --project=chromium`：27 passed；仅输出 Windows 环境颜色变量提示。
  - `npm run check:portable`：通过，49 required files、9 lifecycle scripts。
  - Task 0 未修改产品源文件；没有 NAS/FPK 验收，也没有 P3.2 功能断言。
- Step 3 裁决：同路径来源指纹改变后保留旧侧车记录供查看/删除，标记「原文已变化」，禁止覆盖层和精确跳转；源指纹不变但文本层暂不可用时保留几何位置并提示引文无法核验。此语义将由 Task 1、3、4 测试落实。
- Task 0 完成时的交接：进入 Task 1 建立独立 PDF 标注存储/API；该阶段现已记录在下节。

## Task 1 执行结果（2026-09-25）

- 范围：新增 `app/server/pdf-annotation-contract.js`；在 `storage.js` 增加 `books[bookId].pdfAnnotations` 的列出、创建、按 ID 更新/删除；在 `index.js` 增加 PDF 专属 API，并从 `library.js` 导出已有 `fingerprintBook` 供安全来源校验。
- 安全与数据裁决：继续沿用 `mutateUserState` UID 队列和原子 JSON 写；不改 EPUB `highlights`。API 每次走网关身份、`findBook(...requirePathIdentity)`、当前授权路径和 PDF 开关；以 no-follow 文件句柄重算当前来源版本。创建/编辑仅当文件指纹等于索引指纹时允许；GET 为旧来源加 `sourceStale`，DELETE 可按 ID 清理。客户端不能指定 `sourceFingerprint`，记录损坏时不返回部分可信内容。
- API 状态码：POST 对首次创建与相同 ID 的幂等重试均返回 200，避免并发重试因竞态出现不同响应码；ID 内容冲突返回 409。
- RED→GREEN：`reader-core.test.js` 先因 `createPdfAnnotation` 不存在失败，后转绿；`pdf-content-api.test.js` 先因 API 返回 404 失败，后转绿。另有损坏存储测试先发现空值集合被误当作空集合，修正后通过。
- 最终验证：`npm test` → 398 tests / 391 pass / 0 fail / 7 skipped；跳过项均受 Windows 符号链接权限或 POSIX-only 环境限制。`npm run check:portable` → 49 required files、9 lifecycle scripts 通过；`git diff --check` 通过。
- 限制：完整套件是在脏 `main` 工作区运行；本阶段没有 UI、真实指针、多栏 PDF、FPK 或 NAS 验收。没有创建提交。
- 下一阶段：Task 2，实现 PDF 文本选择分页、逐行区域转换为 PDF 页面归一化坐标及缩放/旋转逆投影。

## Task 2 执行结果（2026-09-25）

- 范围：新增 `app/ui/reader/pdf-annotation-geometry.js`；PDF 控制器新增 `getRenderedPageGeometry(pageIndex)`，在有效渲染页及其当前缩放代次下提供真实页码、页面视口和 PDF `page.view`；`index.html` 按顺序加载几何模块并提升 PDF 控制器 cache-bust。构建结构验证、构建 provenance 和 fnOS 设备验收脚本均纳入新增文件，避免页面脚本在开发环境存在、FPK/验收包中缺失。
- 选区契约：只接受单个非折叠 Range，起止点必须属于 PDF.js 文本层；按实际 `.pdf-page` 节点拆分，不以双页 spread 行号代替 PDF 0 基页码。逐页子 Range 获取 CSS `getClientRects()`，保留行级四边形、过滤空块和近重复块；引文空白规范为单空格。页面无法渲染、切书/代次混合、超过 8 页、512 个 quad 或 4000 字时 fail closed。每页坐标通过该帧 `viewport.convertToPdfPoint` 转入 PDF 坐标后按 `page.view` 归一化；反向投影使用当前页 viewport。
- RED→GREEN：`node --test tests/pdf-annotations.test.js` 起初因新模块不存在而 4 项全红，控制器接口也因 getter 不存在而红；实现后新增选区分页/多行/双页、相邻栏外文字、范围外和不可用页、8页/512 quad/4000字预算、旋转 0/90/180/270 × 缩放 0.5/1/2 往返误差、缩放后 stale geometry、双页右页精确 `pageIndex`。最终 `node --test tests/pdf-annotations.test.js tests/pdf-reader.test.js`：33 passed / 0 failed。
- 回归验证：`npm test`：403 tests / 396 passed / 0 failed / 7 环境跳过；PDF Chromium E2E `npx playwright test e2e/pdf-reader.spec.js --project=chromium`：27 passed；`npm run check:portable`：50 required files、9 lifecycle scripts；JS 语法检查及 `git diff --check` 通过。
- 失败复盘：首轮合成 Range 测试发现浏览器 `Range.toString()` 会把页间 DOM 排版空白带入引文，因此将连续空白归一成单空格；不同 realm 的数组不能直接用 Node `deepStrictEqual` 比较，测试改为按标准值断言。实现不以包围矩形重建 selection，避免把跨栏空白或多行合并成大片区域。
- 边界/未覆盖：本阶段只提供选区几何和只读渲染上下文，没有触发 PDF 保存、绘制覆盖层或编辑菜单；真实鼠标选取、多栏视觉一致性及保存前的 generation 二次校验留给 Task 3–5。没有生成 FPK 或做 NAS 验收；没有提交。
- Task 2 完成；下一阶段 Task 3：每页标注覆盖层与虚拟化/换书/缩放生命周期。

## Task 3 执行结果（2026-09-25）

- 范围：新增 `app/ui/reader/pdf-annotations.js`，给每个已渲染 PDF 页创建单独 Canvas 覆盖层；标注层位于 PDF 页面 Canvas 与 PDF.js 文本层之间，禁用指针事件，不改浏览器文本选择配色。支持 marker、line、wave 三种绘制形态与黄/绿/蓝/粉语义色；覆盖层有 16M 像素预算。
- 生命周期：PDF 控制器仅在 Canvas 和文本层帧有效提交后通知覆盖层；页面离开虚拟化窗口即删除对应绘制 Canvas，缩放清除旧帧后按当前 viewport 重投影，切书/关闭阅读器清除会话。书籍 ID、PDF 代次、页面索引、scale 与来源指纹参与校验，旧代次/旧来源结果不绘制；持久化 quads 不因 zoom 改写。
- RED→GREEN：DOM 单测与浏览器真实鼠标拖选用例先因渲染模块/覆盖层缺失失败，再在实现后转绿。Chromium 覆盖层测试验证真实跨行选择、清除原生选区后覆盖仍在、PDF Canvas `toDataURL()` 不变、覆盖层不拦截再次选取、缩放重投影、滚动离屏回收、返回书库清理。
- 夹具复盘：首轮 PDF 全回归发现多行注入既有 `e2e-reader.pdf` 会改变重复短语搜索的 DOM Range 上下文；把多行场景拆为独立四页 `e2e-annotation.pdf` 后，保留原搜索夹具契约且可验证真正页面回收。专项 2/2 通过。
- 验证：`node --test tests/pdf-annotations.test.js tests/pdf-reader.test.js`：34 通过；`npm test`：404 总计、397 通过、0 失败、7 环境跳过；PDF Chromium E2E：28/28；portable 结构：51 required files、9 生命周期脚本；JS 语法检查和 `git diff --check` 通过。
- 安全/兼容：标注覆盖层不修改 PDF.js Canvas 字形或文本层 selection；不改 EPUB 标注行为/存储；菜单、编辑、列表和导航适配器留 Task 4；未生成 FPK、未做 NAS 验收、未提交。Windows 环境下 7 项 skip 属 POSIX shell/符号链接能力限制。
- 该阶段完成时的下一步为 Task 4；其结果记录如下。

## Task 4 执行结果（2026-09-25）

- 范围：新增 `reader/annotations.js` 作为 EPUB/PDF 视图模型与能力适配层；PDF 记录通过独立 GET/POST/PATCH/DELETE API 同步到单书 `pdfAnnotations` 缓存。共用选区菜单、编辑器与「标记与想法」抽屉；PDF 列表显示页码、按页/时间排序、筛选、按首个有效页跳转。来源失效条目只允许查看和删除。PDF 菜单隐藏未开放的 AI 动作；EPUB 保持原有 `highlights` 与导出链。
- RED：`node --test --test-name-pattern="PDF annotations use the shared notes panel|PDF annotation API methods" tests/dom-regression.test.js` 最初 2 项因 PDF 笔记入口/API 适配缺失而失败。真实鼠标 E2E 初次运行进一步发现 PDF 菜单显示 EPUB 的 AI 按钮；修正后继续验证。
- GREEN：`node --test tests/pdf-annotations.test.js tests/pdf-reader.test.js` 34/34；最终 DOM 全量 127/127。`npx playwright test e2e/pdf-reader.spec.js e2e/reader.spec.js --project=chromium` 在切书保护前 77/77；保护后 PDF 完整创建→定位→改色/换样式→写/删想法→删除，以及 EPUB AI 选区和模块装载三项定向浏览器用例 3/3。`npm run check:portable`：52 required files、9 lifecycle scripts；`git diff --check`：通过。
- 失败复盘：DOM 测试装载器漏引入新增适配层，补齐后发现旧 EPUB 面板契约不要求先有当前书籍，已保留该行为；反向排列记录的新增测试又发现 EPUB「按章节」排序丢失目录顺序，现从同一章节视图模型恢复排序键。浏览器测试最初误以为抽屉打开后可再次点被遮罩挡住的工具栏按钮，改为在已打开列表中操作。EPUB AI E2E 的本书内容读取偶尔超过原有 5 秒断言窗口；把回答断言窗口调整为 15 秒后 PDF/EPUB 三项定向用例 3/3，未改 AI 功能。
- 安全裁决：选区会话与编辑器绑定书籍 ID；切书后不发起旧 PDF 想法/编辑写入。异步响应只更新原书的缓存，当前书不被过期 UI 回调重绘。服务端失败保留编辑草稿与原缓存；`kind` 不在编辑请求中。PDF 不调用 EPUB 的整组 `highlights` PUT。
- 证据边界：本地测试覆盖合成 PDF 与 Chromium；尚未做真实多栏 PDF、不同 UID、多标签页、替换原文件及 fnOS 安装后的 Task 5 全链路验收。未打包、未安装、未提交。下一阶段为 Task 5。

## Task 5 本地验收与交付记录（2026-09-25）

- 范围：在现有脏 `main` 工作区进行本地全链路和失败边界验证；没有提交、打包、安装或修改 NAS。合成夹具均位于测试运行时书库，没有复制用户书籍、Cookie 或 NAS 绝对路径。
- RED→GREEN（产品缺陷）：把真实鼠标创建→刷新→重开→列表定位→改色/样式/想法→删除串成浏览器用例后，首次刷新找不到标注覆盖层。根因是 `refreshPdfAnnotations` 可在 PDF 首帧前完成，而 `setPdfAnnotationRendererRecords` 从“已渲染页几何”取代次；此时几何为空，提前清空了渲染会话。修复为核对当前书籍 ID，并从 PDF 控制器 `getGeneration()` 取代次；已渲染页仍即时绘制，未渲染页待有效帧提交时绘制。真实浏览器用例转绿，并新增 DOM 用例断言首帧前可建立会话、旧代次不可覆盖。
- RED→GREEN（测试夹具）：双页多栏测试初版把右栏目标留在屏外，鼠标并未形成有效选择；夹具改为封面＋左页＋右侧双栏页并滚到右页后转绿。无文字测试改用真正包含栅格图像 XObject 的 PDF，而非空白页。来源过期浏览器测试先尝试点击带 `aria-disabled` 的列表项而超时，改为直接核验不可交互、编辑入口缺席和覆盖层不绘制。旧覆盖层测试手工注入与初始化异步 GET 相争；先等待 GET，再显式提交受控页帧，专项连续 3 次通过。
- 存储/API：新增同 UID 交错 create/update/delete 与 EPUB whole-array `replaceHighlights` 的并发测试，同时确认另一 UID 数据隔离；模拟 JSON 原子 `rename` 失败，断言旧文件逐字节不变、失败未进入内存缓存、队列后续可恢复。原有测试继续覆盖 UUID 幂等/409、创建和编辑字段白名单、页/quad/条数/1 MiB 集合与 2 MiB 请求预算、真实来源指纹变化后的 stale 标记及清理权限。浏览器只用独立模拟的 stale GET 检查 UI；不能等同真实换源验收。
- 浏览器：新加真实鼠标双页右侧两栏重复词选区，确认只取右栏文字且 `pageIndex=2`、四边形在右栏；图像型 PDF 无文字时不出现标注；持久化创建后刷新及重开可继续定位、编辑和删除。旧覆盖层测试保持清除选区后画布字形不变、缩放重投影、页面驱逐和关闭清理；暗色窄屏与阅读器布局用例仍在全套覆盖。
- 本地验证：最终 `npm test` 为 411 项、404 通过、0 失败、7 跳过；`npx playwright test --project=chromium` 为 134 项、123 通过、0 失败、11 跳过；随后增强图像夹具像素断言的专项 1/1 通过。`npm run check:portable` 为 52 required files、9 lifecycle scripts，通过；`git diff --check` 与所改 JavaScript 语法检查通过。7 项 Node skip 为 Windows 符号链接/POSIX 能力限制；Chromium skip 含可选私有样本和环境条件，不当作通过。浏览器全套先有 1 项手工覆盖层测试竞态失败，调整测试页帧时序后连续专项 3/3，第二轮及最终全套均 0 失败。
- 本阶段直接触及的路径：`app/ui/reader/annotations.js`、`e2e/pdf-reader.spec.js`、`e2e/start-server.js`、`tests/fixtures/pdf-fixtures.js`、`tests/reader-core.test.js`、`tests/dom-regression.test.js`，以及本计划、进度文档和本地 SDD ledger。其余工作区原有修改保持原样；没有生成新的 FPK。

### Review Focus 对照

| 焦点 | 本地证据 | 仍需设备/人工确认 |
| --- | --- | --- |
| 1. 多栏、重复、跨 Span/行/页几何 | 合成跨页/行/Span 单测，真实指针双页右侧双栏重复词 E2E；Canvas 不遮住再次选择。 | 用户实际排版复杂的多栏 PDF、跨页长拖选的视觉准确性。 |
| 2. 旋转、缩放、单双页和方向 | 0/90/180/270° × 50/100/200% 几何往返单测；Chromium 缩放、右页和窄屏回退。 | 真机旋转源文件和竖屏显示器的持续滚动检查。 |
| 3. 虚拟化、取消、快速切书与换源 | 页驱逐/返回、缩放帧及旧 generation 单测/E2E；API 真指纹变化测试＋浏览器 stale UI 模拟。 | 同一路径替换真实 PDF 后重扫，长时间快速切书/放大压力测试。 |
| 4. UID、双标签、原子写入与预算 | 两 UID 隔离；同 UID 并发 CRUD/EPUB 全量保存；模拟原子重命名失败和队列恢复；配额/白名单/2 MiB API 测试。 | fnOS 网关下两个真实标签页、不同真实用户的手工交叉验证。 |
| 5. EPUB/TXT 回归 | Node 全量和 Chromium EPUB 高亮、想法、导出、搜索、书签、选区颜色等既有用例。 | 升级 FPK 后在 NAS 的真实书籍回归。 |

- 经验反思：生命周期问题不能仅靠创建后的即时 UI 用例发现，必须在首帧尚未就绪时测试持久化恢复；测试夹具自身也要区分“空白 PDF”和“图像型 PDF”。模拟 stale API 只验证前端安全呈现，不能替代真文件替换后的来源校验。对异步页帧做测试注入时，应显式等待初始化并提交页帧，避免把测试时序竞态误判为绘制缺陷。
- 待 fnOS 验收：安装本次单独生成的包后，按真实多栏、跨页、图像型、旋转/缩放、来源替换、刷新恢复、两 UID/两标签与 EPUB 回归逐项核对；Task 5 本身没有部署到设备。

## Task 5 FPK 构建（用户单独请求，2026-09-25）

- 命令：`BABYREADER_BUILD_ID=20260925-pdf-annotations-task5 bash scripts/build-fpk.sh`（Git for Windows Bash）。
- 输出：`dist-fpk-20260925-pdf-annotations-task5/babyreader-fnos.fpk`，16,803,528 bytes；SHA-256 `B37B80A7EF4A56A581F50E907217F6F6D3D2F14F30D2BBDB3DDC8F181D443E44`。
- `build-provenance.json` 记录 manifest 版本 `1.1.7`、PDF.js `6.3.289`、源 commit `578785fb5d47e57309fa65a38e482ba12e7cdf72` 且工作区 dirty。包内目录核对确认 PDF 标注契约、UI 标注适配、PDF 几何与绘制模块、PDF.js 浏览器资源/服务端资源及 Apache-2.0 主许可证均存在；未见用户书籍文件。构建期间结构验证通过，依赖审计报告 0 vulnerabilities。
- `fnpack --help` 显示本机工具版本 1.2.3；provenance 将本机二进制摘要标为 unknown，因此包哈希以实际 FPK SHA-256 为准。本次只生成 FPK，没有安装或在 NAS 验收。

## 开源依据与取舍

- [Mozilla PDF.js](https://github.com/mozilla/pdf.js)：Canvas 与文本层分离，PDF 页 viewport 可在当前呈现坐标和原页坐标间转换；按本地锁定的 6.3.289 复核具体调用，不直接引入完整 Viewer。
- [react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter/blob/main/src/components/PdfHighlighter.tsx)：参考按页分段、逐行 `rects` 和缩放坐标往返；现有应用维持原生 JavaScript。
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)：有限引文和前后文辅助识别重复文本；PDF 坐标与文件版本是首要的可视定位条件。

## 待实施阶段的记录模板

```text
Task N — 日期：
改动范围：
RED：命令、预期失败、实际失败：
GREEN：命令、通过/失败/跳过数量：
接口/安全裁决：
仍需人工或设备确认：
下一阶段：
```
