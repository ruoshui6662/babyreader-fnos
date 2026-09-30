# AI 会话持久化与重新打开恢复规格

## 1. 目标

在不改变现有 AI 检索、流式输出、来源显示、阅读器、书签、标注、全文搜索和 AI 配置行为的前提下，让同一 fnOS 用户重新打开同一本书时可以恢复之前的 AI 对话。

第一版复用现有 JSON 原子写入和 fnOS 用户隔离机制，不引入 SQLite 会话表，不保存书籍全文、检索片段或 API Key。

## 2. 当前问题与兼容要求

当前 `_aiConversation` 只存在浏览器内存中。回答完成后仅追加到内存，关闭 AI 弹窗和重新打开 AI 弹窗都会调用 `resetAiConversation()`；服务端没有会话读写 API。因此关闭书籍、刷新浏览器或重新打开同一本书后，对话自然丢失。

本规格必须保持以下兼容行为：

- 现有 `POST /api/books/:bookId/ai/ask` 保持不变；
- 现有 `POST /api/books/:bookId/ai/ask/stream` 的 `meta`、`delta`、`done`、`error` 事件保持兼容，只允许在 `done` 中增加可选持久化状态字段；
- 现有检索数量、来源章节边界、低置信度提示和 Token 上限不扩大；
- 关闭 AI 不再清空已保存会话，但“新对话”仍清空当前界面并创建新会话；
- 切换书籍时停止旧请求并清理内存状态，禁止跨书籍恢复对话；
- 持久化失败只能提示当前会话未保存，不得让已生成的回答失败或阻塞阅读。

## 3. 存储布局

每个 fnOS 用户、每本书使用独立文件：

```text
<DATA_ROOT>/users/<uid>/ai-conversations/<bookId>.json
```

选择独立文件而不是扩展 `reading-state.json` 的原因：AI 对话正文可能明显大于阅读进度、书签和标注，分离后可避免对现有状态文件造成体积、并发和迁移风险。

目录权限为 `700`，会话文件权限为 `600`。文件通过现有 `writeJsonAtomic()` 写入，临时文件位于同一目录，失败时清理临时文件并保留旧文件。

文件结构：

```json
{
  "version": 1,
  "bookId": "<64 位小写十六进制 bookId>",
  "activeConversationId": "<uuid>",
  "conversations": [
    {
      "id": "<uuid>",
      "title": "本章主要讲了什么？",
      "createdAt": "2026-09-21T00:00:00.000Z",
      "updatedAt": "2026-09-21T00:00:02.000Z",
      "messages": [
        {
          "id": "<uuid>",
          "role": "user",
          "content": "本章主要讲了什么？",
          "createdAt": "2026-09-21T00:00:00.000Z"
        },
        {
          "id": "<uuid>",
          "role": "assistant",
          "content": "回答正文……",
          "sources": [
            {
              "citationIndex": 1,
              "chapterIndex": 7,
              "chapterHref": "chapter-08.xhtml",
              "chapterLabel": "早餐的质量影响你的一天"
            }
          ],
          "createdAt": "2026-09-21T00:00:02.000Z"
        }
      ]
    }
  ]
}
```

运行时的流式状态不写入文件。未完成的回答、AbortController、原始 SSE、检索文本和模型响应 ID均不持久化。

## 4. 数据边界与限制

第一版采用保守上限，防止本地 JSON 无限增长：

- 每本书最多 20 个会话；
- 每个会话最多 100 条已完成消息；
- 单个用户问题最多 4000 字符；
- 单个已完成回答最多 32000 字符；
- 单条消息最多 12 个来源；
- 单个书籍会话文件超过 2 MiB 时拒绝新增消息并返回可识别错误；
- 展示列表只返回会话 ID、标题、时间和消息数量，不返回完整正文；
- 来源只保留章节索引、规范化 href、章节标题和引用序号；
- 服务端重新校验来源属于当前书籍，不信任客户端传入的绝对路径或任意章节文本。

如果达到限制，保留已有数据，回答仍可在当前界面显示；前端提示“本轮未保存”，不影响阅读和新建会话。

## 5. 服务端 API

接口均位于当前用户和书籍上下文下：

```text
GET    /api/books/:bookId/ai/conversations
GET    /api/books/:bookId/ai/conversations/:conversationId
POST   /api/books/:bookId/ai/conversations
POST   /api/books/:bookId/ai/conversations/:conversationId/messages
DELETE /api/books/:bookId/ai/conversations/:conversationId
DELETE /api/books/:bookId/ai/conversations/:conversationId/messages
```

服务端必须：

