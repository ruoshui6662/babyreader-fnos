# MOBI/AZW3 阅读与书籍导入执行记录

计划：[2026-09-30-mobi-and-book-import.md](../plans/2026-09-30-mobi-and-book-import.md)。分支：`feat/mobi-import`（基于 `main` 的 `db3b4e5`）。

## Task 0：基线、选型验证与设备探测

状态：**本地部分已完成；NAS 探测和 KF8 样本待定**（2026-09-30）。

### 测试基线（v1.2.0，commit `5b95fa0`，Windows / Node v24.20.0）

| 套件 | 结果 |
| --- | --- |
| `npm test` | 542 项：533 通过、0 失败、9 跳过（Windows 符号链接权限与 POSIX 专属检查） |
| Chromium E2E | 131 通过、9 失败、26 跳过。既有失败：`highlights.spec.js` 2 项；`pdf-reader.spec.js` 4 项（封面 2 项仅在全量运行时失败，单独运行通过）；`reader.spec.js` AI 面板 3 项 |
| 书库组织专项 | 23/23 |

判定规则：后续每个 Task **不得新增失败**；修好既有失败要记录下来，但不作为本计划的验收条件。

加入 Task 0 的夹具自检后：`npm test` 546 项，537 通过、0 失败、9 跳过。

### 夹具

- `tests/fixtures/mobi-fixtures.js`：按真实磁盘结构生成 MOBI6，包括 PDB 头、PalmDOC record 0、MOBI 头（232 字节）、EXTH（100/503/524/201）、全名、PalmDOC 压缩文本记录（3 字节哈希链 LZ77）、图片记录和 EOF 记录。另外提供以下变体：
  - DRM（加密类型为 2）；
  - 截断文件；
  - 非 BOOKMOBI 的 PDB；
  - 可调大小的大样本。
- `tests/mobi-fixtures.test.js`：用**独立实现的参考 PalmDOC 解码器**，校验以下内容，确保生成器本身是正确的，再拿它去评估第三方解析器：
  - 压缩往返一致；
  - 头部字段正确；
  - `filepos` 指向目标章节的 `<h1>`；
  - 各变体只在预期的位置与正常样本不同。
- 不包含任何真实书籍。

### `@lingo-reader/mobi-parser@0.4.6` 选型验证

**许可与依赖**：
- 本包 MIT，`@lingo-reader/shared` MIT；
- 间接依赖：`events` MIT、`path-browserify` MIT、`sax@1.6.1` BlueOak-1.0.0（宽松许可）；
- `fflate` 与项目已有依赖共用；
- `npm audit` 0 个漏洞；
- 源码中没有 `eval`、`new Function`，也没有网络访问。

**正确性**（生成的 MOBI6 样本，PalmDOC 与不压缩两种）：
- 元数据正确（标题、语言；作者以数组返回）；
- 按 `<mbp:pagebreak>` 分章正确（目录页算作 1 章，共 4 章）；
- 能从 guide 中的 toc 解析出目录，得到 `filepos:N`；
- 中文没有乱码；
- 图片被写入指定目录。

**发现的缺陷**（必须处理后才能使用）：

| # | 问题 | 证据 | 处理 |
| --- | --- | --- | --- |
| 1 | 包的 `main` 指向发布包中不存在的 `src/index.node.js`；`exports.require` 指向的 `.js` 文件是 CommonJS 语法，但包声明了 `"type":"module"`，所以在 CommonJS 里 `require` 会直接失败 | 两次加载报错（MODULE_NOT_FOUND、ERR_REQUIRE_ESM 类错误） | 只能加载 ESM 构建（`dist/index.node.mjs`） |
| 2 | **不检查 DRM**：加密字段读出来了，但没有任何判断 | DRM 样本照常"解析" | 由我们自己的 `mobi-format.js` 在调用前拒绝 |
| 3 | **截断文件静默返回残缺内容**（4 章变 1 章，不报错） | truncated 样本 | 调用前校验记录表偏移、记录数和文件长度 |
| 4 | 不校验 PDB 的 type/creator，非 MOBI 文件也会被接受 | `TEXtREAd` 样本 | 调用前校验 `BOOKMOBI` |
| 5 | `<img>` 缺少 `recindex` 属性时抛出 TypeError，整本书打不开 | `img-without-recindex` 样本 | 修补：跳过没有 recindex 的 img |
| 6 | 资源索引不做边界检查，越界时会把 EOF 记录当图片（`1.bin`）读出 | no-images 样本 | 修补：索引必须落在图片记录区间内 |
| 7 | 封面判断写成 `if (offset)`，**EXTH 201 = 0（第一张图，也是最常见的情况）时拿不到封面** | 样本封面为空；源码第 787–790 行 | 扫描阶段由 `mobi-format.js` 自己提取封面 |
| 8 | **MOBI6 分章时用 `Array.from(bytes, fromCharCode).join()` 逐字节展开整本书**，内存和耗时严重放大 | 见下表 | 修补为 `Buffer` 的 latin1 转换 |
| 9 | 公开 API 只返回解码后的章节字符串，拿不到原始字节偏移，没法把 `filepos` 精确改写为锚点 | API 审查 | 修补时额外暴露各章的原始 `start/end` 和字节内容 |

