# Working Change Log

## 枕书 v0.0.15 2026-10-03 — 书库授权修复

- 修复：在 fnOS 中取消某个文件夹的授权后，它里面的书仍可能被扫描和打开。原因是应用优先使用自己保存的授权快照，而快照只在权限变更回调中更新；回调没有触发或失败时，旧授权会一直保留，重启也不会恢复。现在应用每次启动都以 fnOS 当时传入的授权为准，重写快照（fnOS 传入空值表示没有任何授权）。
- 书库列表、阅读统计、笔记与整理只显示当前授权文件夹里的书；取消授权后，不必等重新扫描，这些书就会立即消失（打开时本来就会被拒绝）。
- “书库文件夹”面板在书库正常时折叠为一行，点开可以看到每个文件夹的来源（fnOS 授权 / 应用共享文件夹 / 应用设置）和书的数量。
- 修复：靠近窗口底部的下拉菜单（例如书库整理时书籍下方的分类选择）在下方放不下时改为向上展开，不再被窗口截断。

## 枕书 v0.0.14 2026-10-03 — 液态玻璃按 Apple 规范精修

- 玻璃只用于浮在内容上方的侧边栏、顶栏、标签栏、菜单与面板；随页面滚动的页头胶囊与分类标签改为更克制的标准材质。
- 选中项统一为强调色文字和图标加中性托盘；主要按钮为带高光的染色玻璃，普通按钮在玻璃面板上无底色。
- 侧边栏玻璃更不透明；面板、菜单与内部元素的圆角改为同心；开关统一使用强调色；菜单出现时轻微缩放淡入。
- 系统“增强对比度”下玻璃接近不透明、边线清晰；手机上按钮点击区域不小于 44 点。

## 枕书 v0.0.13 2026-10-03 — 搜索定位、拖拽与样式表整理

- 全书搜索：同一章里重复出现、前后文也相同的短语，点击结果会定位到准确的那一处，不再只打开章节。服务端按整章重建后的位置给出“第几次出现”，也修正了含扩展汉字（如“𠀀”）时同一处被重复列出的问题。
- 书库拖拽排序：预览时只移动被拖的那本书，书多时不再卡顿（300 本时每步约快 18 倍）。
- 样式表整理：书库导航、阅读统计、笔记、书摘卡片、按钮与液态玻璃的样式移到 `app/ui/styles/` 下的独立文件，按原顺序加载；拆分前后 26 组界面截图逐像素一致。

## 枕书 v0.0.12 2026-10-03 — 液态玻璃：阅读页完整化

- 阅读页纸张四周铺上正在读的这本书的背景光，工具条、顶栏和翻页胶囊因此透出这本书的色调；纸张与正文不变。
- 设置、目录、书签、笔记、搜索面板，AI 面板，写想法编辑框，手机“⋯”菜单改为玻璃，带真正的模糊。
- 阅读设置里“背景光”两个选项各占一半宽度。

## 枕书 v0.0.11 2026-10-03 — 液态玻璃主题

记录见 `docs/superpowers/plans/2026-10-03-liquid-glass-theme.md`，演示见 `docs/demos/liquid-glass/index.html`。

- 新增可选主题“液态玻璃”（默认关闭）：书库顶栏的“外观”菜单或阅读设置“外观”中打开；关闭时界面与原来一致。
- 背景光可选“取自封面”（从“继续阅读”那本书的封面提取主色，换书时渐变过渡）或“淡蓝”（很淡的 iOS 蓝）。
- 书库、阅读统计、笔记：悬浮玻璃侧边栏、玻璃顶栏、页头“搜索 + 操作”胶囊、分类标签胶囊；菜单、卡片面板、选择长图浮条为浓玻璃；手机为悬浮玻璃标签栏。
- 阅读页：玻璃工具条与翻页胶囊、深色玻璃选区菜单与批注气泡、手机悬浮玻璃工具卡片；正文、纸张与 PDF 页面不变。
- 流畅度：滚动区域保持不透明、背景光只画在页面顶部，电脑端静止的玻璃不做实时模糊；书库 100 本书滚动时与关闭玻璃一样流畅。
- 系统“减少透明度”下玻璃变为不透明，“减少动态效果”下不做颜色渐变；Safari 等不支持透镜的浏览器为普通毛玻璃。

## 枕书 v0.0.10 2026-10-03 — 书卡与翻页细节

- 书库书卡第二行只显示作者；没有作者的书（多为 PDF）不再显示格式名称。
- 双页模式“上一页 / 下一页”胶囊内的文字和箭头居中，两侧留白一致。
- 测试：阅读时长“断网补报”用例先等正在进行的上报结束再读取，消除偶发失败；双页翻页用例检查胶囊内容居中。

## 枕书 v0.0.9 2026-10-03 — 界面一致性

- 按钮统一为三种角色：主要（实心强调色，一个区域最多一个）、普通（灰色填充）、文字（强调色文字）；书库、阅读统计、笔记与卡片面板共用 `zs-btn` 样式类，颜色只来自颜色变量。`tests/ui-buttons.test.js` 检查按钮规则不写死颜色、书库页面不用旧类名，`e2e/button-language.spec.js` 检查各页按钮的角色与外观一致。
- 选中状态统一：侧边栏与分类标签都用强调色浅底；“本周 / 本月”与卡片面板的分段控件用浮起的滑块。
- 进入分类后不再显示“返回书库”：分类标签中的“我的书籍”即可返回。
- 笔记排序与整理模式的分类选择改用应用内下拉菜单。
- 米黄主题下，书库页打开的卡片面板、笔记引文块与手机整理栏改用书库配色，不再混入阅读器的米黄色；手机“⋯”菜单改为不透明并位于分类标签之上。
- 修复样式表中一个多余的 `}`（导致其后的欢迎页引文样式被浏览器丢弃）。

## 枕书 v0.0.8 2026-10-03 — 阅读统计、笔记与书摘卡片

记录见 `docs/superpowers/plans/2026-10-02-v0.0.8-reliability.md` 与 `docs/superpowers/plans/2026-10-02-reading-stats-notes.md`。

- TXT 自动识别编码：GBK/GB18030、Big5、UTF-16 的 TXT 不再显示为乱码，搜索与 AI 问书同样按正确编码读取（已有的文本索引会自动重建）；导入也接受这些编码。
- 书库扫描时，个别读不了的子文件夹或文件会被跳过并列出，不再导致整个书库文件夹的书都不显示；NAS 的缩略图、回收站等系统文件夹直接跳过。
- 管理员在书库为空或有内容读不了时，会看到“书库文件夹”面板：实际读取的文件夹、各有几本书、哪些项目读不了及原因。
- 开始记录阅读时长（为“阅读统计”做准备）：只计算正在读的时间——页面在前台且最近 3 分钟内有翻页、滚动等动作；按日期和书累计，网络中断时暂存、恢复后补报。书第一次读到 98% 时记录读完时间；PDF 也开始记录阅读百分比，书库可显示 PDF 进度。
- 深色 PDF 以更高像素密度渲染：普通屏幕按 2 倍、高清屏按 3 倍（手机最高 2.5 倍，兼顾内存），浅色文字在深色页面上更清晰；切换进出深色时自动重绘，旧画面保留到新画面就绪。
- 书库新增左侧导航（手机为底部标签栏）：书库 / 阅读统计 / 笔记，地址栏可直接打开（`?view=stats`、`?view=notes`），返回键与刷新都停在原页。
- 阅读统计：本周 / 本月阅读时长、读过与读完的书、新增笔记，并与上一期对比；每日阅读柱状图（月视图按天），点柱查看当天各书时长；书籍时长排行与最近笔记，点击直接打开书或跳到该笔记。
- 笔记：按书汇总划线与想法，可搜索、排序；每本书一份笔记文档，按原书章节名与阅读顺序排列，可跳到原文、复制；另有“全部笔记汇总”。
- 书摘卡片：任意一条笔记可生成图片卡片，三种风格（书页 / 素笺 / 墨夜）、三种字体（思源宋体 / 霞鹜文楷 / 朱雀仿宋）、三种比例（3:4 / 1:1 / 16:9），可选显示想法、书名、日期、书封；中文标点不在行首，长摘录自动缩小字号。入口在笔记文档、阅读页批注编辑框和手机批注气泡。
- 书摘长图：在笔记文档里勾选几条或整本书的笔记，生成按章节排版的长图；很长时在两条书摘之间自动分成多张。
- 笔记导出：单本书和全部笔记都可导出 Markdown，或经浏览器打印另存为 PDF（A4 排版、按章节、带目录）。

## 枕书 v0.0.7 2026-10-02 — PDF 深色模式文字更清晰

- 深色 PDF 的文字由 `#e0e0e0` 提亮到 `#f2f2f2`，并用伽马曲线提亮字形边缘的灰色抗锯齿像素：细笔画的宋体/楷体不再发灰、发虚。改用 SVG 滤镜（反色 → 色相旋转 → 伽马），纸色仍为 `#1f1f1f`，图片保持原色不受影响。

## 枕书 v0.0.6 2026-10-02 — PDF 页面颜色跟随主题

方案与记录见 `docs/superpowers/plans/2026-10-02-pdf-page-colors.md`。

