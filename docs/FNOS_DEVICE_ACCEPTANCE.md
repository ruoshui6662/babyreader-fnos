# BabyReader fnOS 真机验收矩阵

本文把“真机可用”拆成可重复采证的契约。任何正式版本进入 `main` 前，至少在一台 x86_64 和一台 ARM64 fnOS 设备上分别完成一次。

## 1. 验收原则

- 架构差异只允许来自宿主和 Node 运行时，不允许应用 JavaScript 代码出现架构分叉。
- 先验证进程/Socket，再验证 Gateway，再验证 ACL 和多用户，最后验证升级持久化。
- 每次验收记录：Git commit、版本 tag、FPK SHA-256、设备架构、fnOS 版本、Node 版本、结果与日志。
- Windows/Linux 单元测试通过不能替代真机 Gateway、ACL、应用中心升级流程。

## 2. 自动采集

验收脚本作为临时设备验收工具随当前候选 FPK 提供，安装后位于 `target/docs/fnos-device-acceptance.sh`。直接在设备上执行：

```sh
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check | tee /tmp/acceptance-x86.txt
```

ARM 设备同样执行并保存为 `/tmp/acceptance-arm64.txt`。脚本自动检查 CPU 架构、Node.js 22、生命周期状态、`app.sock`、Unix Socket health、无 Gateway 身份时的 401、运行目录与授权书库 ACL。也可以从已写入 `PATH` 的源码 checkout 运行，但正式验收优先使用 FPK 内的副本。

该脚本仅用于本轮 FPK 的真机验收，不属于长期运行功能。完成 x86_64/ARM64、Gateway、ACL、升级和 SQLite FTS 验收后，应从构建脚本和 FPK 中移除，并保留源码仓库版本用于后续候选包验收。

## 3. Gateway 验收

Gateway 是宿主契约，必须从真实 fnOS 桌面入口进入，不能只用 Unix Socket 模拟。

1. 从 fnOS 桌面打开 BabyReader。
2. 浏览器 Network 中确认请求路径为 `/app/babyreader-fnos/api/session`。
3. 返回必须为 200，并包含当前登录用户对应的 `uid`、`username`、`isAdmin`。
4. 普通用户与管理员分别验证一次。
5. 切换两个 fnOS 用户，确认返回 UID 不同，并且阅读进度/划线互不可见。
6. 直接访问 Unix Socket、不给 `X-Trim-Userid` 时必须为 401；这项由自动脚本覆盖。

若要命令行采证，可在本机临时导出当前登录 Cookie 后运行：

```sh
BABYREADER_GATEWAY_URL="https://你的-fnOS-地址" \
BABYREADER_GATEWAY_COOKIE="实际登录 Cookie" \
sh scripts/fnos-device-acceptance.sh check
```

Cookie 不得提交到 Git、报告、日志或 CI。

## 3.1 AI 真实供应商连接验收

AI 设置和问答的固定夹具测试不会访问真实供应商。配置真实 AI 服务后，从 fnOS Gateway 会话执行独立连接测试；该命令使用服务端已经保存的配置和 API Key，不在命令行、脚本参数或日志中接收/打印 API Key，也不携带书籍内容、选中文本或对话历史：

```sh
BABYREADER_GATEWAY_URL="https://你的-fnOS-地址" \
BABYREADER_GATEWAY_COOKIE="实际登录 Cookie" \
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh ai-test
```

通过标准：

- 返回 `PASS | authenticated fnOS AI provider connection test returned 200`；
- 服务端已保存的 URL、模型和 API Key 能完成最小 Responses API 测试；
- 测试请求不包含书籍内容、选中文本和历史对话；
- Cookie 和 API Key 不出现在终端输出、验收文件、Git 或应用日志中。

失败时先在 AI 设置中使用“测试连接”确认 URL、模型和 Key，再检查 DNS、出口网络、供应商配额和模型权限。不要把 API Key 作为脚本参数传入；完成验收后立即清除当前终端变量和临时 Cookie。

## 3.1.1 书籍导入前置条件探测（MOBI/导入计划 Task 0）

以 root 在 NAS 上执行（共享目录写入检查需要 `runuser` 切换到包用户），并用管理员账号的登录 Cookie：

```sh
BABYREADER_GATEWAY_URL="https://你的-fnOS-地址" \
BABYREADER_GATEWAY_COOKIE="实际登录 Cookie" \
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh import-probe
```

- 共享目录：以包用户身份创建并删除一个隐藏探测文件，并输出目录属主、权限和 ACL。
- 网关请求体上限：依次发送 1/16/64/256 MiB 的无效 JSON（可用 `BABYREADER_PROBE_SIZES_MIB` 调整）到书库偏好接口。该接口解析失败即拒绝，不会写入任何数据。响应是应用的 JSON 错误，说明网关已转发；否则记录网关返回的状态码和响应片段。
- 请把完整输出（先删掉 Cookie）回填到 `docs/superpowers/progress/2026-09-30-mobi-and-book-import-progress.md`。

