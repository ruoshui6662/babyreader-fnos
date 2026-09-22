# BabyReader fnOS 真机验收矩阵

本文把“真机可用”拆成可重复采证的契约。任何正式版本进入 `main` 前，至少在一台 x86_64 和一台 ARM64 fnOS 设备上分别完成一次。

## 1. 验收原则

- 架构差异只允许来自宿主和 Node 运行时，不允许应用 JavaScript 代码出现架构分叉。
- 先验证进程/Socket，再验证 Gateway，再验证 ACL 和多用户，最后验证升级持久化。
- 每次验收记录：Git commit、版本 tag、FPK SHA-256、设备架构、fnOS 版本、Node 版本、结果与日志。
- Windows/Linux 单元测试通过不能替代真机 Gateway、ACL、应用中心升级流程。

## 2. 自动采集

验收脚本作为临时设备验收工具随当前候选 FPK 提供，安装后位于 `target/docs/fnos-device-acceptance.sh`。直接在设备上执行：

```sh
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check | tee /tmp/acceptance-x86.txt
```

ARM 设备同样执行并保存为 `/tmp/acceptance-arm64.txt`。脚本自动检查 CPU 架构、Node.js 22、生命周期状态、`app.sock`、Unix Socket health、无 Gateway 身份时的 401、运行目录与授权书库 ACL。也可以从已写入 `PATH` 的源码 checkout 运行，但正式验收优先使用 FPK 内的副本。

该脚本仅用于本轮 FPK 的真机验收，不属于长期运行功能。完成 x86_64/ARM64、Gateway、ACL、升级和 SQLite FTS 验收后，应从构建脚本和 FPK 中移除，并保留源码仓库版本用于后续候选包验收。

## 3. Gateway 验收

Gateway 是宿主契约，必须从真实 fnOS 桌面入口进入，不能只用 Unix Socket 模拟。

1. 从 fnOS 桌面打开 BabyReader。
2. 浏览器 Network 中确认请求路径为 `/app/babyreader-fnos/api/session`。
3. 返回必须为 200，并包含当前登录用户对应的 `uid`、`username`、`isAdmin`。
4. 普通用户与管理员分别验证一次。
5. 切换两个 fnOS 用户，确认返回 UID 不同，并且阅读进度/划线互不可见。
6. 直接访问 Unix Socket、不给 `X-Trim-Userid` 时必须为 401；这项由自动脚本覆盖。

若要命令行采证，可在本机临时导出当前登录 Cookie 后运行：

```sh
BABYREADER_GATEWAY_URL="https://你的-fnOS-地址" \
BABYREADER_GATEWAY_COOKIE="实际登录 Cookie" \
sh scripts/fnos-device-acceptance.sh check
```

Cookie 不得提交到 Git、报告、日志或 CI。

## 3.1 AI 真实供应商连接验收

AI 设置和问答的固定夹具测试不会访问真实供应商。配置真实 AI 服务后，从 fnOS Gateway 会话执行独立连接测试；该命令使用服务端已经保存的配置和 API Key，不在命令行、脚本参数或日志中接收/打印 API Key，也不携带书籍内容、选中文本或对话历史：

```sh
BABYREADER_GATEWAY_URL="https://你的-fnOS-地址" \
BABYREADER_GATEWAY_COOKIE="实际登录 Cookie" \
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh ai-test
```

通过标准：

- 返回 `PASS | authenticated fnOS AI provider connection test returned 200`；
- 服务端已保存的 URL、模型和 API Key 能完成最小 Responses API 测试；
- 测试请求不包含书籍内容、选中文本和历史对话；
- Cookie 和 API Key 不出现在终端输出、验收文件、Git 或应用日志中。

失败时先在 AI 设置中使用“测试连接”确认 URL、模型和 Key，再检查 DNS、出口网络、供应商配额和模型权限。不要把 API Key 作为脚本参数传入；完成验收后立即清除当前终端变量和临时 Cookie。

## 4. ACL 验收

