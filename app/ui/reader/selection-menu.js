/* BabyReader UI module: reader/selection-menu */

'use strict';

let _selectionMenu = null;
let _activeSelectionSession = null;
let _selectionMenuBound = false;

const selectionActions = Object.freeze({
  copy: async () => {
    const session = _activeSelectionSession;
    if (!session) return false;
    const copied = await copySelectionText(session.text);
    closeSelectionMenu({ clearSelection: copied });
    return copied;
  },
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

  const items = [
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

function positionSelectionMenu(session) {
  const menu = ensureSelectionMenu();
  const margin = 8;
  const menuWidth = menu.offsetWidth || 360;
  const menuHeight = menu.offsetHeight || 44;
  const left = Math.max(margin, Math.min(
    window.innerWidth - menuWidth - margin,
    (session.menuAnchor || session.anchor).left - menuWidth / 2
  ));
  const anchor = session.menuAnchor || session.anchor;
  const above = anchor.top - menuHeight - 12;
  const top = above >= margin
    ? above
    : Math.min(window.innerHeight - menuHeight - margin, anchor.bottom + 12);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
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
    closeSelectionMenu({ clearSelection: Boolean(annotation) });
    if (!annotation) showHighlightHint('标记未保存，请重新选择文本后重试');
    return Boolean(annotation);
  } catch (error) {
    if (_activeSelectionSession !== session) return false;
    showHighlightHint(error.message || '标记保存失败，请重试');
    return false;
  }
}

function dispatchSelectionAction(action) {
  if (!_activeSelectionSession) return false;
  const handler = selectionActions[action];
  if (typeof handler !== 'function') return false;
  return handler();
}

function setupSelectionMenu() {
  if (_selectionMenuBound) return;
  _selectionMenuBound = true;
  ensureSelectionMenu().hidden = true;

  document.addEventListener('pointerdown', (event) => {
    if (_selectionMenu && !_selectionMenu.contains(event.target)) {
      closeSelectionMenu({ clearSelection: false });
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && _activeSelectionSession) {
      event.preventDefault();
      event.stopPropagation();
      closeSelectionMenu();
    }
  });
  window.addEventListener('resize', () => closeSelectionMenu({ clearSelection: false }));
  window.addEventListener('scroll', () => closeSelectionMenu({ clearSelection: false }), true);

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
window.__babyReaderSelectionMenuApi = {
  captureSelectionSession,
  openSelectionMenu,
  setupSelectionMenu,
  showSelectionMenuForCurrentSelection,
  closeSelectionMenu
};