**性能**（本机 Node 24，每个样本在独立子进程中测量，采样峰值 RSS；"正文"指解压后的 UTF-8 字节数）：

| 正文 | 原版：耗时 / 峰值 RSS | 只修补缺陷 8 后：耗时 / 峰值 RSS |
| --- | --- | --- |
| 1 MiB | 202 ms / 164 MiB | — |
| 4 MiB | 715 ms / 251 MiB | 74 ms / 81 MiB |
| 8 MiB | 1,427 ms / 529 MiB | 120 ms / 97 MiB |
| 32 MiB | 5,729 ms / 1,313 MiB | 391 ms / 251 MiB |

参考：一部 50 万字的中文小说，正文约 1.5 MiB。

### Task 0 结论与决定

1. **采用 lingo-reader 的解压与解析核心，但 vendor 一份修补版**，放在 `app/server/vendor/lingo-mobi/`：
   - 基于 0.4.6，保留 MIT 许可证；
   - 修补上面的缺陷 5、6、8、9，另外附一份逐条说明的 `PATCHES.md`；
   - 以 ESM 形式只在转换 worker 内加载；
   - 缺陷 2、3、4、7 由自研的 `mobi-format.js` 在调用 lingo-reader 之前就挡住。

   **不采用安装时打补丁的方式**（例如 patch-package）：`scripts/build-fpk.sh` 用的是 `npm ci --ignore-scripts`，安装脚本不会执行，补丁在 FPK 里不会生效。

   这仍属于计划里的"先用 lingo-reader"，不属于"否决后自研"。npm 依赖改为只保留 `@lingo-reader/shared@0.4.6`（精确版本，供 vendor 的代码 import），把 `@lingo-reader/mobi-parser` 从 `dependencies` 中移除，这一步在 Task 2 引入 vendor 时完成。
2. 以后如果上游修复了缺陷 1、5、6、7、8，可以考虑去掉 vendor，改回直接使用 npm 包。给上游提 issue/PR 需要用户同意后另行处理。
3. **资源上限暂定**：MOBI 源文件 64 MiB、正文 48 MiB、worker 堆 256 MiB。本机数据显示，修补后 32 MiB 正文的峰值约 251 MiB RSS（RSS 包含堆外内存），所以 48 MiB 正文可能超过 256 MiB 堆上限。暂定策略：正文超过 32 MiB 就拒绝，并提示"文件过大"。在 NAS（Node 22.18，x86_64/ARM64）上实测后再冻结最终数值，最迟在 Task 6 完成。

### 待办（需要 NAS 或用户）

- [ ] **NAS 导入前置条件探测**：`scripts/fnos-device-acceptance.sh import-probe`（本次新增，已在本地开发服务器上验证过）。它会：
  - 以包用户身份在共享目录创建并删除一个探测文件；
  - 依次发送 1/16/64/256 MiB 的无效 JSON 请求到一个"先读请求体、解析失败就拒绝"的接口，根据响应是应用的 JSON 还是网关的非 JSON 页面，判断网关允许的最大请求体。

  这个过程不修改任何用户数据。
