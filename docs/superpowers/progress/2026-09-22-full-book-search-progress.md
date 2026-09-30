# 全书搜索完整性进度

**计划：** `docs/superpowers/plans/2026-09-22-full-book-search-completeness.md`
**Task 0 状态：** 完成（合成夹具与代码路径审查；没有访问 NAS 上的真实书籍）

## Task 0 诊断结果

- **首屏截断已复现：** 合成 TXT 有 25 条命中；现接口返回 20 条并将 `truncated` 置为 `true`，没有 cursor 参数/响应可供继续读取。
- **候选预算造成的漏命中已复现：** 前 2,000 个 FTS 候选虽匹配 tokenizer，但原文校验均不匹配；第 2,001 个候选为末章精确命中。当前请求返回 0 条且 `truncated:true`，末章命中不可达。
- **精确导航问题已复现：** 同章两处“蛋白质”，locator 指向第二处；当前 UI 标记第一段。`navigateToSearchResult()` 未将 locator offset 传给文本 Range 查找。
- **EPUB 覆盖夹具结果：** 5 个 spine item 中，嵌套 OPF 路径、`../` 相对 href、URL 编码、查询/fragment 均被正确解析；非 spine 附录不入索引；空内容与缺失资源被跳过。索引含章节序号 0、3、4，末章唯一命中可检索。当前解析路径不会产生跳过原因的可观察诊断。
- **续取候选：** 此合成索引里 `rowid` 顺序与 `(chapterIndex, startOffset, rowid)` 阅读顺序相同；`EXPLAIN QUERY PLAN` 将 `MATCH` + `rowid > ?` 作为 FTS 虚表索引约束处理（测试计划细节为 `SCAN ai_chunks VIRTUAL TABLE INDEX 64:M7>`）。这只是小夹具证据，Task 1 必须在大索引测 seek 成本及顺序不变量，不能据此直接定案。
- **授权复用：** 搜索 API 在既有 Gateway 身份检查后，先通过 `findBook()` 解析授权书籍，再解析搜索参数及访问索引；后续每一页仍必须重复此路径。
- **用户真实书籍：** 当前执行环境无法访问用户 fnOS/NAS 书籍文件，因此不能判定用户所见“临近章节”是否同时有真实 EPUB spine 漏章。未要求用户上传正文；如后续实机诊断，仅收集授权检查后的章节/索引计数和匿名错误码。

## 对已批准搜索 spec 的增补结论

已于 2026-09-22 修订并审阅 `docs/superpowers/specs/2026-09-21-full-text-search-design.md`。分页契约定为每页 1–50 条（默认 20）、增加 `hasMore/nextCursor`，旧 `truncated` 保留且等于 `hasMore`；每次最多处理 2,000 个 FTS 候选块，预算耗尽可返回短页或空页，但游标须跨过已扫描候选。游标绑定书籍、查询摘要、范围、章节、limit 和索引 fingerprint；不携带原始 query、路径或正文，不授权访问；索引变化时以 409 要求重新搜索。保持每本书 FTS、Gateway 与 `findBook()` 每请求鉴权、原文二次校验及无 AI/网络/搜索历史边界。

## Task 1：服务端有界游标分页

**状态：** 实现完成，代码回归通过；尚未进入 Task 2 前端接入。

- `app/server/book-search.js` 增加不超过 512 个 URL-safe 字符的版本化游标；游标只含摘要、索引 fingerprint 摘要和标量位置。非法/超长/越界、不同 book/query/scope/chapter/limit 重用均返回 400；索引指纹变化返回 409。游标不绕过路由原有 Gateway 身份检查和 `findBook()`。
- 用 rowid keyset 代替逐页 `OFFSET`；结果页边界可在当前 FTS chunk 内续读，候选预算耗尽时从最后扫描 rowid 继续；保留 last emitted locator key 以过滤 overlap 重复。
- 成功响应增加 `hasMore`、`nextCursor`，保留 `truncated === hasMore`；不可用响应也明确返回 `hasMore:false`、`nextCursor:null`。API 路由无需变动：现有 `parseBookSearchParams()` 到搜索服务的参数链路已支持 cursor，且每个 HTTP 请求仍经原有授权路径。
- 回归证明：25 条结果能完整跨页；超过 2,000 个 FTS 候选且前段原文均不匹配时，首个空页可续取至末章命中；跨 chunk overlap 多页无重复/遗漏；源文件更新后 cursor 返回 409；畸形、超长、负位置及跨查询/范围/limit/book cursor 被拒绝；API 分页和错用 cursor 返回 200/400。
- 性能/顺序证据：合成 EPUB 验证 rowid 与阅读顺序一致；SQLite `EXPLAIN QUERY PLAN` 对 `MATCH` + `rowid > ?` 显示 `SCAN ai_chunks VIRTUAL TABLE INDEX 64:M7>`。Windows 开发环境的候选上限用例耗时约 0.08–0.23 秒（包含 SQLite/测试夹具开销，不是 NAS 性能验收）；仍需在长书及 fnOS 设备上确认实际续页成本。
- 验证：`node --test tests/book-search.test.js tests/search-api.test.js` 21/21 通过；`npm test` 245 通过、5 跳过、0 失败；`npm run check` 通过（41 项结构文件、9 个生命周期脚本）。测试中已有的预期 400/401/404 日志是受控错误用例，并非失败。

