# Implementation Plan: AI 索引管理器

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Goal

在不改变现有 AI 问答、全文搜索、阅读器、书签、标注和书库行为的前提下，增加管理员可用的 AI 索引管理器：可查看索引健康状态与空间占用，可安全删除单本索引，可清理确认过的孤儿和过期临时文件，并确保构建、读取、删除、重启和异常发布之间不会损坏现有索引。

本计划是已批准的后续开发计划，当前状态为“尚未执行”。正式规格见 docs/superpowers/specs/2026-09-21-ai-index-manager-design.md。

## Architecture

保留现有“一本书一个 SQLite FTS5 文件”的架构：

    TRIM_PKGVAR/ai-index/<bookId>.sqlite

新增 app/server/ai-index-manager.js 作为唯一索引管理边界，负责 manifest、只读检查、统计、生命周期租约、删除和清理。ai-fts.js 继续负责 FTS5 schema、分块、构建和查询，但必须通过共享的生命周期接口发布和登记索引。

新增 manifest：

    TRIM_PKGVAR/ai-index/manifest.json

manifest 只保存 bookId、大小、指纹、schemaVersion、indexedAt、lastAccessedAt 等管理元数据；真实路径、正文、API Key、UID、查询词和问答内容永不进入 manifest。

管理 API 只允许管理员：

    GET /api/ai/indexes
    DELETE /api/ai/indexes/<bookId>
    POST /api/ai/indexes/cleanup

前端在 AI 设置中增加管理员可见的“本地检索索引”入口，打开独立 surface；surface 复用现有 readerSurfaceController 的关闭、焦点、遮罩、安全区和无障碍行为。

## Tech Stack

- Node.js 22.18 的 node:sqlite DatabaseSync。
- SQLite FTS5，保持 rollback journal，不引入 WAL。
- 现有 CommonJS 服务结构和现有 storage/security/library 适配方式。
- 现有原生 DOM/CSS UI，不引入新的前端框架。
- Node 内置测试、现有 Playwright E2E、fnOS 设备验收脚本与 FPK 打包流程。

## Spec

完整约束、数据模型、API 响应、错误码、并发租约、发布策略、UI 和验收标准以 docs/superpowers/specs/2026-09-21-ai-index-manager-design.md 为准。实现时必须特别遵守以下边界：

- 书库扫描失败时孤儿清理 fail closed。
- 客户端只提交 bookId，服务端自行解析路径。
- 不跟随符号链接、不删除目录、不接受路径。
- readOnly 检查不得创建不存在的 SQLite 文件。
- 有 build/read lease 时删除返回 409。
- 发布失败必须保留旧的可用索引；禁止先 rm 旧索引再 rename 新索引。
- 首版不自动 LRU、配额、VACUUM、WAL 和全量删除。

## Global Constraints

- 先写回归测试，再修改运行代码；每个任务保持 RED → GREEN → 回归。
- 每个任务只触及列出的文件；如果发现需要扩大边界，先补充计划并暂停实现。
- 不改变已有 AI API 请求体、响应体和 FTS 查询排序契约。
- 不把管理器逻辑复制到 ai-fts.js、book-search.js 和前端多个入口。
- 所有文件写入使用同一 ai-index 目录，文件权限目录 700、SQLite 文件 600、manifest 600。
- 所有租约释放放在 finally；所有删除前做目标类型、路径和活动状态校验。
- 每个任务单独提交，提交前执行对应测试和 git diff --check。
- 任何声称“完成”之前，必须有命令输出或真机记录作为证据。

## Review Focus

审查重点依次为：

1. 删除边界：是否可能删除用户原书、整个目录、符号链接目标或别的书籍索引。
2. 并发边界：构建、搜索、检查、删除是否共享同一租约状态。
3. 发布边界：构建失败或进程中断时旧索引是否仍可用。
4. 权限边界：是否所有 API 都在服务端校验管理员身份，是否泄露路径和正文。
5. 兼容边界：既有 FTS、AI、书签、标注、阅读器和 fnOS 启动流程是否保持稳定。
6. 运维边界：manifest 损坏、临时文件残留、SQLite corrupt、磁盘不足、服务重启如何恢复。

## File Map

### Existing files to inspect or modify

- app/server/ai-fts.js：FTS5 schema、buildIndex、ensureIndex、查询和当前 buildLocks；需要接入共享租约和安全发布。
- app/server/book-search.js：全文搜索调用 ensureIndex 的边界；只在需要记录访问或共享租约时改动。
- app/server/index.js：路由、gatewayUser、findBook、管理员判断和统一错误响应。
- app/server/library.js：健康书库清单和书籍元数据来源；不扩大格式支持。
- app/server/security.js：认证、管理员边界和路径安全工具；优先复用现有实现。
- app/ui/core/api.js：新增管理 API 客户端封装。
- app/ui/index.html：加载新的 index manager 模块和必要容器。
- app/ui/reader/ai.js：AI 设置入口，保持既有问答和设置功能不变。
- app/ui/styles.css：复用现有 surface、sheet、按钮、状态和移动端安全区 token。
- tests/reader-core.test.js：FTS 生命周期、索引重建和回归测试。
- tests/dom-regression.test.js：surface、管理员入口和 UI 回归测试。
- e2e/reader.spec.js 或新增 e2e/ai-index-manager.spec.js：浏览器验收。
- docs/FNOS_DEVICE_ACCEPTANCE.md：增加索引管理器真机验收项。

