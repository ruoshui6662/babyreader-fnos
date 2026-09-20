# BabyReader UI 视觉重设计方案（对齐 Apple HIG）

> 阶段：**设计方案，未落地**。需用户认可后再实施。
> 目标：借鉴 Apple Human Interface Guidelines，让 BabyReader 在"纯 Web / fnOS 独立标签页"场景下更精致、更克制、更具质感，同时 **不破坏** 现有稳定性（legacy DOM ID、统一网关、纸卡分页几何、多用户隔离）。

---

## 一、设计原则来源（Apple HIG 提炼）

Apple HIG 的三大支柱，映射到"阅读器"这个具体产品：

| HIG 支柱 | 含义 | 对 BabyReader 的落地要求 |
|---|---|---|
| **Clarity 清晰度** | 文字与图标在任何尺寸都易读；内容优先，chrome（装饰性界面元素）退后 | 正文是绝对主角；工具栏"用时才显眼"；图标语义单一、留白充分 |
| **Deference 顺从** | UI 服务于内容，不抢戏；用通透/材质强调内容 | 半透明悬浮工具栏、克制配色、以留白分层而非重描边分层 |
| **Depth 深度** | 层次与动效传达空间感，让界面"可理解" | 卡片阴影、材质层级（背景层/栏层/悬浮层/抽屉层）、克制的过渡动效 |

配套 HIG 具体规范：
- **San Francisco** 字族（SF Pro / SF Compact）+ 动态排版（Dynamic Type）与语义化字级（Large Title / Title / Body / Caption）。
- **系统语义色**：label / secondaryLabel / tertiaryLabel / separator / fill，随浅色/深色/高对比自动切换。
- **连续曲率圆角**（continuous corner radius）：iOS/macOS 的圆角不是纯圆弧，而是"方→圆"平滑过渡；用 `border-radius` 近似 + 层级化圆角尺寸。
- **材质系统**（Materials）：ultraThin / regular / thick 三档磨砂玻璃，用于栏、弹层背景。
- **SF Symbols**：统一的线宽、光学对齐、字重随文本 size/weight 联动。
- **触感与反馈**：hover/active 状态、按压反馈、focus ring（键盘可达性）。
- **无障碍**：WCAG AA 文本对比 ≥4.5:1；44pt 最小点击目标；尊重 `prefers-reduced-motion`、`prefers-contrast`。

---

## 二、现状诊断（差距清单）

基于 `styles.css` 现有 token 与 `index.html` 结构：

1. **配色**：`--accent: #DA7756`（暗脏橙）语义弱；三主题虽齐但层级色（surface / surface-alt / border）对比接近，缺乏 Apple 那种"背景→栏→卡片"清晰的材质台阶。
2. **字级**：正文 `1.1875rem`，但 UI 文字（顶栏/工具栏/设置）字号零散（10/12/13px 混用），没有 HIG 的语义字级体系，视觉噪点大。
3. **间距**：padding/gap 数值随机（5px、6px、18px、20px…），没有统一的 4/8 倍数间距栅格，留白节奏不干净。
4. **圆角**：12/16/18/20/10px 混用，缺乏"小组件/卡片/大弹层"的层级化圆角规范。
5. **顶栏文字按钮**："上一章/下一页"等仍是文字按钮（且历史上刚把右侧工具栏图标化），顶栏与右侧栏风格不统一——一边文字、一边图标。
6. **悬浮工具栏**：图标按钮已存在，但尺寸/间距/材质/无 hover 微交互，观感"平"。
7. **抽屉/设置面板**：字段是 label+input 简单堆叠，缺乏分组卡片（Grouped List）、缺乏 iOS 设置那种分块质感。
8. **图标**：自绘内联 SVG 与"风格统一"目标有差距（stroke 观感、光学大小不齐）。
9. **动效**：几乎只有 `transition 0.15s`；抽屉/弹层缺乏 Apple 的缓动曲线（spring-like / ease-out）。
10. **无障碍**：focus 样式与高对比模式未系统化。

---

## 三、重设计 Token 系统（方案核心）

> 策略：**扩展现有 CSS 变量体系**，不推翻。新增语义 token，旧变量作为别名保留，保证既有引用不炸。所有值走 HIG 数值。

### 3.1 颜色（语义色板）

采用 Apple 的 **label / secondaryLabel / separator** 语义，随主题切换：

