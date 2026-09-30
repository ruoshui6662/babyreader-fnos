# AI 会话持久化与重新打开恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让同一 fnOS 用户重新打开同一本书后恢复 AI 会话，同时保持现有 AI、阅读器、书签、标注、搜索和 FTS 稳定。

**Architecture:** 使用 `users/<uid>/ai-conversations/<bookId>.json` 保存单本书的会话，不扩展 `reading-state.json`，不引入 SQLite 会话表。服务端负责归属校验、限制、原子写入和流式回答完成后的保存；前端负责恢复、切换、删除和清空展示状态。

**Tech Stack:** Node.js CommonJS、现有 `writeJsonAtomic`、fnOS gateway user、原生 DOM、Node 内置测试、Playwright、现有 FPK/fnOS 验收工具。

**Spec:** `docs/superpowers/specs/2026-09-21-ai-conversation-persistence-design.md`

## Global Constraints

- 不引入 SQLite 会话表和新的运行时依赖。
- 不改变现有 AI 检索数量、来源边界、Token 上限、流式事件基本结构和 AI 配置保存方式。
- 会话路径只能由服务端根据当前 uid 与严格 bookId 推导，客户端不得提交路径、uid 或数据目录。
- 会话目录权限为 `700`，会话文件权限为 `600`，所有写入采用现有 JSON 原子替换。
- 只有完整回答才保存 assistant 消息；停止、断开、错误和空回答不保存半截回答。
- 会话文件只保存问题、回答和脱敏来源元数据，不保存 API Key、书籍全文、检索片段、系统提示词或原始上游响应。
- 任何持久化异常不得阻塞阅读器或让已生成回答失败。
- 每个任务必须先写 RED 回归，再写最小实现，最后运行对应回归与 `git diff --check`。

## Review Focus

- 跨用户/跨书籍读取：测试同一 conversationId 在不同 uid 或 bookId 下不可读。
- 流式中断：测试 abort、错误和窗口关闭不会产生半截 assistant 消息。
- 并发写入：测试同一 uid/bookId 的两次保存不会互相覆盖。
- 恶意输入：测试路径、绝对 href、超长问题/回答、伪造来源和非法 ID 被拒绝。
- 存储故障：测试原子写入失败保留旧文件，且回答仍能展示。

---

### Task 1: 建立会话存储边界与数据校验 — complete

**Files:**

- Create: `app/server/ai-conversation-storage.js`
- Create: `tests/ai-conversation-storage.test.js`
- Modify: `app/server/storage.js` only if a shared atomic helper export needs a narrow compatibility-preserving change

**Interfaces:**

- Consumes: `dataRoot`, normalized fnOS `uid`, strict `bookId`.
- Produces: `createConversation`, `listConversations`, `getConversation`, `appendCompletedTurn`, `deleteConversation`, `clearConversation`.

- [x] **Step 1: Write failing storage tests**

覆盖以下行为：

```js
const storage = createAiConversationStorage({ dataRoot, now });
const conversation = await storage.createConversation(uid, bookId, { title: '测试问题' });
assert.match(conversation.id, /^[0-9a-f-]{36}$/i);
assert.equal((await storage.listConversations(uid, bookId)).length, 1);
```

同时测试：非法 uid/bookId、跨书籍读取、消息角色限制、来源数量限制、2 MiB 文件上限、目录/文件权限、损坏 JSON 不自动覆盖、并发 append 串行化。

- [x] **Step 2: Run RED tests**

Run: `node --test tests/ai-conversation-storage.test.js`

Expected: FAIL because the storage module and public methods do not exist.

- [x] **Step 3: Implement minimal storage module**

实现唯一文件推导：

```js
path.join(dataRoot, 'users', normalizeUserId(uid), 'ai-conversations', `${bookId}.json`)
```

复用 `readJson`、`writeJsonAtomic`、`normalizeUserId`；为 `uid + bookId` 建立串行 mutation queue；所有入站字段重新规范化；返回对象不得包含真实路径。

- [x] **Step 4: Run storage tests and core regressions**

Run: `node --test tests/ai-conversation-storage.test.js tests/reader-core.test.js`

