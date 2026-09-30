# AI 章节理解与低成本问书进度

更新时间：2026-09-23

## 当前状态

- Task 0：已完成（合成结构 fixture、意图分类和评测基线契约已落地）。
- Task 1：已完成，服务端逻辑章节清单解析与索引持久化已接入。
- Task 2：已完成，阅读器 semantic locator 可映射到服务端逻辑章节。
- Task 3：已完成，服务端规则识别问答意图并对章节/小节检索实施硬范围限制。
- Task 4：已完成，章节概述采用完整短章或预算封顶 map-reduce 证据链。
- Task 5：已完成，最终摘要与 map 分段摘要都已缓存并按用户隔离。
- Task 6：已完成，全书概述使用可信目录、摘要缓存与 FTS 排选最多 8 章，再读取原文证据并按逻辑章分段。
- Task 7：已完成，来源范围/标签校验、引用过滤、概述置信度与恢复展示已加固。
- Task 8：软件候选阶段已完成；等待 fnOS 真机、授权 EPUB 和真实供应商 Key 验收。

## Task 0 冻结的现有契约

| 功能 | 冻结行为 |
| --- | --- |
| 普通事实问答 | 继续使用当前 FTS + 词法排序，最多 6 个片段，默认书本上下文上限 5,400 字符 |
| 选中文本问答 | 保留 selectedText/context 校验、流式回答、多轮历史和来源卡片 |
| 章节定位 | 当前 `chapter.index` 是 spine 序号，只能当阅读位置线索，不能直接视为逻辑章 ID |
| AI 来源 | 仅展示本次请求提供且服务端验证属于该书的来源；禁止模型自造来源 |
| 本地回退 | FTS 不可用时保留原前端回退；章节范围无法解析时后续新路径不得静默扩大成全书范围 |
| 服务端机密 | API Key 仅由服务端读取，正文/Key 不写入本评测数据或诊断日志 |

## 评测基线与版本

历史报告 `docs/superpowers/audits/2026-09-20-ai-retrieval-baseline.md` 记录了原始 38 题：32 个单章事实问题、6 个跨章问题；书籍为《吃的营养科学观》，EPUB spine 126 项，人工标注主章节 32 个。已记录混合排序指标：Recall@1 52.63%、Recall@3 71.05%、Recall@6 78.95%、MRR@6 62.59%、平均非标注章节占比 85.66%。该历史数据是普通检索回归基线，不是“本章概述”质量或答案正确率。

当前评测夹具扩展至 40 题：原 32 个单章查找、6 个跨章问题，加 2 个章节概述意图样例；章节概述题额外标注 spine href，以便 Task 1 后升级逻辑章节标识。`scripts/evaluate-ai-retrieval.js` 按 `lookup`、`cross_chapter`、`chapter_summary` 分组输出 Recall@6 和 false recall rate。现阶段章节概述的分组结果只衡量全书检索是否触及相关章，不衡量当前章过滤或模型摘要质量。

本机工作区未提供测试书 EPUB，故本 Task 不从用户目录查找或复制书籍，也未对 40 题运行真实书本 FTS。历史指标和数据集仍可追溯；由用户在有授权的本机/设备上复跑并更新实测报告。此限制不影响本 Task 的合成结构 fixture 和评测逻辑回归。

## 指标定义与测量方式

| 指标 | 计算方式 | 可否离线 |
| --- | --- | --- |
| 章节定位准确率 | 已人工标注位置中，服务端解析到正确逻辑 chapterId 的比例；unresolved 单独统计，不记作猜中 | 合成 EPUB 可离线，真实书籍需本地脱敏测量 |
| 章节范围纯度 | 章节概述来源中属于目标逻辑章节的片段比例；发布门槛要求 100% | 可离线 |
| 首/中/尾覆盖率 | 入选来源覆盖目标章开头、中段、结尾三个区间的比例 | 合成数据可离线；真实书籍需书主本地运行 |
| 来源可回指率 | 输出引用 source ID/offset 能映射到当前书原文的比例 | 本地集成验收 |
| unsupported claim 率 | 人工核查回答中的事实主张，统计无原文依据比例 | AI provider 回答验收，离线 FTS 无法推断 |
| provider tokens/cost | 使用 provider usage 数据；缺少 usage 时以服务端保守 tokenizer 估算并标记估算 | 授权 provider 实测 |
| 摘要缓存命中率 | cache hit / eligible summary request | 缓存实现后可本地统计，不记内容 |
| 延迟 | 分阶段测 parse/retrieval/provider/total 的 p50/p95 | 本机或 fnOS 设备实测 |

