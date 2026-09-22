# SDD ledger — plan: docs/superpowers/plans/2026-09-22-fnos-authorized-library-roots.md

Workspace: `D:/AI编程/reader/.worktrees/fnos-authorized-library-roots`
Branch: `codex/fnos-authorized-library-roots`
Plan base: `c5cdbe7`

Pre-flight shared interfaces:

- Task 0 → Task 2: Task 0 protects the fnOS environment contract; Task 2 consumes that contract through `loadConfiguration()` and `authorizedRoots`. No conflicting names found.
- Task 1 → Task 2: Task 1 produces `parsePathList()`, `collectRootCandidates()`, `resolveLibraryRoots()` and `RootDiagnostics`; Task 2 consumes exactly those interfaces. No conflict found.
- Task 2 → Task 3: Task 2 preserves the existing `browserHost.scanLibrary()` response and adds scan/diagnostic data; Task 3 consumes the existing response and does not require a new route. No conflict found.
- Task 2 → Task 4: Task 2 reloads configuration on each scan; Task 4 verifies process environment forwarding and the restart requirement. No conflict found.

Ruling: execute in this isolated worktree because the main checkout contains unrelated uncommitted reader and AI changes; no merge or push will be performed without user direction.

Baseline pending: run dependency/setup and the plan's Task 0 tests before implementation.

Task 0: complete — added fnOS custom authorization-directory acceptance steps, added runtime root diagnostics to the acceptance tool, and added lifecycle assertions that the supervisor-provided authorization/share environment is inherited. Verification: `npm test -- tests/device-profile.test.js tests/fnos-lifecycle.test.js` → 174 passed, 4 skipped; `npm run check` → passed. Commit: `c3470bd`.

Task 1: complete — added `parsePathList()`, `collectRootCandidates()` and `resolveLibraryRoots()` with realpath/stat/access checks, stable deduplication, parent-root pruning, and rejected-root diagnostics. Verification: `node --test tests/library-roots.test.js tests/reader-core.test.js` → 37 passed; `npm test` → 177 passed, 4 skipped. Commit: `4eb1a28`.

Task 2: complete — connected `loadConfiguration()` to the shared root resolver, preserved the legacy `parseFnOSPathList` export, added safe root-count diagnostics, and verified scan reloads current fnOS authorization paths without exposing absolute paths in regular library responses. Added Windows-drive-safe parsing for local tests and restored test state after the custom-root scenario. Verification: `node --test tests/library-roots.test.js tests/reader-core.test.js tests/search-api.test.js tests/ai-index-api.test.js` → 49 passed; `npm test` → 178 passed, 4 skipped; `npm run check` → passed. Commit: `9a405fd`.

Task 3: complete — added safe library rescan progress, outcome counts, and permission-recovery messaging; the UI never renders the raw server error or an absolute path. The scan response transport remains unchanged because the existing API already returns bounded scan statistics and no path fields in regular library responses. Verification: `node --test tests/dom-regression.test.js tests/reader-core.test.js` → 115 passed. Commit: 4bc57c1.

Task 4: complete — explicitly forwarded fnOS authorized/shared path environment into the Node service, added admin diagnostics root-count checks to the device tool, and documented the restart requirement and redacted diagnostic behavior. Verification: `node --test tests/fnos-lifecycle.test.js` → 9 passed, 1 skipped; `npm run check` → passed; shell syntax checks passed. Commit: `a14862e`.

Task 5: complete for local release preparation — full Node regression passed 180 with 4 Windows condition skips; Chromium E2E passed 80 with 2 optional real-EPUB skips; structure, portable, and diff checks passed. Final FPK build completed with git_dirty=false. The exact SHA-256, package size, source commit, and generated time are authoritative in dist/build-provenance.json. fnOS installation and authorization-directory hardware acceptance remain pending and are not claimed locally. Commit: recorded by Git history.
