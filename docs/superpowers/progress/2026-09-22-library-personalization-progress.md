# 书库个性化与分类进度

计划：`docs/superpowers/plans/2026-09-22-library-personalization-and-collections.md`
规格：`docs/superpowers/specs/2026-09-22-library-personalization-and-collections-design.md`

## 当前状态

- Task 0：已完成。
- Task 1：已完成。
- Task 2：已完成。
- Task 3：已完成。
- Task 4：已完成。
- Task 5：已完成。
- Task 6：本地步骤 1–3 已完成；步骤 4–5 等待 fnOS 真机安装、Gateway、双架构和升级证据。
- 源码直启时书库组织 feature flag 默认关闭；1.1.4 正式 FPK 由 `cmd/main` 默认注入 `BABYREADER_ENABLE_LIBRARY_ORGANIZATION=1`。
- 1.1.4 业务功能状态：正式包显示分类、按目录、整理/拖拽、独立重新扫描和分类内添加书籍；显式设置 `BABYREADER_ENABLE_LIBRARY_ORGANIZATION=0` 时安全回退既有扁平书库。

## Task 0 交付

- 服务端以受控运行时环境变量 `BABYREADER_ENABLE_LIBRARY_ORGANIZATION` 读取开关；缺省为 `false`。
- `/api/library` 与 `/api/library/scan` 返回 `features.libraryOrganization`，不改变既有书籍字段的路径脱敏规则。
- 前端保留原 `renderLibrary()` 调用入口；未来组织渲染器异常、未提供或未消费请求时，自动回退原扁平网格。
- 扁平书库增加 `data-library-mode="flat"` 和开关状态数据属性，便于后续验收，不改变用户可见功能。
- 书籍点击仍调用现有 `browserHost.openBook(book)`。

## Task 1 交付

- 新增 `app/server/library-organization.js`，定义版本 1 的用户组织 schema、分类名/ID/bookId 校验、单书单分类规范化和源书目 resolver。
- `UserStorage` 新增按 UID 隔离的 `getLibraryOrganization()` 与 revision-aware `mutateLibraryOrganization()`。
- 组织文件固定为 `users/<normalized-uid>/library-organization.json`；写入复用现有原子 JSON 写入，Unix 权限为目录 `0700`、文件 `0600`。
- resolver 只过滤当前书目展示结果、追加新书到未分类并报告 orphan；读取解析不会回写组织文件或修改 `library.json`。
- 同一用户并发写入串行化并检测 revision 冲突；不同用户保持隔离。
- 损坏、超大、符号链接或非普通文件组织存储 fail-closed，不自动覆盖。

## Task 2 交付

- 新增用户隔离的组织读取、分类创建/重命名/删除、书籍放置和排序 API；所有写操作携带并校验 `revision`。
- 组织读取返回脱敏书目与解析后的分类视图，不返回绝对路径、扫描根、书籍正文或 UID。
- 书籍放置只接受当前健康书目中的 bookId；分类和排序只接受白名单动作，不接受完整组织状态或文件路径。
- 旧 `/api/library` 保持扫描书目契约，仅继续返回 feature flag，不注入用户组织数据。
- `browserHost` 增加最小组织 API 适配器，HTTP `409` 继续以异常形式向 UI 传播，未吞掉冲突。
- `reconcile` 未在 Task 2 开放，继续由 Task 6 的确认式清理流程负责。

## Task 2 验证证据

- `node --test tests/library-organization-api.test.js`：6 通过，0 失败。
- `node --test tests/library-organization-api.test.js tests/search-api.test.js tests/ai-index-api.test.js tests/ai-conversation-api.test.js`：26 通过，0 失败。
- `npm run check`：结构验证通过。
- `git diff --check`：通过。

## Task 5 交付

- 扫描边界为每本活动书籍派生稳定 opaque `sourceRootId` 和规范化 `sourcePathSegments`；公共书籍 JSON 仍不包含绝对路径或真实扫描根。
- 新增 `source-folders` 只读展示：根目录、子目录和目录直属书籍可进入/返回；不显示整理、拖拽、删除或“移入此目录”等文件操作。
- 新增展示偏好 API，`viewMode` 只允许 `flat|collections|source-folders`；未知值由 schema 安全回退 `flat`，不改动既有阅读显示设置。
- 源目录视图与手工分类视图互斥，历史状态只保存 opaque root ID 和经过校验的相对 segment，不写入 URL、绝对路径或正文。
- 扫描撤销/失败时仅影响当前源目录投影；手工分类与组织存储不被自动清除，具体 orphan 清理仍延后 Task 6。

