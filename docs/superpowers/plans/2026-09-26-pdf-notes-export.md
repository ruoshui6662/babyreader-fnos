# PDF 笔记导出实施计划（P3.3）

> 状态：Task 0–2 已在当前工作区实现；Task 3 的本地自动化已通过，NAS 真机下载尚未验收。执行证据见 `../progress/2026-09-26-pdf-notes-export-progress.md`；不得把本文视为发布许可。

**Goal:** 将当前 PDF 的标记与想法导出为可读、可核对的 UTF-8 Markdown；沿用现有导出入口，同时保持 EPUB 导出字节内容和交互不变。

**Architecture:** 服务端现有 `GET /api/books/:id/pdf-annotations` 是导出的唯一数据源。浏览器在点击导出时重新获取当前书、当前 UID 的记录；独立的纯格式化器只接受白名单字段，按页组织 Markdown；原有 EPUB `formatHighlightsMd()` 不改。参考契约：`2026-09-25-pdf-reader-quality-roadmap.md` 的 P3.3。

**Tech Stack:** 现有 Node.js 测试、浏览器原生 Blob 下载、Playwright；不新增导出依赖或服务端下载接口。

## 全局安全边界与完成定义

- 只导出当前授权 PDF 的现有笔记，不导出 PDF 原文整页、二进制、坐标、UID、NAS 路径、指纹或配置密钥；不上传文件。
- 导出范围恒为当前书全部记录；列表筛选和缓存不影响导出。切书、退出、撤权或请求失败时终止，不回退到旧缓存。
- 页码来自每条记录的 `targets[].pageIndex + 1`；跨页记录只出现一次，标明起止页；来源失效记录可导出已保存文字，但明确标记“原文件已变化，定位不可用”。
- 字段长度与总记录/输出字节均有上限；超限给出明确提示，不静默截断、不生成半份文件。空记录不下载。书名、引文、想法中的 Markdown 控制字符和换行要作为正文处理，不能伪装标题或链接。
- 保持 EPUB 导出格式、文件名、快捷键及现有标注存储不变。本文不授权提交、合并、打包、NAS 配置修改或清理现有工作区文件。
- 完成需同时有纯函数测试、API 身份隔离回归、真实浏览器下载验收和 EPUB 导出回归；只通过 mock 不算设备验收。

## 文件与接口边界

- 新增 `app/ui/reader/pdf-notes-export.js`：纯 `formatPdfNotesMarkdown({ title, annotations })`，返回完整 Markdown 或可识别的空/超限错误；仅依赖白名单投影，不序列化原记录。
- 修改 `app/ui/reader/actions.js`：在 `exportHighlights()` 按 `state.contentType` 分流；PDF 异步读取并核对捕获的 `bookId`，EPUB 原分支原样保留。
- 修改 `app/ui/reader/highlights.js`、`app/ui/reader/navigation.js`、`app/ui/index.html`：PDF 显示同一导出入口，快捷键行为与模式一致，脚本加载顺序正确。必要时修改 `scripts/validate-structure.js` 的静态资源清单。
- 新增 `tests/pdf-notes-export.test.js`，扩展 `tests/dom-regression.test.js`、`tests/pdf-content-api.test.js`、`e2e/pdf-reader.spec.js`；不新增持久化格式或 API。

## Task 0：冻结样例与基线

1. 记录当前 EPUB 导出样例、按钮可见性、快捷键和 API 失败提示；确认当前 `git status --short`，不得覆盖工作区既有修改。
2. 写一个固定 PDF 样例：同页两条、跨页一条、来源失效一条、含 `#`、`[]()` 与换行的引文；明确输出顺序（页码升序，页内稳定按创建时间/ID）、标题、起止页及旧来源提示。
3. 在 `tests/pdf-notes-export.test.js` 写样例快照/逐字段断言，先运行并确认失败：`node --test tests/pdf-notes-export.test.js`。记录失败原因只因功能缺失。

## Task 1：实现可审计的纯格式化器

1. 仅投影 `text`、`thought`、`kind`、`style`、`color`、`sourceStale` 和页索引；拒绝畸形页、非当前格式、重复 ID 及超限输入。现有 API 上限是保护，不等同于导出输出预算；单独设定并测试导出最大字节数。
2. 按 Task 0 样例生成 Markdown；跨页记录挂在起始页小节并标明页区间；旧来源追加提示。对正文特殊字符做 Markdown 转义/安全呈现，换行保持可读。
3. 补齐空记录、恶意书名、超长 CJK、跨页/乱序、失效记录及不包含私密字段的测试；`node --test tests/pdf-notes-export.test.js` 必须通过。

## Task 2：连接导出交互，不改变 EPUB

1. PDF 点击或快捷键触发时捕获 `bookId`/阅读代次，调用 `window.browserHost.getPdfAnnotations(bookId)` 获取新数据；返回后再次比对当前书与模式。API 401/403、网络异常、切书均停止下载并提示，不读取 `pdfAnnotationCache` 兜底。
2. 与 EPUB 复用同一下载按钮和文件名安全策略，但 PDF 文件名去 `.pdf` 后缀；使用 UTF-8 `text/markdown` Blob、触发一次下载并及时释放对象 URL。不要默默把全文复制到剪贴板，除非再次确认 EPUB 兼容性要求。
3. 调整按钮可见性、无笔记/加载中状态、重复点击防护及 PDF 快捷键；不能抢占文本输入框或 EPUB 编辑快捷键。先扩展 DOM/浏览器失败测试，再实现到通过。

## Task 3：回归与设备门禁

1. 执行 `node --test tests/pdf-notes-export.test.js tests/dom-regression.test.js tests/pdf-content-api.test.js`、`npx playwright test e2e/pdf-reader.spec.js e2e/highlights.spec.js --project=chromium`、`npm run check`；若现有工作区导致无关失败，记录确切失败，不能宣称全部通过。
2. 浏览器验证当前 UID 下载、切书期间请求完成、被撤权、空书、跨页与旧来源；打开 Markdown 核对页码、引文和想法。再以另一 UID 验证 API 既有隔离（不必也不应在客户端伪造身份）。
3. NAS 验收使用用户授权的测试 PDF，核对下载文件而不改原 PDF；在进度文档记录测试版本与尚未验收项。只有用户另行要求才提交、打包或发布。

**Review focus:** EPUB 回归、异步跨书泄漏、Markdown 注入/超限、失效来源提示、下载资源释放。
