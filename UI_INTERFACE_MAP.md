# BabyReader UI Interface Map

## Reader Shell

- 顶部低干扰导航：`#topbar.reader-shell-nav`
- 阅读滚动与分页容器：`#reader`
- 纸张式正文区：`#article`
- 桌面右侧悬浮工具栏：`#readerFloatingToolbar`
- 唯一 Reader Drawer：`#readerDrawer`
- Drawer 遮罩：`#readerDrawerBackdrop`
- 移动端阅读工具栏：`#mobileReaderToolbar`
- 划线详情对话框：`#highlightEditor`

Reader Shell 保持正文为第一视觉层级。目录、显示设置及后续搜索、书签、笔记、AI 功能统一使用一个 Drawer Shell，任意时刻只允许一个 `data-reader-panel-name` 面板可见。

## 控件、动作与接口映射

| 控件 | DOM ID | action ID | panel ID | 处理函数 | API / 本地行为 | 键盘入口 | 移动端入口 | 状态 | 后续接口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 返回书架 | `btnBackToLibrary` | `backToLibrary` | 无 | `returnToLibrary` | 刷新前保存设置、阅读位置和划线，然后 `GET /library` | 无 | `btnMobileBackToLibrary` | 已实现 | 无 |
| 上一章 | `btnPreviousChapter` | `previousChapter` | 无 | `navigateChapter(-1)` | 本地 EPUB 章节导航和边界检查 | 无 | `btnMobilePreviousChapter` | 已实现 | 无 |
| 下一章 | `btnNextChapter` | `nextChapter` | 无 | `navigateChapter(1)` | 本地 EPUB 章节导航和边界检查 | 无 | `btnMobileNextChapter` | 已实现 | 无 |
| 上一页 | `btnPreviousPage` | `previousPage` | 无 | `navigatePageGroup(-1)` | 单页或双页分页组导航 | 无 | `btnMobilePreviousPage` | 已实现 | 无 |
| 下一页 | `btnNextPage` | `nextPage` | 无 | `navigatePageGroup(1)` | 单页或双页分页组导航 | 无 | `btnMobileNextPage` | 已实现 | 无 |
| 目录 | `btnToc` | `openToc` | `readerPanelToc` | `openReaderPanel('toc')` | 使用已解析的 EPUB2 NCX 或 EPUB3 Nav，不新增请求 | `Escape` 关闭 | `btnMobileToc` | EPUB 有目录时启用 | 无 |
| 划线 | `btnHighlight` | `highlight` | 无 | `triggerHighlightAction` | `PUT /books/:id/highlights`，保留颜色、备注和精确定位 | `Ctrl/Cmd+H` | `btnMobileHighlight` | 已实现 | 无 |
| 导出划线 | `btnExportHighlights` | `exportHighlights` | 无 | `exportHighlights` | 浏览器下载 Markdown，并尽力复制到剪贴板 | `Ctrl/Cmd+Shift+E` | 无 | 已实现 | 无 |
| 搜索 | `btnSearch` | `openSearch` | `readerPanelSearch` | `openReaderPanel('search')` | 禁用，不发请求 | 未分配 | 无 | `reserved` / disabled | 预留 `GET /api/v1/books/:id/search?q=` |
| 书签 | `btnBookmarks` | `openBookmarks` | `readerPanelBookmarks` | `openReaderPanel('bookmarks')` | 禁用，不发请求 | 未分配 | 无 | `reserved` / disabled | 预留书签读写接口 |
| 笔记 | `btnNotes` | `openNotes` | `readerPanelNotes` | `openReaderPanel('notes')` | 禁用，不发请求 | 未分配 | 无 | `reserved` / disabled | 预留笔记增删改查接口 |
| AI | `btnAi` | `openAi` | `readerPanelAi` | `openReaderPanel('ai')` | 禁用，不发请求 | 未分配 | 无 | `reserved` / disabled | 预留 `POST /api/v1/ai/chat` |
| 主题切换 | `btnTheme` | `toggleTheme` | 无 | `toggleTheme` | `PUT /settings`，保持当前用户隔离 | 无 | 显示设置内可选 | 已实现 | 无 |
| 显示设置 | `btnSettings` | `openSettings` | `readerPanelSettings` | `openReaderPanel('settings')` | `PUT /settings`，保存主题、字号、行高、页边距、划线颜色和阅读模式 | `Escape` 关闭 | `btnMobileSettings` | 已实现 | 无 |
| 关闭 Drawer | `btnCloseSettings` | `closePanel` | 当前面板 | `closeReaderPanel` | 无请求 | `Escape` | Drawer 顶部关闭按钮 | 已实现 | 无 |
| 遮罩关闭 | `readerDrawerBackdrop` | 无 | 当前面板 | `closeReaderPanel` | 无请求 | 无 | 点击遮罩 | 已实现 | 无 |

