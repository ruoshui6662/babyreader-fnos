# BabyReader fnOS 接手与开发推进计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 fnOS 阅读体验、多用户隔离和内容安全边界的前提下，使 BabyReader 成为可追溯、可跨平台验证、可在真实 fnOS 发布并能持续扩展的产品。

**Architecture:** 应用由 fnOS FPK 壳层、Node.js Unix Socket 服务、静态 Web 阅读器和本地 JSON 持久化组成。后续工作先固化可复现发布基线与真机契约，再以保持 API/DOM 兼容的方式拆分前端单体，最后按“书签、笔记、搜索”的顺序扩展核心阅读能力；AI 只在隐私、成本与运维策略获批后进入实现。

**Tech Stack:** Node.js 22；CommonJS；原生 Node HTTP；`fflate`；`sanitize-html`；浏览器端 EPUB.js、JSZip、Marked；`node:test`、Happy DOM；fnpack/FPK；POSIX Shell。

**Spec:** 本文是基于当前工作区的源码、测试、`README.md`、`CHANGELOG_WORK.md`、`UI_INTERFACE_MAP.md` 与 `docs/weread-layout-baseline.md` 于 2026-09-18 的审计结果。新的产品需求须先有独立设计说明，再执行对应阶段。

## Global Constraints

- manifest 必须保持 `platform=all`、依赖 `nodejs_v22`、最低 fnOS `1.1.3100`，进程以 `babyreader_fnos` 包用户运行。
- 生产身份只信任网关注入的 `X-Trim-Userid`、`X-Trim-Username`、`X-Trim-Isadmin`；永不接受客户端提交的用户 ID。
- 书库访问必须继续经过 realpath 授权边界校验并跳过符号链接；ZIP 路径、条目、解压大小和压缩比限制不得放宽。
- 用户数据必须按 UID 隔离；书籍正文、封面和状态不得落入共享公开缓存。
- 保留 `/app/babyreader-fnos` 前缀、`app.sock`、现有 API 与 `UI_INTERFACE_MAP.md` 声明的核心 DOM ID，除非另有破坏性变更设计。
- 本地、CI 与设备统一使用 Node.js 22；修正 README 中“Node 20+”的过时描述。
- 每项改动先有测试，再依次执行受影响测试、`npm test`、结构校验和真机检查；不得提交 `.runtime`、`.build`、`dist`、`node_modules` 或 GUI 临时文件。
- 用户只可选择“连续滚动”和“双页分页”；窄屏单列是双页模式的自动降级。

## GitHub 备份、分支与版本策略

- 官方备份仓库固定为 `https://github.com/ruoshui6662/babyreader-fnos`，本地远端名统一使用 `origin`。
- `main` 是唯一的最新稳定发布分支：任何时刻 `origin/main` 都应对应当前建议安装、测试与继续开发的最新稳定源码，不用 `main-v1`、`latest` 等平行长期分支表达“最新版”。
- 每次形成可发布版本时，在进入 `main` 的发布提交上创建语义化版本标签，格式统一为 `vMAJOR.MINOR.PATCH`，例如 `v1.0.0`、`v1.1.0`、`v1.1.1`。历史版本通过 Git tag 固定，不通过复制目录或长期版本分支保存。
- 版本号规则：不兼容变更提升 MAJOR；向后兼容的新功能提升 MINOR；缺陷修复、兼容性修复和不改变公开契约的维护提升 PATCH。
- 任何发布标签必须指向已经进入 `main` 的提交；禁止给未合并、未验证或工作区脏状态打正式版本标签。
- GitHub 主要作为远端备份与版本恢复来源。完成一组可回滚改动后提交并推送；正式发布时同时推送 `main` 与对应版本 tag。
- 开发中的临时实验若需要分支，使用短生命周期功能分支；验证完成后合并回 `main` 并删除远端临时分支，避免长期分叉。
- `.fpk`、`node_modules`、`.build`、`.runtime`、`dist` 等生成物不进入 Git 源码历史；发布构件通过 Release/CI 或独立构件记录保存，并必须能追溯到具体 tag/commit。
- 回滚时优先按 tag 检出历史稳定版本；不得通过覆盖 `main` 历史或 force-push 来“回退”。若已发布版本需要撤销，使用 revert 形成新的 `main` 提交，并按需要发布新的 PATCH 版本。

