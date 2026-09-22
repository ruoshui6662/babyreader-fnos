# AI 索引管理器紧凑界面与书籍联动清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. 每个任务先写回归测试，确认 RED 后再修改运行代码。

**状态：** 已规划，尚未执行。

**Goal：** 将本地检索索引管理器调整为紧凑、一致、可读的独立 sheet；为所有可读索引显示可追溯的建立/更新时间；并在健康书库扫描后自动删除已经不属于书库的索引和遗留 manifest 条目。

**Architecture：** 继续使用“一本书一个 `ai-index/<bookId>.sqlite`”的架构，不引入文件系统 watcher、SQLite schema 变更、后台队列或新的数据表。UI 复用现有 AI 问书的关闭按钮语言和现有 reader surface 的焦点、遮罩、Escape 行为。书籍删除联动不直接监听文件删除，而是以一次无错误的书库扫描为可信边界，复用 `aiIndexManager.cleanup()` 的路径校验、权限与 build/read lease。

**Tech Stack：** Node.js 22 `node:sqlite`/SQLite FTS5、CommonJS、原生 DOM/CSS、Node 内置测试、现有 Playwright、fnOS 设备验收和 FPK 打包脚本。

**Spec：** [AI 索引管理器技术规格](../specs/2026-09-21-ai-index-manager-design.md)。本计划补充该规格中已实现管理器的界面收敛、旧索引时间回填和“健康扫描自动清理孤儿索引”生命周期。

## 已确认的产品决策

- “书籍删除”指用户从授权书库目录删除文件、移出授权书库根目录，或移除书库根目录配置后，下一次成功书库扫描不再包含该书籍。
- 自动删除的仅是 BabyReader 生成的 SQLite 索引与其 manifest 条目；绝不删除原始书籍文件、封面以外的用户文件、阅读进度、书签、划线、想法或 AI 会话。
- 自动清理只在书库扫描为 `completed`、`errorCount === 0`、`rootErrors` 为空、且配置根目录没有访问失败时执行；任何不确定状态一律保留索引。
- 自动清理覆盖所有已确认的孤儿索引（包括历史遗留索引），因为它们都是可按需重建的缓存。正在构建或读取的索引返回 `INDEX_BUSY` 并跳过；下一次健康扫描自动重试。
- 不创建文件监听器。fnOS/NAS 的挂载、权限与网络路径可能短暂不可用；以显式书库扫描为唯一删除确认点更可靠。
- 首版不迁移本地检索索引管理器的原生删除确认框；本计划只统一 sheet 的关闭控制与卡片视觉，避免扩大为跨模块确认弹窗重构。

## 审查结论

1. **关闭样式不一致。** 索引管理器使用 `.settings-header button`（36px、填充圆形、伪元素 `×`），AI 问书使用 `.ai-icon-button`（30px、紧凑工具栏按钮）。两处关闭语义相同，但没有共享样式契约。
2. **卡片异常占高。** `.ai-index-manager-list` 是占满剩余高度的 CSS Grid；默认 `align-content: stretch` 会把多条自动行拉伸填满可用高度。因此卡片内容虽少，视觉上却被拉成长块。
3. **时间缺失有明确原因。** 前端仅在 API 返回 `item.indexedAt` 时渲染时间；服务端仅从 `manifest.json` 读取该字段。索引管理器上线前创建的有效 SQLite 文件没有 manifest 记录，故不会显示时间；文件安全 `lstat` 的 `mtime` 尚未作为回退值返回。
4. **删除能力已具备但未接入扫描。** `aiIndexManager.deleteIndex()` 和 `cleanup({ kind: 'orphans' })` 已校验 canonical `<bookId>.sqlite`、拒绝链接/目录、检查租约并删除 manifest 条目；`runLibraryScan()` 保存新的书库索引后没有调用该清理边界。

## 全局约束

- 不修改现有 AI 问答、全文搜索、书签、标注、会话、书籍内容 API 的请求/响应契约。
- 不接受客户端路径；索引删除只能由服务端从 64 位小写十六进制 `bookId` 推导。
- 不直接调用裸 `fs.rm()` 删除索引；只经 `aiIndexManager.deleteIndex()` 或其已验证的 `cleanup()` 流程。
- 不在扫描失败、根目录访问失败、索引构建中或读取中做破坏性清理。
- 旧索引在读取列表时不得写 manifest；时间回退只能读取安全文件元数据。
- 继续保持目录 `0700`、SQLite/manifest `0600` 的权限契约。
- 保持一个 reader surface、一个焦点陷阱和一个关闭路径；不在索引管理器中重新实现 backdrop、Escape 或焦点恢复。