## Task 5 验证证据

- `node --test tests/reader-core.test.js --test-name-pattern="source folder|recursive multi-root"`：36 通过，0 失败。
- `node --test tests/library-organization-api.test.js`：7 通过，0 失败。
- `node --test tests/dom-regression.test.js --test-name-pattern="source-folder view"`：98 通过，0 失败。
- `npx playwright test e2e/reader.spec.js --project=chromium --grep "source-folder organization"`：1 通过，0 失败。
- `npm test`：224 通过，5 个平台条件跳过，0 失败。
- `npm run check`：结构验证通过。
- `git diff --check`：通过。

### E2E 全量对照

- 本轮完整 `npm run test:e2e` 共 87 项：81 通过、2 跳过、4 失败；新增 source-folder 场景通过。
- 4 个失败均落在既有 highlights/persistence 场景，表现为 E2E 共享 runtime 的原子 JSON `rename EPERM` 及其后的状态缺失/进度漂移；未命中本轮书库组织改动。已单独复跑新增 source-folder 场景通过；Task 6 发布前仍需清理 E2E runtime 并重新跑全量。

## Task 3 交付

- 新增独立 `library/organization.js`，提供扁平/我的分类/分类详情/未分类视图和单层返回。
- 书籍卡统一复用 `createLibraryBookCard()`，打开书籍仍只有 `browserHost.openBook(book)` 入口。
- 分类首页只显示分类卡与未分类入口；进入分类后只显示该分类成员，不改变书籍 URL 或阅读状态。
- 使用受限 `history.state.libraryOrganization` 保存 root/collection/unassigned 导航状态，不把路径、正文或组织 JSON 写进 URL。
- 保留默认 feature flag 关闭时的原扁平书库；组织接口不可用或渲染异常时自动回退。
- 新增分类、删除分类（删除后书籍回到未分类）使用 Task 2 API；名称使用 `textContent` 渲染，避免 XSS 注入。
- 沿用现有 library tokens，增加深浅色/移动端紧凑布局与最小触控目标，不触碰 reader sheet、AI、搜索和标注 surface。

## Task 3 验证证据

- `node --test tests/dom-regression.test.js --test-name-pattern="library organization"`：96 通过，0 失败。
- `npm run test:e2e`：已启动并覆盖既有 EPUB/书库回归；完整结果将在本轮 Task 5 汇总复核。

## Task 4 交付

- 新增 `library/reorder.js`，提供不修改源数组的排序函数和一次性 commit/cancel 控制器。
- 整理模式默认关闭；进入后显示排序手柄，支持 Pointer Events 拖拽与 drop 状态。初版提供的上下移按钮已在 2026-09-22 后续优化中移除。
- 鼠标直接拖手柄；移动端长按手柄；键盘聚焦手柄后用方向键调整位置。所有排序统一调用 Task 2 revision-aware order API。
- API 成功后使用服务端返回状态重绘并恢复目标焦点；网络失败或 `409` 会重新获取组织快照并回滚，不把过期顺序写回。
- 正常浏览模式仍保持原书卡点击行为，拖拽不会进入阅读页或触发真实文件移动。

## Task 4 验证证据

- `node --test tests/library-reorder.test.js`：2 通过，0 失败。
- `node --test tests/library-reorder.test.js tests/library-organization-api.test.js tests/dom-regression.test.js`：105 通过，0 失败。
- `npm run check`：结构验证通过。
- `git diff --check`：通过。

## 验证证据

- `node --test tests/dom-regression.test.js --test-name-pattern="library organization stays opt-in"`：通过。
- `npm test`：205 通过，5 个平台条件跳过，0 失败。
- `npm run check`：结构验证通过。
- `npm run test:e2e -- --grep "library organization|mobile library|library and welcome states"`：3 通过。
- `npm run test:e2e`：84 通过，2 个条件跳过，0 失败。
- `git diff --check`：Task 0 相关差异无空白错误。
- `node --test tests/library-organization.test.js tests/reader-core.test.js tests/security.test.js`：48 通过，1 个 Windows 能力条件跳过，0 失败。
- `npm test`：211 通过，5 个平台条件跳过，0 失败。
- `npm run check`：结构验证通过。
- `git diff --check`：通过。