## 3.2 PDF 结构化问书候选验收

PDF 结构化检索目前由 `BABYREADER_ENABLE_PDF_AI_STRUCTURE` 控制，默认必须保持关闭。此项不是普通用户设置，不得通过生产 `settings.json` 或包内默认环境开启。

仅在隔离测试包/测试实例上验收：

1. 使用无版权合成 PDF；不要用用户书籍或真实研究材料向供应商试发。
2. 保持默认关闭，确认 PDF 原 FTS payload 与现有请求一致，EPUB 不产生 PDF 结构字段。
3. 测试实例显式开启开关后，验证目录提取、一次画像、缓存命中、FTS 原页引用、取消及文件指纹变化；外部供应商请求只能由 mock 拦截，真实用户材料供应商调用需另获明确授权。
4. 记录首次画像输入字符、请求数和总耗时、缓存命中请求数、回答证据字符数、进程峰值内存以及各问题类型页召回。合成集只代表固定夹具，不可当成真实问答准确率。
5. 测试完将开关恢复为默认关闭并重启测试实例，确认普通术语查找回到现有 FTS 路径，缓存无需迁移数据库即可失效/清理。

Windows 本地测试不验证 Unix `0700/0600` 权限；必须在 Debian 12/x86_64 和目标 ARM64 fnOS 上确认 PDF AI cache 根目录为 `0700`、JSON 文件为 `0600`，并检查索引删除后的缓存清理及错误隔离。结构化 AI 功能在这项 Linux 权限、NAS 资源和真机回滚门禁全部通过前，不得默认启用。

若当前安装包包含 `target/tests/pdf-ai-*.test.js`，可先在 NAS 终端运行以下隔离回归。它只复制合成夹具和测试入口到 `/tmp`，加载已安装的服务模块；测试将 AI 响应拦截为 mock，使用独立临时书库与缓存，不读取应用书库、用户 PDF、AI Key 或现有会话，也不改变运行中服务的开关。请回传测试输出中的通过/失败/跳过数量；不要回传真实书籍或凭据。

```sh
set -eu
APP_ROOT=/var/apps/babyreader-fnos/target
NODE_BIN=/var/apps/nodejs_v22/target/bin/node
TASK_ROOT=$(mktemp -d /tmp/babyreader-pdf-ai-check.XXXXXX)
cleanup() {
  rm -f -- "$TASK_ROOT/app/server" "$TASK_ROOT/tests/pdf-ai-context.test.js" \
    "$TASK_ROOT/tests/pdf-ai-profile.test.js" "$TASK_ROOT/tests/pdf-ai-retrieval.test.js" \
    "$TASK_ROOT/tests/pdf-ai-api.test.js" "$TASK_ROOT/tests/fixtures/pdf-fixtures.js" \
    "$TASK_ROOT/tests/fixtures/pdf-ai-paper-cases.js"
  rmdir -- "$TASK_ROOT/tests/fixtures" "$TASK_ROOT/tests" "$TASK_ROOT/app" "$TASK_ROOT" 2>/dev/null || true
}
trap cleanup EXIT
test -f "$APP_ROOT/server/pdf-ai-structure.js"
test -f "$APP_ROOT/tests/pdf-ai-api.test.js"
mkdir -p "$TASK_ROOT/app" "$TASK_ROOT/tests/fixtures"
ln -s "$APP_ROOT/server" "$TASK_ROOT/app/server"
cp "$APP_ROOT/tests/pdf-ai-context.test.js" "$APP_ROOT/tests/pdf-ai-profile.test.js" \
  "$APP_ROOT/tests/pdf-ai-retrieval.test.js" "$APP_ROOT/tests/pdf-ai-api.test.js" "$TASK_ROOT/tests/"
cp "$APP_ROOT/tests/fixtures/pdf-fixtures.js" "$APP_ROOT/tests/fixtures/pdf-ai-paper-cases.js" \
  "$TASK_ROOT/tests/fixtures/"
BABYREADER_ENABLE_PDF_AI_STRUCTURE=0 "$NODE_BIN" --test --test-concurrency=1 \
  "$TASK_ROOT/tests/pdf-ai-context.test.js" "$TASK_ROOT/tests/pdf-ai-profile.test.js" \
  "$TASK_ROOT/tests/pdf-ai-retrieval.test.js" "$TASK_ROOT/tests/pdf-ai-api.test.js"
```

