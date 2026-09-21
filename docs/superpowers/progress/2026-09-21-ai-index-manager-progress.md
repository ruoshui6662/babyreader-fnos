# AI 索引管理器开发进度

状态：Task 1～Task 2 已完成，Task 3～Task 6 待执行。

更新时间：2026-09-21

## 当前阶段

- 方案：已完成调研并获得用户确认。
- 规格：已写入 docs/superpowers/specs/2026-09-21-ai-index-manager-design.md。
- 实现计划：已写入 docs/superpowers/plans/2026-09-21-ai-index-manager.md。
- 运行代码：Task 1 已新增管理器基础；Task 2 已接入 FTS 生命周期和安全发布；API/UI 尚未接入。
- FPK：未重新打包。
- fnOS 真机验收：未开始。

## 任务状态

| 任务 | 内容 | 状态 |
| --- | --- | --- |
| Task 1 | 注册表、manifest、只读检查基础 | 已完成 |
| Task 2 | FTS 生命周期、共享租约、安全发布 | 已完成 |
| Task 3 | 管理员索引管理 API | 待执行 |
| Task 4 | 独立索引管理 surface | 待执行 |
| Task 5 | 恢复、诊断和异常边界加固 | 待执行 |
| Task 6 | 文档、FPK 和 fnOS 真机验收 | 待执行 |

## 当前安全边界

- 只管理 TRIM_PKGVAR/ai-index 下的服务生成索引。
- 不触碰用户原始书籍、阅读进度、书签、标注、笔记和 API Key。
- 管理 API 只允许管理员。
- 书库扫描不健康时不清理孤儿文件。
- 当前实现阶段不引入 WAL、VACUUM、自动 LRU、自动配额和全量删除。

## 下一步

执行 Task 3 前，增加管理员 API，并验证 401/403、响应脱敏和删除/清理确认边界。

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