## Task 0 文件和验证证据

- `tests/fixtures/ai-chapter-structure-cases.json`：8 个合成结构边界，包括同文件多章、跨 spine 项章节、嵌套目录、无目录、百分号编码 fragment、重复/缺失 heading、front matter、无法映射的当前位置；不含用户正文。
- `tests/fixtures/ai-retrieval-questions.json`：扩展 2 个章节概述标签，原书正文没有加入仓库。
- `scripts/evaluate-ai-retrieval.js`：校验检索意图标签并输出按意图分组指标。
- `tests/ai-retrieval-eval.test.js`：验证数据标签、结构 case 清单、按意图统计和旧章节 false recall。
- 定向测试：`node --test tests/ai-retrieval-eval.test.js`，5/5 通过。
- 定向测试：`node --test tests/ai-retrieval-eval.test.js`，5/5 通过。
- 全量测试：`npm test`，257 通过、5 跳过、0 失败。
- 结构检查：`npm run check` 通过（41 required files、9 lifecycle scripts）。
- Task 0 ledger 已记录全量测试命令及结果。

## 当前执行决策

- Ruling：在当前 main 工作区执行，由用户明确授权开始 Task 0，且此目录含有当前运行代码的多项未提交更改；其他名为 `ai-chapter-retrieval-task1` 的 worktree 基于历史书签提交，和当前工作树不同步。只修改本计划列出的范围，不 stage、撤销或重写其他已有更改。风险：本地改动会共同存在，最终需按文件审阅隔离。
- Ruling：当前未提供用于真实重跑的 EPUB，因此 Task 0 用历史报告和合成 fixture 建立可追溯基线，真实书籍重跑安排在 Task 8 设备/本地验收。风险：FTS 指标可能与历史版本发生漂移，发布前必须复测。

## Task 1 结构解析与索引集成

- 新增 `app/server/ai-epub-structure.js`：解析 OPF manifest/spine、EPUB3 Nav、NCX、嵌套目录、fragment 与 heading/ID 文本偏移；生成稳定逻辑章节 ID、跨 spine 范围、映射质量及 parserVersion。
- `exact` 仅用于明确指向标题元素的 fragment；缺失 fragment、普通段落锚点、重复 ID 和推断目录都保守标为 `inferred`。编码后的路径分隔符及归档根外路径拒绝解析。
- `ai-fts.js` schema 升为 4，新增可选表 `ai_epub_structure` 存储有界 JSON 结构，并为 chunk 增加逻辑章/节 scope ID；旧 `chapterIndex` 仍是 spine 序号。索引 metadata 记录 parserVersion；旧 schema 或 parser 版本自动触发 build-lease 下的安全重建，原文件在原子发布前不删除。
- fnOS 管理 API 使用与 FTS 一致的 schema 版本；可选结构表没有加入管理器的必需表集合，避免旧索引误判为损坏。
- 合成边界覆盖多 fragment、跨资源章、嵌套/无目录、编码 fragment、重复/缺标题、front matter、unresolved 位置、NCX、归档路径穿越和 TOC 深度上限。
- 验收：`node --test tests/ai-epub-structure.test.js tests/book-search.test.js tests/ai-index-manager.test.js tests/ai-retrieval-eval.test.js` → 34 通过、1 平台跳过、0 失败；`npm test` → 263 通过、5 跳过、0 失败；`npm run check` → 通过（41 required files、9 lifecycle scripts）。
- 阶段边界：Task 1 只保存章节结构，不改变问答范围策略，也没有向模型发送新字段；旧检索 `chapterIndex` 契约冻结。

## Task 2 阅读位置解析

