# MOBI/AZW3 阅读与书籍导入开发计划

> **执行方式：** 按 Task 逐项执行，每项先写回归测试确认 RED，再实现到 GREEN；复选框（`- [ ]`）记录进度，证据写入 `docs/superpowers/progress/2026-09-30-mobi-and-book-import-progress.md`。

**状态：** 已规划，决策已确认，尚未执行（2026-09-30）。基线版本 v1.2.0（commit `5b95fa0`）。

**目标：**
1. 支持无 DRM 的 Kindle 格式（`.mobi`、`.azw`、`.azw3`）的扫描、阅读、进度、划线/想法、书签、全文搜索和 AI 问书。
2. 支持从浏览器把书籍（EPUB/MOBI/AZW3/PDF/TXT/Markdown）导入到应用共享目录，导入后立即出现在书库。
3. 两项功能都不能让现有 EPUB/PDF/TXT/Markdown 的任何行为回退。

**核心思路：** MOBI 不新建阅读器，而是在服务端把它**转换成规范化的派生 EPUB**，然后完整复用已有的 EPUB 链路（epub.js 渲染、`sanitizeEpubHtml`、`safeUnzip` 限制、章节窗口、划线定位、FTS、AI 章节理解）。导入功能只把文件写进应用自己的 fnOS 共享目录 `babyreader-fnos/library`，不写用户授权的目录。

---

## 1. 开源方案调研

