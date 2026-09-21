# AI 多格式书籍接入与检索适配计划（后续，不执行）

## 文档目的

当阅读器后续支持 MOBI、AZW3、PDF 等格式时，直接复用当前 SQLite FTS 检索能力，避免重新调研和重写 AI 上下文协议。

本文件只记录调研结论、接口预留和实施顺序。本阶段不接入新格式，不新增解析依赖，不改变现有 EPUB/TXT 功能。

## 调研结论

### 1. SQLite FTS 与文件格式是可解耦的

SQLite FTS5 只需要稳定的文本片段和来源定位元数据，不关心输入文件是 EPUB、MOBI 还是 PDF。推荐保持以下链路：

```text
书籍文件
  -> 格式适配器
  -> 统一章节流（正文、标题、来源定位）
  -> 统一分块与中文检索词化
  -> SQLite FTS5
  -> 候选片段
  -> 现有书本上下文校验与 OpenAI Responses 请求
```

因此，后续格式接入不应修改 SQLite 表结构、AI 请求协议或前端多轮对话逻辑；只增加对应格式的适配器。

### 2. EPUB、MOBI、AZW3 适合进入同一类“可重排电子书”适配器

- EPUB 已经有 spine、章节链接、目录和标题层级，当前阶段可直接产生章节流；
- MOBI 和 AZW3/KF8 通常需要先解析 PalmDB/KF8 容器，再提取内部 HTML/XHTML、目录和章节边界；
- 开源项目 `lingo-reader` 已展示 EPUB、MOBI、AZW3 的统一解析接口思路；`kindleunpackjs` 也能解包 MOBI、AZW、AZW3 并提取 HTML，但两者都需要在项目中单独评估体积、维护性和安全边界；
- 含 DRM 的 MOBI/AZW3 不应尝试绕过保护。无法解析或受保护时，阅读器应明确提示“暂不支持 AI 检索”，不能把原文件上传到第三方转换服务。