- `currentAiChapter()` 复用阅读器现有 semantic locator，从当前可见 EPUB 资源读取 `href` 与最近可用 `anchor`；请求保留 spine `index`，只附带有限长 `{href, anchor, offset?}`，不发送进度文本、TOC 或整书内容。
- `validateAiRequest()` 只复制允许的位置字段，丢弃其余定位属性；服务端从该书的 SQLite 章节结构解析当前位置，核对 spine index 与 href、canonical archive path、唯一 anchor 和文本 offset 范围。章节 label 由服务端解析，客户端 label/chapterId 不参与判定。
- 多章节共用 spine 且没有有效 anchor/offset 时返回 `unresolved`；单章节 spine 可兼容旧客户端；跨 spine 章节的尾部位置可归回同一逻辑章。无位置或推断映射状态会通过搜索响应与 SSE meta 回传，并显示不确定提示，不伪装成已确认章节。
- 新增 `tests/ai-chapter-scope.test.js`：覆盖文件起始、目录 fragment、同文件第二章、跨资源尾部、章节间 offset、恢复稳定、伪造/越界 href 与不匹配 spine，以及安全索引解析。
- 定向回归：`node --test tests/ai-chapter-scope.test.js tests/ai-epub-structure.test.js tests/book-search.test.js tests/reader-core.test.js tests/ai-conversation-api.test.js tests/dom-regression.test.js` → 184 通过、0 失败。
- 旧 API 身份校验、context 校验与常规 stream 路径保持既有测试通过；Task 2 尚未调整 FTS 章节摘要候选范围，硬范围过滤属于 Task 3。

## Task 3 意图分类与硬范围检索

- 新增纯规则 `classifyAiIntent()`：覆盖章节/小节概述与查找、选中文本总结、全书概述、跨章综合、事实/因果查找及模糊输入；没有新增分类模型调用。全书/跨章节和选中文本范围优先于当前章词语。
- EPUB FTS chunk 记录服务端解析出的 `logicalChapterId`/`logicalSectionId`；章节/小节 SQL 使用绑定参数硬过滤。若范围缺失或伪造，即使直接调用检索服务也返回 `insufficient_scope`，不会自动转成全书查询。
- 章节概述 coverage 取样与普通查询分开；常规 lookup 保留已有 FTS top-k、词法融合、去重和预算。API 增加 intent/scope/scopeConfidence/coverage 元数据；没有正文、路径或 key 诊断日志。
- 定向测试：意图案例、双章节同一 XHTML 不串章、伪造章节 ID 和无小节 ID fail-closed。Task 3 `npm test` → 通过，0 失败、5 跳过；`npm run check` → 通过。

## Task 4 覆盖式章节证据与 map-reduce

- 新增 `readChapterEvidence()`：仅按已由当前书解析出的逻辑章节 ID，从该书的 FTS 索引读取原始 chunk/heading/href/offset；最多读取 128 项，SQL 参数绑定并在 read lease 内访问。
- 新增 `planChapterSummary()`：短章 ≤5,400 格式字符走完整章上下文；长章在 spine 资源边界及 3,000 字符上限处分组；最多 8 个 map task、总原文上限 22,000 字符。超预算返回可理解错误，绝不把少量随机 top-k 伪装成整章摘要。
- map 阶段每组最多 300 output tokens，reduce 最多 1,200；整条链有 120 秒总时限，传递外部取消信号。map 输出带原文 source IDs，reduce 仅接收有限 map 证据并按当前证据组生成可回指引用；会话只持久化验证过的书内路径及起始 offset，不存模型中间摘要。
- stream 与兼容同步问答入口对章节总结共用该策略；其他提问不变。元数据回传 summaryMode、coverage 与估计原文字数。估算为字符数上限，不冒充供应商价格；无动态 token/价格估算，因为兼容供应商费率与 tokenizer 不统一。
- 定向回归 `ai-chapter-retrieval`、`reader-core`、`ai-conversation-api`、章节映射和全文搜索均通过；当前 source card 的阅读跳转仍是章节级，精确 chunk/offset 跳转由 Task 7 处理。
- 安全边界：用户正文在 map prompt 中仍按不可信数据处理；不自动总结其他章节；失败/取消不产生已完成的持久化 turn；最多 8 次 map + 1 次 reduce 请求、累计原文 22k 字符、2 分钟 deadline。

## Task 5 分层摘要缓存与失效

