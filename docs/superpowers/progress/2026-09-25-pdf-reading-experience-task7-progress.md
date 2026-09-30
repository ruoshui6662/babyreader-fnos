# PDF 阅读体验优化（Task 7）进度

计划：`docs/superpowers/plans/2026-09-25-pdf-reading-experience-task7.md`

状态：执行中。当前工作区包含此前 PDF、书库、搜索和 AI 等未提交功能；本任务只按计划触及 PDF 阅读体验相关路径，不自动提交、合并、打包或部署。

## 记录规则

- 每个阶段记录 RED→GREEN 命令、实际通过/失败/跳过数量、接口裁决与未覆盖设备条件。
- 本地合成 PDF、Chromium 和 DOM 测试与 fnOS 真机验收分开陈述。
- 用户真实 PDF 只用于本地/设备人工验收，不复制进仓库或 FPK。
- 任何授权、UID、来源指纹、存储格式或 EPUB/TXT 回归立即停止后续阶段。

## Task 7.0 — 基线与可测信号（2026-09-25）

- 基线：`main`，提交 `578785fb5d47e57309fa65a38e482ba12e7cdf72`，工作树 dirty；PDF Tasks 1–5 及其测试仍为当前未提交依赖。仓库内未发现现存 `.fpk` 文件，历史 `dist-fpk-*` 目录仍按用户原状保留，本阶段未打包、安装或删除。
- 关键未跟踪文件 SHA-256：`pdf.js`=`9EF57FFD7E94C98A6E5B0F70C51587C8DF4E3D31B17CAE997376273E19A3F976`；`pdf-annotations.js`=`EEB0E513F54E5C9F2D166467ED95AFA7B0BEDA13D9639FD348D6780F85FD6460`；`pdf-annotation-geometry.js`=`E24A966454170E194A2C1C754F8773DC36DF2276B2748B3EC1A626488ABBC69A`；`pdf-reader.test.js`=`891CFC56A9442C10B38ADB5BAA80827CFD71651BAB3B98A2088FB25118CFE57E`；`pdf-annotations.test.js`=`D69C5C536FFB32277F07A403A7AA29F555A582A9AE0A082A4C147E899D98417C`。
- RED→GREEN：先新增 `getDebugState()` 行为测试，确认因接口不存在而失败；最小实现后 1/1 通过。调试接口只返回代次、活跃任务、队列、完整帧数、当前页、缩放和布局，不改变生产 UI。
- 浏览器基线：4 页合成样本首个 Canvas＋文本层 ready 为 859–1127 ms；旧实现观测到 `maximumActiveRenders=2`；缩放页面顶部锚点样本偏移 0px；稳定后保留 2 个完整页面帧。320/375px 控制区从 52px 延伸到 177px，800/1100px 延伸到 117px，1600px 与 52px 顶栏重合；各宽度未出现根文档横向溢出。该数据只作前后对照，不作为宽松通过门槛。
- 长文档基线：既有 129 页合成元数据测试验证页面尺寸缓存不超过 128 项；以它覆盖计划中的 100 页基线，因为它跨过缓存边界且更严格。用户 444 页及真实双栏样本只保留此前设备截图/反馈作为人工基线，未复制进仓库，也未把它们写成自动化通过。
- 阶段门禁：`node --test tests/pdf-reader.test.js tests/pdf-annotations.test.js tests/dom-regression.test.js` → 163/163；`npx playwright test e2e/pdf-reader.spec.js --project=chromium` → 35/35；`npm run check:portable` → 52 required files、9 lifecycle scripts。仅有 Windows 颜色环境提示，无失败或跳过。
- 一致性修订：质量路线图从“Task 7 未实施”更新为 7.0 已完成、执行中；P3.2 进度页顶部和看板改为 Task 0–5 已完成，与其后已有 Task 5 记录一致。
- 下一阶段：Task 7.1，可见页优先、默认单并发的渲染调度器。

## Task 7.1 — 可见页优先的有界调度（2026-09-25）

