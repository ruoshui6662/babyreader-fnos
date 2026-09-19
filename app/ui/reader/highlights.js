/* BabyReader UI module: reader/highlights */

'use strict';

function highlightIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m14.5 2.5 5 5-9.5 9.5H5V12Z"></path>
      <path d="M3 22h18"></path>
    </svg>
  `;
}

function exportIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>
      <path d="M12 14V3"></path>
      <path d="m8 7 4-4 4 4"></path>
    </svg>
  `;
}

// P0: icon-only toolbar — no text labels
function searchIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
    </svg>
  `;
}
function bookmarkIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
    </svg>
  `;
}
function notesIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
  `;
}
function aiIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a6 6 0 0 1 6 6v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z"></path>
      <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path>
      <path d="M12 18v4"></path><path d="M8 22h8"></path>
    </svg>
  `;
}
function settingsIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.18-.08a2 2 0 0 0-2 2v.44a2 2 0 0 0 2 2h.18a2 2 0 0 1 1.73 1l.25.43a2 2 0 0 1 0 2l-.08.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.18.08a2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2h-.18a2 2 0 0 1-1.73-1l-.25-.43a2 2 0 0 1 0-2l.08-.18a2 2 0 0 0-2-2z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

let _highlightPill = null;
let _highlightPillTimeout = null;
let _pendingCfiRange = null;
let _pendingDomHighlight = null;
let _fileNameFlashTimeout = null;
let _highlightSaveChain = Promise.resolve();
let _highlightSaveRevision = 0;
let _lastLibraryFocusBookId = null;
let _activeHighlightEditorId = null;

function getHighlightPill() {
  if (!_highlightPill) {
    _highlightPill = document.createElement('button');
    _highlightPill.className = 'highlight-pill';
    _highlightPill.textContent = '划线';
    document.body.appendChild(_highlightPill);
  }
  return _highlightPill;
}

function dismissHighlightPill() {
  clearTimeout(_highlightPillTimeout);
  _pendingCfiRange = null;
  _pendingDomHighlight = null;
  const pill = _highlightPill;
  if (pill) {
    pill.classList.remove('visible');
  }
  updateTopbarState();
}

function showHighlightPill(x, y, cfiRange = null) {
  const pill = getHighlightPill();
  dismissHighlightPill();
  _pendingCfiRange = cfiRange;

  pill.style.left = x + 'px';
  pill.style.top = y + 'px';
  pill.classList.add('visible');
  updateTopbarState();

  _highlightPillTimeout = setTimeout(dismissHighlightPill, 3000);
}

function runPendingHighlight() {
  const pill = _highlightPill;
  if (state.contentType === 'epub' && _pendingDomHighlight && pill?._clickHandler) {
    pill._clickHandler();
    return true;
  }
  if (state.contentType === 'epub' && _pendingCfiRange && pill?._clickHandler) {
    pill._clickHandler();
    return true;
  }
  return false;
}

