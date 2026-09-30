# fnOS Authorized Library Roots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 BabyReader 使用 fnOS 应用权限中授权的自定义目录，并在安全边界内通过重新扫描发现其中的 EPUB、Markdown 和 TXT。

**Architecture:** 保留现有 `settings.json.libraryRoots`、`TRIM_DATA_ACCESSIBLE_PATHS` 和 `TRIM_DATA_SHARE_PATHS` 三类来源，但把根目录解析、realpath、权限检查、去重和诊断抽到独立模块。扫描器只接收解析后的授权根目录；前端只负责重新扫描和状态反馈，不建立第二套路径授权机制。

**Tech Stack:** Node.js 22 CommonJS、内置 `fs/promises`、内置 HTTP 服务、Node test runner、fnOS Native FPK、POSIX shell。

**Spec:** `docs/superpowers/specs/2026-09-22-fnos-authorized-library-roots-design.md`

## 当前进度（2026-09-22）

- Task 0–5 的代码、测试、验收脚本和 FPK 本地发布准备已完成。
- fnOS 真机反馈：自定义目录扫描正常；删除流程正常。该结果已作为真机回归证据记录，不改变既有书籍、用户数据和 AI 索引安全边界。
- 仍待补齐的不是本次功能阻塞项：x86_64/ARM64 双架构完整矩阵、Gateway 多用户、升级持久化和撤销权限后的完整报告，需要继续在对应设备上留存验收日志。

## Global Constraints

- 保持 `manifest` 中 `disable_authorization_path=false`，让 fnOS 提供授权目录设置。
- 用户授权目录只来自 fnOS 提供的 `TRIM_DATA_ACCESSIBLE_PATHS`；共享目录只来自 `TRIM_DATA_SHARE_PATHS`。
- `settings.json.libraryRoots` 继续兼容，但不能绕过 realpath、目录权限和授权根边界检查。
- 服务继续以 `run-as=package` 运行，不添加 root 权限或新的系统用户组。
- 只支持 EPUB、Markdown、Markdown 扩展名和 TXT；不扩大格式范围。
- 不修改书籍 ID、阅读进度、书签、标注、AI 会话和 AI 索引数据格式。
- 不扫描整个 NAS，不实现文件监听，不把用户路径直接交给文件系统 API。
- 所有普通用户响应不得泄露服务器绝对路径；管理员诊断接口才可显示受保护的路径诊断。

## Review Focus

- fnOS 权限变更后环境变量是否只在服务重启后更新；测试归 Task 0 和 Task 4。
- 含空格、中文、冒号分隔和重复项的路径列表；测试归 Task 1。
- 父目录与子目录同时授权时是否重复扫描；测试归 Task 1 和 Task 2。
- 目录被撤销、不可遍历或包含越权符号链接时是否 fail closed；测试归 Task 2 和 Task 5。
- 自定义目录加入后既有书籍、用户状态、AI 功能是否保持不变；测试归 Task 3 和 Task 5。

---

### Task 0: fnOS 权限注入与生命周期基线 ✅ 已完成

**Files:**
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `scripts/fnos-device-acceptance.sh`
- Test: `tests/device-profile.test.js`
- Test: `tests/fnos-lifecycle.test.js`

**Interfaces:**
- Consumes: 当前 `manifest`、`config/resource`、`cmd/main` 和 `/api/diagnostics`。
- Produces: 一份可重复的真机检查步骤，确认 `TRIM_DATA_ACCESSIBLE_PATHS` 的来源、服务重启行为和包用户 ACL。

- [ ] **Step 1: 写入真机基线步骤**

在 `docs/FNOS_DEVICE_ACCEPTANCE.md` 增加“自定义授权书库目录”小节，明确记录：添加目录、重启应用、查看管理员诊断、重新扫描、验证书籍、撤销目录、再次扫描。

- [ ] **Step 2: 增加生命周期静态断言**

在 `tests/fnos-lifecycle.test.js` 中断言 `cmd/main` 不会清空或覆盖 `TRIM_DATA_ACCESSIBLE_PATHS`、`TRIM_DATA_SHARE_PATHS`，并继续使用 `TRIM_APPDEST`、`TRIM_PKGETC`、`TRIM_PKGVAR` 和 `TRIM_PKGTMP`。

- [ ] **Step 3: 运行基线测试**