- [ ] **KF8（AZW3）样本**：生成 KF8 结构（skeleton/fragment/INDX）工作量较大。建议从 Project Gutenberg 下载一本公有领域的 KF8 电子书，只在本地验证用，不提交进仓库。需要用户同意下载。
- [ ] 在 NAS 的 Node 22 上跑一遍修补后的解析性能（需要先有转换 worker，放在 Task 2/6 中完成）。

## Task 1：MOBI 扫描与元数据

状态：**本地完成**（2026-09-30）。开关默认关闭。

### 实现

- `app/server/mobi-format.js`：纯函数实现，按位置读取文件，**不解压正文**。
  - 只读取 PDB 头与记录表、record 0（上限 1 MiB）、合体文件中的 KF8 record 0，以及封面记录（上限 8 MiB）。
  - 校验：`BOOKMOBI` 标识；记录表严格递增且不与头部重叠；记录偏移不越出文件末尾（捕获截断）；压缩方式为 none/PalmDOC/HUFF-CDIC；编码为 UTF-8/CP1252；文本记录完整。
  - DRM 检测同时覆盖 MOBI6 头和 KF8 头。
  - 封面偏移为 0 时正常取第一张图，修正了 lingo-reader 的缺陷 7；越界的封面偏移直接忽略。
  - 错误以 `MobiFormatError` 抛出，`code` 取值为 NOT_MOBI、TRUNCATED、INVALID_HEADER、UNSUPPORTED_COMPRESSION、UNSUPPORTED_ENCODING、TOO_LARGE 之一。
- `app/server/library.js`：
  - 开关关闭时 **不解析** Kindle 文件，只按扩展名计入 `scan.hiddenMobiCount`，扫描结果的其他部分与没有这些文件时完全一致（有测试逐字段比对）；
  - 开关打开时建立 `type:"mobi"` 的索引，并记录 `sourceFormat: mobi6|kf8`、标题、作者、语言、出版社和封面；
  - **DRM 不算扫描错误**，只计入 `drmProtectedCount`（最多列出 50 个相对路径），这样不会导致书库被判为不健康、进而锁住分类编辑；
  - 截断或损坏的文件与损坏的 EPUB 处理一致，记为错误；
  - 文件指纹没变的书，重新扫描时直接复用上次的结果。
- `app/server/mobi-feature-config.js`：完整复制了 PDF 开关模块的结构，但保持独立，不共享依赖，因为生命周期脚本会单独复制并执行它。支持 `BABYREADER_MOBI_ENABLED` 环境变量和 wizard 设置 `wizard_mobi_reader_enabled`（默认 false）。`cmd/config_callback` 已接入。
- `app/server/index.js`：
  - 5 处 PDF 可见性判断统一改为 `isBookVisible`/`libraryFeatures`；
  - `features` 中新增 `mobiReader`、`hiddenMobiCount`、`drmProtectedMobiCount`；
  - `findBook` 对 MOBI 书的处理：开关关闭时返回 404；开关打开时，除封面外一律返回 **409「MOBI 阅读尚未就绪」**，确保原始 Kindle 字节在 Task 3 接入转换器之前不会被当作纯文本送进内容、搜索或 AI 接口；
  - 服务启动时不自动扫描，所以打开开关后需要"重新扫描"，这一点已写进 wizard 的提示和书库提示。
- 前端：
  - 书卡的格式标签显示 `MOBI`/`AZW3`；
  - 书库提示新增"另有 N 本 MOBI/AZW3；请在 fnOS 的运行设置中启用后重新扫描"和"N 本 Kindle 书受 DRM 保护，无法阅读"，PDF 的原有文案不变。

### 与计划的差异

- 计划 2.3 原本写的是"关闭时仍被扫描"。实际改为：关闭时只按扩展名计数、不解析。这样做是为了让开关关闭时的扫描结果与 v1.2.0 完全一致，DRM 或损坏的 Kindle 文件不会改变错误计数和书库健康状态。

### 验证

- 新增测试：`tests/mobi-format.test.js` 11 项、`tests/mobi-library.test.js` 6 项（扫描 3 项加 API 3 项，覆盖开关关→开→关的完整切换）、生命周期测试 1 项（另在 PDF 回调测试中补充了 MOBI 开关互不影响的断言）、DOM 测试 1 项。
- `npm test`：565 项，556 通过、0 失败、9 跳过。
- `npm run check` 通过；`git diff --check` 通过。
- 书库 E2E 12/12；书库组织专项 23/23。
- 全量 Chromium E2E：131 通过、9 失败、26 跳过；9 项失败与基线名单逐一相同，**无新增失败**。

