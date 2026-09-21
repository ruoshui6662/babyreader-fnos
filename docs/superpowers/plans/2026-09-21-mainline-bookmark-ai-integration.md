# Mainline Bookmark and AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已验收的 EPUB 书签功能并入主线，同时保留并接通主线已有的 AI 服务、检索、流式问答和 Apple Design 风格 UI。

**Architecture:** 以主线当前工作树为整合目标，先把现有 AI/UI 改动建立安全提交，再从 `ai-chapter-retrieval-task1` 选择性移植书签提交。共享文件以主线 AI/UI 为基准，补入书签调用链；不整体合并旧 AI 提交，不修改现有阅读数据结构。

**Tech Stack:** Node.js 22、原生 `http`、原生 `fetch`、SQLite FTS5、Vanilla JavaScript、Happy DOM、Playwright Chromium、fnOS FPK。

**Spec:** `docs/superpowers/specs/2026-09-21-mainline-bookmark-ai-integration-design.md`

## Global Constraints

- 保留主线现有 AI 弹窗、设置、来源章节、多轮对话、流式输出和停止状态。
- 只移植 `ai-chapter-retrieval-task1` 的书签功能，不整体合并该分支的旧 AI 实现。
- 不使用 `git reset --hard`、`git checkout --` 或删除用户当前未提交改动。
- 不改变 AI 请求协议、API Key 存储边界、SQLite FTS 索引结构、阅读进度、划线和想法数据结构。
- 只有 EPUB 且存在有效 `currentBookId` 时启用书签。
- 书签操作失败时保留已知本地状态，并显示可恢复提示。
- API Key 不进入浏览器持久化状态、用户阅读状态或响应 JSON。
- FPK 打包前必须通过 Node、DOM、Chromium、结构检查和 `git diff --check`。

## Review Focus

- 主线未提交 AI/UI 与书签共享文件同时变化时，不能覆盖 AI 弹窗或 SSE API；由 Task 1/3 的共享文件结构测试覆盖。
- 非 EPUB、EPUB 缺少 `bookId` 或章节定位器为空时，书签按钮应禁用或安全无操作；由 Task 3 DOM 测试覆盖。
- 书签 POST/GET/DELETE 返回错误时，列表和激活状态不能被错误清空；由 Task 2/3 失败回滚测试覆盖。
- AI 流式回答过程中打开书签 Drawer 或切换章节时，不能破坏 AI 请求和阅读布局；由 Task 4 AI/Drawer 回归测试覆盖。
- 单页、双页、连续滚动和移动端定位必须使用同一语义定位器；由 Task 4 Playwright 测试覆盖。

---

### Task 1: 固化主线 AI/UI 基线并建立整合安全点

**Files:**
- Modify: `app/server/index.js`, `app/server/storage.js`, `app/ui/core/api.js`, `app/ui/index.html`, `app/ui/reader/ai.js`, `app/ui/shell/drawer.js`, `app/ui/styles.css`
- Test: `tests/reader-core.test.js`, `tests/dom-regression.test.js`, `tests/structure-validation.test.js`
- Update: `docs/superpowers/progress/2026-09-20-reader-annotations-progress.md`

**Interfaces:**
- Consumes: 当前主线未提交的 AI 配置、AI 检索、SSE 和弹窗 UI。
- Produces: 一个可回滚的主线安全提交；AI 现有功能的基线测试结果。

- [ ] **Step 1: 检查主线状态并记录改动边界**

运行 `git status --short --branch`、`git diff --check` 和 `git diff --stat`。Expected: 只看到已知的 AI、阅读器 UI、测试和文档改动；没有自动删除或重置操作。

- [ ] **Step 2: 运行主线基线测试**

运行 `npm test`、`npm run check` 和 `npm run test:e2e -- --project=chromium --workers=1 --grep "AI|ai|stream|Drawer|reader"`。Expected: AI 弹窗、流式输出、阅读模式和现有 Drawer 用例通过；若有失败，先记录并停止整合，不把书签冲突混入基线问题。

- [ ] **Step 3: 固化当前主线已有功能**

确认基线通过后执行 `git add app docs e2e tests scripts` 和 `git commit -m "feat: preserve existing ai reader integration"`。Expected: 只提交当前主线已有工作，不包含书签分支文件。

- [ ] **Step 4: 记录安全点和基线结果**

运行 `git log -1 --oneline` 和 `git status --short --branch`，并将测试命令和结果写入进度文档。Expected: 可以用该提交恢复主线 AI/UI 状态。

### Task 2: 合并书签服务端存储和 API

