# 首页书籍直接拖动排序实施计划

**Goal:** 首页书籍像用户提供的 demo 一样可从封面/书卡直接拖动，移动中看见准确插入位置，松手后可靠保存；普通点击仍然打开书籍。

**Architecture:** 延续现有 Pointer Events、`all`/分类/未分类排序范围及 revision API；只借鉴 demo 的交互语义与轻量视觉反馈，不直接移植其无持久化的 HTML5 `draggable` 代码。排序由单一会话状态机管理预览、提交、取消和回滚，UI 不在指针移动时发送请求。

**Tech Stack:** Vanilla JavaScript、CSS、Node `node:test`、Happy DOM、Playwright 真实指针测试；现有 BabyReader 书库组织 API。

**Spec:** 本文“行为契约”及 `docs/superpowers/plans/2026-09-28-reading-experience-interaction-plan.md` 的 UX10 / UX Task 3。视觉与手势参照 `C:/Users/admin/Downloads/babyreader_apple_hig_demo_v6_stability_rule.html` 第 329–330、755–803、1276–1299 行。

**Global Constraints:** 现有工作区有大量未提交改动；实施时原样保留，不重置、不覆盖、不顺带提交。不得修改书库授权、扫描、书籍文件、分类归属、排序 API 契约、阅读进度或 EPUB/PDF 阅读器。先测再改；每个阶段可独立回退，失败只回滚本次内存预览，不改变服务端顺序。

**Review Focus:** 点击与拖动的互斥；跨行网格落点；连续预览的顺序正确性；触摸滚动不误触；筛选时完整 ID 顺序；服务端 revision 冲突、失败后的回滚；键盘排序和分类拖动回归。

## 现状与根因

1. demo 从封面所在的整张 `.book` 直接 `draggable="true"`，`dragover` 中立即调整 DOM，源卡变淡、目标出现弱蓝边框；“整理”不是拖动的前置条件。其 `drop` 只弹提示，没有持久化，也没有点击阈值、触屏和键盘契约，不能原样复制。
2. `app/ui/library/organization.js` 的 `libraryOrganizationBookGrid()` 调用 `setupLibraryPointerReorder()` 时未启用卡片内容作为起点；`pointerdown` 只接受 `[data-reorder-handle]`。所以在首页抓住封面/书名移动，事件不会建立排序会话。手柄在普通模式只是悬停才显现；整理模式又把书卡设为 `disabled`，进一步妨碍直接拖书卡。严格说现有手柄在普通模式仍可排序，并非必须先点“整理”。
3. 现有拖动只给目标卡加边框；`pointerup` 后才计算新顺序并重渲染，拖动途中没有实际顺序或占位预览。`data-drop-edge` 取决于原先两卡的索引，不取决于指针落在目标卡的哪一侧，在多列/跨行网格中不够准确。清理视觉先于保存响应，会出现短暂弹回。
4. `app/ui/library/reorder.js` 已有未接入书卡的 `createLibraryReorderController()`；连续 `update` 会用原始顺序配合已经改变的 `session.index` 再算一次。只读复现：`[a,b,c]` 把 `a` 预览到末尾再拖回开头，得到 `[c,a,b]`，而非 `[a,b,c]`。必须先修它才能承担连续实时预览。
5. `tests/dom-regression.test.js` 和 `e2e/library-organization-live.spec.js` 主要从手柄发起指针操作；没有覆盖用户实际动作“抓住封面直接拖”，所以原有测试通过也无法发现本问题。`view.js` 的书名筛选通过 `hidden` 保留完整网格，现有直接索引逻辑也未定义筛选后的落点语义。

## 行为契约

| 情境 | 预期行为 |
| --- | --- |
| 桌面普通书库 | 主按钮按住书卡封面、书名或非操作区，移动至少 6px 后开始拖动；不需要先按“整理”。轻点仍打开书。图片不得启动浏览器原生图片拖拽。 |
| 桌面整理模式 | 同样可从书卡直接拖动；分类选择框、删除/更多菜单等交互控件不启动拖动。书卡可以保持“不可打开”的语义，但不能使用阻断指针事件的原生 `disabled`；点击/Enter 由模式判断拦截。 |
| 移动触屏 | 保留 350ms 长按、移动超过 8px 则取消等待并自然滚动；长按书卡后才接管手势。手柄可保留作显式入口；不能让轻扫书架变为误排序。 |
| 拖动中 | 源卡轻微变淡，不放大；目标显示弱蓝插入线/细框和稳定的占位预览。指针跨列、跨行、来回移动时预览连续且不抖动。遵守 `prefers-reduced-motion`。 |
| 松手、取消与失败 | 仅顺序真正变化且落点有效时发一次排序 PUT。Esc、`pointercancel`、释放在网格外、切换视图/新一轮渲染均取消并还原原顺序；保存失败或 revision 冲突重新取得权威顺序并给出明确提示，不显示假成功。 |
| 筛选后的书架 | 可以拖动可见书卡；不可见书卡保留原本索引槽位和彼此相对顺序。将可见 ID 的新顺序填回原完整 `order` 的可见槽位，再向 API 提交完整 ID 列表；没有隐式跨分类移动。 |
| 其他入口 | “继续阅读”卡片不是排序目标；分类标签排序、分类归属选择、键盘聚焦手柄后按上下键，以及 EPUB/PDF 书卡打开行为保持原状。 |

视觉只取 demo 的“拖起源卡变淡、落点弱蓝、位置即时反馈”。不复制它在多列网格中仅用 `clientY` 判定前后的实现：同一行应按横向中线判定，跨行先判行、再判列；最终插入位置以指针相对于目标矩形计算。视觉过渡约 160–220ms，避免当前 `scale(1.02)` 和重浮层阴影造成跳动。

