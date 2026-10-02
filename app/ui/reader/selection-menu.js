/* 枕书 UI module: reader/selection-menu */

'use strict';

let _selectionMenu = null;
let _activeSelectionSession = null;
let _selectionMenuBound = false;
let _annotationMenu = null;
let _activeAnnotationId = null;
let _selectionDismissedAt = 0;
const ANNOTATION_STYLE_KEY = 'zhenshu-annotation-style';

function isPhoneReader() {
  return typeof isMobileReaderSurface === 'function' && isMobileReaderSurface();
}

// The style a one-tap “划线” uses: the last one chosen in the bubble.
function preferredAnnotationStyle() {
  try {
    const saved = localStorage.getItem(ANNOTATION_STYLE_KEY);
    if (['marker', 'wave', 'line'].includes(saved)) return saved;
  } catch {}
  return 'marker';
}

function rememberAnnotationStyle(style) {
  try { localStorage.setItem(ANNOTATION_STYLE_KEY, style); } catch {}
}

// A tap that only dismissed the selection or a bubble must not also toggle
// the reading chrome or turn the page.
function selectionMenuRecentlyDismissed() {
  return Date.now() - _selectionDismissedAt < 450;
}

const selectionActions = Object.freeze({
  copy: async () => {
    const session = _activeSelectionSession;
    if (!session) return false;
    const copied = await copySelectionText(session.text);
    closeSelectionMenu({ clearSelection: copied });
    return copied;
  },
  highlight: () => createSelectionAnnotation(preferredAnnotationStyle()),
  marker: () => createSelectionAnnotation('marker'),
  wave: () => createSelectionAnnotation('wave'),
  line: () => createSelectionAnnotation('line'),
  thought: () => {
    const session = _activeSelectionSession;
    if (typeof openThoughtComposer === 'function' && openThoughtComposer(session)) {
      closeSelectionMenu({ clearSelection: false });
      return true;
    }
    showHighlightHint('写想法将在下一阶段开放');
    return false;
  },
  ai: () => {
    const session = _activeSelectionSession;
    closeSelectionMenu({ clearSelection: false });
    if (typeof openAiForSelection === 'function') return openAiForSelection(session);
    showHighlightHint('问 AI 将在下一阶段开放');
    return false;
  },
  // Find the selected words elsewhere in the book (WeChat Reading / Apple Books).
  search: () => {
    const query = normalizedSelectionText(_activeSelectionSession?.text).slice(0, 80);
    closeSelectionMenu({ clearSelection: false });
    const form = document.getElementById('readerSearchForm');
    const input = document.getElementById('readerSearchQuery');
    if (!query || !form || !input || typeof openReaderPanel !== 'function') return false;
    openReaderPanel('search');
    input.value = query;
    form.requestSubmit();
    return true;
  }
});

function normalizedSelectionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function selectionAnchorForRange(range) {
  try {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) {
      return {
        left: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom
      };
    }
  } catch {
    // A detached or synthetic range can lack layout metrics. The viewport
    // fallback keeps the menu usable in tests and during renderer transitions.
  }
  return { left: window.innerWidth / 2, top: 80, bottom: 100 };
}

function captureSelectionSession(selection = window.getSelection?.()) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (state.contentType === 'pdf') {
    return currentAnnotationAdapter('pdf')?.captureSelection(selection) || null;
  }

  const article = document.getElementById('article');
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  const chapter = commonElement?.closest?.('.epub-chapter');
  if (!article || !commonElement || !article.contains(commonElement) || !chapter) return null;

  const rawText = normalizedSelectionText(selection.toString());
  if (!rawText || rawText.length > 4000) return null;

  const locator = serializeDomRange(range, rawText);
  if (!locator) return null;

  return Object.freeze({
    text: rawText,
    range: range.cloneRange(),
    locator,
    anchor: selectionAnchorForRange(range),
    createdAt: Date.now()
  });
}