Expected: all pass; existing reading-state, bookmark and highlight tests remain green.

- [x] **Step 5: Review the storage diff**

Run: `git diff --check; rg -n "apiKey|selectedText|context|absolute|path" app/server/ai-conversation-storage.js`

Expected: no API Key,完整检索 context 或绝对路径写入会话记录。

### Task 2: 增加会话 API 与权限边界 — complete

**Files:**

- Modify: `app/server/index.js`
- Modify: `app/ui/core/api.js`
- Create: `tests/ai-conversation-api.test.js`

**Interfaces:**

- Consumes: Task 1 storage methods and existing `gatewayUser`, `findBook`, `validateAiBookContext`.
- Produces: `getAiConversations`, `getAiConversation`, `createAiConversation`, `deleteAiConversation`, `clearAiConversation` API adapters.

- [x] **Step 1: Write failing API tests**

测试：未认证返回 401；跨用户返回 404/403；非法 bookId/conversationId 返回 400；列表不返回正文；创建、读取、删除、清空只影响当前 uid/bookId；响应不含路径、API Key、SQLite 错误和检索片段。

- [x] **Step 2: Run RED API tests**

Run: `node --test tests/ai-conversation-api.test.js`

Expected: FAIL because the routes and client methods do not exist.

- [x] **Step 3: Add server routes**

将会话路由放在现有 AI 书籍路由附近；每个路由先获取 gateway user，再调用 `findBook(bookId)` 和存储层归属校验；错误统一映射为脱敏 JSON，不把内部错误堆栈返回客户端。

- [x] **Step 4: Add browserHost API adapters**

客户端只传 `bookId`、`conversationId` 和规范化消息体，不暴露数据文件路径；沿用现有 `apiRequest` 认证和错误处理。

- [x] **Step 5: Run API and existing server tests**

Run: `node --test tests/ai-conversation-api.test.js tests/ai-index-api.test.js tests/search-api.test.js tests/security.test.js`

Expected: all pass;旧 AI、搜索和索引管理 API 行为不变。

### Task 3: 将完整流式回答安全写入会话 — complete

**Files:**

- Modify: `app/server/index.js`
- Modify: `app/server/ai-service.js` only if the existing normalized answer result needs a non-breaking helper
- Extend: `tests/ai-conversation-api.test.js`
- Extend: `tests/reader-core.test.js`

**Interfaces:**

- Consumes: `conversationId` in the stream body and Task 1 `appendCompletedTurn`.
- Produces: additive `done.persisted` boolean and optional sanitized `done.persistenceErrorCode`.

- [x] **Step 1: Write failing stream persistence tests**

覆盖：完整上游回答写入两条消息；无 conversationId 的旧请求仍按旧行为工作；abort、上游 error、空回答和停止不写 assistant；伪造来源被重新校验；写入失败时仍返回完整回答且 `persisted:false`。

- [x] **Step 2: Run RED stream tests**

Run: `node --test tests/ai-conversation-api.test.js tests/reader-core.test.js --test-name-pattern="conversation|stream|persist"`

Expected: new persistence assertions fail while old stream assertions remain green.

- [x] **Step 3: Integrate save before done event**

在上游完整结果得到后，先规范化当前问题、回答和来源，再调用 `appendCompletedTurn`，最后发送现有 `done` 事件。保存异常只转换为脱敏字段，不抛出覆盖回答结果的错误。

- [x] **Step 4: Run stream and full server regressions**

Run: `node --test tests/reader-core.test.js tests/ai-conversation-api.test.js tests/search-api.test.js`

Expected: all pass;现有 `done.answer`、`done.sources` 和 SSE 事件顺序不变。

### Task 4: 前端恢复、关闭和切书籍生命周期 — complete

**Files:**

- Modify: `app/ui/reader/ai.js`
- Modify: `app/ui/app.js` only for an explicit book-transition reset hook if needed
- Modify: `app/ui/library/view.js` only to preserve close-without-delete semantics
- Modify: `app/ui/core/api.js`
- Extend: `tests/dom-regression.test.js`
- Extend: `e2e/reader.spec.js`

**Interfaces:**