运行：

```text
npm test -- tests/device-profile.test.js tests/fnos-lifecycle.test.js
npm run check
```

预期：当前默认目录、生命周期和 FPK 结构验证全部通过。

- [ ] **Step 4: 提交基线文档和测试**

```text
git add docs/FNOS_DEVICE_ACCEPTANCE.md scripts/fnos-device-acceptance.sh tests/device-profile.test.js tests/fnos-lifecycle.test.js
git commit -m "test: define fnOS custom library authorization baseline"
```

### Task 1: 建立授权书库根目录解析模块 ✅ 已完成

**Files:**
- Create: `app/server/library-roots.js`
- Create: `tests/library-roots.test.js`
- Modify: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: `configuredRoots`, `TRIM_DATA_ACCESSIBLE_PATHS`、`TRIM_DATA_SHARE_PATHS` 的字符串列表。
- Produces: `parsePathList(value) -> string[]`、`collectRootCandidates(input) -> RootCandidates`、`resolveLibraryRoots(input) -> Promise<RootDiagnostics>`。

返回值固定为：

```js
{
  configuredRoots: string[],
  accessibleRoots: string[],
  sharedRoots: string[],
  authorizedRoots: string[],
  rejectedRoots: Array<{ root: string, error: string, code: string|null }>
}
```

- [ ] **Step 1: 写失败测试**

在 `tests/library-roots.test.js` 覆盖：

```js
assert.deepEqual(parsePathList(' /vol1/中文 目录 :/vol2/books '), ['/vol1/中文 目录', '/vol2/books']);
assert.deepEqual(parsePathList(''), []);
assert.deepEqual(collectRootCandidates({
  configuredRoots: ['/one'],
  accessibleRoots: ['/two'],
  sharedRoots: ['/three']
}), [
  { root: '/one', source: 'configured' },
  { root: '/two', source: 'accessible' },
  { root: '/three', source: 'shared' }
]);
```

- [ ] **Step 2: 运行测试确认失败**

运行：

```text
node --test tests/library-roots.test.js
```

预期：因 `app/server/library-roots.js` 尚不存在而失败。

- [ ] **Step 3: 实现最小根目录解析器**

实现以下边界：

```js
function parsePathList(value) {}
function collectRootCandidates({ configuredRoots = [], accessibleRoots = [], sharedRoots = [] } = {}) {}
async function resolveLibraryRoots({ configuredRoots, accessibleRoots, sharedRoots, fsImpl = fs } = {}) {}
```

每个候选目录必须依次执行 `realpath`、`stat`、`isDirectory()` 和 `access()`；失败项只进入 `rejectedRoots`，不能进入 `authorizedRoots`。对真实路径进行稳定去重，并删除被已授权父目录完全包含的子目录。

- [ ] **Step 4: 增加异常输入测试并验证通过**

覆盖不存在目录、普通文件、重复 realpath、父子根目录、中文路径、空格路径和空环境变量；运行：

```text
node --test tests/library-roots.test.js tests/reader-core.test.js
```

预期：PASS，且现有多根扫描测试保持通过。

- [ ] **Step 5: 提交模块**

```text
git add app/server/library-roots.js tests/library-roots.test.js tests/reader-core.test.js
git commit -m "feat: resolve fnOS authorized library roots"
```

### Task 2: 接入服务配置、扫描和诊断 ✅ 已完成

**Files:**
- Modify: `app/server/index.js:291-334`
- Modify: `app/server/library.js`
- Test: `tests/reader-core.test.js`
- Test: `tests/search-api.test.js`
- Test: `tests/ai-index-api.test.js`

**Interfaces:**
- Consumes: `resolveLibraryRoots()` 的 `RootDiagnostics`。
- Produces: `loadConfiguration()` 每次调用都从当前进程环境重新计算 `authorizedRoots`；`runLibraryScan()` 继续使用最新授权根目录；管理员诊断增加来源计数和被拒绝项摘要。

- [ ] **Step 1: 写服务集成失败测试**

启动临时 HTTP 服务，设置：

```text
TRIM_DATA_ACCESSIBLE_PATHS=<temporary custom root>
TRIM_DATA_SHARE_PATHS=<temporary shared root>
```

