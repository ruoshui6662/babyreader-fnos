# PDF NAS 验收开关设计

**状态：** 用户已确认；本地实现及验收 FPK 已完成，NAS 安装与实机验收仍待用户操作。

**日期：** 2026-09-24

## 1. 目标与边界

为当前默认关闭的 PDF 阅读与全文搜索增加一个 fnOS 应用设置入口，使管理员能在现有授权书库内短时启用 PDF，以验收扫描、阅读与本地 FTS。验收包仍默认关闭；此改动不等于批准正式发布启用 PDF。

范围仅限 PDF 功能开关的管理和验收包构建，不改 PDF.js、PDF 解析/搜索限额、书库扫描授权模型、用户书籍或索引数据。

## 2. 用户与运行行为

- fnOS `wizard/config` 提供一个布尔开关，文案明确为“PDF 阅读与全文搜索（验收用）”，默认值为关闭，并提示仅在管理员控制的验收窗口启用。
- 配置提交只更新 BabyReader 私有配置，不调用 `cmd/main restart`、不停止/启动进程、不删除或触碰 socket/PID。浏览器刷新后读取新状态；服务进程不需要重启。
- 关闭开关会立即影响之后的书库与 PDF 内容/搜索请求；已有页面在下次 API 请求时受服务端重新校验，用户刷新后回到不显示 PDF 的状态。
- 开关关闭只隐藏/拒绝 PDF 功能，不删除 PDF 文件、FTS 行、阅读进度或任何其他数据。

## 3. 配置存储与决策规则

- 使用独立文件 `$TRIM_PKGETC/pdf-feature.json`，不改写包含 `libraryRoots` 的 `settings.json`。
- 文件 schema 固定为 `{"version":1,"enabled":false}`；目录保持应用配置目录的 `0700`，文件权限 `0600`。
- 缺文件时默认关闭。只接受 JSON 对象、精确 schema 版本和布尔 `enabled`；损坏、权限错误或未知 schema 均 fail closed（关闭），不得回退到开启状态。
- 更新使用同目录临时文件、排他创建、写入/同步、原子 rename；临时文件在失败时清理。不得记录配置内容或 NAS 路径。
- 为保留现有开发/E2E 测试兼容性，`BABYREADER_PDF_ENABLED` 仅在持久配置文件尚不存在时作为运行时回退；有效持久配置始终优先。生产包无该文件和环境变量时仍默认关闭。
- 只有 fnOS 管理员通过应用设置页提交配置能改变持久状态；不新增公开 HTTP 写入接口、不允许普通用户或书籍内容改变此设置。

## 4. 生命周期与动态生效

- `cmd/config_callback` 只校验并保存向导字段；不得调用现有的 `cmd/main restart`。当前目标 NAS 曾出现 `cmd/main status=3` 但服务 socket 正常的情况，现有脚本的 PID 判断不足以证明它可安全管理监管进程。
- 服务端在需要暴露 PDF 功能的请求边界读取这份很小的原子配置（或使用等价的、明确处理失效和原子替换的短周期缓存），不读取 shell 启动环境来决定已配置设备上的状态。
- `/api/library`、组织书籍快照、PDF 搜索、PDF 内容/Range API 使用同一配置解析器，避免 UI 显示状态与服务端授权决策分叉。
- PDF API 每次请求仍先执行现有用户身份、bookId、授权路径和文件验证；启用开关不能放宽这些验证。
- 配置更新后无需重启服务；UI 需刷新/重新打开书库才能更新展示。关闭后，既有客户端即便未刷新也不能继续读取新的 PDF 内容块。

## 5. FPK 与 NAS 验收流程

1. 单测覆盖缺配置默认关闭、持久开关优先、合法开/关值、损坏配置 fail-closed、写入原子性/文件权限、同时配置旧环境变量时的优先级。
2. API 测试覆盖书库目录隐藏/显示、PDF 搜索与内容路由动态开关、切换期间不影响 EPUB/TXT/MD、未授权身份与越权 bookId 始终拒绝。
3. fnOS 生命周期测试确保配置回调不调用 `cmd/main` 或删除 socket/PID，并通过隔离临时目录验证写入行为。
4. `npm test`、`npm run check`、POSIX shell 语法、`git diff --check` 全部通过后，构建到新且不存在的 `dist-fpk-*` 目录。不得覆盖现有候选 FPK；manifest 产品版本保持不变，除非 fnOS 明确拒绝同版本手动验收安装，届时先停下征求版本策略。
5. 交付 FPK 和 SHA-256；不由本地构建流程远程安装或重启 NAS。用户在应用中心手动安装/升级后，从应用设置中显式打开验收开关，刷新书架并重新扫描。
6. 使用已放入设备上授权书库目录的 `BabyReader PDF Acceptance Fixture.pdf` 合成文件进行书架显示、阅读、页码恢复和唯一 token 的本地 FTS 搜索；运行 `fnos-device-acceptance.sh check`，所有适用 PDF 项必须为 `PASS`，`SKIP` 不视为验收通过。
7. 验收后从应用设置关闭开关、刷新确认 PDF 隐藏；确认 EPUB/TXT/Markdown 正常，合成文件保留或由用户单独删除。任何步骤不得删除真实书籍、索引、进度或其他数据。

## 6. 不做事项与安全边界

- 不在当前代码或本地构建中启用 PDF 默认值；不把验收开关改成正式发行开关。
- 不使用 `export BABYREADER_PDF_ENABLED=1` 作为 NAS 服务配置方法，不编辑 fnOS 监管进程，不手工杀 PID，不运行不确定的 restart/stop 脚本。
- 不写入或复制用户的真实 PDF；只使用已确认的合成测试文件和唯一文件名。
- 不更改授权根、绕过 realpath/UID/Gateway 检查、不开放新 API、不产生网络/AI 请求。
- 不更新 manifest 产品版本、依赖版本、数据库 schema 或既有用户数据。

## 7. 回归与回滚

- 回滚只需在 fnOS 应用设置关闭开关；缺文件和损坏文件都必须回到 fail-closed 状态。服务无需重启。
- 若设置更新失败，保留原配置（原子 rename 前不截断现有文件），配置回调非零退出并报告不含敏感值的错误。
- 关闭功能不重写、不删除任何 PDF 索引行或阅读状态；EPUB/Markdown/TXT 路径保持原契约。
- 设备验收未通过时，关闭开关即可回到默认行为；不要通过清空索引或重装应用来“修复”。

## 8. fnOS 依据

- fnOS 官方文档说明 `wizard/config` 用于安装后应用设置，表单字段会传给生命周期脚本；配置变更可由 `cmd/config_init` / `cmd/config_callback` 处理：[fnnas-docs](https://github.com/ckcoding/fnnas-docs/blob/main/ALL_DOCS.md)。
- 本设计刻意不复用当前 `cmd/config_callback` 的 restart 行为，原因是本项目 NAS 验收已观察到生命周期 status 与健康 socket 不一致；必须保持服务进程和 socket 不受配置更改影响。