### 当前 Git 状态（2026-09-19）

- [x] 已在 `babyreader-fnos` 初始化 Git，默认分支为 `main`。
- [x] 已配置 `.gitignore`，排除依赖、运行时目录、构建目录、FPK 与日志等生成物。
- [x] 已配置 `.gitattributes`，确保 fnOS/POSIX 生命周期与构建脚本在 Windows 开发环境中仍保持 LF。
- [x] 已将 GitHub 仓库配置为 `origin` 并读取现有远端 `main`。
- [x] 已将当前源码基线提交接入远端既有 `main` 历史并推送。
- [x] 第一个正式稳定发布版本使用 `v1.0.0` tag 固定；后续稳定版本继续按 `vMAJOR.MINOR.PATCH` 标注。

## 审计快照

### 已实现且已有覆盖

| 域 | 已交付能力 | 主要位置 |
| --- | --- | --- |
| fnOS 封装 | manifest、包用户、数据共享、安装/升级/卸载/配置脚本、Unix Socket 与 url 型桌面入口 | `manifest`、`cmd/`、`config/`、`app/ui/config` |
| 书库 | 多根扫描、EPUB/MD/Markdown/TXT、增量索引、稳定书 ID、EPUB 元数据与封面 | `app/server/library.js`、`storage.js` |
| 阅读 | EPUB、文本、目录、连续滚动、双页分页、章节/键盘/移动端操作 | `app/ui/app.js`、`styles.css` |
| 个性化 | 主题、字号、行高、边距、进度、划线颜色/备注与 Markdown 导出 | `storage.js`、`app.js` |
| 安全 | 网关身份、用户隔离、路径与 ZIP 防护、HTML 清理、CSP/安全响应头 | `security.js`、`zip.js`、`index.js` |
| 回归保护 | 安全、书库/API/存储、fnOS 生命周期、DOM/分页四类测试 | `tests/*.test.js` |

本次验证：`npm test` 为 **46 项，44 通过、0 失败、2 跳过**。跳过原因是 Windows 不具备符号链接权限与 Unix-domain Socket 生命周期条件。

### 高风险缺口

| 优先级 | 缺口 | 事实与影响 | 完成定义 |
| --- | --- | --- | --- |
| P0 | 版本控制与基线 | 本地 Git、`.gitignore`、`.gitattributes` 与 GitHub `origin` 已建立；当前仍需完成首个源码基线提交、推送与正式版本 tag。 | 有可提交源码基线、标签、远端、忽略规则、恢复与发布手册。 |
| P0 | Windows 结构校验 | `npm run check` 在本机失败：`scripts/validate-structure.js:120` 硬调用 `sh -n`，环境找不到 `sh`。 | Windows 完成所有 Node 结构检查并明确跳过 POSIX 语法；Linux 必须严格执行 `sh -n`。 |
| P0 | 真机证明 | x86/ARM、网关 Header 实际格式、ACL、升级数据保留和 url 入口均未有版本化设备证据。 | 两种架构完成验收矩阵并保存结果。 |
| P0 | 构件溯源 | 当前 FPK 为 4,135,101 bytes，SHA-256 `3E404E84BD9F387C5EEA007D6B53F82889395BC2CDAC2C311F1E7E39683FF4A8`；无 CI 产物台账。 | 每个构件可追溯到 commit、锁文件、Node/fnpack 版本、内层文件哈希及真机报告。 |
| P1 | 前端单体 | `app/ui/app.js` 约 131 KB，混合 API、状态、EPUB、划线、分页、Drawer、事件与书架。 | 拆成职责单一模块，保留全部现有 API/DOM 和回归结果。 |
| P1 | 测试层级 | Happy DOM 覆盖很好，但无 Chromium E2E、可访问性、性能门槛和依赖审计。 | CI 具备 Windows/Linux 单元验证、Linux Chromium E2E 和审计。 |
| P1 | 文档不一致 | README 的 Node 要求与设备脚本/manifest 的 Node 22 不一致；API 文档不完整。 | 一个可验证的 API、运行与发布事实来源。 |
| P2 | 功能空位 | 搜索、书签、笔记、AI UI 是保留且禁用状态，尚无对应数据模型/API。 | 按审批后的功能设计逐项交付，不能只启用按钮。 |
| P2 | 可观测性 | 已有 health/diagnostics/errors 与日志，但无结构化事件、指标和故障手册。 | 管理员能定位版本、配置、扫描、资源与错误，并有处置剧本。 |