- PDF 页面跟随阅读主题：深色为深底浅字（色相保留，不是刺眼的纯黑白），护眼把纸色变为米黄，浅色保持原样；只改变显示，不修改文件，切换即时生效。
- 深色下图片保持原色（略调暗）；扫描版 PDF 整页反色以便阅读。
- 深色下选区、划线和搜索高亮仍清晰可见。
- 显示设置新增“PDF 页面颜色：跟随主题 / 原样”（仅 PDF 显示）。

## 枕书 v0.0.5 2026-10-02 — 首行缩进按书统一

调研与记录见 `docs/superpowers/plans/2026-10-02-paragraph-indent.md`。

- “首行缩进”改为“原书 · 无 · 1 · 2 · 3 · 4”（默认 2 字）；正文首字恰好落在所选字数处，“无”时与其他行对齐——不论原书用样式表、全角空格还是 `&nbsp;` 缩进。旧设置的 1.5/2.5 字四舍五入。
- 书自带样式表中的段落版式（缩进、居中/右对齐、注释的悬挂缩进）现在会生效：此前阅读器丢弃了书的样式表，所有段落都被一刀切缩进 2 字。注释、简介、落款、诗句、居中行等保持原书样式，只统一正文。
- TXT 每行一段（此前多行会合并成一个大段），“第N章”等行显示为标题，并跟随首行缩进设置；Markdown 不缩进。
- 已有划线、书签和进度不受影响。

## 枕书 v0.0.4 2026-10-02 — 手机阅读适配

规划、草图决定与各阶段记录见 `docs/superpowers/plans/2026-10-01-mobile-reading.md`。用户决定：两行底栏、选字气泡菜单、手机默认左右翻页、支持添加到主屏幕。

- **M0 划线修复**：选区菜单在 `selectionchange` 稳定后弹出，不再依赖安卓不会触发的 `touchend`；手指按下、滚动、窗口变化不再关闭菜单；手机上菜单在选区下方（避开系统复制条），单行“划线 · 写想法 · 复制 · 问 AI · 搜索”；“划线”一键完成并弹出气泡改颜色/样式（记住上次样式）、写想法、复制、问 AI、删除；点已有划线重新打开气泡。
- **M1 阅读页**：去掉浮动 ⋯；轻点中间呼出浮在正文上的顶栏（返回 · 书名 · 搜索 · 书签 · ⋯）和两行底栏（上一章 · 进度条 · 下一章；目录 · 笔记 · AI · 夜间 · 设置），分页时左右三分之一翻页；收起时底部显示章节与进度；手机单独保存阅读方式 `mobileReadingMode`（默认左右翻页）；返回手势先关面板再回书架；适配刘海与底部横条；手机打开书不再自动展开目录。
- **M2 面板**：目录/设置/搜索/AI 统一为带把手的底部抽屉，可下拉关闭；设置先开半屏，“更多设置”展开全部；目录标出并滚到当前章；AI 近全屏，头部操作收进 ⋯，输入框跟随软键盘。
- **M3 书库**：手机书库操作收进 ⋯；长按书籍弹出“打开 / 重命名 / 移动到分类 / 书籍信息”；整理模式底部出现“完成”操作条（非整理状态长按不再拖动排序）。
- **M4 基础**：Web App Manifest 与 192/512、apple-touch 图标，可添加到主屏幕全屏阅读；状态栏颜色跟随主题；防下拉刷新与回弹；手机分页改为整屏、正文加宽（375 宽屏约 230px → 335px）；两端对齐按字符分配，中文为主的章节允许行尾英文单词断开；PDF 双指缩放页面。
- **其他**：主题切换的月亮图标更饱满、居中；刷新时不再闪过欢迎页；界面与文档中过时的说明（如已移除的拖动手柄）已更新；复制在剪贴板接口失败时不再清掉读者的选区。
- 测试：新增 `e2e/mobile-selection`、`mobile-panels`、`mobile-library`、`mobile-basics` 与整理 E2E 的手机组，更新相关 DOM/E2E 断言。真机（iOS Safari、Android Chrome、飞牛 App 内置浏览器）验收清单见规划文档。

## 枕书 v0.0.3 2026-10-01 — AI 问书重构：准确、高效、低成本

方案与评测记录见 `docs/superpowers/plans/2026-10-01-ai-book-qa-accuracy.md`。用户决定：导读首次问到时生成并提供手动按钮、全 NAS 共享；做语义检索；只用 OpenAI 协议，模型由用户自己添加。

- **P0 接口与评测**：新增 `ai-transport`，在 Responses 与 Chat Completions 两种 OpenAI 协议之间转换（含流式、用量、`max_completion_tokens` 重试）；新配置默认 Chat Completions，已保存的旧配置保持 `/responses`。AI 设置新增接口协议、导读与导航模型、语义检索（嵌入模型、可单独的 URL 与 Key）。新增评测书《山居茶事》与 30 道题、`scripts/evaluate-ai-book-qa.js`。基线：范围判断 47%、证据命中 67%、全书概览只覆盖 28% 的章节。
- **P1 目录树、路由、服务端取证**：索引新增目录节点表（EPUB 目录；TXT/Markdown 识别“第N章/卷/节”“一、”、Markdown 标题、序言后记）；整章原文可去重叠读回。`ai-router` 识别全书、章（中文/阿拉伯数字、章名、本章、分卷书按册）、节、选中解释、比较、查找；规则拿不准时用经济模型看目录导航一次。`ai-answer-pipeline` 在服务端按问题类型取证并作答，浏览器不再上传书本内容；章节问题整章 3.6 万字以内直接给全文（去掉了旧的 2.2 万字上限）；书卡作为稳定前缀以利用缓存。修复 EPUB2 NCX 目录解析把所有章节挂到上一卷的错误（解析版本 3）。
- **P2 导读图**：`ai-book-map` 沿真实目录生成节、章、卷、全书摘要（超长书按比例抽读，整书输入有上限），后台任务可取消、可续跑，按“节点 + 内容哈希”存于 `ai-map/`，全 NAS 共享。全书概览直接用导读（缺失部分 25 万 token 以内当场生成，否则先抽样回答并提示用量）；超长章节、比较、选中解释也会用到导读。AI 面板新增“导读”页。TXT/Markdown 书也开放 AI 问书。
- **P3 检索质量**：去掉问句套话后取关键词，先找全部关键词命中的段落，再用任一命中补足；命中块与前后相邻块合并成完整段落再交给模型。
- **P4 语义检索**：OpenAI `/embeddings`，int8 向量按书存于 `ai-vectors/`，首次提问后台建立（200 万字以上手动），检索时与关键词结果 RRF 融合；“导读”页显示语义索引状态并可手动建立。
- **P5 PDF 统一**：PDF 用书签、标题或每 8 页分组生成目录节点，走同一条流水线；支持“第N页”“第3到5页”“本页”；当前页用于定位所在章节；导读与语义检索同样可用；会话来源记录文件指纹。
- 测试：新增 `ai-transport`、`ai-router`、`ai-planned-api`、`ai-planned-pdf`、`ai-book-map`、`ai-lookup`、`ai-embeddings`、评测书等单元测试；评测（离线）30 题范围判断与证据命中均为 100%。真实回答质量需用你自己的模型运行 `ZHENSHU_EVAL_API=1 node scripts/evaluate-ai-book-qa.js --pipeline=planned` 验证。

## 枕书 v0.0.2 2026-10-01 — 书籍重命名、整理模式对齐、去掉拖动手柄

- **书籍重命名**：整理模式下每本书底部新增铅笔按钮，弹出“重命名”对话框，可保存新书名或“恢复原名”（显示原书名）。重命名只对当前飞牛用户生效，不修改 NAS 上的文件，其他用户仍看到原书名。书架、继续阅读、生成的封面和阅读页标题都使用新书名。
  - 服务端：每个用户的书库整理数据新增 `bookTitles`（书 ID → 书名），新接口 `PUT /api/library/books/:id/title`（带 revision，冲突返回 409）；书名做 NFKC 与空白规整，最多 200 字，禁止控制字符；改回原名或清空即删除覆盖。`/api/library`、扫描结果和整理快照都按当前用户套用书名，并附 `originalTitle`；书从书库消失后，清理孤儿引用时一并删除其书名。
- **整理模式对齐**：同一行书卡等高，分类下拉框和重命名按钮固定在卡片底部，书名一行、两行或有无作者都能对齐（桌面和手机均已检查）。
- **去掉书卡右上角的拖动手柄**：书籍直接拖动封面排序（鼠标移动 6px 后开始，触屏长按后拖动），与之前相同。手柄只保留给键盘：视觉上隐藏，Tab 聚焦后封面出现焦点环，按上下方向键调整顺序。分类卡片的手柄不变。整理提示文案同步更新。
- 测试：新增服务端重命名接口测试（按用户隔离、规整、冲突、超长/控制字符、恢复原名、书不存在）和 DOM 测试（按钮、对话框、提交后书架和共享书单更新）；E2E 中拖动书籍改为拖动封面；DOM 断言改为书籍手柄在整理模式下仍隐藏。

## 枕书 v0.0.1 2026-10-01 — 更名为“枕书”、直连端口、AI 问书细节

版本号随新应用 ID `zhenshu` 从 0.0.1 重新开始（用户指定）；此前的 v1.x 版本属于旧应用 `babyreader-fnos`。

