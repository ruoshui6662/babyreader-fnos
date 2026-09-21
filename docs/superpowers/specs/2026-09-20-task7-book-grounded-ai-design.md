# Task7：基于书本内容的 AI 阅读助手设计

## 目标

把选中文本后的“问 AI”从占位入口升级为可用的书本问答功能。回答必须优先、明确地基于当前书本内容；当书中证据不足时，必须说明“不足以从书中确定”，不能把模型的常识当成书中结论。

## 范围

本阶段包含：

- 选中文本后从浮动菜单打开独立 AI 阅读助手弹窗。
- AI 弹窗采用问书类界面：标题区、回答卡片、来源区、推荐问题和底部提问框；不进入目录/标记/显示设置抽屉。
- AI 弹窗内提供独立配置视图，可填写服务 URL、模型名和 API Key。
- 首次提问时读取 EPUB 的章节纯文本，客户端建立临时的轻量检索索引。
- 通过本地关键词检索选择少量片段，只将问题、选中文本和命中的片段发送到服务端。
- 服务端使用 OpenAI Responses API（兼容 `OPENAI_BASE_URL`）生成回答。
- 展示回答和来源章节；没有配置 API Key 时给出稳定的未配置提示，不发起模型请求。
- 现有标记、想法、导出、章节导航和阅读进度功能保持不变。

本阶段不包含：

- 将整本 EPUB 上传到 OpenAI File Search 或第三方云端知识库。
- 在 fnOS FPK 中新增原生向量数据库依赖。
- 对话历史持久化、流式输出、多模态图片问答和自动修改书本内容。

## 架构与数据流

```text
选中文本
  -> selection session（文本、章节路径、DOM 定位）
  -> AI 侧栏
  -> EPUB 章节懒加载纯文本
  -> CJK/Latin 轻量分块 + 本地关键词召回
  -> question + selectedText + top excerpts
  -> POST /api/books/:bookId/ai/ask
  -> OpenAI-compatible POST /v1/responses
  -> answer + source chapter labels
```

服务端只持有环境变量或当前用户受保护配置文件中的 API Key，浏览器永远不能读取密钥。请求内容限定为检索片段，不传原始 EPUB 二进制，不传整本书。书内文本被当作数据，系统提示要求模型忽略书内可能出现的指令，避免提示注入。

## 检索方案与后续演进

### Task7 首选：本地关键词检索

- 章节按约 900 个中日韩字符或词元切块，保留约 120 字符重叠。
- 对中文使用相邻双字词，对英文/数字使用词元；标题、当前章节和选中文本命中给予加权。
- 返回最多 6 个片段，并限制总上下文大小。
- 索引只存在浏览器内存中，以 `bookId` 和 EPUB 归档生命周期为边界。

该方案没有新增依赖，适合当前 fnOS FPK；即使没有 AI 配置也不影响阅读。它不是最终的语义检索方案，但能以较低风险先验证 UI、权限、上下文边界和回答质量。

### 后续候选

- OpenAI File Search：官方托管语义 + 关键词检索，接入快，但需要上传和同步整本书，隐私、费用及离线可用性需要单独评估。
- `sqlite-vec`：SQLite 内本地向量检索，体积和部署方向较好，但目前仍处于 pre-v1，原生模块打包风险较高。
- LanceDB：本地 JS/TS SDK 和向量搜索较完整，但包含原生库，需验证 fnOS 架构和 FPK 安装体积。
- Qdrant/Chroma：能力成熟，但会引入独立服务或后端进程，不适合 Task7 的稳定性目标。

是否升级 embeddings，应在有真实书库的命中率、延迟和内存数据后决定，而不是在本阶段直接引入原生依赖。

## OpenAI 接入约定

- 使用 Responses API，而不是新建 Chat Completions 专用分支。
- `OPENAI_BASE_URL` 默认 `https://api.openai.com/v1`，允许后续接入 OpenAI-compatible 网关。
- `OPENAI_MODEL` 必须可配置，未配置时使用项目运行环境认可的默认模型。
- `OPENAI_API_KEY` 只在服务端读取；状态接口只返回是否已配置、模型名和检索模式。
- 关闭服务端持久化请求（若兼容端支持 `store: false`），不在本地保存问答正文。
- 失败时返回通用错误给浏览器，详细上游错误只写入现有错误日志。

## API 契约

### `GET /api/ai/status`

```json
{
  "configured": true,
  "provider": "openai-compatible",
  "model": "configured-model",
  "retrieval": "local-lexical-rag"
}
```

### `GET/PUT /api/ai/config`

配置使用当前认证用户的 `users/<uid>/ai-config.json`，服务端以 0600 权限原子写入。PUT 接受 `baseUrl`、`model`、`apiKey` 和 `clearApiKey`；响应不会包含 API Key。

### `POST /api/books/:bookId/ai/ask`

请求限制：问题最多 4000 字，选中文本最多 4000 字，片段最多 8 个且每个最多 3000 字；服务端再次校验，不信任客户端限制。

```json
{
  "question": "这段话的核心观点是什么？",
  "selectedText": "……",
  "chapter": { "index": 2, "href": "OPS/chapter-03.xhtml", "label": "第三章" },
  "context": [
    { "text": "……", "chapterIndex": 2, "chapterHref": "OPS/chapter-03.xhtml", "chapterLabel": "第三章" }
  ]
}
```

响应：

```json
{
  "answer": "……",
  "sources": [
    { "chapterIndex": 2, "chapterHref": "OPS/chapter-03.xhtml", "chapterLabel": "第三章" }
  ]
}
```

## UI 设计

- 顶部阅读工具栏的 AI 图标和选中文本菜单都打开独立弹窗，弹窗遮罩和关闭行为不影响阅读抽屉。
- AI 弹窗包括：状态提示、选中文本引用块、回答卡片、来源章节、推荐问题、问题输入框和发送按钮。
- 弹窗右上角“设置”切换到配置视图，支持 URL、模型名、API Key、保留已有 Key 和清除 Key。
- 未配置时显示“尚未配置 AI 服务”，输入和发送按钮保持禁用或明确提示。
- AI 输出使用 `textContent` 展示，不将模型返回内容直接当 HTML 插入。
- 不改变已有“标记与想法”侧栏、排序控件和导出布局。
- 移动端使用同一个独立弹窗，在窄屏下贴近底部并保留滚动区域。

## 验收标准

1. 未配置 API Key 时打开 AI 弹窗不会访问上游，也不影响 EPUB 阅读。
2. 选中文本点击“问 AI”能打开独立弹窗并保留选中文本。
3. 提问请求只包含有限的检索片段，服务端构造 Responses API 请求。
4. 返回回答和来源章节；模型输出中的 HTML 不会被执行。
5. API 错误、超时、空问题和超限请求都有稳定提示。
6. 现有 Node、DOM、Chromium、结构检查和 FPK 打包均通过。

## 参考资料

- [OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)
- [OpenAI File Search](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI text-embedding-3-large](https://developers.openai.com/api/docs/models/text-embedding-3-large)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [LanceDB JS SDK](https://lancedb.github.io/lancedb/js/)
- [Qdrant quick start](https://qdrant.tech/documentation/quick-start/)
- [Chroma clients](https://cookbook.chromadb.dev/core/clients/)