### New files

- app/server/ai-index-manager.js：管理器实现和唯一公共接口。
- app/ui/reader/ai-index-manager.js：管理器 surface 和交互。
- tests/ai-index-manager.test.js：纯管理器、manifest、统计、清理和安全边界测试。
- tests/ai-index-api.test.js：管理员 API、错误码和信息泄露测试。
- e2e/ai-index-manager.spec.js：Playwright 管理界面验收（如现有 reader.spec.js 不适合扩展）。

## Implementation Tasks

### Task 1: 建立索引注册表和只读检查基础

**Files:**

- Create app/server/ai-index-manager.js
- Create tests/ai-index-manager.test.js
- No route or UI changes in this task.

**Public interface:**

    createAiIndexManager({ dataRoot, getLibraryIndex, now })

The returned manager exposes:

    indexDirectory()
    getIndexPath(bookId)
    inspectIndexFile(filePath)
    listIndexes({ libraryIndex, scanHealthy })
    recordBuildSuccess(book, metadata)
    recordAccess(bookId)
    deleteIndex(bookId, options)
    cleanup({ kind, libraryIndex, scanHealthy, confirm })

The manager must validate a bookId as exactly 64 lower-case hexadecimal characters, derive all paths from dataRoot, reject symlink/directory targets, and open existing SQLite files read-only for inspection. It must never create a database during list or inspect.

**Steps:**

1. Write tests for valid/invalid bookId, index directory creation, read-only missing-file inspection, manifest version 1, and no path/text leakage.
2. Write tests for manifest entry serialization, atomic manifest write, 600/700 permissions, and malformed manifest recovery.
3. Implement path validation, manifest load/save, read-only SQLite inspection, PRAGMA statistics, and status derivation.
4. Implement listIndexes using a supplied healthy libraryIndex; if scanHealthy is false, return a non-destructive unavailable result rather than infer orphans.
5. Run node --test tests/ai-index-manager.test.js and git diff --check.

**Commit:** feat: add ai index manager registry foundation

### Task 2: 接入 FTS 生命周期和安全发布

**Files:**

- Modify app/server/ai-fts.js
- Modify app/server/book-search.js only when access registration requires it
- Modify app/server/ai-index-manager.js
- Extend tests/ai-index-manager.test.js
- Extend tests/reader-core.test.js

**Required behavior:**

- Replace isolated buildLocks with a shared manager lifecycle registry.
- Build holds build lease; search/AI read path holds read lease; delete requires exclusive lease.
- Record successful build and access only after the SQLite file is valid.
- Change the current publish path so it never removes the old index before the new index is safely published.
- Preserve old ready index on build, integrity-check, rename or manifest failure.
- Clean up stale temp files only when they are not active.

**Steps:**

1. Add RED tests for concurrent build, search while build completes, delete during read/build returning busy, and release after thrown errors.
2. Add RED test that forces publish failure and asserts the previous SQLite file remains readable.
3. Add RED tests for stale fingerprint rebuild, repeated build, 600 file permissions and 700 directory permission.
4. Implement shared leases, safe same-directory publish, manifest registration after successful close, and access timestamp update.
5. Run focused tests, then npm test and existing FTS/search regression tests.

**Commit:** fix: coordinate ai index lifecycle and safe publication

### Task 3: 增加管理员管理 API

**Files:**

- Modify app/server/index.js
- Modify app/server/ai-index-manager.js if route adapter needs a narrow helper
- Create tests/ai-index-api.test.js

**Routes and behavior:**

- GET /api/ai/indexes returns items and summary for administrators.
- DELETE /api/ai/indexes/:bookId deletes one index idempotently unless busy.
- POST /api/ai/indexes/cleanup accepts only kind orphans, temporary, all and confirm=true.
- Reuse existing gatewayUser and administrator checks; do not trust a client-provided admin flag.
- Return 401, 403, 400, 409 and 503 according to the specification.

**Steps:**

1. Write tests for unauthenticated, non-admin and admin requests.
2. Write tests for response redaction: no absolute paths, file names beyond bookId, raw SQLite errors, body text, query text or API keys.
3. Write tests for delete busy, invalid bookId, missing index idempotency, unconfirmed cleanup and unhealthy library scan.
4. Implement routes after existing session/security routing and before generic book routes where appropriate.
5. Run node --test tests/ai-index-api.test.js and the existing server/security tests.

**Commit:** feat: expose admin ai index management api

### Task 4: 增加独立索引管理 surface

**Files:**