function updateTopbarState() {
  const isEpub = state.contentType === 'epub';
  const hasToc = isEpub && state.toc.length > 0;
  const btnToc = document.getElementById('btnToc');
  const btnEdit = document.getElementById('btnEdit');

  document.body.classList.toggle('is-epub', isEpub);
  document.body.classList.toggle('has-toc', hasToc);
  document.body.classList.toggle('toc-open', hasToc && state.tocOpen);

  if (btnToc) {
    btnToc.hidden = !hasToc;
    btnToc.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h12"/><path d="M4 18h16"/></svg>`;
    const tocLabel = state.tocOpen ? '隐藏目录' : '显示目录';
    btnToc.setAttribute('aria-label', tocLabel);
    btnToc.setAttribute('title', tocLabel);
  }

  const btnHighlight = document.getElementById('btnHighlight');
  if (btnHighlight) {
    btnHighlight.hidden = !isEpub;
    btnHighlight.innerHTML = highlightIconSvg();
  }

  const btnExport = document.getElementById('btnExportHighlights');
  if (btnExport) {
    btnExport.hidden = !isEpub;
    btnExport.innerHTML = exportIconSvg();
  }

  // P0: inject icon-only toolbar buttons
  const btnSearch = document.getElementById('btnSearch');
  const btnBookmarks = document.getElementById('btnBookmarks');
  const btnNotes = document.getElementById('btnNotes');
  const btnAi = document.getElementById('btnAi');
  const btnSettings = document.getElementById('btnSettings');
  const themeBtn = document.getElementById('btnTheme');

  if (btnSearch) btnSearch.innerHTML = searchIconSvg();
  if (btnBookmarks) btnBookmarks.innerHTML = bookmarkIconSvg();
  if (btnNotes) btnNotes.innerHTML = notesIconSvg();
  if (btnAi) btnAi.innerHTML = aiIconSvg();
  if (btnSettings) btnSettings.innerHTML = settingsIconSvg();
  if (themeBtn) {
    const isLightOrSepia = state.theme === 'light' || state.theme === 'sepia';
    themeBtn.innerHTML = themeIconSvg(isLightOrSepia ? 'dark' : 'light');
    themeBtn.setAttribute('aria-label', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
  }

  const btnBack = document.getElementById('btnBackToLibrary');
  const btnPrevious = document.getElementById('btnPreviousChapter');
  const btnNext = document.getElementById('btnNextChapter');
  const readingProgress = document.getElementById('readingProgress');
  const floatingToolbar = document.getElementById('readerFloatingToolbar');
  const mobileToolbar = document.getElementById('mobileReaderToolbar');
  const mobileBack = document.getElementById('btnMobileBackToLibrary');
  const mobilePrevious = document.getElementById('btnMobilePreviousChapter');
  const mobileHighlight = document.getElementById('btnMobileHighlight');
  const mobileNext = document.getElementById('btnMobileNextChapter');
  const hasDocument = Boolean(state.currentPath);

  if (btnBack) btnBack.hidden = !isEpub;
  if (btnPrevious) btnPrevious.hidden = !isEpub;
  if (btnNext) btnNext.hidden = !isEpub;
  if (readingProgress) readingProgress.hidden = !isEpub;
  if (floatingToolbar) floatingToolbar.hidden = !hasDocument;
  if (mobileToolbar) mobileToolbar.hidden = !isEpub;
  if (mobileBack) mobileBack.disabled = !isEpub;
  if (mobilePrevious) mobilePrevious.disabled = !isEpub || state.currentChapterIndex <= 0;
  if (mobileHighlight) mobileHighlight.disabled = !isEpub;
  if (mobileNext) {
    mobileNext.disabled = !isEpub
      || state.currentChapterIndex >= Math.max(0, state.chapterPaths.length - 1);
  }
  if (isEpub) requestAnimationFrame(updateReadingProgress);
}

function toggleToc() {
  state.tocOpen = !state.tocOpen;
  localStorage.setItem('babyreader-toc-open', state.tocOpen ? '1' : '0');
  updateTopbarState();
  requestAnimationFrame(redrawDomHighlights);
}

function highlightId() {
  return `br-hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectedTextSignature(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeChapterHref(value) {
  try {
    return normalizeZipPath(splitHref(value).path);
  } catch {
    return '';
  }
}

function nodePathWithin(root, node) {
  if (!root || !node || (node !== root && !root.contains(node))) return null;
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === root ? path : null;
}

function nodeFromPath(root, path) {
  if (!root || !Array.isArray(path)) return null;
  let current = root;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || !current?.childNodes?.[index]) return null;
    current = current.childNodes[index];
  }
  return current;
}

function textOffsetWithin(root, targetNode, targetOffset) {
  if (!root || !targetNode || (targetNode !== root && !root.contains(targetNode))) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return total + Math.max(0, Math.min(targetOffset, node.nodeValue?.length || 0));
    total += node.nodeValue?.length || 0;
  }
  return null;
}

function textPositionAtOffset(root, absoluteOffset) {
  if (!root || !Number.isFinite(absoluteOffset) || absoluteOffset < 0) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = absoluteOffset;
  let node;
  let last = null;
  while ((node = walker.nextNode())) {
    last = node;
    const length = node.nodeValue?.length || 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return last ? { node: last, offset: last.nodeValue?.length || 0 } : null;
}

function serializeDomRange(range, text) {
  if (!range || range.collapsed) return null;
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  const chapter = commonElement?.closest?.('.epub-chapter');
  if (!chapter) return null;

  const startPath = nodePathWithin(chapter, range.startContainer);
  const endPath = nodePathWithin(chapter, range.endContainer);
  const startTextOffset = textOffsetWithin(chapter, range.startContainer, range.startOffset);
  const endTextOffset = textOffsetWithin(chapter, range.endContainer, range.endOffset);
  if (!startPath || !endPath || startTextOffset === null || endTextOffset === null) return null;

  const chapterText = chapter.textContent || '';
  return {
    chapterHref: normalizeChapterHref(chapter.dataset.sourcePath || ''),
    startPath,
    startOffset: range.startOffset,
    endPath,
    endOffset: range.endOffset,
    startTextOffset,
    endTextOffset,
    text: selectedTextSignature(text),
    contextBefore: chapterText.slice(Math.max(0, startTextOffset - 80), startTextOffset),
    contextAfter: chapterText.slice(endTextOffset, endTextOffset + 80)
  };
}

function rangeFromHighlight(highlight) {
  const locator = highlight?.domRange || highlight?.locatorData;
  const chapter = findChapterBySourcePath(highlight?.chapterHref || locator?.chapterHref);
  if (!chapter || !locator) return null;

  const expectedText = selectedTextSignature(highlight.text || locator.text);
  const createVerifiedRange = (startNode, startOffset, endNode, endOffset) => {
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return selectedTextSignature(range.toString()) === expectedText ? range : null;
    } catch {
      return null;
    }
  };

  const pathStartNode = nodeFromPath(chapter, locator.startPath);
  const pathEndNode = nodeFromPath(chapter, locator.endPath);
  const pathStartOffset = locator.startOffset;
  const pathEndOffset = locator.endOffset;
  const pathsValid = pathStartNode && pathEndNode
    && Number.isInteger(pathStartOffset) && Number.isInteger(pathEndOffset)
    && pathStartOffset >= 0 && pathEndOffset >= 0
    && pathStartOffset <= (pathStartNode.nodeValue?.length ?? pathStartNode.childNodes?.length ?? 0)
    && pathEndOffset <= (pathEndNode.nodeValue?.length ?? pathEndNode.childNodes?.length ?? 0);
  if (pathsValid) {
    const exactRange = createVerifiedRange(
      pathStartNode,
      pathStartOffset,
      pathEndNode,
      pathEndOffset
    );
    if (exactRange) return exactRange;
  }

  const absoluteStart = textPositionAtOffset(chapter, locator.startTextOffset);
  const absoluteEnd = textPositionAtOffset(chapter, locator.endTextOffset);
  const offsetRange = createVerifiedRange(
    absoluteStart?.node,
    absoluteStart?.offset,
    absoluteEnd?.node,
    absoluteEnd?.offset
  );
  if (offsetRange) return offsetRange;

  if (!expectedText) return null;
  const chapterText = chapter.textContent || '';
  const contextBefore = String(highlight.contextBefore || locator.contextBefore || '');
  const contextAfter = String(highlight.contextAfter || locator.contextAfter || '');
  const candidates = [];
  let searchOffset = 0;
  while (searchOffset <= chapterText.length - expectedText.length) {
    const index = chapterText.indexOf(expectedText, searchOffset);
    if (index < 0) break;
    const beforeMatches = !contextBefore
      || chapterText.slice(Math.max(0, index - contextBefore.length), index) === contextBefore;
    const afterStart = index + expectedText.length;
    const afterMatches = !contextAfter
      || chapterText.slice(afterStart, afterStart + contextAfter.length) === contextAfter;
    if (beforeMatches && afterMatches) candidates.push(index);
    searchOffset = index + Math.max(1, expectedText.length);
  }
  if (candidates.length !== 1) return null;

  const recoveredStart = textPositionAtOffset(chapter, candidates[0]);
  const recoveredEnd = textPositionAtOffset(chapter, candidates[0] + expectedText.length);
  return createVerifiedRange(
    recoveredStart?.node,
    recoveredStart?.offset,
    recoveredEnd?.node,
    recoveredEnd?.offset
  );
}

let _highlightEditorReturnFocus = null;

function closeHighlightEditor({ restoreFocus = true } = {}) {
  const editor = document.getElementById('highlightEditor');
  if (editor) editor.hidden = true;
  _activeHighlightEditorId = null;

  if (restoreFocus) {
    const target = _highlightEditorReturnFocus;
    _highlightEditorReturnFocus = null;
    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus();
    } else {
      document.getElementById('btnBackToLibrary')?.focus();
    }
  }
}

function openHighlightEditor(id) {
  const highlight = loadHighlights().find((item) => item.id === id);
  if (!highlight) return false;

  const editor = document.getElementById('highlightEditor');
  const text = document.getElementById('highlightEditorText');
  const color = document.getElementById('highlightEditorColor');
  const note = document.getElementById('highlightEditorNote');
  if (!editor || !text || !color || !note) return false;

  _highlightEditorReturnFocus = document.activeElement;
  _activeHighlightEditorId = id;
  text.textContent = highlight.text || '';
  color.value = ['yellow', 'green', 'blue', 'pink'].includes(highlight.color)
    ? highlight.color
    : 'yellow';
  note.value = String(highlight.note || '');
  editor.hidden = false;
  requestAnimationFrame(() => note.focus());
  return true;
}

async function saveActiveHighlightEdits() {
  if (!_activeHighlightEditorId) return;
  const color = document.getElementById('highlightEditorColor');
  const note = document.getElementById('highlightEditorNote');
  const highlights = loadHighlights();
  const index = highlights.findIndex((item) => item.id === _activeHighlightEditorId);
  if (index < 0) return closeHighlightEditor();

  highlights[index] = {
    ...highlights[index],
    color: ['yellow', 'green', 'blue', 'pink'].includes(color?.value) ? color.value : 'yellow',
    note: String(note?.value || '').slice(0, 4000)
  };
  saveHighlights(highlights);
  redrawDomHighlights();
  try {
    await queueHighlightSave();
    closeHighlightEditor();
  } catch {
    note?.focus();
  }
}

async function deleteActiveHighlight() {
  if (!_activeHighlightEditorId) return;
  const id = _activeHighlightEditorId;
  const remaining = loadHighlights().filter((item) => item.id !== id);
  saveHighlights(remaining);
  redrawDomHighlights();
  try {
    await queueHighlightSave();
    closeHighlightEditor();
  } catch {
    document.getElementById('btnDeleteHighlight')?.focus();
  }
}

function setupHighlightEditor() {
  const editor = document.getElementById('highlightEditor');
  if (!editor || editor._babyreaderBound) return;
  editor._babyreaderBound = true;

  document.getElementById('btnCloseHighlightEditor')?.addEventListener('click', () => closeHighlightEditor());
  document.getElementById('btnSaveHighlight')?.addEventListener('click', saveActiveHighlightEdits);
  document.getElementById('btnDeleteHighlight')?.addEventListener('click', deleteActiveHighlight);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHighlightEditor();
    }
  });
}

function highlightFileName() {
  const bookName = (state.currentName || '未知书籍').replace(/\.epub$/i, '');
  return `${bookName}.md`;
}

function highlightFilePathLabel(filename = highlightFileName()) {
  return `~/Documents/BabyReader/${filename}`;
}

function clearReaderSelection() {
  const sel = window.getSelection?.();
  sel?.removeAllRanges?.();
}

function ensureHighlightLayer() {
  const article = document.getElementById('article');
  if (!article) return null;

  let layer = article.querySelector(':scope > .highlight-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'highlight-layer';
    layer.setAttribute('aria-hidden', 'true');
    article.prepend(layer);
  }
  return layer;
}

function clearRenderedHighlights() {
  const layer = document.querySelector('#article > .highlight-layer');
  if (layer) layer.innerHTML = '';
}

function drawHighlightRects(id, range, color = 'yellow') {
  const layer = ensureHighlightLayer();
  const article = document.getElementById('article');
  if (!layer || !article || !range) return false;

  const allowedColors = ['yellow', 'green', 'blue', 'pink'];
  const normalizedColor = allowedColors.includes(color) ? color : 'yellow';
  const articleRect = article.getBoundingClientRect();
  let drew = false;
  for (const rect of range.getClientRects()) {
    if (rect.width < 2 || rect.height < 2) continue;
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'br-highlight-box';
    box.dataset.highlightId = id;
    box.dataset.highlightColor = normalizedColor;
    box.setAttribute('aria-label', '编辑划线');
    box.style.left = `${rect.left - articleRect.left}px`;
    box.style.top = `${rect.top - articleRect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openHighlightEditor(id);
    });
    layer.appendChild(box);
    drew = true;
  }
  return drew;
}