- 新增纯调度器 `pdf-render-scheduler.js`：当前可见页优先，其次其他可见页，再按滚动方向安排邻页；去重并默认限制 1 个 active render。队列用 `generation:renderRevision` 隔离切书和缩放，失败页不会在同一状态无限重试；邻页失败在后来成为当前页时允许一次显式重试。
- 控制器接线：`IntersectionObserver` 与 scroll 只重算 visible/buffered/selected 优先级；render settle 后才泵入下一页。快速反向滚动会取消已离开缓冲区且未被选区固定的 Canvas task。邻页失败只给页面写 `data-render-state=error`，不会覆盖全局状态；成为当前页后的真实失败才显示页级错误。
- RED→GREEN：调度器文件不存在时 5 项契约全红，随后可见优先、上下方向、单并发、代次、失败、LRU 与显式释放转绿；控制器并发测试从 `[1,2,3,4]` 同时启动转为只启动 `[1]`，settle 后才 `[1,2]`；反向滚动测试先未取消页 2，修复后取消并立即转向新可见页。
- 竞态复盘：连续 140%→80%→120% 时，旧 `getPage()` pending 曾让最终任务被误记为永久失败。增加 `markDeferred`，把“暂时被旧任务占用”与真实渲染失败分开；旧任务结束后重新计算最终代次。对应 Chromium 快速缩放回归恢复通过。
- 布局复盘：串行渲染暴露出未渲染页只用 100% CSS 占位、前置页提交后才扩大导致移动端当前页下跳 1100px。`updatePageSlotSizes()` 现在为所有页面壳同步应用可靠的默认页面尺寸，已知页面继续使用自身尺寸；异步帧提交不再改变同尺寸前置页高度。
- 构建边界：新脚本在 `index.html` 中位于 `pdf.js` 之前，并加入结构验证、构建 provenance 和 fnOS 设备验收清单。未打包、未部署、未提交。
- 最终门禁：Node 专项 176/176；PDF Chromium 35/35；portable 53 required files、9 lifecycle scripts；相关 JS `node --check` 与 `git diff --check` 通过。Task 7 baseline 从峰值 active render 2 降为 1，4 页样本本轮首帧 537ms；该单次时间只作对照，不宣称跨设备性能结论。
- 下一阶段：Task 7.2，Canvas、文本、搜索与标注的统一页面帧提交。

## Task 7.2 — 原子页面帧与稳定替换（2026-09-25）

- 页面帧契约：Canvas 与文本层先在 detached 节点完成，再于同一个 animation frame 提交；wrapper、Canvas、文本层和渲染记录共享 `frameId=generation:pageIndex:sequence`。搜索和标注都校验该 frameId，晚到的旧 rAF 不得删除或覆盖新层。
- 视觉稳定：缩放重绘期间保留上一完整帧并按新尺寸临时缩放，页面标记 `aria-busy=true`；新帧 ready 后做 160ms 无位移淡化，reduced-motion 下禁用动画。失败保留旧帧并显示页内“重试本页”，不会把页面清成黑/白块。
- RED→GREEN：新增原子 Canvas/TextLayer、替换失败重试、标注 frameId、搜索 stale frame 四组测试，均先因缺失接口/混合帧失败，随后转绿。组合回归又发现异步帧提交使旧“一次 tick 即完成”假设失效，并直接增加 `cachedPageSizeCount` 信号验证 128 项尺寸缓存，而不再用 DOM 宽度做代理。
- 稳定性修复：尺寸 LRU 淘汰后页面壳继续使用首个可靠页面比例，避免未渲染页折叠。Chromium 回归还定位到通用 `saveTextScroll` 在 PDF 刷新时写入 EPUB `semantic-position`、覆盖 PDF 页码；现已禁止文本进度路径处理 PDF，并加入 Node 与浏览器刷新恢复回归。
- 门禁：`npm test` → 431 tests / 424 passed / 0 failed / 7 Windows/POSIX 环境跳过；`npx playwright test e2e/pdf-reader.spec.js --project=chromium` → 35/35；`npm run check:portable` → 53 required files、9 lifecycle scripts；相关 JS `node --check` 与 `git diff --check` 通过。本轮 4 页样本首帧 814ms、峰值 active render 1；仅作本机对照。
- 未打包、未部署、未提交；下一阶段 Task 7.3：长文档页面壳、缓存与选区预算。

## Task 7.3 — 长文档轻量页面壳（2026-09-26）

- 超过 250 页时，每页保留轻量 section 和稳定首页面比例，Canvas/TextLayer 仅在渲染窗口物化；离开缓冲区后回收完整帧与页面视觉节点。长文档不为每个 section 注册 IntersectionObserver，继续由滚动位置和页码驱动有界队列。小文档保留原路径。
- RED→GREEN：500 页样本旧实现首开创建 500 个 Canvas 而失败；改动后 500/5000 页样本首开物化节点保持 ≤10，跳至末页直接得到同一 `frameId` 的 Canvas/TextLayer。129 页尺寸缓存边界、8 页选区与 32M 像素保护继续通过。
- 门禁：`npm test` → 432 tests / 425 passed / 0 failed / 7 环境跳过；PDF Chromium → 35/35；portable → 53 required files、9 lifecycle scripts。合成环境中的 5000 个轻量 section 仍是线性 DOM 数量；真实 444 页文档的滚动内存与高度需设备验收，不将合成结果当成 fnOS 结论。
- 下一阶段 Task 7.4：统一顶部操作区与响应式阅读壳。

## Task 7.4 — 响应式顶部操作区（2026-09-26）

