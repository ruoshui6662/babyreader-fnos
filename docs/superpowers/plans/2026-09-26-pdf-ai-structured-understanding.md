# PDF AI 结构化理解优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不上传整本 PDF、不改变 EPUB 的前提下，为学术 PDF AI 问书增加可缓存的论文结构理解、问题意图路由和跨部分证据检索，提高整体概括、方法、发现与局限类回答的准确率和成本效率。

**Architecture:** 保留现有 PDF.js 逐页提取、SQLite FTS、服务端页码核验和流式问答作为可信底座；在独立 PDF 模块中新增本地结构地图、按需快速论文画像及混合证据编排。新路径受默认关闭的 feature flag 保护，任何结构提取、画像构建或核验失败都回退现有 PDF FTS，不进入 EPUB 分支。

**Tech Stack:** Node.js 22、CommonJS、`pdfjs-dist@6.3.289`、SQLite FTS5、OpenAI-compatible Responses API、Node test runner、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-26-pdf-ai-structured-understanding-design.md`

## Global Constraints

- 仅修改 PDF AI 路径；EPUB 的请求体、章节检索、摘要缓存、提示词、UI 与存储格式保持原样。
- `BABYREADER_ENABLE_PDF_AI_STRUCTURE` 默认关闭；关闭时必须逐字节保持现有 PDF 上游请求形态（随机请求 ID 等非确定字段除外）。
- 不升级 `AI_FTS_SCHEMA_VERSION`，不触发既有 EPUB/PDF FTS 全量重建，不向现有 EPUB 摘要表写入 PDF 数据。
- 扫描书库、打开 PDF、翻页、搜索和建立本地 FTS 时不得调用 AI 供应商；只有用户主动发送需要结构理解的问题才能构建画像。
- 不上传 PDF 文件、图片、NAS 路径、密钥或未入选全文；首版最多发送 24,000 字符用于画像，普通回答仍遵守现有 4,200 字符证据预算。
- 新缓存目录权限为 `0700`、文件为 `0600`，采用同目录临时文件 + 原子 rename；缓存键必须包含 UID、文件指纹、模型、供应商、解析器/策略/提示词版本。
- 页索引内部 0 基、显示与引用 1 基；最终可点击来源只能来自本次重新核验的原始 PDF 页证据，画像本身不能成为来源。
- 纯扫描、加密、损坏、超限、结构低置信度、取消、撤权和文件变化均不得产生未经核验的答案或半成品缓存。
- 不复制 `learn-from-materials` 源码；若执行阶段改变此决定，必须先暂停并完成 MIT `LICENSE`/`NOTICE` 合规评审。

## Review Focus

- 无 outline、多栏错序或标题误判：结构置信度应降低并回退页窗/FTS，不能虚构章节；Task 1 用无 outline、多栏和伪标题夹具固定。
- 同一文件在画像生成期间被替换或授权被撤销：中止并丢弃结果，不能保存旧文件画像；Task 3 与 Task 5 固定。
- 模型返回无效画像引用或提示注入内容：无效条目应丢弃，不能成为回答证据；Task 3 与 Task 4 固定。
- 并发相同问题、取消和超时：同键只产生一次画像构建，取消不误杀其他等待者且不写半成品；Task 3 固定。
- EPUB 或 feature flag 关闭路径意外进入新模块：供应商 payload 与现有基线一致，新增模块调用次数为 0；Task 0 与 Task 7 固定。

---

## 文件结构与职责

### 新建

- `app/server/pdf-ai-structure.js`：结构限制、outline/标题候选规范化、结构置信度与结构单元页范围；纯函数，不访问网络。
- `app/server/pdf-ai-profile.js`：画像规划、画像 schema 校验、画像提示词与引用完整性；不负责持久化。
- `app/server/pdf-ai-profile-store.js`：PDF 结构/画像 JSON 缓存、权限、原子写、指纹/版本失效和单键并发合并。
- `app/server/pdf-ai-retrieval.js`：PDF 问题意图分类、检索计划和结构/画像/FTS 证据融合。
- `tests/pdf-ai-structure.test.js`：结构提取与低置信度退化测试。
- `tests/pdf-ai-profile.test.js`：画像预算、缓存键、引用校验、并发和失效测试。
- `tests/pdf-ai-retrieval.test.js`：意图分类、检索计划和混合证据测试。
- `tests/fixtures/pdf-ai-paper-cases.js`：无版权合成论文结构、页文本与问答期望。
- `scripts/evaluate-pdf-ai-structured-retrieval.js`：离线输出新旧检索覆盖率、页引用和预算差异。
- `docs/superpowers/progress/2026-09-26-pdf-ai-structured-understanding-progress.md`：逐 Task 记录证据、失败与设备验收状态。

### 修改

- `app/server/pdf-text.js`：复用安全文件读取和 worker 生命周期，增加受限的 `extractPdfStructureSignals()`；保持 `extractPdfText()` 返回契约。
- `app/server/pdf-text-worker.js`：增加 `mode=structure`，提取受限 outline 与标题候选；`mode=text` 的现有逐页文本输出不变。
- `app/server/ai-fts.js`：增加只读、多页范围的 PDF 证据查询接口；不改 schema 和 EPUB SQL。
- `app/server/pdf-ai-context.js`：扩展 PDF 结构化检索预算与可选 retrieval metadata，不改变现有请求字段。
- `app/server/ai-service.js`：增加 PDF 画像请求及结构化回答协议；现有 EPUB payload builder 不改。
- `app/server/index.js`：仅在 PDF 分支和 flag 开启时编排结构、画像、混合检索；保留现有 `preparePdfAiEvidence()` 作为回退。
- `app/server/ai-index-manager.js`：通过可选删除回调把现有单索引删除和孤儿清理事件交给 PDF AI 缓存；索引删除本身不能依赖缓存清理成功。
- `app/ui/reader/ai.js`：消费可选的结构分析状态，不增加范围选择器，不改变 EPUB 面板。
- `tests/pdf-ai-api.test.js`、`e2e/pdf-reader.spec.js`：API、取消、UI 状态、页跳转和回退回归。
- `tests/ai-chapter-retrieval.test.js`、`e2e/reader.spec.js`：锁定 EPUB 不进入 PDF 结构路径。
- `scripts/validate-structure.js`：把新服务端文件纳入包结构检查。

---

### Task 0: 冻结基线、feature flag 与离线评估门槛

**Files:**
- Create: `tests/fixtures/pdf-ai-paper-cases.js`
- Create: `scripts/evaluate-pdf-ai-structured-retrieval.js`
- Create: `docs/superpowers/progress/2026-09-26-pdf-ai-structured-understanding-progress.md`
- Modify: `app/server/pdf-ai-context.js`
- Modify: `tests/pdf-ai-context.test.js`
- Modify: `tests/pdf-ai-api.test.js`
- Modify: `tests/ai-conversation-api.test.js`

**Interfaces:**
- Consumes: 现有 `validatePdfAiRequest(body)`、`searchPdfEvidenceRows()`、`buildPdfResponsesPayload()`。
- Produces: `PDF_AI_STRUCTURE_LIMITS` 常量；可重复的合成论文评估集；flag 关闭与 EPUB 隔离基线。

- [x] **Step 1: 写 feature flag 关闭路径的失败测试**

  在 `tests/pdf-ai-api.test.js` 记录当前 `scope=searchable_book` 的 mock 上游 payload，并断言 `BABYREADER_ENABLE_PDF_AI_STRUCTURE` 未设置时不存在 `paperProfile`、`structure`、`retrievalMode`；在 `tests/ai-conversation-api.test.js` 捕获 EPUB 流式问答的 mock 上游 payload，断言不包含 PDF 结构字段。纯 `ai-chapter-retrieval.test.js` 不用于伪装覆盖 HTTP 路由。

- [x] **Step 2: 写资源预算与评估夹具测试**

  在 `tests/pdf-ai-context.test.js` 断言：结构节点 `256`、outline 深度 `8`、标题 `160` 字、画像总原文 `24000` 字、单 map `8000` 字、map 调用最多 `3`、reduce 输入 `8000` 字、输出 `1600` token、总截止时间 `45000ms`。夹具至少包含摘要、引言、方法、结果、讨论、局限，以及无 outline、多栏与纯图片变体。

- [x] **Step 3: 运行测试并确认仅因新契约缺失失败**

  Run: `node --test tests/pdf-ai-context.test.js tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js`

  Expected: FAIL，失败项只涉及 `PDF_AI_STRUCTURE_LIMITS`、flag 分支 spy 或新评估夹具。

- [x] **Step 4: 在 `pdf-ai-context.js` 定义冻结常量并实现 flag 纯函数**

  新增接口：

  ```js
  const PDF_AI_STRUCTURE_LIMITS = Object.freeze({
    maxStructureNodes: 256,
    maxOutlineDepth: 8,
    maxHeadingChars: 160,
    maxProfileSourceChars: 24000,
    maxMapInputChars: 8000,
    maxMapTasks: 3,
    maxReduceInputChars: 8000,
    maxProfileOutputTokens: 1600,
    maxProfileDurationMs: 45000
  });
  function pdfAiStructuredRetrievalEnabled(env = process.env) {}
  ```

  仅接受 `1|true|yes|on`，默认 `false`。不要把开关加入用户设置 UI。

- [x] **Step 5: 实现离线评估脚本的基线模式**

  `scripts/evaluate-pdf-ai-structured-retrieval.js` 读取合成夹具并输出 JSON：`caseId`、`intent`、`expectedPages`、`baselinePages`、`pageRecall`、`evidenceChars`。Task 0 只记录现有 FTS 基线，不调用真实 AI。

- [x] **Step 6: 验证基线并记录进度**

  Run: `node scripts/evaluate-pdf-ai-structured-retrieval.js --baseline`

  Expected: 退出码 0；报告含全部夹具，整体问题基线不足可以记录但不得伪装通过。

  Run: `node --test tests/pdf-ai-context.test.js tests/pdf-ai-api.test.js tests/ai-chapter-retrieval.test.js`

  Expected: PASS。

- [ ] **Step 7: Commit — defer if staging would include pre-existing untracked implementation files**

  ```bash
  git add app/server/pdf-ai-context.js tests/pdf-ai-context.test.js tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js tests/fixtures/pdf-ai-paper-cases.js scripts/evaluate-pdf-ai-structured-retrieval.js docs/superpowers/progress/2026-09-26-pdf-ai-structured-understanding-progress.md
  git commit -m "test: freeze PDF AI structure baseline"
  ```

### Task 1: 本地 PDF 结构信号与结构地图

**Files:**
- Create: `app/server/pdf-ai-structure.js`
- Create: `tests/pdf-ai-structure.test.js`
- Modify: `app/server/pdf-text.js`
- Modify: `app/server/pdf-text-worker.js`
- Modify: `tests/pdf-text.test.js`

**Interfaces:**
- Consumes: `PDF_TEXT_LIMITS`、`PDF_TEXT_PARSER_VERSION`、Task 0 的 `PDF_AI_STRUCTURE_LIMITS`。
- Produces: `extractPdfStructureSignals(book, {signal, limits}) -> Promise<PdfStructureSignals>`；`buildPdfStructure(signals) -> PdfStructure`；`PdfStructure.sections[] = {id,title,pageStart,pageEnd,level,source,confidence}`。

- [ ] **Step 1: 写 outline、标题候选和低置信度退化测试**

  `tests/pdf-ai-structure.test.js` 断言：嵌套 outline 被限制在 8 层/256 节点；命名 destination 映射为真实物理页；重复/空标题被移除；无 outline 的高置信标题形成不重叠页范围；多栏正文中的大字误判不会生成高置信章节；无可靠信号返回 `mode: 'page_windows'` 且不伪造标题。

- [ ] **Step 2: 写现有文本提取契约不变测试**

  `tests/pdf-text.test.js` 对同一合成 PDF 比较修改前后的 `extractPdfText()`：`status`、`parserVersion`、`pages[{pageIndex,text}]`、`extractedCharacters` 完全一致；结构模式输出不得携带整页全文。

- [ ] **Step 3: 运行结构测试确认失败**

  Run: `node --test tests/pdf-text.test.js tests/pdf-ai-structure.test.js`

  Expected: FAIL with `extractPdfStructureSignals is not a function` 或 `buildPdfStructure is not a function`。

- [ ] **Step 4: 在 worker 中实现独立结构模式**

  `mode=text` 保持现有循环和输出；`mode=structure` 调用 `document.getOutline()`，受限解析 destination，并从 `getTextContent()` 仅保留标题候选所需的 `text/pageIndex/fontSize/y/hasEOL`。不得回传字体对象、矩阵全集或整页正文；中止、密码、文件上限沿用现有错误码。

- [ ] **Step 5: 在 `pdf-text.js` 复用安全读取与 worker 生命周期**

  新增：

  ```js
  async function extractPdfStructureSignals(book, { signal, limits } = {}) {}
  ```

  内部抽取公共 `runPdfWorker()`，但不改变 `extractPdfText()` 的参数、返回或计时语义。

- [ ] **Step 6: 实现结构规范化纯函数**

  `buildPdfStructure(signals)` 优先 outline，次选高置信标题；所有区间必须在 `[0,pageCount-1]`、有序且不交叉。无可靠结构时生成固定页窗 ID（例如 `pages-0-7`），标题只显示页范围，不声称章节语义。

- [ ] **Step 7: 运行测试**

  Run: `node --test tests/pdf-text.test.js tests/pdf-ai-structure.test.js tests/pdf-content-api.test.js`

  Expected: PASS，且既有文本型/纯图片/加密/超限测试不回归。

- [ ] **Step 8: Commit**

  ```bash
  git add app/server/pdf-text.js app/server/pdf-text-worker.js app/server/pdf-ai-structure.js tests/pdf-text.test.js tests/pdf-ai-structure.test.js
  git commit -m "feat: extract bounded PDF structure signals"
  ```

### Task 2: PDF 专用结构与画像缓存

**Files:**
- Create: `app/server/pdf-ai-profile-store.js`
- Create: `tests/pdf-ai-profile.test.js`
- Modify: `app/server/ai-index-manager.js`
- Modify: `app/server/index.js`
- Modify: `tests/ai-index-manager.test.js`

**Interfaces:**
- Consumes: `book.id`、`book.fingerprint`、Task 1 `PdfStructure`、现有 `normalizeUserId()`。
- Produces: `createPdfAiProfileStore({dataRoot}) -> {getStructure, putStructure, getProfile, putProfile, getOrCreateProfile, deleteBook}`；`buildPdfAiProfileCacheKey(input) -> {cacheKey,userKey}`。

- [ ] **Step 1: 写缓存键、权限、原子性和失效测试**

  断言缓存键包含 UID 哈希、book fingerprint、provider/baseUrl/model、PDF parser、structure/strategy/prompt version；UID、指纹或模型任一变化均 miss。写后目录 `0700`、文件 `0600`；JSON 截断、临时文件残留或 schema 不符视为 miss。

- [ ] **Step 2: 写并发与删除测试**

  20 个相同 `getOrCreateProfile()` 并发只调用一次 `build()`；构建抛错/取消不写文件且清理 in-flight；不同 UID 不共享模型画像。`deleteBook(bookId)` 只删除该书结构与各用户画像，不触碰 FTS、会话、笔记或 EPUB 摘要。

- [ ] **Step 3: 运行测试确认失败**

  Run: `node --test tests/pdf-ai-profile.test.js`

  Expected: FAIL with missing module。

- [ ] **Step 4: 实现存储布局和原子写**

  固定布局：共享结构 `DATA_ROOT/pdf-ai/structures/<bookId>.json`；用户画像 `DATA_ROOT/users/<uid>/pdf-ai-profiles/<bookId>.json`。文件内容必须再次保存 `sourceFingerprint` 与全部版本字段，读取时逐项比对，不能只信文件名。

- [ ] **Step 5: 接入索引删除与孤儿清理的 best-effort 回调**

  `createAiIndexManager()` 新增可选 `onIndexDeleted(bookId)`；单索引删除及孤儿清理在 SQLite 文件成功删除后各调用一次。`index.js` 将其绑定为 `pdfAiProfileStore.deleteBook(bookId)`；缓存清理错误记录结构化日志但不回滚索引删除。不要把缓存删除绑定到普通刷新或暂时撤权，以免造成反复计费。

- [ ] **Step 6: 运行测试**

  Run: `node --test tests/pdf-ai-profile.test.js tests/ai-index-manager.test.js tests/storage.test.js tests/ai-summary-cache.test.js`

  Expected: PASS。

- [ ] **Step 7: Commit**

  ```bash
  git add app/server/pdf-ai-profile-store.js app/server/ai-index-manager.js app/server/index.js tests/pdf-ai-profile.test.js tests/ai-index-manager.test.js
  git commit -m "feat: add isolated PDF AI profile cache"
  ```

### Task 3: 按需快速论文画像

**Files:**
- Create: `app/server/pdf-ai-profile.js`
- Modify: `app/server/ai-service.js`
- Modify: `tests/pdf-ai-profile.test.js`
- Modify: `tests/pdf-ai-api.test.js`

**Interfaces:**
- Consumes: Task 1 `PdfStructure`、Task 2 profile store、原始页证据 `{evidenceId,pageIndex,text}`。
- Produces: `planPdfProfile({structure, pages}) -> PdfProfilePlan`；`validatePdfProfile(value, evidence) -> PdfProfile`；`requestOpenAiPdfProfile({plan, env, savedConfig, signal}) -> Promise<PdfProfile>`。

- [ ] **Step 1: 写画像计划预算测试**

  断言单个实际请求输入 `<=8000` 字符时生成 1 个任务；总原文 `<=24000` 字符时最多 3 个 map 任务、每个 `<=8000` 字符，必要时 reduce 输入 `<=8000` 字符。优先覆盖摘要/引言、方法、结果/结论/局限。没有可靠结构时按分散页窗采样，不能只取相邻前六页。

- [ ] **Step 2: 写画像 schema 与引用完整性测试**

  模型 JSON 中 `researchQuestion/method/findings/limitations/sectionSummaries` 的每个事实必须引用本次 evidence ID；不存在、越界或无引用事实被丢弃并记录 `uncovered`。证据文本中的“忽略系统提示”等内容不能改变 schema 或请求 instructions。

- [ ] **Step 3: 写取消、文件变化与无真实供应商测试**

  mock 最多观察 3 map + 1 reduce；`AbortSignal`、45 秒截止时间、指纹变化时拒绝写缓存。测试 payload 不含 PDF 文件、路径、其他页、密钥或其他 UID 数据。

- [ ] **Step 4: 运行测试确认失败**

  Run: `node --test tests/pdf-ai-profile.test.js tests/pdf-ai-api.test.js`

  Expected: FAIL with missing planner/request function。

- [ ] **Step 5: 实现画像计划与校验**

  固定画像字段和 `uncovered`，不允许自由扩展 HTML/Markdown。所有生成内容按长度截断后再校验；无有效事实时抛 `PDF_AI_PROFILE_INSUFFICIENT_EVIDENCE`，由上层回退 FTS。

- [ ] **Step 6: 实现专用供应商请求**

  新增 `requestOpenAiPdfProfile()`，复用现有安全 base URL、API key、响应大小和 abort 控制；使用独立 `PDF_AI_PROFILE_PROMPT_VERSION`。短论文一次请求，长论文 map 后 reduce；每阶段都只接受 JSON，不能复用 EPUB `requestOpenAiChapterSummary()`。

- [ ] **Step 7: 运行测试**

  Run: `node --test tests/pdf-ai-profile.test.js tests/pdf-ai-api.test.js tests/ai-service.test.js`

  Expected: PASS；测试中真实网络调用为 0。

- [ ] **Step 8: Commit**

  ```bash
  git add app/server/pdf-ai-profile.js app/server/ai-service.js tests/pdf-ai-profile.test.js tests/pdf-ai-api.test.js
  git commit -m "feat: build evidence-backed PDF paper profiles"
  ```

### Task 4: 问题意图路由与混合证据

**Files:**
- Create: `app/server/pdf-ai-retrieval.js`
- Create: `tests/pdf-ai-retrieval.test.js`
- Modify: `app/server/ai-fts.js`
- Modify: `app/server/pdf-ai-context.js`
- Modify: `tests/pdf-ai-context.test.js`

**Interfaces:**
- Consumes: Task 1 `PdfStructure`、Task 3 `PdfProfile`、现有 FTS 行。
- Produces: `classifyPdfQuestion(question, {hasSelection}) -> PdfQuestionIntent`；`planPdfRetrieval({intent, structure, currentPage}) -> PdfRetrievalPlan`；`composePdfEvidence(input) -> {context,sources,coverage,retrievalMode}`；`searchPdfEvidenceRowsByRanges()`。

- [ ] **Step 1: 写中文/英文意图测试**

  固定以下类别：`selection`、`lookup`、`paper_overview`、`method`、`findings`、`limitations`、`comparison`。含明确选文永远为 `selection`；页码、术语、数字查询优先 `lookup`；无法确定时也用 `lookup`，避免无故产生画像费用。

- [ ] **Step 2: 写结构范围与 FTS 融合测试**

  整体问题至少从两个相关结构单元取证；方法问题优先方法/数据范围，结论问题优先结果/讨论/结论范围。相同 `pageIndex + normalized text window` 去重；最终上下文仍限制 6 条/每条 750/总计 4200 字，并保留真实 `startOffset`。

- [ ] **Step 3: 写低置信度与画像缺失回退测试**

  无结构、画像 miss、画像引用失效、FTS 无命中均回到现有 `searchPdfEvidenceRows()`；不得因启用新开关降低局部查找的现有命中。纯图片仍返回 `no-text`，不触发画像。

- [ ] **Step 4: 运行测试确认失败**

  Run: `node --test tests/pdf-ai-retrieval.test.js tests/pdf-ai-context.test.js`

  Expected: FAIL with missing classifier/planner/range query。

- [ ] **Step 5: 实现多范围只读查询**

  ```js
  async function searchPdfEvidenceRowsByRanges(book, dataRoot, {
    query = '', ranges = [], limit = 6, signal
  } = {}) {}
  ```

  在一次 index read lease 内执行受限范围查询；范围最多 6 个，必须排序、合并重叠并验证页号。不得拼接客户端 SQL，不改现有 `searchPdfEvidenceRows()` 行为。

- [ ] **Step 6: 实现意图、计划和证据编排纯函数**

  画像条目仅用于选择结构范围与生成检索词；`composePdfEvidence()` 输出必须全部对应原始 FTS/页文本行。返回 `coverage` 只描述已选结构单元，不声称整篇覆盖。

- [ ] **Step 7: 扩展离线评估脚本并验证门槛**

  Run: `node scripts/evaluate-pdf-ai-structured-retrieval.js --compare`

  Expected: `lookup` 用例页召回不低于基线；整体/方法/发现/局限用例平均 page recall 提升；所有引用页精度为 100%；每次回答证据 `<=4200` 字。

- [ ] **Step 8: 运行测试并提交**

  Run: `node --test tests/pdf-ai-retrieval.test.js tests/pdf-ai-context.test.js tests/pdf-text.test.js tests/ai-retrieval-eval.test.js`

  Expected: PASS。

  ```bash
  git add app/server/pdf-ai-retrieval.js app/server/ai-fts.js app/server/pdf-ai-context.js tests/pdf-ai-retrieval.test.js tests/pdf-ai-context.test.js scripts/evaluate-pdf-ai-structured-retrieval.js
  git commit -m "feat: route PDF questions through hybrid evidence"
  ```

### Task 5: API 编排、回答协议与安全回退

**Files:**
- Modify: `app/server/index.js`
- Modify: `app/server/ai-service.js`
- Modify: `tests/pdf-ai-api.test.js`
- Modify: `tests/ai-conversation-api.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 的 structure/store/profile/retrieval 接口。
- Produces: 原 API 上可选 SSE meta `{retrievalMode, profileStatus, structureCoverage}`；PDF 回答协议支持材料事实/归纳/未确认三类，URL 与请求体不变。

