# AI 多轮对话与流式输出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有书本检索和 AI 配置的前提下，增加临时多轮会话、SSE 增量回答、停止生成和多消息 UI。

**Architecture:** 服务端保留原 JSON `/ai/ask`，新增 `/ai/ask/stream`，把 OpenAI-compatible Responses 流转换为稳定的应用 SSE 事件。前端由单回答状态升级为临时消息数组，每轮重新检索书本并把最近历史作为上下文，增量内容节流后安全渲染 Markdown。

**Tech Stack:** Node.js 原生 `http`、原生 `fetch`、SSE、Vanilla JavaScript、DOM、Node `node:test`、Happy DOM、Playwright Chromium。

**Spec:** `docs/superpowers/specs/2026-09-20-ai-multi-turn-streaming-design.md`

## Global Constraints

- 不改变既有 JSON 问答接口和 AI 配置接口。
- 不保存 API Key 到浏览器或用户阅读状态。
- 不把临时对话写入 localStorage 或服务端持久化。
- 不修改标记、想法、目录、阅读进度和导出数据结构。
- 每轮请求必须重新带上书本约束指令。
- 书本片段继续作为不可信数据处理。
- 旧版不支持 SSE 的兼容服务必须有 JSON 回退。

## Review Focus

- SSE 分包可能把 JSON 或 UTF-8 字符拆开，解析器必须按行缓存，不能按单次网络 chunk 解析。
- 上游可能返回 `response.output_text.delta`、`response.completed`、`[DONE]` 或普通 JSON，不能只实现单一事件格式。
- 流式请求失败或中止时，已输出文本必须保留，且后续问题不能携带未完成的 assistant 消息。
- 多轮历史必须限制长度，并且每轮仍然带当前书本检索片段。
- 打开新书、关闭浮窗和开始新对话必须取消旧请求，避免旧 delta 写入新会话。

---

### Task 1: 服务端多轮 payload 与流式解析

**Files:**
- Modify: `app/server/ai-service.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- `validateAiRequest(body) -> { question, selectedText, chapter, context, history }`
- `buildResponsesPayload({ model, question, selectedText, chapter, context, history }) -> object`
- `parseResponsesSseChunk(buffer, events) -> { buffer, events }`
- `extractStreamDelta(event) -> string`

- [x] **Step 1: Add failing tests for bounded history and repeated instructions.**
- [x] **Step 2: Add failing tests for split SSE lines, delta extraction, completion and `[DONE]`.**
- [x] **Step 3: Implement history validation and payload construction.**
- [x] **Step 4: Implement line-buffered SSE parsing and JSON fallback extraction.**
- [x] **Step 5: Run focused tests.**

Run: `node --test tests/reader-core.test.js --test-name-pattern="AI|SSE|history|Responses"`

Expected: all new service tests pass and existing AI service tests remain green.

### Task 2: 新增服务端 SSE 问答接口

**Files:**
- Modify: `app/server/index.js`
- Modify: `app/server/ai-service.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- `POST /api/books/:bookId/ai/ask/stream`
- Events: `meta`, `delta`, `done`, `error`

- [x] **Step 1: Add route contract assertions for configured, unconfigured and invalid request paths.**
- [x] **Step 2: Add route contract assertions for SSE headers and event order.**
- [x] **Step 3: Implement upstream stream request with timeout and abort propagation.**
- [x] **Step 4: Implement meta/delta/done/error response events.**
- [x] **Step 5: Implement JSON upstream fallback as one delta plus done.**
- [x] **Step 6: Run focused server/service tests.**

Run: `node --test tests/reader-core.test.js --test-name-pattern="AI|stream"`

Expected: route status, headers, event order, error masking and fallback behavior pass.

### Task 3: 前端 API 流式读取器

**Files:**
- Modify: `app/ui/core/api.js`
- Test: `tests/dom-regression.test.js`

**Interfaces:**
- `browserHost.askAiStream(bookId, payload, handlers, signal) -> Promise<{ responseId, sources }>`
- `handlers = { onMeta, onDelta, onDone, onError }`

