# MOBI/AZW3 阅读与书籍导入执行记录

计划：[2026-09-30-mobi-and-book-import.md](../plans/2026-09-30-mobi-and-book-import.md)。分支：`feat/mobi-import`（基于 `main` 的 `db3b4e5`）。

## Task 0：基线、选型验证与设备探测

状态：**本地部分已完成；NAS 探测和 KF8 样本待定**（2026-09-30）。

### 测试基线（v1.2.0，commit `5b95fa0`，Windows / Node v24.20.0）

| 套件 | 结果 |
| --- | --- |
| `npm test` | 542 项：533 通过、0 失败、9 跳过（Windows 符号链接权限与 POSIX 专属检查） |
| Chromium E2E | 131 通过、9 失败、26 跳过。既有失败：`highlights.spec.js` 2 项；`pdf-reader.spec.js` 4 项（封面 2 项仅在全量运行时失败，单独运行通过）；`reader.spec.js` AI 面板 3 项 |
| 书库组织专项 | 23/23 |

判定规则：后续每个 Task **不得新增失败**；修好既有失败要记录下来，但不作为本计划的验收条件。

加入 Task 0 的夹具自检后：`npm test` 546 项，537 通过、0 失败、9 跳过。

### 夹具

- `tests/fixtures/mobi-fixtures.js`：按真实磁盘结构生成 MOBI6，包括 PDB 头、PalmDOC record 0、MOBI 头（232 字节）、EXTH（100/503/524/201）、全名、PalmDOC 压缩文本记录（3 字节哈希链 LZ77）、图片记录和 EOF 记录。另外提供以下变体：
  - DRM（加密类型为 2）；
  - 截断文件；
  - 非 BOOKMOBI 的 PDB；
  - 可调大小的大样本。
- `tests/mobi-fixtures.test.js`：用**独立实现的参考 PalmDOC 解码器**，校验以下内容，确保生成器本身是正确的，再拿它去评估第三方解析器：
  - 压缩往返一致；
  - 头部字段正确；
  - `filepos` 指向目标章节的 `<h1>`；
  - 各变体只在预期的位置与正常样本不同。
- 不包含任何真实书籍。

### `@lingo-reader/mobi-parser@0.4.6` 选型验证

**许可与依赖**：
- 本包 MIT，`@lingo-reader/shared` MIT；
- 间接依赖：`events` MIT、`path-browserify` MIT、`sax@1.6.1` BlueOak-1.0.0（宽松许可）；
- `fflate` 与项目已有依赖共用；
- `npm audit` 0 个漏洞；
- 源码中没有 `eval`、`new Function`，也没有网络访问。

**正确性**（生成的 MOBI6 样本，PalmDOC 与不压缩两种）：
- 元数据正确（标题、语言；作者以数组返回）；
- 按 `<mbp:pagebreak>` 分章正确（目录页算作 1 章，共 4 章）；
- 能从 guide 中的 toc 解析出目录，得到 `filepos:N`；
- 中文没有乱码；
- 图片被写入指定目录。

**发现的缺陷**（必须处理后才能使用）：

| # | 问题 | 证据 | 处理 |
| --- | --- | --- | --- |
| 1 | 包的 `main` 指向发布包中不存在的 `src/index.node.js`；`exports.require` 指向的 `.js` 文件是 CommonJS 语法，但包声明了 `"type":"module"`，所以在 CommonJS 里 `require` 会直接失败 | 两次加载报错（MODULE_NOT_FOUND、ERR_REQUIRE_ESM 类错误） | 只能加载 ESM 构建（`dist/index.node.mjs`） |
| 2 | **不检查 DRM**：加密字段读出来了，但没有任何判断 | DRM 样本照常"解析" | 由我们自己的 `mobi-format.js` 在调用前拒绝 |
| 3 | **截断文件静默返回残缺内容**（4 章变 1 章，不报错） | truncated 样本 | 调用前校验记录表偏移、记录数和文件长度 |
| 4 | 不校验 PDB 的 type/creator，非 MOBI 文件也会被接受 | `TEXtREAd` 样本 | 调用前校验 `BOOKMOBI` |
| 5 | `<img>` 缺少 `recindex` 属性时抛出 TypeError，整本书打不开 | `img-without-recindex` 样本 | 修补：跳过没有 recindex 的 img |
| 6 | 资源索引不做边界检查，越界时会把 EOF 记录当图片（`1.bin`）读出 | no-images 样本 | 修补：索引必须落在图片记录区间内 |
| 7 | 封面判断写成 `if (offset)`，**EXTH 201 = 0（第一张图，也是最常见的情况）时拿不到封面** | 样本封面为空；源码第 787–790 行 | 扫描阶段由 `mobi-format.js` 自己提取封面 |
| 8 | **MOBI6 分章时用 `Array.from(bytes, fromCharCode).join()` 逐字节展开整本书**，内存和耗时严重放大 | 见下表 | 修补为 `Buffer` 的 latin1 转换 |
| 9 | 公开 API 只返回解码后的章节字符串，拿不到原始字节偏移，没法把 `filepos` 精确改写为锚点 | API 审查 | 修补时额外暴露各章的原始 `start/end` 和字节内容 |

