# AI 会话持久化与重新打开恢复计划

## 状态

规划完成，暂不执行。当前仍保持“当前打开书籍、当前 AI 会话内临时保留”的行为。

## 目标

让用户关闭书籍、重新打开同一本书或刷新页面后，可以恢复该书的 AI 对话，同时保证不同书籍之间完全隔离，不把上一本文书的上下文带入下一本书。

## 产品规则

- 会话按 `userId + bookId` 隔离；
- 同一本书可以有多个会话；
- “新对话”只创建新会话，不默认删除旧会话；
- 关闭 AI 窗口不删除会话；
- 切换书籍时停止当前流式请求，再切换到目标书籍的会话列表；
- 未完成的流式回答不作为完整 assistant 消息保存；
- 只有回答完成后，才将本轮问答写入持久化存储；
- API Key、完整书本内容、检索索引不进入会话记录；
- 会话恢复只恢复问题、回答、来源章节和时间等展示数据；
- 保留“清空当前会话”和“删除单个会话”能力。

## 建议数据结构

```json
{
  "version": 1,
  "bookId": "<book-id>",
  "conversations": [
    {
      "id": "<conversation-id>",
      "title": "本章主要讲了什么？",
      "createdAt": "2026-09-20T00:00:00.000Z",
      "updatedAt": "2026-09-20T00:00:00.000Z",
      "messages": [
        {
          "id": "<message-id>",
          "role": "user",
          "content": "本章主要讲了什么？",
          "createdAt": "2026-09-20T00:00:00.000Z"
        },
        {
          "id": "<message-id>",
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
          "createdAt": "2026-09-20T00:00:02.000Z"
        }
      ]
    }
  ],
  "activeConversationId": "<conversation-id>"
}
```

回答中的来源只保存展示所需的章节元数据，不保存完整检索片段。下一次提问时，检索仍然从当前书本重新生成，避免旧片段失效或越权。

## 服务端接口设计

接口前缀：`/app/babyreader-fnos/api/books/:bookId/ai`

### 获取会话列表

```http
GET /api/books/:bookId/ai/conversations
```

返回：

```json
{
  "bookId": "<book-id>",
  "activeConversationId": "<conversation-id>",
  "conversations": [
    {
      "id": "<conversation-id>",
      "title": "本章主要讲了什么？",
      "messageCount": 4,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

列表接口不返回完整消息正文，避免打开 AI 面板时传输过多内容。

### 获取单个会话

```http
GET /api/books/:bookId/ai/conversations/:conversationId
```

服务端必须校验 `conversationId` 属于当前 `userId + bookId`，不允许通过修改 URL 读取其他用户或其他书籍的会话。

### 创建会话

```http
POST /api/books/:bookId/ai/conversations
Content-Type: application/json

{
  "title": "可选，默认使用首个问题"
}
```

返回新会话 ID。也可以采用首次提问自动创建的懒创建方式，但前端必须能明确区分“新会话”和“恢复旧会话”。

### 保存完成消息

```http
POST /api/books/:bookId/ai/conversations/:conversationId/messages
Content-Type: application/json

{
  "question": "用户问题",
  "answer": "完整回答",
  "sources": [
    {
      "citationIndex": 1,
      "chapterIndex": 7,
      "chapterHref": "chapter-08.xhtml",
      "chapterLabel": "早餐的质量影响你的一天"
    }
  ]
}
```

该接口只接受已经完成的回答。服务端需要限制问题、回答、来源数量和单会话总大小，并重新校验 `bookId` 与来源章节关系。

流式接口仍保持现有：

```http
POST /api/books/:bookId/ai/ask/stream
```

流式回答完成后由服务端或前端调用“保存完成消息”接口。推荐由服务端在本轮上游响应完整结束后保存，避免浏览器异常关闭导致半截回答被当成完整历史。

### 删除会话

```http
DELETE /api/books/:bookId/ai/conversations/:conversationId
```

删除前校验用户、书籍和会话三者关系。删除当前会话后，前端自动创建或切换到空白会话。

### 清空会话消息

```http
DELETE /api/books/:bookId/ai/conversations/:conversationId/messages
```

保留会话壳和标题，只清空消息，适合“清空当前对话”操作。

## 前端接口设计

建议在 `browserHost` 增加：

```js
getAiConversations(bookId)
getAiConversation(bookId, conversationId)
createAiConversation(bookId, payload = {})
saveAiConversationMessage(bookId, conversationId, payload)
deleteAiConversation(bookId, conversationId)
clearAiConversation(bookId, conversationId)
```

`ai.js` 增加会话状态：

```js
let _aiConversationId = null;
let _aiConversationList = [];
let _aiConversationRestoring = false;
```

生命周期约定：

1. 打开书籍后，只加载会话列表，不立即加载完整正文；
2. 打开 AI 面板时恢复当前会话；
3. 关闭 AI 面板不调用删除接口；
4. 点击“新对话”切换到新会话；
5. 每轮流式回答完成后保存完整消息；
6. 切换书籍时取消旧请求并清空内存状态，再加载新书会话；
7. 恢复失败时保留空白问答界面，并允许用户重试，不阻塞阅读。

## 存储方案建议

第一版建议复用现有服务端用户数据存储，不立即引入独立数据库：

- 优点：改动小、与用户隔离逻辑一致、易于备份和回滚；
- 会话规模较大时，再迁移到 SQLite 独立表；
- 单用户、单书、单会话设置硬上限；
- 写入采用原子替换，避免应用中断损坏历史；
- 迁移失败时不影响阅读、书签、标记与 AI 当前临时会话。

## Token 与上下文策略

- 展示历史和发送给模型的历史分离；
- 恢复的历史只作为最近若干轮消息，不把全部历史无限发送给模型；
- 继续使用现有历史条数、单条长度和总长度限制；
- 每轮仍必须重新检索当前书本片段；
- 不因为保存会话而增加检索片段数量；
- 后续可增加“仅展示历史 / 作为上下文历史”的策略开关，但不作为第一版必需项。

## 测试计划

- 关闭 AI 再打开：消息仍在；
- 关闭书籍再打开同一本：恢复正确会话；
- 切换到另一本书：不能看到上一本书的会话；
- 刷新页面：会话列表和当前会话恢复；
- 新对话：旧会话保留，新会话为空；
- 流式回答中关闭窗口：半截回答不保存为完整消息；
- 流式回答完成后刷新：完整回答和来源保留；
- 删除会话、清空消息后刷新：状态正确；
- 非法 `bookId`、`conversationId` 和跨用户访问返回 404/403；
- 会话达到大小上限时给出提示，不影响阅读和新建会话；
- API Key、书本全文和检索片段不出现在会话接口返回中。

## 暂不执行范围

- 不修改当前临时会话行为；
- 不新增运行时代码和 API 路由；
- 不引入 SQLite 会话表；
- 不改变当前流式输出、引用来源和 AI 配置逻辑。