此命令在隔离 API 测试进程中验证默认关闭、显式开启、首次画像、缓存复用、无文本与取消回退，并在 Linux 上运行缓存权限断言；它不会把运行中的 BabyReader 服务切到结构化路径。通过后仍须单独记录测试实例的资源用量与关闭回滚，才可讨论生产启用。

## 4. ACL 验收

至少准备两个目录：A 为已授权书库，B 为未授权目录。A 中 EPUB/TXT/Markdown 必须能扫描和打开；B 不得出现在索引中；A 内符号链接指向 B 时不得越权读取；撤销 A 的授权后重新扫描必须报告不可用根目录。

## 4.1 fnOS 自定义授权书库目录

自定义书库目录必须通过 fnOS 应用权限授权，不要直接把未授权路径写入应用配置：

1. 在 fnOS 应用中心打开 BabyReader 的“应用限制 → 访问权限”。
2. 添加测试目录 A，并在目录中准备至少一个 EPUB、一个 TXT 和一个 Markdown 文件。
3. 保存权限。配置回调会把 fnOS 当前授权目录列表原子写入应用私有配置；运行中的服务无需重启，停止的应用也不会因配置操作启动。
4. 回到书库点击“重新扫描”，确认 A 中的书籍出现并可以打开。
5. 从管理员诊断确认 `accessible` 和 `authorized` 根目录数量增加，且没有对应的 `rejected` 项。
6. 在同一册书上验证全文搜索、AI 问书、书签、标注和阅读进度仍可用。
7. 撤销 A 的 fnOS 权限并保存，再次扫描；A 中书籍不得继续被读取，诊断应报告授权根不可用或数量减少。

“重新扫描”会重新读取应用私有配置中的 fnOS 授权目录列表，并再次校验目录的真实路径、类型和访问权限，不会绕过 fnOS 权限。若私有快照尚不存在，服务兼容使用启动时的 `TRIM_DATA_ACCESSIBLE_PATHS`。回调将授权路径写入 `$TRIM_PKGETC/fnos-authorized-roots.json`，权限为 `0600`；配置损坏时不采用旧环境中的目录列表。

启动脚本会把 fnOS 注入的 TRIM_DATA_ACCESSIBLE_PATHS 和 TRIM_DATA_SHARE_PATHS 原样传给 Node 服务，不会清空、扩权或替换这些值。验收脚本在提供管理员 Gateway 会话时，会额外读取 /api/diagnostics 的 rootCounts，只输出数量和状态，不输出根目录列表。

验收记录只保存根目录数量、状态和错误类型，不把 API Key、Cookie、书籍正文或不必要的用户路径写入报告。

## 5. SQLite FTS 验收

`check` 命令现在会自动验证 Node 22 的 `node:sqlite`、SQLite FTS5 能力，以及已有 AI 索引的表结构、临时文件和权限：

```sh
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check | tee /tmp/acceptance-ai-fts.txt
```

如果设备尚未对任何书籍提问，脚本会跳过索引文件检查，但仍会验证 FTS5 运行时。先在阅读器中打开《吃的营养科学观》并提问一次，再重新执行 `check`。通过标准：

- FTS5 内存表创建成功；
- `ai-index` 下的 SQLite 文件可正常打开；
- 索引包含 `ai_meta`、`ai_chunk_text` 和 `ai_chunks`；
- 索引文件权限为 `600`，索引目录权限为 `700`；
- 不存在遗留 `.tmp` 文件；
- 中文问题可以返回书本片段和对应来源章节。

应用在每次读取或生成索引时都会重新收紧权限，因此升级后再次提问即可修正历史上已经生成的 `644` 索引文件。

## 5.1 AI 索引管理器验收

管理员在 AI 设置中打开“管理本地检索索引”，确认索引管理器是独立 surface，并且不会替换或清空当前 AI 对话。普通用户不显示入口；直接请求管理 API 必须返回 403，未带 fnOS 身份必须返回 401。

管理员依次验证：

1. 索引列表只显示书名、格式、状态、大小和时间，不显示原书路径、正文、搜索词、API Key 或 SQLite 原始错误。
2. 删除单本 ready 索引后，下一次全文搜索或 AI 问答能够按需重建。
3. 构建或读取进行中删除同一本索引时，界面显示忙碌，不删除文件。
4. 清理孤儿与临时文件需要二次确认；书库扫描失败或 completed-with-errors 时，孤儿清理返回失败且不删除任何文件。
5. 重新打开管理器后，列表会重新从服务端读取；失败时可重试，不残留重复 surface。
6. 重启服务后，索引仍可读取；manifest 损坏时只恢复管理元数据，不删除可用 SQLite 文件。
7. 删除授权书库中的一本书后运行一次健康书库扫描，确认对应 SQLite 索引和 manifest 条目自动消失；扫描返回的 `scan.indexCleanup` 只包含 `attempted`、删除/跳过/manifest 数量和 `bytesFreed`，不包含路径、bookId、正文或 API Key。
8. 临时断开或移除一个书库根目录后运行扫描，确认索引保留；恢复根目录并再次健康扫描，确认孤儿清理恢复。旧索引没有 manifest 建立记录时，列表仍显示文件更新时间。