**范围说明：** Task 1 未改前端、索引 schema、AI 检索、阅读器定位，也未打包 FPK。2,000 候选预算仍严格按每个请求执行；目前客户端尚未消费 `nextCursor`，Task 2 前用户界面仍只显示首屏。

## Task 2：前端“加载更多”与请求生命周期

**状态：** 实现完成并通过当前环境验证。

- `app/ui/core/api.js` 的 `searchBook()` 接受可选 `cursor` 并附加到现有同书搜索 API 请求；初次搜索继续使用服务端默认 20 条，不增加客户端 limit。
- `app/ui/reader/search.js` 现在保留 query generation、书籍 ID、cursor 与已渲染结果 ID；续页按服务端顺序追加，按稳定 ID 去重。每次仅允许一个续页请求，续页期间保留当前结果并显示单一“正在加载…”按钮状态。
- 加载失败时保留结果，显示行内错误与“重试加载”；重试使用同一个 cursor。收到新查询、关闭搜索、切换书籍或旧响应返回时，清空/忽略对应状态，防止过期响应污染界面。
- 增加精简的次级样式“加载更多”按钮，并兼容旧服务端：只有同时收到 `hasMore:true` 与有效 `nextCursor` 才开放续取；只有 `truncated:true` 的旧响应仅显示不完整提示，不伪造游标。
- **实现边界决定：** 为让所有统一关闭路径（关闭按钮、Escape、结果跳转）均取消搜索，请在 `app/ui/shell/drawer.js` 的 `closeReaderPanel()` 中只对活动搜索 surface 调用 `resetReaderSearch()`。这是 Task 2 请求生命周期所必需的最小控制器接入；没有更改其它 surface 的关闭逻辑。
- DOM 回归覆盖 adapter 游标传递、连续分页追加/重叠去重、并发点击保护、续取失败重试、查询竞态、关闭/切书旧响应隔离。Chromium E2E 以三页模拟 45 条结果，验证稳定顺序、无重复及不请求 AI/provider；亦覆盖续取失败后重试。
- 验证：定向 DOM 回归 5/5；`npx playwright test e2e/search.spec.js --project=chromium` 9/9；`npm test` 249 通过、5 跳过、0 失败；`npm run check` 通过（41 项结构文件、9 个生命周期脚本）；`git diff --check` 通过。跳过项为 Windows/POSIX 平台限制。

**尚未包含：** Task 4 仅在诊断证明漏章时修 EPUB spine；Task 5 的 NAS 性能/设备验收与获准打包。本阶段未构建 FPK。

**性能决策：** 小型合成索引的 EXPLAIN 和跨预算回归支持 rowid keyset；大索引/FNOS NAS 性能结论仍待 Task 5。若设备级测量证明后续页重复扫描或延迟不可接受，暂停并复核索引排序/必要的辅助索引，不能退回每页 OFFSET 全扫描或放宽 2,000 个候选预算。

## 变更与验证

- 仅新增 `tests/book-search.test.js`、`tests/dom-regression.test.js` 中的合成 EPUB、截断、晚命中及导航表征测试，以及本进度记录；未改生产服务、索引 schema、用户书籍、搜索 API、已批准 spec 或 FPK。
- `node --test tests/book-search.test.js tests/search-api.test.js tests/dom-regression.test.js`：122/122 通过（包含当前工作树中已有的书库/UI 测试改动）。
- `npm test`：242 通过、5 跳过、0 失败（在当前工作树完整验证）。
- `npm run check`：结构验证通过（41 个必需文件、9 个生命周期脚本）；POSIX shell 检查按 Windows portable 模式跳过。
- 跳过项均为既有平台限制或既有可选项（Windows symbolic link 权限、POSIX shell-only 验证）；不是本 Task 新增的失败。

## Task 3：基于 locator 的精确命中导航

**状态：** 实现完成并通过当前环境验证。