**Files:**
- Modify: `app/server/storage.js`
- Modify: `app/server/index.js`
- Test: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: `UserStorage` 当前用户状态和主线 AI 路由。
- Produces: `listBookmarks(uid, bookId)`、`addBookmark(uid, bookId, input)`、`deleteBookmark(uid, bookId, bookmarkId)`；API 路径为 `GET/POST/DELETE /api/books/:bookId/bookmarks`。

- [ ] **Step 1: 移植书签存储测试并确认 RED**

将书签分支的存储场景引入主线：空列表、幂等新增、按 ID 删除、定位器/标签/数量限制、用户和书籍隔离、并发写入完整性。运行 `node --test tests/reader-core.test.js --test-name-pattern="bookmarks"`。Expected: 在未移植存储实现的主线上失败，失败原因指向书签方法或字段不存在。

- [ ] **Step 2: 移植最小存储实现**

将书签定位器限制为 `version=2`、`type=semantic-position`、`readingScope=page|chapter`、安全相对 `href`，并要求 `anchor`、`textBefore`、`pageNumber` 至少一个有效。书签按 `uid` 和 64 位小写 `bookId` 隔离，重复定位返回已有记录。

- [ ] **Step 3: 移植 API 路由并保留 AI 路由顺序**

在 `app/server/index.js` 的 highlights 路由附近增加 `GET /api/books/:bookId/bookmarks`、`POST /api/books/:bookId/bookmarks` 和 `DELETE /api/books/:bookId/bookmarks/:bookmarkId`。路由继续调用现有 `findBook()` 和认证用户解析，不能绕过用户隔离；AI `/ai/search`、`/ai/ask`、`/ai/ask/stream` 路由保持原路径和响应结构。

- [ ] **Step 4: 运行服务端书签测试并提交**

运行 `node --test tests/reader-core.test.js --test-name-pattern="bookmarks|server exposes"` 和 `git diff --check`。确认通过后执行 `git add app/server/index.js app/server/storage.js tests/reader-core.test.js`、`git commit -m "feat: add user-scoped bookmark api"`。Expected: 书签存储和 API 测试通过，AI 相关服务端测试仍通过。

### Task 3: 合并书签前端模块和共享 UI

**Files:**
- Create: `app/ui/reader/bookmarks.js`
- Modify: `app/ui/core/api.js`, `app/ui/index.html`, `app/ui/reader/highlights.js`, `app/ui/shell/drawer.js`, `app/ui/styles.css`, `app/ui/core/user-state.js`
- Test: `tests/dom-regression.test.js`, `tests/structure-validation.test.js`

**Interfaces:**
- Consumes: Task 2 的书签 API；主线已有 `currentReadingLocator(reader)`、`restoreReadingLocator(locator)`、`navigateToEpubChapter()` 和 AI modal。
- Produces: `getCurrentBookmarkLocator()`、`isCurrentBookmark()`、`toggleCurrentBookmark()`、`jumpToBookmark(bookmark)`、`refreshBookmarks()`、书签 Drawer 和移动端入口。

- [ ] **Step 1: 移植书签 DOM 测试并确认 RED**

引入定位器捕获、书签新增/删除、EPUB 条件启用、失败回滚、Drawer 刷新和移动端入口测试。运行 `node --test tests/dom-regression.test.js --test-name-pattern="bookmark"`。Expected: 主线未加载书签模块时失败，失败集中在脚本、DOM 入口或导出的书签函数缺失。

- [ ] **Step 2: 添加书签脚本、Drawer 面板和移动端入口**

保留主线 AI modal 的 DOM 与脚本顺序，在 `index.html` 增加 `reader/bookmarks.js` 和书签列表节点；在 `drawer.js` 中增加 `bookmarks` panel，不能把 AI 重新放回 Drawer。书签工具栏按钮使用 `data-reader-action="toggleBookmark"`，AI 继续使用 `openAiModal`。

- [ ] **Step 3: 接入 API 与定位状态**

在 `core/api.js` 增加 `browserHost.getBookmarks(bookId = state.currentBookId) -> Promise<Bookmark[]>`、`browserHost.createBookmark(bookmark, bookId = state.currentBookId) -> Promise<Bookmark>` 和 `browserHost.deleteBookmark(bookmarkId, bookId = state.currentBookId) -> Promise<{ deleted: boolean, id: string }>`。`highlights.js` 仅在 `state.contentType === 'epub' && state.currentBookId` 时启用书签按钮；其他格式保持禁用，不影响 AI 按钮的 EPUB 判断。

- [ ] **Step 4: 合并加载、失败恢复、激活态和触摸入口**