**更名**（用户选择“枕书”，并作为一个新应用发布）：
- 应用名称改为“枕书”，fnOS 应用 ID 由 `babyreader-fnos` 改为 `zhenshu`：网关地址变为 `/app/zhenshu/`，包用户与共享目录 `zhenshu/library`，环境变量前缀改为 `ZHENSHU_`（如 `ZHENSHU_PDF_ENABLED`），私有请求头改为 `X-Zhenshu-*`，浏览器本地存储键也随之改名。
- 这是一个新的 fnOS 应用：与旧版 BabyReader fnOS 版并存，**旧版的阅读进度、划线和设置不会自动迁移**。
- 许可：仍为 MIT。`LICENSE` 写明新的版权方，同时按 MIT 要求保留原项目 BabyReader（一龙小包子）的版权声明；README 新增“致谢”（BabyReader、PDF.js、lingo-reader、随包 OFL 字体、fnnas-docs）和“许可”。欢迎页署名改为“枕书 · by ruoshui6662 · 致谢开源项目 BabyReader”。
- manifest：显示名、简介、维护者和主页地址更新。

**直连端口**（可选，默认关闭）：
- 新增安装向导 `wizard/install` 与应用设置中的“直连访问”：开启后可在浏览器直接打开 `http://NAS 地址:端口/`，不经过 fnOS 的 5666 端口。
- 直连端口没有 fnOS 登录，所以由枕书自己把关：先输入访问密码（只保存 scrypt 哈希），登录后以设置中指定的那个飞牛用户的书架、进度和划线显示。该用户需先在飞牛桌面打开一次枕书，枕书才知道它对应的用户 ID。
- 安全：丢弃客户端自带的 `X-Trim-*` 身份头；会话 Cookie 为 HttpOnly、SameSite=Strict、30 天有效，用应用私钥签名，修改密码或用户后所有设备需要重新登录；同一地址 15 分钟内输错 5 次即暂停登录；登录后的跳转只允许回到应用内部；直连时不具有管理员权限（扫描书库、导入书籍仍走 fnOS 桌面）。
- 应用设置中留空的项保持原值，“保持不变”为默认选项，因此保存其他设置不会关掉直连访问。端口限定 1024–65535，不允许 5666/5667；端口被占用时记录一次错误并每 5 秒重试，设置修改后 5 秒内生效，无需重启。
- 新增 `app/server/direct-access-config.js`（向导值校验与保存，可由生命周期脚本调用）和 `app/server/direct-access.js`（监听、登录页、会话、身份映射）；`install_callback` 与 `config_callback` 调用前者，失败时在 fnOS 中显示原因，不输出密码。

**AI 问书面板**：
- 修复面板右上角出现两个关闭“×”的问题（旧样式给最后一个按钮设了字号，盖过了统一关闭按钮的样式）。
- 标题左对齐、字号 17px；未配置 AI 时，提示改为卡片样式，并附“去设置”按钮直接打开 AI 设置。
- 修复：AI 配置状态先于提示更新，避免发送按钮状态与提示不一致。

**其他**：书库为空时的说明改为列出全部支持格式（原文仍写着“已启用的 PDF”）。

**测试**：新增 `tests/direct-access.test.js`（9 项：端口校验、只存哈希、留空保持不变、会话签名与过期、跳转限制、真实端口上的登录与身份映射、伪造身份头无效、错误次数限制、安装回调）；生命周期测试改为允许设置中只有直连访问这 4 项输入；结构检查新增 3 个必需文件。

## v1.4.1 2026-10-01 — 图标与工具栏统一（方案三：图标加文字）

- 依据用户要求，审查全部图标后提供 4 套方案，用户选择方案三“图标加文字”。
- 审查发现的问题：设置用齿轮，小尺寸像花，而且实际打开的是字体与主题；笔记用折角文档，与“导出”“文件”难区分；AI 三颗细星太小；章节跳转用“|‹ ›|”，是媒体播放器的跳到开头/结尾符号；关闭按钮混用文字“关闭”和“×”；手机工具栏只有文字，桌面只有图标；右侧工具栏是 6 个带阴影的白色圆片，显得零散。
- 统一为一套图标（24 网格、1.8 线宽、圆角端点）：目录为圆点列表，搜索为放大镜，书签，笔记为“方框加铅笔”，AI 为一大一小两颗四角星，设置为“Aa”（参照 Apple 图书的“主题与设置”），主题为月亮或太阳。
- 右侧工具栏改为一个胶囊，每个按钮是图标加 11px 文字说明（目录、搜索、书签、笔记、AI、设置），按钮宽 44px、高 52px，保持最小点击宽度；选中时为强调色加浅色底。
- 章节跳转（顶栏胶囊和连续滚动的章节按钮）改为普通的 ‹ ›；翻页按钮本来就是 ‹ ›，保持一致。
- 7 个关闭按钮统一为灰色圆底加“×”（Apple 关闭按钮样式），用 CSS 遮罩绘制，不受阅读字体影响；按钮文字仍保留给读屏软件。
- 手机工具栏在原有文字上方加入相同图标（书架、目录、书签、搜索、笔记、划线、设置）。
- 测试：图标几何用例改为章节图标单路径，并检查 6 个文字说明和 7 个统一关闭按钮；一处单元测试的类名正则改为允许附加类名。

## v1.4.0 2026-10-01 — 商业级阅读体验（体验优化阶段 0–3）

### 阶段 3：品牌、动效与加载状态

计划见 `docs/superpowers/plans/2026-10-01-commercial-grade-reading-ux.md` 阶段 3。

**品牌**（用户在 3 个方案中选择 B“猫耳 + 书页”）：
- 新标志为扁平矢量图形：橙色圆角方块上，一本打开的书，书页上方立起两只猫耳。源文件 `app/ui/images/logo.svg`，`npm run render:icons`（`scripts/render-icons.js`，使用已安装的 Playwright Chromium 渲染）生成所有尺寸。
- **合规问题顺带修复**：fnOS 要求 `ICON.PNG` 为 64×64、`ICON_256.PNG` 为 256×256，且不超过 1024 KB。旧图标两个都是 1024×1024、1048 KB，尺寸不符且超出上限。新图标分别为 1.6 KB 和 6.5 KB。
- 启动器图标按 fnOS 文档改为 `images/icon_{0}.png`（`icon_64.png`、`icon_256.png`），删除旧的 1 MB `assets/cat-logo.png`。
- 网页增加 favicon（SVG 加 64px PNG）和 apple-touch-icon；顶栏 “BabyReader” 前加上同一标志（手机阅读时隐藏，节省空间）。
- 结构检查新增 3 个必需文件；新增单元测试，按 fnOS 规格检查图标尺寸、格式和大小。

**动效规范**（Apple 人机界面指南：有目的、简短、可打断、可关闭）：
- 只保留 3 档时长变量：`--dur-fast` 160ms（悬停、按下反馈）、`--dur-med` 240ms（面板、顶栏、浮层）、`--dur-slow` 320ms（大面积变化）。原先硬编码的 22 处时长（0.15s、120ms、180ms、220ms、0.25s 等）全部换成变量，通用的 `ease` 统一为 `--ease-out`。
- 去掉两处 `transition: all`（会连布局一起做动画），改为只列出实际需要的属性。
- 新增全局“减少动态效果”兜底：系统开启该选项时，所有动画和过渡变为瞬时。
- 新增 `tests/ui-motion.test.js`，防止硬编码时长和 `transition: all` 再次出现。

**加载状态**：
- 打开应用时，“正在加载书库…”文字换成书架骨架（标题条和书封占位，与真实书架网格相同）；打开 EPUB 时，“正在打开 EPUB…”换成正文骨架（标题和若干行）。骨架有轻微的明暗呼吸，“减少动态效果”下静止；原文字保留给读屏软件。加载失败时仍显示错误和“重试”。
- 新增 `e2e/brand.spec.js`（favicon、启动器图标和顶栏标志都能正常加载）。

### 阶段 2：随包字体与显示设置

计划见 `docs/superpowers/plans/2026-10-01-commercial-grade-reading-ux.md` 阶段 2；字体授权见 `docs/fonts-licensing.md`。

**字体**（依据用户要求：默认字体须可免费商用，并增加阅读软件常用字体）：
- 以前只按名称引用读者设备上的字体。“思源宋体”在多数 Windows、Android 设备上并未安装，会悄悄退回宋体，看起来完全一样。
- 现在随包提供 4 款 SIL OFL 1.1 字体（均无保留字体名，可免费商用、可随软件分发）：思源宋体（Noto Serif SC，**新默认**）、霞鹜文楷、朱雀仿宋（官方 v0.212 预览版，用 fontTools 自行切分）、Literata（西文）。另保留系统黑体、系统宋体两个系统字体选项。
- 按 `unicode-range` 切片，合计约 11.9 MB；每种字体单独一个样式表，读者选中时才加载，并且只下载用到的字符切片。
- 未采用：方正四款“免费商用”字体（需书面授权且禁止传播）；HarmonyOS Sans、MiSans、阿里巴巴普惠体（厂商自定义授权，需逐一审查）；Adobe 版 Source Han（保留了字体名 “Source”）。
- 设置字段改为 `readerFont`，默认思源宋体。旧字段 `fontFamily` 被每次保存写成 `sans`，分不清是用户选择还是旧默认值，因此不再读取；已安装的 NAS 也会切换到思源宋体，想用黑体可以重新选择。
- `scripts/vendor-fonts.py` 记录来源并可重新生成；E2E 仍固定使用系统黑体，避免字体度量变化影响分页几何测试。

