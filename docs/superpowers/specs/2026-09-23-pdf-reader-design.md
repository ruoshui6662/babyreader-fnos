# PDF 阅读支持设计

**状态：** 待用户审阅；本文件仅冻结产品与架构契约，不授权代码实现、依赖安装、构建或发布。

**日期：** 2026-09-23

## 1. 目标与首版范围

为 BabyReader 增加本地 PDF 阅读能力。PDF 由现有书库扫描发现，必须仍受 fnOS 授权目录和网关身份约束；浏览器端使用本地打包的 Mozilla PDF.js 渲染，继续复用 BabyReader 阅读外壳、工具区、抽屉、主题与用户级阅读状态；全文搜索继续使用服务器本地 FTS，不把 PDF 正文发送给云端。

首版范围：

- 扫描并打开授权书库中的 `.pdf` 文件；支持常见 PDF 页面渲染和可选文本层。
- 阅读控制：上一页/下一页、页码跳转、页码状态、适合宽度/缩放、纵向连续阅读和 PDF 自带目录（Outline，若存在）。
- 恢复当前用户的 PDF 阅读页位置；不覆盖或改变 EPUB CFI 和文本阅读位置语义。
- 页内查找和全书搜索。可提取文本的 PDF 使用本地 FTS 索引；搜索结果可跳到对应页和可确认的命中位置。
- 对扫描影像型、无文本层 PDF 明确显示“此 PDF 没有可搜索文本”，不假装搜索完整。
- 加密/损坏/不支持的 PDF 返回可恢复的受控错误；首版不承诺密码输入、OCR 或表单填写。

明确不在首版：

- OCR、PDF 文件编辑/转换/导出、批注写回 PDF。
- BabyReader 的 PDF 划线/想法、独立书签和 AI 问书；这三项留待后续单独设计，不能因为增加 PDF 格式而扩大已有 EPUB/文本功能的行为。
- 任意 URL、NAS 任意路径、用户上传、第三方在线转换或远程 PDF 服务。
- 执行 PDF 内嵌 JavaScript、自动执行动作、自动打开外链、脚本化表单和附件。

## 2. 当前实现基线与约束

- `app/server/library.js` 当前只识别 EPUB、Markdown 和 TXT；EPUB 元数据/封面解析与文本元数据解析分支不同。扫描必须增加 PDF 专用分支，不得把 PDF 字节读成 UTF-8 文本。
- `app/server/index.js` 通过 `findBook(bookId)` 重新验证库索引和授权路径；当前内容端点读取完整文件并以单一响应发送。大 PDF 必须先加入受控 HTTP Range 读取，不能照搬整文件缓冲。
- `app/ui/core/state.js` 的 `contentType` 当前只有 `text`/`epub`；`app/ui/app.js` 与 `app/ui/core/api.js` 的 open/receive 生命周期也是 EPUB/文本双路。新增 `pdf` 类型应使用独立 adapter 生命周期，不能把 PDF 当文本或伪装成 EPUB。
- `app/server/ai-fts.js` 的 `readBookChapters()` 对所有非 EPUB 输入按 UTF-8 文件读取。PDF 必须有专用的页面文本提取策略和 parser version；不满足提取预算时不得沿用旧“纯文本”分支。
- `app/ui/reader/search.js` 目前理解 EPUB 章节和文本定位；PDF 搜索结果需要单独的 `pageIndex`/页内偏移定位，不能误套 EPUB chapter index 或 CFI。
- 书库扫描、静态资源服务、reader UI、FTS、进度恢复和 FPK 清单均有回归覆盖。新增 PDF 的所有分支必须以格式类型显式区分，保持既有 API 与 DOM 契约向后兼容。
- 当前工作区存在其他未提交改动。后续实现应只在明确的隔离/审阅边界中修改 PDF 所需文件，不得顺带提交或覆盖无关改动。

## 3. 方案与架构

### 3.1 采用方案