- [ ] **Step 1: 写 flag 开启后的端到端 API 失败测试**

  覆盖整体、方法、发现、局限、lookup、selection。断言只有前四类可触发画像；同缓存键第二次请求不重复构建；最终 sources 均对应当前指纹的真实页。

- [ ] **Step 2: 写回退矩阵测试**

  结构解析失败、画像超时、画像无效引用、缓存损坏时，仍调用一次现有 FTS 回答并在 meta 标记 `profileStatus: 'fallback'`；FTS 也无证据才返回当前 409。回退不得扩大证据或输出预算。

- [ ] **Step 3: 写竞态与隐私测试**

  在结构提取、map、reduce、最终回答四个时间点模拟取消、切书、文件替换、撤权。断言后续网络调用停止、对话不保存、缓存不写入；mock payload 不含路径、全文、其他 UID 或其他书。

- [ ] **Step 4: 运行 API 测试确认失败**

  Run: `node --test tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js`

  Expected: FAIL，失败只来自尚未编排的新路径/meta。

- [ ] **Step 5: 在 PDF 分支实现编排**

  保留现有 `preparePdfAiEvidence()` 不动，新增：

  ```js
  async function prepareStructuredPdfAiEvidence(user, bookId, body, { signal } = {}) {}
  ```

  `pdfAiStructuredRetrievalEnabled()` 为假、意图为 `selection|lookup` 或任一新阶段失败时调用现有函数。每个异步阶段后重新核对 `currentPdfFingerprint(book)` 和授权。