通过标准：

- ai-index 目录权限为 700；
- SQLite 索引和 manifest.json 权限为 600；
- 没有被活跃构建占用的过期 .tmp 文件可以被清理；
- 管理器任何操作都不会删除原始书籍、阅读进度、书签、标注和 AI 配置；
- 既有全文搜索、AI 问答和阅读器交互保持正常。

## 5.2 AI 会话持久化验收

使用同一本 EPUB 和同一 fnOS 用户完成以下操作，并保存 `/tmp/acceptance-ai-conversations.txt`：

1. 打开 AI 问书，发送一轮问题，等待回答完成；关闭 AI 弹窗后重新打开，确认完整回答、来源章节和当前会话仍在。
2. 打开“会话列表”，确认列表只显示标题、消息数和更新时间；切换另一会话后才加载该会话的完整消息。
3. 清空当前会话，确认服务端成功后消息变为空；模拟断网或服务端错误，确认面板保持打开、原列表保留并出现重试入口。
4. 删除一个非当前会话，确认只删除目标项；删除当前会话后确认应用切换到剩余会话或显示空状态。
5. 切换到另一本书、关闭书籍后重新打开，确认不会显示上一册书的会话；两个 fnOS 用户之间确认会话列表和消息互不可见。
6. 在回答流式输出中刷新/关闭页面，确认未完成的半截回答不会出现在下一次恢复的完整会话中；服务重启后再次确认已完成回答仍可读取。

通过标准：

- 会话文件继续位于用户隔离的数据目录，权限不高于用户目录要求；
- 删除/清空失败不会造成客户端先删后恢复或误清空其他会话；
- API 不接受跨书籍、跨用户的会话标识；
- API Key、原书路径和未授权书籍内容不出现在列表、日志或验收文件中；
- 旧版没有会话数据时，AI 问答、全文搜索、书签、标注和阅读进度仍可正常使用。

## 5.3 书库组织、分类与排序验收

1.1.4 起，正式 FPK 启动时默认开启书库组织功能；仍可通过 `BABYREADER_ENABLE_LIBRARY_ORGANIZATION=0` 显式关闭。验收环境需确认 `/api/library` 返回 `features.libraryOrganization=true`，再执行以下 UI 场景。

服务端先执行只读 dry-run：

```sh
curl -sS -H "Cookie: $BABYREADER_GATEWAY_COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"revision":0}' \
  "$BABYREADER_GATEWAY_URL/app/babyreader-fnos/api/library/organization/reconcile"
```

只有用户确认 dry-run 返回的孤儿数量后，才允许使用当前 revision 加 `"confirm":true` 执行清理。扫描状态不是 `completed` 或存在 root error 时，接口必须返回 503 且组织文件不变。该操作只清理不可用的 bookId 引用，不删除分类、书籍文件、AI 索引、书签、标注、阅读进度或 AI 会话。

启用组织视图后，管理员/普通用户分别验证：

1. “全部书籍 / 我的分类 / 按目录”切换、刷新恢复、独立“重新扫描”入口和返回书库；默认书籍打开入口仍正常。
2. 独立“新建分类”入口不属于视图切换区；创建分类后进入分类，以“添加书籍”选择器加入未分类或其他分类书籍，删除分类后书籍回到“未分类”；两个 fnOS 用户的分类和排序互不可见。
3. 进入“整理”模式后使用桌面拖拽、上移/下移和 ESC 取消；普通模式点击书籍仍打开阅读页。
4. 进入按目录模式后只能进入/返回/打开，不出现移动或删除真实文件的操作；历史状态不含绝对路径。
5. 扫描新增/消失书籍、撤销授权目录、扫描失败和过期 revision；确认分类数据不会被静默清空，409/503 提示可恢复。

通过标准：组织服务不可用时自动回退既有平铺书库；拖拽只修改用户隔离的虚拟顺序，不触碰源文件；所有组织 API 响应不包含绝对路径、用户 ID、正文或凭据。

## 5.4 全书搜索续页与资源验收

开发机合成压力基准（只创建临时 EPUB/SQLite，运行后自动清理；输出仅含计时、计数、索引大小、SQL 计划和进程内存，不输出书名、正文、查询词或路径）：

```sh
node scripts/benchmark-book-search.js
```

分别在 x86_64 与 ARM64 fnOS 设备实测并记录：