| Token | Dark | Light | Sepia | 用途 |
|---|---|---|---|---|
| `--color-bg` | #000000* | #FFFFFF | #F3ECDD | 最底层舞台（*深色可选纯黑或 #1C1C1E） |
| `--color-elevated` | #1C1C1E | #FFFFFF | #FBF6EC | 卡片/纸面 |
| `--color-bar` | rgba(30,30,32,.72) | rgba(249,249,246,.72) | rgba(243,236,221,.72) | 栏/工具栏材质（配 backdrop-blur） |
| `--color-fill` | rgba(120,120,128,.16) | rgba(118,118,128,.12) | rgba(140,120,80,.10) | 按钮/控件底 |
| `--color-text` (label) | #F2F2F7 | #1C1C1E | #2A251C | 主文本 |
| `--color-text-2` (secondary) | rgba(235,235,245,.6) | rgba(60,60,67,.6) | rgba(60,50,35,.62) | 次要文本 |
| `--color-text-3` (tertiary) | rgba(235,235,245,.3) | rgba(60,60,67,.3) | rgba(60,50,35,.35) | 占位/禁用 |
| `--color-separator` | rgba(84,84,88,.6) | rgba(60,60,67,.29) | rgba(120,100,70,.28) | 分隔线 |
| `--color-accent` | #FF9F0A → 建议 #FF7A45 | 同左偏深 #C75B2E | #B4661F | 主操作/选中（保留暖橙品牌调，更明亮干净） |
| `--color-focus` | #0A84FF | #0A84FF | #0A74C4 | 键盘焦点环（Apple systemBlue） |

> 品牌决策点（需你拍板）：
> - **A. 保留暖橙**（贴近现在的书卷暖调）
> - **B. 改 Apple systemBlue `#0A84FF`**（最"苹果"、最通用）
> - **C. 双蓝橙**：accent=暖橙做品牌点，focus/选中=systemBlue。
> 推荐 **A**（阅读器里蓝色做选中会偏"链接感"，暖橙更书卷）。

### 3.2 字体（SF + PingFang + 语义字级）

字族优先系统 SF，中文回退苹方/思源：
```
--font-ui: -apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", system-ui, sans-serif;
--font-read: var(--reader-font-family);   /* 沿用现有可读字体切换，不破坏 */
```
语义字级（对齐 HIG，桌面 Web 尺度）：
| 级别 | size/line | 用于 |
|---|---|---|
| Title2 | 22/28, 700 | 抽屉标题 |
| Headline | 17/22, 600 | 设置分组标题、书名 |
| Body | 17/24, 400 | 常规 UI 文本、顶栏 |
| Callout | 14/20, 400 | 辅助说明 |
| Subhead | 13/18, 400 (500 标签) | 状态、进度 |
| Caption | 12/16, 400 | 计数、次级标签 |

### 3.3 间距栅格（4/8 体系）
```
--space-1: 4px; --space-2: 8px; --space-3: 12px;
--space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px;
```
所有 padding/gap 归一到此集合（顶栏内 16、工具栏 gap 8、卡片内 20、抽屉边 20 等）。

### 3.4 圆角（层级化，continuous 近似）
```
--radius-control: 10px;  /* 图标按钮、输入 */
--radius-card:    16px;  /* 纸卡（沿用现值，兼容分页几何）*/
--radius-sheet:   20px;  /* 抽屉、弹层、设置分组卡 */
--radius-pill:    999px; /* 分段控件、chip */
```

### 3.5 材质 & 阴影（深度三台阶）
```
--material-blur: saturate(180%) blur(20px);           /* 栏/工具栏 */
--shadow-card:  0 12px 40px rgba(0,0,0,.14);          /* 纸卡（现值，保留）*/
--shadow-float: 0 6px 24px rgba(0,0,0,.16);           /* 悬浮工具栏/弹层 */
--shadow-sheet: 0 -8px 40px rgba(0,0,0,.18);          /* 抽屉 */
```
深色下阴影加深、浅色下加淡（各主题定义一组）。

### 3.6 动效（Apple 缓动）
```
--ease-out: cubic-bezier(.22,1,.36,1);   /* 进入/展开，Apple “ease out”近似 */
--ease-in-out: cubic-bezier(.42,0,.58,1);
--dur-fast: 160ms; --dur-med: 240ms; --dur-slow: 320ms;
```
抽屉 `translateX + opacity`，弹层 `scale(.96→1)+fade`，按钮 active `scale(.96)`。
全部 `@media (prefers-reduced-motion: reduce)` 降级为即时。

---

## 四、组件级重设计

### 4.1 顶栏（topbar）
- 材质：`--color-bar` + backdrop-blur，底部 1px `--color-separator`（不再是硬边）。
- **统一图标化**：把"上一章/下一页"等文字按钮改为 **SF-Symbol 风格图标**（chevron.left/right、chapter 用文本首字母或 book 图标），与右侧工具栏风格一致；hover 显示 tooltip。
- 书名用 Headline 字级、居中；左"返回书架"用 chevron + "书架"或纯 icon。
- 高度维持 52px，内边距归一到 `--space-4`。