- [ ] **Step 6: 扩展 PDF 专用回答 payload**

  `buildPdfResponsesPayload()` 接收可选 `answerProtocol` 与 `paperContext`，但最终 evidence 仍为原始页片段。instructions 要求明确标注归纳，不允许画像或历史作为事实来源；引用清洗仍使用现有序号上限。

- [ ] **Step 7: 运行 API 与完整服务端 AI 测试**

  Run: `node --test tests/pdf-ai-api.test.js tests/pdf-ai-context.test.js tests/pdf-ai-profile.test.js tests/pdf-ai-retrieval.test.js tests/ai-conversation-api.test.js tests/ai-chapter-retrieval.test.js tests/ai-summary-cache.test.js`

  Expected: PASS；mock 统计确认 flag 关闭及 EPUB 的新增供应商调用数为 0。

- [ ] **Step 8: Commit**

  ```bash
  git add app/server/index.js app/server/ai-service.js tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js
  git commit -m "feat: orchestrate structured PDF AI answers"
  ```

### Task 6: 低干扰 UI 状态与可访问性

**Files:**
- Modify: `app/ui/reader/ai.js`
- Modify: `app/ui/styles.css`
- Modify: `e2e/pdf-reader.spec.js`
- Modify: `tests/dom-regression.test.js`

