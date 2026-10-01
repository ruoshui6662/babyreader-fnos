# 枕书

枕书是运行在飞牛 fnOS 上的私人书房：阅读 EPUB、PDF、MOBI/AZW3、Markdown 和 TXT，支持划线与笔记、全文搜索、AI 问书，并在多台设备间同步阅读进度。

本项目最初基于 macOS 阅读器 [BabyReader](https://github.com/KingJing1/babyreader)（作者 一龙小包子，MIT 许可）改造而来，现已大幅重写为面向 fnOS 的 Web 应用，详见下方“致谢”。

> 项目全貌、进度与待办见 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)；分支、提交与发布约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 上游基线

固定版本记录在 `UPSTREAM_BASELINES`：

- BabyReader（原项目）: `bf4a7271c89cde034485e237e5bfa80d933edfb4`
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

开发、CI 与 fnOS 运行统一使用 Node.js 22。

```bash
cd D:/AI编程/reader/zhenshu
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
ZHENSHU_DEV_PORT=8099 \
ZHENSHU_DEV_UID=development \
node app/server/index.js
```

浏览器访问：

```text
http://127.0.0.1:8099/app/zhenshu/
```

开发模式仅在缺少 fnOS 网关 Header 时使用 `ZHENSHU_DEV_UID`。生产模式必须从统一网关读取 `X-Trim-Userid`、`X-Trim-Username` 和 `X-Trim-Isadmin`，不能信任客户端提交的用户 ID。

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

## 直连端口（可选）

默认通过飞牛桌面（5666 端口）打开枕书。若希望在手机或电脑浏览器里直接访问，可以在安装时或在“应用设置 → 直连访问”中开启：

1. 填写访问端口（1024–65535，不能是 5666/5667）、访问密码（8 位以上）和“以哪个飞牛用户身份阅读”。
2. 用该飞牛用户在飞牛桌面打开一次枕书，让枕书记下这个用户。
3. 在浏览器打开 `http://NAS 地址:端口/`，输入访问密码即可。

说明：直连端口不经过 fnOS 登录，访问密码是唯一的门槛，请设置足够长的密码，不要把端口直接暴露到公网（如需外网访问，建议走 fnOS 的远程访问或带 HTTPS 的反向代理）。直连时只读写所选用户的书架、进度和笔记，没有管理员权限。应用设置中留空的项会保持原值；修改密码或用户后，所有已登录设备需要重新输入密码。

## 测试和结构检查

Windows 本地开发：

```powershell
npm test
npm run check
npm run check:portable
npm run test:e2e
```

Linux/CI：

```bash
npm test
npm run check:portable
npm run check:posix
npm run test:e2e
```

`npm run check` 在 Windows 自动使用 portable 模式，不再要求本机存在 `sh`；Linux 的 `check:posix` 仍会对 fnOS 生命周期脚本执行严格的 `sh -n`。Playwright E2E 使用真实 Node 开发服务器、隔离临时书库和 Chromium，不读取 NAS 的真实用户数据。

测试覆盖授权目录边界、符号链接越权、ZIP 路径穿越、ZIP bomb 限制、EPUB HTML 清理、Reader Shell/分页回归和真实 Chromium 主流程。Windows 未启用符号链接权限时，对应测试会跳过，应由 Linux CI 或真实 fnOS 验收补齐。

## fnOS 运行结构

统一网关入口为：

```text
/app/zhenshu
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
cd D:/AI编程/reader/zhenshu
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
6. 规范化 FPK 归档并生成构件证明。
7. 将 FPK、`.sha256` 与 `build-provenance.json` 写入 `dist-v<manifest 版本>/`。

预期生成物：

```text
dist-v1.2.0/*.fpk
dist-v1.2.0/*.fpk.sha256
dist-v1.2.0/build-provenance.json
```

`build-provenance.json` 记录 Git commit/ref、manifest 版本、Node/npm/Python、固定 fnpack 信息、FPK 外层 SHA-256，以及服务端入口、锁文件和全部第一方 UI 模块的包内哈希。CI 会校验该记录绑定当前 `GITHUB_SHA`。

当前工程不内置架构相关 Node.js 二进制。真实设备必须提供兼容的 `node` 命令，或在针对 x86、ARM 的发布流水线中分别放入 `bin/node`。应用自身依赖为纯 JavaScript。

## 真实 fnOS 设备验证清单

完整、可重复的 x86_64/ARM64 验收步骤见 `docs/FNOS_DEVICE_ACCEPTANCE.md`，并可使用 `scripts/fnos-device-acceptance.sh` 自动采集架构、Node 22、生命周期、Socket、直连 401、ACL 与升级前后用户状态哈希。

- FPK 安装、升级、卸载和数据保留行为
- `cmd/main` 的启动、停止、重启及状态退出码
- `/var/apps/zhenshu/target/app.sock` 的权限和统一网关转发
- 网关用户 Header 的真实名称、大小写和值格式
- fnOS 授权目录如何同步到 `${TRIM_PKGETC}/settings.json`
- 包用户对授权目录及 `data-share` 目录的 ACL 访问
- 多用户阅读进度和划线是否严格隔离
- 大型及异常 EPUB 在真实 NAS 内存限制下的表现
- x86 和 ARM 设备上的 Node.js 运行时兼容性
- fnOS 桌面 url 入口下的 CSP、下载和 EPUB 渲染行为

## 致谢

枕书站在这些开源项目的肩膀上：

- [BabyReader](https://github.com/KingJing1/babyreader)（一龙小包子，MIT）：本项目的起点，最初的阅读界面与交互思路来自这里。
- [PDF.js](https://github.com/mozilla/pdf.js)（Mozilla，Apache-2.0）：PDF 渲染与文本解析。
- [lingo-reader](https://github.com/hhk-png/lingo-reader)（MIT）：MOBI/AZW3 解析（已修补，见 `app/server/vendor/lingo-mobi/PATCHES.md`）。
- 随包字体：思源宋体（Noto Serif SC）、霞鹜文楷、朱雀仿宋、Literata，均为 SIL OFL 1.1，详见 `docs/fonts-licensing.md`。
- [飞牛 fnOS 开发文档](https://github.com/ckcoding/fnnas-docs)。

## 许可

MIT，见 [LICENSE](LICENSE)。按 MIT 要求，原项目 BabyReader 的版权声明保留在其中。

