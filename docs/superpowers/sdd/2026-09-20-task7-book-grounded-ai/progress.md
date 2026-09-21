# Task7 进度台账

## 2026-09-20

- [x] 完成现有代码审查：选中文本菜单、阅读抽屉、EPUB 懒加载、API 层、测试和 FPK 构建链路。
- [x] 完成联网调研：Responses API、File Search、embeddings、sqlite-vec、LanceDB、Qdrant、Chroma。
- [x] 确定首版方案：本地关键词 RAG + 服务端 OpenAI Responses API。
- [x] 写入设计文档和实施计划。
- [x] 阶段 A：服务端协议与安全边界；Node 内置 fetch、Responses payload、密钥隔离、输入上限和错误脱敏已完成。
- [x] 阶段 B：书本纯文本读取与本地检索；EPUB 章节不内联资源，中文双字词/英文词元召回已完成。
- [x] 阶段 C：AI 侧栏与选中文本入口；桌面工具栏、抽屉 AI 标签、选中文本菜单和来源章节已完成。
- [x] 阶段 D：回归、打包与进度；Node/DOM/Chromium/结构检查和 FPK 包内文件检查已完成。

### 验证记录

- `npm test`：81 通过，3 跳过，0 失败。
- 定向 Chromium AI/工具栏用例：3 通过。
- 完整 Chromium：51 通过，2 跳过，0 失败。
- `npm run check`：通过。
- `npm run build:fpk`：通过（Windows 使用本机 Git Bash 执行脚本）。
- FPK：`dist/babyreader-fnos.fpk`，SHA-256 `48DD08396891E8EC766BC644F8C82F9ADD68C9C04445004AF8528DED2EDFAFCE`。
- 包内确认：`server/ai-service.js`、`ui/reader/ai.js`、AI 设计文档均已进入 `app.tgz`。

## 2026-09-20（独立弹窗与配置增量）

- [x] AI 从阅读 Drawer 拆为独立模态弹窗，支持遮罩、关闭按钮和 Escape。
- [x] 按参考图增加回答卡片、来源章节、推荐问题和底部输入框。
- [x] 增加 URL、模型名、API Key 配置视图，支持保留和清除 Key。
- [x] 配置按用户隔离写入服务端 `ai-config.json`，响应不包含 Key。
- [x] Node：82 通过，3 跳过；Chromium：52 通过，2 跳过。
- [x] 结构检查和 FPK 打包通过；新版 FPK SHA-256：`CB443FF410486F18ABF750AF92FAD61D63B87ADAFE1E20699E203C792464632F`。
- [x] 包内确认：AI Drawer 面板已移除，`aiModal`、`ai-config.js` 和配置计划文档已进入 `app.tgz`。
