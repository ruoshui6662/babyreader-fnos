# lingo-mobi vendored patches

来源：`@lingo-reader/mobi-parser@0.4.6` 的 `dist/index.node.mjs`（MIT，见 `LICENSE`）。
上游文件 SHA-256：`37ceb6f781bb0b83024c86c0baa782d154dd3e8c5c72234fcb44dfe2f5d3682a`。
运行时依赖：`@lingo-reader/shared@0.4.6`、`fflate`，均以精确版本写在 `package.json` 中。

之所以 vendor，而不是在安装时打补丁：FPK 构建使用 `npm ci --ignore-scripts`，安装脚本不会执行，补丁在包里不会生效。评估过程见 `docs/superpowers/progress/2026-09-30-mobi-and-book-import-progress.md`。

| # | 位置 | 改动 | 原因 |
| --- | --- | --- | --- |
| P1 | 文件末尾的 `export` | 额外导出 `MobiFile`、`Kf8` | 转换器直接调用底层解压和资源读取，以便自己按字节偏移改写 `filepos`、做资源边界检查 |
| P2 | `MobiFile.getCoverImage` | `if (offset)` 改为 `if (offset !== void 0)` | EXTH 201 = 0（封面是第一张图）是最常见的情况，原判断会把它当成"没有封面" |
| P3 | `Mobi.innerInit` | 逐字节的 `Array.from(...).join` 和 `Uint8Array.from(str, charCodeAt)` 改为 `Buffer` 的 latin1 转换 | 32 MiB 正文时峰值 RSS 从 1313 降到 251 MiB，耗时从 5.7 s 降到 0.4 s |
| P4 | `Mobi.replace` | `<img>` 没有 `recindex` 属性时原样保留，不再抛出 TypeError | 原实现遇到这种标签时整本书打不开 |

本项目自己的 `mobi-format.js` 负责 DRM、截断、非 MOBI 文件、压缩方式和编码的校验，这些检查都在调用本库之前完成，因为本库不做这些检查。

升级上游版本时的流程：重新比对上游文件的 SHA-256；逐条确认上游是否已修复 P2–P4；重新执行 `tests/mobi-*.test.js` 和转换快照测试。
