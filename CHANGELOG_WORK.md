# Working Change Log

## Pre-UI baseline 2026-09-17T08:15:26-07:00

- Backup ZIP: D:\AI编程\reader\backups\babyreader-fnos-before-ui-20260917-081526.zip
- Backup ZIP SHA-256: 897427103B5F1674F93D08A04ACE9E59246563C3F3C240585CB8A933C3E646A1
- Backup manifest: D:\AI编程\reader\backups\babyreader-fnos-before-ui-20260917-081526-BACKUP_MANIFEST.txt
- Baseline FPK: D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk
- Baseline FPK SHA-256: 79F5292EC527C861561D8B09A42797F50F4CCC0EC98CCEFE66345AA1446BC1BD
- Baseline tests: 28 total, 26 passed, 0 failed, 2 skipped
- Baseline structure check: passed
- Restore verification: passed, including the empty wizard directory and byte-identical key files
- No Git commit or push performed

## UI polish stabilization 2026-09-17

- Incremental backup: D:\AI编程\reader\backups\babyreader-fnos-before-ui-polish-20260917-135406.zip
- Incremental backup size: 7515778 bytes
- Incremental backup SHA-256: D3131344CFE0A73EA48970B3309D6AE3808C944C3EA5953CD6AACAC0735E6AE6
- Backup manifest: D:\AI编程\reader\backups\babyreader-fnos-before-ui-polish-20260917-135406-BACKUP_MANIFEST.txt
- Pre-polish FPK SHA-256: 75FB59F65EEE2F8C9EF26BAB4796B6FBF3BD646F4CD2D35BD42355574A92EFB0
- Backup contains 41 files; excluded node_modules, build/runtime/test-artifact directories, temporary files, and dist artifacts other than the current FPK.
- Restore verification passed after actual extraction; key UI, test, package, and documentation files were byte-identical, and the temporary verification directory was removed.
- Preserved the existing Reader Shell, paper reading surface, single Drawer, readerActions/readerPanels architecture, core DOM IDs, server APIs, scanning, security, reading position, highlights, and user isolation logic.
- Improved Drawer focus entry, focus trapping, Escape/backdrop close behavior, original-launcher focus restoration, aria-controls, aria-expanded, and reserved/disabled action metadata.
- Added mobile TOC and display-settings entry points and changed the mobile toolbar to a four-column, two-row layout with matching reader safe space to prevent overflow and content obstruction.
- Reserved search, bookmarks, notes, and AI actions remain disabled and do not issue API requests.
- Expanded DOM regression coverage for one active Drawer panel, focus restoration, reserved actions without requests, legacy DOM IDs, action mappings, responsive classes, pagination, double-page fallback, and return-to-library behavior.
- Current regression result before final packaging: 32 total, 30 passed, 0 failed, 2 skipped.
- JavaScript syntax checks and npm run check passed before final packaging.
- UI_INTERFACE_MAP.md was expanded with DOM IDs, action IDs, panel IDs, handlers, APIs, keyboard and mobile entry points, status, and reserved interfaces.
- Final FPK build and nested package verification are recorded in the final execution report.
- No Git commit or push performed.

## Pagination geometry repair 2026-09-17

