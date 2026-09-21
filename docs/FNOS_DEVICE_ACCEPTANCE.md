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

## 4. ACL 验收

至少准备两个目录：A 为已授权书库，B 为未授权目录。A 中 EPUB/TXT/Markdown 必须能扫描和打开；B 不得出现在索引中；A 内符号链接指向 B 时不得越权读取；撤销 A 的授权后重新扫描必须报告不可用根目录。

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
| AI 索引管理器管理员边界 | 待验 | 待验 | API/UI 记录 |
| AI 索引删除/孤儿清理保护 | 待验 | 待验 | API/UI 记录 |
| manifest/临时文件恢复 | 待验 | 待验 | 重启与清理日志 |
| 原版本 → 新版本升级 | 待验 | 待验 | before/after snapshot |
| 阅读进度/划线保留 | 待验 | 待验 | 两用户人工复核 |

只有两列全部通过，才把对应 commit/tag 标记为真机验收完成。