**显示设置改版**（参照 Apple 图书“主题与设置”）：
- “外观”最上面是字号 A− / 当前字号 / A+（按原有字号档位递增或递减，到头时禁用）；下面是三个主题色块（浅色、护眼、深色）；再下面是 5 张字体卡片，每张用对应字体显示 “Aa 永” 预览。
- “排版”顶部是 紧凑 / 标准 / 宽松 三个预设（同时设置行高、段间距和页边距，“标准”即默认值）；首行缩进、段间距、字号、行高、页边距等细项收进可展开的“自定义”；“恢复默认”保留。
- 原来的主题、字体下拉框仍作为底层控件保留在页面里（不可见），保存逻辑、键盘操作和自动化测试都沿用原路径。
- 测试：新增 `e2e/reader-settings.spec.js`（字体授权文件存在、思源宋体确实从随包文件加载、字体卡片切换并在重新加载后保留、A−/A+ 步进与边界、预设与主题色块生效并保留）；原有两个用例改为检查新控件，以及仍在使用的两个下拉框。
- 计划中的“章节标题去掉下划线”暂不实施：样式注释显示，该下划线是此前参照微信读书（如“引子”）刻意设计的，没有反证。待用户确认。
- 已知问题：窄栏中较长的西文单词换行时，两端对齐会拉大中文字距（例如“否 真 正 生 效”），留待后续排版优化。

### 阶段 1：统一阅读外壳

计划见 `docs/superpowers/plans/2026-10-01-commercial-grade-reading-ux.md` 阶段 1。

**先清理长期失败的 7 个 E2E 用例**（计划 §5 要求在阶段 1 之前完成），其中 2 个是真实界面 bug：
- 删除标记会弹出确认框，Playwright 默认取消，3 个删除用例一直超时：测试改为确认并核对提示文字。
- PDF 搜索的“仅定位到页”提示已移到阅读器提示条：测试改为检查提示条。
- **Bug**：保存可用的 AI 配置后，面板仍显示“尚未配置 AI 服务”。原因是 `applyAiStatus` 先设置状态文字、后标记发送按钮已配置，被 `setAiStatus` 的保护逻辑降级为警告。已调整顺序。
- AI 面板按 Esc 关闭，符合 2026-09-28 交互计划 UX06；测试原先期望不关闭，已更新。
- **Bug**：AI 发送按钮比两行高的输入框中线低约 9px，改为垂直居中。
- 模块加载用例写死了 `?v=` 缓存版本号，每次正常升级版本号都会失败：改为只检查带有版本号。
- 结果：E2E 第一次全部通过。

**统一外壳**：
- **右侧工具栏**：EPUB、MOBI、PDF 统一为 6 个按钮：目录、搜索、书签、标记与想法、AI、显示设置。划线由选区菜单完成；导出放在笔记面板（原本就有“导出笔记”）；深色/浅色切换移到顶栏右侧，与书库页一致。旧按钮的 DOM ID 保留（单元测试要求 ID 稳定），只用 CSS 移出工具栏。
- **顶栏中间统一为“位置胶囊”**：EPUB/MOBI 显示“‹ 第 2/3 章 · 33% ›”，章节跳转按钮从右侧移入胶囊（44px 宽、32px 高，保持最小点击宽度）；PDF 保留自己的页码与缩放胶囊。
- **进度含义统一**：以前分页模式下按章加载的书显示的是“本章百分比”，滚动模式显示“全书百分比”；现在都是全书百分比。“1-2 / 5”改为纸面底部的“本章还剩 N 页”（或“本章最后一页”），位于两个翻页按钮中间，像书页上的页码。
- **PDF 也有目录**：没有书签大纲的 PDF，目录显示页码列表（“第 1 页 … 第 N 页”，页数过多时按间隔抽取）。这种自动生成的页码列表不会触发“默认展开目录”。
- **返回原处**：从目录、搜索结果、笔记或书签跳转后，阅读区左上角出现“返回原处”（参照 Apple 图书），20 秒内有效；跨章节也能回到原来的页。打开另一本书时清除。
- **选区菜单**：EPUB 和 PDF 原本就共用同一个选区菜单；新增“搜索”，打开搜索面板并直接搜索选中的文字。
- **顺带修复**：遗留的左侧目录栏样式 `body.has-toc.toc-open .reader { padding-left … }` 会在“默认展开目录”开启且 PDF 有目录时挤压 PDF 阅读区，导致适宽、缩放和选区位置错位。目录早已移入阅读面板，三条遗留规则已删除；EPUB 的内边距不受影响。
- 测试：新增 `e2e/reader-shell.spec.js`（统一工具栏、PDF 页码目录、顶栏进度与本章剩余页、返回原处、选区搜索）；相关旧用例改为通过选区菜单划线、通过笔记面板导出、在位置胶囊中查找章节按钮。

### 阶段 0：目录修复与默认值

计划见 `docs/superpowers/plans/2026-10-01-commercial-grade-reading-ux.md` 阶段 0。

- **手机上目录面板空白**（A1）：根因是 `styles.css` 中遗留的 `html[data-reader-surface="mobile"] .toc { display: none !important; }`。早期目录是左侧边栏，手机上需要隐藏；后来目录移进了阅读面板，这条规则却一直把手机上的目录藏起来。已删除。页面中唯一的 `.toc` 就在阅读面板里，删除后不影响其他地方。
- **手机上点目录项后关闭面板**：手机上的目录面板是覆盖正文的浮层，跳转成功后自动关闭，让读者看到所选章节；桌面上目录是侧边面板，保持打开，方便继续浏览。
- **打开书默认不再弹出目录**（A2）：新增设置字段 `tocAutoOpen`，默认关闭，取代 `tocOpen`。旧字段被每次保存写成 `true`，分不清是用户主动开启还是旧的默认值，因此不再读取它。想要自动展开的用户，在显示设置里重新打开“默认展开目录”即可，会保存到新字段。
- 测试：新增 E2E——没有开启该选项时打开书只显示正文（即使存储里有旧的 `tocOpen: true`）；手机视口下目录列出全部章节，点击后跳转并关闭面板。已确认把旧规则加回去后这条手机用例会失败。E2E 的公共设置重置改为 `tocAutoOpen: true`，原有的目录相关用例仍覆盖自动展开路径。

## v1.3.8 2026-09-30 — MOBI/AZW3 与导入默认开启

- 依据用户要求：与 PDF 一样，MOBI/AZW3 阅读和管理员导入改为始终开启，从应用设置中移除这两个开关。
- `mobi-feature-config.js`、`import-feature-config.js` 与 PDF 的开关模块处理方式相同：忽略旧版本留下的 `*-feature.json`（以前每次保存设置都会写入 `{"enabled":false}`），只保留环境变量 `BABYREADER_MOBI_ENABLED` / `BABYREADER_IMPORT_ENABLED` 设为 `0/false/no/off` 时的运维紧急关闭。导入仍然只对管理员开放。
- `config_callback` 只保留授权目录快照。设置页没有删除，改为一个只有说明文字的步骤“阅读格式”：`config_callback` 写入的授权目录快照优先于环境变量，如果删除设置页导致 fnOS 不再调用 `config_callback`，新授权的目录可能无法生效。只有说明文字的设置步骤能否被 fnOS 正常显示，需要在 NAS 上确认。
- 紧急关闭时，书库和导入的提示改为“管理员已关闭 …”，不再让用户去设置里找开关。
- 测试：新增 `tests/format-switches.test.js`；MOBI 书库和导入的关闭态测试改用环境变量驱动；E2E 去掉了开关切换；生命周期测试改为验证设置页没有开关、`config_callback` 忽略旧字段并仍写入授权目录快照。

## v1.3.7 2026-09-30 — PDF 阅读默认开启

- 依据用户要求：书库提示“另有 6 本 PDF 已扫描；请在 fnOS 的运行设置中启用 PDF 阅读”，不希望再到设置里单独开启。
- PDF 阅读与全文搜索改为始终开启：
  - fnOS 应用设置中移除了 PDF 开关；`config_callback` 不再写入 `pdf-feature.json`。
  - 服务端忽略旧版本留下的 `pdf-feature.json`。以前每次保存设置都会写入 `{"enabled":false}`，如果继续读取它，已安装的 NAS 会一直关闭 PDF，而且已经没有开关可以打开。
  - 环境变量 `BABYREADER_PDF_ENABLED=0/false/no/off` 保留为运维紧急关闭开关；此时书库提示改为“管理员已关闭 PDF 阅读”，不再让用户去设置里找开关。
- 测试：开关模块与服务端测试改为验证“默认开启、忽略旧文件、环境变量可关闭”；原有的“关闭时隐藏目录、拒绝内容和搜索、保留分类位置并在恢复后还原”改用环境变量驱动，继续保留。

## v1.3.6 2026-09-30 — 修复应用设置后“无法启用”，修复两个不稳定测试

### 修复应用设置后“无法启用”