function findRangeForHighlightText(text) {
  const article = document.getElementById('article');
  const needle = selectedTextSignature(text);
  if (!article || !needle) return null;

  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest('.highlight-layer')) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.includes(needle)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const node = walker.nextNode();
  if (!node) return null;

  const start = node.nodeValue.indexOf(needle);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + needle.length);
  return range;
}

function saveDomHighlight(id, text, range) {
  const locator = serializeDomRange(range, text);
  if (!locator || !state.currentBookId) return false;

  const highlights = loadHighlights();
  if (highlights.some((highlight) => highlight.id === id)) return false;

  highlights.push({
    id,
    bookId: state.currentBookId,
    chapterHref: locator.chapterHref,
    text: selectedTextSignature(text),
    contextBefore: locator.contextBefore,
    contextAfter: locator.contextAfter,
    domRange: locator,
    color: state.highlightColor,
    note: '',
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10)
  });
  saveHighlights(highlights);
  void queueHighlightSave();
  updateTopbarState();
  return true;
}

function applyDomHighlightFromRange(range, text) {
  if (!range || range.collapsed) return false;

  const locator = serializeDomRange(range, text);
  if (!locator) return false;

  const id = highlightId();
  if (!drawHighlightRects(id, range, state.highlightColor)) return false;
  if (!saveDomHighlight(id, text, range)) {
    redrawDomHighlights();
    return false;
  }
  clearReaderSelection();
  return true;
}

