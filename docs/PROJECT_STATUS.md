# BabyReader fnOS 项目知识总览

> 整合日期：2026-09-30。这份文档是入口：先读它，需要细节时再按文末索引去看具体计划或进度记录。
> 2026-09-30 已完成一次合并整理：9/23 之后所有没有提交的工作都已提交到 `main`，`codex/ai-index-compact-lifecycle` 分支也已合入。历史打包目录和临时 worktree 另行清理。

## 1. 版本与代码基线

| 项 | 值 |
| --- | --- |
| 唯一主线 | `main`（其他本地分支已被合入或被取代，见 §8） |
| manifest 版本 | 1.3.0（tag `v1.3.0`；上一版 `v1.2.0`） |
| 运行时 | fnOS 依赖应用 `nodejs_v22`（NAS 上的路径为 `/var/apps/nodejs_v22/target/bin/node`，SSH 的 PATH 里没有它） |
| 上游基线 | 见 `UPSTREAM_BASELINES`（BabyReader `bf4a727`，fnnas-docs `a8a7050`） |
| 运行依赖 | `fflate`、`sanitize-html`、`pdfjs-dist@6.3.289`（服务端解析文本）、`@lingo-reader/shared@0.4.6`；浏览器端 PDF.js 放在 `app/ui/vendor/pdfjs`；MOBI 解析器为 vendor 的 lingo-reader 0.4.6 修补版，放在 `app/server/vendor/lingo-mobi/`（修补说明见其中的 `PATCHES.md`） |

## 2. 架构

```
fnOS 统一网关 /app/babyreader-fnos ──(Unix socket ${TRIM_APPDEST}/app.sock)──> app/server/index.js
                                                   │
  ┌─────────────── 服务端 app/server ──────────────┴──────────────────────────────┐
  │ 书库     library.js · library-roots.js · fnos-roots-config.js · library-organization.js │
  │ 安全     security.js（CSP/HTML 清理）· zip.js（穿越/炸弹限制）· byte-range.js（Range GET）  │
  │ 用户数据 storage.js（按 X-Trim-Userid 隔离：进度/划线/书签/分类）                       │
  │ 搜索     book-search.js · ai-fts.js（每本书一个 SQLite FTS5 索引）                       │
  │ AI       ai-service / ai-retrieval / ai-chapter-retrieval / ai-epub-structure /          │
  │          ai-summary-cache / ai-conversation-storage / ai-index-manager / ai-config       │
  │ PDF      pdf-text(+worker/limits) · pdf-annotation-contract · pdf-feature-config ·       │
  │          pdf-ai-{context,profile,profile-store,retrieval,structure}                      │
  └──────────────────────────────────────────────────────────────────────────────────────┘
  前端 app/ui（原生 ES 模块，无构建步骤）
    core/    api · state · user-state · reader-route · utils
    library/ view · organization · reorder（拖拽） · pdf-covers
    reader/  epub · pdf(+render-scheduler, annotations, annotation-geometry, notes-export) ·
             pagination · navigation · progress · highlights · annotations · bookmarks ·
             notes-panel · search · selection-menu · settings · ai · ai-index-manager ·
             device-profile · document · editor · lifecycle · actions
    shell/   drawer
fnOS 包: manifest · cmd/*（生命周期脚本）· config/{privilege,resource} · wizard/config（安装/配置向导）
```

持久化数据：

- `${TRIM_PKGETC}/settings.json`：书库根目录。
- `${TRIM_PKGVAR}/index/library.json`：书库索引。
- `covers/`：封面。
- `ai-index/*.sqlite`：FTS 索引，文件权限必须是 600，目录 700。
- `ai-index/manifest.json`：索引清单。
- `users/<uid>/`：每个用户的数据，包括 `reading-state.json`、`library-organization.json` 和 AI 会话等。

## 3. 功能矩阵