向自定义根目录写入一个 TXT 文件，调用 `POST /api/library/scan`，断言返回书籍标题；再清除自定义根目录环境并重新加载配置，断言该根目录进入 `rejectedRoots` 或不再成为 `authorizedRoots`。

- [ ] **Step 2: 运行测试确认失败**

运行：

```text
node --test tests/reader-core.test.js tests/search-api.test.js tests/ai-index-api.test.js
```

预期：新集成场景失败，现有场景不因测试夹具改变而失败。

- [ ] **Step 3: 替换服务内重复解析逻辑**

在 `app/server/index.js` 引入 `resolveLibraryRoots()`，让 `loadConfiguration()` 只负责读取 `settings.json`、读取两个 fnOS 环境变量并保存返回的诊断结果；不得在 `index.js` 中继续维护第二套路径规范化逻辑。

- [ ] **Step 4: 保持扫描器输入边界**

让 `scanLibrary()` 继续只接收 `authorizedRoots`。重叠根目录在解析层裁剪；扫描器仍对每个文件调用既有 `resolveAuthorizedPath()`，不降低符号链接、realpath 或文件大小限制。

- [ ] **Step 5: 增加诊断字段并验证无路径泄露**

管理员诊断新增 `rootCounts`：

```js
{
  configured: number,
  accessible: number,
  shared: number,
  authorized: number,
  rejected: number
}
```

普通 `/api/library` 响应不新增绝对路径字段；管理员 `/api/diagnostics` 可继续按现有权限返回受保护的根目录诊断。

- [ ] **Step 6: 运行服务回归测试**

运行：

```text
npm test
npm run check
```

预期：所有现有测试通过，授权自定义目录集成测试通过。

- [ ] **Step 7: 提交服务接入**

```text
git add app/server/index.js app/server/library.js tests/reader-core.test.js tests/search-api.test.js tests/ai-index-api.test.js
git commit -m "feat: scan fnOS authorized library roots"
```

### Task 3: 完善书库刷新反馈 ✅ 已完成

