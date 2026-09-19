# BabyReader fnOS 真机验收矩阵

本文把“真机可用”拆成可重复采证的契约。任何正式版本进入 `main` 前，至少在一台 x86_64 和一台 ARM64 fnOS 设备上分别完成一次。

## 1. 验收原则

- 架构差异只允许来自宿主和 Node 运行时，不允许应用 JavaScript 代码出现架构分叉。
- 先验证进程/Socket，再验证 Gateway，再验证 ACL 和多用户，最后验证升级持久化。
- 每次验收记录：Git commit、版本 tag、FPK SHA-256、设备架构、fnOS 版本、Node 版本、结果与日志。
- Windows/Linux 单元测试通过不能替代真机 Gateway、ACL、应用中心升级流程。

## 2. 自动采集

验收脚本属于源码仓库工具，不打入生产 FPK。先把源码中的 `scripts/fnos-device-acceptance.sh` 复制到 NAS 临时目录（或在源码 checkout 中运行），再在设备上执行：

```sh
sh scripts/fnos-device-acceptance.sh check | tee acceptance-x86.txt
```

ARM 设备同样执行并保存为 `acceptance-arm64.txt`。脚本自动检查 CPU 架构、Node.js 22、生命周期状态、`app.sock`、Unix Socket health、无 Gateway 身份时的 401、运行目录与授权书库 ACL。

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

## 5. Socket 与生命周期验收

```sh
/var/apps/babyreader-fnos/target/cmd/main status
/var/apps/babyreader-fnos/target/cmd/main restart
/var/apps/babyreader-fnos/target/cmd/main status
```

通过标准：运行时 status=0，停止时 status=3；`target/app.sock` 随服务创建/删除；进程指向 `target/server/index.js`；日志写入包变量目录。

## 6. 升级持久化验收

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

## 7. 发布验收表

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
| 原版本 → 新版本升级 | 待验 | 待验 | before/after snapshot |
| 阅读进度/划线保留 | 待验 | 待验 | 两用户人工复核 |

只有两列全部通过，才把对应 commit/tag 标记为真机验收完成。