- 新增 `app/server/ai-summary-cache.js`：缓存指纹包含用户 hash、书籍/分段内容指纹、逻辑章节、parser、策略、provider/base URL/model 与 prompt 版本；明文用户 ID、API Key 和正文路径不进入缓存 key 或 cache JSON。
- `ai-fts.js` schema 升至 7，新表 `ai_chapter_summary_cache` 与该书 FTS 索引同文件、SQLite `BEGIN IMMEDIATE` 事务写入；文件仍受索引的 0600 权限与 0700 目录保护。最多保留 200 条每书 cache row，最终回答和 map 段分别标记。
- 命中最终缓存时跳过 provider；书籍索引变更会丢弃旧最终回答，但在安全重建时只迁移最多 200 条 map-segment 缓存。map key 使用该段文本、来源 ID、href 与 offset 的 hash；只复用相同段落/位置，解析器/提示词/模型变化不命中。
- 最终与分段构建都有进程内 single-flight；provider 失败/取消不写入对应未完成项；缓存写失败不丢弃已完成回答。删除书籍索引同时删除该书所有摘要缓存；没有单独清理用户目录或触碰会话/阅读状态。
- UI 在章节概述期间显示输入 token 粗估（明确标注供应商差异）与本地缓存命中状态；不根据 token 猜供应商价格，也没有自动批量构建。
- 缓存测试：稳定/失效维度、用户隔离、并发 single-flight、失败重试、索引重建后复用未变段落、删除索引移除缓存。全量 `npm test` → 279 通过、5 跳过、0 失败；`npm run check` 通过（41 required files、9 lifecycle scripts）。
- 注意：当前 FTS source fingerprint 继承现有索引契约（规范路径、文件大小、mtime），不是每次检索重读整本书计算的密码学内容 hash；map 段另有文本 hash。后续如要升级整书指纹需测量大书重读成本。

## Task 6：全书概述的分层导航

- `readBookNavigation()` 从当前 EPUB FTS 索引读取服务端解析的目录一级章节；候选排序组合问题词、章节标题、当前用户/模型已有的章节摘要和 bounded FTS 命中，并在最多 8 章内补齐前中后覆盖。
- 选中章节后逐章调用 `readChapterEvidence()`；每个原文块附逻辑章 ID，map 分组遇到逻辑章变化即切分，即使多个章节共用同一 XHTML 资源也不会合并。缺少目录/原文或超预算时 fail closed。
- 明确的全书概述即使普通 FTS 没返回片段也能执行：仅规则分类为 `book_summary` 的路由可先接受空客户端 context，之后服务端用目录和本地索引重建、替换 context。客户端不可指定待总结章节 ID。
- 最终 cache 使用独立 book-summary 类型，指纹包含整书索引 fingerprint、选中章节 ID 和规范化问题；map cache 分章隔离。提示词披露抽样章节数并禁止声称覆盖未提供章节，UI 显示代表性覆盖说明。引用仍绑定本次提交给模型的原文证据组。
- 硬限制：最多 8 个目录章节、22,000 个原文字符、8 个 map task、每组 ≤3,000 字符、map/reduce ≤300/1,200 输出 tokens、120 秒 deadline；既有停止按钮会中止请求。未增加批量摘要功能；未接 prompt caching（兼容供应商缺少一致可信的 cached-token 收益信号）。
- 新增回归：跨章共享 href 的任务隔离、目录一级映射、章节摘要缓存读取的用户隔离、仅 book-summary 可允许空 context、采样章数提示与覆盖声明。
- 验收：`npm test` → 283 通过、5 跳过、0 失败；`npm run check` → 通过（41 required files、9 lifecycle scripts）；Node 语法检查通过。
- 本机没有用于供应商实问的授权 EPUB/Key，因此真实内容准确率、用量成本与 fnOS 设备延迟留 Task 8 验收，不宣称模型回答已验收。

## Task 8 专项评测、回归和候选发布