| 方案 | 语言/许可 | 格式覆盖 | 运行环境 | 结论 |
| --- | --- | --- | --- | --- |
| [@lingo-reader/mobi-parser](https://github.com/hhk-png/lingo-reader/tree/main/packages/mobi-parser) 0.4.6 | TS/JS，MIT | MOBI6、KF8(AZW3)；元数据、目录、spine、封面、章节 HTML/CSS | Node 与浏览器均可；Node 端资源写入指定目录 | **首选候选**。依赖只有 `fflate`（项目已在用）和同仓库的 `@lingo-reader/shared`；2026-04 仍在更新。需要在 Task 0 验证：Node 端 CSS 是否以 blob URL 返回、DRM 标志怎么处理、HUFF/CDIC 压缩的性能 |
| [foliate-js](https://github.com/johnfactotum/foliate-js) `mobi.js` | JS，MIT | MOBI6（按 `<mbp:pagebreak>` 分章）、KF8（skeleton/fragment）；HUFF/CDIC | 面向浏览器，依赖 `DOMParser`/`Blob`/`URL` 等；上游自称"not stable" | **备选/参考实现**。如果 lingo-reader 不合格，就把 foliate-js 里纯算法部分（PDB/PalmDOC/HUFF/KF8 重组）移植到自研的 `mobi-format.js`，保留 MIT 署名；不引入 DOM 依赖 |
| foliate-js 整体作为浏览器第二套阅读器 | JS，MIT | 同上 | 浏览器 | **不采用**。要为 MOBI 另外实现划线、搜索、AI、进度、分页；服务端 FTS 也用不上浏览器解析结果，重复建设太多，风险面翻倍 |
| [KindleUnpack](https://github.com/kevinhendricks/KindleUnpack) / [mobi (PyPI)](https://github.com/iscc/mobi) | Python，GPL-3.0 | 最完整的 MOBI/KF8→EPUB 参考 | 需要 Python | **只作算法参考**。GPL 与本项目的许可不兼容，fnOS 上也不应引入 Python 运行时 |
| [libmobi](https://github.com/bfabiszewski/libmobi) | C，LGPL-3.0 | 完整，含加密检测 | 需要按 x86/ARM 分别编译原生二进制 | **不采用**。违背"应用依赖纯 JavaScript、同时适用于 x86 和 ARM"的项目约束 |
| Calibre `ebook-convert` | Python/C++，GPL | 最完整 | 体积大、原生依赖多 | **不采用** |

**范围边界（首版明确不做）：**
- 带 DRM 的 Kindle 文件：只检测并明确提示"受 DRM 保护，无法阅读"。不做任何解密，也不给解密方法。
- KFX（`.kfx`/`.azw8`）和 Print Replica（`.azw4`，内含 PDF）：本质上是不同的格式。
- 反向转换（EPUB→MOBI）、导出、在线书城。

## 2. 架构设计

### 2.1 MOBI：派生 EPUB

```
扫描（轻量）                     首次打开 / 搜索 / AI（按需）
.mobi/.azw3 ──读 PDB/MOBI/EXTH 头──> library.json   ──> 转换 worker（限时、限内存）
            （标题/作者/封面/DRM）   type:"mobi"          │
                                                           ▼
                           ${TRIM_PKGVAR}/derived/<bookId>.<源指纹摘要>.c<转换器版本>.epub
                                                           │
            现有 EPUB 链路（内容接口 / epub.js / FTS / AI）<─┘
```

- **索引里记录真实格式**：`type: "mobi"`，另记 `sourceFormat: "mobi6" | "kf8"`。**对外 API** 映射为 `type: "epub"`、`format: "mobi"|"azw3"`，前端阅读器不用改。这样降级时旧版本会因为不认识 `.mobi` 扩展名而直接跳过它们，不会把 MOBI 字节当成 EPUB 发给浏览器。
- **服务端只有 4 处读书籍文件**，统一改为 `resolveBookContent(book)` → `{ path, epubLike }`：
  1. 内容接口 `index.js:1896`；
  2. `ai-fts.js:107`（解析）和 `:295`/`:515`（索引键和指纹）；
  3. `ai-book-context.js:94`；
  4. `findBook` 仍然每次都对**源文件**做授权校验。派生文件只在源文件授权通过之后才会被读取。
- **按 EPUB 分支判断的地方**（`ai-fts.js:108/160`、`ai-book-context.js:95/131-140`、`book-search.js`）改用 `isEpubLike(book)`。解析器版本键改成 `epub:<v>+mobi:<转换器版本>`，转换器升级时 FTS 会自动重建。
- **派生 EPUB 的硬性要求：**
  - **可复现**：条目顺序固定、时间戳固定，同样的输入逐字节产出同样的 EPUB。
  - **章节文件名永久稳定**：`text/part-0001.xhtml` 这种编号规则一旦发布就不能改，因为划线靠 `chapterHref` 加上下文定位。转换器升级如果会改变分章，必须提供旧 href 到新 href 的迁移，否则不许发布。
  - **结构**：`mimetype` 放第一个且不压缩；OPF 包含元数据和封面；同时提供 `nav.xhtml` 和 NCX 目录。
  - **链接改写**：MOBI6 的 `filepos` 链接改写为 `part-NNNN.xhtml#fpNNN`；KF8 的 `kindle:pos`/`kindle:embed` 改写为包内相对路径。
  - **不做额外 HTML 清理**：清理交给现有前端的 `sanitizeEpubHtml`。但转换器要丢弃 `<script>`、外链资源和嵌入字体以外的可执行内容，并通过 `safeUnzip` 的现有上限。
  - **原子写入**：先写 `.tmp`，fsync 后再 rename，文件权限 0600。
- **转换在 `worker_threads` 中进行**，参照 `pdf-text-worker.js`：`resourceLimits`、超时终止、全局并发 1、按 bookId 做 single-flight。转换还没完成时，内容接口返回 `409 {status:"preparing"}`，前端显示"正在准备这本书…"并自动重试。
- **缓存回收**：扫描结束后，和 covers 一样按"当前书库仍存在的 bookId 和指纹"清理 `derived/`。AI 索引管理器删除某本书的索引时，不动派生 EPUB。

### 2.2 书籍导入

- **写到哪里**：`TRIM_DATA_SHARE_PATHS` 中的 `babyreader-fnos/library/导入/`。这个目录已在 `config/resource` 声明，应用用户对它有写权限，也已经参与扫描；用户还能在 fnOS 文件管理器里整理这些文件。**永远不写用户自己授权的目录。**
- **协议**：`PUT /api/library/imports`，请求体就是文件原始字节。文件名放在 `X-BabyReader-Filename` 头里（先 URI 编码），必须带 `Content-Length`；不解析 multipart，不新增依赖。
- **写入流程**：
  1. 边接收边计数，超过上限立即返回 413 并删除临时文件；
  2. 写入 `.babyreader-import-<uuid>.part`（`wx`、0640）；
  3. fsync 后校验文件魔数：EPUB 的 `mimetype` 条目加 `safeUnzip` 检查、PDF 头、MOBI 在偏移 60 处的 `BOOKMOBI` 且无 DRM、TXT/MD 为合法 UTF-8；
  4. 清理文件名：去掉路径分隔符和控制字符，限制长度，只允许白名单扩展名；
  5. 重名时加后缀 `(2)`；
  6. 最后 rename 到正式文件名。
- **去重**：按内容 SHA-256 判断。书库中已有同样内容的书时，返回 `409 {bookId}`，前端直接定位到那本书。
- **入库**：新增 `indexSingleFile(path)`，复用 `scanLibrary` 的单文件逻辑，只把这一本书合并进 `library.json`，不触发全库重扫。之后沿用现有扫描锁，避免和正在进行的扫描互相覆盖。
- **权限**：首版**仅管理员**（`X-Trim-Isadmin`）可以导入，因为书库是所有用户共享的，普通用户导入会影响别人的书架。不提供"允许所有用户导入"的选项（已确认）。
- **防跨站请求**：必须带自定义头 `X-BabyReader-Request: import`，并校验 `Origin`/`Sec-Fetch-Site` 为同源。原始 PUT 请求配合自定义头，跨站时会先触发 CORS 预检，因而无法被跨站页面伪造。
- **前端**：
  - 书库工具栏新增"导入"按钮，按钮顺序变为"新建分类 → 导入 → 重新扫描 → 整理"，需要同步修改设计契约和 DOM 测试；
  - 支持把文件拖到书库页面上导入；
  - 逐个文件显示上传进度（XHR `upload.onprogress`），完成后给出结果汇总：成功、重复、DRM、格式不支持、过大；
  - 在某个分类页里导入时，调用现有的归类 API 把书放进当前分类；
  - 上传中途取消会中止请求，服务端清理临时文件。

### 2.3 开关与默认值

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| `BABYREADER_MOBI_ENABLED` / wizard「启用 MOBI/AZW3 阅读」 | 关 | 做法同 PDF：关闭时 `.mobi` 仍被扫描计数，书库显示"另有 N 本 MOBI…"，但不出现在书架上，也不能打开 |
| `BABYREADER_IMPORT_ENABLED` / wizard「允许管理员导入书籍」 | 关 | 关闭时导入按钮不出现，接口返回 404 |

两个开关互相独立。关闭任何一个都相当于回到 v1.2.0 的行为。

### 2.4 资源上限（Task 0 在 NAS 实测后冻结，下表为初值）

| 项 | 初值 |
| --- | --- |
| MOBI/AZW3 源文件 | 64 MiB |
| 解压后的正文总量 | 48 MiB |
| 单张图片 / 图片总量 | 8 MiB / 128 MiB |
| PDB 记录数 | 65,535（格式上限）；大于 20,000 时拒绝 |
| 单次转换时间 / worker 堆内存 | 60 s / 256 MiB |
| 派生缓存总量 | 2 GiB，按最近访问时间淘汰 |
| 导入单文件 | EPUB/MOBI 64 MiB、PDF 256 MiB、TXT/MD 32 MiB（沿用 `MAX_TEXT_BYTES`） |
| 导入并发 | 每个用户 1 个、全局 2 个 |

## 3. 稳定性保障

1. **基线冻结**：
   - 单元测试：542 项，533 通过、0 失败、9 跳过；
   - Chromium E2E：131 通过、9 失败、26 跳过，9 个失败名单见 CHANGELOG v1.2.0；
   - 书库组织专项：23/23。

   每个 Task 都必须**不新增失败**。如果顺手修好了既有失败，记录下来，但不作为本计划的验收条件。
2. **现有代码路径尽量少改**：EPUB/PDF/TXT 的扫描、内容读取、阅读器都保持原样。只在 `resolveBookContent`、`isEpubLike` 这两处加间接层，而且这两处都有"EPUB 走原路径"的回归测试。
3. **开关默认关闭**，NAS 验收通过后再在 wizard 里打开。
4. **可回退**：
   - 关闭开关后，MOBI 书从书架上隐藏，但用户数据（进度、划线）按 bookId 保留，重新打开开关即可恢复；
   - `derived/` 可以随时删除，下次打开时会重新生成；
   - 导入的文件是共享目录里的普通文件，回退版本后依然能被扫描和阅读。
5. **升级/降级**：`library.json` 只新增字段。旧版本会忽略 `.mobi` 文件和 `derived/` 目录。
6. **测试夹具**：不提交任何用户书籍或受版权保护的书。MOBI6 夹具由测试代码自己生成（PDB + PalmDOC 压缩 + EXTH）；KF8 和 HUFF/CDIC 夹具的来源在 Task 0 决定，可选的是：自研生成器，或者采用许可明确的开源测试样本，并附上许可证。

## 4. 任务分解

### Task 0：基线、选型验证与设备探测（约 2 天）

- [ ] 在本地记录上面的测试基线，建立进度文件。
- [ ] 编写 `tests/fixtures/mobi-fixtures.js`，生成以下样本：
  - MOBI6：无压缩、PalmDOC 压缩；多章节，含 `filepos` 链接和一张图片；
  - DRM 标志文件（加密类型为 2）；
  - 截断/损坏文件；
  - 非 BOOKMOBI 的 PDB 文件。
- [ ] 确定 KF8 和 HUFF/CDIC 夹具的来源。
- [ ] 对 `@lingo-reader/mobi-parser` 做选型验证（spike），检查以下几点：
  - Node 22 下只用 `Uint8Array` 输入就能工作；
  - 不访问网络、不使用 `eval`；
  - 资源能写到指定目录，并且可以取回；
  - 遇到 DRM 时怎么表现；
  - 夹具的解析结果是否正确；
  - 在 NAS 的 Node v22.18 上，解析 10/50 MiB 样本的耗时和峰值 RSS。
  
  如果不合格，改为移植 foliate-js 的算法并自研（工期 +3 天）。
- [ ] NAS 网关上传探测，确认以下三点：
  - 统一网关允许的最大请求体、超时时间，以及是否支持流式转发 PUT；
  - `babyreader-fnos/library` 共享目录对应用用户可写；
  - 写入后，文件管理器中显示的属主/ACL 情况。

  如果网关对请求体有限制，就改为分片上传（`PUT ...?offset=`），并相应调整 Task 4。
- [ ] 冻结资源上限，在进度文件中记录选型结论和许可证。

### Task 1：MOBI 扫描与元数据（约 1.5 天）

- [x] 新建 `app/server/mobi-format.js`，内容全部是纯函数：
  - 解析 PDB 头、MOBI 头和 EXTH，只读前 64 KiB 加上 EXTH 中指向的封面记录；
  - 识别 MOBI6 与 KF8（包括混合文件里的 KF8 边界）；
  - 从 MOBI 头的加密类型检测 DRM。
- [x] `library.js` 的 `SUPPORTED_EXTENSIONS` 增加 `.mobi`、`.azw`、`.azw3`。扫描时：
  - 不解压正文，只写入 `type:"mobi"`、`sourceFormat`、标题、作者、语言，并把封面写入 covers；
  - DRM 文件作为错误项记录"受 DRM 保护"，不影响其他书籍。
- [x] 开关关闭时，与 PDF 一样隐藏并统计 `hiddenMobiCount`。
- [x] 测试：`tests/mobi-format.test.js`，另在 `tests/reader-core.test.js` 中补充"扫描混合格式书库，EPUB/PDF/TXT 条目逐字段不变"。

### Task 2：MOBI→EPUB 转换器（约 3 天）

- [ ] 新建 `app/server/mobi-convert.js`，负责按 2.1 的要求把 MOBI 组装成确定性的 EPUB：
  - MOBI6：按 `<mbp:pagebreak>` 分章，改写 `filepos`，把 `recindex` 图片替换为包内路径；
  - KF8：用 skeleton 加 fragment 重组章节，保留 CSS，改写 `kindle:embed`/`kindle:pos`；
  - 目录优先取 NCX/INDX 索引；没有目录时按章节生成"第 N 部分"。
- [ ] 新建 `app/server/mobi-convert-worker.js`：限制资源、超时后终止、single-flight、原子写入、按转换器版本命名缓存文件。
- [ ] 测试：
  - 同一输入两次转换产出的字节完全相同；
  - 章节 href 与已发布的命名规则一致（写成快照测试）；
  - 超时和超限时终止 worker，并清理临时文件；
  - 产物能通过 `safeUnzip` 和现有 EPUB 元数据提取；
  - 恶意输入（循环 fragment、超大记录数、非法偏移）会失败，而不是挂起。

### Task 3：接入阅读、搜索与 AI（约 2 天）

- [ ] `index.js`：
  - `findBook` 在源文件授权通过后，通过 `resolveBookContent` 取得派生 EPUB；
  - 转换中的书返回 `409 preparing`；
  - `publicBook` 对外把 MOBI 映射为 `type:"epub"` 加 `format`。
- [ ] `ai-fts.js`、`ai-book-context.js`、`book-search.js` 改用 `isEpubLike`；解析器版本键包含转换器版本。
- [ ] 前端：
  - `libraryBookFormatLabel` 增加 MOBI/AZW3；
  - 打开时收到 `preparing` 状态，就显示可访问的等待提示，并按退避策略重试；
  - 进度、划线、书签、导出沿用 EPUB 的实现，不做改动。
- [ ] 测试：
  - API 层面：MOBI 书的内容接口返回 EPUB，指纹变化后自动重建；
  - E2E（新增 `e2e/mobi-reader.spec.js`）：打开、翻章、划线、刷新后恢复、全文搜索命中后精确跳转；
  - 全量回归：EPUB/PDF 用例全部保持原有结果。

### Task 4：导入后端（约 2 天）

- [ ] 新建 `app/server/book-import.js`，实现 2.2 中的流式写入、魔数校验、文件名清理、去重、原子重命名、`indexSingleFile`、并发和大小限制。
- [ ] 路由：`PUT /api/library/imports`。依次校验：管理员身份、开关、同源、自定义头；再加上 `Content-Length` 和格式上限。
- [ ] 测试（`tests/book-import.test.js`），覆盖以下情况：
  - 超限时返回 413 并清理临时文件；
  - 客户端中途断开后临时文件被清理；
  - 伪造扩展名（例如把 exe 改名为 `.epub`）被拒绝；
  - 文件名含 `../`、控制字符或超长时被拒绝；
  - 重名文件自动加后缀；
  - 内容重复时返回 409；
  - DRM 的 MOBI 被拒绝；
  - 非管理员请求返回 403；
  - 跨站请求被拒绝；
  - 导入与全库扫描并发时不会互相覆盖 `library.json`；
  - 共享目录不可写时给出明确错误。

### Task 5：导入前端（约 1.5 天）

- [ ] 书库工具栏加入"导入"按钮（仅管理员且开关开启时出现），用隐藏的 `<input type=file multiple accept=...>` 选择文件，并支持拖拽到书库页面。
- [ ] 导入队列面板：显示每个文件的进度条和结果；错误文案要可操作，例如"文件受 DRM 保护""超过 64 MB""书库中已有这本书（查看）"；可取消上传。
- [ ] 在分类详情页导入时，自动放入当前分类。
- [ ] 同步更新 `docs/library-home-design-contract.md`、DOM 测试和 E2E（`e2e/book-import.spec.js`）。

### Task 6：FPK 审计、NAS 验收与开关决策（约 1.5 天）

- [ ] 确认派生缓存目录、导入目录和 worker 文件都打进了包，并且已写入 `build-provenance.json`。
- [ ] 按 CONTRIBUTING 发布 v1.3.0，两个开关保持默认关闭。
- [ ] 在 `docs/FNOS_DEVICE_ACCEPTANCE.md` 中新增以下验收项，分别在 x86_64 和 ARM64 上执行：
  - MOBI 扫描、打开、转换耗时与 RSS；
  - DRM 提示；
  - 通过网关上传的大小上限；
  - 共享目录的写入与 ACL；
  - 导入文件在文件管理器中可见；
  - 两个用户的书库可见性；
  - 从 1.2.0 升级、降级回 1.2.0 两种路径。
- [ ] 验收通过后，在 wizard 中把开关改为默认开启，另发一个补丁版本。

**总工期估算：** 约 13–14 个工作日。如果 Task 0 否决了 lingo-reader，改为自研解析器，需再加约 3 天。

## 5. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 第三方解析器对 KF8/HUFF 支持不完整或太慢 | 部分书打不开或打开很慢 | Task 0 用真实规模的样本测性能；按需转换并缓存；失败时明确提示并保留原文件 |
| 转换器升级改变章节划分 | 已有划线定位失效 | 章节 href 命名规则冻结，并用快照测试锁住；改变分章必须附带迁移 |
| 恶意或损坏的 MOBI 让服务卡死或内存耗尽 | 所有用户受影响 | 转换在 worker 中进行，有资源上限、超时和并发 1 的限制，并用模糊测试样本覆盖 |
| fnOS 网关对上传大小有限制 | 大文件无法导入 | Task 0 实测；必要时改用分片上传 |
| 导入的书被所有用户看到 | 隐私和秩序问题 | 首版仅管理员可导入；是否支持按用户私有导入，另行设计（涉及书库数据模型） |
| DRM 相关的合规风险 | 法律风险 | 只做检测和提示，不做解密，也不引导用户去解密 |

## 6. 已确认的决策（2026-09-30）

1. **导入权限：仅管理员。** 不提供“允许所有用户导入”的开关；按用户私有导入不在本计划范围内。
2. **MOBI 解析器：先用 `@lingo-reader/mobi-parser`。** 固定精确版本；只有 Task 0 验证不通过时才改为移植 foliate-js 算法自研，并在进度文件中记录否决理由。
3. **版本节奏：MOBI 与导入一起在 v1.3.0 发布**，两个开关默认关闭，NAS 验收通过后再另发补丁版本默认开启。