打开书签面板时刷新服务端列表并显示 loading；失败时保留已有列表并显示可恢复错误；新增/删除失败时恢复原按钮和列表状态。列表点击调用现有章节导航和定位恢复，不新增第二套阅读定位算法。

- [ ] **Step 5: 运行 DOM/结构测试并提交**

运行 `node --test tests/dom-regression.test.js --test-name-pattern="bookmark|AI|Drawer"`、`npm run check` 和 `git diff --check`。确认通过后执行 `git add app/ui tests/dom-regression.test.js`、`git commit -m "feat: integrate bookmark reader ui"`。Expected: 书签 DOM、AI modal、Drawer 和现有阅读器结构测试全部通过。

### Task 4: 联合回归与 AI/书签交互验收

**Files:**
- Create/Modify: `e2e/bookmarks.spec.js`, `e2e/helpers/reader.js`, `e2e/reader.spec.js`, `tests/dom-regression.test.js`
- Modify: `docs/superpowers/progress/2026-09-20-reader-annotations-progress.md`

**Interfaces:**
- Consumes: Task 2/3 的服务端与前端接口。
- Produces: 书签、AI、Drawer、单页/双页/连续滚动和移动端的联合验收证据。

- [ ] **Step 1: 增加 Chromium 书签验收**

覆盖书签新增、重复点击取消、列表刷新、删除一条保留另一条、跨章节定位、单页/双页/连续滚动、键盘 Tab、移动端 44px 触摸目标。运行 `npx playwright test e2e/bookmarks.spec.js --project=chromium --workers=1`。Expected: 书签专项全部通过。

- [ ] **Step 2: 增加 AI 与 Drawer 共存回归**

覆盖 AI 流式输出期间打开书签 Drawer、关闭 Drawer 后 AI modal/浮窗仍存在、AI 来源章节仍显示、普通 Enter 发送和停止状态不被书签入口破坏。运行 `npx playwright test e2e/reader.spec.js --project=chromium --workers=1 --grep "AI|ai|stream|bookmark|Drawer"`。Expected: AI 和书签联合场景通过。

- [ ] **Step 3: 运行全量回归并记录结果**

运行 `npm test`、`npm run test:e2e -- --project=chromium --workers=1`、`npm run check:portable` 和 `git diff --check`。Expected: 无新增失败；平台相关跳过项必须有明确原因并记录到进度文档。

- [ ] **Step 4: 提交联合回归证据**

执行 `git add e2e tests docs/superpowers/progress/2026-09-20-reader-annotations-progress.md` 和 `git commit -m "test: verify bookmark and ai mainline integration"`。

### Task 5: FPK 打包、包内容核对和 fnOS 真机验收

**Files:**
- Modify: `manifest`, `package.json`, `package-lock.json` only if release version needs updating
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`, `docs/superpowers/progress/2026-09-20-reader-annotations-progress.md`
- Generate: `dist/babyreader-fnos.fpk`, `dist/build-provenance.json`

**Interfaces:**
- Consumes: Task 4 的绿色测试和主线整合提交。
- Produces: 同时包含 AI、书签和既有 UI 的可追溯 FPK，以及 fnOS 验收报告。

- [ ] **Step 1: 构建并检查 FPK**

运行 `npm run build:fpk` 和 `node scripts/verify-fpk.js`。Expected: 包含 `ui/reader/ai.js`、`ui/reader/bookmarks.js`、AI modal HTML/CSS、书签 API 服务端文件和设备验收脚本；manifest 与源码版本一致。

- [ ] **Step 2: 核对构建溯源和哈希**

运行 `Get-FileHash dist/babyreader-fnos.fpk -Algorithm SHA256`、`Get-Content dist/build-provenance.json` 和 `git status --short`。Expected: provenance 中的源提交、manifest 版本和外层 FPK 哈希一致，构建产物不覆盖用户数据目录。

- [ ] **Step 3: 执行 fnOS 真机验收**

在设备执行 `sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check | tee /tmp/acceptance-ai-bookmark.txt`。Expected: 生命周期、Socket、健康检查、SQLite FTS 和索引权限通过；随后在 EPUB 中手动验证书签新增/删除/定位，以及 AI 配置、问答、流式停止和原有阅读模式。

- [ ] **Step 4: 记录发布结果**

执行 `git add dist docs/FNOS_DEVICE_ACCEPTANCE.md docs/superpowers/progress/2026-09-20-reader-annotations-progress.md` 和 `git commit -m "release: package integrated ai and bookmarks"`。Expected: 进度文档记录 FPK 路径、SHA-256、测试数量和真机验收报告位置；设备验收完成后提醒移除临时设备验收入口。