1. 使用经授权的长 EPUB，验证跨章节、常见命中、多页续取、稀疏命中跨越 2,000 个候选预算及零结果；续页顺序稳定、无重复/遗漏，查询切换/关闭后旧响应不污染结果。
2. 浏览器 Network 应仅出现当前书籍的本地 `/api/books/:id/search` 请求；不得调用 AI/provider、外网或请求整章内容。
3. 记录 CPU 架构、fnOS/Node 版本、冷/热首屏与续页延迟、候选数量、SQL 查询计划、索引尺寸和 RSS。报告禁止包含原始书名、路径、正文片段、查询词、cursor、请求体、Cookie 或 API Key。
4. 不因慢查询而提高每请求 2,000 个 FTS 候选上限；若设备上延迟或内存不达可接受水平，保留匿名测量并单独评审查询计划/索引策略。

开发机合成基准与浏览器模拟仅作为本地回归证据，不能替代任一架构的 fnOS 实机验收。

## 5.5 AI 章节理解灰度验收

新章节/全书概述策略默认关闭，旧 AI 问答路径保持可用。要在自有设备上试用时，只在当前管理员 shell 临时启用后重启服务：

```sh
export BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING=1
/var/apps/babyreader-fnos/cmd/main restart
```

完成验收后恢复默认关闭并重启：

```sh
unset BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING
/var/apps/babyreader-fnos/cmd/main restart
```

使用已授权 EPUB 与已配置的 AI 供应商验证：

1. 开关关闭时发送普通问题，确认既有 AI 检索、流式回答、来源和会话行为正常。
2. 开关开启后，分别在目录标题明确处询问“本章讲了什么”，以及询问“全书的主要观点是什么”；章节问题必须只读目标逻辑章，全书答案需展示抽样章节数/总章数。
3. 点击所有回答来源，确认只导航到本次服务端给出的书内章节；不存在的引用编号不能生成来源卡片。切换用户/书籍后，不能复用其他用户缓存。
4. 重复同一模型/问题确认缓存命中；切换问题、模型或修改书籍后确认不误用旧最终答案。检查索引权限仍为 `600`、目录为 `700`。
5. 流式生成时点停止，再发一个新问题；确认取消内容没有保存成完整对话/摘要。对 8 章、22,000 字符、8 map task、3,000 字符/task 与 120 秒上限做正常/超限验收。
6. 记录供应商实际 usage、成本和延迟；缺少供应商 usage 字段时只记录产品显示的字符 token 粗估，不以其替代账单成本。验收文档不得写入书名、路径、查询词、正文、Cookie 或 Key。

此开关由 `cmd/main` 传给服务进程；如果设备 supervisor 不继承交互 shell 环境变量，需通过 fnOS 管理方式为该服务设置同名变量，不要编辑应用数据或复制密钥到命令参数。未完成真实授权书籍、AI Key、用量成本和设备延迟验收前，不得将默认值改为开启。

## 5.6 PDF 阅读与本地全文搜索验收

> **v1.3.7 起 PDF、v1.3.8 起 MOBI/AZW3 与管理员导入都已始终开启，应用设置中不再有这些开关。** 下文中“打开开关”的步骤直接跳过；“开关关闭时”的检查改为在测试实例上设置对应的环境变量 `BABYREADER_PDF_ENABLED` / `BABYREADER_MOBI_ENABLED` / `BABYREADER_IMPORT_ENABLED` 为 `0`。升级后旧版本留下的 `*-feature.json` 会被忽略，书库应直接显示 PDF 和 MOBI/AZW3。

PDF 功能默认关闭。管理员在 fnOS 应用中心 → BabyReader → 应用设置中打开“PDF 阅读与全文搜索（验收用）”，刷新 BabyReader，再执行“重新扫描”。配置即时生效，不需要在 SSH 中设置环境变量或手动重启服务。验收结束后在同一设置页关闭开关并刷新应用。不要修改已有书籍、索引或个人数据来制造测试条件。

准备一份合成测试书：

1. 在已授权的书库目录中确认文件名恰为 `BabyReader PDF Acceptance Fixture.pdf` 的合成 PDF 已存在；已有该文件就不要重复创建，也不要覆盖其他书籍。若首次验收需要生成，使用 FPK 中的 fixture 生成器，并把 `PDF_OUT` 设置为该授权目录内**尚不存在**的精确文件名：

```sh
PDF_OUT="/已授权书库目录/BabyReader PDF Acceptance Fixture.pdf"
/var/apps/nodejs_v22/target/bin/node - "$PDF_OUT" <<'NODE'
const fs = require('node:fs');
const { createPdfFixture } = require('/var/apps/babyreader-fnos/target/tests/fixtures/pdf-fixtures.js');
const fd = fs.openSync(process.argv[2], 'wx', 0o644);
try {
  fs.writeFileSync(fd, createPdfFixture({
    pageTexts: ['BabyReaderAcceptanceToken — synthetic local PDF search fixture.']
  }));
} finally {
  fs.closeSync(fd);
}
NODE
```

