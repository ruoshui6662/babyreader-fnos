# AI 索引管理器技术规格

状态：已批准，尚未执行。

日期：2026-09-21

## 1. 目标

为 BabyReader 提供一个可控、可诊断、不会误删用户书籍和 AI 配置的本地 AI 索引管理器。它只管理服务生成的 SQLite FTS5 索引，不改变阅读器、书库、书签、标注、笔记、全文搜索和 AI 问答的既有协议。

第一版解决四件事：

1. 展示当前索引数量、健康状态、占用空间、索引时间和最近使用时间。
2. 删除单本书的索引，使下次 AI 检索或全文搜索按需重建。
3. 清理已经不在当前书库中的孤儿索引，以及安全 TTL 之前遗留的临时文件。
4. 在并发检索、构建、服务重启和异常中止时保持索引可恢复，不损坏现有可用索引。

第一版不追求自动空间配额、后台 LRU 淘汰、全文内容预览、跨设备同步或索引格式迁移。

## 2. 当前架构边界

当前服务将每本书的索引保存为：

    TRIM_PKGVAR/ai-index/<bookId>.sqlite

当前 SQLite 结构由 app/server/ai-fts.js 创建，包含 ai_meta、ai_chunk_text 和 FTS5 虚拟表 ai_chunks。索引元数据保存 schemaVersion、bookId 和 fingerprint。索引构建使用进程内 buildLocks，并生成临时文件后发布。

当前问题与风险：

- 索引目录没有统一的元数据清单，无法可靠区分 ready、building、stale、orphan 和 corrupt。
- 管理器若只扫描文件，不能识别正在构建或正在读取的索引。
- 当前发布路径存在先删除旧文件、再重命名临时文件的窗口；发布失败时可能丢失原本可用的索引。
- 检查 SQLite 文件必须使用只读打开，不能因检查不存在的索引而意外创建空数据库。
- 当前索引是全局共享资源，不能按普通用户开放删除和清理。
- 当前库扫描只支持 EPUB、Markdown 和 TXT；本功能不扩大格式支持范围。

## 3. 核心决策

### 3.1 存储模型

继续使用“一本书一个 SQLite 文件”，不迁移到单库多书，也不改变现有索引文件名规则。索引目录新增：

    TRIM_PKGVAR/ai-index/manifest.json

manifest 只保存管理元数据，不保存真实书籍路径、书籍正文、API Key、用户 UID、问答文本、搜索词或选中文本。建议结构：

    {
      "version": 1,
      "entries": {
        "<bookId>": {
          "bookId": "<bookId>",
          "sizeBytes": 3756032,
          "indexedAt": "2026-09-21T05:11:32.835Z",
          "lastAccessedAt": "2026-09-21T05:11:32.835Z",
          "fingerprint": "<content fingerprint>",
          "schemaVersion": 2
        }
      }
    }

运行态字段不写入 manifest，而是由文件、锁和当前操作推导：

- ready：SQLite 文件存在、元数据与 manifest 一致、完整性检查通过。
- building：存在本进程生命周期锁或活跃构建租约。
- stale：文件存在但 fingerprint 或 schemaVersion 与当前书籍不一致。
- orphan：文件名是合法 bookId，但当前健康书库清单中不存在该书。
- corrupt：文件存在但只读打开、所需表、元数据或 FTS5 完整性检查失败。
- missing：manifest 有记录但文件不存在。
- temporary：匹配索引临时文件规则且没有活跃构建租约。

manifest 是可重建的缓存，不是唯一事实来源。文件和健康的书库扫描结果优先；manifest 损坏时管理器应进入可恢复状态，重建元数据清单，但不能凭 manifest 推断路径或删除未知文件。

### 3.2 权限模型

索引管理 API 只允许管理员调用。原因是索引是全局共享资源，删除会影响其他用户的下一次检索性能。

- 非认证请求：401。
- 已认证但非管理员：403。
- 管理员可查看和管理索引。
- 不把管理员判断放到前端；前端隐藏入口只改善体验，服务端必须再次校验。
- 书籍路径只由服务端通过 bookId 和当前 library.json 解析，客户端不能提交路径。

### 3.3 API

新增管理 API：

    GET /api/ai/indexes

