# 书库个性化、分类与排序设计规格（DRAFT，待确认）

## 状态与范围

状态：**仅调研与方案，禁止按本文直接修改产品代码、书籍文件、扫描目录或 FPK。**

本规格为 BabyReader 的书库首页建立可扩展的个性化方案，覆盖：

1. 用户自建分类（虚拟文件夹）；
2. 书籍在可排序视图中的拖拽重排；
3. 点击分类后仅显示该分类内容，并可返回总书库；
4. 基于 fnOS 已授权源目录的只读文件夹分类；
5. 用户可选择的书库展示模式；
6. 后续更详细的书籍管理能力的演进边界。

不在本期实现：真实文件移动或重命名、修改 fnOS 授权、嵌套虚拟分类、多标签、跨用户共享分类、智能自动分类、后台监听、AI 自动归档、批量删除原始书籍。

## 产品目标

书库不再只是扫描结果的固定网格，而是同时满足两类明确需求：

- **个人整理**：用户创建“待读”“历史”“专业书”等分类，将书放入其中并自行排序；
- **沿用已有目录**：用户已经在 NAS 的授权目录中用文件夹分类时，可按该结构浏览而无需复制或重组文件。

两个需求的本质不同：前者是每位用户自己的虚拟整理，后者是扫描结果的来源投影。因此它们必须使用独立的数据、独立的排序规则和独立的 UI 模式，不能互相覆盖。

## 调研结论

### 可观察到的产品模式

| 来源 | 可核验做法 | 对本设计的启示 |
| --- | --- | --- |
| Apple Books | 用户可创建 Collection，并把书加入自建 Collection。 | “我的分类”应是虚拟集合，不改变原始文件位置；分类入口应服务个人整理。 |
| 微信读书公开集成资料 | 书架条目有类型、分类与置顶标记，书/专辑分开计数。该资料是腾讯开源仓库内的集成说明，并非完整的产品 UI 规范。 | 书架投影应保留条目类型，并将“置顶/排序”等个人偏好与目录扫描结果分离。 |
| 京东阅读公开资料 | 可核验资料提到分类检索、书名/时间排序以及编辑整理；未找到可作为实现依据的官方拖拽细节。 | 不推断或仿制未经证实的拖拽交互；排序应采用通用、可访问的管理模式。 |
| Calibre-Web | 支持自建 shelf；shelf 可由逐本或搜索结果批量加入，并在编辑页拖拽调整 shelf 顺序。 | “分类”与“排序”是不同操作；批量移动与显式管理入口比全时拖拽更可靠。 |
| Kavita | Collection 是手工分组；Reading List 是有顺序的独立概念；服务器可按文件夹或元数据建立库视图。 | 手工集合与有顺序列表、源文件夹投影不应混为一张表；先实现书级集合，复杂阅读清单以后单列。 |

参考链接：

