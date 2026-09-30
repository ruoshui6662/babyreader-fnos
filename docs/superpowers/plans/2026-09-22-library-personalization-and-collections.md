# Library Personalization and Collections Implementation Plan

> **Status: DRAFT — requires explicit user approval before any implementation.** This document is a planning artifact only; no task below is authorized by its presence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变书籍源文件、fnOS 授权边界或现有阅读功能的前提下，为每个用户提供虚拟分类、受控书籍排序、分类内浏览与按授权源目录的只读浏览模式。

**Architecture:** 保持全局扫描目录 `index/library.json` 作为只读书目事实来源。新增按 fnOS 用户隔离的 `library-organization.json` 保存分类、展示偏好、归属和顺序；服务端 resolver 将它与当前健康书目合并。前端在独立的书库组织控制器内渲染平铺、我的分类和源目录三种互斥视图；阅读入口继续使用现有 `openBook(book)`。

**Tech Stack:** Node.js 22 CommonJS、`fs/promises`、内置 HTTP 服务、Vanilla JavaScript/CSS、Node test runner、Happy DOM、Playwright Chromium、fnOS Native FPK。

**Spec:** `docs/superpowers/specs/2026-09-22-library-personalization-and-collections-design.md`

## Global Constraints

- 此计划默认**不执行**，直至用户在后续任务明确批准。
- 不修改或移动原始 EPUB、Markdown、TXT；不提供源文件删除/移动 API。
- 不改变 `GET /api/library` 与 `POST /api/library/scan` 的既有响应/调用路径；新增字段必须向后兼容。
- 不把分类、排序、UID、浏览器 state 写入全局 `library.json`。
- 不暴露绝对路径、扫描根、书籍正文、用户 ID、API Key 或内部 JSON 文件路径。
- 继续复用现有 `normalizeUserId()`、`writeJsonAtomic()`、`resolveAuthorizedPath()`、`findBook()` 与 gateway 用户认证；不可绕过 fnOS 授权。
- 不新增数据库、第三方依赖、后台文件监听、root 权限或应用内文件系统选择器。
- 第一版只做单层手工分类、一书一主分类；多标签、嵌套分类、共享分类、AI 分类和真实文件整理另立规格。
- 任何组织服务故障必须让书库退回现有平铺列表，且保持打开书籍、重新扫描和阅读恢复正常。

## Review Focus

- “我的分类”是否是每用户虚拟状态，而非扫描器或 NAS 目录状态。
- 多授权根、中文/空格路径、重复根和嵌套源目录是否不泄露绝对路径。
- 文件被移动或扫描失败时，用户分类是否不会被静默清空。
- 拖拽是否仅在显式整理模式中启用，且键盘/触摸均有等价操作。
- 打开书、返回书库、刷新 URL、AI、书签、标注、全文搜索和用户设置是否均保持既有契约。

---

### Task 0: 冻结当前书库契约与 feature flag 基线 ✅ 已完成

**Files:**
- Create: `docs/superpowers/progress/2026-09-22-library-personalization-progress.md`
- Modify: `tests/dom-regression.test.js`
- Modify: `e2e/reader.spec.js`
- Modify: `app/server/index.js`
- Modify: `app/ui/library/view.js`

**Interfaces:**
- Consumes: 当前 `GET /api/library`、`renderLibrary(library)`、`browserHost.openBook(book)` 与 `?book=<bookId>` 恢复逻辑。
- Produces: 禁用默认的 `libraryOrganization` feature flag、基线测试和可回滚开关。

- [x] **Step 1: 写当前扁平书库回归测试**

断言 feature flag 关闭时：现有 summary、扫描按钮、网格、书籍 click、无封面占位、浏览器刷新恢复、移动端两列规则都不改变；`/api/library` 响应不含 `path`/`root`。

- [x] **Step 2: 建立服务端 feature flag**

只从受控运行时配置读取布尔开关，缺省为 `false`。不得把用户 URL、localStorage 或未经认证的请求作为开关来源。

- [x] **Step 3: 在前端建立安全回退**

flag 关闭或组织数据获取失败时调用现有 `renderLibrary(library)` 平铺路径；不得阻断 scan 或 `openBook`。

- [x] **Step 4: 运行基线回归**

```text
npm test
npm run check
npm run test:e2e
```

