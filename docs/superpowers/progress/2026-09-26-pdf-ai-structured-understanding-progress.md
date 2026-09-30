# PDF AI 结构化理解优化进度

计划：`docs/superpowers/plans/2026-09-26-pdf-ai-structured-understanding.md`
设计：`docs/superpowers/specs/2026-09-26-pdf-ai-structured-understanding-design.md`

## Task 0：冻结基线、feature flag 与离线评估门槛

状态：Task 0 实现与验收完成；commit 留待工作区边界明确后处理

- [x] 补充结构检索硬预算：节点 256、outline 深度 8、标题 160 字、画像来源 24,000 字、单 map 8,000 字、最多 3 个 map、reduce 输入 8,000 字、输出 1,600 token、总时限 45 秒。
- [x] 添加默认关闭的纯函数开关 `pdfAiStructuredRetrievalEnabled(env)`，识别 `1|true|yes|on`。
- [x] 添加不含真实材料的合成论文、五类问题和无 outline/多栏/纯图片变体。
- [x] 添加只调用本地 PDF FTS 的基线评估脚本；脚本明确报告供应商调用数为 0。
- [x] 增加 PDF 默认路径与 EPUB 流式问答 payload 的隔离断言。
- [x] 执行基线评估并保存实测输出。
- [x] 运行 Task 0 全部指定测试并通过。
- [x] Task 0 完成后停止；本次只授权 Task 0。

### 基线评估

命令：`node scripts/evaluate-pdf-ai-structured-retrieval.js --baseline`

结果：退出码 0；7 个合成用例，`providerCalls=0`。整篇概览目标页召回 `5/7 = 0.7143`，FTS 命中页为 `[6,0,2,8,7,1]`，遗漏方法页 3 与结果页 5；方法、发现、局限、术语查找和多栏样本各自的标注页召回为 1.0；纯图片 PDF 状态为 `no-text`，无证据被发送。评估只表示这套合成夹具上的页命中情况，不代表语义回答准确率。

### 验收

- `node --test tests/pdf-ai-context.test.js tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js`：28/28 通过。
- `node --test --test-reporter=dot tests/*.test.js`：退出码 0，全套 Node 测试通过。
- 新增 PDF 和 EPUB provider payload 基线测试通过；结构 flag 未设置时为关闭，当前 PDF 请求没有画像/结构字段，EPUB 流式 payload 没有 PDF 结构字段。
- TDD 红灯记录见上文；红灯 3 项分别因预算、开关及夹具缺失，之后均转绿。
- 未连接真实供应商，未使用用户 PDF，未更改 NAS、FTS schema 或打包内容。

### Commit 状态

Task 0 的接口文件及 API 测试在本任务开始前已经是未跟踪文件。直接执行计划中的 `git add` 会把既有 PDF AI/会话功能整文件一并提交，无法只提交本 Task 0 的增量；因此保留所有工作区变更、不提交。后续若用户要求提交，先对这些文件做明确的逐文件/逐块暂存审查。

## Task 1–7 执行记录（2026-09-26）

用户随后明确授权从 Task 1 继续并自动进入后续阶段；以下记录覆盖 Task 1 至 Task 7。Task 0 的“本次只授权 Task 0”是当时的阶段性记录，已被后续明确授权更新。

### Task 1：本地 PDF 结构信号

- 新增受资源上限约束的 outline/标题结构抽取；原 `extractPdfText()` 返回契约保持不变，结构模式不返回整页正文。
- `node --test tests/pdf-text.test.js tests/pdf-ai-structure.test.js`：12/12 通过。
- 结构信息只表达 PDF 可确认的标题、目录和页范围；低置信度退化为页窗口，不伪造章节。

### Task 2：结构与用户画像缓存

- 新增按文件指纹、用户哈希、供应商/模型和版本隔离的本地画像缓存；支持并发合并、原子写入、取消及索引删除后的 best-effort 清理。
- `node --test tests/pdf-ai-profile.test.js tests/ai-index-manager.test.js tests/storage.test.js tests/ai-summary-cache.test.js`：通过；Unix 权限位测试在 Windows 跳过。
- 删除画像缓存失败不会回滚现有索引删除；普通刷新或撤权不清缓存。

### Task 3：有界论文画像

- 增加固定 schema、证据 ID 校验、按结构分散采样和 mock 供应商请求。每次输入上限 8,000 字符，总原文 24,000 字符，最多 3 个 map + 1 个 reduce；全部模型 I/O 只在 opt-in API 触发。
- 修订计划中不一致的 12,000/8,000 单次阈值，统一为单次请求实际输入不超过 8,000 字符。
- 执行顺序有一处偏差：先落纯规划器，再补测试；但计划、schema、取消和 mock 请求均已通过定向测试验证。

### Task 4：意图路由与混合检索

- lookup/selection 保持原 FTS；整体/方法/发现/局限/比较问题按结构页范围召回原始 FTS 证据。图片型 PDF 明确无文本。
- 合成夹具离线对比：整体概览页召回从 5/7（0.7143）提高到 6/7（0.8571）；方法、发现、局限、多栏和术语查找维持基线 1.0；供应商调用 0。此为页召回指标，不代表语义回答准确率。
- 新增 findings 优先规则，避免“主要研究发现和数据结果”误分类为 method。

### Task 5：API 接入与安全回退

- 新路径仅接受默认关闭的 PDF 结构 feature flag，且只覆盖 searchable-book 范围中的整体/方法/发现/局限/比较意图；其余范围保持旧路径。
- 每次异步阶段核验书籍身份、文件指纹与取消状态；画像不足、失败或无可信结构回退现有 FTS。最终可点击来源仍完全来自原始 PDF 页证据；画像不作为来源。
- API/mock 供应商与 EPUB payload 隔离测试通过；没有真实供应商调用。

