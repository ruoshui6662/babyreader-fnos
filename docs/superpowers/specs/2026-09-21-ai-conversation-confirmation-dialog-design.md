# AI 会话破坏性操作确认弹窗设计

## 目标

以应用内、主题同步的确认弹窗替换 AI 会话“清空”和“删除”操作所使用的浏览器原生 `window.confirm()`，保留现有服务端 API、会话持久化、检索和阅读器行为。

## 用户意图与成功标准

用户在会话列表中执行清空或删除时，应看到与 BabyReader 现有 Apple 风格一致的确认界面，而不是带浏览器地址的原生弹窗。确认前不得改变会话或发起网络请求；取消必须无副作用；确认后的失败不得让列表与服务端状态分叉。

成功标准：

- 浅色、深色和护眼主题均使用现有 AI 主题变量；
- 确认卡片清楚区分“清空消息”和“删除会话”；
- 键盘、触摸和鼠标都能取消或确认；
- 焦点不会落到被遮住的会话列表或阅读页；
- 现有清空/删除成功、失败、重试和当前会话切换行为保持不变；
- 本轮不修改服务端、会话文件、SQLite FTS、AI 回答、索引管理器或阅读进度。

## 审查结论

当前 `app/ui/reader/ai.js` 的 `confirmAiConversationAction(message)` 调用 `window.confirm()`；`clearAiConversationItem()` 与 `deleteAiConversationItem()` 均在调用现有 API 前依赖该函数。浏览器原生确认框显示站点地址，不能继承 `app/ui/styles.css` 中的 `--color-*` 主题变量、圆角、字体和材质，也不能由应用控制焦点恢复或操作中的禁用状态。

AI 会话列表已经是 `#aiModal` 内的 `#aiConversationsView` secondary sheet。现有 `#aiConfigView` 使用 `.ai-config-sheet`、`.ai-config-sheet-backdrop`、`.ai-config-sheet-card` 建立了可复用的局部遮罩与卡片规范。确认弹窗应复用这套局部 surface，而不是接入 `readerSurfaceController`：后者管理阅读器 Drawer，不能安全替代一个已打开 AI 弹窗内部的二级确认。

AI 索引管理器也使用原生确认框，但它是独立的管理员 surface。本设计明确不迁移其确认流程，避免把一次会话 UI 优化扩展为跨模块重构。

## 范围与非目标

范围：

- 会话列表行内“清空”“删除”动作；
- 一个只在 AI 弹窗内部可见的确认 `alertdialog`；
- 本地状态、焦点、Escape、遮罩取消、操作中禁用与失败恢复；
- DOM 与 Chromium 回归测试。

非目标：

- 不新增或修改 HTTP API；
- 不改变 `clearAiConversation`、`deleteAiConversation` 的服务端权限校验；
- 不改变确认后的会话选择规则；
- 不把原生确认框从 AI 索引管理器、书签或其他功能迁移到新组件；
- 不引入 UI 框架、第三方依赖或全局 modal 管理器。

## 交互设计

确认弹窗是 `#aiModal` 内 `#aiConversationsView` 的同级 secondary sheet，层级高于会话列表，低于浏览器页面以外的任何层。打开确认弹窗时，会话列表仍保留视觉上下文，但会被局部遮罩和 `aria-hidden` 隔离。

### 清空

- 标题：`清空此会话？`
- 说明：`将删除“{title}”中的 {messageCount} 条消息。此操作无法撤销。`
- 次要动作：`取消`
- 破坏性动作：`清空会话`

清空成功后，弹窗关闭，现有当前会话清空流程继续：当前回答区域被重置、该行消息数变为 `0 条消息`、会话仍保留。清空失败后，弹窗关闭、列表保持不变，并通过现有 `#aiConversationStatus` 显示安全错误文本。

### 删除

- 标题：`删除此会话？`
- 说明：`将删除“{title}”及其中全部消息。此操作无法恢复。`
- 次要动作：`取消`
- 破坏性动作：`删除会话`

删除成功后，弹窗关闭，现有列表更新逻辑继续执行：删除非当前会话只移除该行；删除当前会话时加载下一条会话，或在无剩余会话时显示空状态。删除失败后保留原列表并显示现有错误状态。

### 取消与输入

- 初始焦点放在“取消”，避免 Enter 直接执行破坏性操作；
- Escape、局部遮罩点击、关闭按钮与“取消”均只关闭确认弹窗；
- 关闭后焦点恢复到触发该操作的会话行按钮；
- Tab 与 Shift+Tab 在确认卡片的可聚焦控件之间循环；
- 确认提交期间，取消、关闭、遮罩、会话行操作和确认按钮均不可重复触发；
- 不调用 `window.confirm()`，因此 Playwright 不再需要接受浏览器 `dialog`。