- Pre-change incremental backup: D:\AI编程\reader\backups\babyreader-fnos-before-pagination-geometry-20260917-144126.zip
- Backup size: 26869162 bytes
- Backup SHA-256: 5EE279A59844CD97C097AB7758F11408D9BA30EA917BB15F64CE907F3C02F716
- Backup manifest: D:\AI编程\reader\backups\babyreader-fnos-before-pagination-geometry-20260917-144126-BACKUP_MANIFEST.txt
- Pre-change FPK SHA-256: 1C244D9F2E17C39EDA6590CC934DDA2CDC1E4BE6A5CA07471B8BA77DD6A456EF
- Backup contains 190 files. Excluded node_modules, Git metadata, build/cache/coverage/runtime test artifacts, temporary directories, *.tmp, and *.log.
- Restore verification passed after actual extraction and byte comparison of the key UI, test, package, changelog, and FPK files. The temporary verification directory was removed.
- Root cause: paged layout relied primarily on column-width with Reader Shell padding and a fixed gap, allowing the browser to infer an extra column and making navigation use a stride that differed from the visible reader viewport.
- Added a deterministic geometry model based on reader.clientWidth, reader.clientHeight, explicit page margins, explicit column gap, reading mode, and device pixel ratio.
- Single-page mode now explicitly uses one column. Double-page mode explicitly uses two columns and falls back to one column below the existing responsive threshold.
- Page-group navigation and restored positions now align scrollLeft to exact reader-width group multiples, preventing cumulative drift and residual-column exposure.
- Added final paged-mode CSS isolation for overflow, overscroll, scrollbar gutters, box sizing, width constraints, padding, column count, clipping, pseudo-elements, and complex unbreakable content.
- Window resizing and typography/page-margin changes now remeasure pagination while preserving the existing semantic reading locator.
- Expanded DOM regression coverage for exact column counts, 1200x800 and 800x600 geometry, odd widths, fractional device-pixel ratios, varying margins and gaps, odd final column counts, repeated navigation without drift, and first/last boundaries.
- Latest non-overwriting pre-change backup: D:\AI编程\reader\backups\babyreader-fnos-before-pagination-geometry-20260917-145240.zip
- Latest backup manifest: D:\AI编程\reader\backups\babyreader-fnos-before-pagination-geometry-20260917-145240.zip.BACKUP_MANIFEST
- Latest backup contains 192 files, is 22770758 bytes, and has SHA-256 D32840797E25570DF9BB6B2A104CDD130A900B5C9537341DBE263525C2F1F599.
- Latest pre-change FPK SHA-256: AB7A773EADF4B60A425579F71575E55BD4BBFA7D01F606175D68F7DA75E8758E.
- The latest backup was actually extracted and app/ui/app.js, app/ui/styles.css, app/ui/index.html, tests, and CHANGELOG_WORK.md were verified before the temporary extraction directory was removed.
- Refined the root-cause fix so CSS uses a continuous fixed-width multicolumn track rather than column-count, which would incorrectly limit the entire book to one or two columns.
- Added one canonical spread-position model for buttons, keyboard navigation, pointer swipes, scroll snapping, semantic targets, chapter navigation, TOC/internal links, position restoration, page numbers, and boundary states.
- Pagination scroll positions are clamped and aligned to exact viewport-width multiples, including odd viewport widths and fractional pointer/scroll offsets.
- Paged progress now derives from horizontal page/spread state instead of vertical scrollTop, while continuous-scroll behavior remains unchanged.
- Interactive links, buttons, form controls, editable content, highlights, Drawer controls, and active text selections are excluded from swipe-triggered page turns.
- Current regression result before final checks and packaging: 40 total, 38 passed, 0 failed, 2 skipped.
- Modified files: app/ui/app.js, app/ui/styles.css, tests/dom-regression.test.js, and CHANGELOG_WORK.md. app/ui/index.html and tests/reader-core.test.js were inspected and required no pagination-specific changes.
- Preserved continuous scrolling, Reader Shell, the single Drawer, EPUB2/EPUB3 TOC and internal links, highlights, colors and notes, return-to-library behavior, reading progress, user settings, authorization scanning, security logic, and X-Trim-Userid isolation.
- No Git commit or push performed.

## 居中纸张卡片布局、缓存修复与单页防泄漏 2026-09-18

- 根因与修复：
  1. 静态资源缓存：`app/server/index.js` 以 `Cache-Control: public, max-age=3600` 发送静态文件，FPK 升级后浏览器永远看不到新 UI。改为一档资源 ETag 协商 + `no-cache`，仅 lib/字体/图片用 immutable 长缓存；index.html 资源固定 `?v=2`。
  2. 页面美学：分页重构为居中"纸张卡片"：左右对称外边距（insetLeft === insetRight）、纸宽上限（单页 780px、双页 1180px）、双页 72px 中缝、12px 圆角、柔和投影（0 10px 34px rgba(0,0,0,0.10)）、上下留白。
  3. 单页右侧泄漏：单页 `gap=0` 时第 2 列起点 740px 落在 780px 纸内，40px 被裁文字露出右缘。推导防泄漏不变量 `gap >= columnPadding`，单页强制 `naturalGap = Math.max(columnPadding, 48)`（视觉上不可见，仅保证第 2 列起点越过纸右缘）。
  4. 移除 translateX 自愈：纸张卡片化后 transform 会把整张卡片推移出居中位，实测导致 paperLeft=-1914 空白页；改为纯 scrollLeft（overflow:hidden 元素可编程滚动已验证可靠）。
  5. 打开书籍后页数冻结为 1：EPUB 内容异步渲染完成后无重新测量触发（ResizeObserver 只观察卡片盒子，宽度固定 780 不变化）。在 renderArticle epub 分支与 notifyOpen finally 中补 rAF 重测，图片 load 亦触发。