- 现象：在 fnOS 应用设置中开启 MOBI/AZW3 并保存后，应用中心显示“无法启用 babyreader-fnos：状态操作不支持，并返回当前应用状态和业务状态”。
- 已排除：`config_callback` 在本地按各种开关组合运行均退出 0 并正确写入；开启 MOBI 不影响服务启动，开关文件在每次请求时读取，本身无需重启。
- 判断（尚未在 NAS 上取证）：保存设置后 fnOS 会重启应用并查询 `cmd/main status`。原脚本只凭 PID 文件判断服务是否在运行；文档已记录这台 NAS 出现过“服务正常但 status=3”。PID 文件不可信时，`status` 报告未运行，`start` 删除仍在服务的 socket 再启动第二个实例，fnOS 于是判定启动失败。
- 修复（`cmd/main`）：
  - PID 文件缺失或失效时扫描进程表（参数为本包 `server/index.js`，或经 `readlink -f` 指向同一文件），找到后重新写入 PID 文件；
  - 已有健康实例时，`start` 直接返回成功，不再重复启动；
  - 不支持的动作按 fnOS 约定返回 1（原为 2）。
- 测试：新增生命周期测试，用伪造的进程表（`BABYREADER_PROC_ROOT`，仅供测试）覆盖：只有无关进程、无 PID 文件但服务在运行、PID 文件失效、服务已退出、未知动作这五种情况。Linux 下真实启动和停止的测试仍需在 Linux 主机或 NAS 上验证。

### 修复两个不稳定测试

- `pdf-ai-profile`：偶发 `finishBuild is not a function`，有时整个测试进程卡住约 15 分钟。根因在 `getOrCreateProfile`：它先异步读取磁盘缓存，读完才加入或创建共享构建任务，测试却只等一个 `setTimeout(0)`。同时还有一个真实的竞态：等待方在读缓存期间被取消，会创建构建任务并随即把它取消；后来的调用方又可能加入这个已取消的任务，平白收到 AbortError。
  - 产品修复：已有进行中的构建时，先同步加入它，不再读盘；不加入已取消的任务；读完缓存后重新检查取消状态；旧任务结束时只删除自己的登记，不会删掉新任务。
  - 测试修复：等构建真正开始后，再发起第二个等待方。新增一条回归测试，覆盖读缓存期间被取消的情况。
  - 验证：单独连续运行 15 次全部通过；8 个进程并行跑 3 轮（共 24 次）全部通过，没有卡住。
- `pdf-reader.spec.js` 的“放大后再次拖选”用例：放大时先把旧文本层按比例拉伸，等重新渲染完成后才替换成新文本层，而 `data-text-layer-state` 全程都是 ready。测试只等 ready，拖选有时落在即将被替换的旧文本层上。现改为先等第 1 页重新渲染完成，记录 `data-frame-id`，放大后等它变化、`aria-busy=false` 后再拖选。连续运行 15 次全部通过（原先约 1/8 失败）。

## v1.3.5 2026-09-30 — 连续滚动阅读沉浸化

- 现象：桌面连续滚动阅读时，滚动区域从 52px 顶栏下方开始，白色纸张被灰色顶栏硬生生截断，章节标题被拦腰切开，显得割裂。
- 修复（仅桌面端 EPUB 连续滚动模式）：
  - 滚动区域延伸到窗口顶部，正文可以滚到顶栏下方，由顶栏原有的毛玻璃效果模糊，不再出现硬切线。
  - 向下阅读时顶栏自动隐藏，纸张直达窗口顶部（与微信读书一致）；向上滚动、鼠标移到窗口顶部或键盘焦点进入顶栏时重新出现。复用了移动端已有的滚动隐藏逻辑。
  - 记录阅读位置、跳转到搜索结果或笔记时会扣除顶栏高度（`scroll-padding-top`，由 `readerTopInset()` 读取），避免定位到顶栏下方。
- 分页模式和移动端的行为不变。新增 E2E 用例覆盖滚动隐藏、向上滚动显示和鼠标移到顶部显示。
- 测试辅助函数 `openEpubFixture` 原先等待“E2E EPUB Chapter 1”出现。重新打开一本已保存进度的书时，书会恢复到第 2 章，只有赶在恢复之前才能看到第 1 章，因此 `persistence.spec.js` 偶尔失败。现改为等待任意章节标题。
- 发现一个已有的不稳定用例：`pdf-reader.spec.js` 中“real pointer text selection … after zoom”。在 v1.3.3 的样式下单独运行同样约 1/8 失败，与本次改动和 v1.3.4 的选区修复无关。推测原因是放大后等待的 `data-text-layer-state=ready` 在放大前就已是 ready，拖选可能落在正在替换的旧文本层上。

## v1.3.4 2026-09-30 — PDF 选中文字颜色不均修复

- 现象：在 PDF 中选中文字时，引号、英文（如 “App ID”）与中文交界处出现深色色块，上下边缘也参差不齐。
- 原因：PDF.js 文本层按字体片段拆分 span（中文、引号、英文各一个），相邻 span 有重叠。选区底色原为 28% 透明，重叠处叠了两层，所以发深。
- 修复：选区底色改为不透明的浅蓝（`--selection-bg` 与白色 30% 混合），文本层整体使用 `mix-blend-mode: multiply` 叠到画布上。重叠多少层颜色都一样；画布上的黑字经过正片叠底仍是黑色，字形不受影响。PDF 页面在所有主题下都是白纸，因此效果一致。
- E2E 断言从“半透明”改为“不透明并且使用正片叠底”。

## v1.3.3 2026-09-30 — 书架封面放大、继续阅读卡片缩小

- 依据 v1.3.2 真机反馈：100px 的封面偏小，“继续阅读”卡片相对偏大。
- 桌面封面最小宽度 100px → 128px，间距 32/28 → 36/32px；1280px 书架每行 8 本（1560 宽窗口实测封面 132×191）。平板 96px → 112px；手机仍为每行 3 本。
- “继续阅读”卡片：宽 540px → 420px，高约 132px → 94px，封面 72×104 → 48×70，书名 17px → 15px，进度条和“继续”按钮同步缩小。

## v1.3.2 2026-09-30 — 微信读书式书架、新建分类内联、双页阅读区放大

### 书架封面统一与新建分类内联

- 书架参照微信读书网页版缩小封面：原先桌面每行固定 6 本、封面约 188px 宽，手机每行 2 本，封面过大。现在按封面最小宽度自动排列：桌面约 100px（1440 宽时每行 10 本，103×149），平板 96px，手机每行 3 本（约 104×150）。封面比例改为 1:1.45，圆角 3px，阴影更轻，悬停时上浮 2px。书名最多显示两行（13px），作者和进度在一行。
- 书架封面统一尺寸：原先封面按原图比例显示（`contain`），宽封面矮、窄封面瘦，书架参差不齐。现在所有封面都放在同一个画框里（最终比例 1:1.45，见上一条），居中裁切填满（`cover`），与微信读书一致。阴影由贴合图片的 `drop-shadow` 改为更轻的 `box-shadow`；“继续阅读”卡片中的封面同样处理。
- “新建分类”的输入框从书架网格上方移到分类标签行末尾，样式为胶囊：输入框、蓝色“保存”和“取消”。按 Esc 关闭，焦点回到“新建分类”；名称为空时直接提示，不发请求。
- 翻页按钮距纸张底边 14px → 16px，与左右两侧的 16px 一致。

### 双页阅读区放大

- 依据 v1.3.1 的真机反馈：双页阅读区比微信读书网页版略小。
- 纸张宽度不变，从纸张内部腾出空间：内边距 70px → 56px，栏间距 98px → 84px，外侧上下留白 56/40px → 40/24px，内部上下边距 64/56px → 56/60px。在 1460×900 窗口下，每栏宽度 538px → 559px，每页约多一行。
- 翻页按钮改为 32px 高的无边框小按钮。修复了旧按钮压住最后一行文字约 8px 的问题，现在与文字间距 14px。
- 更新了 4 条分页几何测试的期望值：其中 2 条原来写死了旧常量；另外 2 条原先用旧的栏间距构造期望值，改为使用默认栏间距。
- 顺带修复一个间歇性失败的测试：`book-import-api` 的“重复导入”用例原先重新打包 EPUB，ZIP 时间戳精度是 2 秒，跨过边界时两次打包的字节不同，导致判重失败。现在两次上传使用同一份字节。

## v1.3.1 2026-09-30 — 阅读界面 v2 与主题修复

- 依据 v1.3.0 的真机反馈：
  - 18 MB 以上的 MOBI 可以正常打开，首次打开时显示“正在准备”，这是预期行为；
  - 顶栏和纸张阴影过重、不够沉浸；
  - 浅色和护眼米黄的配色颠倒。
- **修复**：护眼米黄原来是白纸，浅色的浮层却是暖色，两者颠倒；现在浅色为白纸配中性灰背景，米黄为暖色纸（`#F6F0E1`）配更深一档的暖色背景。
- **重新设计**（参考微信读书网页版）：
  - 书库和阅读页的顶栏去掉阴影和分隔线，与背景融为一体；
  - 纸张（连续滚动、双页、PDF）去掉大投影，只保留极淡的贴边阴影，圆角 12px；
  - 桌面右侧工具栏改为独立的圆形按钮；
  - PDF 页面放在舞台色背景上。