至少准备两个目录：A 为已授权书库，B 为未授权目录。A 中 EPUB/TXT/Markdown 必须能扫描和打开；B 不得出现在索引中；A 内符号链接指向 B 时不得越权读取；撤销 A 的授权后重新扫描必须报告不可用根目录。

## 4.1 fnOS 自定义授权书库目录

自定义书库目录必须通过 fnOS 应用权限授权，不要直接把未授权路径写入应用配置：

1. 在 fnOS 应用中心打开 BabyReader 的“应用限制 → 访问权限”。
2. 添加测试目录 A，并在目录中准备至少一个 EPUB、一个 TXT 和一个 Markdown 文件。
3. 保存权限后重启 BabyReader 应用，使新的 `TRIM_DATA_ACCESSIBLE_PATHS` 进入服务进程环境。
4. 从管理员诊断确认 `accessible` 和 `authorized` 根目录数量增加，且没有对应的 `rejected` 项。
5. 回到书库点击“重新扫描”，确认 A 中的书籍出现并可以打开。
6. 在同一册书上验证全文搜索、AI 问书、书签、标注和阅读进度仍可用。
7. 撤销 A 的 fnOS 权限并重启应用，再次扫描；A 中书籍不得继续被读取，诊断应报告授权根不可用或数量减少。

如果 fnOS 权限页面保存后没有自动重启服务，必须手动重启应用再扫描；“重新扫描”只会重新读取当前服务进程已经获得的授权环境，不会绕过 fnOS 权限。

启动脚本会把 fnOS 注入的 TRIM_DATA_ACCESSIBLE_PATHS 和 TRIM_DATA_SHARE_PATHS 原样传给 Node 服务，不会清空、扩权或替换这些值。验收脚本在提供管理员 Gateway 会话时，会额外读取 /api/diagnostics 的 rootCounts，只输出数量和状态，不输出根目录列表。

验收记录只保存根目录数量、状态和错误类型，不把 API Key、Cookie、书籍正文或不必要的用户路径写入报告。

## 5. SQLite FTS 验收

`check` 命令现在会自动验证 Node 22 的 `node:sqlite`、SQLite FTS5 能力，以及已有 AI 索引的表结构、临时文件和权限：

```sh
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check | tee /tmp/acceptance-ai-fts.txt
```

如果设备尚未对任何书籍提问，脚本会跳过索引文件检查，但仍会验证 FTS5 运行时。先在阅读器中打开《吃的营养科学观》并提问一次，再重新执行 `check`。通过标准：

- FTS5 内存表创建成功；
- `ai-index` 下的 SQLite 文件可正常打开；
- 索引包含 `ai_meta`、`ai_chunk_text` 和 `ai_chunks`；
- 索引文件权限为 `600`，索引目录权限为 `700`；
- 不存在遗留 `.tmp` 文件；
- 中文问题可以返回书本片段和对应来源章节。

应用在每次读取或生成索引时都会重新收紧权限，因此升级后再次提问即可修正历史上已经生成的 `644` 索引文件。

## 5.1 AI 索引管理器验收

管理员在 AI 设置中打开“管理本地检索索引”，确认索引管理器是独立 surface，并且不会替换或清空当前 AI 对话。普通用户不显示入口；直接请求管理 API 必须返回 403，未带 fnOS 身份必须返回 401。

管理员依次验证：

1. 索引列表只显示书名、格式、状态、大小和时间，不显示原书路径、正文、搜索词、API Key 或 SQLite 原始错误。
2. 删除单本 ready 索引后，下一次全文搜索或 AI 问答能够按需重建。
3. 构建或读取进行中删除同一本索引时，界面显示忙碌，不删除文件。
4. 清理孤儿与临时文件需要二次确认；书库扫描失败或 completed-with-errors 时，孤儿清理返回失败且不删除任何文件。
5. 重新打开管理器后，列表会重新从服务端读取；失败时可重试，不残留重复 surface。
6. 重启服务后，索引仍可读取；manifest 损坏时只恢复管理元数据，不删除可用 SQLite 文件。

通过标准：