返回：

    {
      "items": [
        {
          "bookId": "...",
          "title": "吃的营养科学观",
          "format": "epub",
          "status": "ready",
          "sizeBytes": 3756032,
          "indexedAt": "...",
          "lastAccessedAt": "...",
          "schemaVersion": 2,
          "fingerprint": "短摘要或脱敏标识"
        }
      ],
      "summary": {
        "total": 1,
        "ready": 1,
        "building": 0,
        "stale": 0,
        "orphan": 0,
        "corrupt": 0,
        "missing": 0,
        "temporary": 0,
        "sizeBytes": 3756032
      }
    }

响应不得包含真实文件路径、SQLite 原始错误堆栈、正文或查询内容。fingerprint 仅用于前端识别版本，不用于安全认证；如果实现上无法稳定脱敏，则不返回该字段。

    DELETE /api/ai/indexes/<bookId>

只接受路径中的严格 64 位小写十六进制 bookId。删除前必须取得管理器的删除租约：

- building 或活跃 read lease：409 INDEX_BUSY，不删除。
- ready、stale、corrupt、missing：执行幂等删除。
- 非当前书库的合法孤儿：允许删除。
- 非法 bookId、路径穿越、符号链接目标或目录对象：400 或 409，绝不跟随删除。

    POST /api/ai/indexes/cleanup

请求体只允许：

    { "kind": "orphans" | "temporary" | "all", "confirm": true }

清理规则：

- kind=orphans：只清理健康书库扫描确认的孤儿 SQLite 文件。
- kind=temporary：只清理超过固定安全 TTL 且不在活跃构建中的临时文件。
- kind=all：执行以上两类清理，不包含 ready、stale、corrupt 或 missing 索引。
- confirm 不为 true 时返回 400，不执行任何写操作。
- 书库扫描失败、library.json 损坏或权限无法确认时，清理接口 fail closed，返回 503，不删除任何孤儿文件。
- 不提供无确认的 DELETE /api/ai/indexes 全量删除接口。

建议错误码：

- 401 AUTH_REQUIRED
- 403 ADMIN_REQUIRED
- 400 INVALID_REQUEST 或 INVALID_BOOK_ID
- 404 BOOK_NOT_FOUND（仅在需要校验当前书籍且确实不存在时使用）
- 409 INDEX_BUSY、INDEX_UNSAFE_TARGET
- 503 LIBRARY_SCAN_UNAVAILABLE、INDEX_MANAGER_UNAVAILABLE

### 3.4 生命周期与并发

管理器必须提供跨模块共享的生命周期协调，不能让 ai-fts.js 和管理器各自维护互不知情的锁：

- build lease：同一 bookId 同时只能有一个构建。
- read lease：搜索、AI 检索和完整性检查期间持有读取租约。
- delete：获取排他删除租约；有 build 或 read lease 时返回 409。
- lease 释放必须放在 finally 中。
- 进程重启后，内存租约自然消失；残留临时文件由 TTL 清理处理。
- 首版不引入 WAL，保留 rollback journal，避免额外的 -wal/-shm 生命周期和部署清理复杂度。

书籍删除联动采用“健康书库扫描”边界，而不是文件系统 watcher：扫描成功保存新书库索引后，仅当扫描状态为 `completed`、`errorCount` 为 0、`rootErrors` 为空且配置根目录没有 rejected root 时，服务端自动执行一次已确认的孤儿索引清理。清理只删除服务生成的 `<bookId>.sqlite` 和遗留 manifest 条目，不触碰原始书籍、用户状态或 AI 配置；活跃 build/read lease 返回 `INDEX_BUSY` 并由下一次健康扫描重试。扫描不健康或根目录无法确认时，自动清理完全跳过。

### 3.5 安全发布

索引构建必须保持旧索引优先：

1. 在同一索引目录创建唯一临时文件。
2. 以 600 权限创建和写入临时数据库。
3. 完成 schema、元数据、FTS5 构建、完整性检查和关闭数据库。
4. 将临时文件重命名为唯一备份或采用同目录原子替换策略，不能先删除旧文件再发布新文件。
5. 发布成功后更新 manifest；manifest 更新失败不得删除新索引，下一次启动可扫描恢复。
6. 任何构建或发布失败都保留旧的可用索引，临时文件进入可清理状态。

具体替换实现必须遵守目标平台 rename 语义，并配套测试验证“发布失败旧文件仍在”。若 Windows 和 Linux 的替换语义无法统一，使用带备份后缀的两阶段发布和启动恢复，而不是增加不受控的删除窗口。

### 3.6 空间统计与清理

列表接口展示：