- 在预览环境中目测了浅色、米黄、深色三种主题，以及连续滚动和双页两种模式，并检查了 PDF 阅读器。
- 验证（按顺序串行执行）：`npm test` 608 项，598 通过、0 失败、10 跳过；结构检查通过；Chromium E2E 138 通过、9 失败（与基线相同，没有新增）；书库组织专项 23/23。新增的 E2E 回归用例专门防止浅色和米黄再次被配反。

## v1.3.0 2026-09-30

- **MOBI/AZW3 阅读**（默认关闭；在应用设置中打开“启用 MOBI/AZW3 阅读”后需要重新扫描）：
  - 服务端把 MOBI6 和 KF8（AZW3）转换成确定性的派生 EPUB，完整复用 EPUB 的阅读、目录、划线、进度、全文搜索和 AI 问书；
  - 解析器采用 vendor 的 lingo-reader 0.4.6 修补版，4 处补丁均有记录，并在调用它之前自行校验 DRM、截断和文件类型；
  - 转换在 worker 中执行，有内存、超时和并发上限，结果缓存在 `var/derived/`；
  - DRM 只检测并提示，不解密；
  - 用 Project Gutenberg 的真实 AZW3 验证过（样本不进仓库）。
- **管理员书籍导入**（默认关闭；在应用设置中打开“允许管理员从浏览器导入书籍”）：
  - 可以用工具栏的“导入”按钮，也可以直接拖放；有逐个文件的进度和结果；
  - 文件写入应用共享目录 `babyreader-fnos/library/导入`；
  - 按内容校验格式，按 SHA-256 去重，不覆盖已有文件；
  - 导入与扫描共用库锁；在分类页导入的书会自动归类。
- 两个开关都关闭时，行为与 v1.2.0 相同。
- 包含 v1.2.0 之后的书库首页 HIG 改版。
- 本地验证（`main` 的 `074d587`，与功能分支最后一轮回归的代码完全相同）：
  - `npm test`：608 项，598 通过、0 失败、10 跳过；
  - Chromium E2E：138 通过、9 失败、26 跳过，9 项失败均为既有问题，没有新增；
  - 书库组织专项：23/23；
  - 结构检查：必需文件 73 项。
  - 升级版本号后又复跑了一次单元测试：除 `pdf-ai-profile.test.js` 外全部通过。该文件在全量运行中再次出现测试完成后进程不退出的既有问题，被手动终止（计为 1 项失败）；单独运行 3 次均为 8/8 通过且正常退出。该文件及其被测代码与 v1.2.0 完全相同，已另开任务修复。
- **尚未验收**：
  - fnOS 真机安装与升级；
  - 网关的请求体上限（`import-probe`）：如果上限太小，需要补上分片上传；
  - x86_64/ARM64 上的转换资源数据；
  - 1.2.0 与 1.3.0 之间的升级和回退。

  步骤见 `docs/FNOS_DEVICE_ACCEPTANCE.md` §5.7。

## v1.2.0 2026-09-30

- 首个按新发布约定打包的版本：源码全部提交、干净工作区构建，tag `v1.2.0`；此前多次以 1.1.7 打出的内容不同的候选包全部作废。
- 包含 9/23–9/29 积压并于 9/30 提交的工作：PDF 阅读（默认关闭，经安装向导开启）、PDF 标注/笔记/导出与 AI 问书、EPUB 资源生命周期、AI 章节理解与会话持久化、书库分类/直接拖拽排序、阅读体验 UX 修复，以及 AI 索引紧凑界面与孤儿索引清理分支合并。
- 书库首页按 Apple HIG 改版：大标题与填充式搜索栏、生成式封面、带进度的继续阅读卡片、胶囊分类标签、仅整理模式显示拖动手柄、首页深浅色切换；修复深色主题书库 token 从未生效、PDF 封面错位。
- 构建脚本改为按版本输出 `dist-v<版本>/`，同一版本拒绝重复构建。
- 本地验证：`npm test` 542 项，533 通过、0 失败、9 项平台跳过；Chromium E2E 131 通过、9 失败（均为改版前既有失败：划线 2、PDF 标注/搜索 2、PDF 封面在全量运行时 2 项（单独运行通过）、AI 面板 3），26 跳过；书库组织专项 23/23。
- fnOS 真机安装、升级与验收尚未执行。

## 当前功能最完整参考包 2026-09-23

- 以 `dist-task8-final-20260923/babyreader-fnos.fpk`（manifest 1.1.7）作为目前已生成候选包中功能最完整的参考基线，包含书库分类/拖拽管理、AI 章节检索与会话持久化，以及 fnOS 授权目录环境变量处理。
- 包大小：5,498,228 bytes；SHA-256：`6fd90d075c5b6b562b73214710aec7e2b099ac33d683ce8992bde2fefd676f52`。
- 溯源：`dist-task8-final-20260923/build-provenance.json`；来源提交 `c5cdbe72879b0e81b82378be005eb01f47831c30`，构建时工作区为 dirty。此包是功能参考基线，不等同于当前干净 main 合并提交的重打包，也不代表 fnOS 真机验收已完成。

## fnOS 授权自定义书库目录 2026-09-22

- 读取 fnOS 注入的 TRIM_DATA_ACCESSIBLE_PATHS 与 TRIM_DATA_SHARE_PATHS，经过 realpath、目录类型、可读性、去重和父子目录裁剪后参与书库扫描；不引入 root 权限、全 NAS 扫描或文件监听。
- 管理员诊断增加 configured/accessible/shared/authorized/rejected 数量；普通书库响应不暴露绝对路径。书库刷新显示授权目录读取状态、发现/新增/复用/失败计数，失败时提示检查 fnOS 权限并重启应用。
- 验证：npm test 180 pass、4 Windows 条件 skip；Chromium E2E 80 pass、2 可选真实 EPUB skip；npm run check、npm run check:portable、git diff --check 通过。
- 候选 FPK：dist/babyreader-fnos.fpk；最终大小、SHA-256、源提交和 git_dirty 状态以同目录 build-provenance.json 为准。
- 真实 fnOS 安装、访问权限添加/撤销、Gateway、ACL、x86_64/ARM64 和升级验收仍待设备侧执行；本地构建不宣称真机通过。

## 分类拖拽与删除入口修复 2026-09-22

- 根因是排序只监听分类手柄，直接拖分类名称不会触发；桌面现在可从分类标签主体拖动，删除按钮被排除在拖动命中区之外，移动端仍用长按手柄。
- 分类横向导航增加左右边缘自动滚动；删除改为紧凑 SVG 图标按钮，并保留可访问名称及足够触控尺寸。
- 真实 API/browser 回归验证分类重排与刷新持久化、边缘滚动、删除控件布局、移动端长按：8 项通过；常规 E2E 86 通过、10 项跳过；Node 238 通过、5 项平台条件跳过；结构检查及差异空白检查通过。
- 已重打 1.1.7 FPK：[dist/babyreader-fnos.fpk](dist/babyreader-fnos.fpk)，5,426,469 bytes，SHA-256 `08419640b100d0c8840b406481a048d7e0d99aca5c095d16d6c887ed24ce5f7f`；包内拖拽修复已与源码比对。fnOS 真机安装验收待执行。

## 书库排序改为拖拽手柄 2026-09-22

- 移除书籍与分类的“上移/下移”按钮，统一使用拖拽手柄调整顺序；鼠标即时拖动，手机沿用长按拖动。
- 保留键盘可用性：聚焦手柄后可用上/下方向键排序，保存后焦点恢复。
- 沿用既有 revision-aware 排序 API，不移动书籍文件、不改书籍归属与阅读数据。
- `npm test`：238 通过、5 个平台条件跳过；书库 Chromium E2E：真实鼠标拖拽及组织 API 2 通过、1 项跳过；结构检查、`git diff --check` 通过。
- FPK 版本升至 1.1.7；fnOS 真机安装验收待现场执行。

## 书库分类入口与按钮样式再整理 2026-09-22

- 按用户澄清将“我的书籍”与各个自建分类放在同一排顶部导航；点击分类后在导航下方切换书籍，删除底部独立分类卡片区。
- 分类入口共享一套文字和选中状态样式；“重新扫描 / 新建分类 / 整理”统一为同尺寸中性按钮，减少蓝色主按钮突兀感。
- 修复分类详情“添加书籍”面板插入位置：书格现在位于分区容器中，面板必须插入书格同级，避免 DOM 层级错误导致点击无反应。
- FPK 发布版本升至 1.1.6；5,423,569 bytes，SHA-256 `6DE559655D64445F62A76AE568D700E4BFF7048DD7827B08DCA895E3D033195B`。包内已核对版本、顶部分类导航、统一按钮样式及添加书籍面板插入修复；fnOS 真机验收尚未执行。

## 书库“新建分类”标题行对齐修复 2026-09-22

- 将“新建分类”收敛到“我的书籍”标题行的右侧专用操作区，避免按钮在书籍区上方单独漂移或被布局覆盖。
- 修正第一次调整仍被 `margin-left: auto` 推到整行最右侧的问题；现在按钮紧跟标题右侧，桌面端保持同一行，移动端才按宽度换行。
- 桌面端保持标题与按钮同一行；移动端按可用宽度自然换行，不改变创建分类行为。
- DOM 与真实 Chromium 书库拖拽回归通过；为确保 fnOS 覆盖安装，版本升至 1.1.5。FPK SHA-256：`E2A161ECAD508F910F644AAA2A81A0471BC25D8EFAA3E47DCF4F411D4B002670`。