## Task 0：冻结基线与复现

**Files:** `app/ui/library/organization.js`、`app/ui/library/reorder.js`、`app/ui/library/view.js`、`app/ui/styles.css`、`tests/dom-regression.test.js`、`e2e/library-organization-live.spec.js`。

1. 记录上述文件状态、当前书库组织数据和当前可运行测试；不清理脏工作区，不使用真实书籍重置数据。
2. 用真实浏览器指针从首页第一本书封面拖到第二本：断言无排序请求、顺序不变；从手柄拖同一路径：断言请求成功。单击封面应仍打开书。该对照作为失败基线。浏览器/NAS 不可达时注明设备验收待做，不以 Happy DOM 模拟替代真实指针结果。
3. 对照 demo 确认视觉目标；固定“同分类内部排序，不跨分类移动”的边界。

## Task 1：修正纯顺序状态机（测试先行）

**Files:** `app/ui/library/reorder.js`、`tests/library-reorder.test.js`。

1. 先写失败测试：`[a,b,c]` 的 `a → 末尾 → 开头`、反复跨目标、原位取消、不同 pointerId 无效、多次 finish 最多提交一次。
2. 使每次预览从最初顺序和原始 `fromIndex` 计算，或始终从当前预览与当前索引一起计算；二者只选一种，杜绝原始数组/当前索引混用。会话保留 `originalOrder`、`previewOrder` 与稳定书籍 ID。
3. 提供纯函数把“筛选后可见顺序”合并回完整顺序；测试隐藏 ID 占位不变、完整 ID 不丢失、不重复及空/单项情况。
4. 验证：`node --test tests/library-reorder.test.js`；现有手柄和触摸延迟测试仍通过。

## Task 2：接通书卡直接拖动与落点预览

**Files:** `app/ui/library/organization.js`、`app/ui/library/reorder.js`、`app/ui/library/view.js`、`app/ui/styles.css`、`tests/dom-regression.test.js`。

1. 先写 DOM 测试：普通模式封面/书名 `pointerdown` 加位移能激活，位移不足不会激活；整理模式亦可激活；选择框/菜单不能激活；普通点击只打开一次，完成拖动后不误开书。
2. 仅对 book-grid 扩展起点选择；分类导航维持现有独立规则。用书卡外层承载排序会话；整理态以显式点击/键盘 guard 替代会吞指针事件的 `button.disabled`，并保持可理解的无障碍说明。指针 capture、原生图片拖拽抑制、点击抑制与清理必须覆盖 cancel、Esc、失焦和重渲染。
3. 把修好的控制器接入书卡拖动。指针移动只更新内存预览和本地 DOM/占位，不触发整页重绘或网络请求。计算目标卡矩形前/后半区与网格行列方向；无效落点取消，原位落点不提交。DOM 预览须维持 pointer capture 和书卡焦点，不通过销毁重建按钮实现。
4. 收敛样式为源卡淡化、明确但轻的插入提示、位移不过度的过渡；正常态不常驻大手柄，键盘聚焦时仍可见。筛选 query 有效时按 Task 1 的完整顺序合并规则排序。验证 CSS 浅/深色、窄屏、`prefers-reduced-motion`。

## Task 3：保存、回滚和冲突边界

**Files:** `app/ui/library/organization.js`、`app/ui/library/reorder.js`、`tests/dom-regression.test.js`、服务端测试（仅补断言，不改 `app/server/index.js` 接口）。

1. 预览只保留在内存；有效松手才调用现有 `commitLibraryOrganizationOrder`，保持 `scope`/`revision`/精确 ID 顺序契约。
2. 不在请求发出瞬间把书卡视觉弹回旧位置；完成后由权威返回顺序渲染。失败/409 时恢复或重新取得服务端顺序，显示可重试提示，保留用户可操作的书库。并发拖动期间不发送第二个 PUT。
3. 检查 route 改变、筛选条件改变、扫描结果刷新、组件重绘时取消旧会话；分类与“继续阅读”不参加 book-grid 排序。测试取消与一次写入边界。

## Task 4：真实指针回归与验收

**Files:** `e2e/library-organization-live.spec.js`、必要的测试夹具/说明文件。

1. 桌面 Playwright 从**封面中心**拖到同排相邻卡前/后半区、跨行目标，松手前检查预览，松手后确认仅一次排序 PUT、刷新后仍是同一顺序；普通单击仍打开书。
2. 验证 `pointercancel`、Esc、网格外释放、服务端失败/冲突均不留下半完成的排序或错误视觉；筛选后拖动提交完整 ID 顺序，隐藏书位置不漂移。
3. CDP/触屏测试：轻扫不排序、长按可拖、松手后的点击不打开书。保留现有手柄键盘排序与分类标签拖动回归，确认 PDF/EPUB 混排无差异。
4. 视觉验收：普通/整理、浅/深色、常见横屏与竖屏宽度，对照 demo 检查源卡、落点、过渡和长标题。测试输出与尚未通过的设备场景写入实施记录；未完成真实浏览器验收不得宣称“已修好拖动”。

## 完成判据与发布边界

- 不进入“整理”也能抓住首页书封面调整顺序；可预测地放在目标卡前或后，过程可见，刷新不丢。
- 点击阅读、触屏滚动、分类管理、筛选、键盘排序不退化；每次有效排序只有一个写入，失败可恢复。
- 只针对排序行为的代码与测试分阶段提交/交付；不夹带其他首页 UI、PDF/EPUB 或 fnOS 设置改动。用户本轮只要求规划，因此本文件创建后即停止，不执行 Task 0–4 的代码修改。
