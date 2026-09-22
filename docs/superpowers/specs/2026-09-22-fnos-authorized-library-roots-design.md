# fnOS 授权书库目录设计规格

## 目标

让 BabyReader 正确识别用户在飞牛 fnOS“应用限制 → 访问权限”中授权的自定义书库目录，并在权限生效后通过“重新扫描”读取其中的 EPUB、Markdown 和 TXT 文件，同时保持默认共享目录、阅读数据、AI 功能和现有路径安全策略稳定。

本规格只定义后续开发边界，不在当前阶段修改产品代码。

## 背景与现状

当前应用已经有三类书库根目录来源：

1. `config/settings.json` 中的 `libraryRoots`，用于兼容现有配置。
2. fnOS 注入的 `TRIM_DATA_ACCESSIBLE_PATHS`，代表用户在应用权限中授权的路径。
3. `config/resource` 注入的 `TRIM_DATA_SHARE_PATHS`，当前包含 `babyreader-fnos/library` 默认共享目录。

`app/server/index.js` 当前会合并三类来源，并通过 `fs.realpath`、目录检查和 `fs.access` 过滤不可用目录；`app/server/library.js` 再对有效根目录递归扫描支持的文件格式；`app/server/security.js` 会校验真实路径边界并拒绝符号链接越权。

当前缺口主要是：

- 没有独立的授权根目录解析边界，配置来源、规范化、去重和诊断混在服务入口中。
- 没有明确证明 fnOS 权限变更后运行中的服务何时获得新的环境变量。
- 重叠授权根目录可能导致重复遍历和重复书目。
- 普通用户缺少明确的“权限变更后如何刷新”的反馈；管理员诊断也需要区分配置目录、用户授权目录和共享目录。
- 真机验收脚本目前主要检查 `settings.json`，没有形成完整的“应用权限 → 服务重启 → 重新扫描 → 书籍出现”验收闭环。

## 平台依据

- `manifest` 的 `disable_authorization_path=false` 应保持不变，使 fnOS 显示授权目录设置。
- fnOS 通过 `TRIM_DATA_ACCESSIBLE_PATHS` 向应用进程提供用户授权路径，通过 `TRIM_DATA_SHARE_PATHS` 提供应用声明的共享目录。
- 用户文件访问必须基于明确授权，应用继续以 `run-as=package` 运行，不提升 root 权限。

官方参考：

- https://developer.fnnas.com/docs/core-concepts/manifest/
- https://developer.fnnas.com/docs/core-concepts/environment-variables/
- https://developer.fnnas.com/docs/core-concepts/privilege/
- https://developer.fnnas.com/docs/core-concepts/resource/

## 设计方案

### 1. 授权来源模型

将三类路径保留为兼容性的并集，但在内部保留来源：

```text
configuredRoots       ← settings.json.libraryRoots
accessibleRoots       ← TRIM_DATA_ACCESSIBLE_PATHS
sharedRoots           ← TRIM_DATA_SHARE_PATHS
authorizedRoots       ← 三者规范化、realpath、去重后的可访问目录
rejectedRoots         ← 不存在、不是目录、不可遍历或 realpath 失败的目录
```

`TRIM_DATA_ACCESSIBLE_PATHS` 是用户授权的外部目录来源；应用不在普通设置中复制或持久化该值。`settings.json.libraryRoots` 继续读取，以避免破坏已有设备，但不绕过 fnOS 的 realpath、ACL 和可访问性检查。

### 2. 根目录解析边界

新增独立的 `app/server/library-roots.js`，负责：

- 解析冒号分隔的 fnOS 路径列表。
- 合并并保留来源信息。
- 对目录执行 `realpath`、`stat`、`access`。
- 对完全相同的真实路径去重。
- 对父子重叠根目录进行稳定裁剪，避免同一本书被扫描两次。
- 返回可供扫描器使用的 `authorizedRoots` 和供诊断使用的脱敏摘要。

扫描器仍只接受解析后的 `authorizedRoots`，不直接读取环境变量。

### 3. 权限变更与刷新生命周期

标准流程：

```text
fnOS 添加目录权限
  → fnOS 更新应用运行上下文并重启/重新启动服务
  → 用户点击“重新扫描”
  → 服务重新执行 loadConfiguration()
  → 解析新的 TRIM_DATA_ACCESSIBLE_PATHS
  → 递归扫描新授权目录
  → 原子保存 library.json
```

如果真机证明 fnOS 不会在权限变更后自动重启服务，则第一版采用明确提示“权限变更后请重启应用”，不尝试通过 root、扫描全盘或非官方接口绕过平台权限模型。

### 4. 书库扫描行为

- 默认共享目录和自定义授权目录都可递归扫描。
- 继续只支持 `.epub`、`.md`、`.markdown`、`.txt`。
- 单个根目录失败时保留其他有效根目录的结果，并在扫描状态报告错误。
- 任何根目录授权状态不确定时不扩大访问范围。
- 不因路径变化修改书籍 ID 规则、阅读进度、书签、标注、AI 会话或 AI 索引协议。
- 重叠根目录不能产生重复书目。

### 5. 诊断与 UI

管理员诊断信息显示数量和状态：

- 配置根目录数量
- fnOS 用户授权根目录数量
- 共享根目录数量
- 实际可访问根目录数量
- 被拒绝根目录数量和错误类型

普通书库界面不显示服务器绝对路径。扫描失败时显示可执行提示；扫描成功时显示新增/复用/失败数量。

### 6. 安全边界

- 不扫描整个 `/vol1` 或其他默认大范围路径。
- 不把用户提交的任意路径直接交给 `fs`。
- 所有路径必须经过 `realpath` 和授权根边界检查。
- 继续拒绝符号链接跨越授权根目录。
- 继续以 `babyreader_fnos` 包用户运行。
- 不新增 root 权限、后台文件监听器或自定义提权接口。
- 普通用户 API 不返回绝对路径；管理员诊断才可查看经过权限保护的诊断信息。

## 成功标准

1. 在 fnOS 应用权限中添加自定义目录后，服务重启并点击“重新扫描”，目录中的 EPUB、Markdown、TXT 出现在书库。
2. 默认共享目录继续可用。
3. 多个目录、中文路径、空格路径和嵌套目录均可用。
4. 未授权目录、越权符号链接和权限撤销目录均不会被读取。
5. 重叠授权目录不会产生重复书籍。
6. 搜索、AI 问书、书签、标注、阅读进度和会话数据不回归。
7. FPK 安装、升级、重启和 fnOS 真机验收均有记录。

## 非目标

- 不在应用内部制作第二套文件夹授权系统。
- 不修改 fnOS 用户权限或 ACL。
- 不引入新的数据库表。
- 不改变默认共享目录的名称。
- 不实现实时文件监听或自动后台扫描。