## Task 6：受控修复、发布验证与真机验收（本轮）

- 新增 `POST /api/library/organization/reconcile`：默认 dry-run，只返回孤儿数量和当前 revision；只有携带当前 revision 且 `confirm: true` 才原子删除不可用 bookId 引用。
- reconciliation 在读取/确认前检查健康书目索引；扫描状态非 `completed`、存在错误或 root error 时 fail closed 返回 503。
- 清理只涉及每用户 `library-organization.json` 中的 `bookAssignments`、`unassignedOrder` 和 `collectionOrders`；不删除分类、源书籍、AI 索引、书签、标注、阅读进度或 AI 会话。
- `scripts/fnos-device-acceptance.sh` 增加认证后的只读组织模型检查：确认 endpoint 返回 200、JSON 不含 `path`/`root` 键；不执行 reconcile 写操作、不接收 API Key。
- 新增 API、纯 resolver 和验收脚本契约回归，覆盖 dry-run 不写入、确认清理、扫描不健康拒绝、分类/活动书籍顺序保留和路径脱敏。

### Task 6 本地验证证据

- `node --test tests/library-organization.test.js tests/library-organization-api.test.js`：16 通过，0 失败。
- `node --test tests/fnos-lifecycle.test.js --test-name-pattern="library organization contract"`：8 通过，1 个 POSIX 条件跳过。
- Git Bash `-n scripts/fnos-device-acceptance.sh`：通过。
- `npm test`：228 通过，5 个平台条件跳过，0 失败。
- `npm run check`：通过。
- `npm run check:portable`：通过。
- `npm run test:e2e`：重跑后 85 通过，2 个可选真实样本跳过，0 失败。首次全量运行出现 1 个既有 persistence 场景偶发失败，单测重跑 2/2 通过，随后全量重跑通过。
- `git diff --check`：通过。

### Task 6 真机状态

- 尚未从当前环境直连 fnOS，因此未宣称 x86_64/ARM64、Gateway、ACL、升级、多用户或真实拖拽通过。
- 组织 feature flag 在源码直启环境仍默认关闭；1.1.4 FPK 已由生命周期脚本默认开启，现场仍需用 `/api/library.features.libraryOrganization` 核验实际状态，并验证显式关闭回退。

## 1.1.4 可用性修复

- 根因：组织渲染器接管书库时没有复用旧平铺视图的重新扫描按钮；服务端已存在书籍 placement API，但前端从未调用，导致分类只能创建、不能加入书籍。
- 修复：组织书架始终显示独立重新扫描按钮；展示方式切换独立为“全部书籍 / 我的分类 / 按目录”；“新建分类”作为独立主操作，不再混入切换区。
- 分类详情新增“添加书籍”选择器，允许把未分类或其他分类的书籍移入当前分类；仅调用既有 revision-aware placement API，不移动真实文件。
- 回归：新增 DOM 用例覆盖扫描、独立新建分类表单定位和书籍加入；`npm test` 231 通过、5 个平台条件跳过；Chromium 85 通过、2 个可选真实样本跳过；结构校验和 FPK 内容核验通过。

## 拖拽交互修复（已完成）

> 此处是上一轮仅分类内拖拽的验证记录，未覆盖全部书籍和真实 API；本轮补充修复见下面“全链路修复”。

- 根因：原实现对所有指针统一使用长按定时器，桌面鼠标在定时器触发前就结束拖动；同时普通书卡仍可触发打开逻辑，缺少明确的拖拽入口和结束状态清理。
- 修复：整理模式增加明确的拖拽手柄；鼠标/笔从手柄按下后立即激活，触摸从手柄长按约 350ms 激活，移动超过 8px 会取消长按，避免与页面滚动冲突。
- 交互反馈：拖拽项显示提升/缩放状态，当前放置目标显示边界反馈；整理模式书卡变为不可打开；后续已移除上移/下移按钮，排序手柄支持键盘方向键。
- 安全边界：只更新组织模型中的虚拟顺序，不移动真实文件；沿用现有 revision-aware API、冲突回滚和服务端返回状态重绘，不改书籍扫描、阅读打开、AI 或索引数据。