- SQLite 实际文件字节数。
- SQLite page_count、page_size、freelist_count。
- manifest 中的 indexedAt、lastAccessedAt。
- 汇总 total、ready、orphan 等状态数量和总字节数。

首版不自动执行 VACUUM，因为 SQLite 官方说明 VACUUM 可能需要接近两倍临时磁盘空间，且会增加阻塞与失败面。首版不自动切 WAL，不记录逐次访问日志，不对历史问答做清理。

### 3.7 UI

在现有 AI 设置 surface 中增加管理员可见的“本地检索索引”入口。点击后打开独立的 index manager surface，与既有 reader surface controller 复用关闭、焦点、遮罩、Escape、移动端安全区和可访问性行为。

首版界面：

- 顶部标题“本地检索索引”和关闭按钮。
- 概览行：索引数量、总占用空间、异常数量。
- 列表：书名、格式、状态、大小、最后索引时间、最后使用时间。
- 单项操作：删除索引；ready/building 状态显示不可删除或忙碌提示。
- 底部操作：清理孤儿与临时文件；二次确认后执行。
- 不显示路径、不显示正文、不显示查询历史、不允许输入 bookId。
- 请求期间有 loading，失败保留 surface 并提供重试，成功后重新拉取服务端数据。
- 非管理员不渲染入口；服务端 403 时前端显示无权限而不是降级到写操作。

## 4. 明确不做

- 不修改 AI 提示词、模型、API Key 保存方式和问答协议。
- 不修改书签、标注、笔记、阅读进度和书库扫描协议。
- 不增加 MOBI、AZW3、PDF 解析支持。
- 不清理用户原始书籍文件。
- 不删除整个 ai-index 目录。
- 不根据文件修改时间直接删除 ready 索引。
- 不在客户端执行 SQLite、路径拼接或文件删除。
- 不做自动 LRU、自动配额、自动 VACUUM、自动全量重建。
- 不把正文、API Key、用户身份、问答和搜索词写入 manifest 或诊断日志。

## 5. 验收标准

### API 与权限

- 管理员可列出索引，返回状态、统计和书名，不泄露路径和正文。
- 普通用户收到 403，未登录请求收到 401。
- 删除单本索引成功后，下一次搜索/AI 检索可以按需重建。
- build/read lease 活跃时删除收到 409，文件不变。
- cleanup 未确认、书库扫描失败、目标不安全时不发生删除。

### 生命周期与数据安全

- 首次构建生成 600 文件和 700 目录权限。
- 重复构建不会产生无界临时文件。
- 构建失败、完整性检查失败、发布失败时旧索引仍可读取。
- 服务重启后能恢复 manifest 或从文件扫描重建 manifest。
- 临时文件过期后可清理，活跃构建的临时文件不会被清理。
- SQLite FTS5 integrity-check、schema、metadata 不通过时显示 corrupt，不自动删除。
- 健康扫描后的自动清理仅在上述 fail-closed 条件全部满足时执行，并把 `indexCleanup` 作为只含计数与字节数的扫描摘要持久化；清理异常记录诊断但不让成功的书库扫描失败。

### 兼容性

- 既有全文搜索和 AI 问答测试继续通过。
- EPUB、Markdown、TXT 的既有索引行为不改变。
- 非管理员访问阅读、书签、标注、搜索和 AI 设置的既有行为不改变。
- fnOS 上重启服务、更新 FPK、权限检查和真机验收通过。

## 6. 调研依据

- [SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html)：integrity-check、optimize、rebuild 与内容表一致性。
- [SQLite PRAGMA 官方文档](https://sqlite.org/pragma.html)：page_count、page_size、freelist_count、integrity_check、busy_timeout。
- [SQLite VACUUM 官方文档](https://sqlite.org/lang_vacuum.html)：临时空间和重建行为。
- [SQLite WAL 官方文档](https://www.sqlite.org/wal.html)：额外 -wal/-shm 文件与并发取舍。
- [SQLite Atomic Commit 官方文档](https://www.sqlite.org/atomiccommit.html)：同目录发布和原子提交边界。
- [SQLite Locking 官方文档](https://www.sqlite.org/lockingv3.html)：锁和并发读写约束。
- [Node.js 22.18 node:sqlite 官方文档](https://nodejs.org/download/release/v22.18.0/docs/api/sqlite.html)：DatabaseSync、只读打开、参数绑定和当前稳定性。
- [Node.js 22.18 fs 官方文档](https://nodejs.org/download/release/v22.18.0/docs/api/fs.html)：rename 和文件系统并发注意事项。