## Review Focus

1. 根目录临时不可访问时，自动清理必须完全跳过，不能把整库索引误判为孤儿。
2. 扫描成功但索引正被搜索/重建时，必须跳过而非强制删除，并在后续扫描重试。
3. 旧 SQLite 没有 manifest 时必须显示文件更新时间，但列表读取不能产生新的 manifest 写入。
4. 紧凑列表在 3、30 条索引和移动端安全区下都只让列表区域滚动，不拉伸单条卡片。
5. 关闭按钮的键盘焦点、Enter/Space、Escape 与返回焦点行为必须保持既有 AI/reader surface 契约。

## 文件地图

- `app/server/ai-index-manager.js`：安全文件检查、`indexedAt` 回退、孤儿与 manifest 条目清理。
- `app/server/index.js`：健康扫描后的自动清理协调与不泄露路径的扫描结果摘要。
- `app/ui/index.html`：共享关闭按钮类与索引管理器可访问标签。
- `app/ui/styles.css`：共享关闭按钮、紧凑 sheet 尺寸、非拉伸列表和卡片排版。
- `app/ui/reader/ai-index-manager.js`：统一时间文案、正常状态的紧凑显示、保留当前 API 和交互。
- `tests/ai-index-manager.test.js`：文件 `mtime` 回退、manifest-only orphan、busy 清理和安全边界。
- `tests/ai-index-api.test.js`：书库扫描后自动清理、扫描/根目录失败 fail-closed、重试与 API 摘要。
- `tests/dom-regression.test.js`：共享关闭类、紧凑列表规则、时间渲染和 surface 契约。
- `e2e/ai-index-manager.spec.js`（如现有 reader spec 不适合扩展）：桌面/移动视觉与交互验收。
- `docs/FNOS_DEVICE_ACCEPTANCE.md`、`docs/superpowers/progress/`：真机验收步骤和证据。

## Implementation Tasks

### Task 1：补齐可追溯索引时间，不迁移旧数据

**Files:**

- Modify: `app/server/ai-index-manager.js:248-306,486-546`
- Modify: `app/ui/reader/ai-index-manager.js:62-99`
- Modify: `tests/ai-index-manager.test.js`
- Modify: `tests/dom-regression.test.js`

**Interfaces:**

`inspectIndexFile(filePath)` 新增只读字段：

```js
{
  bookId, status, exists, sizeBytes,
  modifiedAt: '2026-09-22T00:52:04.000Z' | null,
  metadata
}
```

`listIndexes()` 对每个物理索引返回：

```js
{
  indexedAt: manifestEntry?.indexedAt || inspection.modifiedAt || null,
  indexedAtSource: manifestEntry?.indexedAt ? 'manifest' : inspection.modifiedAt ? 'file-mtime' : null
}
```

**Steps:**

- [ ] 为“有 manifest 时间”“无 manifest 的有效 SQLite”“缺失文件”“符号链接/目录”写测试；断言只有常规文件返回 ISO `modifiedAt`，读取列表不创建或改写 manifest。
- [ ] 运行 `node --test tests/ai-index-manager.test.js`，确认新增用例在实现前失败。
- [ ] 在已获得 `lstat` 的安全常规文件路径上保存 `stat.mtime.toISOString()`；所有早退/异常分支明确返回 `modifiedAt: null`。
- [ ] 在 `listIndexes()` 中优先使用 manifest 的 `indexedAt`，否则使用检查结果的 `modifiedAt`；不改变 `recordBuildSuccess()` 的写入时机。
- [ ] 前端将时间统一显示为“更新于 {本地化时间}”；`indexedAtSource === 'file-mtime'` 时添加 `title="索引清单缺少建立记录，显示索引文件最后更新时间"`，不展示技术状态给普通用户。
- [ ] 运行 `node --test tests/ai-index-manager.test.js tests/dom-regression.test.js`，并执行 `git diff --check`。

**Acceptance:** 截图中全部现有的 SQLite 索引都有时间；新建索引仍显示 manifest 记录的精确建立时间；打开索引管理器不会改动磁盘上的 manifest。

### Task 2：收敛为紧凑、统一的索引管理 sheet

**Files:**