| 领域 | 已实现（本地验证） | 状态 |
| --- | --- | --- |
| EPUB/MD/TXT 阅读 | 连续滚动和双页分页两种模式；微信读书风格的版式几何；排版设置（首行缩进、字体、段距、护眼背景）；章节窗口按需加载；资源生命周期 | 本地完成 |
| PDF 阅读 | PDF.js 渲染；连续/单页/双页三种布局；缩放和适应宽度；渲染调度；文本层选区；页级进度和书签；目录；全文 FTS 搜索并精确定位到页 | 本地完成。**默认关闭**，在 wizard 里开启 `wizard_pdf_reader_enabled` |
| 标注与笔记 | EPUB/PDF 都支持划线、想法、颜色、笔记侧栏、按页/按章节排序；可导出笔记 | 本地完成，删除后撤销尚未设计 |
| 全书搜索 | 本地 FTS、续页、跨章节命中；搜索面板不关闭，可前后跳转命中 | 同一页重复短语的精确定位仍会退化成只定位到章节 |
| AI 问书 | 多轮流式对话；章节和全书检索；摘要缓存；会话持久化；PDF 结构化理解与来源页码；索引管理器（紧凑界面、孤儿索引清理） | 没有做真实供应商和 NAS 验收 |
| 书库 | 分类、整理模式批量归类、书卡直接拖拽和长按排序（有 revision 冲突回滚）、筛选、继续阅读卡片、首页 Apple HIG 改版 | 本地完成；触屏真机和视觉对照待做 |
| MOBI/AZW3 阅读 | 服务端把 MOBI6/KF8 转成确定性的派生 EPUB（`mobi-format`/`mobi-convert`/`mobi-derived`，在 worker 中执行，有缓存），然后复用 EPUB 的全部能力：阅读、目录、划线、进度、搜索、AI；DRM 只检测、提示，不解密 | 本地完成（AZW3 已用真实书验证）。**默认关闭**，由 wizard 的 `wizard_mobi_reader_enabled` 开启，开启后需要重新扫描 |
| 书籍导入 | 管理员可以通过按钮或拖放导入，文件写入 `babyreader-fnos/library/导入` 共享目录；按内容校验格式，按 SHA-256 去重，不覆盖已有文件；导入与扫描共用库锁；有进度队列；在分类页导入会自动归类 | 本地完成。**默认关闭**，由 wizard 的 `wizard_import_enabled` 开启；网关的请求体上限还没测 |
| fnOS 集成 | 统一网关 Header 身份；授权目录 `TRIM_DATA_ACCESSIBLE_PATHS`/`TRIM_DATA_SHARE_PATHS`（realpath 校验、去重、父子目录裁剪）；包专用用户（非 root） | 本地完成，需真机验收 |

## 4. 配置开关（环境变量 / 向导）

| 变量 | 作用 |
| --- | --- |
| `BABYREADER_PDF_ENABLED` / wizard `wizard_pdf_reader_enabled` | PDF 阅读与搜索，默认关闭（`pdf-feature-config.js`） |
| `BABYREADER_MOBI_ENABLED` / wizard `wizard_mobi_reader_enabled` | MOBI/AZW3 阅读，默认关闭（`mobi-feature-config.js`）；开启后需要在书库重新扫描 |
| `BABYREADER_IMPORT_ENABLED` / wizard `wizard_import_enabled` | 管理员从浏览器导入书籍，默认关闭（`import-feature-config.js`） |
| `BABYREADER_KF8_SAMPLE` | 可选：指向本地 AZW3 样本的绝对路径，用于真实书的转换回归测试（样本不进仓库） |
| `BABYREADER_ENABLE_LIBRARY_ORGANIZATION=0` | 回退到扁平书库 |
| `BABYREADER_ENABLE_AI_CHAPTER_UNDERSTANDING` | AI 章节/全书概述（灰度） |
| `BABYREADER_ENABLE_PDF_AI_STRUCTURE` | PDF AI 结构化理解 |
| `BABYREADER_DEV_PORT` / `_DEV_UID` / `_DEV_USERNAME` | 本地开发。只在缺少网关 Header 时生效 |
| `BABYREADER_GATEWAY_URL` / `_GATEWAY_COOKIE` | `scripts/fnos-device-acceptance.sh` 走网关验收时使用 |

## 5. 开发、测试与打包

```bash
npm ci
npm test                 # node:test，约 540 项（Windows 下约 9 项按平台跳过）
npm run check            # 结构检查（Windows 自动使用 portable 模式）
npm run test:e2e         # Playwright Chromium + 书库组织专项
npm run build:fpk        # 需要 fnpack（本机在 C:/Users/admin/bin/fnpack）和 bash；产物写到 dist-v<版本>/
```

- 本地开发服务：`NODE_ENV=development BABYREADER_DEV_PORT=8099 BABYREADER_DEV_UID=development node app/server/index.js`，访问 `http://127.0.0.1:8099/app/babyreader-fnos/`。
- E2E 使用 `.runtime/` 下的隔离合成书库，不会碰真实书库。
- 每次打包都会生成 `dist-v<版本>/build-provenance.json`，记录 commit、dirty 状态和包内文件哈希。**一个版本号只对应一个输出目录**，重复构建同一版本会被脚本拒绝。

## 6. 经验与陷阱（从各阶段记录中汇总）

- **身份**：生产环境只信任网关传来的 `X-Trim-Userid`、`X-Trim-Username`、`X-Trim-Isadmin`，不接受客户端自己提交的用户 ID。
- **SQLite 权限**：曾在 NAS 上发现索引文件权限是 700，按契约必须是 600。以后每次索引写入或服务重启之后，都要复查一次。
- **PDF.js**：
  - 清理时必须用 `await loadingTask.destroy()`，不能用 `doc.destroy()`。
  - 测试夹具里的 PDF 必须声明字体（`/F1 12 Tf`），否则抽不出文本。
  - Node 端只做文本解析；canvas 相关的警告可以忽略。