function ensureSelectionMenu() {
  if (_selectionMenu) return _selectionMenu;

  const menu = document.createElement('div');
  menu.id = 'selectionMenu';
  menu.className = 'selection-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', '选中文本操作');

  // “划线” is the phone's one-tap action; desktops show the three styles.
  const items = [
    ['highlight', '划线'],
    ['copy', '复制'],
    ['marker', '马克笔'],
    ['wave', '波浪线'],
    ['line', '直线'],
    ['thought', '写想法'],
    ['search', '搜索'],
    ['ai', '问 AI']
  ];
  for (const [action, label] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.selectionAction = action;
    button.setAttribute('aria-label', label);
    button.textContent = label;
    menu.appendChild(button);
  }
  const palette = document.createElement('span');
  palette.className = 'selection-color-palette';
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', '新标记颜色');
  for (const [color, label] of [['yellow', '黄色'], ['green', '绿色'], ['blue', '蓝色'], ['pink', '粉色']]) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.dataset.selectionColor = color;
    swatch.setAttribute('aria-label', label);
    swatch.title = label;
    swatch.setAttribute('aria-pressed', String(color === state.highlightColor));
    swatch.addEventListener('pointerdown', (event) => event.preventDefault());
    swatch.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.highlightColor = color;
      document.body.dataset.highlightColor = color;
      palette.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === swatch)));
      syncSettingsPanel();
      persistUserSettings();
    });
    palette.appendChild(swatch);
  }
  menu.appendChild(palette);
  const hint = document.createElement('p');
  hint.className = 'selection-menu-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  hint.hidden = true;
  menu.appendChild(hint);

  menu.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-selection-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchSelectionAction(button.dataset.selectionAction);
  });
  document.body.appendChild(menu);
  _selectionMenu = menu;
  return menu;
}