- 自动化测试：46 个，44 通过，0 失败，2 跳过。
- 真实浏览器实测（IAB，1440x900，8099 开发服务器）：
  - 单页：纸 780px、边距 330/330、列宽 700、gap 48、步进 748、24 页 24 组；逐字片段级（Range.getClientRects）6 页扫描零泄漏；上一页/下一页即时推进 sL=748×k。
  - 双页：纸 1180px、边距 130/130、列宽 514、中缝 72、组步进 1172、32 页 16 组；6 页扫描零泄漏；键盘 ArrowRight 连翻正常（sL 0→1172→…→8204）。
- FPK 核验：
  - 路径 `dist/babyreader-fnos.fpk`，大小 4,123,371 字节
  - SHA-256 `B5E40107518AE46F9FDF345144FD2585A024877D71D56E10139CF90CD1EECA21`
  - 双层解包逐字节核验：`ui/app.js`、`ui/styles.css`、`ui/index.html`、`server/index.js` 与工作区完全一致（ALL MATCH）。
- 未做 Git 提交或推送。

## UI 入口改为 url（网页独立标签页打开）2026-09-18

- `app/ui/config` 的 `babyreader-fnos.main` 入口 `type` 由 `iframe` 改为 `url`：桌面点击图标改为在浏览器独立标签页打开 `http://<nas-ip>/app/babyreader-fnos/`，用户也可在任何浏览器直接输入该 URL 使用（需 NAS 登录态；统一网关校验会话后注入 X-Trim-Userid/Username/Isadmin，多用户隔离逻辑不变）。
- `scripts/validate-structure.js` 的 UI 入口校验放宽为 iframe|url。
- 其余 manifest、server、cmd 生命周期脚本、网关前缀/套接字全部保持不变。
- 自动化测试 46 项，44 通过，0 失败，2 跳过。
- FPK：`dist/babyreader-fnos.fpk`，4,126,557 字节，最终 SHA-256 以 dist/babyreader-fnos.fpk 实际产物为准（包内 changelog 与哈希存在自引用时序，不写入具体值）；双层解包核验 `ui/config=type:url` 且 `ui/app.js`、`ui/styles.css`、`ui/index.html`、`server/index.js` 与工作区逐字节一致（ALL MATCH）。
- 未做 Git 提交或推送。真机待验证：fnOS 1.1.3100 实际版本对 type:"url"+gatewayPrefix 组合的处理。

## 落地微信读书排版几何（双页+单页全对齐）2026-09-18

- 调研基线落地：
  1. 纸张几何：双页模式宽度对齐微信读书基线（1440 视口下纸宽 1152px，列宽 457px，中缝 98px，边距 144/144 完全对称）；单页模式纸宽封顶 660px（正文 520px，边距 390/390），彻底消除超宽长行疲劳。
  2. 垂直呼吸：视口顶部 72px 顶栏空间，底部固定 58px 呼吸留白；纸张卡片内边距上 84px / 下 70px（微信实测不对称留白节奏，为章节标题预留沉浸空间）。
  3. 卡片质感：纸张卡片圆角由 12px 提升至 16px，柔和投影 `0 12px 40px rgba(0,0,0,0.14)`。
  4. 排版细节：章节一级标题增加底部 1px 分割细线与下留白，契合微信引子/章节标题风格。
  5. 静态资源版本升至 `?v=3`。
- 自动化测试：46 项，44 通过，0 失败，2 跳过。
- 真实浏览器验证（IAB 1440x900）：
  - 双页：纸张 1152x718，左右边距 144/144，列宽 457px，中缝 98px，padding 84/70/70/70，圆角 16px，0 泄漏，截图确认居中纸卡视觉完美。
  - 单页：纸张 660x718，左右边距 390/390，列宽 520px，padding 84/70/70/70，圆角 16px，0 泄漏，翻页即时步进 710px。