- [Apple Books：管理 Collection](https://support.apple.com/en-au/guide/iphone/iphab219b91/ios)
- [Tencent WeChatReading：shelf 集成说明](https://github.com/Tencent/WeChatReading/blob/main/skills/shelf.md)
- [京东阅读公开资料（分类、排序、编辑整理）](https://www.lis.ac.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=22357)
- [Calibre-Web](https://github.com/janeczku/calibre-web)
- [Calibre-Web Shelf FAQ](https://github-wiki-see.page/m/janeczku/calibre-web/wiki/FAQ)
- [Kavita Collections](https://wiki.kavitareader.com/guides/features/collections/)
- [Kavita Reading Lists](https://wiki.kavitareader.com/guides/features/readinglists/)
- [Kavita Library/扫描配置](https://wiki.kavitareader.com/guides/admin-settings/libraries/)

### 设计推断

1. **默认展示“我的书库”**，但由用户在书库菜单中选择 `平铺全部`、`我的分类` 或 `按源目录`；所选模式按用户保存。
2. 手工分类第一版采用**单层虚拟文件夹**。用户点击文件夹后进入聚焦书架，只显示该分类内的书，并看到明确的“返回书库”与面包屑。
3. 为避免打开书籍时误拖动，拖拽仅在“整理书库”模式开启；触摸设备使用长按后拖动，键盘提供等价的移动操作。
4. `按源目录` 是只读浏览模式：目录名来自已扫描书籍的相对路径；在该模式中不允许把拖拽排序解释成移动真实文件。
5. 同一本书在第一版只有一个“主分类”。这符合文件夹心智模型，避免同一书在多个文件夹中的顺序冲突。多标签/多集合是后续能力。

## 已审查的本地架构

### 当前事实

- `app/ui/library/view.js` 的 `renderLibrary(library)` 独占书库 UI，当前只将 `library.books` 过滤后渲染为扁平 `.library-grid`；打开书仍通过 `browserHost.openBook(book)`。
- `app/server/library.js` 扫描每个授权根并递归发现 EPUB、Markdown、TXT；书籍 ID 是真实文件路径的 SHA-256，索引中保存 `relativePath`、内部 `root` 与 `path`。
- `app/server/index.js` 的 `publicBook()` 有意从普通 `/api/library` 响应删除绝对 `path` 与 `root`。这是必须保留的隐私与路径安全边界。
- 全局扫描目录在 `TRIM_PKGVAR/index/library.json`，属于扫描器的事实来源；它不应写入用户的分类或排序。
- `app/server/storage.js` 已提供 `normalizeUserId()`、每用户串行 mutation queue 与 `writeJsonAtomic()`；阅读进度、书签和标注已由 fnOS 用户 ID 隔离。
- 当前阅读 URL 只恢复 `?book=<bookId>`；从分类返回的位置还没有单独的库视图路由状态。

### 关键风险

| 风险 | 当前原因 | 本设计的控制措施 |
| --- | --- | --- |
| 分类覆盖扫描结果 | 当前 `library.json` 是扫描器整体重写的结果。 | 新增独立、每用户的组织文件，扫描流程绝不写入它。 |
| 拖拽误打开书 | 书籍卡片当前是单一可点击 button。 | 仅在“整理书库”模式提供拖拽把手、选择和移动操作；阅读入口在该模式暂停。 |
| 目录分类泄露绝对路径 | 当前响应故意移除了 `root`。 | 仅输出服务器生成的 opaque `sourceRootId`、相对路径段和显示名；不把绝对路径交给浏览器。 |
| 目录分类与自定义排序冲突 | 源目录的顺序由文件系统投影决定，用户顺序是私有状态。 | 将它们分为互斥的展示模式；源目录模式不支持书籍拖拽。 |
| 移动/删除源文件后旧排序损坏 | bookId 由真实路径哈希得出，改路径会变 ID。 | 组织解析器只在读时标记孤儿引用；不自动删除虚拟文件夹，提供受控清理。 |
| 多标签/嵌套文件夹的循环和排序复杂度 | 嵌套、跨集合和多重排序会引入递归与冲突。 | 第一版只实现单层、一书一主分类；后续版本另立规格。 |

## 信息架构与交互

### 三种互斥的书库展示模式

| 模式 | 首页内容 | 能否排序 | 能否修改源文件 |
| --- | --- | --- | --- |
| 平铺全部 | 当前所有可读书籍的个人排序网格 | 可以（整理模式） | 不可以 |
| 我的分类 | 分类文件夹、`未分类`入口；点开后仅显示该分类书籍 | 文件夹顺序、分类内书籍顺序均可调整 | 不可以 |
| 按源目录 | 已授权根目录下的文件夹树投影；点开只显示该节点直接书籍/子目录 | 不可以 | 不可以 |

书库头部保留“重新扫描”。新增“展示方式”和“整理”入口，但不把所有操作常驻在每本书上。移动端同样使用可聚焦的 sheet/menu，而不是依赖鼠标悬停。

### 我的分类

```text
书库 / 我的分类
  ├─ + 新建分类
  ├─ 历史（12）
  ├─ 待读（8）
  └─ 未分类（19）

书库 / 我的分类 / 历史
  ← 返回书库
  历史 · 12 本
  [书籍网格]
```

- 新建、重命名、删除分类均需要受限名称校验；删除分类只将书移回“未分类”，绝不删除书籍文件或 AI 索引。
- 分类内书籍不复制；仅记录 bookId 引用。
- “移动到分类”必须同时提供单本菜单与多选批量操作。拖拽到分类卡作为增强交互，不能是唯一入口。
- 管理模式中允许重排分类和分类内书籍；退出管理模式后恢复普通点击打开书。

### 按源目录

`relativePath` 被规范化为 `/` 分隔的安全相对段。服务端从每个扫描根生成稳定的 `sourceRootId`，并返回安全的层级描述：

```json
{
  "sourceRootId": "root_…",
  "sourcePathSegments": ["历史", "近代"],
  "relativePath": "历史/近代/书名.epub"
}
```

- 浏览器只能用这些字段渲染层级；不接收、不构造、不回传绝对目录。
- 多个授权根的第一层显示为逻辑书库根（可使用管理员配置的显示名；缺省则“书库 1/2…”），避免把 NAS 绝对路径暴露在普通用户 UI。
- 根目录直属书籍显示在“此目录中的书籍”，空目录不会仅为展示而被扫描器伪造。
- 该视图是扫描结果的只读投影；用户拖拽、移动到分类、删除分类等操作不在此处改动文件系统。

### 排序与可访问性

- 使用显式“整理书库”模式而非全局 HTML5 drag-and-drop；桌面采用 Pointer Events，触屏采用 350–500 ms 长按门槛和可取消的拖动预览。
- 每个拖拽动作都存在键盘等价：`移动到最前`、`向前/向后移动`、`移动到分类`；所有状态变化通过 `aria-live` 描述。
- 保存采用请求级 revision；收到 `409` 时前端重新读取组织数据并提示“书库已在其他页面更新，请重试”，不可用过期数组覆盖新排序。
- 在 `prefers-reduced-motion` 下禁用位移动画；拖拽取消、ESC、失焦、网络失败和切换书库模式必须复原视觉状态。

## 数据模型（后续实现契约）

### 扫描目录：保持事实来源

`TRIM_PKGVAR/index/library.json` 继续只保存扫描器的书目事实。为支持安全的源目录视图，后续扫描器仅可新增安全派生字段（如 `sourceRootId`、`sourcePathSegments`）；不得在它中写入 UID、分类、排序、客户端状态或绝对路径的公开副本。

### 用户整理目录：新增、独立、原子写入

新文件：

```text
TRIM_PKGVAR/users/<normalized-uid>/library-organization.json
```

建议 v1 结构：

```json
{
  "version": 1,
  "revision": 7,
  "updatedAt": "2026-09-22T00:00:00.000Z",
  "preferences": { "viewMode": "collections" },
  "collections": [
    { "id": "uuid", "name": "待读", "position": 0, "createdAt": "…", "updatedAt": "…" }
  ],
  "unassignedOrder": ["<bookId>"],
  "collectionOrders": { "uuid": ["<bookId>"] },
  "bookAssignments": { "<bookId>": "uuid" }
}
```

约束：

- 所有 bookId 必须严格匹配 64 位小写十六进制；collection ID 必须由服务端生成 UUID。
- 分类名去除首尾空白、折叠连续空白、长度 1–80，拒绝控制字符及重复名称（按当前用户、Unicode 规范化后比较）。
- `collections` 最多 100 个；单个 mutation 最多 500 个 bookId；整个 JSON 文件设置明确大小上限（建议 2 MiB）。
- 一个 bookId 同时最多出现在一个 `bookAssignments` 项和一个排序数组中；服务端 normalize 后再写入。
- 新扫描到但未组织的书默认追加到 `unassignedOrder`，并由读取时的 resolver 稳定合并，不改变用户已排顺序。
- 扫描消失的 bookId 变为 orphaned reference；读取响应可返回计数，只有用户确认的“清理不可用书籍引用”才删除引用。虚拟分类不因一本书消失而删除。

## API 设计（后续实现）

现有 `GET /api/library`、`POST /api/library/scan`、`browserHost.openBook(book)` 以及书籍阅读 API 均保持不变。

新增均受当前 fnOS gateway 用户身份约束的组织 API：

```text
GET    /api/library/organization
POST   /api/library/collections
PATCH  /api/library/collections/:collectionId
DELETE /api/library/collections/:collectionId
PUT    /api/library/books/:bookId/placement
PUT    /api/library/organization/order
POST   /api/library/organization/reconcile
```

- 组织 API 只接受分类名、严格 ID、受限位置和当前 revision；永不接受服务器路径、用户 ID、根目录或文件内容。
- 每次 mutation 都由服务端校验当前书籍是否仍在健康书目中、调用现有用户隔离，并以原子写入提交。
- 请求 revision 与服务端不一致时返回脱敏 `409 ORGANIZATION_CONFLICT` 和最新 revision；不得静默 last-write-wins。
- 任何删除集合操作只删除虚拟分类；“源目录模式”不暴露文件删除或移动接口。
- 管理 API 出错时返回可用户理解的脱敏信息，不返回 JSON 文件路径、栈、书籍正文、授权目录或 AI 凭据。

## 安全、稳定性与兼容性边界

1. **不改扫描授权模型**：继续只扫描 `settings.json.libraryRoots`、`TRIM_DATA_ACCESSIBLE_PATHS` 与 `TRIM_DATA_SHARE_PATHS` 中经过 realpath/权限验证的目录；不新增路径输入框、root、全盘扫描或文件监听。
2. **不移动源文件**：分类、排序和“移入文件夹”只改每用户 JSON。UI 必须明确称为“分类”，不暗示已经移动 NAS 文件。
3. **不泄露路径**：普通书库、组织 API、前端 state、测试截图和错误文案不得显示绝对路径或未脱敏根目录。
4. **不干扰阅读身份**：bookId 仍由现有扫描规则生成；打开书仍走 `findBook()` 和授权校验。进度、书签、标注、全文搜索、AI 会话和 AI 索引均不迁移、不重写。
5. **不自动清理用户数据**：扫描失败或扫描不健康时，组织 resolver fail closed，只显示上次可信分类/错误状态，不删除分类或排序。
6. **并发安全**：复用 `normalizeUserId()`、原子 JSON 写入和 per-user mutation queue；增加 revision 冲突处理，避免多标签页相互覆盖。
7. **可恢复性**：写入前严格 normalize；损坏文件保留证据并返回可恢复错误，不以空文件静默覆盖。提供管理员受控导出/修复方案前，不批量自动重建。
8. **渐进发布**：首版功能开关默认关闭，仅在开发/验收环境开启；当组织 API 不可用时，书库必须无条件回退到现有扁平、可打开书籍的行为。

## 分阶段交付建议

| 阶段 | 交付 | 主要风险控制 |
| --- | --- | --- |
| 0 | 数据契约、现有行为快照、feature flag | 先证明不改变当前书库/阅读行为 |
| 1 | 每用户组织存储、只读 API 与 resolver | 扫描/组织分离、原子写入、隔离 |
| 2 | 我的分类 UI、聚焦浏览、批量移动 | 不改变 `openBook` 与 URL 恢复 |
| 3 | 整理模式、拖拽与键盘重排 | Pointer Events、revision、回滚 |
| 4 | 源目录只读模式与偏好开关 | 无绝对路径、无文件操作 |
| 5 | 完整回归、FPK 与 fnOS 实机验收 | 多用户、自定义目录、升级/失败恢复 |
| 后续 | 嵌套分类、多标签、智能分类、阅读清单 | 另写规格，禁止混入本方案 |

## 验收标准

1. 默认平铺书库、重新扫描、打开 EPUB/Markdown/TXT、浏览器刷新恢复、返回书库全部保持现状。
2. 用户 A 的分类、排序和展示模式对用户 B 不可见；两个用户可对同一本书使用不同分类与顺序。
3. 创建/重命名/删除分类不会修改书籍文件、授权目录、`library.json` 或 AI 索引。
4. 进入分类后只显示该分类书籍；返回按钮和浏览器 Back 都回到之前的书库视图与焦点书籍。
5. 拖拽和键盘重排在刷新后保留；网络错误、409、切换视图或取消拖拽不会留下错位/蓝色焦点/禁用按钮状态。
6. 按源目录视图正确显示多个授权根、中文与空格目录、根目录直辖书籍和嵌套目录，且不显示绝对路径。
7. 源目录视图不支持会影响文件系统的拖拽/删除；手工分类视图不更改源目录结构。
8. 扫描失败、权限撤销、书籍被移走、组织 JSON 损坏时，不自动丢弃分类；应用给出可理解的恢复提示。
9. Node、DOM、Playwright、FPK 结构、fnOS 真机验收均覆盖书库、阅读、AI、书签、标注、搜索、深浅色和移动端。