## 当前架构与目录职责

```text
fnOS 桌面（url 入口）
  └─ /app/babyreader-fnos/ → 统一网关（注入 X-Trim-*）
       └─ Unix Socket: ${TRIM_APPDEST}/app.sock
            └─ app/server/index.js
                 ├─ library.js：扫描、EPUB 元数据和封面
                 ├─ security.js + zip.js：路径、ZIP、HTML 安全边界
                 ├─ storage.js：索引、封面、users/<uid>/reading-state.json
                 └─ app/ui：静态前端
```

| 路径 | 责任 | 接手约束 |
| --- | --- | --- |
| `manifest` | fnOS 元数据、Node 依赖、授权行为 | 任何版本/宿主改动均先跑结构校验并核对 fnOS 文档。 |
| `cmd/` | POSIX 生命周期与服务启停 | 保持 LF、`#!/bin/sh`；`main` 负责 Node 22、PID、Socket、日志。 |
| `config/` | 包用户/组与 data-share 声明 | 文件访问故障先检查这里与真实 NAS ACL。 |
| `app/server/index.js` | 网关 HTTP、身份、安全头、静态资源、开发端口/Socket | 新 API 在这里登记，并使用 `gatewayUser`。 |
| `app/server/library.js` | 扫描、索引复用、元数据、封面 | 新格式必须同步扫描、索引、MIME、前端与测试。 |
| `app/server/security.js` / `zip.js` | 不可信路径、压缩包、HTML 边界 | 新解析能力默认拒绝未知/越界输入。 |
| `app/server/storage.js` | 原子 JSON、UID 状态、书库索引 | 新用户数据只能落在 UID 分区，升级必须迁移且可回滚。 |
| `app/ui/index.html` | 稳定 DOM、资源版本号 | 保留接口 ID；资源更新同步缓存查询串。 |
| `app/ui/app.js` | 当前全部前端行为 | 分页与 CSS 是耦合系统；先特征测试再改。 |
| `app/ui/styles.css` | 主题、响应式、纸卡/分页变量 | JS 几何和 CSS 自定义属性必须同一变更审查。 |
| `tests/` | 服务器、安全、生命周期、DOM 回归 | POSIX 只在 Linux/fnOS 验证；浏览器真实行为放到 E2E。 |
| `scripts/build-fpk.sh` | 隔离打包、生产依赖、fnpack、归档净化 | 需要 Bash 与 fnpack；输出必须附构件证明。 |

## 已确认 API 契约

所有路径均以 `/app/babyreader-fnos/api` 为前缀；除了 `/health`，均通过网关身份。管理员专用接口还需要 `isAdmin`。

| 方法/路径 | 权限 | 行为 |
| --- | --- | --- |
| `GET /health` | 可达即可 | 服务存活、启动时间、扫描状态。 |
| `GET /session` | 用户 | UID、用户名、管理员标记。 |
| `GET /diagnostics`、`GET /errors` | 管理员 | 诊断与内存错误记录。 |
| `GET /library`、`GET /library/scan/status` | 用户 | 脱敏书目与扫描状态。 |
| `POST /library/scan` | 管理员 | 触发串行扫描。 |
| `GET /state`、`PUT /settings` | 用户 | 用户设置及状态。 |
| `GET /books/:sha256/content`、`GET /books/:sha256/cover` | 用户 | 已授权正文/封面。 |
| `PUT /books/:sha256/progress`、`PUT /books/:sha256/highlights` | 用户 | 用户进度、划线、备注。 |

