# PDF 笔记导出 P3.3 进度

日期：2026-09-26。当前工作区：含大量原有未提交文件的 `main`；本阶段没有提交、合并、打包、安装或修改 NAS 配置。对应计划：`../plans/2026-09-26-pdf-notes-export.md`。

## 完成范围

- Task 0：冻结当前 EPUB 导出与 PDF 标注 GET 契约，先写 PDF 格式化及交互失败测试。
- Task 1：新增独立的 PDF Markdown 格式化器；按页排序、跨页只导出一次、旧来源提示、文本/HTML 转义、字段和输出上限；不序列化 UID、路径、坐标或指纹。
- Task 2：复用工具栏导出入口和快捷键；每次 PDF 导出都重新调用当前书的标注 API。切书、撤权或请求失败不使用缓存；旧请求不阻塞新书；PDF 不自动复制到剪贴板，EPUB 分支维持原状。
- Task 3：本地 Node、结构及 Chromium 下载回归通过；NAS 真机尚未验收，故不宣称设备完成或发布可用。

## 验证记录

| 范围 | 命令与结果 |
| --- | --- |
| 初始基线 | `npm test`：433 项，426 通过、7 跳过、0 失败。 |
| RED | `node --test tests/pdf-notes-export.test.js`：模块缺失；PDF DOM 导出 3 项失败；后续 HTML 注入和切书竞态各有单独失败测试。 |
| GREEN | `npm run check`：通过，55 个必需文件；`npm test`：442 项，435 通过、7 跳过、0 失败。 |
| 真实浏览器 | `npx playwright test e2e/pdf-reader.spec.js e2e/highlights.spec.js --project=chromium`：62/62 通过；最终针对 PDF 和 EPUB 导出再次运行 2/2 通过。 |
| 服务端隔离 | `tests/pdf-content-api.test.js` 与全量 Node 测试通过，覆盖现有 PDF 标注 API 的授权、UID 隔离与来源变更语义；导出本身不新增服务端接口。 |

## 审查与遗留边界

- 独立只读审查指出：旧书悬挂请求可阻塞新书，以及 PDF 快捷键会抢占输入框；两项均以失败测试复现后修复。切书取消提示也已加入。
- 真实浏览器已验证测试 PDF 的下载文件内容与页码；**未在 NAS 上对用户书籍下载和打开 Markdown 验证**，也未收到不同 fnOS UID 的本次设备验收证据。后续设备验收应使用授权测试 PDF，核对跨页、旧来源、无笔记、下载文件及 EPUB 导出不变。
- 本轮只修改导出链路与相关测试/文档；工作区其他未提交内容保留原样。FPK 按用户后续请求单独打包；未提交代码。

## FPK 构建（用户单独请求，2026-09-26）

- 构建目录：`dist-fpk-20260926-pdf-notes-export/`；使用 Git Bash 执行 `BABYREADER_BUILD_ID=20260926-pdf-notes-export bash scripts/build-fpk.sh`，没有覆盖或删除旧包。
- 产物：`babyreader-fnos.fpk`，16,821,208 bytes，SHA-256 `ED7F54E5A2C03E676BF77E41962D7164FF1CBF80927D5BCBF5105FE5F55F5372`；manifest 版本 `1.1.7`。依赖审计报告 0 vulnerabilities，结构验证通过。
- 归档核对：`app.tgz` 含 `ui/reader/pdf-notes-export.js`、`actions.js`、`highlights.js`、`navigation.js` 与 `index.html`；新模块包内 SHA-256 与源码一致，未见 `.pdf`、`.sqlite`、`.env` 文件。
- `build-provenance.json` 的 `app_members` 是硬编码的精选成员清单，尚未列入新导出模块；这是溯源覆盖缺口，不代表模块未入包。当前包已通过直接归档核对，后续可单独完善该清单。未安装至 NAS，设备验收仍待完成。