function setPendingDomHighlight(range, text) {
  if (!range || range.collapsed || !selectedTextSignature(text)) return;

  const article = document.getElementById('article');
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  if (!article || !commonElement || !article.contains(commonElement)) return;

  let rect;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    return;
  }
  if (!rect || (!rect.width && !rect.height)) return;

  const pill = getHighlightPill();
  const oldHandler = pill._clickHandler;
  if (oldHandler) pill.removeEventListener('click', oldHandler);

  // Identical text may occur more than once. Selection always creates a new
  // precisely located highlight; deletion is available only by highlight ID
  // from the editor dialog.
  pill.textContent = '划线';

  const clonedRange = range.cloneRange();
  const handler = () => {
    const pending = _pendingDomHighlight;
    dismissHighlightPill();
    if (pending) applyDomHighlightFromRange(pending.range, pending.text);
  };
  pill._clickHandler = handler;
  pill.addEventListener('click', handler);

  showHighlightPill(rect.left + rect.width / 2 - 28, rect.top - 42);
  _pendingDomHighlight = { range: clonedRange, text };
}

function setupDomHighlightInteraction() {
  const article = document.getElementById('article');
  if (!article || article._babyreaderDomHighlightBound) return;
  article._babyreaderDomHighlightBound = true;

  const readSelection = () => {
    if (state.contentType !== 'epub') return;
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    setPendingDomHighlight(range, sel.toString());
  };

  article.addEventListener('mouseup', () => setTimeout(readSelection, 0));
  article.addEventListener('keyup', () => setTimeout(readSelection, 0));
  article.addEventListener('touchend', () => setTimeout(readSelection, 120));
}