生成器仅产生文本 PDF，不引用或读取真实书籍；`wx` 拒绝覆盖同名文件。
2. 管理员开启 PDF 验收开关、刷新应用并执行“重新扫描”，确认该合成书出现且可以阅读。
3. 在受信任的 NAS 管理员 shell 中运行检查；Cookie 只留在当前 shell，不复制到命令输出、验收文件或工单：

```sh
read -rsp '当前登录 Cookie（不回显）: ' BABYREADER_GATEWAY_COOKIE
printf '\n'
export BABYREADER_GATEWAY_COOKIE
BABYREADER_GATEWAY_URL="https://你的-fnOS-地址" \
sh /var/apps/babyreader-fnos/target/docs/fnos-device-acceptance.sh check \
  | tee /tmp/acceptance-pdf-x86.txt
unset BABYREADER_GATEWAY_COOKIE
```

脚本通过书名自动找该合成测试书，也可设置 `BABYREADER_PDF_TEST_BOOK_ID` 指定其 64 位书籍 ID。它验证包内 PDF.js Node 解析器与浏览器主模块/Worker 都是 6.3.289、Apache-2.0 许可证文件存在、静态模块/Worker 返回 JavaScript MIME 和限于 same-origin 的 CSP；在授权 Gateway 下验证单字节 Range `206`、open-ended/suffix Range `206`、HEAD/普通小文件 GET、multipart Range `416`，并搜索唯一 token 以检查返回的是不含路径的页 locator。FTS5 及 SQLite 文件权限/临时文件仍由既有检查覆盖。

脚本只有在 `/api/library` 报告 `features.pdfReader=true` 且 Gateway 会话有效时才执行在线 PDF 检查；缺少合成测试书时会输出 `SKIP`，该设备不能记作 PDF 验收通过。通过标准是所有适用 PDF 项均为 `PASS`，无 PDF `FAIL`，并在书架 UI 确认刷新/重新打开后阅读页恢复、点击搜索结果定位到正确页内文本、搜索面板仍保持打开。报告只记录匿名版本/架构/延迟/状态，不保存 Cookie、书名、路径、正文或查询 token。

完成后在应用设置关闭 PDF 开关并刷新；确认 PDF 隐藏，原书库、进度、书签、标注、分类、AI 会话和索引未变化。合成文件可保留供后续验收；如果用户决定清理，只删除这一个精确文件。保留 x86_64 与 ARM64 两份验收记录。当前代码的 PDF 提取/索引资源上限仍是保守临时值，需结合设备冷/热解析时间和可观测进程 RSS 评估；没测到或超过任一上限都不能把该架构标记为通过。

## 5.7 MOBI/AZW3 阅读与书籍导入验收（v1.3.0）

> **v1.3.7 起 PDF、v1.3.8 起 MOBI/AZW3 与管理员导入都已始终开启，应用设置中不再有这些开关。** 下文中“打开开关”的步骤直接跳过；“开关关闭时”的检查改为在测试实例上设置对应的环境变量 `BABYREADER_PDF_ENABLED` / `BABYREADER_MOBI_ENABLED` / `BABYREADER_IMPORT_ENABLED` 为 `0`。升级后旧版本留下的 `*-feature.json` 会被忽略，书库应直接显示 PDF 和 MOBI/AZW3。

两个功能都默认关闭，彼此独立。管理员在 fnOS 应用中心 → BabyReader → 应用设置中打开：

- “启用 MOBI/AZW3 阅读（验收用）”：打开后**必须在书库点一次“重新扫描”**，Kindle 书才会出现（服务启动时不会自动扫描）。
- “允许管理员从浏览器导入书籍”：导入的书保存在应用共享目录 `babyreader-fnos/library/导入` 中，所有用户都能看到。

验收只使用自己有权使用、没有 DRM 的书，或者公有领域的样本（例如 Project Gutenberg 的 Kindle 版本）。不要为了测试去修改已有的书、索引或个人数据。

**0. 前置探测**（先做）：按 3.1.1 运行 `import-probe`，记录两件事：包用户能否写入共享目录，以及网关能转发多大的请求体。如果 16 MiB 的请求体就被网关拦下，大文件导入就需要分片上传，这时先记录结果，暂停第 4、5 步，等补丁版本出来再测。

**1. 扫描与可见性**

- 开关关闭时：书库提示“另有 N 本 MOBI/AZW3”，书架上看不到这些书；原有的 EPUB、PDF、TXT 书数量和顺序都不变。
- 开关打开并重新扫描后：书卡显示 `MOBI` 或 `AZW3` 标签，有书中自带的封面；受 DRM 保护的书不出现在书架上，只计入“N 本 Kindle 书受 DRM 保护”；分类编辑仍然正常（DRM 书不会让书库被判为不健康）。

