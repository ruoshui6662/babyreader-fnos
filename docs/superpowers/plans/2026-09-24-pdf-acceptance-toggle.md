# PDF NAS 验收开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 fnOS 应用设置中受控切换 PDF 阅读与本地搜索，默认关闭，配置即时生效，并生成供 NAS 验收的 FPK。

**Architecture:** 独立的私有 JSON 文件存储开关，原子写入、严格解析、损坏即关闭；服务端每个相关请求读取同一状态。fnOS `wizard/config` 的回调只保存设置，不重启由系统监管的服务。

**Tech Stack:** Node.js 22、POSIX shell、fnOS wizard/config、`node:test`、现有 FPK build 与验收脚本。

**Spec:** `docs/superpowers/specs/2026-09-24-pdf-acceptance-toggle-design.md`

## Global Constraints

- PDF 默认关闭；私有配置文件是 `$TRIM_PKGETC/pdf-feature.json`，格式为 `{"version":1,"enabled":false}`，权限 `0600`。
- 缺文件时只允许既有 `BABYREADER_PDF_ENABLED` 环境回退；文件存在但无效或不可读时必须关闭。有效文件优先于环境。
- 配置回调不得调用 `cmd/main restart`、删除 socket/PID 或改变书籍、索引及授权根。
- PDF API 每次请求仍使用现有 Gateway 身份、bookId 和授权路径校验；不增加可写 HTTP 设置 API。
- 只在当前包含未提交 PDF Task 1–5 工作的工作区实现；保留所有无关改动。不要提交、暂存或清理现有工作区。
- 构建使用新 `dist-fpk-*` 输出目录，保留 manifest 版本 `1.1.7`。若 fnOS 拒绝同版本安装，单独处理版本策略。

## Review Focus

1. 私有文件存在但损坏、不可读或 schema 不认识时不能借环境变量开启 PDF；Task 1 覆盖。
2. 开关从开到关后，已经打开的客户端不能继续请求 PDF 内容或搜索；Task 2 覆盖。
3. 组织 API 不能保留已隐藏 PDF 的可分配书籍 ID；Task 2 覆盖。
4. fnOS 配置回调未拿到向导字段或收到非法值时不能覆盖现有状态，也不能触发服务重启；Task 3 覆盖。
5. FPK 必须包含 wizard 与私有配置模块、PDF.js/许可证及设备验收脚本，且不包含合成 PDF 或用户数据；Task 4 覆盖。

## Task 1: 私有开关配置模块

**Files:** Create `app/server/pdf-feature-config.js`; create `tests/pdf-feature-config.test.js`.

**Interfaces:** Produce `getPdfReaderEnabled(configRoot, envValue): boolean` and `setPdfReaderEnabled(configRoot, wizardValue): boolean`; command mode `node app/server/pdf-feature-config.js set <value>` reads `TRIM_PKGETC` and exits nonzero on invalid input.

- [ ] **Step 1: Write failing tests.** Cover absent file plus absent/present env, valid persisted value overriding env, corrupt/unknown schema fail-closed, valid `true`/`false` wizard strings, invalid input preserving old bytes, and `0600`/no temp leftovers on POSIX. Assert real return values and file contents in an `fs.mkdtempSync` root.
- [ ] **Step 2: Observe RED.** Run `node --test tests/pdf-feature-config.test.js`; expected failure: module not found.
- [ ] **Step 3: Implement minimal module.** Strictly parse `{version:1,enabled:boolean}`; return env boolean only for `ENOENT`; write a same-directory random `wx` temporary file with mode `0600`, sync and rename; clean the temporary file on error. CLI accepts only exact `true`/`false` (plus documented fnOS switch representation if verified in device output) and prints no secrets or paths.
- [ ] **Step 4: Observe GREEN.** Run `node --test tests/pdf-feature-config.test.js`; expected all pass.

## Task 2: 服务端动态开关

**Files:** Modify `app/server/index.js`; modify `tests/pdf-feature-flag.test.js`; modify `tests/pdf-content-api.test.js` or `tests/search-api.test.js` only if the focused tests need existing fixtures.

**Interfaces:** Consume `getPdfReaderEnabled(CONFIG_ROOT, process.env.BABYREADER_PDF_ENABLED)` from Task 1; no exported HTTP mutation.

