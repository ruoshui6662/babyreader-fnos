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
    closeSelectionMenu({ clearSelection: false });
    if (typeof openThoughtComposer === 'function') return openThoughtComposer(session);
    showHighlightHint('写想法将在下一阶段开放');
    return false;
  },
  ai: () => {
    const session = _activeSelectionSession;
    closeSelectionMenu({ clearSelection: false });
    if (typeof openAiForSelection === 'function') return openAiForSelection(session);
    showHighlightHint('问 AI 将在下一阶段开放');
    return false;
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
    session.anchor.left - menuWidth / 2
  ));
  const above = session.anchor.top - menuHeight - 12;
  const top = above >= margin
    ? above
    : Math.min(window.innerHeight - menuHeight - margin, session.anchor.bottom + 12);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
}

function openSelectionMenu(session) {
  if (!session) return false;
  const menu = ensureSelectionMenu();
  _activeSelectionSession = session;
  positionSelectionMenu(session);
  menu.hidden = false;
  return true;
}

function closeSelectionMenu({ clearSelection = true } = {}) {
  if (_selectionMenu) _selectionMenu.hidden = true;
  _activeSelectionSession = null;
  if (clearSelection) clearReaderSelection();
}

function showSelectionMenuForCurrentSelection() {
  const session = captureSelectionSession();
  if (!session) {
    closeSelectionMenu({ clearSelection: false });
    return false;
  }
  return openSelectionMenu(session);
}

function showSelectionMenuForRange(range, text) {
  if (!range || range.collapsed) return false;
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

function createSelectionAnnotation(style) {
  const session = _activeSelectionSession;
  const annotation = typeof createAnnotationFromSession === 'function'
    ? createAnnotationFromSession(session, { style })
    : null;
  closeSelectionMenu({ clearSelection: Boolean(annotation) });
  return Boolean(annotation);
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
      closeSelectionMenu();
    }
  });
  window.addEventListener('resize', () => closeSelectionMenu({ clearSelection: false }));
  window.addEventListener('scroll', () => closeSelectionMenu({ clearSelection: false }), true);
}

// Kept as a narrow test/integration seam; the application uses the functions
// directly through the browser global lexical scope.
window.__babyReaderSelectionMenuApi = {
  captureSelectionSession,
  setupSelectionMenu,
  showSelectionMenuForCurrentSelection,
  closeSelectionMenu
};