// Desktop: above the selection. Phone: below it, clear of the system
// copy/share bar and the selection handles; above only when there is no room.
function placeFloatingMenu(menu, anchor) {
  const margin = 8;
  const menuWidth = menu.offsetWidth || 360;
  const menuHeight = menu.offsetHeight || 44;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const left = Math.max(margin, Math.min(window.innerWidth - menuWidth - margin, anchor.left - menuWidth / 2));
  let top;
  if (isPhoneReader()) {
    const below = anchor.bottom + 28;
    top = below + menuHeight <= viewportHeight - margin ? below : anchor.top - menuHeight - 40;
  } else {
    const above = anchor.top - menuHeight - 12;
    top = above >= margin ? above : anchor.bottom + 12;
  }
  top = Math.max(margin, Math.min(viewportHeight - menuHeight - margin, top));
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${top}px`;
}

function positionSelectionMenu(session) {
  placeFloatingMenu(ensureSelectionMenu(), session.menuAnchor || session.anchor);
}

// The selection moves with scrolling and resizing; follow it.
function liveSelectionAnchor(session) {
  if (session?.range) {
    const anchor = selectionAnchorForRange(session.range);
    if (anchor.top !== 80 || anchor.bottom !== 100) return anchor;
  }
  return session?.menuAnchor || session?.anchor || null;
}

function openSelectionMenu(session) {
  if (!session) return false;
  const menu = ensureSelectionMenu();
  _activeSelectionSession = session;
  const aiAction = menu.querySelector('[data-selection-action="ai"]');
  const hint = menu.querySelector('.selection-menu-hint');
  let unavailableReason = '';
  if (aiAction) {
    const pdfTargets = Array.isArray(session.targets) ? session.targets : [];
    const available = session.format !== 'pdf'
      || (pdfTargets.length === 1 && String(session.text || '').length <= 1200);
    if (session.format === 'pdf' && !available) {
      if (pdfTargets.length > 1) {
        unavailableReason = 'PDF 选区跨页，暂不能按选区提问；可打开 AI 面板按全书提问。';
      } else if (String(session.text || '').length > 1200) {
        unavailableReason = 'PDF 选区超过 1200 字，暂不能按选区提问；可打开 AI 面板按全书提问。';
      } else {
        unavailableReason = '此 PDF 选区暂不能用于提问；可打开 AI 面板按全书提问。';
      }
    }
    aiAction.hidden = !available;
    aiAction.setAttribute('aria-hidden', available ? 'false' : 'true');
  }
  if (hint) {
    hint.textContent = unavailableReason;
    hint.hidden = !unavailableReason;
  }
  menu.hidden = false;
  menu.querySelectorAll('[data-selection-color]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.selectionColor === state.highlightColor)));
  positionSelectionMenu(session);
  return true;
}

function pdfSelectionUnavailableMessage(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return '';
  let range;
  try { range = selection.getRangeAt(0); } catch { return ''; }
  const startNode = range.startContainer?.nodeType === Node.ELEMENT_NODE
    ? range.startContainer : range.startContainer?.parentElement;
  const endNode = range.endContainer?.nodeType === Node.ELEMENT_NODE
    ? range.endContainer : range.endContainer?.parentElement;
  const startLayer = startNode?.closest?.('.pdf-page-text-layer');
  const endLayer = endNode?.closest?.('.pdf-page-text-layer');
  if (!startLayer || !endLayer) return '';
  const text = normalizedSelectionText(selection.toString?.() || range.toString());
  if (text.length > 4000) return 'PDF 选区超过 4000 字，无法安全定位；请缩小选区后重试。';
  const firstPage = Number(startLayer.closest('.pdf-page')?.dataset.pageIndex);
  const lastPage = Number(endLayer.closest('.pdf-page')?.dataset.pageIndex);
  const maxPages = window.pdfAnnotationGeometry?.MAX_SELECTION_PAGES || 8;
  if (Number.isInteger(firstPage) && Number.isInteger(lastPage)
      && Math.abs(lastPage - firstPage) + 1 > maxPages) {
    return `PDF 选区跨页过多（最多支持 ${maxPages} 页），请缩小选区后重试。`;
  }
  return '此 PDF 选区暂无法安全定位，请重新选择较短文字后重试。';
}

function closeSelectionMenu({ clearSelection = true, restoreFocus = clearSelection } = {}) {
  if (_selectionMenu && !_selectionMenu.hidden) _selectionDismissedAt = Date.now();
  if (_selectionMenu) _selectionMenu.hidden = true;
  _activeSelectionSession = null;
  if (clearSelection) clearReaderSelection();
  if (restoreFocus) {
    const readerSurface = state.contentType === 'pdf'
      ? document.getElementById('pdfPages')
      : document.getElementById('reader');
    if (readerSurface && !readerSurface.closest('[hidden]')) {
      if (!readerSurface.hasAttribute('tabindex')) readerSurface.setAttribute('tabindex', '-1');
      readerSurface.focus({ preventScroll: true });
    }
  }
}

function showSelectionMenuForCurrentSelection() {
  const selection = window.getSelection?.();
  const session = captureSelectionSession(selection);
  if (!session) {
    closeSelectionMenu({ clearSelection: false });
    if (state.contentType === 'pdf') {
      const message = pdfSelectionUnavailableMessage(selection);
      if (message) showHighlightHint(message);
    }
    return false;
  }
  return openSelectionMenu(session);
}

function showSelectionMenuForRange(range, text) {
  if (!range || range.collapsed) return false;
  if (state.contentType === 'pdf') return showSelectionMenuForCurrentSelection();
  const session = captureSelectionSession(window.getSelection?.());
  if (session) return openSelectionMenu(session);

  const article = document.getElementById('article');
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  const chapter = commonElement?.closest?.('.epub-chapter');
  const normalizedText = normalizedSelectionText(text || range.toString());
  if (!article || !chapter || !article.contains(commonElement) || !normalizedText || normalizedText.length > 4000) {
    return false;
  }
  const locator = serializeDomRange(range, normalizedText);
  if (!locator) return false;
  return openSelectionMenu(Object.freeze({
    text: normalizedText,
    range: range.cloneRange(),
    locator,
    anchor: selectionAnchorForRange(range),
    createdAt: Date.now()
  }));
}

async function copySelectionText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showHighlightHint('已复制');
      return true;
    }
  } catch {
    // Fall through to the legacy textarea path.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand?.('copy') === true;
    textarea.remove();
    showHighlightHint(copied ? '已复制' : '复制失败，请重试');
    return copied;
  } catch {
    showHighlightHint('复制失败，请重试');
    return false;
  }
}

async function createSelectionAnnotation(style) {
  const session = _activeSelectionSession;
  if (!session) return false;
  try {
    const annotation = await currentAnnotationAdapter(state.contentType).create(session, { style });
    if (_activeSelectionSession !== session) return Boolean(annotation);
    const anchor = liveSelectionAnchor(session);
    closeSelectionMenu({ clearSelection: Boolean(annotation) });
    if (!annotation) showHighlightHint('标记未保存，请重新选择文本后重试');
    // Phone: the mark is made; offer colour, style, note and delete next to it.
    else if (isPhoneReader() && annotation.id) openAnnotationMenu(annotation.id, { anchor, text: session.text });
    return Boolean(annotation);
  } catch (error) {
    if (_activeSelectionSession !== session) return false;
    showHighlightHint(error.message || '标记保存失败，请重试');
    return false;
  }
}

function annotationRecord(id) {
  return currentAnnotationAdapter(state.contentType).list().find((item) => item.id === id) || null;
}

function annotationAnchor(id) {
  const boxes = [...document.querySelectorAll(`.br-highlight-box[data-highlight-id="${CSS.escape(String(id))}"]`)];
  if (!boxes.length) return null;
  const rects = boxes.map((box) => box.getBoundingClientRect());
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const first = rects[0];
  return { left: first.left + first.width / 2, top, bottom };
}

function ensureAnnotationMenu() {
  if (_annotationMenu) return _annotationMenu;
  const menu = document.createElement('div');
  menu.id = 'annotationMenu';
  menu.className = 'selection-menu annotation-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', '划线操作');
  menu.hidden = true;
  const look = document.createElement('div');
  look.className = 'annotation-menu-look';
  for (const [color, label] of [['yellow', '黄色'], ['green', '绿色'], ['blue', '蓝色'], ['pink', '粉色']]) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.dataset.annotationColor = color;
    swatch.setAttribute('aria-label', label);
    look.appendChild(swatch);
  }
  const divider = document.createElement('span');
  divider.className = 'annotation-menu-divider';
  divider.setAttribute('aria-hidden', 'true');
  look.appendChild(divider);
  for (const [style, label] of [['marker', '马克笔'], ['line', '直线'], ['wave', '波浪线']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.annotationStyle = style;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = label;
    look.appendChild(button);
  }
  const actions = document.createElement('div');
  actions.className = 'annotation-menu-actions';
  for (const [action, label] of [['thought', '写想法'], ['copy', '复制'], ['ai', '问 AI'], ['delete', '删除']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.annotationAction = action;
    button.textContent = label;
    actions.appendChild(button);
  }
  menu.append(look, actions);
  menu.addEventListener('pointerdown', (event) => event.preventDefault());
  menu.addEventListener('click', (event) => {
    const target = event.target.closest?.('button');
    if (!target || !_activeAnnotationId) return;
    event.preventDefault();
    event.stopPropagation();
    void handleAnnotationMenu(target);
  });
  document.body.appendChild(menu);
  _annotationMenu = menu;
  return menu;
}

function syncAnnotationMenu(record) {
  const menu = ensureAnnotationMenu();
  menu.querySelectorAll('[data-annotation-color]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.annotationColor === record?.color));
  });
  menu.querySelectorAll('[data-annotation-style]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.annotationStyle === (record?.style || 'marker')));
  });
}

/** The phone's bubble for one annotation: colour, style, note, copy, AI, delete. */
function openAnnotationMenu(id, { anchor = null, text = '' } = {}) {
  const record = annotationRecord(id);
  if (!record) return false;
  closeSelectionMenu({ clearSelection: false, restoreFocus: false });
  const menu = ensureAnnotationMenu();
  _activeAnnotationId = id;
  menu.dataset.text = text || record.text || '';
  syncAnnotationMenu(record);
  menu.hidden = false;
  placeFloatingMenu(menu, anchor || annotationAnchor(id) || { left: window.innerWidth / 2, top: 80, bottom: 100 });
  return true;
}

function closeAnnotationMenu() {
  if (_annotationMenu && !_annotationMenu.hidden) _selectionDismissedAt = Date.now();
  if (_annotationMenu) _annotationMenu.hidden = true;
  _activeAnnotationId = null;
}

async function handleAnnotationMenu(button) {
  const id = _activeAnnotationId;
  const record = annotationRecord(id);
  const text = _annotationMenu?.dataset.text || record?.text || '';
  if (button.dataset.annotationColor || button.dataset.annotationStyle) {
    const style = button.dataset.annotationStyle;
    if (style) rememberAnnotationStyle(style);
    if (button.dataset.annotationColor) {
      state.highlightColor = button.dataset.annotationColor;
      document.body.dataset.highlightColor = state.highlightColor;
      if (typeof persistUserSettings === 'function') persistUserSettings();
    }
    const updated = await updateAnnotationAppearance(id, { color: button.dataset.annotationColor, style });
    if (updated && _activeAnnotationId === id) {
      syncAnnotationMenu(annotationRecord(id) || updated);
      const anchor = annotationAnchor(id);
      if (anchor) placeFloatingMenu(_annotationMenu, anchor);
    }
    return;
  }
  const action = button.dataset.annotationAction;
  closeAnnotationMenu();
  if (action === 'thought') openHighlightEditor(id);
  else if (action === 'copy') await copySelectionText(text);
  else if (action === 'ai' && typeof openAiForSelection === 'function') openAiForSelection({ text });
  else if (action === 'delete') await deleteHighlightById(id);
}

function dispatchSelectionAction(action) {
  if (!_activeSelectionSession) return false;
  const handler = selectionActions[action];
  if (typeof handler !== 'function') return false;
  return handler();
}

function selectionInsideReader(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest?.('#article .epub-chapter, #article, .pdf-page-text-layer, .pdf-page'));
}

function setupSelectionMenu() {
  if (_selectionMenuBound) return;
  _selectionMenuBound = true;
  ensureSelectionMenu().hidden = true;

  // Pointer state: a mouse drag is still choosing its range until mouseup.
  // Touch selection never ends with a pointerup on Android (the system takes
  // the touch over), so selectionchange is what opens the menu there.
  let pointerDown = false;
  let pointerType = '';
  document.addEventListener('pointerdown', (event) => {
    pointerDown = true;
    pointerType = event.pointerType || 'mouse';
    // The annotation bubble belongs to a mark, not to a selection: any tap
    // elsewhere closes it. The selection menu stays while a finger adjusts
    // the selection handles; it closes when the selection goes away.
    if (_annotationMenu && !_annotationMenu.hidden && !_annotationMenu.contains(event.target)
        && !event.target?.closest?.('.br-highlight-box')) {
      closeAnnotationMenu();
    }
    if (_selectionMenu && !_selectionMenu.hidden && !_selectionMenu.contains(event.target) && pointerType === 'mouse') {
      closeSelectionMenu({ clearSelection: false });
    }
  }, true);
  const release = () => { pointerDown = false; };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  let settleTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (pointerDown && pointerType === 'mouse') return;
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed) {
        if (_activeSelectionSession) closeSelectionMenu({ clearSelection: false, restoreFocus: false });
        return;
      }
      if (!selectionInsideReader(selection)) return;
      const session = captureSelectionSession(selection);
      if (session) openSelectionMenu(session);
    }, 250);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && _annotationMenu && !_annotationMenu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeAnnotationMenu();
      return;
    }
    if (event.key === 'Escape' && _activeSelectionSession) {
      event.preventDefault();
      event.stopPropagation();
      closeSelectionMenu();
    }
  });
  // Scrolling and resizing (the phone's address bar collapsing) move the
  // selection: keep the menu next to it instead of closing it.
  let followFrame = 0;
  const follow = () => {
    cancelAnimationFrame(followFrame);
    followFrame = requestAnimationFrame(() => {
      if (_activeSelectionSession && _selectionMenu && !_selectionMenu.hidden) {
        const anchor = liveSelectionAnchor(_activeSelectionSession);
        if (anchor) placeFloatingMenu(_selectionMenu, anchor);
      }
      if (_activeAnnotationId && _annotationMenu && !_annotationMenu.hidden) {
        const anchor = annotationAnchor(_activeAnnotationId);
        if (anchor) placeFloatingMenu(_annotationMenu, anchor);
        else closeAnnotationMenu();
      }
    });
  };
  window.addEventListener('resize', follow);
  window.visualViewport?.addEventListener('resize', follow);
  window.addEventListener('scroll', follow, true);

  const inspectPdfSelection = (event) => {
    if (state.contentType !== 'pdf' || !event.target?.closest?.('.pdf-page-text-layer')) return;
    setTimeout(() => {
      if (state.contentType === 'pdf') showSelectionMenuForCurrentSelection();
    }, 0);
  };
  document.addEventListener('pointerup', inspectPdfSelection);
  document.addEventListener('mouseup', inspectPdfSelection);
  document.addEventListener('keyup', inspectPdfSelection);
}

// Kept as a narrow test/integration seam; the application uses the functions
// directly through the browser global lexical scope.
window.__zhenshuSelectionMenuApi = {
  captureSelectionSession,
  openAnnotationMenu,
  closeAnnotationMenu,
  selectionMenuRecentlyDismissed,
  openSelectionMenu,
  setupSelectionMenu,
  showSelectionMenuForCurrentSelection,
  closeSelectionMenu
};