- 通过现有 gateway user 获取 `uid`，禁止客户端提交 uid；
- 严格验证 `bookId` 为 64 位小写十六进制字符串；
- 通过现有 `findBook()` 校验书籍存在；
- 验证 conversationId 为 UUID 格式，并且属于当前 `uid + bookId`；
- 不接受路径、文件名、数据目录或任意存储键；
- 对未认证、非法请求、跨用户/跨书籍访问返回明确的 401、400 或 404/403；
- 响应不得泄露真实路径、API Key、检索片段、书籍正文、SQLite 错误或上游堆栈。

`POST .../messages` 只接受已经完成的问答；首版推荐由流式问答服务端在上游回答完整后直接写入，前端不承担“回答完成后再保存”的可靠性责任。

## 6. 流式保存策略

现有流式流程保持：检索 → 上游请求 → 发送增量 → 完整回答。

当上游完整回答已得到后：

1. 服务端先执行消息规范化和当前用户/书籍/会话校验；
2. 通过用户级和书籍级写入队列原子保存 user/assistant 两条完整消息；
3. 保存成功后发送现有 `done` 事件，可附加 `persisted: true`；
4. 保存失败时仍发送回答，附加 `persisted: false` 和脱敏错误码；
5. 客户端断开、停止生成、上游失败或回答为空时不写入 assistant 消息。

现有请求中的 `history` 仍只取最近有限消息。恢复历史不会扩大检索结果数量、上下文字符预算或模型请求上限。

## 7. 前端生命周期

`ai.js` 增加：

```js
let _aiConversationId = null;
let _aiConversationList = [];
let _aiConversationRestoring = false;
```

生命周期约定：

1. 打开书籍后不加载完整会话正文，只保留书籍上下文；
2. 打开 AI 面板时加载会话列表并恢复 active conversation；
3. 关闭 AI 面板只隐藏窗口，不调用删除、不清空已保存会话；
4. 点击“新对话”创建新会话并清空当前视图，旧会话保留；
5. 切换书籍时取消旧请求、清空内存状态，再加载新书会话；
6. 刷新浏览器后按当前 bookId 恢复 active conversation；
7. 恢复失败时保留空白界面并显示重试，不阻塞阅读；
8. 新建、删除、清空和恢复操作期间禁用冲突按钮，避免重复请求。

## 8. UI 范围

首版不重做 AI 主窗口。沿用现有 Apple 风格 AI surface，只增加：

- 当前会话恢复状态；
- 会话加载失败和重试提示；
- 会话切换入口；
- 新对话确认/创建反馈；
- 删除会话和清空当前会话能力；
- 本轮未保存的非阻塞提示。

会话列表不显示正文预览，避免打开面板时一次性传输大量内容。现有来源显示、流式状态、停止按钮、暗色模式和发送按钮保持不变。

## 9. 安全与稳定性硬边界

- 不引入 SQLite 会话表和新的运行时依赖；
- 不修改 FTS 索引、书签、标注、阅读进度和 AI 配置文件；
- 不在客户端拼接存储路径；
- 不信任客户端的用户、书籍、来源和会话归属字段；
- 所有文件写入通过原子替换和同一用户/书籍队列；
- 会话文件损坏时只报告恢复失败，不删除、不覆盖原文件；
- 持久化异常不影响已完成回答的显示和阅读器使用；
- 不自动清理旧会话、不自动 LRU、不自动压缩、不上传云端；
- 不把 API Key、完整正文、检索片段或原始上游请求写入会话文件和日志。

## 10. 验收标准

- 关闭 AI 再打开：当前会话恢复；
- 关闭书籍再打开同一本：会话恢复；
- 浏览器刷新：会话恢复；
- 切换到另一本书：看不到上一本文书的会话；
- 新对话：旧会话保留，新会话为空；
- 流式回答中停止或关闭：不保存半截 assistant 消息；
- 回答完成后重启服务：完整问答和来源元数据仍存在；
- 删除会话、清空消息后刷新：状态正确；
- 普通用户不能读取其他用户的会话；
- 文件权限为目录 `700`、文件 `600`；
- 达到大小限制时不破坏旧数据和阅读功能；
- `npm test`、`npm run check`、Chromium E2E 和 fnOS 真机验收全部通过。

## 11. 参考方案

- Open WebUI 将 chat 与 chat_message 分离，并记录 user_id、done、sources、error 等生命周期字段：<https://github.com/open-webui/docs/blob/main/docs/reference/database-schema.md>
- Open WebUI 消息模型使用 chat_id、user_id 和完成状态约束消息归属：<https://github.com/open-webui/open-webui/blob/main/backend/open_webui/models/chat_messages.py>
- AnythingLLM 使用 workspace_id、user_id、thread_id 分隔聊天作用域：<https://github.com/Mintplex-Labs/anything-llm/blob/master/server/prisma/schema.prisma>
- LibreChat 将数据模型、校验和实体方法分层：<https://github.com/danny-avila/LibreChat/blob/main/packages/data-schemas/README.md>