采用 PDF.js Display API/本地 Worker 做浏览器端解析和渲染；BabyReader 自有一个 PDF reader adapter/surface，复用现有 shell 与视觉系统。第一版不直接嵌入 PDF.js 未修改的完整默认 Viewer，也不依赖浏览器原生 PDF 插件，从而统一返回书库、主题、工具区、搜索面板和阅读状态行为。

PDF.js 主库和 Worker 必须来自同一精确版本的本地构件。将需要的 worker、浏览器解析模块及其必需的 CMap/标准字体/WASM 资源作为受审计 vendor 集合纳入包；不使用 CDN。引入前验证目标 fnOS 浏览器对该版本、模块格式、Worker 和资源 MIME 的支持。PDF.js 的第三方许可证、NOTICE/归属文件以及构建来源随应用分发。

### 3.2 文件读取和渲染流

1. 书架只提交既有 64 位十六进制 `bookId`，不得提交路径或 URL。
2. 服务端调用 `findBook(bookId)` 并再次经过 `resolveAuthorizedPath()`，只打开当前书库索引中仍处于已授权根目录内的常规文件。
3. PDF.js 通过同源 `/api/books/:bookId/content` URL 按需读取；内容端点支持单一合法 byte range，正确处理 `Range`、`206 Partial Content`、`Content-Range`、`Accept-Ranges`、`416` 和无 Range 的兼容 GET。首版拒绝 multipart ranges；每次请求都重新验证身份、bookId 和授权路径，不把 URL 当访问令牌。
4. 服务端以文件流回送所需区间，不为 Range API 把整本 PDF 读入内存；响应使用私有、不可共享缓存策略和 `X-Content-Type-Options: nosniff`。
5. PDF.js 使用 Worker 解析。视图采用纵向页面流，仅渲染可见页及有限邻页；切书、关闭或销毁时取消 loading/render task，释放 Canvas、页面缓存和 Worker/document 资源。所有可调页数、缩放、Canvas 像素面积、并发渲染数、文件大小和加载时间限制必须有显式上限。
6. PDF 的布局由 PDF 专用 surface 负责；不重排 EPUB 的 chapter window、双页分页、标注层或章节导航。首版 PDF 使用纵向连续页流；全局阅读设置不得意外把 PDF 切成 EPUB 双页分页。

### 3.3 搜索与索引流

- 复用每书本地 FTS 基础设施，但为 PDF 添加专用解析器和 parser/index version。FTS 记录按 PDF 页组织，保留稳定的 page index、可用于检索排序的页内文本偏移和文本抽取状态。
- 优先在服务端使用锁定版本的 PDF.js 解析已授权本地文件；不信任客户端提交的抽取文本作为索引源。PDF.js Node/legacy 构件、Node 22 支持、worker/字体资源与内存边界必须先在 Task 0 验证；如 Node 端 PDF.js 不满足包体或内存预算，应在实现前回到设计审查，不能临时改为无认证上传文本。
- 搜索复用现有查询长度、结果分页、响应大小、取消和索引生命周期约束。搜索命中 locator 采用 `{ type: 'pdf', pageIndex, textOffset, quote/context }` 一类受限结构；`pageIndex` 在 API、索引和持久化中统一为从 0 开始的整数，显示页码统一为 `pageIndex + 1`。`textOffset` 在经过明确版本化的规范化页文本中计数，不将原文或整页文本放入 locator；implementation plan 的 Task 0 需与现有搜索 API 核对剩余字段和上下文长度。
- 命中导航顺序：验证 bookId 和当前文档 generation；跳到目标页；等待页面 text layer 完成；使用页内 offset/context 复核目标；仅在可确认时显示短暂搜索命中样式。若文本顺序或 OCR 缺失导致无法精确确认，应跳页并说明“仅定位到页面”，不把整页蓝框伪装成精确命中。
- 不增加 AI 调用、不把搜索内容发出本机、不输出全文或查询片段到日志。AI 支持需要后续独立设计与授权。

