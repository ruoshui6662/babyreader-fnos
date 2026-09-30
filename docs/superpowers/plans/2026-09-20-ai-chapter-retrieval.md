# AI 章节理解与低成本问书实施计划

> 状态：Task 0–8 软件候选实施与离线验证已完成；fnOS 实机、授权 EPUB 与真实供应商 Key 验收待设备端执行
> 计划版本：2
> 适用范围：EPUB 章节识别、章节/全书概述、问书检索的上下文组织与成本控制

> **For agentic workers:** 实施时必须使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`，严格按 Task 0 至 Task 8 顺序推进。每个 Task 先写失败测试、验证测试失败，再实现、运行该 Task 定向回归并记录结果。复用当前 Node.js/CommonJS、SQLite FTS5、原子文件写入和 AI 上游代理；不得为本计划引入新的运行时依赖。

**目标：** 让 AI 能可靠识别读者所在的逻辑章节，对“本章讲什么”提供覆盖充分、可回指原文的回答，并通过本地结构索引、按需生成和缓存控制重复调用成本。

**架构：** 建立由 EPUB 导航目录、文件内锚点、阅读位置和已解析文本范围组成的可信章节目录；把请求分为精确查找、当前章节概述、选中文本解释和全书概述。精确问题继续用现有 FTS/词法召回；概述问题按章节范围覆盖原文，长内容才使用分段摘要与合成；可复用摘要按书籍指纹和生成版本缓存，并可追溯到原文。

**技术栈：** Node.js CommonJS、现有 `node:sqlite`/SQLite FTS5、EPUB ZIP/OPF/Navigation 解析、现有服务端 AI Responses 代理、现有原子写入和索引生命周期管理。

**设计依据：** [Task7 书本内容 AI 设计](../specs/2026-09-20-task7-book-grounded-ai-design.md)。本计划更新并取代本文件旧版“spine 条目即章节”的实施假设；旧假设与 EPUB 章节语义不符。

## 全局约束

- EPUB spine 表示默认阅读顺序；逻辑章节必须从 EPUB 导航目录、目标文件/片段与正文结构解析，不能把 spine index 直接当章名或章节范围。
- 普通精确问答默认继续使用当前混合检索及候选边界；仅明确的概述类问题进入覆盖式策略。
- 章节摘要和搜索片段都是辅助索引，不是可替代原文的“事实来源”；回答中的事实须能映射回原文位置。
- 任何书籍正文或摘要发送到供应商前，必须有明确的用户问答请求；禁止后台静默上传整本书或预生成全书 AI 摘要。
- 每个 AI 请求的上下文、输出、并发任务和累计摘要生成量都必须受服务端硬限制；浏览器提交的章节名、路径、范围和预算一律不作为可信事实。
- 书籍变化、索引 schema 变化、解析器版本变化、提示词版本变化或模型配置变化时，旧结构/摘要必须失效或标为过期，不能静默复用。
- FTS 构建/迁移必须沿用 AI 索引管理器的 build/read lease、安全发布与权限修正；不得先删除可用索引再尝试构建新索引。
- 不触碰书籍文件、阅读进度、书签、标注、会话记录和 AI API Key 的数据语义或删除生命周期。
- 现有 `/ai/search`、流式 `/ai/ask/stream`、对话持久化和来源 UI 保持向后兼容；新字段可选，旧请求进入现有普通问答路径。
- FTS 不可用、目录损坏或 AI 服务失败时，阅读功能和现有普通问答降级路径继续可用；章节范围无法确认时不得静默退回全书。
- 评测夹具仅保存问题、期望章节标识和指标，不提交用户 EPUB 正文、AI Key、会话内容或个人标注。

## 当前代码证据与故障链

1. `app/ui/reader/epub.js` 将 `state.epubChapterIndex` 设为当前 spine 项索引，`state.chapterPaths` 也只保存 spine 文件路径。
2. `app/ui/reader/ai.js:198` 用 `state.toc` 的字符串路径包含关系猜当前章节名。TOC 链接可能指向文件内部 fragment，一个文件可承载多个逻辑章节，一章也可能跨多个资源文件，因此映射可能错或不完整。
3. `app/server/ai-fts.js:358` 仅为当前 spine 项加排序分，不将其作为查询过滤范围。普通 top-k 召回不会覆盖整章。
4. `app/server/ai-service.js:122` 在无选中文本时没有将当前章节身份写入用户问题上下文；模型只能从零散片段推断“本章”。
5. 当前默认最多 6 个片段、5400 字符，适合精确查找，不足以表达长章节的论证脉络。
6. 服务端现有 `validateAiBookContext()` 核对片段属于指定书籍，但章节标识应进一步由服务端索引清单解析，不能信任客户端标签或 spine 序号。

EPUB 3.3 规范说明 spine 是默认阅读顺序，而 Navigation Document 提供面向读者的全局导航，目录链接可以指向内容文档或其 fragment。RAGFlow 的 TOC 增强会在检索后依目录补足片段上下文；LlamaIndex 的 Document Summary Index 保留摘要到原始节点的映射；RAPTOR 采用分层摘要检索长文档。长上下文研究也显示模型对上下文位置敏感，单纯扩大提示词不能保证覆盖和准确率。

参考：

- [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [RAGFlow：从文档目录提取 PageIndex](https://github.com/infiniflow/ragflow/blob/main/docs/guides/dataset/advanced/extract_table_of_contents.md)
- [RAGFlow：Book 解析与分块配置](https://github.com/infiniflow/ragflow/blob/main/docs/guides/dataset/configuration.md)
- [LlamaIndex DocumentSummaryIndex 源码](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/indices/document_summary/base.py)
- [RAPTOR 论文](https://arxiv.org/abs/2401.18059)
- [Lost in the Middle 论文](https://aclanthology.org/2024.tacl-1.9.pdf)
- [OpenAI Prompt Caching 文档](https://developers.openai.com/api/docs/guides/prompt-caching)

## 拟定接口与数据模型

### 可信章节定位

逻辑章节清单由服务端从已授权的 EPUB 生成。每个章节至少包含：

```text
chapterId         服务端稳定生成的标识
parentChapterId   上级目录项，可空
label             由 EPUB TOC 或正文 heading 解析的显示名
spineStart        起始阅读顺序位置
spineEnd          结束阅读顺序位置
startAnchor       起始资源内 fragment，可空
endAnchor         结束资源内 fragment，可空
startOffset       规范化文本中的起始位置
endOffset         规范化文本中的结束位置
mappingQuality    exact | inferred | unresolved
```

章节边界解析优先级：可解析的 EPUB TOC fragment/目标文件边界；匹配正文中唯一 ID/heading 的位置；根据 heading 层级推导；最后才使用单个 spine 文件作为低置信度推断边界。推断边界必须标记，不得伪装成精确章节。边界重叠或缺失时返回 unresolved。

阅读端请求可继续携带现有 `chapter.index`，并渐进增加 `chapter.href`、`chapter.fragment` 或阅读定位信息。服务端以已解析章节清单将其映射为 `chapterId`，检查该位置属于该书并解决歧义。服务端的内部检索输入建议为：

```js
{
  intent: 'lookup' | 'chapter_summary' | 'selected_summary' | 'book_summary',
  scope: { kind: 'chapter' | 'selected' | 'book', chapterId?: string },
  evidenceMode: 'ranked' | 'coverage' | 'hierarchical',
  requestBudget: { maxInputChars: number, maxOutputTokens: number }
}
```

字段由服务端意图识别、范围解析及配置生成；客户端仅提供位置线索，不可选择超出范围的任意路径或提高预算。

## 分阶段执行计划

### Task 0：冻结兼容契约并建立章节理解基线

**文件：** `docs/superpowers/progress/2026-09-22-ai-chapter-understanding-progress.md`、`tests/fixtures/ai-retrieval-questions.json`、`scripts/evaluate-ai-retrieval.js`、`tests/ai-retrieval-eval.test.js`。

- [x] 盘点当前普通问答、选中文本问答、章节导航、AI 来源引用和本地回退契约，记录本 Task 的禁止变化项。
- [x] 将评测标签从仅有 spine 序号逐步补足为 `expectedChapterIds` 或可稳定映射的 TOC href/fragment；保留旧字段兼容现有评估。
- [x] 增加章节概述问题类别，覆盖“当前章概述”“具体事实查询”“跨章节综合”“无法识别章节”四类；夹具保存标注，不保存正文。
- [x] 明确评估指标：章节定位准确率、章节范围纯度、首/中/尾覆盖率、来源可回指率、unsupported claim 率、输入/输出 token、缓存命中率、端到端延迟。
- [x] 建立固定的脱敏 EPUB 结构 fixture：单文件多章、跨文件章节、嵌套 TOC、无 TOC、fragment 含 URL 编码、重复/缺失 heading、目录外 front matter。

**闸门：** 结构与检索范围指标能用合成数据离线计算；普通检索历史基线、原始数据集与评估命令可追溯。用户真实书籍的现行基线需由书籍所有者在本机离线复跑并保存匿名指标，不要求将 EPUB 放入仓库。AI 生成质量、provider token/cost、缓存命中和端到端延迟属于模型运行指标，不能从离线 FTS fixture 推断，必须在后续授权验收中实测。

### Task 1：构建服务端逻辑章节清单

**文件：** 新建 `app/server/ai-epub-structure.js`；修改 `app/server/ai-fts.js`；测试 `tests/ai-epub-structure.test.js`、`tests/ai-index-manager.test.js`。

- [x] 先为 OPF manifest/spine、EPUB3 Navigation Document、旧版 NCX、fragment 解码、嵌套 TOC 和锚点到文本位置映射编写 fixture 测试。
- [x] 测试约束：TOC 指向同一 XHTML 中两个 fragment 时必须生成两个不同逻辑章节；单个章节跨多个 spine 项时范围连续；无可靠标题时 mappingQuality 不能标成 exact。
- [x] 从 `ai-fts.js` 抽出 EPUB 结构解析纯模块，返回 spine 资源、目录树、heading/ID 到规范化文本 offset 的映射和逻辑章节范围。
- [x] 给解析器输出加 `parserVersion`，明确路径正规化、percent decode、越界路径、非法 XML/HTML 和重复 ID 的处理。
- [x] 为索引清单记录 `schemaVersion` 与 `parserVersion`；版本改变时沿用现有 build lease、安全临时文件发布和 0600 权限原子重建，不提前删除旧索引。
- [x] 加入大 EPUB 资源数、TOC 深度、章节数及规范化文本/结构 JSON 限制；超限时抛出带稳定错误码的索引错误，不使阅读服务崩溃。单项/压缩包字节限制继续由现有 `safeUnzip` ZIP 限额负责。

**闸门：** 结构 fixture 全部通过；旧索引在新索引成功发布前可读；章节清单不跨书、不接受归档外路径。

### Task 2：让阅读位置可靠映射到当前逻辑章节

**文件：** 修改 `app/ui/reader/progress.js`、`app/ui/reader/ai.js`、`app/server/ai-service.js`、`app/server/ai-fts.js`、`app/server/index.js`；新增 `tests/ai-chapter-scope.test.js`，扩展 `tests/reader-core.test.js` 与 `tests/dom-regression.test.js`。

- [x] 先测试阅读位置在文件开头、目录 fragment、同文件第二章、跨文件章尾、章节间空白、恢复进度后仍能解析对应逻辑章节。
- [x] 阅读器复用现有 semantic locator 的 href/anchor 作为当前位置线索，不新增定位状态机。
- [x] 发送问答请求时保留旧 `chapter.index`，附带有限长的 href/anchor/可选 offset；不发送完整 TOC、`textBefore` 或整本文本。
- [x] 服务端从该书安全索引的结构表解析章节；校验 spine index/href、归档路径 canonical form、anchor 唯一性及 offset 边界；忽略客户端 label 与任何客户端 chapterId。
- [x] unresolved/inferred 状态回传检索 API 与 SSE meta，并在 AI 面板显示定位不确定提示；本阶段没有增加手动章节选择器，后续章节范围交互按 Task 3 决定。
- [x] 保留原有 API 身份认证与书本上下文校验；旧客户端缺少 position 时保留普通回答链路，但其章节名称改为未确认，不伪装成精确位置。

**闸门：** 不同 EPUB 结构下当前章节解析可重复；伪造章节不能扩大查询范围；旧客户端请求仍可走兼容普通模式。

### Task 3：服务端区分问答意图并实施硬范围检索

**文件：** 新建 `app/server/ai-chapter-retrieval.js`；修改 `app/server/index.js`、`app/server/ai-fts.js`、`app/server/ai-retrieval.js`；测试 `tests/ai-chapter-retrieval.test.js`、`tests/ai-retrieval-fusion.test.js`、`tests/ai-index-api.test.js`。

- [x] 先测试中文意图识别：本章/本节/这段概述、全书概述、定义/因果/事实查询、跨章节综合、模糊提问。全书范围优先级高于章节词，选中文本概述优先于当前章概述。
- [x] 意图识别第一版使用可审查规则，不新增分类模型请求；不确定时使用普通 lookup 或询问用户范围。
- [x] 章节概述查询在 SQL 层按服务端解析的逻辑 `chapterId`/范围过滤，不能依赖当前章节排序加分。
- [x] 普通 lookup 保留当前 FTS top-k、词法融合、去重与 5400 字符预算，且原评测不出现明显回退。
- [x] 对指定章节无命中时只在已解析章节内做 coverage fallback；章节清单 unresolved 或为空时返回 `insufficient_scope`，绝不退回整书。
- [x] 服务端响应新增向后兼容的 `intent`、`scope`、`scopeConfidence`、`coverage` 元数据；不得把正文、完整路径、密钥或用户数据写进日志。

**闸门：** 章节模式零跨章结果；普通问题范围与原排序行为兼容；SQL 使用绑定参数；预算无法由客户端扩张。

### Task 4：章节概述采用覆盖式取证，而非 top-k 片段

**文件：** 修改 `app/server/ai-chapter-retrieval.js`、`app/server/ai-fts.js`、`app/server/ai-service.js`；测试 `tests/ai-chapter-retrieval.test.js`、`tests/ai-conversation-api.test.js`。

- [x] 编写合成章节测试：关键论点分别位于开头、中间、结尾；章节含多个小节；短章少于默认上下文预算；长章远大于预算。
- [x] 短章在供应商请求大小上限内时，按完整章上下文提交并保留段落来源位置。
- [x] 长章按章节/小节边界切分，执行 map 阶段逐段提取“主张、理由、例证、结论、原文位置”，再执行 reduce 合成；每段都有最大输入/输出限制。
- [x] 若 EPUB 无 TOC heading，则按稳定文本窗口 coverage 分块，并标记推断覆盖，避免把随机 top-k 当作全章摘要。
- [x] 每个中间结论保留其原文 chunk/offset 引用；最终回答只可陈述有原文证据支持的要点，不把摘要本身当成最终证据。
- [x] 根据章节长度、切块数与当前供应商配置估算输入成本；当估算超过每次请求预算时，停止并说明可缩小范围，不自动把全章上传。

**闸门：** 开中末三段均可进入摘要证据链；最终引用能回到原文；模型/网络错误不污染索引或会话。

### Task 5：分层摘要缓存与增量失效

**文件：** 优先复用 `app/server/ai-index-manager.js` 和现有 per-book AI index 数据生命周期；按需要新增 `app/server/ai-summary-cache.js`；修改 `app/server/ai-fts.js`；测试 `tests/ai-summary-cache.test.js`、`tests/ai-index-manager.test.js`、`tests/ai-book-deletion.test.js`（若删除测试已在其他文件，扩展现存测试）。

- [x] 先测试相同书籍/章节/模型/提示词版本缓存命中，任一指纹维度变化失效；并发请求不得为同一章重复构建；取消请求或 provider 失败不得发布半成品。
- [x] 缓存 key 至少包含书籍内容指纹、逻辑章节 ID、解析器版本、摘要策略版本、模型/供应商标识及提示词版本。
- [x] 摘要分段可独立复用；修改书籍后旧摘要整体失效；章节结构仅局部变化时是否局部失效需以内容哈希验证，不可仅凭文件名推断。
- [x] 持久化沿用现有原子写入、用户隔离和 0600 权限；遵守书籍/索引删除生命周期，清理缓存时只删除 BabyReader 自己生成的缓存。
- [x] 默认只在用户提出章节概述时按需生成该章摘要；禁止扫描书库后自动调用 AI 批量摘要。
- [x] UI 显示首次生成/复用状态与粗略 token 估算；是否请求用户确认由估算阈值策略决定，阈值须在 Task 0 后配置，不硬编码供应商价格。

**闸门：** 重复章节问题可复用缓存；失败时无半写缓存；书籍删除后缓存不可被重新读取；不会触碰会话与阅读数据。

### Task 6：全书概述的分层导航路径与显式成本控制（已完成）

**文件：** 修改 `app/server/ai-chapter-retrieval.js`、`app/server/ai-service.js`、`app/ui/reader/ai.js`；必要时修改 AI 问书 UI 对应组件；测试 `tests/ai-chapter-retrieval.test.js` 和 AI DOM 回归测试。

- [x] 全书问题先使用本地目录、章节标题和当前用户/模型可用的章节摘要构建候选章节；选择相关章节后回取可信原文证据。
- [x] 无章节摘要时，仅在用户明确提出全书概述问题后执行一次有界按需概述；不自动批量生成章节摘要。批量摘要 UI 未引入，因此不存在隐式批处理。
- [x] 分层路径以目录标题/摘要/FTS 作导航线索，并回取原文；map 分组按逻辑章节隔离，最终来源卡片链接本次原文证据组，不以缓存摘要作为引用。
- [x] 服务端最多选 8 个目录一级章节、原文上限 22,000 字符、最多 8 个 map 任务、每组最多 3,000 字符、map/reduce 输出分别限 300/1,200 tokens、全链 120 秒；超限 fail closed。
- [x] 未接入供应商 prompt-cache 优化：当前兼容接口没有足以证明实际 cached-token 收益的一致用量信号；不假定缓存命中或复用隐私数据。

**闸门：** 全书概述不要求每个普通查询重发整书；当前按用户请求有界执行、可通过既有停止按钮取消、有字符/任务/时间上限；无缓存时仍通过目录候选与原文回答。批量摘要不在本阶段提供。

### Task 7：回答溯源、置信度和失败体验（已完成）

**文件：** 修改 `app/server/ai-service.js`、`app/server/ai-book-context.js`、`app/server/ai-retrieval.js`、`app/ui/reader/ai.js`；测试 `tests/ai-conversation-api.test.js`、新增/扩展来源渲染 DOM 测试。

- [x] 概述置信度独立依据章节映射质量、完整覆盖、服务端来源校验和本次引用标记有效性；覆盖采样、inferred 位置、来源不一致或无有效引用均为低置信度。
- [x] UI 在章节映射不精确或摘要置信度不足时显示警示；模型指令要求证据不足时明确说明，不补写书外内容。
- [x] EPUB 上下文的 href/spine index 与实际归档逐项核对；外显标签不信任客户端；服务端和 UI 均过滤不存在于本次来源集合的引用编号。章节概述 offset 仅来自服务器索引；对话继续只持久化 path-free 的已验证来源元数据。
- [x] 保留书本内容作为不可信数据的提示注入防护；模型无工具调用权限，答案只接受当前提供上下文的引用编号。
- [x] 完成回答才写缓存/会话；取消、超时、上游错误沿用已有失败语义；会话保存失败只显示安全错误代码，不抹掉已完成回答。

**闸门：** 对话恢复后来源仍有效；删除/变更书籍后旧来源不会指向错误正文；错误答案不能伪造来源 ID。

### Task 8：专项评测、回归与渐进发布

**文件：** 修改 `tests/fixtures/ai-retrieval-questions.json`、`scripts/evaluate-ai-retrieval.js`、相关 API/DOM/生命周期测试和设备验收文档；按需新增 `docs/superpowers/progress/2026-09-22-ai-chapter-understanding-progress.md`。

- [x] 离线评测 EPUB 结构映射、章节范围纯度、首/中/尾 coverage、Recall@K、来源可回指率；评测不调用模型。合成 fixture：来源纯度 1.0，首/中/尾均覆盖，来源引用和 map 引用有效，任务预算内。
- [ ] 真实 AI 质量集由用户书籍所有者在本机人工验收，只记录匿名指标与问题编号，不把 EPUB 正文、Key、完整会话上传到仓库。
- [x] 执行 Node 全量测试（287 通过、5 平台跳过、0 失败）、结构/便携检查、POSIX shell 检查、Chromium 回归（90 通过、10 环境跳过）及书库组织专项（8 通过），并构建隔离的 1.1.7 FPK 候选包。fnOS 实机验收仍需记录 CPU 架构、Node 版本、索引权限、请求耗时和实际成本。
- [x] 新章节/全书概述策略由 `BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING` 显式开关控制，默认关闭；关闭时回退旧 lookup。真实自有书启用验证和默认开启决策仍待实机质量验收。
- [ ] 监测章节解析失败率、范围误召回率、摘要生成失败率、缓存命中率、请求 tokens/成本与 p50/p95 延迟；日志不得记录原文和 Key。
- [x] 回滚路径已由默认关闭的功能开关和普通 lookup 回退保护；索引迁移保留旧文件直到新版本成功发布。实测阶段若普通查询回归、章节错误映射、成本突破预算或隐私边界测试失败，须关闭新策略并继续使用旧 lookup。

**最终验收门槛：**

- 精确章节映射集的 chapter mapping accuracy ≥ 98%；无法判定样本必须显式 unresolved，不计作猜测成功。
- `chapter_summary` 返回来源 100% 位于解析章节范围，跨章错误召回为 0。
- 长章摘要具备开头/中段/结尾覆盖，所有核心结论可点回原文。
- 现有普通检索 Recall@6、MRR@6 与阶段 3 已记录基线比较无显著回退；所有指标及测试集规模写入进度记录。
- 重复提问命中缓存时不重复生成相同章节摘要；首次请求和缓存请求成本分别报告。
- 每个请求有服务端 token/字符/并发上限；无静默整书上传；删书/失效后生成摘要不可访问。
- 对话持久化、流式输出、停止请求、来源导航、AI 索引权限和书架阅读功能回归通过。

## 文件边界总览

| 文件/目录 | 计划责任 |
| --- | --- |
| `app/server/ai-epub-structure.js` | 新增 EPUB TOC/spine/anchor 解析与逻辑章节范围生成 |
| `app/server/ai-chapter-retrieval.js` | 新增意图分类、服务端 scope 决策、coverage 与分层合成调度 |
| `app/server/ai-summary-cache.js` | 若现有索引管理器不能承载摘要缓存，再新增安全的摘要缓存适配层 |
| `app/server/ai-fts.js` | 复用 FTS 候选和索引生命周期；增加章节范围查询及 metadata |
| `app/server/ai-book-context.js` | 验证原文 source ID、chapterId 和 offset 属于当前书籍 |
| `app/server/ai-service.js` | 构造不同意图的模型提示词、上下文预算及流式请求 |
| `app/server/index.js` | 维持 API 兼容并接入服务端解析结果 |
| `app/ui/reader/epub.js` / `progress.js` | 提供当前阅读位置的最小可信映射线索 |
| `app/ui/reader/ai.js` | 发送章节定位、展示范围/成本/置信度及结果来源 |
| `tests/`、`scripts/` | 结构、范围、评测、API、安全、生命周期和浏览器回归 |

新增文件仅在已有模块无法保持清晰责任时创建；实施前必须再核对实际分支结构和并行改动，不得照计划盲目覆盖本地变更。

## 安全与稳定边界

### 范围与授权

- 章节 ID 是服务端针对当前授权书籍生成的内部引用；用户请求中的 href 先规范化、再查 manifest 白名单，拒绝路径穿越、外部 URL、未知资源、越权书籍和 offset 越界。
- 服务端根据书籍内容构建映射，客户端显示标签不能决定查询范围；章节 unresolved 时 fail closed，不扩大为全书。
- 每个中间摘要和 source ID 都绑定书籍 ID、文件指纹、用户访问上下文和解析版本；不可跨用户、跨书复用。

### 内容和供应商调用

- 本地完成 EPUB 解包、TOC 解析、文本分段和 FTS；AI 请求只含完成当前任务所需的章节段落或经验证的章节摘要加原文证据。
- 普通精确问题继续受既有 5400 字符上下文上限保护；章节/全书概述可设置独立、明确且更高但有限的预算，设置前必须用实际 provider tokenizer/保守估算与成本日志验证。
- 任何 provider 调用都从服务端读取 Key；不得在浏览器、日志、进度文件或索引 manifest 中记录 Key。
- 章节摘要按需生成；没有用户明确动作，不对书库批量发起模型调用。
- 处理 Prompt Injection：书中正文和摘要均是 data，不执行其中指令；摘要缓存命中也要经过原文/书籍指纹有效性校验。

### 持久化和生命周期

- 复用 AI 索引的原子发布、并发 lease、目录 `0700`、文件 `0600` 与临时文件清理机制。
- 新 schema 在旧索引旁构建，校验后原子替换；构建失败保留旧索引并进入兼容路径。
- 书籍更新使索引/摘要失效；书籍删除同步清理 BabyReader 生成的派生缓存，但不接触用户书籍文件、笔记、对话或阅读状态。
- 缓存保留、清理策略和最大磁盘占用必须有上限；不自动 VACUUM、全量删除或改写现有会话数据库。

## 分阶段回滚

| 阶段 | 回滚方式 |
| --- | --- |
| Task 1 结构解析 | 新解析器失败时标记 unresolved；保留旧 spine 元数据用于普通检索，禁止把它当 exact logical chapter |
| Task 2 阅读位置 | 移除新位置字段后旧客户端请求仍可使用原普通路径 |
| Task 3 scope 检索 | feature flag 关闭即回旧全书 lookup；不改普通查询 SQL 语义 |
| Task 4 概述 | 关闭 coverage/map-reduce 路径，普通 FTS 问答继续运行 |
| Task 5 缓存 | 停用摘要读取/写入；FTS 索引文件可独立保留，不读取过期摘要 |
| Task 6 全书摘要 | 关闭全书分层模式；用户可继续使用现有问答，不删书、不清会话 |
| Task 7/8 发布 | 关闭默认开关、保留诊断；回滚不要求用户重新配置 Key 或重传书籍 |

## 后续执行顺序与用户协作

1. 先执行 Task 0，冻结基线并报告评测夹具/契约结论。
2. 完成 Task 1 后暂停汇报章节解析的准确边界与索引迁移风险，再进入 Task 2。
3. 每完成 Task 2–7，提交阶段结果、定向回归、普通问答回归差异、成本/安全影响及下一 Task 目标；确认此阶段没有扩大既有范围后继续。
4. Task 8 形成候选版本、FPK 和真机验收清单；真实 fnOS 安装/API Key/成本验收需要在用户设备完成，记录实际结果再宣布发布完成。

## 执行状态

- Task 0–8 的计划内实现、测试、离线评测与候选包构建已完成；阶段记录见 `docs/superpowers/progress/2026-09-22-ai-chapter-understanding-progress.md`。
- 当前 1.1.7 FPK 是脏工作树构建的本地候选，不代表已发布或已在 fnOS 验收。
- 仍待书主在 fnOS 提供授权测试书与供应商 Key 后验证真实章节映射、答案依据、tokens/成本、p50/p95 延迟、权限隔离和回滚；本机未取得这些数据，因此不宣称模型质量/实机发布验收完成。
- FPK 构建输出使用隔离目录，保护原有 `dist/` 构件；构建脚本拒绝清理根目录 FPK 或覆盖既有隔离输出。