- [x] **Step 1: Add failing DOM/API tests with a mocked ReadableStream.**
- [x] **Step 2: Implement SSE line buffering across arbitrary network chunks.**
- [x] **Step 3: Dispatch meta/delta/done/error callbacks.**
- [x] **Step 4: Propagate `AbortSignal` and normalize JSON fallback.**
- [x] **Step 5: Run focused DOM tests.**

Run: `node --test tests/dom-regression.test.js --test-name-pattern="AI|stream"`

Expected: split events, Unicode content, abort and fallback cases pass.

### Task 4: AI 临时会话和多消息渲染

**Files:**
- Modify: `app/ui/reader/ai.js`
- Modify: `app/ui/index.html`
- Modify: `app/ui/styles.css`
- Test: `tests/dom-regression.test.js`

**Interfaces:**
- `resetAiConversation(reason) -> void`
- `appendAiUserMessage(text) -> message`
- `appendAiAssistantMessage() -> message`
- `renderAiConversation() -> void`
- `askAiQuestion() -> Promise<boolean>`

- [x] **Step 1: Add tests for two-turn history and new conversation reset.**
- [x] **Step 2: Replace single answer state with user/assistant message elements while retaining existing selectors as compatibility hooks.**
- [x] **Step 3: Add bounded conversation history and include it in each request.**
- [x] **Step 4: Add new-conversation control and clear behavior.**
- [x] **Step 5: Add assistant placeholder and source list per turn.**
- [x] **Step 6: Run focused DOM/browser tests.**

Run: `node --test tests/dom-regression.test.js --test-name-pattern="AI|conversation|message"`

Expected: old single-answer assertions remain compatible and new multi-turn assertions pass.

### Task 5: 流式增量渲染、停止和生命周期清理

**Files:**
- Modify: `app/ui/reader/ai.js`
- Modify: `app/ui/index.html`
- Modify: `app/ui/styles.css`
- Test: `e2e/reader.spec.js`

**Interfaces:**
- `streamController: AbortController | null`
- `flushStreamingAnswer(messageId) -> void`
- `stopAiGeneration() -> void`

- [x] **Step 1: Add Chromium tests for multi-turn streaming UI and visible generation state.**
- [x] **Step 2: Add tests for stop generation and request cancellation.**
- [x] **Step 3: Implement animation-frame Markdown rendering for the active assistant message.**
- [x] **Step 4: Toggle send/stop button state and wire AbortController.**
- [x] **Step 5: Cancel on close, new conversation and superseded request.**
- [x] **Step 6: Run AI-focused E2E tests.**

Run: `npx playwright test e2e/reader.spec.js --project=chromium --workers=1 --grep "AI|ai|stream"`

Expected: multi-turn, progressive output, stop, error, close and source rendering pass.

### Task 6: 全量回归、文档和打包

**Files:**
- Modify: `docs/superpowers/progress/2026-09-20-reader-annotations-progress.md`
- Modify: `docs/superpowers/plans/2026-09-20-task7-book-grounded-ai.md`
- Test: `tests/reader-core.test.js`
- Test: `tests/dom-regression.test.js`
- Test: `e2e/reader.spec.js`

- [x] **Step 1: Run `npm run test:core`.**
- [x] **Step 2: Run `npm run test:e2e`.**
- [x] **Step 3: Run `npm run check:portable` and `git diff --check`.**
- [x] **Step 4: Build `dist/babyreader-fnos.fpk` and inspect package contents.**
- [x] **Step 5: Record test counts, FPK path and SHA-256 in the progress ledger.**

Expected: no new failures; existing optional/platform skips remain explicitly classified.

## 后续 AI 增强计划（本轮不执行）

- AI 配置测试连接和模型能力探测；
- 自定义 URL 的 HTTPS、内网地址和 SSRF 防护；
- 服务端重新读取书本并校验上下文来源；
- Embeddings、向量索引和混合检索；
- 会话持久化、对话导出和跨设备恢复；
- 重新生成、失败重试和用量统计；
- 完整 ARIA、焦点陷阱、屏幕阅读器和 reduced-motion 验收；
- fnOS x86/ARM 真机网络、输入法、WebView 和剪贴板验收；
- 移动端触摸长按选区菜单及“选中文本问 AI”联动。