- FPK 重建并通过双层解包逐字节核验。

## 移除多余纵向分割线并适度加宽双页卡片 2026-09-18

- 移除三根竖线：`styles.css` 中 `body.is-epub.double-page-reading .reader .article` 的 `column-rule` 彻底置 `0 solid transparent`。在连续多列轨道下，上一页和下一页的列间线条会绘制在当前可视面的 padding 区内，表现为卡片左右边缘和中缝出现三条突兀的竖线，移除后页面恢复微信同款纯净白底纸张。
- 双页卡片适度加宽：
  - `PAPER_WIDTH_RATIO` 从 `0.80` 微调至 `0.84`；`PAPER_MIN_SIDE_GAP` 从 220 收至 200；
  - 1440x900 视口下双页纸张由 1152px 加宽至 **1208px**（左右留白 116px/116px 对称）；
  - 单列正文由 457px 扩展至 **485px**（每行约 27-28 汉字），中缝维持 98px；
  - 既消除原本偏窄的视觉压迫，又保证单行汉字量在舒适范围。
- 静态版本更新至 `?v=4`（`styles.css?v=4` 和 `app.js?v=4`）。
- 测试：46 项，44 通过，0 失败，2 跳过。
- FPK 重建并双层解包逐字节核验。

## 阅读模式精简为连续滚动 + 双页分页 2026-09-18

- 设置面板「阅读模式」下拉移除「单页分页」选项，仅保留 `连续滚动` 与 `双页分页`。
- `single` 不再是用户可选偏好，仅作为窄窗口（<900px）下双页的自动降级渲染模式保留；宽屏恢复后自动回到双页。
- 兼容迁移：
  - 前端 `applyUserState`：已存储的 `readingMode:'single'` 迁移为 `'double'`；`continuousScroll:false` 同样映射 `'double'`。
  - `setReadingMode`：传入 `'single'` 时自动纠正为 `'double'`。
  - 服务端 `storage.updateSettings`：白名单收敛为 `scroll|double`，遗留 `'single'` 值读写均归一化为 `'double'`。
- 静态资源版本升至 `?v=5`。
- 真实浏览器验证（IAB）：下拉仅两项；scroll/double 切换正常；820px 窄窗自动降级为单列（cols=1, col=480），1440px 恢复双页（cols=2, col=485, 20 组）。
- 测试：46 项，44 通过，0 失败，2 跳过；FPK 重建并双层解包逐字节核验。

## 扩大阅读区域 2026-09-18

- 目标：保持微信读书式居中纸卡美感的前提下，显著扩大实际阅读面积。
- 几何调整（1440×900 实测对比）：
  - 双页纸宽 1208 → **1296px**（比例 0.84→0.90，最小边距 200→128），单列正文 485 → **529px**；
  - 单页纸宽封顶 660 → **700px**；
  - 纸卡高度 718 → **752px**：外部顶带 72→56、底部呼吸 58→40，内部上下 padding 84/70 → 64/56；
  - 每页正文可用高度 544 → **632px**（+16%），整体阅读面积（列宽×页高）提升约 **24%**；
  - 中缝维持 98px，圆角 16px，左右边距 72/72 完全对称。
- 真实浏览器验证：v=6 资源加载；翻页步进 1254 精确；片段级泄漏扫描 0；截图确认排版视觉。
- 测试：46 项，44 通过，0 失败，2 跳过。
- FPK 重建并双层解包逐字节核验。

## P0 排版功能：首行缩进 / 字体切换 / 段间距 / 护眼背景 2026-09-18

借鉴 `legado-with-MD3` 项目的 ReadBookConfig 设计，落地四项排版增强（CSS 变量驱动，用户设置面板控制）：

**1. 首行缩进（textIndent）**
- 范围：0～4 em，默认 2 em（标准中文段落缩进）
- CSS 变量：`--reader-text-indent`，EPUB 正文段落自动缩进，标题 / 引用 / 列表 / 居中文字保持无缩进
- 设置滑块实时预览，自动持久化