- 功能开关：`BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING` 默认 `0`；只有显式设为 `1` 才允许章节/全书概述的新策略。关闭时章节/全书意图回落到既有普通 lookup；空 context 也仅在开关开启且服务端规则判定为全书概述时接受。fnOS lifecycle 默认值和 API 行为均有测试。
- 隐私：检索评测报告不输出问题原文，只记录匿名问题 ID/指标；离线章节评测不调用 provider。
- 离线合成评测结果：3 个来源、章节范围纯度 1.0，开头/中段/结尾均覆盖，source 与 map 引用均有效，预算上限通过。该结果验证 plumbing，不等同真实书籍答案准确率。
- 验证：`npm test` → 287 通过、5 平台跳过、0 失败；`npm run check` 通过（41 required files、9 lifecycle scripts）；`npm run check:portable` 由 FPK 构建的结构校验通过；在 Git Bash 环境 `npm run check:posix` 通过。
- Chromium 全套回归：90 通过、10 环境跳过、0 失败；书库组织浏览器专项：8 通过。跳过项不是失败，详见测试输出/环境依赖。
- FPK：1.1.7 本地候选已打包至 `dist-task8-final-20260923/babyreader-fnos.fpk`，大小 5,498,228 bytes，SHA-256 `6fd90d075c5b6b562b73214710aec7e2b099ac33d683ce8992bde2fefd676f52`；包内 manifest version 为 1.1.7，构建依赖审计 0 vulnerabilities。包溯源记录工作树 dirty，base commit `c5cdbe7`，因此是本地候选，不是可复现的干净发布构建。
- 构建安全：原 `dist/babyreader-fnos.fpk`、校验文件、provenance 和共享 `.build/fpk-root` 已存在。为防止覆盖，更新 `scripts/build-fpk.sh` 默认使用唯一的隔离 staging/output 名称，支持受限的隔离路径参数，并在任一目标已存在时拒绝覆盖；不再删除仓库根 FPK。本次使用新的 `dist-task8-final-20260923/` 和 `.build/fpk-task8-final-20260923/`，原构件保留。
- 外部验收未完成：当前没有授权测试 EPUB/供应商 API Key，也没有 fnOS 安装环境，因此真实章名解析、引用答案质量、首次/缓存请求 tokens 与费用、端到端 p50/p95、不同用户隔离和关停/回滚行为仍须在用户 NAS 按 `docs/FNOS_DEVICE_ACCEPTANCE.md` 操作。不得把离线合成指标误报为 AI 实答验收。
- 阶段判定：Task 8 的软件实现、离线回归和候选包已完成；整个计划的发布门槛仍保持“待真机/真实供应商验收”。

## Task 7：来源溯源、置信度和失败体验

- `validateAiBookContext()` 对 EPUB 上下文要求合法且匹配的 spine href/index，并在原文资源中核对片段；返回给回答与来源卡片的 label 改为不信任客户端提供的标签。非 EPUB 来源统一显示“本书”。
- `sanitizeAiAnswerCitations()` 在同步、流式最终结果与 map/reduce 输出中移除超出当前 context source 数量的引用；服务端持久化已过滤答案。前端在完成回答和恢复会话时再次依据来源元数据移除没有 source chip 的编号，防止旧会话或异常供应商输出生成假来源链接。
- 新增 `assessSummaryConfidence()`：章节概述只有 exact mapping、完整 coverage、服务端来源一致性通过且至少包含有效引用时才标高；book summary 的有限章节抽样、推断映射、无引用或来源校验不足会显式降级。UI 将低置信度说明放在回答卡片；全书抽样比例说明由 Task 6 状态显示。
- 原文注入仍作为不可信数据；模型没有工具执行能力，用户请求正文不进入诊断日志。stream 未完成/取消不持久化；完成后会话保存失败仍保留回答并报告安全错误；summary cache 只接收通过完整 build 返回的答案及 citationIntegrity。
- 新测试覆盖伪造引用过滤、来源 chip/恢复场景过滤、范围置信度因素、EPUB 来源标签边界、会话持久化与 abort/error 旧契约。
- 验收：定向测试 `node --test tests/ai-chapter-retrieval.test.js tests/reader-core.test.js tests/dom-regression.test.js tests/ai-conversation-api.test.js tests/ai-summary-cache.test.js` → 174 通过、0 跳过、0 失败；`npm run check` 通过。
- 限制：本 Task 不宣称模型主张逐句 entailment 或矛盾自动发现；置信度只表示映射、覆盖、来源与引用的机械校验结果，不等于语义正确率。