## Task 2：MOBI→EPUB 转换器

状态：**MOBI6 部分本地完成；KF8/AZW3 部分待真实样本**（2026-09-30）。转换器还没接入任何请求路径，接入在 Task 3 中完成。

### 实现

- **vendor**：`app/server/vendor/lingo-mobi/`，来源为 lingo-reader 0.4.6 的 ESM 构建，已记录上游 SHA-256，另附 MIT `LICENSE` 和 `PATCHES.md`。共打 4 处补丁：导出底层类、修正封面偏移为 0 的判断、改用 latin1 线性转换、`img` 缺少 recindex 时容错。npm 依赖相应改为只保留 `@lingo-reader/shared@0.4.6`（精确版本），移除了 `@lingo-reader/mobi-parser`。
- **`app/server/epub-writer.js`**：确定性的 EPUB 3 生成器。
  - 固定 ZIP 时间戳和条目顺序，`mimetype` 放在第一个且不压缩；
  - 同时生成 nav 和 NCX 两种目录，并支持 cover-image；
  - **按条目预估压缩比，超过 `ZIP_LIMITS.maxCompressionRatio` 八成的条目改为不压缩存储**。原因是测试发现，重复度高的正文会让派生 EPUB 被项目自己的 ZIP 炸弹检查拒绝，导致书打不开。
- **`app/server/mobi-convert.js`**：处理 MOBI6，依次完成以下步骤：
  1. 解压复用 vendor 的 `MobiFile`，其余步骤都在原始字节上进行；
  2. 按 `<mbp:pagebreak>` 分章；超过 400 KiB 的章节在 h1–h3 处切分，仍然过大的在约 256 KiB 后的第一个 `<p>` 处切分；
  3. 在 `filepos` 目标处插入 `<a id="fpN">`：落在标签内部的目标退回到标签起点，落在 UTF-8 多字节字符中间的目标退回到首字节；
  4. 链接改写为 `part-NNNN.xhtml#fpN`；
  5. 图片按 recindex 映射，并做记录区间和类型校验（EOF、FLIS 等非图片记录一律丢弃），同时检查单张和总量上限；
  6. 用 sanitize-html 把 HTML 规整为 XHTML：去掉 script、事件属性、`mbp:` 标签和外链，`align` 转为 class；
  7. 目录优先取 guide 中的 toc，没有时取各章第一个标题，再没有就用"第 N 部分"；
  8. 最后用 `safeUnzip` 自检产物。

  DRM 和 KF8 在这一步会直接拒绝，错误码为 `DRM_PROTECTED` 或 `UNSUPPORTED_FORMAT`。`MOBI_CONVERTER_VERSION = 1`。
- **`app/server/mobi-derived.js` 与 `mobi-convert-worker.js`**：
  - 缓存文件名为 `derived/<bookId>.<指纹16位>.c<版本>.epub`，权限 0600，写入方式是写 `.tmp`、fsync、再 rename；
  - 每次转换都重新核对源文件指纹，不一致返回 `SOURCE_CHANGED`；
  - 转换在 worker 中执行：堆 256 MiB，超时 60 s；全局并发 1，同一个文件的并发请求合并为一次转换（single-flight）；
  - 转换失败会被记住 10 分钟，期间不重复尝试；
  - `ensure(book, {waitMs})` 在等待时间内没完成就返回 `preparing`，转换在后台继续；
  - `prune(books)` 清理已消失、已变化或旧版本的产物，并按最近访问时间把缓存总量控制在 2 GiB 以内。

### 章节划分的约束

- 纯 MOBI6 走自研流水线，**KF8（独立的 AZW3 和 MOBI6+KF8 合体文件）一律走 KF8 路径**。一本书走哪条路完全由格式决定，不做回退。原因是 lingo 的 `MobiFile` 遇到合体文件时会自动切换到 KF8 记录，而两条路径的分章结果不同；如果在两条路径之间切换，已有的划线就会失效。
- `text/part-NNNN.xhtml` 这个命名规则已冻结，由快照测试 `entry names follow the frozen href scheme` 锁住。

