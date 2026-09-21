# Task7：书本内容驱动的 AI 阅读助手实施计划

> 目标：把“问 AI”接入 OpenAI-compatible Responses API，并通过本地检索保证上下文来自当前书本；保持现有阅读、标记、想法和侧栏稳定。

## 阶段 A：服务端协议与安全边界

- [ ] 新增纯函数 AI 服务模块：配置解析、请求校验、Responses payload 构造、响应文本提取。
- [ ] 新增 `GET /api/ai/status`。
- [ ] 新增 `POST /api/books/:bookId/ai/ask`，复用现有 `findBook` 权限检查。
- [ ] 使用 Node 内置 `fetch`，不引入 SDK 或原生依赖；配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。
- [ ] 设置请求超时、上下文长度上限、错误脱敏和现有 `recordError` 记录。
- [ ] 先补服务端单测，覆盖未配置、非法 payload、上游成功和上游失败。

## 阶段 B：书本纯文本读取与本地检索

- [ ] 在 EPUB 模块增加不内联资源的 `loadEpubChapterText`。
- [ ] 新增 AI 纯函数：规范化文本、章节切块、CJK/Latin 关键词抽取、检索排序、上下文预算。
- [ ] AI 首次提问时按章节懒加载并缓存索引，显示读取进度；不影响首屏章节渲染。
- [ ] 先写分块和召回单测，再接入 UI。

## 阶段 C：AI 侧栏与选中文本入口

- [ ] 替换现有 AI 占位面板，增加状态、选中文本、输入、回答和来源区域。
- [ ] 启用桌面 AI 工具栏按钮和抽屉 AI 标签；非 EPUB 仍不可用。
- [ ] `openAiForSelection(session)` 复用选中文本 session，不重复读取 DOM。
- [ ] 提问期间禁用按钮，使用安全文本渲染，保持 ARIA live/focus 行为。
- [ ] 用现有 token 和面板控件样式，不新增独立视觉体系。

## 阶段 D：回归、打包与进度

- [ ] 增加 DOM 和 Chromium 测试：未配置路径、选中文本路径、成功回答、来源展示、HTML 防注入。
- [ ] 跑 `npm test`、`npm run check`、`npm run test:e2e`。
- [ ] 构建 `dist/babyreader-fnos.fpk` 并做结构校验。
- [ ] 更新 Task7 进度台账，记录测试结果、包路径和后续 embeddings 评估项。

## 回滚策略

- AI 路由和 UI 模块是增量文件；发生问题时可禁用 `OPENAI_API_KEY`，应用自动退化为未配置提示。
- 不改动高亮存储格式、EPUB 渲染资源流程和现有笔记导出逻辑。
- 不引入数据库迁移，不改变已有 API 响应结构。