## 前端接口与状态边界

`app/ui/reader/ai.js` 维护一个只含展示与执行意图的本地确认状态：

```js
{
  action: 'clear' | 'delete',
  conversationId: string,
  title: string,
  messageCount: number,
  trigger: HTMLElement
}
```

建议接口：

```js
requestAiConversationConfirmation(action, conversationId, trigger)
closeAiConversationConfirmation({ restoreFocus = true })
executeAiConversationConfirmation()
performClearAiConversationItem(conversationId)
performDeleteAiConversationItem(conversationId)
```

`requestAiConversationConfirmation` 仅验证当前内存中的会话摘要、渲染文案并显示弹窗。`executeAiConversationConfirmation` 是唯一可调用 `perform*` 函数的入口。`perform*` 函数保留当前 API 调用、忙碌状态、成功更新和失败提示；它们不再读取或调用浏览器原生确认框。

确认状态必须在关闭 AI 弹窗、切换书籍、恢复失败和成功执行后清除。异步回调返回时必须确认 `state.currentBookId` 仍与请求时一致，沿用现有会话操作的用户/书籍隔离边界。

## DOM 与样式契约

在 `#aiModal .ai-modal-body` 中新增与 `#aiConversationsView` 同级的 `#aiConversationConfirmView`：

```html
<section id="aiConversationConfirmView" class="ai-config-sheet ai-conversation-confirm-sheet"
  hidden role="alertdialog" aria-modal="true"
  aria-labelledby="aiConversationConfirmTitle"
  aria-describedby="aiConversationConfirmDescription">
```

该节点含局部遮罩、标题、说明、取消按钮和单个破坏性确认按钮。所有动态内容通过 `textContent` 设置；标题仅来自已在安全摘要中渲染过的会话标题，不插入 HTML。

样式以 `.ai-config-sheet` 的定位、材质、边框、圆角和移动端安全区为基础，新增限定的 `.ai-conversation-confirm-*` 选择器：

- 确认卡片最大宽度约 360px；
- 破坏性按钮使用现有 `--color-destructive`，取消使用现有 `.ai-secondary-button`；
- 深色主题不得固定白色背景或黑色文字；
- `:focus-visible` 使用现有 `--color-focus`；
- 移动端卡片不超出 `env(safe-area-inset-bottom)`，且按钮高度不低于既有触控尺寸；
- 不修改 `.ai-config-sheet` 的通用行为，以免影响 AI 设置与会话列表。

## 错误处理与安全边界

- 打开确认框时不访问服务端；
- 取消、Escape 和遮罩操作不会调用 `browserHost.clearAiConversation` 或 `browserHost.deleteAiConversation`；
- 会话摘要在确认前重新从内存查找；找不到目标会话时关闭确认框并不执行操作；
- 请求期间锁定确认卡片和会话列表，防止双击或两项并发删除；
- API 成功后才改变 `_aiConversationList`、当前回答和当前会话标识；
- API 失败保持服务端前的会话摘要，复用已有错误状态，且不会产生新的会话、索引或阅读数据写入。

## 验收与测试策略

DOM 回归应覆盖：

1. 点击“清空”或“删除”显示应用内 `alertdialog`，且不会调用 `window.confirm`。
2. 弹窗中的标题、摘要、消息数和破坏性按钮与目标操作一致，不含消息正文。
3. 取消、Escape、遮罩点击均不调用 API，关闭后焦点回到原行按钮。
4. 确认前 API 调用数为零；确认一次只发出一次正确的清空或删除请求。
5. 成功后保留现有清空/删除语义；失败后列表和当前会话不丢失，并显示既有错误状态。
6. 关闭 AI 弹窗或切换书籍会关闭确认框并清空其临时状态。

Chromium E2E 应覆盖：

1. 不出现浏览器原生 `dialog` 事件；
2. 会话列表、确认卡片、取消、确认、成功列表更新与错误恢复；
3. 键盘 Escape、Tab 焦点循环和触控尺寸；
4. 浅色、深色、护眼主题中确认卡片使用应用主题变量且正文可读；
5. 小视口中确认卡片和两个按钮均在安全区内可见、可点击。

完整验收继续使用 `npm test`、`npm run check`、`npm run test:e2e`、`git diff --check`；不需要新增 fnOS 服务端命令或数据迁移。