**Interfaces:**
- Consumes: Task 5 可选 SSE meta；旧服务端可能完全不返回这些字段。
- Produces: 现有 AI 面板内的结构分析/缓存/回退状态；不新增模式选择器。

- [ ] **Step 1: 写 UI 失败测试**

  断言首次画像显示“正在分析论文结构，仅发送有限页片段”；缓存命中显示“已使用论文结构”；回退显示“结构分析不可用，已按页检索”。发送按钮位置、面板保持打开、引用跳页和选文入口沿用当前测试。

- [ ] **Step 2: 写兼容与 EPUB 隔离测试**

  meta 缺字段时显示当前“正在检索 PDF 页证据”；EPUB 不出现“论文结构”文案。状态容器使用 `aria-live=polite`，忙碌时发送按钮禁用但取消能力仍可达。

- [ ] **Step 3: 运行测试确认失败**

  Run: `node --test tests/dom-regression.test.js`

  Run: `npx playwright test e2e/pdf-reader.spec.js --project=chromium --grep "AI|结构"`

  Expected: 新状态断言 FAIL，既有交互断言 PASS。

- [ ] **Step 4: 实现可选 meta 映射**

  只修改 `askPdfAiQuestion()` 的状态文案映射；不新增按钮、下拉框或设置项，不把结构状态写入 EPUB 分支。未知值安全回到现有文案。