function highlightCurrentDomSelection() {
  if (state.contentType !== 'epub') return false;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  return applyDomHighlightFromRange(range, sel.toString());
}

function redrawDomHighlights() {
  const highlights = loadHighlights();
  const article = document.getElementById('article');
  if (!article) return;

  clearRenderedHighlights();
  ensureHighlightLayer();
  for (const highlight of highlights) {
    const hasPreciseLocator = Boolean(
      highlight.domRange
      || highlight.locatorData
      || highlight.chapterHref
    );
    const range = rangeFromHighlight(highlight)
      || (!hasPreciseLocator ? findRangeForHighlightText(highlight.text) : null);
    if (range) drawHighlightRects(highlight.id, range, highlight.color);
  }
}

function iframeRectForContents(contents) {
  for (const iframe of document.querySelectorAll('#epubViewer iframe')) {
    if (iframe.contentWindow === contents?.window) {
      return iframe.getBoundingClientRect();
    }
  }
  return { left: 0, top: 0 };
}

function addHighlight(cfi, text, contents) {
  if (!cfi || !state.epubRendition) return;

  const highlights = loadHighlights();
  if (highlights.some(h => h.cfi === cfi)) {
    contents?.window?.getSelection()?.removeAllRanges();
    return;
  }

  state.epubRendition.annotations.highlight(cfi, {}, (e) => {
    e.stopPropagation();
    state.epubRendition.annotations.remove(cfi, 'highlight');
    const remaining = loadHighlights().filter(x => x.cfi !== cfi);
    saveHighlights(remaining);
    autoSaveHighlights();
    updateTopbarState();
  });

  highlights.push({
    cfi,
    text: String(text || '').slice(0, 500),
    date: new Date().toISOString().slice(0, 10)
  });
  saveHighlights(highlights);
  autoSaveHighlights();
  updateTopbarState();
  contents?.window?.getSelection()?.removeAllRanges();
}

function setPendingHighlight(cfiRange, contents, range, text) {
  if (!cfiRange || !contents || !range) return;

  let x = 0;
  let y = 0;
  try {
    const rect = range.getBoundingClientRect();
    const iframeRect = iframeRectForContents(contents);
    x = iframeRect.left + rect.left + rect.width / 2 - 28;
    y = iframeRect.top + rect.top - 42;
  } catch {
    return;
  }

  const pill = getHighlightPill();
  const oldHandler = pill._clickHandler;
  if (oldHandler) pill.removeEventListener('click', oldHandler);

  const handler = () => {
    const cfi = cfiRange;
    dismissHighlightPill();
    addHighlight(cfi, text, contents);
  };
  pill._clickHandler = handler;
  pill.addEventListener('click', handler);
  showHighlightPill(x, y, cfiRange);
}

function setupHighlightInteraction() {
  if (!state.epubRendition) return;

  state.epubRendition.on('selected', (cfiRange, contents) => {
    const sel = contents.window.getSelection();
    if (!sel || sel.isCollapsed) return;

    try {
      const range = sel.getRangeAt(0);
      setPendingHighlight(cfiRange, contents, range, sel.toString());
    } catch {
      return;
    }
  });

}