## Review Focus

- 多根目录、中文/空格路径、失效根和符号链接并存时，扫描应保留有效书目且绝不越过授权 realpath。
- 缺失或伪造网关头、非管理员访问诊断、跨 UID 读写时，服务不得回退身份或泄露数据。
- 损坏 EPUB、ZIP bomb、越界 ZIP 条目、远程资源和脚本化 HTML 不得杀死服务或污染 DOM。
- 800×600、1200×800、奇数宽度、分数 DPR、缩放、旋转和最后奇数列下，分页不得露列、漂移或跳内容。
- 升级后的旧 `readingMode: "single"`、旧进度与旧划线 locator 必须可迁移；迁移失败不可破坏原始 UID JSON。

---

## 2026-09-19 执行状态

> 本节记录本轮实际执行结果；下方“审计快照/实施任务”保留 2026-09-18 的历史计划语义。只有取得对应环境证据的项目才标记为完成。

| 项目 | 当前状态 | 已取得证据 | 尚缺证据 |
| --- | --- | --- | --- |
| Task 2：跨平台结构校验 | 本地完成 | Windows `npm run check` 与 `check:portable` 已通过；portable/POSIX 模式已分离；新增结构校验回归测试 | Linux CI 的 `check:posix` 首次远端通过记录 |
| Task 3：Linux CI + FPK 溯源 | 已实现，待远端验证 | `.github/workflows/ci.yml`、固定 Node 22/fnpack 1.2.3、生产依赖 audit、FPK SHA-256 与 `build-provenance.json`；本地 Python 语法与旧 FPK 解析已验证 | 工作分支 GitHub Actions 的 Linux 构建、构件上传与 commit 绑定结果 |
| Task 4：真实 fnOS 验收 | 验收资产完成，设备执行待办 | 新增 `scripts/fnos-device-acceptance.sh` 与 `docs/FNOS_DEVICE_ACCEPTANCE.md`，覆盖 x86/ARM、Socket、Gateway、ACL、升级快照与多用户 | 至少一台 x86_64 与一台 ARM64 真实 fnOS 的安装/升级/Gateway/ACL/Socket 原始证据 |
| Task 5：前端单体拆分 | 本地完成 | `app.js` 从 3848 行降至约 190 行；拆为 core/reader/shell/library 职责模块；原 46 项测试保持 0 fail | Linux CI 与真实 fnOS 浏览器再验证 |
| Task 6：Chromium E2E | 本地完成 | Playwright 1.63.0；隔离临时书库；真实 Node server；Markdown/TXT/EPUB fixture；桌面/移动端 Chromium 场景通过 | Linux CI E2E 通过记录；真机性能/无障碍扩展基线仍可继续完善 |

### 本轮执行原则

1. 先建立验证能力，再进行结构性重构；任何后续功能扩展必须建立在 `npm test + portable/POSIX check + Chromium E2E` 的组合门禁上。
2. `main` 继续代表最新稳定发布版本。本轮改动先留在 `work/engineering-baseline`，Linux CI 与真实 fnOS 发布条件未满足前不直接升级正式 tag。
3. GitHub CI 只能证明 Linux、Chromium 和 FPK 构建链；它不能代替 fnOS Gateway/ACL/升级/Socket 的宿主契约。
4. 真机验收没有设备连接时必须保持“待验”，不得用本地 Unix/Linux 模拟结果冒充真实 fnOS 结论。

## 实施任务

### Task 1: 冻结可追溯基线（P0）