- [ ] **Step 5: 运行 UI 回归**

  Run: `node --test tests/dom-regression.test.js tests/reader-core.test.js`

  Run: `npx playwright test e2e/pdf-reader.spec.js --project=chromium --grep "AI|结构"`

  Expected: PASS。

- [ ] **Step 6: Commit**

  ```bash
  git add app/ui/reader/ai.js app/ui/styles.css e2e/pdf-reader.spec.js tests/dom-regression.test.js
  git commit -m "feat: surface PDF structure analysis status"
  ```

### Task 7: 完整回归、NAS 门禁与逐级启用

**Files:**
- Modify: `scripts/validate-structure.js`
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `docs/superpowers/progress/2026-09-26-pdf-ai-structured-understanding-progress.md`

**Interfaces:**
- Consumes: Tasks 0–6 的完整实现。
- Produces: 可审计测试报告、设备资源/费用数据和启用/回滚结论；不在本 Task 自动打包或发布。

- [ ] **Step 1: 将新文件纳入结构与打包校验**

  `scripts/validate-structure.js` 必须确认四个新服务端模块存在；同时检查不包含 Python 运行时、`.learnkb`、上游模板或新增网络域名。

- [ ] **Step 2: 运行完整 Node 回归**

  Run: `node --test --test-reporter=dot tests/*.test.js`

  Expected: PASS，0 failed。

