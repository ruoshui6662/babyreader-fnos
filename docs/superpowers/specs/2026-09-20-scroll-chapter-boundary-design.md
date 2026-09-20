# 连续滚动章节边界阅读设计

## 背景

当前连续滚动模式采用“首批章节立即挂载，剩余章节在后台继续追加”的整书 DOM 策略。它解决了首屏等待整本书的问题，但随着章节继续追加，DOM、资源内联、图片解码、布局和高亮重绘仍会随书籍长度增长。用户希望连续滚动模式改为微信读书式的章节边界：一次只阅读一个章节，章节结束后在底部出现“下一章”，已有章节返回时在阅读区左上方提供“上一章”。

## 目标

- 连续滚动模式打开 EPUB 时，只加载并挂载当前章节，首章完成后即可阅读、选择和划线。
- 当前章节结束后，阅读区底部显示居中的“下一章”按钮；最后一章不显示该按钮。
- 当前章节不是第一章时，阅读区顶部左侧显示“上一章”按钮；第一章不显示该按钮。
- 点击章节按钮、目录项或 EPUB 内部链接时，只加载目标章节，不把整书章节追加到 DOM。
- 当前 DOM 始终最多保留一个 `.epub-chapter`，分页模式继续使用现有单章分页逻辑。
- 阅读进度保存章节路径、章节内滚动位置和全书综合百分比；刷新后先恢复章节，再恢复章节内位置。
- 高亮只绘制当前章节，跨章节高亮数据和导出仍保持完整。
- 保留现有 EPUB 安全清洗、资源预算、服务端进度和高亮接口，不引入新依赖。

## 非目标

- 不实现 EPUB 固定版式、脚本执行、全书搜索或音视频播放。
- 不在本次工作中实现整书虚拟列表或章节预览缓存。
- 不改变双页分页的纸张、翻页按钮和页组几何规则。
- 不把真实用户 EPUB 复制到仓库、测试夹具或 FPK。

## 方案选择

### 采用：单章节窗口 + 流式章节尾部

`openEpubArchive()` 继续只解析 ZIP 索引、OPF、manifest、spine 和目录；`loadEpubChapter(index)` 按需读取一个 XHTML。连续滚动和分页模式都通过 `renderEpubChapter(index, options)` 挂载单章，区别只在章节内容的 CSS 布局。

连续滚动模式的阅读区结构为：

```text
#reader
├─ .scroll-chapter-header
│  └─ #btnScrollPreviousChapter   (当前章 > 0 时显示)
├─ #article
│  └─ .epub-chapter               (始终只有一个)
└─ .scroll-chapter-footer
   └─ #btnScrollNextChapter       (当前章 < 最后一章时显示)
```

“下一章”采用正常文档流中的尾部按钮，而不是固定悬浮按钮；用户自然滚到章末即可看到它。切换章节时清空旧章节、加载目标章节、滚动回章节顶部，再恢复目标锚点或章节内滚动位置。这样不需要依赖整书高度，也不需要维护跨章节的虚拟滚动坐标。

### 不采用：整书 DOM + `content-visibility: auto`

`content-visibility: auto` 可以让浏览器跳过部分屏外布局和绘制，但屏外内容仍然存在于 DOM 和可访问性树中，不能解决章节 XHTML、图片和 CSS 资源持续解析、内存增长及整书高亮查询问题。它可以作为未来单章内大图片的局部优化，不能作为本需求的主架构。

### 不采用：隐藏 iframe/整书分片缓存

把每章放进隐藏 iframe 或保留多个章节缓存会重新引入资源隔离、选择范围、高亮定位和内存回收问题。当前项目已经有安全清洗、单章 HTML 包装和 DOM Range 高亮基础，继续使用它们的风险更低。

## 状态与接口

- `state.epubArchive`：继续保存 ZIP、spine、TOC、路径索引和资源预算。
- `state.epubChapterIndex` / `state.epubChapterCount`：当前章节和总章节数。
- `state.epubChapterLoading`：章节替换期间锁定章节按钮和目录跳转。
- `renderEpubChapter(index, options = {}) -> Promise<boolean>`：唯一的章节挂载入口；成功后 `#article .epub-chapter` 数量必须为 1。
- `navigateToEpubChapter(index, options = {}) -> Promise<boolean>`：根据当前模式加载目标章节；连续滚动不再寻找整书 DOM 中的目标节点。
- `updateReadingProgress(options = {})`：在连续滚动模式下计算“当前章节内比例”和“全书综合比例”，并同步两套桌面章节控件与移动端兼容控件。
- `currentReadingLocator(reader) -> object`：新增 `chapterPercentage` 和 `readingScope: 'chapter'`；保留 `href`、`anchor`、`textBefore`、`scrollTop`、`percentage` 字段以兼容旧数据。

## 进度兼容策略

新写入的 locator 示例：

```json
{
  "version": 3,
  "type": "semantic-position",
  "readingScope": "chapter",
  "href": "OEBPS/chapter-02.xhtml",
  "anchor": "section-2",
  "textBefore": "…",
  "chapterPercentage": 0.42,
  "scrollTop": 880,
  "percentage": 0.174
}
```

恢复顺序固定为：`href -> archive.chapterIndexByPath -> renderEpubChapter -> anchor/textBefore -> chapterPercentage/scrollTop`。旧 locator 没有 `chapterPercentage` 时优先使用 `href`、锚点和文本上下文；没有有效章节路径时回退第一章，不能把旧的整书 `scrollTop` 直接当作新章节坐标。

## 性能与并发规则

- 连续滚动打开流程只等待当前章节，禁止调用整书后台追加。
- 每次章节切换都递增 generation；过期的 ZIP 读取结果不得写入 DOM、更新状态或重绘高亮。
- 加载期间只允许一个生效章节请求；按钮、目录和内部链接暂时禁用。
- 首屏和章节替换前后各至少让出一次浏览器事件循环，避免大 XHTML 清洗长期占用主线程。
- 资源预算继续沿用单资源 8 MB、单书会话 48 MB；资源超过预算时跳过资源，不阻塞正文。
- 不用高频 scroll handler 触发章节加载；章节切换只由明确按钮、目录、内部链接或恢复逻辑触发。后续如需提前预取，只允许在当前章节首屏稳定后预取相邻一章，并且不能挂载到 DOM。

## 验收标准

1. 连续滚动打开三章 EPUB 时，首屏只出现第一章，`#article .epub-chapter` 数量始终为 1。
2. 滚到第一章末尾可以看到“下一章”；点击后显示第二章顶部，旧章节不再存在。
3. 第二章顶部显示“上一章”；点击后回到第一章顶部或恢复第一章最近保存的位置。
4. 目录项和带 fragment 的内部链接可以加载目标章节并定位 fragment；无效目标保留当前章节并显示错误提示。
5. 刷新后先恢复保存章节，再恢复章节内滚动位置；旧格式 progress 不会卡在 loading。
6. 当前章节的高亮能显示，换章后旧章节 overlay 清理；跨章节导出包含完整高亮集合。
7. 双页分页的章节内翻页、跨章边界翻页、顶栏章节按钮不被连续滚动改造破坏。
8. 单元测试、DOM 回归、Chromium E2E、结构检查和 FPK 构建通过；真实 fnOS 安装由用户完成验收。