**性能**（本机 Node 24，每个样本在独立子进程中测量，采样峰值 RSS；"正文"指解压后的 UTF-8 字节数）：

| 正文 | 原版：耗时 / 峰值 RSS | 只修补缺陷 8 后：耗时 / 峰值 RSS |
| --- | --- | --- |
| 1 MiB | 202 ms / 164 MiB | — |
| 4 MiB | 715 ms / 251 MiB | 74 ms / 81 MiB |
| 8 MiB | 1,427 ms / 529 MiB | 120 ms / 97 MiB |
| 32 MiB | 5,729 ms / 1,313 MiB | 391 ms / 251 MiB |

参考：一部 50 万字的中文小说，正文约 1.5 MiB。

### Task 0 结论与决定

1. **采用 lingo-reader 的解压与解析核心，但 vendor 一份修补版**，放在 `app/server/vendor/lingo-mobi/`：
   - 基于 0.4.6，保留 MIT 许可证；
   - 修补上面的缺陷 5、6、8、9，另外附一份逐条说明的 `PATCHES.md`；
   - 以 ESM 形式只在转换 worker 内加载；
   - 缺陷 2、3、4、7 由自研的 `mobi-format.js` 在调用 lingo-reader 之前就挡住。

   **不采用安装时打补丁的方式**（例如 patch-package）：`scripts/build-fpk.sh` 用的是 `npm ci --ignore-scripts`，安装脚本不会执行，补丁在 FPK 里不会生效。

   这仍属于计划里的"先用 lingo-reader"，不属于"否决后自研"。npm 依赖改为只保留 `@lingo-reader/shared@0.4.6`（精确版本，供 vendor 的代码 import），把 `@lingo-reader/mobi-parser` 从 `dependencies` 中移除，这一步在 Task 2 引入 vendor 时完成。
2. 以后如果上游修复了缺陷 1、5、6、7、8，可以考虑去掉 vendor，改回直接使用 npm 包。给上游提 issue/PR 需要用户同意后另行处理。
3. **资源上限暂定**：MOBI 源文件 64 MiB、正文 48 MiB、worker 堆 256 MiB。本机数据显示，修补后 32 MiB 正文的峰值约 251 MiB RSS（RSS 包含堆外内存），所以 48 MiB 正文可能超过 256 MiB 堆上限。暂定策略：正文超过 32 MiB 就拒绝，并提示"文件过大"。在 NAS（Node 22.18，x86_64/ARM64）上实测后再冻结最终数值，最迟在 Task 6 完成。

### 待办（需要 NAS 或用户）

- [ ] **NAS 导入前置条件探测**：`scripts/fnos-device-acceptance.sh import-probe`（本次新增，已在本地开发服务器上验证过）。它会：
  - 以包用户身份在共享目录创建并删除一个探测文件；
  - 依次发送 1/16/64/256 MiB 的无效 JSON 请求到一个"先读请求体、解析失败就拒绝"的接口，根据响应是应用的 JSON 还是网关的非 JSON 页面，判断网关允许的最大请求体。

  这个过程不修改任何用户数据。
- [ ] **KF8（AZW3）样本**：生成 KF8 结构（skeleton/fragment/INDX）工作量较大。建议从 Project Gutenberg 下载一本公有领域的 KF8 电子书，只在本地验证用，不提交进仓库。需要用户同意下载。
- [ ] 在 NAS 的 Node 22 上跑一遍修补后的解析性能（需要先有转换 worker，放在 Task 2/6 中完成）。