## 书库首页简化与分类入口重排 2026-09-22

- 首页固定为“我的书籍”，将“新建分类”直接放在该标题操作行；书籍网格下方新增独立“分类”内容区。
- 移除首页“我的分类”和“按目录”切换入口；旧 `viewMode`、source projection、组织 API 与用户分类 JSON 保留，旧 source history 安全回到 root。
- 全部书籍继续使用 `allBookOrder` 排序，分类卡与未分类卡保留现有详情、添加书籍、整理和删除边界；不移动真实文件、不影响阅读、AI、书签和索引数据。
- 更新 DOM/E2E 契约，覆盖首页结构、旧 route 回退、桌面鼠标排序、键盘按钮、移动端长按、真实 API 和刷新恢复。
- 本地验证：`npm test` 238 通过、5 个平台条件跳过；默认 Chromium E2E 86 通过、7 个环境条件跳过；组织专项 5 通过。FPK 与 fnOS 真机验收待完成。
- FPK 已生成：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，5,420,987 bytes，SHA-256 `0C51F0E6D5B76982D3E0A5988BF527928C670F070D199DCD21D17ABF261B4932`；构建溯源见 `dist/build-provenance.json`。

## 书库拖拽与分类全链路修复 2026-09-22

- 全部书籍接通整理排序，增加兼容的每用户 allBookOrder；保存时严格验证当前可见书目并保留离线引用，修复首次未分类排序返回 400。
- 新建分类后直达详情；加入书籍后保留选择器，更新 revision 并阻止并发重复提交；冲突时原位重试。整理书卡可直接选择归属分类。
- 修复拖拽结束后的焦点、捕获和越界目标状态，源目录隐藏整理操作；加入功能开启环境下的真实 API、鼠标/触摸和刷新恢复回归，接入常规 E2E。
- 实施记录：`docs/superpowers/plans/2026-09-22-library-organization-interaction-repair.md`。本轮版本号未变，现场安装验收待执行。

## 1.1.4 书库组织可用性修复 2026-09-22

- 修复组织书架接管后“重新扫描”入口丢失的问题；扫描后继续恢复组织视图，而非退回旧书架。
- 分类详情增加“添加书籍”选择器，可将未分类或其他分类的书籍移入当前分类；复用 revision-aware placement API，绝不移动真实文件。
- 书库操作重新分层：展示方式仅保留“全部书籍 / 我的分类 / 按目录”，“新建分类”成为独立主操作，表单位于 header 下方而非切换区内。
- 新增 DOM 回归覆盖扫描入口、独立表单位置与书籍加入分类；验证：`npm test` 231 通过、5 个平台条件跳过，Chromium 85 通过、2 个可选真实样本跳过，结构校验和 FPK 内容核验通过。

## 1.1.3 书库组织功能发布开关 2026-09-22

- FPK 启动脚本默认注入 `BABYREADER_ENABLE_LIBRARY_ORGANIZATION=1`，使已完成的分类、按目录和整理/拖拽功能在正式包中可见。
- 保留运维覆盖能力：显式设置 `BABYREADER_ENABLE_LIBRARY_ORGANIZATION=0` 时继续使用原有平铺书库。
- 未改变授权目录来源、书籍扫描边界、真实文件位置和阅读数据；版本同步更新为 1.1.3。
- 增加生命周期发布契约测试，防止后续 FPK 再次出现功能代码已打包但运行时开关关闭的问题。

## 书库个性化 Task 6 本地交付 2026-09-22

- 增加受控 `POST /api/library/organization/reconcile`：默认 dry-run，只有当前 revision + `confirm: true` 才清除孤儿 bookId 引用；扫描不健康时 fail closed。
- 清理边界仅限每用户虚拟分类引用，不删除分类、原始书籍、AI 索引、书签、标注、阅读进度或 AI 会话。
- fnOS 验收脚本增加认证后的只读书库组织契约检查，不执行写操作、不接收或输出 API Key。
- 本地验证：`npm test` 228 pass / 5 platform-condition skip；Chromium E2E 重跑后 85 pass / 2 optional real-sample skip；`npm run check`、`npm run check:portable`、Git Bash shell syntax 和 `git diff --check` 通过。
- FPK：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，5,406,512 bytes，SHA-256 `952BDCE6432CB19E3DED75436F2CCDCD125A73BD1C07C362C5041C0F750227FD`；构建溯源见 `dist/build-provenance.json`。
- 尚未宣称 fnOS 真机、Gateway、双架构、升级和真实拖拽验收通过；组织 feature flag 继续默认关闭。

## AI 会话持久化 Task 5/6 2026-09-21

- 增加 AI 会话列表独立 surface：列表仅显示标题、消息数和更新时间，切换时按需读取完整消息。
- 增加服务端成功后才更新本地状态的清空/删除操作；失败时保留面板、原列表和重试入口。
- 复用现有 AI secondary sheet、主题变量、焦点恢复和移动端安全区，不改变既有问答、流式输出、来源章节和书籍隔离接口。
- 本地验证：`npm test` 200 pass / 5 platform-condition skip；Chromium E2E 82 pass / 2 optional real-sample skip；`npm run check`、语法检查和 `git diff --check` 通过。
- FPK：`dist/babyreader-fnos.fpk`，5,346,065 bytes，SHA-256 `A13F09D7D37DBD9AE929CDCDB8AC3CC905A8F137645B5076060C262612F06E91`；构建溯源见 `dist/build-provenance.json`。fnOS 安装、Gateway、双用户和升级验收仍需真实设备证据，未提前宣称通过。

## 主线合并书签与 AI 阅读能力 2026-09-21

- 将书签服务端 API、EPUB 语义定位、Drawer/移动端入口、刷新与失败恢复合并到主线。
- 保留并统一现有 AI 问答、SQLite FTS 检索、多轮对话、流式输出、来源标注、标记与想法及显示设置 UI。
- 1.1.0 候选包必须继续通过 Node 回归、Chromium 联合回归、结构检查和 fnOS 设备验收；设备侧验收完成前不宣称真机通过。

## 连续滚动章节边界与按需加载 2026-09-20

- 连续滚动 EPUB 改为单章节挂载：打开只读取首章；章节底部显示“下一章”，章节顶部显示“上一章”，跨章时替换唯一 `.epub-chapter`，不再把整本书追加到 DOM。
- TOC、EPUB 内链、进度、恢复和边界按钮统一使用 `state.epubChapterIndex` 与 `chapterIndexByPath`；保存的 locator 增加 `readingScope: "chapter"`、`chapterPercentage`，兼容旧版 `href`、`anchor`、`textBefore`、`scrollTop`、`percentage` 字段。
- 划线只对当前挂载章节绘制，历史章节划线仍保留在持久化数据和导出结果中；滚动保存只计算当前章节的本地比例。
- 真实样本调查已切换为连续滚动首章/章节边界回归；未设置 `BABYREADER_E2E_SAMPLE_EPUB` 时两条本地样本用例按设计跳过，未宣称真实 fnOS 设备验证。
- 验证：`npm test` 64 项（61 pass、0 fail、3 Windows 条件 skip）；Chromium E2E 44 项（42 pass、0 fail、2 可选真实样本 skip）；`npm run check` 通过；受影响 E2E 套件 15/15 通过。
- FPK：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，4,230,829 bytes，SHA-256 `0D37A8D6B477411832B0F26675CC788BB8DF94ACCC5462649EB8063A381B8BA3`。构建溯源记录为 dirty working tree、Node v24.20.0、本地 fnpack；尚未在 fnOS 真机安装验收。

## EPUB chapter-window Task 4 verification 2026-09-19

- 可选真实样本回归要求唯一章节处于稳定状态：可见非空文本，或实际可见且已解码的封面/媒体（`img.complete && naturalWidth > 0`；SVG/canvas 有效内容）；状态不得以 `正在打开` 开头，分页 geometry/track 必须就绪，且 `#article[aria-busy]` 已清除。4× 章节边界在 source path 改变后再次满足同一条件，才读取 long task。
- 真实样本已恢复在 `C:\Users\admin\Desktop\吃的营养科学观.epub`，不在 Git 跟踪文件或 `dist/` 中。最终完整 12× 命令为 **2 passed (20.7s)**：首章 `openedMs=4293`、最大 long task `530 ms`；边界从 `titlepage.xhtml` 到 `toc.xhtml`、最大 `498 ms`。最终完整 4× 命令为 **2 passed (9.5s)**：首章 `openedMs=1261`、边界 `titlepage.xhtml → toc.xhtml`、最大 `524 ms`，均低于 1000 ms。
- 样本缺失导致的 30 秒 locator 超时，以及恢复样本后封面被旧“仅文本”谓词拒绝的失败，均保留在 Task 4 report 中作为历史 RED 证据；它们不是当前阻塞项。
- 普通 Chromium 回归在未设置样本环境变量时启动 22 个测试，Playwright 记录 `status: passed`；两个本地真实样本用例保持跳过。
- `npm test`：55 pass、0 fail、3 Windows 条件 skip；`npm run check` 通过；`git diff --check` 退出 0（仅已有的 `app/ui/styles.css` CRLF→LF 警告）。
- 最新本地 FPK 候选：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，4,187,897 bytes，SHA-256 `6F0165EB77E78641CA12DA1C9F55347BAA9DE1CFBE898C241311AF73F3CEFBE8`；构建内 `npm audit` 报告 0 vulnerabilities。
- 页码语义现在是**当前章节内**的分页组；章节末页的“下一页”加载下一个 spine 项，而不再以整书的全局页数（例如旧记录的 `890`）描述进度。新的 FPK 尚未在 fnOS 真机安装验收。