### Task 6：状态反馈与无障碍

- PDF AI 状态提示采用可选 SSE meta；旧服务端/未知字段保留旧状态文案；提示由既有 `role=status`/`aria-live` 播报，不向 EPUB 注入 PDF 专属信息。
- PDF AI API、画像、检索、会话、摘要缓存、DOM 和 reader-core 集成回归：245 pass、1 skip。

### Task 7：代码门禁及验收状态

- 项目结构校验纳入结构抽取、画像、画像缓存、检索与文本资源限制模块；设备验收手册增加 Debian/x86 与 ARM 权限、默认关闭及合成材料门禁。
- 全量 Node：`npm test`，482 项，474 pass、8 skip、0 fail。
- `npm run check`、`npm run check:portable`、`git diff --check`：通过。
- Chromium 浏览器回归（PDF reader、reader、search）：106 项，104 通过、2 失败。失败项为 PDF 书签用例等待进度 PUT 超时，以及 AI composer 发送按钮垂直居中偏差（实测偏差 8.8px，断言上限 1px）；均在本次 PDF 结构化检索新增路径之外，未扩大范围修复。结构化 PDF AI 专项浏览器用例通过。
- NAS/Linux/FNOS 真机验收尚未执行；因此 Task 7 代码和本地门禁已完成，但设备验收门槛仍待后续。feature flag 默认关闭，不启用、不打包、不部署。

### 整体安全边界与交付状态

- 未改变 EPUB AI 路径、FTS schema、索引格式、用户数据格式或现有对外问答 payload（关闭开关时）。
- 未连接真实供应商、未读取或上传用户论文、未操作 NAS、未构建 FPK、未提交代码。
- 工作区原有大量未提交/未跟踪文件保留原样；按文件级审查边界执行的增量未单独暂存。
- 结构化 PDF AI 仅在将来经过 NAS 资源、权限、供应商成本、索引/缓存失效和回滚验收后才可考虑启用。

## 2026-09-27 后续执行：合成材料门禁复核

- 用户确认当前设备上 PDF 扫描、打开、翻页、搜索定位、书签与进度恢复、标注和笔记导出正常；长文档、多栏/旋转/图像型资源压力与 Task 10 无障碍适配暂缓。结构化 AI 首轮只允许无版权合成 PDF 和模拟服务，不调用真实供应商处理用户书籍。
- 当前代码的 Task 0–7 已实现，结构化路径仍由 `BABYREADER_ENABLE_PDF_AI_STRUCTURE` 显式控制并默认关闭。启动脚本未清空继承的环境；只有测试实例的服务环境显式设置该变量时才能进入新路径。未改生产默认值或普通用户设置。
- 专项 Node：`node --test tests/pdf-ai-context.test.js tests/pdf-ai-profile.test.js tests/pdf-ai-retrieval.test.js tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js`，42 项、41 通过、1 项 Windows 权限测试跳过、0 失败。覆盖关闭基线、开启后首次画像与缓存、来源页和用户隔离、取消及无文本回退；上游请求在测试中由 mock 拦截。
- 离线评估：`node scripts/evaluate-pdf-ai-structured-retrieval.js --compare` 退出码 0、`providerCalls=0`。合成概览问题的页召回从 5/7 提高到 6/7，方法、发现、局限、术语查找和多栏用例维持基线；这是合成页召回，不代表真实论文回答准确率。
- 全量 Node：`npm test`，496 项、488 通过、8 项环境跳过、0 失败。`npm run check:portable` 通过（61 必需文件、9 生命周期脚本）。PDF 浏览器相关 `npx playwright test e2e/pdf-reader.spec.js --project=chromium --grep "AI|结构"`，13/13 通过。
- 已有 `dist-fpk-pdf-epub-parity-20260927/babyreader-fnos.fpk` 的包内核对确认包含结构、画像、缓存、检索与 PDF AI 上下文模块；本次未重新打包或安装。包内存在模块并不等于服务已开启该路径。
- 为用户在 NAS 终端执行的隔离门禁补充 `docs/FNOS_DEVICE_ACCEPTANCE.md` 第 3.2 节命令：从已安装包复制四个 PDF AI 测试与两个合成夹具到 `/tmp`，通过临时符号链接只读加载包内服务模块；测试自身使用独立临时数据与 mock 供应商。已用上一版 FPK 的 Windows 暂存布局验证相同的测试文件装配，31 项中 30 通过、1 项 Unix 权限测试按预期跳过、0 失败；NAS 上仍需运行以关闭权限门禁。
- NAS 实机门禁尚未完成：尝试以 `ruoshui@192.168.68.112` 非交互 SSH 访问，返回 `Permission denied (publickey,password)`。因此未读取设备私有资料、未设置或重启服务，也没有取得 Debian/x86_64 或 ARM64 的 `0700/0600` 权限、首次画像调用/字符/延迟、峰值 RSS、缓存命中、取消与文件替换、关闭回滚数据。设备验收结论仍为“待验”，默认启用结论仍为“不允许”。

### RED 记录

命令：`node --test tests/pdf-ai-context.test.js tests/pdf-ai-api.test.js tests/ai-conversation-api.test.js`

结果：25 通过、3 失败；三项失败均为预期缺失：预算常量、flag 函数、合成夹具模块。PDF 与 EPUB API 基线 payload 测试通过。

### 裁定

- `tests/ai-chapter-retrieval.test.js` 只覆盖纯 EPUB 检索逻辑，不能证明 API 上游请求未进入 PDF 新模块；隔离断言改放 `tests/ai-conversation-api.test.js`。
- 本地没有 Bash，无法运行技能包装脚本；工作区/任务记录通过 PowerShell 与补丁方式维护，测试和计划仍按同一 Task 0 步骤执行。