### 拖拽交互验证证据

- `node --test tests/library-reorder.test.js tests/dom-regression.test.js --test-name-pattern="reorder activation|visible drag handle|starts mouse reorder|touch reorder|explicit keyboard reorder"`：通过，0 失败。
- `npx playwright test e2e/reader.spec.js --project=chromium --grep "real desktop mouse drag"`：真实浏览器鼠标拖拽通过。
- `npm test`：235 通过，5 个平台条件跳过，0 失败。
- `npm run check` / `npm run check:portable`：结构验证通过。
- `npm run test:e2e`：86 通过，2 个环境条件跳过，0 失败。
- `git diff --check`：通过。

## 全链路修复（2026-09-22）

- 详细原因、开源参考、实现边界和验收步骤见 [书库整理与分类链路修复](../plans/2026-09-22-library-organization-interaction-repair.md)。
- 已接通全部书籍排序；修复未分类读写顺序不一致；新增 allBookOrder，保留离线书籍引用。
- 新建分类直达详情、连续添加与冲突重试、书卡分类选择、明确返回分类列表均已实现。
- 新增开启功能的真实 API 浏览器测试，已纳入常规 E2E 命令第二阶段；原 mock 用例仅作为渲染单元回归保留。
- `npm test`：238 通过、5 个平台条件跳过，0 失败；结构检查通过。`npm run test:e2e` 两阶段验证：默认关闭环境 86 通过、7 跳过（5 项开启功能专项在下一阶段执行，2 项可选 EPUB）；开启功能环境真实 API 专项 5 项通过（含原生触摸事件），共 91 项通过。
- 本轮尚未在 fnOS 真机安装验收。

## 分类拖拽与删除入口修复（2026-09-22）

- 分类名称本身现在可在桌面端直接拖动排序；此前事件只绑定手柄，拖名称不会进入拖拽生命周期。删除按钮不参与拖动，移动端继续使用长按手柄。
- 分类栏支持拖到边缘时横向自动滚动；删除按钮统一为紧凑可访问 SVG 图标。
- 验证：Node 238 通过/5 平台条件跳过；常规 E2E 86 通过/10 跳过；组织真实 API 专项 8 通过；结构检查和 `git diff --check` 通过。
- FPK 已重打为 1.1.7：[dist/babyreader-fnos.fpk](../../../dist/babyreader-fnos.fpk)，5,426,469 bytes，SHA-256 `08419640b100d0c8840b406481a048d7e0d99aca5c095d16d6c887ed24ce5f7f`；已核对包内分类拖动逻辑与源码一致。fnOS 实机安装验收待执行。

## 决策记录

## 书库首页简化与分类入口重排（已完成本地实现）