- Modify: `app/ui/index.html:235-248,252-264`
- Modify: `app/ui/styles.css:1229-1395,3290-3325,4995-5037`
- Modify: `app/ui/reader/ai-index-manager.js:43-99`
- Modify: `tests/dom-regression.test.js`
- Test: `e2e/ai-index-manager.spec.js` or focused additions to `e2e/reader.spec.js`

**Design contract:**

- AI 问书和索引管理器的关闭按钮都使用 `ai-icon-button ai-surface-close`，30 × 30px、相同字号、悬停/焦点/按下状态和无障碍名称。
- 为避免 `.settings-header button::before` 与实际 `×` 重复，`.settings-header .ai-surface-close::before { content: none; }`；关闭按钮自己包含字符 `×`。
- 索引管理器桌面宽度从 460px 收敛到 `min(400px, calc(100vw - 116px))`；取消继承的固定底边，使用内容自适应高度与 `max-height: min(72vh, 620px)`。
- 列表改为垂直 flex 流，或等价设置 `align-content: start`/`grid-auto-rows: max-content`；索引卡只能按内容高度渲染，列表自身在达到 `max-height` 后滚动。
- 每张卡保留三层信息：标题+状态、格式+容量+时间、删除操作。卡片 padding 12px、间距 8px，状态与操作保持不小于现有可点击尺寸。
- 正常加载完成后不再视觉显示“状态已更新。”空状态行；该状态仍通过 `aria-live` 传达。加载、错误和警告保持可见。

**Steps:**

- [ ] 写 DOM 回归断言：两个关闭按钮都有 `ai-surface-close`，索引管理器 close 的 `aria-label` 不变；CSS 有 `.settings-header .ai-surface-close::before` 的去重覆盖及紧凑列表的非拉伸规则。
- [ ] 写浏览器测试：3 条索引卡的实际高度不因容器剩余高度增加；30 条索引时仅列表滚动；375px 宽度下底部操作和关闭按钮可见、可点。
- [ ] 更新 markup，使两个关闭按钮使用相同的语义类与可见 `×`；不改动其监听器或 surface controller。
- [ ] 调整 CSS sheet、列表和卡片；仅覆盖 `.ai-index-manager-*` 与新增共享 close 类，避免改变目录、书签、标记与想法、显示设置的既有尺寸。
- [ ] 调整 `renderAiIndexManager()` 的详情 DOM，使无时间时保留稳定的元信息布局；错误/加载状态不被压缩隐藏。
- [ ] 运行 `node --test tests/dom-regression.test.js` 和 focused Playwright；在浅色、深色、桌面、移动端各保存一张验收截图。

**Acceptance:** 关闭按钮与 AI 问书视觉和键盘行为一致；索引卡不再占满面板高度；3 条索引在单屏内可读，30 条索引只让列表滚动；不影响其它 reader surface。

### Task 3：在健康书库扫描后自动清理孤儿索引

**Files:**

- Modify: `app/server/ai-index-manager.js:420-484`
- Modify: `app/server/index.js:78-126`
- Modify: `tests/ai-index-manager.test.js`
- Modify: `tests/ai-index-api.test.js`

**Interfaces:**

扩展内部 cleanup 结果，保持既有 `deleted`、`skipped`、`bytesFreed` 字段兼容：

```js
{
  kind: 'orphans',
  deleted: [{ kind: 'orphan', bookId }],
  skipped: [{ kind: 'orphan', bookId, reason: 'INDEX_BUSY' }],
  manifestRemoved: ['<bookId>'],
  bytesFreed: 0
}
```

`runLibraryScan()` 在返回值的 `scan.indexCleanup` 中仅公开计数，不公开文件路径：

```js
{
  attempted: true,
  deletedCount: 2,
  skippedCount: 1,
  manifestRemovedCount: 1,
  bytesFreed: 1048576
}
```

**Steps:**