**2. 阅读**：打开一本 MOBI 和一本 AZW3，检查以下几项：

- 第一次打开时，可能先出现“正在准备这本书，请稍候…”，随后自动打开；
- 目录可以跳转到后面的章节；
- 正文、图片、斜体等格式正常；
- 可以划线和写想法；
- 返回书库后刷新页面，从“继续阅读”能回到原来的位置；
- 全文搜索能命中正文，点击结果能跳过去；
- 配置了 AI 时，可以就书的内容提问。

记录第一次打开的耗时。转换后的文件在 `/var/apps/babyreader-fnos/var/derived/` 下，文件权限应为 `600`。

**3. 资源**：选一本正文较大的书（例如一部长篇小说）第一次打开，同时观察服务进程的内存和耗时。转换在独立线程中进行，堆内存上限 256 MiB、超时 60 s。正文超过 32 MiB 的书会明确提示“过大”。把 x86_64 和 ARM64 上测到的数值记录下来，用来最终确定资源上限。

**4. 导入**（管理员账号，打开导入开关后刷新页面）：

- 工具栏依次为：新建分类 → 导入 → 重新扫描 → 整理。普通用户看不到“导入”。
- 分别用“导入”按钮和拖放导入 EPUB、PDF（需要先打开 PDF 开关）、TXT 和 MOBI（需要先打开 MOBI 开关）各一本。检查以下几项：
  - 进度条正常推进；
  - 书立即出现在书架上；
  - 在 fnOS 文件管理器中，`babyreader-fnos/library/导入` 目录下能看到这个文件；
  - 用另一个普通用户登录也能看到这本书。
- 再次导入同一个文件，应提示“书库中已有这本书”，并提供“打开”。
- 导入一个同名但内容不同的文件，应保存为“xxx (2)”。
- 导入 `.exe`、改了扩展名的非书籍文件、带 DRM 的 AZW，都应该被拒绝，并给出明确原因。
- 在某个分类页里导入，书应自动出现在这个分类中。
- 上传过程中点“取消”，或者直接关闭网页，`导入` 目录里不应留下 `.babyreader-import-*.part` 临时文件。
- 按第 0 步测得的网关上限，分别导入一个略小于和一个略大于上限的文件，记录两次的实际表现。

**5. 升级与回退**：

- 在 1.2.0 上已经有阅读进度和划线的情况下，升级到 1.3.0：原有数据应保持不变（按第 7 节做 before/after snapshot）。
- 在 1.3.0 上读过 MOBI、导入过书之后，降级回 1.2.0：原有的 EPUB、PDF、TXT 应不受影响；Kindle 书被忽略；导入的 EPUB、PDF、TXT 因为就在共享目录里，重新扫描后仍然可以阅读。
- 再次升级到 1.3.0 并打开 MOBI 开关后，之前的 MOBI 阅读进度和划线仍然有效（它们按书籍 ID 保存）。

## 6. Socket 与生命周期验收

```sh
/var/apps/babyreader-fnos/cmd/main status
```

自 v1.3.6 起，PID 文件缺失或指向其他进程时，`cmd/main` 会扫描进程表，查找参数为本包 `server/index.js` 的进程，找到后重新写入 PID 文件。因此由 fnOS 监管启动的服务也应返回 status=0。若仍出现 `status` 返回 3 但目标 socket 与健康接口正常，请记录 `ps -ef | grep "[s]erver/index.js"` 的输出以便排查，并以 fnOS 监管状态及健康接口为准；不要在 SSH 中直接运行 `cmd/main restart`，应通过应用中心管理服务生命周期。

通过标准：优先检查运行时 status=0；如果 fnOS 外部监管模式下 `cmd/main status` 返回 3，但 `target/app.sock` 存在且 Unix Socket health 返回 200，则按“服务已运行、状态命令未接管 PID”的兼容情况通过；若 Socket 或 health 失败仍判定失败。停止时 status=3；`target/app.sock` 随服务创建/删除；进程指向 `target/server/index.js`；日志写入包变量目录。

## 7. 升级持久化验收

升级前用两个用户分别写入阅读进度和划线，然后：

```sh
sh scripts/fnos-device-acceptance.sh snapshot /tmp/babyreader-before.txt
```

通过应用中心升级 FPK，不要卸载重装。升级后、不继续阅读或修改状态时：

```sh
sh scripts/fnos-device-acceptance.sh snapshot /tmp/babyreader-after.txt
sh scripts/fnos-device-acceptance.sh compare \
  /tmp/babyreader-before.txt /tmp/babyreader-after.txt
```