### 3.4 阅读状态与后续扩展

- PDF 定位以 0-based `pageIndex` 作为 API、FTS 和持久化的唯一规范；UI 页码显示为 `pageIndex + 1`。非法、缺省和越界页回退到第 1 页（存为 `pageIndex: 0`），并保持 FTS 文本偏移基于确定版本的规范化页文本。
- 阅读状态按现有 Gateway UID 隔离；刷新、返回书库再打开、切换用户后恢复对应状态。PDF zoom 可先采用每用户阅读偏好，不要求写回 PDF。
- PDF 标注/书签后续应建立格式化 locator adapter，不扩张或误读现有 EPUB `cfiRange` 和文本 DOM path。

## 4. 安全边界

### 输入与授权

- PDF 仅从书库扫描得到；扫描只处理 `libraryRoots`/fnOS 当前授权目录，并继续拒绝符号链接、路径穿越及越界 realpath。
- 内容和 Range 路由必须保持网关注入用户身份；每个请求均重新调用 `findBook()` 并验证授权路径和常规文件属性。客户端不可指定本机路径、任意文件 URL、任意 HTTP URL 或 range 源。
- 扫描阶段不得对每个 PDF 无界读取全文。文件类型/签名检查、元数据提取、索引构建的读取预算分别定义；达到预算则标记不可索引/受控错误，不能阻塞整库扫描。

### 解析与主动内容

- PDF 是不可信、可恶意构造的输入。使用仍受维护、锁定版本并修复已知高危漏洞的 PDF.js；渲染配置显式 `isEvalSupported: false`。首版禁用 PDF JavaScript、自动动作、脚本沙箱、自动网络加载、外部附件和嵌入媒体；链接默认不自动跟随。
- PDF.js Worker、UI 与文档均在同源应用安全策略之内。资源仅从 FPK 本地文件加载；不允许 CDN、远程字体、外部 CMap 下载或文档提供的任意资源地址。
- 保持 CSP 最小权限；新增 Worker/module MIME 类型前需确认只对所需本地资源生效，不扩大 `connect-src`、`script-src` 或跨源策略。PDF 文本层应按纯文本节点创建，不用未经清理的 PDF 字符串拼接 `innerHTML`。
- PDF.js 已有关于恶意 PDF 在旧配置下触发任意 JavaScript 执行的公告；防护不能只依赖当前 PDF.js 修复，需保留关闭 eval 的显式设置与恶意夹具回归。

### 资源、隐私和故障

- 为单文件字节、Range 大小、并行 Range 数、解析时长、页数、单页 Canvas 像素、邻页缓存、每页抽取字符数、整书索引字符/耗时/内存制定上限。限值在合成测试及目标 fnOS 设备基准后确定，不用无界常量或单纯依赖用户浏览器 OOM 保护。
- 密码保护、截断、损坏、超资源 PDF 必须返回用户可理解的受控错误，释放临时资源；失败不得使服务进程、阅读器 shell 或其他书籍的索引失效。
- 阅读、解析、索引、搜索过程不采集正文、完整文件名、路径或查询文本到日志；测试只用人工生成的微型 PDF fixture，不提交真实书籍。
- 数据只保留在已授权 NAS 与 UID 隔离存储；不上传、遥测或远程 AI 处理。

## 5. 实施阶段与验收门

以下为设计阶段的阶段边界，具体任务、测试命令、文件清单和步骤须在 spec 获批后写入 implementation plan；每阶段验收后再进入下一阶段。