- [ ] 为 `cleanup({ kind: 'orphans' })` 写失败测试：当 libraryIndex 不包含一个物理 SQLite 或 manifest-only entry 时，物理文件及 manifest entry 都会移除；当前书籍 ID、非法文件名、目录、符号链接和非 SQLite 文件不被触碰。
- [ ] 为 build/read lease 写测试：孤儿索引处于读取或构建时返回 `INDEX_BUSY`，物理文件/manifest 保留；第二次清理在 lease 释放后成功。
- [ ] 在 `runLibraryScan()` 集成前写 API 测试：删除测试书文件并 `POST /api/library/scan` 后，索引消失；扫描出现 error/rootErrors、`loadConfiguration()` 存在 rejectedRoots 时，索引保留；再次健康扫描会重试先前 busy 的项。
- [ ] 修改 `cleanup()`：在健康扫描提供的当前书籍集合中识别所有不再存在的 canonical bookId；先经 `deleteIndex()` 删除物理索引，再清理无物理文件但仍存在的孤儿 manifest entry；复用 lease、类型和路径检查。
- [ ] 修改 `runLibraryScan()`：扫描完成后，只有 `isHealthyLibraryIndex(index)`、`rootDiagnostics.rejectedRoots.length === 0` 且新库索引已原子保存时，调用 `aiIndexManager.cleanup({ kind: 'orphans', libraryIndex: index.books, scanHealthy: true, confirm: true })`。将清理结果的计数写入 `index.scan.indexCleanup` 并通过第二次原子 `saveLibraryIndex()` 持久化；清理异常记录为诊断信息，不使已成功的书库扫描失败。
- [ ] 确保任何“busy/清理异常/进程在清理前重启”都可由下次健康扫描再次发现并重试：每次清理都以当前 `libraryIndex` 全量确认孤儿，而不是只依赖上一次扫描差异。
- [ ] 运行 `node --test tests/ai-index-manager.test.js tests/ai-index-api.test.js tests/search-api.test.js tests/book-search.test.js tests/security.test.js`。

**Acceptance:** 删除书籍后的一次健康扫描自动释放索引空间；扫描或根目录状态不可靠时零删除；正在使用的索引不被删；下次健康扫描能完成重试；原书、用户状态和当前书籍索引均不受影响。

### Task 4：管理员反馈、回归、真机与发布

**Files:**

- Modify: `docs/FNOS_DEVICE_ACCEPTANCE.md`
- Modify: `docs/superpowers/progress/2026-09-21-ai-index-manager-progress.md`
- Modify: `docs/superpowers/specs/2026-09-21-ai-index-manager-design.md`（把“首版不自动清理”替换为已批准的健康扫描策略）
- Test: complete Node suite and relevant Playwright suite

**Steps:**

- [ ] 验证书库扫描 API 返回并持久化的 `scan.indexCleanup` 只有计数与字节数，不含服务器路径、bookId、原书内容或 API Key。
- [ ] 验证删除单本索引仍只删除索引、全文搜索/AI 问书会按需重建；验证手动“清理孤儿与临时文件”与自动清理幂等。
- [ ] 执行 `npm test`、`npm run check`、结构校验、focused Playwright 和 `git diff --check`；记录任何现有无关失败，不把它们标记为本任务通过。
- [ ] 构建 FPK，校验 SHA-256 和 build provenance；安装到 fnOS 后创建索引、删除书籍文件、运行书库扫描，确认索引文件和 manifest 条目消失。
- [ ] 在 fnOS 上模拟不可访问书库根或制造扫描错误，确认索引仍保留；恢复根目录后再次扫描，确认自动清理恢复。
- [ ] 更新进度记录，附上命令输出、FPK 版本、SHA-256、真机结果和未解决问题。

**Acceptance:** UI、API、索引生命周期和 fnOS 真机证据全部通过后再标记完成；设备验收工具仍随 FPK 提供，直到用户明确要求移除。

## Execution Order and Stop Gates

1. 先完成 Task 1，确认所有时间来自只读数据且没有 manifest 副作用。
2. 再完成 Task 2；若任何非索引 reader surface 的视觉/键盘回归出现，停止并缩小 CSS 选择器。
3. 再完成 Task 3；若 fail-closed 条件无法同时覆盖扫描错误和 rejected root，禁止启用自动删除。
4. Task 4 只在 Node 与浏览器回归通过后进入 fnOS；真机验证不通过不得打包为发布版。

## 非目标

- 不改变书籍 ID 规则；当前路径变更会产生新 ID，旧索引将在下一次健康扫描作为可重建孤儿清理。
- 不实现书籍文件的应用内删除按钮。
- 不自动删除用户阅读数据或 AI 会话。
- 不实现索引配额、LRU、VACUUM、WAL、后台定时任务或文件系统监听。
- 不为索引管理器新增前端框架、图标依赖或全局 modal 管理器。

## Research References

- [Apple Human Interface Guidelines — Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Apple Human Interface Guidelines — Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
- [Apple Human Interface Guidelines — Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [Calibre: book deletion trigger pattern](https://github.com/kovidgoyal/calibre/blob/master/src/calibre/library/database.py#L3183-L3207)