- **PDF 全书 AI**：不要等 renderer 返回页数才发送请求；只有页内选区需要页面几何。
- **E2E**：不同测试共享服务端阅读进度，可能让"无变化导航"不触发保存请求。夹具需要做确定性复位。
- **拖拽**：鼠标拖动阈值 6px。触屏在长按之前保持 `pan-y` 滚动，激活拖动后才取消原生滚动。pointerup 时要重新计算落点。
- **Windows**：符号链接相关测试和 POSIX 的 `sh -n` 检查在 Windows 上会跳过，需要在 Linux CI 或 fnOS 上补跑。
- **视觉 QA**：Codex 浏览器曾拒绝访问 127.0.0.1，书库首页的视觉对照一直没做（见 `library-home-design-qa.md`）。

- **MOBI**：
  - 上游 lingo-reader 不检查 DRM、截断、文件类型；封面偏移为 0 时拿不到封面；它的 `Kf8.replace` 遇到真实书就会崩溃；MOBI6 分章时内存会放大。所以只借用它的解压和 KF8 重组，其余步骤都由我们自己在字节层面完成。
  - **章节 href `text/part-NNNN.xhtml` 已冻结**，因为划线靠 `chapterHref` 定位。MOBI6 和 KF8 的转换路径由格式决定，不做互相回退。修改分章规则必须同时提升 `MOBI_CONVERTER_VERSION` 并提供迁移。
- **导入**：
  - 按字节完全一致去重，重新打包过的"同一本书"不算重复。
  - 同名文件依次追加 `(2)` 等后缀，不覆盖已有文件。
  - 只写入应用共享目录，从不写入用户授权的目录。
- **回归**：`pdf-ai-profile` 测试偶尔会卡死；全量回归请使用 `npm test -- --test-timeout=180000`，并且不要让两轮回归同时运行，它们会争抢 CPU 和 8099 端口。

## 7. 待办（按优先级）

1. **fnOS 真机验收**（x86_64/ARM64）：
   - 安装、升级、卸载，以及升级前后数据是否保留；
   - 网关 Header 和授权目录；
   - ACL；
   - 多用户隔离；
   - PDF 的 Range 透传和资源预算；
   - SQLite 权限。

   完整清单见 `FNOS_DEVICE_ACCEPTANCE.md`。
2. 同一页重复短语在搜索时的精确定位歧义。
3. 视觉矩阵：浅色、深色、米黄三种主题；1/20/100 本书；窄屏；触屏长按。
4. 删除撤销的设计：旧 ID、来源指纹、revision 冲突处理。
5. **v1.3.0 的 NAS 验收**（MOBI/AZW3 与导入）：按 `FNOS_DEVICE_ACCEPTANCE.md` §5.7 执行，先跑 `import-probe`；如果网关的请求体上限太小，需要补上分片上传，再发补丁版本。验收通过后，再发一个补丁版本把两个开关改为默认开启。计划与记录见 `docs/superpowers/plans/2026-09-30-mobi-and-book-import.md` 和对应的 progress 文件。
6. 技术债：拖拽预览每次都重新插入全部书卡（O(n)）；AI 输入框几何差 8.8px；`pdf-ai-profile` 测试偶发失败。

## 8. 分支与 worktree 处理记录（2026-09-30）

| 分支/目录 | 结论 |
| --- | --- |
| `main` 工作区的未提交改动（约 380 个文件） | 分 4 个提交写入 `main` |
| `codex/ai-index-compact-lifecycle` | 已合入 `main`：遗留索引时间回退、健康扫描后清理 manifest 孤儿条目、紧凑索引管理界面 |
| `codex/fnos-authorized-library-roots`、`work/engineering-baseline` | 与 `main` 相同，没有独有提交 |
| `ai-chapter-retrieval-task1` | 基于旧的 `3d8efa2`。其中书签和 AI 章节检索已经在主线重新实现并超越；`plan/` 目录的文档与 `docs/superpowers/plans` 内容重复。**不合入** |
| worktree `latest-fpk-20260923`、`fpk-authorized-roots-20260923` | 9/23 的打包快照，没有比主线新的文件 |

## 9. 文档索引

- 设计 → 计划 → 执行记录：`docs/superpowers/specs/`、`plans/`、`progress/`（文件名以日期开头）。
- 逐次变更日志：`CHANGELOG_WORK.md`。
- 界面结构：`UI_INTERFACE_MAP.md`。
- 书库首页的设计契约和 QA 记录：`docs/library-home-design-contract.md`、`docs/library-home-design-qa.md`。
- 真机验收：`docs/FNOS_DEVICE_ACCEPTANCE.md`、`scripts/fnos-device-acceptance.sh`。
- 早期交接文档：`docs/superpowers/plans/2026-09-18-babyreader-fnos-handover.md`。