- Create app/ui/reader/ai-index-manager.js
- Modify app/ui/core/api.js
- Modify app/ui/index.html
- Modify app/ui/reader/ai.js
- Modify app/ui/styles.css
- Extend tests/dom-regression.test.js
- Create or extend e2e/ai-index-manager.spec.js

**Required UI behavior:**

- Show “本地检索索引” only when the loaded session says isAdmin.
- Keep the existing AI settings and answer surface unchanged.
- Open a separate surface using readerSurfaceController.
- Render loading, ready, stale, building, orphan, corrupt and missing states.
- Provide per-index delete and confirmed orphan/temp cleanup.
- Disable busy actions, show retry after failure, refresh after success, and close with Escape/backdrop/close button.
- Use the existing Apple-style tokens, button sizes, typography, focus ring, safe area and scroll region.

**Steps:**

1. Add DOM regression tests for admin-only entry, no entry for non-admin, no duplicated surface, and cleanup confirmation.
2. Add API adapter methods listAiIndexes, deleteAiIndex and cleanupAiIndexes with response/error mapping.
3. Implement a small surface controller adapter that uses the existing controller instead of duplicating backdrop/focus logic.
4. Add Playwright checks for open, close, loading, error retry, delete confirmation and responsive safe-area behavior.
5. Run npm test, focused DOM tests and the new E2E spec.

**Commit:** feat: add ai index manager surface

### Task 5: 恢复、诊断和异常边界加固

**Files:**

- Modify app/server/ai-index-manager.js
- Modify app/server/ai-fts.js
- Modify app/server/index.js
- Extend tests/ai-index-manager.test.js
- Extend tests/ai-index-api.test.js

**Required cases:**

- Manifest missing or malformed: rebuild from safe file scan without deleting recognized files.
- SQLite metadata/schema/FTS integrity failure: report corrupt; no automatic destructive repair.
- Orphan cleanup requires healthy library scan.
- Temporary cleanup uses a fixed documented TTL and excludes active leases.
- Symlink, directory, malformed filename, permission denied and disk-full simulations fail closed.
- Startup with a partially published file leaves either old valid file or a recoverable temp state.

**Steps:**

1. Add tests for every failure class and assert no out-of-scope path changes.
2. Add tests for summary counts and bytes before/after idempotent cleanup.
3. Implement bounded recovery and sanitized error mapping.
4. Verify existing search and AI retrieval still rebuild stale indexes and do not expose manager internals.
5. Run the complete Node test suite and inspect diff for accidental route or schema changes.

**Commit:** harden: recover and diagnose ai index states safely

### Task 6: 文档、FPK 和 fnOS 真机验收

**Files:**

- Modify docs/FNOS_DEVICE_ACCEPTANCE.md
- Modify docs/superpowers/progress/2026-09-21-ai-index-manager-progress.md
- Update package/build metadata only if required by the existing FPK workflow
- Do not delete the device acceptance tool until the user explicitly confirms cleanup.

**Acceptance matrix:**

- Fresh install and upgrade from the current 1.1.1 FPK.
- x86_64 and ARM-compatible fnOS runtime where available.
- Admin list, delete one, cleanup orphan/temp; non-admin 403; unauthenticated 401.
- Existing EPUB AI retrieval and full-book search still work.
- Rebuild after delete, service restart during idle, and restart after a failed build.
- Verify ai-index directory 700, SQLite and manifest 600, no temporary leftovers after cleanup.
- Verify FPK contains the manager code, UI module, tests/docs needed for acceptance, and no development-only secrets.

**Steps:**

1. Run npm test, npm run check, focused E2E and package validation.
2. Build the FPK using the repository’s existing packaging command; do not hand-edit generated output.
3. Record SHA-256, source commit and dirty state.
4. Install on fnOS and run the acceptance script with captured output.
5. Update the progress ledger with evidence, known limitations and the next approved task.

**Commit:** release: package ai index manager for fnos

## Execution Order and Stop Gates

Tasks must execute in order. Stop and review before proceeding if:

- Task 1 cannot inspect an existing index without creating or modifying it.
- Task 2 cannot prove old-index preservation on publish failure.
- Task 3 exposes a path, raw error,正文、query or API key.
- Task 4 changes the existing AI answer/settings behavior.
- Task 5 requires automatic destructive repair to make the system appear healthy.
- Task 6 cannot prove both admin boundary and existing AI/search regression stability.

After each task, update the progress ledger and present the evidence. The next task starts only after the corresponding regression set is green.

## Research References

- SQLite FTS5: https://www.sqlite.org/fts5.html
- SQLite PRAGMA: https://sqlite.org/pragma.html
- SQLite VACUUM: https://sqlite.org/lang_vacuum.html
- SQLite WAL: https://www.sqlite.org/wal.html
- SQLite Atomic Commit: https://www.sqlite.org/atomiccommit.html
- SQLite Locking: https://www.sqlite.org/lockingv3.html
- Node.js 22.18 node:sqlite: https://nodejs.org/download/release/v22.18.0/docs/api/sqlite.html
- Node.js 22.18 fs: https://nodejs.org/download/release/v22.18.0/docs/api/fs.html