### 验证

- 新增测试：`tests/mobi-convert.test.js` 11 项，`tests/mobi-derived.test.js` 9 项（包括 worker 堆内存耗尽时只影响这一次转换）。
- `npm test`：585 项，576 通过、0 失败、9 跳过；`npm run check` 和 `git diff --check` 通过。
- 本机端到端转换（默认上限，样本在独立进程中生成）：

  | 正文 | 耗时 | 峰值进程 RSS（基线） |
  | --- | --- | --- |
  | 4 MiB | 396 ms | 153 MiB（50） |
  | 16 MiB | 1,022 ms | 253 MiB（88） |
  | 30 MiB | 1,922 ms | 317 MiB（120） |

  正文超过 32 MiB 时按设计返回 `TOO_LARGE`。

### 未完成

- [x] **KF8/AZW3 转换**（2026-09-30 完成）。
  - 样本：Project Gutenberg #11《Alice's Adventures in Wonderland》的 KF8 版本 `pg11-images-kf8.mobi`，255,486 字节，SHA-256 `b3c9067848d28f8c0f36adbb198b306791884319e8b2f8ea7083f844d8876815`，来源 `https://www.gutenberg.org/ebooks/11.kf8.images`。该书为公有领域，经用户同意下载；只放在本机临时目录，**不进仓库**。
  - 验证方式：`BABYREADER_KF8_SAMPLE=<绝对路径> node --test tests/mobi-convert.test.js`。没有设置这个变量时，该测试自动跳过。
  - **新发现**：lingo 的 `Kf8.replace` 遇到 `<head>` 里非 Kindle 资源的 `<link>`（例如 `rel="icon"`）时会直接抛异常。这本真实书在第一个带链接的章节就崩溃了。因此 KF8 也只借用上游的底层能力（`loadRaw`、`FDST`、骨架与片段表、`getToc`），其余步骤都由我们自己完成：
    - 按字节重组章节，并记录每个片段最终落在哪里；
    - `kindle:pos:fid:off` 按字节偏移精确插入 `<a id="kFID-OFF">` 锚点；
    - `kindle:embed` 图片按记录区间校验后打包，文件名为 `images/img-<base32 4位>.<扩展名>`；
    - `kindle:flow` 为 SVG 时，取出里面嵌的那张位图；
    - 合并 CSS flow，去掉 `@font-face`，并改写其中的 `url(kindle:...)`；
    - 每个骨架对应一个 part 文件；没有文字也没有图片的章节会被丢掉，指向它的链接改为指向下一个保留的 part；
    - 保留书籍原有的 class，让 KF8 的 CSS 继续生效。
  - `Kf8` 只接受 `Uint8Array` 或文件路径，不接受单独的 ArrayBuffer（`MobiFile` 则接受）。
  - 结果：113 ms，19 个 part，目录正确，书内链接 28 个、死链 0 个，没有残留 `kindle:` 引用，封面为 JPG，两次转换的产物逐字节相同。
  - 合成的 KF8 样本没有 FDST 和骨架表，现在会按 `CORRUPT` 拒绝，**不会回退到 MOBI6 路径**。
- [ ] HUFF/CDIC 压缩：解压代码来自上游，还没有专门的样本覆盖。

## Task 3：接入阅读、搜索与 AI

状态：**本地完成**（2026-09-30），开关仍然默认关闭。

### 实现

- **`findBook` 返回 EPUB 视图**：对于 MOBI 书，先对源文件做授权校验，再调用 `mobiDerived.ensure()`，然后返回 `{...book, type:'epub', path:<派生文件>, sourceType:'mobi'}`。
  - 读取内容的接口（内容、搜索、FTS、AI 上下文）因此**完全不用改**，而且不可能读到 Kindle 原始字节：默认就是这条"内容安全"的路径，只有封面接口通过 `allowMobiMetadata` 拿到原始的书籍记录。
  - FTS 的缓存键由派生文件的路径、大小和修改时间组成，路径里又带着转换器版本号，所以转换器升级后索引会自动重建。