## readerActions

`readerActions` 是所有 Reader Shell 入口的统一分发层：

- `backToLibrary`
- `previousChapter`
- `nextChapter`
- `previousPage`
- `nextPage`
- `highlight`
- `exportHighlights`
- `toggleTheme`
- `openToc`
- `openSettings`
- `openSearch`
- `openBookmarks`
- `openNotes`
- `openAi`
- `closePanel`

桌面和新增移动端 Drawer 入口通过 `data-reader-action` 委托到该映射。既有移动端翻页、章节、划线和返回书架控件继续调用原有处理函数，避免调整稳定阅读逻辑。

## readerPanels

| panel 名称 | DOM ID | enabled 条件 | 状态 | 行为 |
| --- | --- | --- | --- | --- |
| `toc` | `readerPanelToc` | EPUB 且存在可用目录 | 已实现 | 在唯一 Drawer 中显示目录 |
| `settings` | `readerPanelSettings` | 始终可用 | 已实现 | 在唯一 Drawer 中显示阅读设置 |
| `search` | `readerPanelSearch` | `false` | reserved | 明确占位，不发送 API 请求 |
| `bookmarks` | `readerPanelBookmarks` | `false` | reserved | 明确占位，不发送 API 请求 |
| `notes` | `readerPanelNotes` | `false` | reserved | 明确占位，不发送 API 请求 |
| `ai` | `readerPanelAi` | `false` | reserved | 明确占位，不发送 API 请求 |

## Drawer 状态与焦点

- 同时只存在一个 `#readerDrawer`，同时只显示一个 Reader Panel。
- 面板切换直接替换 Drawer 内容，不关闭再打开。
- 点击 `#readerDrawerBackdrop` 或按 `Escape` 关闭。
- 打开后焦点进入当前面板。
- Drawer 内 `Tab` 和 `Shift+Tab` 在可聚焦控件间循环。
- 从设置切换到目录后，关闭仍将焦点恢复到最初打开 Drawer 的按钮，而不是恢复到已隐藏的 Tab。
- 所有带 `aria-controls="readerDrawer"` 的入口同步维护 `aria-expanded`。
- 桌面 Drawer 从右侧覆盖正文；平板和手机使用底部面板。

## 保留的核心 DOM ID

以下既有接口继续保留，供当前逻辑、自动化测试和宿主集成使用：

- `topbar`, `fileName`, `reader`, `article`, `epubShell`, `epubViewer`
- `btnRead`, `btnEdit`, `editorContainer`, `editor`, `preview`
- `btnBackToLibrary`, `btnPreviousChapter`, `btnNextChapter`
- `btnPreviousPage`, `btnNextPage`, `paginationStatus`, `readingProgress`
- `btnToc`, `toc`, `tocList`, `tocEmptyState`
- `btnHighlight`, `btnExportHighlights`, `highlightEditor`
- `btnTheme`, `btnSettings`, `btnCloseSettings`, `settingsPanel`
- `settingTheme`, `settingFontSize`, `settingFontSizeValue`
- `settingLineHeight`, `settingLineHeightValue`
- `settingPageMargin`, `settingPageMarginValue`
- `settingHighlightColor`, `settingReadingMode`, `settingTocOpen`, `settingsUser`
- `mobileReaderToolbar` 及全部 `btnMobile*` 控件