预期：所有现有书库与阅读场景通过；开关关闭时 DOM/HTTP 结构无回归。

### Task 1: 新增每用户书库组织存储与规范化 resolver ✅ 已完成

**Files:**
- Create: `app/server/library-organization.js`
- Create: `tests/library-organization.test.js`
- Modify: `app/server/storage.js`
- Modify: `tests/reader-core.test.js`

**Interfaces:**
- Consumes: `dataRoot`、`normalizeUserId()`、`writeJsonAtomic()` 和健康 `libraryIndex.books`。
- Produces: `getLibraryOrganization(uid)`、`mutateLibraryOrganization(uid, expectedRevision, mutation)`、`resolveLibraryOrganization(indexBooks, organization)`。

- [x] **Step 1: 先编写失败测试**

覆盖空状态、合法/非法 collection ID、名称限制、重复名、最大分类数、单书单分类、顺序去重、无效 bookId、文件权限、原子写入和两个 UID 完全隔离。

- [x] **Step 2: 实现只包含组织状态的 JSON 文件**

路径固定为 `users/<normalized-uid>/library-organization.json`。创建目录 `0700`、文件 `0600`；读写时验证 schema version、大小和字段类型，损坏文件返回专用脱敏错误，不覆盖原文件。

- [x] **Step 3: 实现确定性的 resolver**

resolver 从当前书目中移除不存在/错误 bookId，保留其为 orphan 统计；将新书稳定追加到未分类；不在读取阶段写回任何文件。分类与顺序均不得影响 `library.json`。

- [x] **Step 4: 验证并发与扫描变动**

同一用户并发 mutation 必须序列化；不同用户可并行。书籍移动、被删除和扫描失败时，虚拟分类不丢失，且可恢复。

- [x] **Step 5: 运行聚焦测试**

```text
node --test tests/library-organization.test.js tests/reader-core.test.js tests/security.test.js
```

### Task 2: 增加安全、冲突可见的组织 API

**Files:**
- Modify: `app/server/index.js`
- Create: `tests/library-organization-api.test.js`
- Modify: `app/ui/core/api.js`
- Modify: `tests/dom-regression.test.js`

**Interfaces:**
- Consumes: Task 1 存储/resolver、gateway user、当前健康书目。
- Produces: 组织读取、分类 CRUD、放置和排序 API；所有 mutation 使用 revision。reconciliation 明确延后 Task 6。

- [x] **Step 1: 编写 HTTP 合约失败测试**

覆盖未认证 `401`、无效 ID `400`、不存在书籍 `404`、过期 revision `409`、跨用户不可读、名称/XSS 输入无害化、响应无路径/正文/UID 泄漏。

- [x] **Step 2: 实现只接受受限动作的 API**

实现规格中的六个 endpoint；请求体不得接受文件路径或完整未校验状态。每次 mutation 均先取得 gateway user、验证书籍仍在当前健康书目、验证 revision，再调用 Task 1 原子 mutation。

- [x] **Step 3: 保持旧 API 不变**

`GET /api/library` 仍只返回扫描书目；不在该响应里注入 user organization，避免缓存/权限语义变化。`browserHost.getLibrary()` 与 `scanLibrary()` 保持可用。

- [x] **Step 4: 实现最小前端 API 适配器**

增加 `getLibraryOrganization()` 与受限 mutation 方法；不在这里渲染 UI，不缓存绝对路径，不吞掉 `409`。

- [x] **Step 5: 运行 API 回归**

```text
node --test tests/library-organization-api.test.js tests/search-api.test.js tests/ai-index-api.test.js tests/ai-conversation-api.test.js
```

> Task 2 实际交付六个非破坏性 endpoint；`reconcile` 明确保留给 Task 6 的 dry-run/确认/fail-closed 流程，不在本阶段开放。

### Task 3: 书库组织视图、分类导航与焦点恢复

**Files:**
- Create: `app/ui/library/organization.js`
- Modify: `app/ui/library/view.js`
- Modify: `app/ui/app.js`
- Modify: `app/ui/reader/lifecycle.js`
- Modify: `app/ui/styles.css`
- Modify: `app/ui/index.html`
- Modify: `tests/dom-regression.test.js`
- Modify: `e2e/reader.spec.js`

**Interfaces:**
- Consumes: 平铺 `renderLibrary(library)`、Task 2 组织 view model、现有 book card/open handler。
- Produces: `flat`/`collections` 两种视图、分类详情、`未分类`、返回书库、可恢复的 library route state。