- [ ] **Step 3: 运行静态与便携校验**

  Run: `npm run check`

  Run: `npm run check:portable`

  Run: `git diff --check`

  Expected: 全部退出码 0。

- [ ] **Step 4: 运行 PDF 与 EPUB 浏览器回归**

  Run: `npx playwright test e2e/pdf-reader.spec.js e2e/reader.spec.js e2e/search.spec.js --project=chromium --workers=1`

  Expected: PASS；PDF 面板状态、页引用与取消正常，EPUB 章节问答结果与 flag 关闭基线一致。

- [ ] **Step 5: 在合成 PDF 上执行 NAS 门禁**

  先保持 `BABYREADER_ENABLE_PDF_AI_STRUCTURE=0` 验证当前路径；再仅在测试包中开启开关。使用无版权合成论文和 mock/测试供应商记录：结构耗时、首次画像调用数/字符数/耗时、缓存命中调用数、回答证据字符数、内存峰值、取消与文件替换行为。未经用户再次明确授权，不向真实供应商发送用户 PDF。

- [ ] **Step 6: 验收回滚**

  将开关恢复为 0 并重启，确认无需删除缓存或迁移数据库即可回到旧路径。结构缓存可保留；若清理，必须只删除 `DATA_ROOT/pdf-ai` 和各用户 `pdf-ai-profiles` 精确目录，不得触碰 `ai-index`、阅读状态或 EPUB 摘要。