**2. 段间距（paragraphSpacing）**
- 范围：0.4～3.0 em，默认 1.1 em
- CSS 变量：`--reader-para-spacing`，控制段落底部间距
- 设置滑块实时预览，自动持久化

**3. 正文字体切换（fontFamily）**
- 三档选择：
  - **系统黑体** (`sans`)：无衬线字体栈（系统 UI 字体 + PingFang SC + Noto Sans SC）
  - **宋体** (`songti`)：传统宋体栈（SimSun + STSong + 宋体回退）
  - **思源宋体** (`source-serif`)：开源衬线字体栈（Noto Serif SC + Source Han Serif CN，缺失时自动降级到宋体）
- CSS 变量：`--reader-font-family`，EPUB 正文统一应用
- 所有字体栈末尾加通用族 `serif/sans-serif`，确保任何平台都有回退
- 设置下拉实时切换，自动持久化

**4. 护眼背景（theme = 'sepia'）**
- 新增第三主题：`theme-sepia`（暖米色底 #EFE5CF + 深墨色文字 #3D3427）
- 服务端白名单已支持 `['dark', 'light', 'sepia']`
- 设置面板「背景」下拉新增「护眼米黄」选项
- 顶栏主题切换按钮保持深色 ↔ 浅色循环，护眼模式通过下拉选择

**技术边界保证（安全迁移）**：
- 前端 `applyUserState`：已存储的旧设置缺省字段使用默认值填充，不破坏既有用户配置
- 服务端 `storage.updateSettings`：新字段均有严格范围钳制（同前端逻辑），非法输入自动纠正
- EPUB 内嵌 iframe 主题（`getEpubThemeCss`）同步应用字体 / 缩进 / 段距，两种渲染路径保持一致
- CSS 默认值保持历史行为（无缩进、1.1 em 段距、黑体），用户首次打开旧书不会突然变样式，主动调整才生效

**测试覆盖**：46 项，44 通过，0 失败，2 跳过（POSIX 生命周期 + Windows 符号链接）

**交付物**：
- FPK 路径：`dist/babyreader-fnos.fpk`
- 大小：4,147,662 字节
- SHA-256：`A330E53A3497B8A3DC44A423830F0AD32F9652D22AE1B4FEFA78F1E3EDA75CF5`
- 双层解包字节级核验：`ui/app.js`、`ui/styles.css`、`ui/index.html`、`server/storage.js` 全部与工作区逐字节一致（ALL MATCH）

静态资源版本升至 `?v=7`。

## P0 排版功能完善（首行缩进 / 字体切换 / 段间距 / 护眼背景）2026-09-18