- **错误映射**：错误响应会带上可供程序判断的 `code` 字段。

  | 情况 | 状态码 | code |
  | --- | --- | --- |
  | 转换中 | 409 | `MOBI_PREPARING` |
  | DRM | 415 | `MOBI_DRM_PROTECTED` |
  | 过大 | 413 | `MOBI_TOO_LARGE` |
  | 源文件已变化 | 409 | `MOBI_SOURCE_CHANGED`（需重新扫描） |
  | 超时 | 503 | `MOBI_TIMEOUT` |
  | 损坏或无法转换 | 422 | `MOBI_CORRUPT` 等 |

  全局错误处理在 `error.publicCode` 存在时，会把它作为 `code` 一并输出。
- **`publicBook`**：对外把 `type:'mobi'` 映射成 `type:'epub'`，并加上 `format:'mobi'|'azw3'`。前端阅读器因此零改动，书卡标签按 `format` 显示。
- **缓存清理**：扫描健康时（条件与 AI 孤儿索引清理相同）调用 `mobiDerived.prune(index.books)`；扫描不健康时不删任何派生文件。
- **前端**：`apiRequest` 的错误对象会带上服务端返回的 `code`。`openBook` 遇到 `MOBI_PREPARING` 时，先提示"正在准备这本书，请稍候…"，再按 1.5、3、5、8、12、20 秒的间隔依次重试；其他错误不重试。

### 与计划的差异

- 计划原本打算在 `ai-fts.js`、`ai-book-context.js`、`book-search.js` 中改用 `isEpubLike(book)` 判断。实际改为在 `findBook` 层返回 EPUB 视图，这三个模块**零改动**，改动面更小，也不存在漏改的风险。

### 验证

- `tests/mobi-library.test.js` 的 API 测试已按 Task 3 契约重写，覆盖：
  - 对外类型为 epub 并带有真实格式；
  - 内容接口返回有效的 EPUB，派生文件唯一；
  - 全文搜索命中 MOBI 正文，`chapterHref` 符合 `part-NNNN` 命名规则；
  - 阅读进度能保存；
  - 合成的 AZW3 返回 422 `MOBI_CORRUPT`；
  - 开关关闭后，内容和封面都返回 404。
- DOM 测试：客户端遇到"转换中"会重试两次后成功；遇到损坏的书不重试。
- **新增 `e2e/mobi-reader.spec.js`（4/4）**：在真实 Chromium 中完成打开、目录跳转、全文搜索跳转到命中位置、返回书库后从"继续阅读"恢复进度。该用例会自己放入样本、打开开关、重新扫描，结束后全部还原，不影响其他 spec。
- **全量回归**（按顺序逐项串行执行）：
  - `npm test`：587 项，577 通过、0 失败、10 跳过（新增的 1 项跳过是未设置 `BABYREADER_KF8_SAMPLE` 的真实样本测试）；
  - `npm run check`、`git diff --check` 通过；
  - 书库组织专项 23/23；
  - Chromium E2E：134 通过、10 失败、26 跳过。其中 9 项与基线名单逐一相同；第 10 项 `sepia reader returns to the neutral light library surface` 是**测试本身的时序问题**：点击"返回书库"后立刻单次读取背景色，全量运行负载高时读到的还是切换前的阅读页背景。依据：单独运行 3/3 通过；紧接 MOBI spec 之后按原顺序运行 2/2 通过。这条断言是首页改版时写的，已改为会自动重试的 `toHaveCSS` 断言，改后通过。
- **回归过程中的问题**：`tests/pdf-ai-profile.test.js` 第一次运行时卡死超过 17 分钟。它及其被测代码与 `main` 完全一致，不涉及 MOBI；单独运行 11 次，失败 1 次、卡死 0 次，属于既有的间歇性问题（9/28 的记录中已出现过）。之后因为操作失误，两轮回归同时运行，争抢 CPU 和 8099 端口，第二轮也卡住了；两轮都已停止并清理，然后重新串行执行。目前 `npm test` 已加上 `--test-timeout=180000` 作为防护。建议另开任务专门排查这个测试。
- **真实书目视检**（Project Gutenberg 的 AZW3 样本，预览环境打开 MOBI 开关）：
  - 书架显示书中自带的真实封面，标签为 AZW3；
  - 打开后封面页正确显示原本嵌在 SVG 流中的插图；
  - 目录完整；
  - 跳转到 "CHAPTER I. Down the Rabbit-Hole" 后，正文排版正常，原书的斜体保留，进度显示为 21% · 5/19。