**Files:**
- Create: `.gitignore`
- Create: `docs/releases/1.0.0-baseline.md`
- Create: `docs/operations/restore-and-release.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 当前源码、FPK、备份清单和验证结果。
- Produces: 可提交源码快照、发布记录、恢复流程和生成物忽略规则。

- [ ] **Step 1: 记录不改动文件的基线证据。**

```powershell
npm test
Get-FileHash dist/babyreader-fnos.fpk -Algorithm SHA256
git status --short
```

Expected: 记录 pass/skip、产物大小和 SHA-256；未初始化 Git 时明确记录该事实。

- [ ] **Step 2: 建立精确忽略规则。**

`.gitignore` 仅忽略以下可再生产物，并加解释注释：

```gitignore
node_modules/
.build/
.runtime/
.gui-test/
gui-test-screenshots/
dist/
*.fpk
*.log
```

不得忽略锁文件、测试、文档、manifest、脚本、配置或源资产。

- [ ] **Step 3: 写基线与恢复文档。**

发布记录必须含观测日期、版本、FPK 大小/哈希、测试、跳过原因、工具版本、Windows Shell 限制和已验证备份位置。恢复手册必须给出 clone/checkout、`npm ci`、测试/检查/打包顺序、fnpack 前提、哈希采集和按版本回滚步骤。

- [ ] **Step 4: 选择远端后初始化并打标签。**

```powershell
git init
git add .gitignore README.md app cmd config docs manifest package.json package-lock.json tests scripts UI_INTERFACE_MAP.md CHANGELOG_WORK.md UPSTREAM_BASELINES ICON.PNG ICON_256.PNG LICENSE
git commit -m "chore: establish BabyReader fnOS baseline"
git tag -a v1.0.0-baseline -m "Verified pre-handoff baseline"
```

不得加入生成目录或新 FPK。

- [ ] **Step 5: 从干净 Linux clone 复现。**

在 Task 2 完成后，以干净 clone 重建并比较内层应用文件哈希；将结果补入发布记录。

### Task 2: 使结构校验跨平台且不降低 POSIX 严格度（P0）

**Files:**
- Create: `tests/structure-validation.test.js`
- Modify: `scripts/validate-structure.js:5,107-125`
- Modify: `tests/fnos-lifecycle.test.js:1-60`
- Modify: `package.json`、`README.md`

**Interfaces:**
- Consumes: 生命周期脚本必须是 POSIX sh、LF 且在 POSIX 系统可执行。
- Produces: 所有平台运行 Node 结构检查；可用时严格执行 `sh -n`；不可用时明确报告原因。

- [ ] **Step 1: 先写失败测试。**

让测试以无 shell 的 PATH/注入 resolver 运行 validator，断言 exit 0、输出含 `POSIX shell syntax validation skipped`，但 required files/manifest/JSON 仍被检查。另用可执行 fake shell 记录 `-n`，断言 9 个生命周期脚本逐一校验。

- [ ] **Step 2: 证明现状失败。**

```powershell
node --test tests/structure-validation.test.js
```

Expected: 旧实现会把 `spawnSync sh ENOENT` 作为错误。

- [ ] **Step 3: 最小实现。**

给 validator 增加 `findPosixShell()`：优先 `BABYREADER_SH`，再找系统 shell，只返回可启动命令。Windows 没有 shell 时输出信息而非 error；非 Windows 没有 `sh` 则失败。现有 LF/shebang/executable 位检查不得删减。

- [ ] **Step 4: 分离命令与验证矩阵。**

添加 `check:portable` 和 `check:posix`：前者每个平台可跑，后者必须有 shell。Windows 运行 `npm test && npm run check:portable`；Linux 运行三项：`npm test`、`npm run check:portable`、`npm run check:posix`。

- [ ] **Step 5: 提交。**

```bash
git add package.json scripts/validate-structure.js tests/structure-validation.test.js tests/fnos-lifecycle.test.js README.md
git commit -m "fix: make structure validation platform-aware"
```

### Task 3: 建 CI、依赖审计和 FPK 内容证明（P0）

**Files:**
- Create: `.github/workflows/verify.yml`（或获选 CI 的等价文件）
- Create: `.github/workflows/package.yml`
- Create: `scripts/verify-fpk-contents.js`
- Modify: `scripts/build-fpk.sh`、`package.json`、发布手册

**Interfaces:**
- Consumes: Node 22、`npm ci`、Task 2 检查、fnpack、FPK。
- Produces: 可保留的验证日志、构件、SHA-256、内层文件哈希和依赖审计结论。

- [ ] **Step 1: 为 FPK 检查器写 fixture 测试。**

构造外层 gzip tar + `app.tgz` fixture。缺 manifest、缺 `server/index.js`、含 `.exe/.dll/.node`、错误 UI 配置和路径穿越必须失败；正确布局须通过并报告 `ui/index.html`、`ui/app.js`、`ui/styles.css`、`server/index.js` 哈希。

- [ ] **Step 2: 实现无不受控解压的检查器。**

只用 Node built-in 或既有锁定依赖；支持 `--json`，失败时说明 member/path 原因，拒绝压缩包路径穿越。

- [ ] **Step 3: 集成构建与 CI。**

`build-fpk.sh` 在归档净化后调用检查器，并生成忽略的 `.sha256` 文件。PR 工作流使用 Ubuntu Node 22：

```bash
npm ci
npm test
npm run check:portable
npm run check:posix
npm audit --omit=dev --audit-level=high
```

打包工作流固定 fnpack 版本，构建、检查并上传 FPK/哈希/JSON 报告，报告内记录 commit SHA。

- [ ] **Step 4: 验证成功和失败路径后提交。**

```bash
git add .github scripts/verify-fpk-contents.js scripts/build-fpk.sh package.json tests docs/operations
git commit -m "ci: verify and attest fnOS package artifacts"
```

### Task 4: fnOS x86 与 ARM 验收（P0）

**Files:**
- Create: `docs/operations/fnos-acceptance-matrix.md`
- Create: `docs/operations/fnos-troubleshooting.md`
- Modify: `README.md`、`CHANGELOG_WORK.md`

**Interfaces:**
- Consumes: Task 3 构件；x86 和 ARM 测试机；管理员、用户 A、用户 B；非生产书库 fixture。
- Produces: 带设备、版本、哈希和复现步骤的验收报告。

- [ ] **Step 1: 准备夹具。** 包含 EPUB2、EPUB3 nav、TXT、Markdown、中文/空格路径、失效根、符号链接逃逸、坏 ZIP、超限 ZIP、长文本和图文 EPUB；禁止使用真实用户内容。

- [ ] **Step 2: 在每种架构测生命周期。** 记录 fnOS、CPU、Node、FPK 哈希、安装、开始/停止/status、Socket owner/mode、日志、升级后的 `TRIM_PKGVAR` 保留以及卸载行为。

- [ ] **Step 3: 测网关和授权。** 验证 url 入口/直接网关 URL、未登录拦截、用户 A 无法读写用户 B、非管理员 scan/diagnostics/errors 返回 403、包用户不能跨授权根访问。

- [ ] **Step 4: 测阅读矩阵。** 在 1440×900、1200×800、800×600 和移动宽度测试两种阅读模式、单列降级、TOC、快捷键、划线、导出、设置持久化、旧状态迁移、图片重测、返回书架保存和升级后缓存更新。

- [ ] **Step 5: 测资源与异常。** 对正常/大/恶意 EPUB 记录扫描时间、可用内存指标、响应、错误、进程存活与恢复。先记录基线，再讨论是否调整 ZIP 限制。

- [ ] **Step 6: 发布证据。** 报告记录 pass/fail、设备型号、OS/Node、证据位置和复现命令；原始日志/截图放 CI 或设备证据库，不进源码仓库。

### Task 5: 拆分前端单体且保持行为兼容（P1）

**Files:**
- Create: `app/ui/core/api.js`、`app/ui/core/state.js`
- Create: `app/ui/reader/epub.js`、`highlights.js`、`pagination.js`、`navigation.js`
- Create: `app/ui/shell/drawer.js`、`app/ui/library/view.js`
- Modify: `app/ui/app.js`、`app/ui/index.html`、`tests/dom-regression.test.js`、`UI_INTERFACE_MAP.md`

**Interfaces:**
- Consumes: 现有 API、状态负载、元素 ID、readerActions 和 readerPanels。
- Produces: 小于 300 行的启动文件与显式模块边界，不改变旧 DOM、端点或用户状态格式。

- [ ] **Step 1: 先补特征测试。** 锁定 API 路径、用户状态归一化、唯一 Drawer 与焦点、TOC、划线负载、分页组/窄屏、返回书架 flush 顺序。

- [ ] **Step 2: 按依赖顺序移动。** 先 API/state，再 EPUB/highlights，再 pagination/navigation，最后 Drawer/library。要求：`api.js` 只处理请求；`state.js` 导出 `applyUserState`、`currentUserSettings`、`currentServerBookState`；分页模块集中 `createPaginationGeometry`、`measurePagination`、`setPageGroup`、`navigatePageGroup`、`snapPaginationToNearestGroup`。

- [ ] **Step 3: 保持安全加载方式。** 使用同源外部脚本/模块；不增加 inline script、远程 import、eval、原生依赖、框架或打包器。

- [ ] **Step 4: 每次抽取独立验证。**

```bash
node --test tests/dom-regression.test.js
npm test
npm run check:portable
```

分页、Socket、安全或缓存相关变更还要重跑 Task 4 的相应真机用例。

- [ ] **Step 5: 以四个可运行提交落地。** 依次为 API/state、EPUB/highlights、pagination/navigation、shell/library；每一提交都通过特征测试。

### Task 6: 增加真实浏览器、无障碍与性能回归（P1）

**Files:**
- Create: `tests/e2e/reader.spec.js`、`tests/e2e/fixtures/`、`playwright.config.js`、`scripts/start-test-server.js`
- Modify: `package.json`、Task 3 CI、fnOS 验收矩阵

**Interfaces:**
- Consumes: 开发模式服务器、确定性测试书籍、稳定 ID/选择器。
- Produces: Chromium E2E、可访问性断言、性能基线和失败截图证据。

- [ ] **Step 1: 实现隔离测试服务器。** 临时配置/书库、`NODE_ENV=development`、`BABYREADER_DEV_UID=e2e-user`、动态 localhost port；轮询 `GET /api/health` 后开始，结束后关闭子进程；永不指向 NAS 或真实书库。

- [ ] **Step 2: 实现 E2E 场景。** 覆盖扫描夹具、打开 EPUB、TOC、连续进度、双页首尾、800px 降级、Drawer 焦点/Escape、划线编辑删除导出、设置持久化、ETag 更新；默认仅失败时截图。

- [ ] **Step 3: 加无障碍和性能门禁。** 检查无重复 ID、可操作项有 accessible name、禁用保留功能不发请求、焦点/键盘/减少动画正确。先记录扫描、首屏、resize 重测和大 EPUB 的基线，再由批准阈值阻断回归。

- [ ] **Step 4: CI 发布报告。** 单元/DOM 在支持 OS 上运行；Chromium E2E 在 Linux 运行并上传失败工件。

### Task 7: 以产品价值顺序交付书签、笔记、搜索（P2）

**Files:**
- Create: `docs/designs/bookmarks-search-notes.md`
- Modify: `app/server/storage.js`、`app/server/index.js`、前端 API/导航/Drawer/HTML/CSS、`UI_INTERFACE_MAP.md`
- Modify/Create: 对应服务器、DOM 与 E2E 测试

**Interfaces:**
- Consumes: UID 隔离、书籍 SHA-256、EPUB CFI/文本 locator 和 Drawer 契约。
- Produces: 可迁移的用户状态 schema 及经过授权的 API 增量。

- [ ] **Step 1: 先批准功能设计。** 明确 UX、重复处理、标签、EPUB/文本 locator、笔记 CRUD、搜索范围/索引/大小限制、迁移/回滚、导出与隐私。

- [ ] **Step 2: 先做书签。** 每 UID/book 使用 `{ id, locator, label, createdAt, updatedAt }`；新增 `GET/POST/DELETE /api/books/:id/bookmarks`，验证 ID、locator、标签长度、书籍存在；仅在跨用户测试通过后启用既有书签面板。

- [ ] **Step 3: 再做笔记。** 使用 `{ id, locator, text, createdAt, updatedAt }`，在 storage 层限制文本和集合大小，提供 list/create/update/delete；复用划线定位，不创建第二套位置模型；支持用户导出。

- [ ] **Step 4: 最后做搜索。** 首先选择一个受限模型：仅当前已打开的已清理文档，或有明确存储/资源限制的每书索引。不得扫描整台 NAS。实现 `GET /api/books/:id/search?q=` 前须定义查询长度、结果数、超时、取消、转义、授权与 CPU/内存上限；结果须在两种模式下定位到语义位置。

- [ ] **Step 5: 验证迁移和边界。** 覆盖旧 JSON、坏记录、并发写、大小限制、UID 隔离、删除、长中文查询、Unicode/标点和双模式返回。

### Task 8: AI 是隐私决策门，不是默认开发项（P2）

**Files:**
- Create: `docs/designs/ai-privacy-and-integration.md`
- No product code before approval.

**Interfaces:**
- Consumes: 明确供应商/模型、数据处理协议、同意策略、密钥存储、网络权限、速率和成本上限。
- Produces: 批准或拒绝的书面决策；批准后另起实现计划。

- [ ] **Step 1: 决定数据边界。** 书籍文本能否离开 NAS、发送多少上下文、供应商是否保留、同意/退出/删除如何呈现；默认禁止外传。

- [ ] **Step 2: 决定凭据和滥用边界。** 包级密钥存储、管理员配置、用户授权、大小/并发/超时/重试/成本限制、脱敏日志。浏览器不得获得供应商密钥。

- [ ] **Step 3: 决定输出和故障体验。** 不可信 EPUB prompt injection、输出清理、离线和供应商故障、导出/删除与 kill switch。

- [ ] **Step 4: 作出结论。** 任一隐私、密钥或支持责任未解决则保持 AI 面板禁用；获批后才为隔离后端代理、测试、观测和 kill switch 写独立计划。

## Release Gates

### 每个变更

- [ ] 范围映射到一项已批准任务/设计；不混入无关重构或生成物。
- [ ] 新行为先有失败测试，后有通过的单元/DOM/E2E 证据。
- [ ] Windows portable 检查与 Linux portable/POSIX 检查在 CI 通过。
- [ ] 安全改动覆盖未授权用户、恶意输入和边界案例。
- [ ] API、DOM 或状态改变同步更新 README、UI map、迁移说明与 changelog。

### 每个 FPK 候选

- [ ] 由固定 Node 22/fnpack CI 从 tagged commit 的 `npm ci` 构建。
- [ ] 通过嵌套归档验证，并保留 SHA-256、内层文件哈希和构建报告。
- [ ] `npm audit --omit=dev --audit-level=high` 没有未评审的 high/critical 发现。
- [ ] x86/ARM 重跑生命周期、身份、ACL、多用户、升级/缓存和核心阅读用例。
- [ ] 一并发布包版本、哈希、设备/OS/Node 证据、已知限制和回滚版本。

## 推荐执行顺序

1. 发布/维护负责人完成 Task 1 → 2 → 3；在此之前不合并新产品能力。
2. 有设备的 fnOS 负责人在 Task 3 后执行 Task 4；真机失败应回归到最小可复现。
3. 前端负责人执行 Task 5，模块边界稳定后执行 Task 6。
4. 产品负责人、后端和前端共同批准 Task 7 设计，按书签 → 笔记 → 搜索交付。
5. Task 8 由安全/产品共同决策，不能以“已有按钮”作为实现依据。

## 首次接手检查清单

- [ ] 先阅读 `README.md`、`UI_INTERFACE_MAP.md`、`CHANGELOG_WORK.md`、本文和 `docs/weread-layout-baseline.md`。
- [ ] 确认环境：Windows 本地开发不能替代 Linux/fnOS 的 Shell 与 Socket 验证。
- [ ] 首次修改前运行 `npm ci`、`npm test`、portable 结构校验并记录当前 FPK 哈希。
- [ ] 在 Task 5 前把分页 JS/CSS 视为一个耦合系统，禁止只看截图调整几何。
- [ ] 将客户端、EPUB 和路径视为不可信输入，复用安全/存储帮助函数。
- [ ] 未具备服务端契约、状态迁移、访问控制与 E2E 覆盖前，保持搜索、书签、笔记、AI 的保留入口禁用。
