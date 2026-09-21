# AI 索引管理器开发进度

状态：Task 1～Task 5 已完成，Task 6 FPK 已生成，fnOS 真机验收待执行。

更新时间：2026-09-21

## 当前阶段

- 方案：已完成调研并获得用户确认。
- 规格：已写入 docs/superpowers/specs/2026-09-21-ai-index-manager-design.md。
- 实现计划：已写入 docs/superpowers/plans/2026-09-21-ai-index-manager.md。
- 运行代码：Task 1 已新增管理器基础；Task 2 已接入 FTS 生命周期和安全发布；Task 3 已接入管理员 API；Task 4 已接入独立 UI；Task 5 已完成恢复与清理边界测试。
- FPK：已重新打包，当前产物为 `dist/babyreader-fnos.fpk`，溯源文件记录了 clean source commit 与 SHA-256。
- fnOS 真机验收：未开始。

## 任务状态

| 任务 | 内容 | 状态 |
| --- | --- | --- |
| Task 1 | 注册表、manifest、只读检查基础 | 已完成 |
| Task 2 | FTS 生命周期、共享租约、安全发布 | 已完成 |
| Task 3 | 管理员索引管理 API | 已完成 |
| Task 4 | 独立索引管理 surface | 已完成 |
| Task 5 | 恢复、诊断和异常边界加固 | 已完成 |
| Task 6 | 文档、FPK 和 fnOS 真机验收 | FPK 已生成，真机待验 |

## 当前安全边界

- 只管理 TRIM_PKGVAR/ai-index 下的服务生成索引。
- 不触碰用户原始书籍、阅读进度、书签、标注、笔记和 API Key。
- 管理 API 只允许管理员。
- 书库扫描不健康时不清理孤儿文件。
- 当前实现阶段不引入 WAL、VACUUM、自动 LRU、自动配额和全量删除。

## 下一步

执行 Task 6 的最后一步是 FPK 构建和 fnOS 真机验收；真机结果需要用户设备日志回填。

## Task 1 证据

- 提交：3bac3b4，以及符号链接安全边界补强提交。
- 定向测试：ai-index-manager.test.js，7 通过、1 跳过、0 失败；跳过项是 Windows 无法稳定创建符号链接。
- 全量测试：158 通过、4 跳过、0 失败。
- 结构校验：npm run check 通过。
- 未修改 API、UI、FTS 查询协议和 FPK。

## Task 2 证据

- 定向测试：ai-index-manager、reader-core、book-search，51 通过、1 跳过、0 失败。
- 全量测试：160 通过、4 跳过、0 失败。
- 结构校验：npm run check 通过。
- FTS 构建改为共享 build lease，读取改为 read lease。
- 发布流程不再先删除旧索引；manifest 登记失败不会删除新索引。

## Task 3 证据

- API 测试：ai-index-api.test.js，4 通过、0 失败。
- 覆盖管理员列表、401/403、响应脱敏、单索引幂等删除、cleanup 确认和不健康书库 fail closed。
- 管理 API 不接收路径、不返回路径、正文、查询词和 API Key。

## 执行 ruling

- Ruling: 将 app/ui/shell/drawer.js 纳入 Task 4 文件边界，因为独立索引 surface 必须注册到既有 readerSurfaceController 才能复用关闭、焦点、遮罩和无障碍行为；如果不纳入，将形成第二套 surface 生命周期控制，增加 UI 状态串扰风险。

## Task 4/5 证据

- DOM/API 定向测试全部通过，包含独立 surface、管理员入口、失败状态、确认清理和服务端 API 适配。
- Task 5 覆盖过期临时文件、活跃构建跳过、损坏 SQLite 保留和不做破坏性修复。
- 当前已完成提交：4c14e29、b3bdeea、2203f8b。

## Task 6 当前证据

- 全量测试：168 通过、4 跳过、0 失败。
- 结构校验：npm run check 通过。
- FPK：dist/babyreader-fnos.fpk 已生成，manifest 版本 1.1.1。
- FPK 内已核验包含 server/ai-index-manager.js、ui/reader/ai-index-manager.js、两组索引管理测试和 fnOS 验收文档。
- FPK SHA-256 与构建溯源以 dist/build-provenance.json 为准；最后一次构建为 clean source commit。
- 尚未在真实 fnOS x86_64/ARM64 设备安装、重启和执行验收脚本。