## 键盘入口

- `Ctrl/Cmd+O`：打开或返回书库视图。
- `Ctrl/Cmd+S`：保存当前可编辑文本。
- `Ctrl/Cmd++`、`Ctrl/Cmd+-`、`Ctrl/Cmd+0`：调整或复位字号。
- `Ctrl/Cmd+H`：对当前 EPUB 选区创建划线。
- `Ctrl/Cmd+Shift+E`：导出 EPUB 划线。
- `Ctrl/Cmd+E`：在非 EPUB 文本的阅读与编辑模式间切换。
- `Escape`：关闭当前 Reader Drawer 或划线编辑器。
- Drawer 打开时，`Tab` 和 `Shift+Tab` 保持焦点位于 Drawer 内。

## 移动端入口

`#mobileReaderToolbar` 保留并提供：

- 返回书架：`btnMobileBackToLibrary`
- 上一章：`btnMobilePreviousChapter`
- 上一页：`btnMobilePreviousPage`
- 目录：`btnMobileToc`
- 划线：`btnMobileHighlight`
- 显示设置：`btnMobileSettings`
- 下一页：`btnMobileNextPage`
- 下一章：`btnMobileNextChapter`

移动工具栏使用四列两行布局，避免在 fnOS 800×600、小平板和手机宽度中产生横向溢出。正文底部预留相应安全区，避免控件遮挡内容。

## 服务端接口兼容

本轮稳定化不改变 API 路径、请求结构、扫描、安全、阅读位置、高亮或用户隔离逻辑：

- `GET /session`
- `GET /library`
- `POST /library/scan`
- `GET /state`
- `PUT /settings`
- `GET /books/:id/content`
- `PUT /books/:id/progress`
- `PUT /books/:id/highlights`

所有请求继续通过 `/app/babyreader-fnos/api` 前缀。fnOS 用户身份和 `X-Trim-Userid` 隔离继续由现有服务端安全逻辑处理。reserved 功能不会调用预留但尚不存在的接口。

## 响应式约定

- 桌面宽屏：纸张式正文居中，右侧纵向悬浮工具栏，Drawer 从右侧覆盖。
- fnOS 1200×800：保留纸张、分页状态和必要导航，隐藏空间不足的章节按钮。
- fnOS 800×600：正文优先，工具栏转为移动布局，Drawer 使用底部面板。
- 平板：固定单栏阅读，Drawer 覆盖正文，不压缩阅读宽度。
- 手机：纸张边框和阴影取消，正文使用全宽阅读面，底部两行工具栏保留关键入口。
- 双页模式仅在阅读区宽度至少 `900px` 时生效，窄窗口自动降级为单页。
- 单页和双页使用分页组导航；连续滚动保持垂直滚动行为。
- `prefers-reduced-motion: reduce` 时关闭滚动动画、过渡和动画效果。

## DOM 回归覆盖

`tests/dom-regression.test.js` 覆盖：

- 核心 DOM ID 保留。
- 单一 Reader Drawer。
- `readerActions` 与 `readerPanels` 映射。
- 目录与显示设置在同一 Drawer 内切换。
- 任意时刻仅一个面板可见。
- `Escape` 关闭及焦点恢复。
- reserved 功能禁用且不发送请求。
- 响应式媒体查询和 Reader Shell 类存在。
- 双页在窄窗口降级为单页。
- 单页、双页分页组和边界控制。
- 返回书架前保存阅读状态。
- 章节导航、划线颜色和备注逻辑不回归。