参考：[lingo-reader 多格式解析器](https://github.com/hhk-png/lingo-reader)、[kindleunpackjs](https://github.com/gittest32026/kindleunpackjs)。

### 3. PDF 不能完全按电子书章节处理

PDF 是固定版面格式，文本顺序、列布局、页眉页脚和扫描图片都会影响抽取质量：

- 可复制文字的 PDF：适合按页提取，保留 `pageIndex`/页码作为来源定位；章节标题可由书签或标题启发式生成；
- 双栏、表格、脚注：文本抽取顺序可能与视觉阅读顺序不同，需要在检索评测中单独验证；
- 扫描型 PDF：没有文本层，必须经过 OCR 才能检索；OCR 会增加耗时、体积和错误率，不应在本阶段默认开启；
- PDF 不应依赖系统安装的 `pdftotext`、Java/PDFBox 或 Calibre 命令行作为软件必备条件，否则会带来 fnOS 环境和 x86/ARM 部署差异；
- 如果未来引入 PDF.js，应将其作为可选、按需加载的解析能力，关注 FPK 体积和内存占用。

参考：[Mozilla PDF.js](https://github.com/mozilla/pdf.js/)、[Apache PDFBox 文本提取说明](https://pdfbox.apache.org/2.0/commandline)、[PDFBox 关于文本提取复杂性的说明](https://pdfbox.apache.org/3.0/faq.html)。

### 4. 不推荐把 Calibre 作为运行时依赖

Calibre 的 `ebook-convert` 能把多种格式转换为 EPUB/AZW3，适合用户在桌面端预处理，但不适合直接嵌入 fnOS 阅读器：

- 需要额外安装和维护庞大的外部运行时；
- 不同设备架构、权限和路径差异会影响稳定性；
- 转换会丢失或改变部分定位信息，AI 来源跳转不一定能回到原文页码；
- 含 DRM 的文件仍不能通过应用层绕过保护。

推荐把 Calibre 作为“用户预处理工具”记录在帮助文档中，而不是软件内部的隐式依赖。

参考：[Calibre 转换文档](https://manual.calibre-ebook.com/conversion.html)、[ebook-convert CLI](https://manual.calibre-ebook.com/generated/en/ebook-convert.html)。

## 建议预留的统一接口

后续实现时，将当前 FTS 层中的书籍读取逻辑拆成独立适配器。接口建议如下，字段全部采用可选定位信息，避免 EPUB 的 href 结构限制 PDF：

```js
/**
 * @typedef {Object} BookChapter
 * @property {number} index
 * @property {string} label
 * @property {string} text
 * @property {string[]} headings
 * @property {string} href
 * @property {number|null} pageStart
 * @property {number|null} pageEnd
 * @property {string|null} locatorType // epub-href | pdf-page | plain-text
 */

/**
 * @typedef {Object} BookFormatAdapter
 * @property {string} type
 * @property {(book) => boolean} supports
 * @property {(book) => Promise<{title?: string, author?: string}>} inspect
 * @property {(book) => Promise<BookChapter[]>} readChapters
 */
```

建议的适配器目录：

```text
app/server/book-formats/
  index.js
  epub.js
  text.js
  mobi.js       # 后续
  azw3.js       # 后续，可与 mobi 共用底层解包器
  pdf.js        # 后续
```

`ai-fts.js` 只接收 `readChapters(book)` 的结果，不再判断 EPUB 标签或 PDF 页码。SQLite 行中预留以下可选字段：

- `locatorType`；
- `pageStart`、`pageEnd`；
- `chapterHref`；
- `parserVersion`；
- `extractionQuality`（normal、partial、ocr、unsupported）。

当前 EPUB/TXT 索引可以继续使用现有字段；新增字段应通过 SQLite schema version 递增自动重建，不要求用户手动清理索引。

## 各格式兼容性决策

| 格式 | AI 检索适用性 | 来源定位 | 后续策略 |
| --- | --- | --- | --- |
| EPUB | 高 | href、章节、目录 | 当前已支持，作为统一基准 |
| TXT/Markdown | 中 | 文件或单一章节 | 当前回退路径继续保留，后续可增加标题分章 |
| MOBI | 中 | 解析后的章节或内部记录 | 增加适配器；遇到 DRM/异常容器时安全降级 |
| AZW3/KF8 | 中 | 解析后的 XHTML/章节 | 与 MOBI 共用解包基础，但单独测试 KF8 目录和图片资源 |
| PDF（文字型） | 中 | 页码、书签、文本块 | 增加按页适配器；保留页码而非伪造章节 |
| PDF（扫描型） | 低至中 | OCR 页码 | OCR 作为可选后续能力，默认不启用 |

## 后续实施顺序

### M1：先抽象，不改变行为

- 把当前 EPUB/TXT 的章节读取提取为 `BookFormatAdapter`；
- FTS 构建函数改为消费统一章节流；
- 保证现有 SQLite 文件版本自动失效重建；
- 完成 EPUB/TXT 回归测试和真实书籍检索基线。

### M2：MOBI/AZW3

- 评估纯 JavaScript 解析器的包体、许可证、内存和 fnOS Node 22 兼容性；
- 优先提取文本、标题、目录和章节边界，不处理 DRM；
- 统一映射为 `href` 或内部 section locator；
- 增加异常容器、超大文件、缺失目录和 DRM 文件测试；
- 解析失败时保留阅读功能，AI 明确提示不可检索，不发送原书到网络。

### M3：文字型 PDF

- 评估 PDF.js 在 fnOS Node 22 / 浏览器侧的体积和内存；
- 以页为最小来源单位，保留页码和书签；
- 对双栏、页眉页脚、表格和连字符建立评测集；
- 只有抽取质量达标后才接入默认 AI 检索。

### M4：可选 OCR

- 单独评估 OCR 引擎和模型体积；
- 允许用户主动触发、显示进度并可取消；
- OCR 结果独立缓存，不能覆盖原 PDF；
- 明确标记“基于 OCR，可能存在识别误差”。

## 稳定性和安全约束

- 新格式解析器必须在索引层之前完成路径授权、文件大小、压缩包条目数和解压比限制；
- 不执行书籍内的脚本、外部链接或嵌入指令；
- 不把整本书发送给模型，仍保持最多 6 个候选片段和现有上下文硬上限；
- 解析失败只影响 AI 检索，不影响书籍打开、翻页、标记和笔记；
- 不把服务器端索引文件打包进 FPK，索引在设备上按需生成；
- 不引入要求编译器、Python、Java 或系统命令的必选原生依赖；
- 每种格式都必须有“可检索、部分可检索、不可检索”的明确状态，而不是静默返回空答案。

## 当前决定

本阶段只执行 EPUB/TXT 的 SQLite FTS。后续接入 MOBI、AZW3、PDF 时，先执行 M1 接口抽象，再按 M2/M3/M4 分阶段评估和实现；不提前安装解析器，不改变当前用户配置和 AI 问答流程。