- [x] **Step 1: 编写 DOM/E2E 失败测试**

测试切换模式、新建分类、进入分类后只显示成员、返回后恢复先前视图和焦点、删除分类后书回到未分类、打开 EPUB/TXT/Markdown 后现有阅读 URL 行为不变。

- [x] **Step 2: 提取书籍卡渲染而不改变阅读入口**

将现有书籍 card 的 DOM 创建提取为纯 helper；唯一打开路径仍是 `browserHost.openBook(book)`。避免复制 click handler 导致重复打开/状态竞态。

- [x] **Step 3: 实现单层分类导航**

书库顶部显示当前层级与“返回书库”。分类详情只显示分类成员；分类首页显示 `未分类`。此任务不实现嵌套分类。

- [x] **Step 4: 使用受限 history state**

仅保存类似 `{ libraryMode, collectionId }` 的前端视图状态，验证 collectionId 格式；绝不将路径、文件名正文或服务端数据写入 URL。浏览器 Back 先在库内导航，再按既有规则返回阅读状态。

- [x] **Step 5: 做深浅色/移动端视觉回归**

沿用现有 Library tokens 和 Apple 风格紧凑分层；所有按钮具有命名、focus-visible 和 44px 触控目标。不得影响 reader sheet、AI modal 与 toolbar 的 surface 样式。

### Task 4: 整理模式、拖拽排序和键盘等价操作

**Files:**
- Create: `app/ui/library/reorder.js`
- Modify: `app/ui/library/organization.js`
- Modify: `app/ui/styles.css`
- Modify: `tests/dom-regression.test.js`
- Modify: `e2e/reader.spec.js`

**Interfaces:**
- Consumes: Task 2 revision-aware order API、Task 3 book card shell、Pointer Events。
- Produces: 仅在整理模式可用的分类/书籍重排、取消/失败回滚、键盘移动菜单和可访问性公告。

- [x] **Step 1: 编写 pointer、touch 与 keyboard 失败测试**

覆盖 mouse 拖拽、触摸长按、ESC 取消、失焦取消、键盘向前/后移动、网络失败回滚、409 刷新提示、`prefers-reduced-motion`，并断言正常模式点击卡片仍打开书。

- [x] **Step 2: 实现 Pointer Events 拖拽控制器**

不用原生 HTML5 DnD 作为触摸主方案。长按通过移动阈值和定时器进入，取消时清除 pointer capture、placeholder 和 body 状态；拖拽把手在非整理模式不可见且不可聚焦。

- [x] **Step 3: 实现无鼠标等价操作**

提供“移到最前/最后、前移、后移、移到分类”的 action menu；用 `aria-live` 宣告结果。拖拽不应成为移动书籍的唯一方法。

- [x] **Step 4: 采用乐观 UI + 明确回滚**

先渲染局部预览，提交 Task 2 mutation；失败或 `409` 立即重新获取 server view，并恢复焦点到发起元素。不得把过期排列写回。

- [x] **Step 5: 运行交互回归**

```text
npm run test:e2e
node --test tests/dom-regression.test.js
```

### Task 5: 源目录只读分组和个性化展示开关

**Files:**
- Modify: `app/server/library.js`
- Modify: `app/server/index.js`
- Modify: `app/server/library-organization.js`
- Modify: `app/ui/library/organization.js`
- Modify: `app/ui/styles.css`
- Modify: `tests/reader-core.test.js`
- Modify: `tests/library-organization.test.js`
- Modify: `e2e/reader.spec.js`

**Interfaces:**
- Consumes: 已授权扫描根、已有 `relativePath`、Task 1 偏好存储。
- Produces: 不含绝对路径的 source root/segments、`source-folders` 展示模式和持久化 view preference。

- [x] **Step 1: 为安全源路径字段编写失败测试**

覆盖多根、中文/空格/嵌套目录、根目录直属书籍、相同目录名不同根、符号链接拒绝，断言公共 JSON 不含 `path`/`root` 及其前缀。

- [x] **Step 2: 在扫描边界派生安全描述符**

新增 opaque `sourceRootId` 和规范化 `sourcePathSegments`，仅从已通过授权验证的真实扫描路径派生。不得让客户端提交或反向解析 root。