**Files:**
- Modify: `app/ui/library/view.js:56-70`
- Modify: `app/ui/core/api.js:101-107`
- Modify: `app/ui/styles.css`
- Test: `tests/dom-regression.test.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: 现有 `browserHost.scanLibrary()` 返回的 `scan` 结果和错误信息。
- Produces: 重新扫描时的无路径泄露状态提示、成功/失败计数和权限变更提示。

- [ ] **Step 1: 写 UI 回归断言**

断言书库仍包含“重新扫描”按钮，点击后显示扫描中状态；失败后按钮恢复可点击；提示文案不包含 `root`、`path` 或服务器绝对路径。

- [ ] **Step 2: 实现状态反馈**

在 `renderLibrary()` 的扫描回调中使用：

```js
scanButton.disabled = true;
scanButton.textContent = '正在读取授权目录…';
```

扫描成功后根据 `scan.discoveredCount`、`scan.indexedCount`、`scan.reusedCount` 和 `scan.errorCount` 生成简洁状态；扫描失败时提示“请检查 fnOS 应用权限并重启应用后重试”。

- [ ] **Step 3: 验证前端回归**

运行：

```text
node --test tests/dom-regression.test.js tests/reader-core.test.js
npm run test:e2e
```

预期：书库刷新、阅读页、AI、书签、标注和设置 surface 全部保持可用。

- [ ] **Step 4: 提交 UI 反馈**

```text
git add app/ui/library/view.js app/ui/core/api.js app/ui/styles.css tests/dom-regression.test.js tests/reader-core.test.js
git commit -m "feat: explain authorized library refresh state"
```

### Task 4: 生命周期与权限变更验收 ✅ 已完成

**Files:**
- Modify: `cmd/main`
- Modify: `tests/fnos-lifecycle.test.js`
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `scripts/fnos-device-acceptance.sh`

**Interfaces:**
- Consumes: fnOS 运行时环境和 `/api/diagnostics`。
- Produces: 权限变更后服务重启、扫描刷新和权限撤销的验收步骤。

- [ ] **Step 1: 明确启动环境传递**

在 `cmd/main` 的 Node 进程启动环境中显式保留：

```sh
TRIM_DATA_ACCESSIBLE_PATHS="${TRIM_DATA_ACCESSIBLE_PATHS:-}" \
TRIM_DATA_SHARE_PATHS="${TRIM_DATA_SHARE_PATHS:-}" \
```

如果真机确认 fnOS 已通过继承环境提供变量，该改动仍只作为显式契约，不改变现有路径值。

- [ ] **Step 2: 加生命周期静态测试**

断言自定义路径变量以双引号传递，且 `cmd/main` 没有切换到 root 或覆盖用户授权路径。

- [ ] **Step 3: 扩展验收脚本**

增加管理员诊断检查和脱敏根目录计数；不把 API Key、Cookie、书籍正文或普通用户路径写入验收输出。

- [ ] **Step 4: 更新真机验收步骤**

记录以下实际操作：

```text
1. 在 fnOS 应用限制 → 访问权限添加目录 A。
2. 重启 BabyReader 应用。
3. 打开管理员诊断，确认 accessible/authorized 数量变化。
4. 点击重新扫描，确认 A 中书籍出现。
5. 撤销 A 权限并重启应用。
6. 再次扫描，确认 A 不再被读取且诊断报告拒绝或不可用。
```

- [ ] **Step 5: 提交生命周期变更**

```text
git add cmd/main tests/fnos-lifecycle.test.js docs/FNOS_DEVICE_ACCEPTANCE.md scripts/fnos-device-acceptance.sh
git commit -m "test: verify fnOS authorization refresh lifecycle"
```

### Task 5: 全量安全回归与 FPK 发布验收 ✅ 本地完成，真机部分持续回填

**Files:**
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `CHANGELOG_WORK.md`
- Test: `tests/library-roots.test.js`
- Test: `tests/security.test.js`
- Test: `tests/reader-core.test.js`
- Test: `tests/dom-regression.test.js`

**Interfaces:**
- Consumes: Tasks 0–4 的根目录解析、扫描、诊断和 UI 状态。
- Produces: 可安装的 FPK、构建溯源和 fnOS 真机验收记录。

- [ ] **Step 1: 运行单元和结构回归**

运行：

```text
npm test
npm run check
npm run check:portable
git diff --check
```

预期：全部通过，且无未声明的新依赖。

- [ ] **Step 2: 运行浏览器回归**

运行：

```text
npm run test:e2e
```

预期：书库刷新、阅读、搜索、AI、书签、标注、主题和移动端 surface 无回归。

- [ ] **Step 3: 构建 FPK 并校验溯源**

运行：

```text
npm run build:fpk
Get-FileHash dist/babyreader-fnos.fpk -Algorithm SHA256
Get-Content dist/build-provenance.json
```

预期：FPK 中包含更新后的 `manifest`、`config`、`cmd`、服务端和前端文件；`git_dirty=false`；构建版本与 manifest 一致。

- [ ] **Step 4: fnOS 真机安装验证**

安装 FPK 后完成 Task 4 的目录授权、重启、诊断、重新扫描、撤销权限和再次扫描流程；额外确认自定义目录中的书籍可以打开、全文搜索和 AI 问答。

- [ ] **Step 5: 记录发布结果**

在 `docs/FNOS_DEVICE_ACCEPTANCE.md` 记录 CPU、fnOS 版本、FPK SHA-256、权限目录测试结果和失败恢复结果；更新 `CHANGELOG_WORK.md`，不记录真实 NAS 用户名、Cookie、API Key 或书籍正文。

- [ ] **Step 6: 提交发布记录**

```text
git add docs/FNOS_DEVICE_ACCEPTANCE.md CHANGELOG_WORK.md tests/library-roots.test.js tests/security.test.js tests/reader-core.test.js tests/dom-regression.test.js
git commit -m "test: complete fnOS authorized library release verification"
```

## 计划自审结果

- 规格中的平台授权、根目录解析、扫描刷新、安全边界、UI 反馈和真机验收均有对应任务。
- 计划没有引入应用内路径选择器、root 权限、文件监听器或数据库变更。
- 所有跨任务接口均在 Task 1 中定义，并在后续任务中复用 `RootDiagnostics` 和 `authorizedRoots`。
- 五类高风险输入均有明确测试归属：环境变量生命周期、特殊路径、重叠根目录、权限撤销/符号链接和既有用户数据回归。
- 当前结论：自定义目录扫描与删除已通过用户实机验证；下一次真机回归重点是撤销授权后重启、重新扫描不得读取，以及确认全文搜索、AI 问答、书签、标注和阅读进度不受影响。