- [ ] **Step 1: Write failing API tests.** Start one HTTP server, then write enabled configuration without restarting; GET `/api/library` must show `features.pdfReader=true` and fixture PDF; GET PDF content with a single byte Range returns `206`. Write disabled configuration and assert `/api/library` hides it, content returns `404`, and PDF search reports `pdf_search_disabled`; legacy text catalog/content remains reachable. Include organization snapshot/placement active-book ID behavior and unauthenticated/unauthorized requests.
- [ ] **Step 2: Observe RED.** Run `node --test tests/pdf-feature-flag.test.js`; expected enabled state remains false because current module-level constant is frozen at startup.
- [ ] **Step 3: Implement minimal server change.** Replace every use of `PDF_READER_ENABLED` with one `pdfReaderEnabled()` function backed by Task 1. Keep existing identity, book lookup and path checks in place. Evaluate once per request/response path where possible, including catalog, organization, search and content routes.
- [ ] **Step 4: Observe GREEN and legacy compatibility.** Run `node --test tests/pdf-feature-flag.test.js tests/pdf-content-api.test.js tests/search-api.test.js`; expected all pass, with existing Windows-only symlink skips unchanged.

## Task 3: fnOS 设置向导与回调

**Files:** Create `wizard/config`; modify `cmd/config_callback`; modify `tests/fnos-lifecycle.test.js`; update `scripts/validate-structure.js` only if package validation needs a required wizard check.

**Interfaces:** `wizard_pdf_reader_enabled` is a fnOS `switch` field with `initValue:"false"` (fnpack requires a string); callback invokes Task 1 CLI using `TRIM_PKGETC` and submitted value, then exits without invoking `cmd/main`.

- [ ] **Step 1: Write failing tests.** Validate JSON field type/name/default. Assert callback source has no `cmd/main`, `restart`, `rm` or socket/PID cleanup. On a POSIX host, invoke the callback with an isolated `TRIM_APPDEST`/`TRIM_PKGETC`; valid value creates private file, missing value leaves existing file unchanged, invalid value returns nonzero and leaves old bytes unchanged.
- [ ] **Step 2: Observe RED.** Run `node --test tests/fnos-lifecycle.test.js`; expected wizard missing or current callback still restarts.
- [ ] **Step 3: Implement minimal configuration flow.** Add one wizard step with switch and acceptance-only warning. In callback, use Node.js 22 and the Task 1 CLI to save only a present field; report bounded errors and never invoke service lifecycle commands. Require `wizard/config` in structure validation.
- [ ] **Step 4: Observe GREEN.** Run `node --test tests/fnos-lifecycle.test.js` and `npm run check`; expected all pass.

## Task 4: 文档、回归与验收 FPK

**Files:** Modify `docs/FNOS_DEVICE_ACCEPTANCE.md` and `scripts/build-fpk.sh`; modify `scripts/fnos-device-acceptance.sh` only if a test reveals a false SKIP/FAIL under the new config; build new `dist-fpk-20260924-pdf-acceptance-toggle-v2/` after the first schema-rejected attempt.

**Interfaces:** Acceptance script already reads `features.pdfReader` from authenticated `/api/library`; keep that contract. The already-created fixture is named `BabyReader PDF Acceptance Fixture.pdf` inside an authorized default book directory; the FPK must not include its NAS path.

- [ ] **Step 1: Update acceptance instructions.** Replace SSH environment/restart steps with App Center → BabyReader → 应用设置 → PDF 开关 → 浏览器刷新 → 重新扫描. Explain test fixture is already in the authorized root; do not regenerate or overwrite it. Closing the switch is the rollback; `SKIP` is not PDF acceptance success.
- [ ] **Step 2: Keep internal design/progress documents out of the FPK.** Stage only `FNOS_DEVICE_ACCEPTANCE.md`, the acceptance script and public product documentation; do not copy the entire `docs/superpowers` tree or other user-specific development notes. Validate this from the built archive, not from a source-text assertion.
- [ ] **Step 3: Run complete local gates.** Run `npm test`, `npm run check`, `npm run check:portable`, focused PDF Chromium E2E, POSIX `bash -n` for packaging/acceptance scripts, and `git diff --check`. Record exact pass/skip/fail counts; do not claim device acceptance.
- [ ] **Step 4: Build only after green gates.** Use `BABYREADER_BUILD_ID=20260924-pdf-acceptance-toggle-v2` with `scripts/build-fpk.sh`; it must refuse overwrite if output already exists. Inspect FPK archive members for `wizard/config`, `server/pdf-feature-config.js`, pinned PDF.js resources/licenses and acceptance script; confirm no `.pdf` fixtures or private runtime paths. Compute SHA-256 of final artifact.
- [ ] **Step 5: Hand off NAS test.** Give the FPK path/hash and exact manual sequence: install/upgrade in fnOS, enable switch, refresh/rescan, open fixture, run authenticated acceptance script, switch off and verify legacy formats. Do not remotely install or restart the NAS from this task.

## Completion criteria

Local tests and package audit pass; a new FPK artifact exists with a recorded SHA-256. NAS acceptance remains pending until the user installs it and reports the authenticated Gateway checks and reader UI behavior.