- [x] **Step 3: 实现只读目录树 resolver**

按 `sourceRootId + sourcePathSegments` 聚合当前书目；目录模式仅允许进入/返回/打开书。显式隐藏整理、拖拽和“移入此目录”等会被理解为文件操作的功能。

- [x] **Step 4: 持久化展示偏好**

只保存允许值 `flat|collections|source-folders`；未知值安全回退 `flat`。该偏好独立于阅读显示设置，不能重写现有 `reading-state.json.settings`。

- [x] **Step 5: 验证权限撤销与扫描失败**

撤销一个授权根或产生失败扫描时，目录树不访问旧路径、不自动清除手工分类；UI 提示当前扫描状态而非显示内部路径。

### Task 6: 数据修复、发布验证和 fnOS 真机验收

**Files:**
- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `CHANGELOG_WORK.md`
- Modify: `scripts/fnos-device-acceptance.sh`
- Modify: `tests/structure-validation.test.js`
- Modify: `docs/superpowers/progress/2026-09-22-library-personalization-progress.md`

**Interfaces:**
- Consumes: Tasks 0–5 的 flag、组织存储、API、UI 和目录投影。
- Produces: 受控 repair/reconcile、完整回归结果、FPK 和真机记录。

- [x] **Step 1: 增加受控 reconciliation**

仅在用户确认后清除 orphan book references；先 dry-run 返回数量，扫描不健康时 fail closed。不得删除分类、书籍文件、AI 索引、书签、标注、进度或会话。

已实现 `POST /api/library/organization/reconcile`：缺省为 dry-run，只有 `confirm: true` 且 revision 仍匹配时才原子清理孤儿引用；扫描不健康返回 503；保留分类本身及所有非组织数据。

- [x] **Step 2: 全量自动验证**

```text
npm test
npm run check
npm run check:portable
npm run test:e2e
git diff --check
```

预期：Node/结构/便携检查通过；Chromium 全量回归允许重跑确认偶发项；无未经声明的新依赖；feature flag 关闭的回退覆盖通过。

- [x] **Step 3: FPK 可复现构建**

```text
npm run build:fpk
Get-FileHash dist/babyreader-fnos.fpk -Algorithm SHA256
```

只有工作区状态、结构验证和构建溯源均符合发布规则时才交付。当前构建为 Windows 本地 Git Bash/fnpack 候选包，仍需 fnOS 安装验证。

- [ ] **Step 4: fnOS 真机矩阵**

至少验证：管理员扫描自定义目录、普通用户浏览、A/B 用户隔离、创建/删除分类、分类内重排、触摸长按取消、按源目录浏览、撤销目录权限、刷新恢复、EPUB/Markdown/TXT 打开、AI/搜索/书签/标注/会话、深浅色与移动端安全区。

- [ ] **Step 5: 回填证据与发布决策**

记录 fnOS 版本、CPU、FPK SHA-256、通过/失败场景和可复现命令；不记录 NAS 用户名、Cookie、API Key、绝对目录或书籍正文。只有真机关键路径通过才建议默认开启 feature flag。

本地步骤 1–3 已完成；步骤 4–5 等待用户在 fnOS 安装当前候选 FPK 后提供验收输出。组织功能继续默认关闭，未因本地回归通过而提前开启。

## 后续独立提案（不属于本计划）

1. **多标签/多集合**：需要定义同一本书跨分类后的排序语义与去重显示。
2. **嵌套虚拟分类**：需要防循环、父分类删除迁移、递归性能和移动端面包屑规范。
3. **阅读清单**：应独立于收藏分类，允许显式阅读顺序、跨格式连续阅读和导入/导出。
4. **智能分类**：仅在用户显式开启、可预览、可撤销且不上传书籍内容的前提下考虑。
5. **元数据分类**：可研究 EPUB metadata/Calibre 标签，但不能把不可信元数据直接写为用户分类。

## 计划自审

- 扫描书目与用户整理数据分离，避免每次扫描覆盖用户偏好。
- 手工分类与源目录分类被设计为互斥视图，避免排序冲突或误操作真实文件。
- 每个写入点均有用户隔离、输入规范化、revision、原子写入和错误回滚要求。
- 每个 UI 动作均保留当前书籍打开入口及键盘/触摸访问路径。
- 嵌套分类、多标签、共享和 AI 分类均明确延后，防止“规划外改造”。
