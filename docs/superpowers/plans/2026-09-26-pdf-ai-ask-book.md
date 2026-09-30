# PDF AI 问书实施计划（P3.4）

> 状态：P3.3 导出已由用户验收；用户于 2026-09-26 要求完善并执行 P3.4。仅实现本地代码及合成 PDF / mock 供应商验收，不向真实供应商发送用户 PDF，也不修改 NAS 配置。

> 进度（2026-09-26）：Task 0–3 与 Task 4 的本地 Node / 结构验收已完成。浏览器 PDF+EPUB 合并回归 95/96；唯一的既有 PDF 书签进度等待用例单独重跑通过，合并运行时序问题仍需隔离复测。NAS 合成 PDF、真实用户 PDF 与真实供应商的联合验收尚未执行；不据此宣称设备端已验收。详见 `../progress/2026-09-26-pdf-ai-ask-book-progress.md`。

**Goal:** 让用户基于已授权 PDF 的可提取文本进行有页码证据的提问；明确区分选文、当前页/页码范围、全书可检索部分，不假装 PDF 存在 EPUB 的“本章”。

**Architecture:** 保留 PDF.js 阅读与 `ai-fts.js` 现有逐页索引；新增 PDF 专用服务端证据适配器，在 UID、授权路径、来源指纹和预算校验后生成有界页片段。复用现有 AI 服务配置、对话外壳及同源 API，但 PDF 分支独立构建提示词与页引用，绝不把 EPUB 的章节解析/客户端上下文当作 PDF 权威证据。参考契约：`2026-09-25-pdf-reader-quality-roadmap.md` 的 P3.4。

**Tech Stack:** Node.js、SQLite FTS5、现有流式 AI 服务与浏览器 AI 面板；首版不新增 OCR、向量数据库或外部 PDF 服务。

## 全局安全边界与完成定义

- 首版仅文本型 PDF。加密、损坏、纯扫描、索引缺失/过期、预算截断分别告知，不能把“未检索到”说成“书中没有”。“本章”问题只能请求用户确认页码范围，不能借 PDF 目录标题猜章。
- 用户主动提问前不调用供应商。服务端验证 fnOS UID、当前书、授权路径、PDF 开关、来源指纹与每条证据页码；不得信任浏览器提交的上下文或引文。撤权、切书、取消流式请求时不得继续发送/保存不相关结果。
- 只发送有限、可核验的文本片段和用户问题/选文到当前配置的供应商；不发送 PDF 文件、图片、其他书籍、NAS 路径或密钥。为候选数、单段字符、总输入、历史、输出 token、索引执行时间设明确上限和统计字段；实施前先量化现有 AI 上限，不能用“无限”占位。
- 引用必须从服务端证据 ID 映射到有效 `pageIndex + 1`，不可让模型自行创造页码；无法匹配则显示“依据不足”且引用不可点击。沿用现有会话隐私隔离，不改变 EPUB 章节问答结果和数据格式。
- 保存的 PDF 会话来源必须含文件指纹；再次读取会话时由服务端与当前授权文件指纹比对，仅下发 `stale` 状态，不向浏览器回显指纹；旧来源不可点击。旧版本无指纹的 PDF 来源按过期处理。
- 本文不授权提交、合并、打包、NAS 配置修改或处理真实私密 PDF。OCR、自动整书摘要、跨书问答、PDF 原文写回、外链访问另立计划。

## 冻结的首版接口与预算（Task 0）

- `POST /api/books/:id/ai/search` 与 `/ai/ask/stream` 使用 `{question, scope, pageIndex?, pageEndIndex?, selectedText?, history?, conversationId?}`。`scope` 限定为 `selection | page | page_range | searchable_book`；服务端不采纳客户端提交的 `context`、`sources` 或页引用。页索引是 0 基，显示/引用是 1 基。选文必须在当前页的已索引文本中核验；页范围最多 5 页。
- 问题至多 1000 字符，选文至多 1200 字符，历史最多 4 条、合计 2000 字符；证据最多 6 条、每条至多 750 字符、合计至多 4200 字符；模型输出上限 1200 token。受现有 PDF 提取上限、SQLite 索引租约和 AI 上游 30 秒超时约束，不新增整书摘要/整本发送。`searchable_book` 表示“全书可检索部分的有限命中”，不表示全文覆盖。
- 可验证 PDF 证据只来自当前授权书籍的当前指纹索引；`evidenceId` 是请求内 1 起序号，`pageIndex` 来自索引行。回答只允许引用该请求的证据 ID；浏览器仅显示服务端来源。PDF 对话历史不作为事实证据。
- “本章/这一章/当前章节”且未指定页范围返回 409 `insufficient_scope`，不得调用供应商。无文本、加密、预算超限、索引失败、无命中分别为 `pdf_no_searchable_text`、`pdf_password_protected`、`pdf_extraction_limit`、`pdf_text_unavailable`/`index_stale`、`insufficient_evidence`；SSE 开始前返回相应 409/413，取消后不得持久化。
- 阅读器 PDF 开关和 AI 配置已开启后，仅用户主动点击发送才会出站；在 UI 清楚提示“仅发送检索片段到已配置的 AI 服务”。设备端真实内容调用须另行获得明确许可。EPUB 请求体和响应契约保持不变。

## 文件与接口边界