- Consumes: Task 2 API adapters and Task 3 `done.persisted`.
- Produces: in-memory `_aiConversationId`, `_aiConversationList`, restore state and user-visible persistence warning.

- [x] **Step 1: Write failing DOM tests**

测试关闭 AI 后 DOM 会话不被当作新会话删除；重新打开调用列表和详情接口；切换书籍清除旧内存会话；恢复失败显示重试且不禁用阅读；新对话不删除旧服务端会话。

- [x] **Step 2: Run RED DOM tests**

Run: `node --test tests/dom-regression.test.js --test-name-pattern="AI.*conversation|conversation.*restore|persist"`

Expected: FAIL because close/open still calls `resetAiConversation()` and no restore calls exist.

- [x] **Step 3: Implement lifecycle changes**

关闭 AI 仅隐藏 surface；打开时加载 active conversation；切换书籍时取消旧流并清空内存 ID；新对话创建新 ID；恢复消息只渲染已保存完整消息；历史发送仍限制为最近消息。

- [x] **Step 4: Add focused Playwright flows**

新增或扩展浏览器测试：关闭再打开、刷新、关闭书籍再开、切换书籍隔离、新建对话保留旧会话、流式停止不保存半截回答。

- [x] **Step 5: Run DOM and focused E2E tests**

Run: `node --test tests/dom-regression.test.js --test-name-pattern="AI|conversation|persist"` and `npx playwright test e2e/reader.spec.js --grep "AI|conversation|persist"`

Expected: existing AI settings、暗色模式、流式停止和来源显示测试全部通过。

### Task 5: 会话列表、删除和清空 UI — complete

**Files:**

- Modify: `app/ui/index.html`
- Modify: `app/ui/reader/ai.js`
- Modify: `app/ui/styles.css`
- Extend: `tests/dom-regression.test.js`
- Extend: `e2e/reader.spec.js`

**Interfaces:**

- Consumes: Task 2 conversation list/delete/clear APIs and Task 4 restore state.
- Produces: existing Apple-style AI surface with bounded conversation management.

- [x] **Step 1: Write failing UI tests**

测试会话列表只显示标题、时间和数量；切换会话恢复消息；删除和清空需要正确更新当前会话；加载/删除失败保留面板并提供重试；移动端不突破安全区和现有面板高度。

- [x] **Step 2: Run RED UI tests**

Run: `node --test tests/dom-regression.test.js --test-name-pattern="conversation list|delete conversation|clear conversation"`

Expected: FAIL because the current AI surface has only a transient “新对话”按钮。

- [x] **Step 3: Implement minimal UI**

复用现有 AI secondary sheet、主题变量、焦点恢复和按钮样式；不复制 Drawer 生命周期；列表不加载完整正文，切换时才加载详情。

- [x] **Step 4: Run browser UI tests**

Run: `npx playwright test e2e/reader.spec.js --grep "AI|conversation"`

Expected: conversation management passes without changing existing AI layout contracts.

### Task 6: 全量回归、文档、FPK 与 fnOS 真机验收 — local release gate complete; fnOS pending

**Files:**

- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `docs/superpowers/progress/2026-09-21-ai-conversation-persistence-progress.md`
- Modify: `CHANGELOG_WORK.md`
- Build: `dist/babyreader-fnos.fpk`

- [x] **Step 1: Run full local verification**

Run: `npm test`, `npm run check`, `npm run test:e2e`, `git diff --check`.

Expected: zero failures; only已有平台条件 skip allowed.

- [x] **Step 2: Verify package content**

运行现有 `npm run build:fpk`；用现有构建溯源脚本确认 manifest、server、UI、测试和验收文档进入 FPK，确认无 API Key 和开发临时文件。

- [ ] **Step 3: Run fnOS acceptance**

安装升级包后执行：

```sh
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check \\
  | tee /tmp/acceptance-ai-conversations.txt
```

人工验收关闭/重开书籍、刷新、切书籍、多用户隔离、服务重启、流式中断和会话文件权限；保存输出并回填进度文档。

- [ ] **Step 4: Stop gate**

若会话越权、旧功能回归、写入失败破坏阅读或流式半截消息被保存，停止发布，不通过修改客户端隐藏问题，先修复对应边界并重新跑全量测试。