**已交付内容：**
- **首行缩进**：CSS `--reader-text-indent` (0~4em, 默认 2em), 段落自动缩进，列表/引用/居中文字除外。
- **段间距**：CSS `--reader-para-spacing` (0.4~3em, 默认 1.1em)
- **正文字体**：三档可选（系统黑体 / 宋体 / 思源宋体），CSS `--reader-font-family`, EPUB 内外同步应用。
- **护眼背景**：新增 `sepia` 主题 (#EFE5CF 暖米底 + #3D3427 深墨字)，卡片层在 paged mode 有独立背景色，light/dark使用 surface 区分度更高；sepia 下卡与 stage 同色调仅用阴影区分。
- **设置面板**：背景下拉增至三项；正文字体 / 首行缩进 / 段间距三控件；输出显示对应值。
- **服务端白名单**：fontFamily='sans|songti|source-serif'，clamped 值同前端钳制范围。
- **EPUB iframe 同步**：getEpubThemeCss() 使用 state.fontFamily/textIndent/paragraphSpacing。

**技术要点：**
- CSS vars 驱动实时生效，无页面重载；applyTypography() 调用后请求 rAF 重测分页轨道。
- font-family fallback: Noto Serif SC→Source Han Serif→SimSun→Songti→Georgia; sans stack: -apple-system→PingFang→Noto Sans→Microsoft YaHei。思源宋体依赖客户端安装，未安装时回退到系统宋体（视觉上可能无明显差异，该问题将在 P1 以嵌入 webfont 解决）。
- 标题字体跟随读者字体栈（与 legado 一致），粗体仍足够区分层级。
- paged card background: dark/light 使用 surface 增强纸感；sepia 使用 surface-alt 保持统一。

**测试覆盖：**
- reader-core.test.js 新增 typ 字段钳制测试 + frontend wiring assertions（HTML ids / CSS vars / theme-sepia）。
- 总计 46 项，44 通过，0 失败，2 跳过。

**已知事项需人工验证：**
1. 思源宋体 vs 宋体显示区别（取决于客户端是否安装 Noto/Source Han 字体）。
2. sepia 模式下卡片与背景的视觉分界（应靠阴影而非颜色差）。
3. 第一个 after-heading 段落是否按预期缩进（Chinese convention）。
4. 列表项不缩进但子项缩进？当前所有 li p = no-indent。
5. headerFontFamily 跟随 bodyFont（非 bug，是设计决策）。

**交付物：**
- FPK：dist/babyreader-fnos.fpk, 4,149,227 bytes, SHA-256 AF413CDFB5153D137EDB0F622FA3D9015EA03CB9F21199DF725B132EC6E5DA07
- 双层解包逐字节核验：ALL MATCH ✓

## P0: 移除阅读/编辑按钮 + 右侧悬浮工具栏图标化放大 2026-09-18

**已交付内容：**
- **右上角阅读/编辑按钮移除**：`topbar-right` 删除 `btnRead` / `btnEdit` 及其 DOM/事件绑定；`setMode()` 中不再操作这两个按钮的类名。经核查当前代码不存在进入编辑模式的键盘快捷键，markdown/txt 的编辑能力在 UI 上已无入口（编辑器 DOM 保留，便于日后恢复）。
- **右侧悬浮工具栏改为全图标化**：按钮文字标签全部删除（search/bookmarks/notes/ai/settings），仅保留 `<svg>` 占位符；所有按钮统一尺寸从 34px → 40px（触摸友好），整体工具栏宽度 48px → 56px，间隙 5px → 6px，圆角 16px → 18px；SVG 从 18px → 20px。
- **图标设计（内联 SVG）**：搜索 / 书签 / 笔记 / AI / 设置各新增专用 icon（stroke 风格与现有 theme-btn/highlight/export 一致），disabled 状态 opacity 降低至 0.28。
- **CSS 微调**：`.reader-floating-toolbar` background + shadow / backdrop-filter 保持；`.theme-btn / .reader-tool-btn :hover` 交互不变（accent bg + hover-bg）；`:disabled svg opacity` 单独控制，保证禁用图标足够清晰可见。

**技术边界保证（安全迁移）：**
- `btnEdit.disabled` 逻辑已删，但 editorContainer 与 textarea 仍在 DOM 中（留白，便于未来恢复或用户自定义打开）；`state.mode` 始终为 'read'（EPUB 只读，markdown/txt 也默认 reader-only）。
- `updateTopbarState()` 注入新 SVG；`getSearchIconSvg()` / `bookmarkIconSvg()` 等函数内联返回。
- 测试断言增加：检查 `btnRead` / `btnEdit` 不存在，toolbar button `textContent.trim() === ''`，图标存在。

**已知事项需人工验证：**
1. markdown/txt 编辑入口已彻底消失（无按钮、无快捷键），确认这符合你的预期；如需保留编辑能力请告诉我，我加一个图标按钮回来。
2. 右侧悬浮按钮是否比原来大且更易点？（40x40 vs 34x34，间距放宽）
3. disabled 预留功能的图标是否足够淡（opacity 0.28），但仍看得清位置？
4. 主题切换按钮的 SVG 是否在 light ↔ sepia ↔ dark 下都正确？

**测试覆盖：**
- 新增断言确认 topbar 无 mode-btn、toolbar button 纯图标；46 项测试，44 通过，0 失败，2 跳过（POSIX 生命周期 + Windows 符号链接）。
- CSS 变化无硬性断言（依赖视觉验收）。

**交付物：**
- FPK：dist/babyreader-fnos.fpk（大小与 SHA-256 以 dist 实际产物为准，包内 changelog 存在自引用时序，故不写入具体值）
- 双层解包逐字节核验：ALL MATCH

静态资源版本升至 `?v=11`。