- 新增 `app/server/pdf-ai-context.js`：PDF 检索范围、证据/页定位及预算校验的纯/可测适配层。复用 `app/server/ai-fts.js` 的索引生命周期和 `book-search.js` 的状态语义；若逐页候选/页范围查询不能由现有接口可靠提供，先增内部只读查询，不让客户端指定任意 SQLite 行。
- 修改 `app/server/index.js` 的 `/ai/search`、`/ai/ask/stream`、`/ai/ask` PDF 分支；保持 EPUB 分支的现有验证、结构与 415 以外行为。修改 `app/server/ai-service.js` 仅在需要时增加独立的 PDF 上下文/页引用格式，不复用 `第 N 章` 默认标签。
- 修改 `app/ui/reader/ai.js`、必要时 `app/ui/core/api.js` 和 `app/ui/reader/selection-menu.js`：提供 PDF 能力提示、页范围输入/选文、有限结果、流式取消与页码引用跳转；继续使用现有面板容器。
- 新增 `tests/pdf-ai-context.test.js`、`tests/pdf-ai-api.test.js`；扩展 `tests/ai-conversation-api.test.js`、`tests/pdf-content-api.test.js`、`e2e/pdf-reader.spec.js`。不更改 PDF 索引数据库 schema，除非测试证明缺字段并另经评审。

## Task 0：冻结契约、预算与失败基线

1. 盘点 `ai-fts.searchBook()` 当前 PDF 结果字段、`ai-service.validateAiRequest()` 的输入/历史上限、流式取消路径和 `book-search.js` 的 `unavailableReason`。形成明确的 PDF 请求契约：`scope=selection|page|page_range|searchable_book`，页索引 0 基、用户显示 1 基，页范围最大跨度待测量后锁定为具体常量。
2. 冻结错误/状态矩阵：`no_text`、`password_protected`、`extraction_limit`、`index_stale`、`insufficient_scope`、`insufficient_evidence`、`unauthorized`、`cancelled`；注明何时禁止供应商调用，HTTP 状态与前端文案分别断言。
3. 写失败测试：多栏重复词、跨页、选文与页范围、图像型、超限大 PDF、错误页引用、切书/撤权/不同 UID、并发会话。运行 `node --test tests/pdf-ai-context.test.js tests/pdf-ai-api.test.js`，确认失败仅因 PDF 分支未实现。

## Task 1：受控检索适配器

1. 服务端根据授权 `book` 和当前索引指纹读取逐页文本。选文只作为用户明确提供的上下文；页/页范围先限域查询，`searchable_book` 再走全书有界检索，不能将无命中页扩展为整本上传。
2. 候选仅含 `evidenceId`、`pageIndex`、有限摘录和相关性/可用性状态；对多栏重复词、空白页、截断页去重并保留真实页码。来源指纹失配或索引过期时先重建/报告不可用，不使用旧页引用。
3. 强制执行候选数、单段/总字符、执行时间及中断预算；对 `ai-fts.js` 与 `book-search.js` 增补覆盖测试，确保 EPUB 索引不受影响。

## Task 2：服务端问答、流式与隐私

1. 在 PDF 分支重新验证用户、书、路径、指纹与 scope；服务端从 Task 1 结果自行组装模型上下文，不接受客户端伪造证据正文/页码。使用 PDF 专用提示词：只依证据回答，不说“本章”，引用以可验证 `evidenceId` 对应页为准。
2. 延续已配置供应商与现有输出上限，限定传输字符、对话历史、输出 token。无可用证据/用户问“本章”但没页范围时直接返回可理解提示，且不产生供应商请求。
3. SSE 断开/取消、供应商超时、切书与撤权必须释放工作并避免跨会话串流或保存错误答案。用 mock 供应商测试实际出站 payload：只含选定文本，不含完整 PDF/路径/密钥/其他 UID 内容。

## Task 3：面板与可信页引用

1. PDF 打开现有 AI 面板时默认检索本书可检索部分，并展示简短的隐私提示；不在短篇论文阅读流程中额外要求选择依据范围。通过选文入口提问时，选中文本仍是唯一范围。服务端保留页/页范围契约供后续需要的界面复用。关闭或切书清空 PDF 证据状态，保留 EPUB 面板原交互。
2. 回答引用以服务端证据列表渲染 `第 N 页`；点击后经现有 PDF 导航方法跳到页面，保留面板并突出相关片段（若有可靠定位）；无文本/过期/低置信度显示明确限制，不伪装已阅读全文。
3. 补浏览器测试：引用准确页、跨页/重复词、切书期间的晚到响应、取消流、无文本提示、键盘/移动端面板可用性。先运行失败测试再实现到通过。

## Task 4：回归、费用基线和设备门禁

1. 已执行完整 Node 测试、`npm run check` 与 `git diff --check`，全部退出码 0。PDF+EPUB 浏览器合并回归为 95/96；单项失败为 PDF 书签用例等待进度 PUT 超时，单独重跑通过。详见进度记录。
2. 在合成 PDF 与经用户许可的 NAS PDF 上核对页码、证据片段、无文本/加密/截断错误；记录候选数、发送字符数、耗时与实际费用上限，验收不依赖模型“看起来答对”。
3. EPUB 章节问答与 AI 会话回归必须通过；未经用户明确同意，不用真实私人 PDF 调外部供应商。设备端只验证授权链路与合成内容，完成后更新进度文档；提交、打包与发布另行授权。

**Review focus:** PDF/EPUB 语义隔离、服务端证据可信性、页引用不造假、预算和隐私、取消/并发、无文本与截断的诚实提示。