- 修复 `findSearchTextRange()` 无条件选首个 `indexOf()` 命中的问题。现在会枚举本章匹配 Range，使用绝对 locator offset 作精确候选，并使用结果已有的短 snippet 上下文在源 offset 与渲染 DOM 有差异时判定实例；若上下文不能唯一确认重复命中，则不标记任意首项，而退回章节/文档起点并显示非阻断提示。
- 映射以规范化（折叠空白、大小写折叠）文本到 DOM Text 节点 UTF-16 边界建立；使用 TreeWalker 的实际 DOM 文本，因此实体已解码；码点迭代记录 UTF-16 长度，支持 emoji/补充平面字符、内联 markup 跨节点及空白/NBSP 归一化。
- 定位器上下文明确：索引 `startOffset` 由 `Array.from()` 码点位置产生，本地 match offset 则是 JavaScript UTF-16 偏移，且 EPUB 原文转 DOM 后段落/头部边界不保证一致；因此 locator 数字偏移是直接映射时的锚点，不可在错位时单独作为事实。结果接口已有有界 snippet 足以提供局部上下文；本任务未扩展 API、未返回/请求整章，也没有用 chunk-local `matchOffset` 冒充章节绝对偏移。
- 阅读定位 helper 现在可用匹配 Range 的第一个布局片段导航：分页模式按命中所在页计算页组（包括双页 spread），连续模式按命中 Range 的垂直位置滚动；旧 DOM 环境或不支持 Range 几何信息时降级到 Range 起点元素。保留现有阅读模式；只经过既有用户主动导航/进度保存流程，不触碰书签或标注 API。
- DOM 回归覆盖重复命中、短 snippet 优先于错误但恰好重合的 offset、精确 UTF-16 offset、内联节点/空白/NBSP/emoji、歧义安全回退，以及按 Range 几何在双页和连续阅读中定位。Chromium E2E 覆盖重复命中的第二处及单页响应布局、双页、连续滚动模式保持不变；现有 EPUB 跨章节导航回归仍通过。
- 验证：`npm test` 253 通过、5 跳过、0 失败；`npm run check` 通过（41 个必需文件、9 个生命周期脚本）；`npx playwright test e2e/search.spec.js --project=chromium` 10/10；Task 3 定向 DOM 回归 4/4；`git diff --check` 通过。跳过项为 Windows/POSIX 平台限制。

**未包含：** Task 4 仍以 Task 0 的合成 fixture 结论为条件；用户 NAS 实书 spine 漏章未经实机核对，当前证据不足以改 EPUB 提取器。Task 5 尚待设备性能/安全验收和用户另行要求打包。本 Task 未构建 FPK。

## Task 5：发布回归、性能/安全证据与 FPK

**状态：** 本地验收与打包进行中；fnOS 实机验收仍待完成。

- 新增 `scripts/benchmark-book-search.js`：临时生成 800 章 EPUB 和 SQLite FTS 索引，覆盖常见命中首屏/续页、跨越 2,000 候选预算后稀疏末章命中、零结果。输出仅含聚合指标，不输出书名、正文、查询词或临时路径，结束后清理临时目录。
- 在 `docs/FNOS_DEVICE_ACCEPTANCE.md` §5.4 和发布验收矩阵中补充两种架构的跨章分页、Network 仅本地搜索 API、无 AI/provider/外网、候选预算、冷/热延迟、SQLite 计划和 RSS 验收。开发机模拟不计作实机通过。
- Windows x64 / Node v24.20.0 最终合成测量：800 章，索引 3,026,944 字节，建索引 224.46 ms；常见首屏/续页 17.32/13.86 ms；稀疏预算首屏/续页 15.95/8.83 ms，并在 2,390 条注入的 FTS 假阳性后抵达末章真命中；零结果 4.39 ms；计划 `SCAN ai_chunks VIRTUAL TABLE INDEX 64:M7>`；索引后 RSS 72,994,816 字节，采样峰值 93,450,240 字节。仅为开发机指标，不代表 NAS 性能。
- 版本策略：`manifest` 和 `package.json` 当前同为 1.1.7；本次按用户要求制作同版本测试包，不擅自 bump。
- 验证结果：`npm test` 253 通过、5 项平台限制跳过、0 失败；`npm run check` 通过（41 个结构文件、9 个生命周期脚本）；Chromium 搜索及阅读器回归 57/57；合成压力基准通过；`git diff --check` 通过。搜索 E2E 覆盖多页续取、无重复和不请求 AI。
- 打包前已保留既有 FPK、校验和、provenance 与 `.build/fpk-root` 的 1,004 个文件于计划目录 `pre-task5-backup/`。
- FPK 成功生成：`dist/babyreader-fnos.fpk`，版本 1.1.7，5,448,245 字节，SHA-256 `f0435453cdd1139e29951ed16cd4af2f16904ce73f9dd573127bc9e72b853981`。校验和 sidecar 与 `dist/build-provenance.json` 已生成；独立解包比对服务器分页、前端搜索、API adapter、分页导航模块均与工作树一致，包内 manifest 版本为 1.1.7。
- 本地 Task 5 回归/打包部分完成；x86_64/ARM64 fnOS Gateway、ACL、多用户与设备性能验收仍待实机，尚未把 FPK 安装到 NAS。
