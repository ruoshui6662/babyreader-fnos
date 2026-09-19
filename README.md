# BabyReader for fnOS

BabyReader 的飞牛 fnOS FPK 改造工程。保留原项目的 Web 阅读界面，使用 Node.js 后端和 fnOS 统一网关提供书库扫描、内容读取、阅读进度及划线持久化能力。

## 上游基线

固定版本记录在 `UPSTREAM_BASELINES`：

- BabyReader: `bf4a7271c89cde034485e237e5bfa80d933edfb4`
- fnnas-docs: `a8a70503b5b3413f0a00f4b6db6cd62066639508`

## 功能

- EPUB、Markdown、TXT 扫描和索引
- EPUB 元数据及封面提取
- fnOS 统一网关 Unix Socket 服务
- 基于 `X-Trim-Userid` 的用户数据隔离
- 阅读进度和高亮持久化
- 授权目录 realpath 校验及符号链接越权防护
- ZIP 路径穿越、压缩比、条目数和解压大小限制
- 严格 Content Security Policy 和 EPUB HTML 清理
- 纯 JavaScript 运行依赖，应用代码同时适用于 x86 和 ARM

## 本地开发

需要 Node.js 20 或更高版本。

```bash
cd D:/AI编程/reader/babyreader-fnos
npm ci
```

创建本地配置：

```bash
mkdir -p .runtime/etc .runtime/var
printf '%s\n' '{"libraryRoots":["D:/Books"]}' > .runtime/etc/settings.json
```

启动开发服务器：

```bash
NODE_ENV=development \
BABYREADER_DEV_PORT=8099 \
BABYREADER_DEV_UID=development \
node app/server/index.js
```

浏览器访问：

```text
http://127.0.0.1:8099/app/babyreader-fnos/
```

开发模式仅在缺少 fnOS 网关 Header 时使用 `BABYREADER_DEV_UID`。生产模式必须从统一网关读取 `X-Trim-Userid`、`X-Trim-Username` 和 `X-Trim-Isadmin`，不能信任客户端提交的用户 ID。

## 书库目录配置

服务从 `${TRIM_PKGETC}/settings.json` 读取授权书库根目录：

```json
{
  "libraryRoots": [
    "/vol1/Users/example/Books"
  ]
}
```

这些路径必须同时具有 fnOS 授权目录权限。服务启动时会解析真实路径；扫描和读取文件时会再次执行 realpath 边界校验，并跳过符号链接。

## 测试和结构检查

```bash
npm test
npm run check
```

测试覆盖授权目录边界、符号链接越权、ZIP 路径穿越、ZIP bomb 限制和 EPUB HTML 清理。Windows 未启用符号链接权限时，对应测试会跳过，应在 Linux 或真实 fnOS 设备上补充执行。

## fnOS 运行结构

统一网关入口为：

```text
/app/babyreader-fnos
```

服务监听：

```text
${TRIM_APPDEST}/app.sock
```

持久化数据位于：

```text
${TRIM_PKGVAR}/index/library.json
${TRIM_PKGVAR}/covers/
${TRIM_PKGVAR}/users/<uid>/reading-state.json
```

应用以 `config/privilege` 中声明的专用包用户运行，不使用 root 身份。

## 构建 FPK

先安装与构建机平台匹配的 `fnpack`，并确保可以执行：

```bash
fnpack --help
```

然后运行：

```bash
cd D:/AI编程/reader/babyreader-fnos
npm test
npm run check
npm run build:fpk
```

构建脚本会：

1. 创建隔离的 `.build/fpk-root` 打包目录。
2. 复制 fnOS 必需文件和应用资源。
3. 使用 `npm ci --omit=dev --ignore-scripts` 安装生产依赖。
4. 修正生命周期脚本权限。
5. 调用 `fnpack build --directory`。
6. 将生成的 `.fpk` 复制到 `dist/`。

预期生成物：

```text
D:/AI编程/reader/babyreader-fnos/dist/*.fpk
```

当前工程不内置架构相关 Node.js 二进制。真实设备必须提供兼容的 `node` 命令，或在针对 x86、ARM 的发布流水线中分别放入 `bin/node`。应用自身依赖为纯 JavaScript。

## 真实 fnOS 设备验证清单

- FPK 安装、升级、卸载和数据保留行为
- `cmd/main` 的启动、停止、重启及状态退出码
- `/var/apps/babyreader-fnos/target/app.sock` 的权限和统一网关转发
- 网关用户 Header 的真实名称、大小写和值格式
- fnOS 授权目录如何同步到 `${TRIM_PKGETC}/settings.json`
- 包用户对授权目录及 `data-share` 目录的 ACL 访问
- 多用户阅读进度和划线是否严格隔离
- 大型及异常 EPUB 在真实 NAS 内存限制下的表现
- x86 和 ARM 设备上的 Node.js 运行时兼容性
- fnOS 桌面 iframe 下的 CSP、下载和 EPUB 渲染行为