- 用同一个 `data-pdf-toolbar-mode=wide|compact|mobile` 决定工具区的位置和布局。1600/1100/800/430/375/320 六档合成视口断言标题不覆盖、44px 点击区、无根级横向溢出；430px 两组仍同排，320px 折行为约 105px 高。普通页数由页码组承担，独立状态只显示加载/失败等异常。
- RED→GREEN：先加入视口矩阵，再调整工具区；旧 DOM 正则还依赖此前 `html[data-reader-surface]` 选择器，已改为检查显式 toolbar mode。整套 E2E 中本用例首次因复用了上一个用例保存的第 3 页而失败，改为主动跳到第 1 页后单项连续 5 次通过；不是生产功能回退。
- 缓存版本已提升，以免浏览器继续使用旧 CSS/JS。工具栏图标及三主题的设备视觉确认尚未完成，不宣称 Task 7.4 全部视觉门禁关闭。

## Task 7.5 — 页内锚点与原生滚动（2026-09-26）

- RED：读到第 3 页约 60% 后放大，归一化位置偏差约 0.20。GREEN：捕获 `{pageIndex, normalizedY, viewportOffset}`，缩放/单双页重组后按页面新尺寸恢复；靠近页顶时保持页顶而非把 120px 阅读参考线误当实际位置。缩放与布局过渡期加代次隔离的 scroll guard。
- 根因复盘：`scroll-snap-type: y proximity` 会在程序设置 `scrollTop` 时再次吸附，双页切换实测偏差约 0.074；PDF 现改为自然滚动，保留翻页按钮的 spread 语义。合成测试覆盖手动缩放、单双页切换、1000→800 竖屏回退，归一化偏差门槛 0.01；适宽后页面不足一屏时浏览器无法物理保持原 60% 视点，实际设备仍需验收。
- PDF 页面容器现在可键盘聚焦，原生 PageUp/PageDown 测试通过，不拦截浏览器滚轮、触摸与文本选择。页码继续是持久化契约；页内比例目前只在当前会话重排时保留，不更改旧进度数据格式。

## Task 7.6 — 交互与可访问性联动（2026-09-26）

- PDF 页码/缩放使用一个隐藏的 `aria-live=polite` 节点，只在主动翻页或缩放时播报；被动滚动不刷屏。移除缩放值自身的重复 live。高对比模式下搜索框线和键盘焦点使用系统 `Highlight`；reduced-motion 的页面帧过渡仍按原有规则关闭。Chromium forced-colors＋reduced-motion 单项测试先因程序聚焦时未匹配 `:focus-visible` 而红，补充 `:focus` 后通过；不把这当作真实系统高对比模式验收。
- 既有多栏真实指针拖选、跨行选区、搜索面板保留、精确命中/仅页面降级、标注保存和 frameId 竞态测试在全套 Chromium 回归中通过。旋转页、200% 系统缩放、高对比与深色/护眼主题的逐项人工视觉验证仍未完成。

## Task 7.7 — 本地回归与待设备门禁（2026-09-26）

- 最终 `npm test`：433 总数 / 426 通过 / 0 失败 / 7 Windows/POSIX 环境跳过。最终完整 Chromium：143 总数 / 132 通过 / 11 条件跳过；覆盖 EPUB 书签、划线、搜索、AI、设置及 PDF 阅读路径。新增 5 轮 PDF 滚动→缩放→竖屏→搜索→切书重开合成压力用例，render active ≤1、4 页夹具的 Canvas/TextLayer ≤4，浏览器无 pageerror。独立 PDF 专项在最后两条新增测试前 40/40 通过；最终完整 Chromium 已包含压力及高对比测试，两条均通过。
- `npm run check:portable`：53 required files、9 lifecycle scripts；`node --check app/ui/reader/pdf.js` 与 `git diff --check` 通过。没有自动打包、安装、部署、提交或触及真实书籍。
- 未关闭的门禁：NAS 上 444 页及双栏真实样本、长时内存曲线、Safari/Firefox/移动真机、旋转页及三主题视觉。合成数据不能代替这些设备结论。

## 2026-09-26 后续设备反馈与规划接续

- 用户反馈：当前测试版本的 PDF 封面、双栏、单栏和缩放正常。记录为**这些场景的用户观察通过**；未提供 444 页长文档的资源曲线、旋转页、长时间使用、多用户或各浏览器完整验收数据，不将 Task 7 全部门禁改为完成。
- 左上角可见页码播报修正及 PDF 第一页懒加载封面已进入新隔离 FPK：`dist-fpk-20260926115511/babyreader-fnos.fpk`（manifest 1.1.7，SHA-256 `0552810ea1d6fb9d1c8b6ae960d20d6a00f742faedcd1fe73759a424632045e7`）。本地 `npm test` 为 433 总计 / 426 通过 / 0 失败 / 7 环境跳过；PDF Chromium 44/44。FPK 由 dirty 工作树快照构建，未在此记录中宣称 NAS 全量验收。
- 下一功能阶段已列入 `../plans/2026-09-25-pdf-reader-quality-roadmap.md`：P3.3 PDF 笔记导出、P3.4 PDF AI 问书，分别另立详细 spec/计划并经用户确认后实施。当前只改计划/进度，不改功能代码。