### 4.2 右侧悬浮工具栏
- 胶囊容器：`--color-bar` 材质 + `--radius-pill`/`--radius-sheet` + `--shadow-float`。
- 按钮 `--radius-control`，44px 目标（比现在更大），gap `--space-2`。
- hover: `--color-fill` 底色浮现 + icon 轻微放大；active: `scale(.94)`。
- 选中态（如目录已开）用 accent 高亮 + 左侧指示条。

### 4.3 抽屉 / 设置面板（重点：分组卡片化）
- 容器 `--color-elevated` + `--shadow-sheet` + `--radius-sheet`。
- 设置项改成 **iOS 分组列表（inset grouped）**：每组用圆角卡片包裹，行间 `--color-separator` 细线；组间留 `--space-6`。
- 每行：左标签（Body）+ 右控件；滑块配数值 badge；开关用 Apple 风格 toggle（44×26 pill，绿 #34C759 on）。
- 顶部 tab（目录/显示）改为 **分段控件（segmented control）**：pill 底 + 白色选中块滑动动画。

### 4.4 划线胶囊 & 高亮
- 胶囊 `--color-bar` 材质 pill + `--shadow-float`，出现用 `scale+fade`。
- 高亮色沿用四色，但调成 Apple 更纯净的色值（黄 #FFD60A / 绿 #30D15E / 蓝 #64D2FF / 粉 #FF6482，各带 .22 透明度底）。

### 4.5 Welcome / 书架空状态
- 极简：品牌标识 + 一句话引导（"把书放进书库目录即可阅读"）+ 主按钮（accent 实心 pill）。
- 大留白，居中；避免花哨。

### 4.6 图标系统（SF Symbols 对齐）
- 统一 stroke-width 1.8、round linecap/join、24 viewBox（现值已有，规范化为 token `--icon-size: 22px` 视觉）。
- 覆盖：back(chevron.left)、previous/next page(chevron)、previous/next chapter(book/book.fill 或 arrow)、toc(list.bullet)、highlight(pen/highlighter)、export(square.and.arrow.up)、search(magnifyingglass)、bookmark(bookmark)、note(note.text)、ai(sparkles)、settings(gearshape)、theme(sun.max/moon)。

---

## 五、无障碍与自适应（纳入规范）

- 文本对比 AA：label 对 bg ≥ 4.5:1，secondary ≥ 4.5:1，tertiary 仅用于大号/装饰。
- 点击目标 ≥ 44px；提供 `:focus-visible` accent 焦点环（现项目已有 focus 逻辑，统一用 `--color-focus`）。
- `prefers-color-scheme` 自动选主题；`prefers-contrast: more` 提高分隔线/文字对比；`prefers-reduced-motion` 关闭动画。
- 保留现有 `aria-*`/`role`（Drawer、tablist、aria-expanded），只改视觉不改语义，避免回归。

---

## 六、分期实施建议（低风险）

| 期 | 内容 | 风险 |
|---|---|---|
| **P1 Token 层** | 仅新增/改 CSS 变量值（颜色/间距/圆角/材质/动效 token），不动结构 | 极低，纯样式 |
| **P2 顶栏+工具栏** | 文字按钮→图标、材质统一、间距归一 | 低（DOM ID 不变，仅展示层）|
| **P3 抽屉分组卡片化** | 设置面板 iOS 分组、分段控件、toggle 样式 | 中（涉及 HTML 结构调整，需回归 E2E/DOM 选择器）|
| **P4 书架/欢迎页** | 空状态与书架卡片质感 | 低 |
| **P5 动效 & a11y 收尾** | 缓动、reduced-motion、focus、高对比 | 低 |

每期末跑 `npm test` + Playwright E2E，保证 legacy DOM ID 契约不破。

---

## 七、安全边界（硬约束，务必遵守）

1. **不动统一网关入口** `/app/babyreader-fnos` 与 `X-Trim-*` 鉴权。
2. **不改 legacy DOM ID**（`btnNextPage`、`readerDrawer`、`settingReadingMode` 等）——只改外观。
3. **不破坏纸卡分页几何** `--reader-paper-*` / `--reader-column-*` 变量体系（这是稳定性核心）。
4. **保留多用户隔离、进度、划线数据结构**。
5. 所有视觉改动可在 `docs/superpowers` 记录，验收靠真机。

---

## 八、需要用户拍板的 3 个关键决策

1. **主色调**：A 暖橙（推荐，书卷）/ B Apple systemBlue / C 双色调。
2. **顶栏文字按钮是否全部图标化**（更苹果、更简洁，但初次使用学习成本↑）？还是保留文字+图标混合？
3. **深色底**：纯黑 `#000`（OLED 质感）还是 Apple 深灰 `#1C1C1E`（层次更清晰，推荐阅读器）。

认可方案后我按 P1→P5 分期落地，每期独立可回滚、可验收。