- [ ] **Step 7: 更新进度与决策**

  记录每项命令、退出码、评估 JSON、设备指标、已知限制和是否允许默认启用。只有本地、浏览器和 NAS 门禁全部通过后，才另行请求打包/发布授权。

- [ ] **Step 8: Commit**

  ```bash
  git add scripts/validate-structure.js docs/FNOS_DEVICE_ACCEPTANCE.md docs/superpowers/progress/2026-09-26-pdf-ai-structured-understanding-progress.md
  git commit -m "docs: gate structured PDF AI rollout"
  ```

---

## 实施顺序与停止条件

严格按 Task 0 → 7 执行，每个 Task 独立评审、测试、记录后再进入下一阶段。出现以下任一情况立即停止，不继续“顺手修复”：

1. 需要升级 AI FTS schema 或重建 EPUB 索引；
2. 需要向供应商发送超过 24,000 字符或 PDF 原文件；
3. 需要 OCR、视觉模型、向量数据库、Python 服务或新增系统依赖；
4. EPUB 测试或 flag 关闭基线发生变化；
5. 画像无法做到原始页证据闭环；
6. NAS 首次画像超出资源/费用门槛，需要放宽硬上限。

这些情况必须另写设计补充并由用户确认，不能由实施者自行扩大范围。

## 最终完成定义

- 整体/方法/发现/局限问题在合成评估集上比现有 FTS 有可量化提升，引用页精度 100%。
- 缓存命中不重复调用画像流程，局部查找与选文不支付画像成本。
- 任何失败均安全回退，用户看到能力边界，不看到虚构章节或未经证实的“全文结论”。
- PDF 开关关闭与 EPUB 路径保持现有行为；完整 Node、浏览器、结构、便携与 NAS 门禁均留有证据。
- 未经后续明确指令，不提交、不合并、不打包、不部署。