| 阶段 | 目标 | 主要验收门 |
| --- | --- | --- |
| Task 0：能力、预算与契约冻结 | 验证 fnOS 浏览器、PDF.js browser/Node 构件、MIME/Worker/CSP、Range 代理行为；确定资源上限、加密/表单/无文本策略、页 locator 和可回滚开关。 | 小/大/多页/坏/加密/扫描 PDF 基准；不执行生产逻辑改动。 |
| Task 1：书库与安全内容 API | PDF 识别、最少元数据、受授权 bookId 内容读取、受限 Range 与内容类型。 | 书库扫描只新增 PDF；A/B 用户和越权路径拒绝；`206/416` 边界、HEAD/普通 GET、并发和大文件资源测试；既有格式回归。 |
| Task 2：PDF.js vendor 与阅读 surface | 本地依赖、Worker/资产/许可证、PDF 生命周期、连续页渲染、工具栏控制。 | 目标 Chromium E2E 覆盖打开、翻页、缩放、目录、快速切书/关闭/取消、暗色和窄屏；检查 Canvas/Worker 释放。 |
| Task 3：阅读状态与路由恢复 | PDF page locator、刷新/关闭重开/前进后退恢复。 | 边界页、坏 locator、不同用户隔离；EPUB/Text 阅读进度和 URL 不变。 |
| Task 4：PDF 文本与本地 FTS 搜索 | 服务端 PDF 页文本提取、版本化索引、页内/全书搜索及精确导航。 | 有文本/无文本/重复词/多栏/中文文本；全文覆盖、分页、精确定位、取消、索引更新及预算超限；无 AI 或外网请求。 |
| Task 5：FPK、升级与设备验收 | 结构检查、依赖/许可证溯源、包内资源核验、fnOS 安装/升级回滚。 | FPK 不含真实用户 PDF、密钥或临时样本；在目标 NAS 上测大型书冷开/翻页/搜索内存并记录结论。 |

## 6. 回归、不变式和回滚

- EPUB、Markdown、TXT 的书籍 ID、封面、阅读进度、翻页、搜索、标注、书签、AI 会话、AI 索引与书库分类 API 不改变。
- PDF parser/index version 仅影响 PDF 索引；若现有 SQLite schema 不必更改，不升级公共 schema。确需 schema 升级时，先设计只前滚可恢复的迁移、备份和失败回滚，再开始实现。
- FTS PDF 行必须能删除/重建而不影响 AI/搜索共享索引中其他书籍记录；错误索引不能部分发布，复用现有安全原子发布/锁和文件权限契约。
- 保留 PDF feature flag 或等价 fail-closed 发布控制，默认状态及启用时机由 Task 0 结合 FPK 与真机验收冻结。关闭 PDF 功能不能隐藏、损坏或重写原有书籍数据。
- 每项实现先增加失败测试，再作最小修改；完成单元/DOM/API/E2E、结构检查、依赖安全和构件审计后方可生成候选 FPK。未通过真机验收不得称为 fnOS 正式可用。

## 7. 开源调研依据

- [Mozilla PDF.js README](https://github.com/mozilla/pdf.js)：项目定位、维护方式、浏览器集成及 `pdfjs-dist` 分发说明。
- [PDF.js 官方示例](https://mozilla.github.io/pdf.js/examples/)：`getDocument`、Worker、按页获取和 Canvas viewport 渲染调用模型。
- [PDF.js 官方 FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)：建议只渲染可见页面；在浏览器与服务端支持条件满足时使用 HTTP Range 减少大文件首屏传输。
- [PDF.js Releases](https://github.com/mozilla/pdf.js/releases)：发布版本与升级核验来源；落地时锁定经过本项目兼容性和安全评估的确切版本，不盲目跟踪 latest。
- [PDF.js LICENSE](https://github.com/mozilla/pdf.js/blob/master/LICENSE)：随 vendor 构件核对并保留第三方许可证/通知。
- [PDF.js GHSA-wgrm-67xf-hhpq / CVE-2024-4367](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)：高危不可信 PDF JavaScript 执行风险、修复范围和 `isEvalSupported: false` 防御依据。

以上仅用于借鉴和风险建模；首版不引入在线服务、转换 SaaS 或其他 PDF 引擎依赖。