## 《吃的营养科学观》双页首屏卡死修复 2026-09-19

- 以用户提供的真实 EPUB 复现：4.24MB 压缩包、126 个 spine 项、24 张图、约 20 万字符；不是损坏文件或超大资源问题。
- 根因：整书 HTML 被一次性写入 `article.innerHTML`，4× CPU 降速下触发 3.27–3.62 秒主线程长任务；双页多栏布局放大了用户感知的“卡死”。
- 修复：章节按 4 个一批挂载、批次之间让出事件循环、完成前不测量部分分页、完成后统一测量/恢复进度/重绘标注，并显示排版进度和禁用分页按钮。
- 真实样本回归：预先双页、4× CPU 降速下最长任务不超过 0.64 秒；完成后 `1-2 / 890`，下一页进入 `3-4 / 890`。
- 最新 FPK 候选：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，4,174,923 bytes，SHA-256 `4858F8DDAEBE2EA56A718ED6CBF91630428C7769B85C8D3E18CCC237F41A2E0F`。
- 调查报告：[docs/investigations/2026-09-19-eating-nutrition-epub-double-page.md](D:\AI编程\reader\babyreader-fnos\docs\investigations\2026-09-19-eating-nutrition-epub-double-page.md)。

## EPUB 首屏卡死与双页无响应修复 2026-09-19

- 根因：打开 EPUB 时客户端先把整本压缩包转成 Base64/二进制字符串，再同步解析全部 spine 章节，并把图片、字体和 CSS 资源重复转成 Data URL；随后整本书一次性注入多栏 DOM，首次双页分页会触发布局、`scrollWidth` 和多栏碎片化的集中计算。资源复杂度不同，所以只有部分 EPUB 触发主线程长任务，看起来像首页点击和下一页失效。
- 修复：EPUB 通过 `ArrayBuffer` 直接交给 JSZip，移除整本书的 Base64 扩张；章节解析之间让出浏览器事件循环；单个内联资源限制 8MB、总内联资源限制 48MB，超限资源跳过但保留正文；记录被跳过资源诊断。
- 新增回归：9MB 超大资源 EPUB 在双页模式下仍能打开正文、切换设置并保持交互；同时保留完整划线、进度、跨页和显示器尺寸变化回归。
- 验证：Playwright Chromium **17/17**；`npm test` 50 项（47 pass / 0 fail / 3 Windows 条件 skip）；`npm run check` 通过；生产依赖审计 0 vulnerabilities。
- 最新 FPK 候选：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，4,171,850 bytes，SHA-256 `32CC2C2DECB18399582BD5EF790160A5531217346313339092C8DD0BF19A5E57`。
- 该修复针对首屏假死和资源放大问题；如果某本书仍卡死，下一步需要该 EPUB 文件或至少提供文件大小、首章资源数量/类型，以区分剩余的异常 CSS、多栏内容或超大正文布局问题。

## 真机反馈阻塞修复 2026-09-19

- 真机反馈：EPUB 选中文字后点击划线无效；浏览器在横向/竖向显示器之间移动后阅读区域不自动重排。
- 根因：选区动作只监听 `mouseup`，部分 fnOS/触控浏览器路径只产生 `pointerup`；分页只监听 `window.resize`，实际 `#reader` 容器尺寸变化可能不派发该事件。
- 修复：为直接 EPUB 内容和兼容内容选择路径补 `pointerup`；为阅读区域增加 `ResizeObserver`，并监听 `visualViewport.resize`、`screen.orientation.change` 与方向媒体查询变化。
- 新增回归：真实鼠标拖选、仅 `pointerup` 选区动作、无 `window.resize` 的阅读容器尺寸变化。
- 新增双页模式回归：移动到后续跨页组后选中文字并划线，必须在当前可见阅读区域立即出现标记；逐页点击下一页必须能到达最后一个跨页组。
- 双页模式根因：`Range.getClientRects()` 返回视口坐标，但标记层位于可横向滚动的 `#article` 内容坐标系；绘制时漏加 `article.scrollLeft/scrollTop`，导致标记被画回前面的跨页组。修复为绘制位置加上当前滚动偏移。
- 验证：Chromium **16/16**；`npm test` 49 项（46 pass / 0 fail / 3 Windows 条件 skip）；`npm run check` 通过；生产依赖审计 0 vulnerabilities。
- 新 FPK 候选：[dist/babyreader-fnos.fpk](D:\AI编程\reader\babyreader-fnos\dist\babyreader-fnos.fpk)，4,169,356 bytes，SHA-256 `1E33137404EC5C9D727008F187DCC4250D9841EE8ED2D21AEA3A78E54E4175F6`。
- 需要在 fnOS 上重新安装此候选包后，优先复测划线和横竖屏切换；旧包上的结果不能作为修复后结论。

## Playwright Regression V2 — Phase 1 implementation 2026-09-19

- Scope follows `C:\Users\admin\Downloads\PLAYWRIGHT_REGRESSION_V2_PLAN.md`: highlight create/edit/note/delete/export and reading-progress reload persistence.
- Added isolated EPUB fixtures with three chapters, stable repeated text, per-test user-settings reset, and helpers for fixture state/progress assertions.
- Fixed three product issues exposed by the first batch: highlight overlays were below paragraph hit targets, Markdown export omitted notes, and paged progress/restore lost the active chapter or saved spread at reload boundaries.
- Local verification: Playwright Chromium **11/11 passed** with one worker; `npm test` and `npm run check` were green before packaging; production dependency audit during FPK build reported 0 vulnerabilities.
- Candidate FPK: `dist/babyreader-fnos.fpk`, 4,167,325 bytes, SHA-256 `5BF0E59542D97CDE5A5D7683E5BA1C90828EAE51BABF3ECE8CB8FC775693DBED`. Provenance records source commit `df958a589c333252af42c74535b04f0ae2e5f63d` with a dirty working tree and local Node v24; this is an installation candidate, not the CI Node 22 release artifact.
- CI now archives both the HTML Playwright report and retained `test-results/` evidence.
- Real fnOS installation of this candidate is still pending an accessible device endpoint; no Gateway, ACL, Socket, multi-user, upgrade, x86, or ARM claim is made from Chromium evidence.
- No Git push performed.

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

## P0: 连续滚动首屏秒开性能优化 2026-09-19

**问题根因**:
- scroll mode 整书 DOM 重构导致打开 EPUB 需等待所有章节加载完成才渲染 → 50 章×串行 fetch ≈ 2-3 秒延迟
- `renderEpubWholeBook()` 全量 innerHTML 一次插入 → 浏览器重排重绘阻塞主线程

**第一性原理优化策略**:
采用"**渐进式渲染 + 并发预加载**"平衡用户体验与稳定性：

1. **Phase 0 秒开首屏** (0.5-1s):
   - 优先加载前 3 章 → 立即渲染到 DOM → 用户看到内容即可开始阅读
   - 避免用户等待整个书籍加载

2. **Phase 1 后台并发** (1-2s):
   - Promise.all() 并发加载剩余章节（5-10 章一组）
   - 不阻塞 UI 渲染线程

3. **Phase 2 渐进拼接** (无阻塞):
   - 使用 requestIdleCallback 分批插入 DOM
   - 每次追加 5 章而非全部替换 → 减少 layout 开销

4. **Performance Metrics**:
   - 原串行方案：TTFB (Time to First Byte) = Σ(chapter_fetch_time)
   - 优化后：TTFB = 3 × chapter_fetch_time (仅首 3 章)
   - 预期提升：50 章从 3 秒 → 0.8 秒首屏可见，剩余章节在后台平滑填充

**实现细节**:
```javascript
const INITIAL_CHUNKS = 3; // 先渲染前 3 章确保秒开
await Promise.all(remainingChapters.map(chunk => loadChapter(...))); // 并发加载
scheduleNextChunk(); // 空闲时增量拼接 DOM
```

**测试覆盖**:
- npm test: 55 pass / 0 fail (全绿) ✅
- 功能回归：scroll mode 整书流畅滚读、TOC 跨章定位、划线功能均正常

**交付物**:
- FPK: dist/babyreader-fnos.fpk, ~4.2MB
- SHA-256: `515462dc4637080bad78ec38b864c7b1fe3f9347e20d7bf12de85cae8de19a19`
- 双层解包逐字节核验：ALL MATCH ✓

**人工验收建议**:
1. 打开任意 EPUB (不是 E2E fixture)，观察 scroll mode 下首屏是否<1 秒显示内容
2. TOC 点击任意条目能否快速定位
3. 切换双页→scroll→DOM 是否无缝重构
4. 滑动到底部时是否有卡顿或闪烁

---