## Task 4：导入后端

状态：**本地完成**（2026-09-30），开关 `wizard_import_enabled` 默认关闭。`import-probe` 的 NAS 结果还没拿到，目前按"整个文件一次上传"实现；如果网关限制了请求体大小，再补分片上传（接口可以向后兼容地扩展）。

### 实现

- **开关**：`app/server/import-feature-config.js` 与 PDF、MOBI 的开关模块结构相同、互相独立，对应环境变量 `BABYREADER_IMPORT_ENABLED` 和 wizard 设置"允许管理员从浏览器导入书籍"。`cmd/config_callback` 已接入，并有生命周期测试。
- **`library.js`**：把单个文件的索引逻辑提炼成 `indexBookFile`，全量扫描和导入共用同一段代码，扫描行为不变。
- **`app/server/book-import.js`**：
  - 文件名只保留一段：去掉路径、控制字符和 Windows 保留字符，NFC 规范化，去掉开头的点，扩展名转小写，总长度 ≤ 200 字节；
  - 扩展名白名单与各格式上限：EPUB、MOBI、AZW3 为 64 MiB，PDF 为 256 MiB，TXT、MD 为 32 MiB；
  - 带 `Content-Length` 时先按它判断，超限直接拒绝，不读取请求体；
  - 并发限制：每个用户 1 个，全局 2 个，超出返回 429；
  - 流式写入 `.babyreader-import-<uuid>.part`（`wx` 方式创建，权限 0640），同时计算 SHA-256，最后 fsync；
  - 客户端断开、数据超过或不足声明长度时，清理临时文件；
  - 按文件内容校验格式：EPUB 调用 `extractEpubMetadata`，PDF 检查文件头，MOBI 调用 `readMobiMetadata` 并拒绝 DRM，文本必须是严格的 UTF-8；
  - **在库锁内**依次完成：查重（只对同样大小的书计算哈希，内容相同返回 409 和已有书籍的 id）→ 发布（用 `link` 实现，不会覆盖已有文件，重名时依次加 `(2)` 等后缀）→ 登记进书库（失败会删掉已发布的文件）。
- **`index.js`**：
  - `withLibraryLock` 让全量扫描和导入登记依次执行。`library.json` 只有这两个地方会写。
  - 导入目录固定为 `<babyreader-fnos/library 共享目录>/导入`。它必须位于授权根目录之内，而且必须是普通目录，不能是符号链接；**绝不写入用户自己授权的目录**。
  - `PUT /api/library/imports` 的检查顺序：开关（关闭时 404）→ 是否管理员（403）→ 必须带 `X-BabyReader-Request: import` 请求头，且 `Sec-Fetch-Site` 为同源（否则 403）。自定义请求头会触发 CORS 预检，而本服务从不放行预检，所以其他网站的页面无法借用户的登录状态发起上传。
  - 导入成功返回 201 和书籍信息（路径已脱敏），书立即出现在所有用户的书库里，初始为未分类，不需要重新扫描。
  - 出错时返回 `{error, code, ...}`，同时带上 `Connection: close`，避免把没用的大文件继续读完。
  - `features.bookImport` 只在开关开启且当前用户是管理员时为 true。

### 验证

- `tests/book-import.test.js` 9 项：文件名清理；5 种格式都能导入且不留临时文件；不覆盖已有文件；按内容校验格式（伪装的 EPUB、PDF、非 UTF-8 文本、伪装的 MOBI、DRM、空文件）；各种大小限制；断开连接后清理干净；查重；格式开关、并发和目标目录不可用；锁内的执行顺序以及登记失败时的回滚。
- `tests/book-import-api.test.js` 8 项（真实服务端加模拟共享目录）：
  - 开关默认关闭且不对外暴露；
  - 管理员、请求头、同源三项检查；
  - EPUB 导入后，其他用户立即可见并能阅读，初始为未分类；
  - 重复内容返回 409，同名但内容不同则自动改名；
  - MOBI 导入受 MOBI 开关控制，导入后通过派生 EPUB 阅读；
  - 与全量扫描同时进行时两者都保留；
  - 声明的大小超限时，在读取请求体之前就返回 413；
  - 共享目录缺失时返回 503。