随后人工确认两个用户的进度和划线仍然存在。若未来包含显式状态迁移，快照允许变化，但必须有迁移说明和测试。

## 8. 发布验收表

| 项目 | x86_64 | ARM64 | 证据 |
| --- | --- | --- | --- |
| 安装 FPK | 待验 | 待验 | 安装日志 |
| Node 22 | 待验 | 待验 | acceptance report |
| main start/status/stop | 待验 | 待验 | acceptance report |
| app.sock | 待验 | 待验 | acceptance report |
| health via socket | 待验 | 待验 | acceptance report |
| Gateway UID/admin | 待验 | 待验 | Network/JSON 记录 |
| 两用户隔离 | 待验 | 待验 | 两用户状态记录 |
| 授权目录 ACL | 待验 | 待验 | 扫描结果 |
| 未授权/符号链接拒绝 | 待验 | 待验 | 扫描/错误记录 |
| SQLite/FTS5 运行时 | 待验 | 待验 | acceptance-ai-fts.txt |
| AI 索引表结构与权限 | 待验 | 待验 | acceptance-ai-fts.txt |
| AI 真实供应商连接 | 待验 | 待验 | ai-test 输出 |
| AI 章节/全书概述灰度策略与缓存 | 待验 | 待验 | 仅记录匿名范围、usage/成本与延迟 |
| AI 索引管理器管理员边界 | 待验 | 待验 | API/UI 记录 |
| AI 索引删除/孤儿清理保护 | 待验 | 待验 | API/UI 记录 |
| 书库组织 API dry-run/确认清理 | 待验 | 待验 | Gateway JSON 记录 |
| 分类导航与用户隔离 | 待验 | 待验 | 两用户 UI/JSON 记录 |
| 整理模式拖拽与键盘排序 | 待验 | 待验 | Chromium/fnOS 操作记录 |
| 按源目录只读浏览与路径脱敏 | 待验 | 待验 | UI/Network 记录 |
| 全书搜索续页、跨章节命中与本地/AI 网络隔离 | 待验 | 待验 | Chromium + Gateway Network 记录 |
| 全书搜索冷/热延迟、候选预算与 RSS | 待验 | 待验 | 合成基准 + fnOS 实测 |
| PDF.js 精确版本、Node parser 与浏览器 Worker 配对 | 待验 | 待验 | acceptance 输出 + 包内 provenance |
| PDF 本地资源 MIME/CSP 与无 CDN 回退 | 待验 | 待验 | authenticated Gateway response headers |
| PDF 授权 Range GET（closed/open/suffix/HEAD/full）、416 与断连 | 待验 | 待验 | synthetic fixture acceptance 输出 |
| PDF FTS 页 locator、image-only/超限错误与 SQLite 权限 | 待验 | 待验 | synthetic fixture + acceptance 输出 |
| PDF 资源上限冷/热耗时与 RSS | 待验 | 待验 | x86_64/ARM64 匿名设备数据 |
| 健康扫描后的书籍-索引联动 | 待验 | 待验 | scan.indexCleanup 与索引目录记录 |
| manifest/临时文件恢复 | 待验 | 待验 | 重启与清理日志 |
| 导入前置：共享目录可写、网关请求体上限 | 待验 | 待验 | `import-probe` 输出 |
| MOBI 开关关/开的书库可见性与 DRM 计数 | 待验 | 待验 | 书库截图 + `/api/library` features |
| MOBI/AZW3 打开、目录、划线、进度、搜索、AI | 待验 | 待验 | 操作记录与截图 |
| MOBI 首次转换耗时、峰值内存与 `derived/` 权限 | 待验 | 待验 | x86_64/ARM64 匿名设备数据 |
| 管理员导入（按钮/拖放/重复/同名/拒绝/分类/取消） | 待验 | 待验 | 操作记录 + `导入` 目录清单 |
| 普通用户看不到导入、能看到导入的书 | 待验 | 待验 | 两用户截图 |
| 1.2.0 → 1.3.0 升级与回退到 1.2.0 | 待验 | 待验 | before/after snapshot |
| 原版本 → 新版本升级 | 待验 | 待验 | before/after snapshot |
| 阅读进度/划线保留 | 待验 | 待验 | 两用户人工复核 |

只有两列全部通过，才把对应 commit/tag 标记为真机验收完成。

## 8.2 最新自定义目录真机反馈

- 自定义目录扫描：正常。
- 自定义目录删除流程：正常。
- 记录性质：用户实机回归反馈，作为本功能的正向验收证据。
- 尚未由本条反馈覆盖的项目：CPU 双架构矩阵、Gateway 多用户隔离、升级持久化，以及撤销目录授权后重启并再次扫描的完整日志。