- ai-index 目录权限为 700；
- SQLite 索引和 manifest.json 权限为 600；
- 没有被活跃构建占用的过期 .tmp 文件可以被清理；
- 管理器任何操作都不会删除原始书籍、阅读进度、书签、标注和 AI 配置；
- 既有全文搜索、AI 问答和阅读器交互保持正常。

## 6. Socket 与生命周期验收

```sh
/var/apps/babyreader-fnos/cmd/main status
/var/apps/babyreader-fnos/cmd/main restart
/var/apps/babyreader-fnos/cmd/main status
```

通过标准：优先检查运行时 status=0；如果 fnOS 外部监管模式下 `cmd/main status` 返回 3，但 `target/app.sock` 存在且 Unix Socket health 返回 200，则按“服务已运行、状态命令未接管 PID”的兼容情况通过；若 Socket 或 health 失败仍判定失败。停止时 status=3；`target/app.sock` 随服务创建/删除；进程指向 `target/server/index.js`；日志写入包变量目录。

## 7. 升级持久化验收

升级前用两个用户分别写入阅读进度和划线，然后：

```sh
sh scripts/fnos-device-acceptance.sh snapshot /tmp/babyreader-before.txt
```

通过应用中心升级 FPK，不要卸载重装。升级后、不继续阅读或修改状态时：

```sh
sh scripts/fnos-device-acceptance.sh snapshot /tmp/babyreader-after.txt
sh scripts/fnos-device-acceptance.sh compare \
  /tmp/babyreader-before.txt /tmp/babyreader-after.txt
```

随后人工确认两个用户的进度和划线仍然存在。若未来包含显式状态迁移，快照允许变化，但必须有迁移说明和测试。

## 8. 发布验收表

| 项目 | x86_64 | ARM64 | 证据 |
| --- | --- | --- | --- |
| 安装 FPK | 待验 | 待验 | 安装日志 |
| Node 22 | 待验 | 待验 | acceptance report |
| main start/status/stop | 待验 | 待验 | acceptance report |
| app.sock | 待验 | 待验 | acceptance report |
| health via socket | 待验 | 待验 | acceptance report |
| Gateway UID/admin | 待验 | 待验 | Network/JSON 记录 |
| 两用户隔离 | 待验 | 待验 | 两用户状态记录 |
| 授权目录 ACL | 待验 | 待验 | 扫描结果 |
| 未授权/符号链接拒绝 | 待验 | 待验 | 扫描/错误记录 |
| SQLite/FTS5 运行时 | 待验 | 待验 | acceptance-ai-fts.txt |
| AI 索引表结构与权限 | 待验 | 待验 | acceptance-ai-fts.txt |
| AI 真实供应商连接 | 待验 | 待验 | ai-test 输出 |
| AI 索引管理器管理员边界 | 待验 | 待验 | API/UI 记录 |
| AI 索引删除/孤儿清理保护 | 待验 | 待验 | API/UI 记录 |
| manifest/临时文件恢复 | 待验 | 待验 | 重启与清理日志 |
| 原版本 → 新版本升级 | 待验 | 待验 | before/after snapshot |
| 阅读进度/划线保留 | 待验 | 待验 | 两用户人工复核 |

只有两列全部通过，才把对应 commit/tag 标记为真机验收完成。

## 8.1 当前候选包记录

- 源提交：a14862e906354a8ed76614b3f744b1e7119bcdeb
- manifest 版本：1.1.2
- 本地 FPK：dist/babyreader-fnos.fpk
- SHA-256：C924554E9D658EC09584DE343F25A959D0C94B5F94E3BFAF03C261EAEFB044BA
- 包大小：5,332,661 bytes
- 本地构建环境：Windows AMD64、Node v24.20.0、本地 fnpack
- 本地自动化：Node 180 pass / 4 条件 skip；Chromium 80 pass / 2 可选真实 EPUB skip；结构与便携校验通过
- fnOS 真机安装、权限目录、Gateway、ACL、x86_64/ARM64 与升级结果：待验