- **全量回归**（依次串行执行）：
  - `npm test`：605 项，595 通过、0 失败、10 跳过；
  - `npm run check` 通过，`git diff --check` 通过（提交前修掉了进度文件末尾多出的空行）；
  - Chromium E2E：135 通过、9 失败、26 跳过，9 项失败与基线名单逐一相同，**没有新增失败**；Task 3 修过的那条 sepia 测试这次通过；
  - 书库组织专项：23/23。

## Task 5：导入前端

状态：**本地完成**（2026-09-30）。

### 实现

- `app/ui/core/api.js` 新增 `browserHost.importBook(file, {onProgress})`：用 XHR 发起 PUT 请求，带上 `X-BabyReader-Request: import` 和经 URI 编码的文件名；支持上传进度和 `abort`；错误对象带有服务端返回的 `code`/`details`。
- `app/ui/library/import.js`：
  - **工具栏按钮**：`createLibraryImportButton` 点击后弹出多选文件框，`accept` 与服务端的扩展名白名单一致。
  - **拖放**：`setupLibraryImportDrop` 支持把文件拖到书架上。只对外部文件（`dataTransfer.types` 包含 `Files`）生效，所以不会和书卡的指针拖拽排序冲突。
  - **队列**：
    - 上传前先在本地预检扩展名、大小和空文件；
    - 逐个串行上传，与服务端每个用户 1 个并发的限制一致；
    - 每个文件显示进度，上传完毕后显示"正在处理…"；
    - 结果分为已导入（重名时提示"已保存为…"）、已存在（附"打开"按钮）、失败（显示服务端给出的中文原因）、已取消；
    - 在分类里导入的书，会先读取最新 revision 再调用 `placeLibraryBook` 归入当前分类；
    - 每成功一本就刷新书库，但只在当前仍停留在书库页时才刷新。
- 两种书库渲染方式都已接入：分类整理模式的首页和详情页，以及平铺模式。
- `scripts/validate-structure.js`：必需文件清单从 61 项增加到 73 项，新增 MOBI 服务端模块、vendor 解析器（含 `LICENSE`、`PATCHES.md`）、`book-import.js`、`import-feature-config.js` 和 `library/import.js`。以后构建时漏掉其中任何一个都会报错。
- `e2e/start-server.js` 新增一个空的模拟共享目录，并设置 `TRIM_DATA_SHARE_PATHS`。目录里没有书，不改变其他 spec 看到的书库。

### 验证

- DOM 测试 3 项：
  - 按钮只在管理员且开关开启时出现，并处在约定的位置（书库首页、分类详情页、平铺模式分别验证）；
  - 队列：预检拒绝、串行上传、进度和 `aria-valuenow`、重名保存提示、已存在时的"打开"按钮、取消、汇总文案，以及"完成"后清空队列；
  - 拖放导入会阻止浏览器默认行为，在分类里导入会以最新 revision 归类。
- **新增 `e2e/book-import.spec.js`（3/3）**：
  - 用文件选择框导入后，书立即出现在书架上，文件写入了共享目录中的"导入"文件夹，从面板上的"打开"可以直接阅读正文；
  - 再次导入相同的字节会显示"书库中已有这本书"并提供"打开"；
  - 拖放导入时会显示拖放提示层，`.exe` 在本地就被拒绝，EPUB 导入成功，"完成"后面板收起。
  - 该 spec 结束后会删除导入的文件、关闭开关并重新扫描。
- 预览环境目测：
  - 桌面端工具栏依次为新建分类、导入、重新扫描、整理；拖入的 TXT 立刻出现在书架上，右下角面板显示"已导入 1 本，1 个未导入"，成功一行为绿色并有"打开"，`.exe` 一行为红色并写明原因；
  - 手机端面板以底部面板的形式出现，4 个工具按钮放在一行内。
- **全量回归**（依次串行执行）：
  - `npm test`：608 项，598 通过、0 失败、10 跳过；
  - `npm run check`：必需文件 73 项，通过；`git diff --check` 通过；
  - Chromium E2E：138 通过、9 失败、26 跳过，9 项失败与基线名单逐一相同，**没有新增失败**，新增的 3 项导入测试全部通过；
  - 书库组织专项：23/23。