- 用户需求：新建分类紧跟“我的书籍”；移除“我的分类”和“按目录”两个首页选项。
- 方案与执行边界见 [书库首页简化与分类入口设计规格](../specs/2026-09-22-library-home-simplification-design.md) 和 [实施计划](../plans/2026-09-22-library-home-simplification.md)。
- 当前状态：Task 0–4 已完成；本地 Node/DOM/Chromium/组织专项回归通过；FPK 构建和 fnOS 真机安装验收待完成。
- 首页固定为“我的书籍”，在其标题操作行直接提供“新建分类”；书籍网格下方独立显示“分类”区。
- 移除首页“我的分类”和“按目录”选项；旧 `viewMode`、source projection、组织 API 和 JSON 数据继续保留，避免破坏既有用户数据。
- 全部书籍排序使用 `allBookOrder`，分类排序继续使用独立 scope；分类详情保留返回、添加书籍和整理入口。
- 新增/调整回归契约：DOM 不再查找旧 tab；旧 source 数据回退 root；桌面鼠标、键盘、移动端长按、真实 API 和刷新恢复保持覆盖。
- 本地验证：`npm test` 238 通过、5 个平台条件跳过；默认 Chromium E2E 86 通过、7 个环境条件跳过；开启组织功能专项 5 通过。
- `npm run check`、`npm run check:portable` 和 `git diff --check`：通过。
- FPK 已构建：[dist/babyreader-fnos.fpk](../../../dist/babyreader-fnos.fpk)，5,420,987 bytes，SHA-256 `0C51F0E6D5B76982D3E0A5988BF527928C670F070D199DCD21D17ABF261B4932`；包内 manifest 为 1.1.4，包内 UI 已确认包含新首页文案。
- fnOS 真机安装、授权目录、自定义目录扫描、分类/拖拽刷新恢复和升级覆盖仍待现场验收，未提前宣称通过。
- 用户后续澄清首页结构，已进一步调整为顶部同排分类导航（我的书籍 + 各分类），下方只显示当前选中范围的书籍；底部分类卡片区已移除，顶部扫描/新建/整理按钮采用统一次要样式。
- 分类详情添加书籍曾因插入目标跨层级导致 DOM 插入失败，已将面板改为插入书格同级分区。组织相关 DOM 回归重新通过（103 项）。
- 新 FPK：1.1.6，[dist/babyreader-fnos.fpk](../../../dist/babyreader-fnos.fpk)，5,423,569 bytes，SHA-256 `6DE559655D64445F62A76AE568D700E4BFF7048DD7827B08DCA895E3D033195B`。包内版本、导航和面板修复已核对；真机安装验收待执行。
- 2026-09-22：书籍卡片与分类导航已去除上下移按钮，统一改用可见拖拽手柄；鼠标拖动即刻激活、移动端长按逻辑和服务端顺序保存不变。手柄增加键盘方向键排序及焦点恢复。`npm test` 238 通过、5 项平台条件跳过；Chromium 书库真实鼠标/真实 API 回归 2 通过、1 项跳过。FPK 已更新至 1.1.7，SHA-256 见构建溯源文件；fnOS 安装验收待现场执行。
- 后续位置修复：`新建分类` 使用独立 `library-section-actions`，并覆盖 `margin-left: auto`，现在紧跟“我的书籍”标题右侧；为确保 fnOS 覆盖安装版本升至 1.1.5。FPK 为 5,422,373 bytes，SHA-256 `E2A161ECAD508F910F644AAA2A81A0471BC25D8EFAA3E47DCF4F411D4B002670`。

- Ruling：本次按用户明确的“执行 Task 0”在当前工作区实现，保留既有未提交改动，不创建提交、不合并分支；原因是工作区已有用户相关改动，切换或清理会增加误伤风险；代价是本次结果仍需由用户在现有工作区审阅后再决定是否提交。
- Ruling：feature flag 使用服务进程启动时的环境变量，缺省关闭；原因是分类功能尚未实现，必须防止仅靠 URL 或 localStorage 意外启用半成品；代价是修改开关后需要重启服务。
- Ruling：组织渲染器必须返回 `true` 才能接管书库；原因是未来异步/异常渲染失败时仍需保证现有平铺书库可用；代价是后续 Task 需要遵守明确的渲染器契约。
- Ruling：组织状态允许保留当前扫描中不存在的 bookId 作为 orphan 引用，但 resolver 不展示它们、不自动清除；原因是书籍可能被临时移走后恢复，代价是需要后续 Task 6 提供用户确认的清理动作。
- Ruling：Windows 测试环境不将 POSIX 文件 mode 位作为硬性断言；实现仍显式执行 `chmod 0700/0600`，fnOS/Linux 真机验收必须检查实际权限。
- Ruling：Task 2 只开放六个非破坏性组织动作，`reconcile` 留到 Task 6；原因是孤儿清理必须具备 dry-run、用户确认和扫描不健康时 fail-closed，提前开放会扩大不可逆操作边界。
- Ruling：Task 3 的分类视图只在拿到组织快照后接管；组织 API 失败、渲染器异常或 feature flag 关闭时继续使用原扁平书库。原因是书库首页必须保持可打开书籍的稳定入口。
- Ruling：排序的拖拽只是虚拟书目顺序，不操作真实文件系统；原因是用户分类与源目录是互斥视图，文件移动会扩大权限、回滚和数据损失边界。
- Ruling：源目录只读投影使用 hash-derived opaque root ID 与相对 segment，不向客户端传递真实 root；原因是目录展示需要稳定键，但绝不能扩大 fnOS 授权路径泄漏边界。
