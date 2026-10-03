/* 枕书 UI module: reader/highlights */

'use strict';

function highlightIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="highlight" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m14.5 3 5.5 5.5-9 9H5.5v-5.5Z"></path>
      <path d="m13 4.5 5.5 5.5"></path>
      <path d="M4 21h16"></path>
    </svg>
  `;
}

function exportIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="export" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>
      <path d="M12 14V3"></path>
      <path d="m8 7 4-4 4 4"></path>
    </svg>
  `;
}

// P0: icon-only toolbar — no text labels
// Reader icon family (2026-10, option 3): Apple SF-style metaphors on one
// grid — 24px, 1.8 stroke, round caps — each shown with a short caption.
function railLabel(text) {
  return `<span class="rail-label" aria-hidden="true">${text}</span>`;
}

function tocIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="toc" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="5" cy="7" r="1" fill="currentColor"></circle><circle cx="5" cy="12" r="1" fill="currentColor"></circle><circle cx="5" cy="17" r="1" fill="currentColor"></circle>
      <path d="M9 7h11M9 12h11M9 17h11"></path>
    </svg>
  `;
}

function searchIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="search" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 5 5"></path>
    </svg>
  `;
}
function bookmarkIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="bookmark" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4.2L6 21V4.5a1 1 0 0 1 1-1Z"></path>
    </svg>
  `;
}
function notesIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="note" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13"></path>
      <path d="M18.4 3.6a2 2 0 0 1 2.9 2.9L12.5 15.3 9 16l.7-3.5Z"></path>
    </svg>
  `;
}
function aiIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="ai" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 3.5c.7 4 2.6 5.9 6.5 6.5-3.9.7-5.8 2.6-6.5 6.5-.7-3.9-2.6-5.8-6.5-6.5 3.9-.6 5.8-2.5 6.5-6.5Z"></path>
      <path d="M18.5 14.5c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z"></path>
    </svg>
  `;
}
function settingsIconSvg() {
  return `
    <svg viewBox="0 0 24 24" data-icon="settings" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m2.5 19 5.2-14h1.1L14 19M4.6 14h6.3"></path>
      <circle cx="18.2" cy="16" r="2.8"></circle><path d="M21 13v6"></path>
    </svg>
  `;
}

// The phone toolbar shows the same icons above its captions (once).
function decorateMobileToolbar() {
  const icons = {
    btnMobileToc: tocIconSvg(),
    btnMobileNotes: notesIconSvg(),
    btnMobileAi: aiIconSvg(),
    btnMobileTheme: themeIconSvg(state.theme === 'dark' ? 'light' : 'dark'),
    btnMobileSettings: settingsIconSvg()
  };
  for (const [id, svg] of Object.entries(icons)) {
    const button = document.getElementById(id);
    if (!button || button.querySelector('svg')) continue;
    const caption = document.createElement('span');
    caption.className = 'rail-label';
    caption.textContent = button.textContent.trim();
    button.replaceChildren();
    button.insertAdjacentHTML('afterbegin', svg);
    button.appendChild(caption);
  }
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
let _highlightEditorMode = 'edit';
let _pendingThoughtSession = null;
let _activeHighlightEditorFormat = 'epub';
let _activeHighlightEditorBookId = null;

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
  const isPdf = state.contentType === 'pdf';
  const hasToc = state.toc.length > 0;
  const btnToc = document.getElementById('btnToc');
  const btnEdit = document.getElementById('btnEdit');

  document.body.classList.toggle('is-epub', isEpub);
  document.body.classList.toggle('is-pdf-reader', isPdf);
  document.body.classList.toggle('has-toc', hasToc);
  document.body.classList.toggle('toc-open', hasToc && state.tocOpen);

  if (btnToc) {
    btnToc.hidden = !hasToc;
    btnToc.innerHTML = tocIconSvg() + railLabel('目录');
    const tocLabel = typeof activeReaderPanel !== 'undefined' && activeReaderPanel === 'toc' ? '隐藏目录' : '显示目录';
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
    btnExport.hidden = !(isEpub || (isPdf && state.currentBookId));
    btnExport.disabled = isPdf && btnExport.dataset.exportBookId === state.currentBookId
      && btnExport.dataset.exportGeneration === String(window.pdfReaderController?.getGeneration?.() ?? '');
    btnExport.innerHTML = exportIconSvg();
    const exportLabel = isEpub || isPdf ? '导出标记与想法' : '纯文本书暂不支持导出标记与想法';
    btnExport.setAttribute('aria-label', exportLabel);
    btnExport.setAttribute('title', exportLabel);
  }

  // P0: inject icon-only toolbar buttons
  const btnSearch = document.getElementById('btnSearch');
  const btnBookmarks = document.getElementById('btnBookmarks');
  const btnNotes = document.getElementById('btnNotes');
  const btnAi = document.getElementById('btnAi');
  const btnSettings = document.getElementById('btnSettings');
  const themeBtn = document.getElementById('btnTheme');

  const searchAvailable = Boolean(state.currentBookId && state.currentPath);
  if (btnSearch) {
    btnSearch.innerHTML = searchIconSvg() + railLabel('搜索');
    btnSearch.disabled = !searchAvailable;
    btnSearch.dataset.readerStatus = searchAvailable ? 'enabled' : 'reserved';
    btnSearch.setAttribute('aria-label', searchAvailable ? '搜索本书' : '搜索，打开书籍后可用');
    btnSearch.setAttribute('title', searchAvailable ? '搜索本书' : '搜索，打开书籍后可用');
  }
  if (btnBookmarks) {
    btnBookmarks.innerHTML = bookmarkIconSvg() + railLabel('书签');
    const bookmarkAvailable = (isEpub || isPdf) && Boolean(state.currentBookId);
    const bookmarkActive = bookmarkAvailable
      && typeof isCurrentBookmark === 'function'
      && isCurrentBookmark();
    btnBookmarks.disabled = !bookmarkAvailable;
    btnBookmarks.setAttribute('aria-pressed', bookmarkActive ? 'true' : 'false');
    const bookmarkLabel = bookmarkActive ? '取消当前书签' : '添加当前书签';
    btnBookmarks.setAttribute('aria-label', bookmarkAvailable ? bookmarkLabel : '纯文本书暂不支持书签');
    btnBookmarks.setAttribute('title', bookmarkAvailable ? bookmarkLabel : '纯文本书暂不支持书签');
    if (typeof renderBookmarkButtonState === 'function') renderBookmarkButtonState();
  }
  if (btnNotes) {
    const notesAvailable = isEpub || isPdf;
    btnNotes.hidden = !notesAvailable;
    btnNotes.disabled = !notesAvailable;
    btnNotes.innerHTML = notesIconSvg() + railLabel('笔记');
    btnNotes.setAttribute('aria-label', notesAvailable ? '打开标记与想法' : '纯文本书暂不支持标记与想法');
    btnNotes.setAttribute('title', notesAvailable ? '打开标记与想法' : '纯文本书暂不支持标记与想法');
  }
  if (btnAi) {
    const aiAvailable = (isEpub || isPdf || state.contentType === 'text') && Boolean(state.currentBookId);
    btnAi.hidden = !aiAvailable;
    btnAi.disabled = !aiAvailable;
    btnAi.innerHTML = aiIconSvg() + railLabel('AI');
    btnAi.setAttribute('aria-label', aiAvailable ? '打开 AI 阅读助手' : '打开书籍后可用');
    btnAi.setAttribute('title', aiAvailable ? '打开 AI 阅读助手' : '打开书籍后可用');
  }
  if (btnSettings) btnSettings.innerHTML = settingsIconSvg() + railLabel('设置');
  decorateMobileToolbar();
  if (themeBtn) {
    const isLightOrSepia = state.theme === 'light' || state.theme === 'sepia';
    themeBtn.innerHTML = themeIconSvg(isLightOrSepia ? 'dark' : 'light');
    themeBtn.setAttribute('aria-label', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
  }

  const btnBack = document.getElementById('btnBackToLibrary');
  const btnPrevious = document.getElementById('btnPreviousChapter');
  const btnNext = document.getElementById('btnNextChapter');
  const scrollChapterHeader = document.getElementById('scrollChapterHeader');
  const scrollChapterFooter = document.getElementById('scrollChapterFooter');
  const scrollPrevious = document.getElementById('btnScrollPreviousChapter');
  const scrollNext = document.getElementById('btnScrollNextChapter');
  const readingProgress = document.getElementById('readingProgress');
  const floatingToolbar = document.getElementById('readerFloatingToolbar');
  const mobileToolbar = document.getElementById('mobileReaderToolbar');
  const mobileBookmark = document.getElementById('btnMobileTopBookmark');
  const mobileSearch = document.getElementById('btnMobileTopSearch');
  const mobileNotes = document.getElementById('btnMobileNotes');
  const mobileToc = document.getElementById('btnMobileToc');
  const mobileAi = document.getElementById('btnMobileAi');
  const mobilePrevious = document.getElementById('btnMobilePreviousChapter');
  const mobileNext = document.getElementById('btnMobileNextChapter');
  const hasDocument = Boolean(state.currentPath);

  if (btnBack) btnBack.hidden = !hasDocument;
  const isScrollMode = state.effectiveReadingMode === 'scroll';
  if (btnPrevious) btnPrevious.hidden = !isEpub || isScrollMode;
  if (btnNext) btnNext.hidden = !isEpub || isScrollMode;
  if (scrollChapterHeader) scrollChapterHeader.hidden = !isEpub || !isScrollMode;
  if (scrollChapterFooter) scrollChapterFooter.hidden = !isEpub || !isScrollMode;
  if (scrollPrevious) scrollPrevious.hidden = !isEpub || !isScrollMode || state.currentChapterIndex <= 0;
  if (scrollNext) scrollNext.hidden = !isEpub || !isScrollMode
    || state.currentChapterIndex >= Math.max(0, state.chapterPaths.length - 1);
  if (readingProgress) readingProgress.hidden = !isEpub;
  if (floatingToolbar) floatingToolbar.hidden = !hasDocument;
  if (mobileToolbar && typeof setMobileChromeOpen === 'function') {
    setMobileChromeOpen(isMobileChromeOpen());
  }
  if (mobileBookmark) mobileBookmark.disabled = !((isEpub || isPdf) && Boolean(state.currentBookId));
  if (mobileSearch) mobileSearch.disabled = !searchAvailable;
  if (mobileNotes) mobileNotes.disabled = !(isEpub || isPdf);
  if (mobileToc) mobileToc.disabled = !(isEpub || isPdf);
  if (mobileAi) mobileAi.disabled = Boolean(document.getElementById('btnAi')?.disabled);
  const moreMenu = document.getElementById('mobileMoreMenu');
  if (moreMenu) {
    const exportItem = moreMenu.querySelector('[data-reader-action="exportHighlights"]');
    const aiItem = moreMenu.querySelector('[data-reader-action="openAi"]');
    if (exportItem) exportItem.disabled = !(isEpub || isPdf);
    if (aiItem) aiItem.disabled = Boolean(document.getElementById('btnAi')?.disabled);
  }
  if (isEpub) {
    if (mobilePrevious) mobilePrevious.disabled = state.currentChapterIndex <= 0;
    if (mobileNext) {
      mobileNext.disabled = state.currentChapterIndex >= Math.max(0, state.chapterPaths.length - 1);
    }
  } else {
    if (mobilePrevious) mobilePrevious.disabled = !isPdf;
    if (mobileNext) mobileNext.disabled = !isPdf;
  }
  if (isEpub) requestAnimationFrame(updateReadingProgress);
}

function toggleToc() {
  state.tocOpen = !state.tocOpen;
  localStorage.setItem('zhenshu-toc-open', state.tocOpen ? '1' : '0');
  updateTopbarState();
  requestAnimationFrame(redrawDomHighlights);
}

function highlightId() {
  return `br-hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectedTextSignature(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function createAnnotationFromSession(session, {
  kind = 'highlight',
  style = 'marker',
  color = state.highlightColor,
  thought = '',
  note = thought
} = {}) {
  if (!session?.locator || !session?.range || !state.currentBookId) return null;

  const now = new Date().toISOString();
  const annotation = normalizeAnnotation({
    id: highlightId(),
    bookId: state.currentBookId,
    chapterHref: session.locator.chapterHref,
    text: selectedTextSignature(session.text),
    contextBefore: session.locator.contextBefore,
    contextAfter: session.locator.contextAfter,
    domRange: session.locator,
    kind,
    style,
    color,
    thought: String(thought || note || '').slice(0, 4000),
    createdAt: now,
    updatedAt: now,
    date: now.slice(0, 10)
  });

  if (annotation.style !== 'none'
    && !drawHighlightRects(annotation.id, session.range, annotation.color, annotation.style)) {
    return null;
  }
  const highlights = loadHighlights();
  if (highlights.some((item) => item.id === annotation.id)) return null;
  highlights.push(annotation);
  saveHighlights(highlights);
  if (typeof renderNotesPanel === 'function') renderNotesPanel();
  void queueHighlightSave();
  updateTopbarState();
  return annotation;
}

function normalizeAnnotation(record) {
  const annotation = record && typeof record === 'object' ? record : {};
  const allowedKinds = ['highlight', 'thought'];
  const allowedStyles = ['marker', 'wave', 'line', 'none'];
  const allowedColors = ['yellow', 'green', 'blue', 'pink'];
  return {
    ...annotation,
    kind: allowedKinds.includes(annotation.kind) ? annotation.kind : 'highlight',
    style: allowedStyles.includes(annotation.style) ? annotation.style : 'marker',
    color: allowedColors.includes(annotation.color) ? annotation.color : 'yellow',
    thought: String(annotation.thought || annotation.note || ''),
    // Legacy alias retained only for old clients and persisted records.
    note: String(annotation.thought || annotation.note || '')
  };
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
let _highlightEditorBaseline = '';
let _highlightEditorSaving = false;

function highlightEditorSnapshot() {
  return JSON.stringify(['highlightEditorThought', 'highlightEditorColor', 'highlightEditorStyle']
    .map((id) => document.getElementById(id)?.value || ''));
}

function closeHighlightEditor({ restoreFocus = true, force = false } = {}) {
  const editor = document.getElementById('highlightEditor');
  if (editor && !editor.hidden && !force) {
    if (_highlightEditorSaving) { showHighlightHint('正在保存，请稍候'); return false; }
    if (highlightEditorSnapshot() !== _highlightEditorBaseline
      && !window.confirm('想法或标记有未保存的更改。放弃这些更改？取消可继续编辑。')) return false;
  }
  if (editor) editor.hidden = true;
  _activeHighlightEditorId = null;
  _highlightEditorMode = 'edit';
  _pendingThoughtSession = null;
  _activeHighlightEditorFormat = 'epub';
  _activeHighlightEditorBookId = null;

  if (restoreFocus) {
    const target = _highlightEditorReturnFocus;
    _highlightEditorReturnFocus = null;
    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus();
    } else if (!document.getElementById('readerPanelNotes')?.hidden) {
      document.getElementById('drawerTabNotes')?.focus();
    } else {
      document.getElementById('btnBackToLibrary')?.focus();
    }
  }
  return true;
}

function openHighlightEditor(id) {
  if (!document.getElementById('highlightEditor')?.hidden && !closeHighlightEditor({ restoreFocus: false })) return false;
  const adapter = currentAnnotationAdapter(state.contentType);
  const highlight = adapter.list().find((item) => item.id === id);
  if (!highlight || (state.contentType === 'pdf' && highlight.sourceStale)) return false;

  const editor = document.getElementById('highlightEditor');
  const title = document.getElementById('highlightEditorTitle');
  const text = document.getElementById('highlightEditorText');
  const color = document.getElementById('highlightEditorColor');
  const style = document.getElementById('highlightEditorStyle');
  const thought = document.getElementById('highlightEditorThought');
  const deleteButton = document.getElementById('btnDeleteHighlight');
  if (!editor || !title || !text || !color || !style || !thought) return false;

  _highlightEditorReturnFocus = document.activeElement;
  _highlightEditorMode = 'edit';
  _pendingThoughtSession = null;
  _activeHighlightEditorId = id;
  _activeHighlightEditorFormat = adapter.format;
  _activeHighlightEditorBookId = state.currentBookId;
  title.textContent = highlight.kind === 'thought' ? '编辑想法' : '编辑批注';
  text.textContent = highlight.text || '';
  color.value = ['yellow', 'green', 'blue', 'pink'].includes(highlight.color)
    ? highlight.color
    : 'yellow';
  style.value = ['none', 'marker', 'wave', 'line'].includes(highlight.style)
    ? highlight.style
    : 'marker';
  if (typeof syncCustomSelectValue === 'function') syncCustomSelectValue(color);
  if (typeof syncCustomSelectValue === 'function') syncCustomSelectValue(style);
  thought.value = String(highlight.thought || highlight.note || '');
  _highlightEditorBaseline = highlightEditorSnapshot();
  if (deleteButton) deleteButton.hidden = false;
  const cardButton = document.getElementById('btnHighlightCard');
  if (cardButton) cardButton.hidden = typeof openNoteCardForAnnotation !== 'function';
  editor.hidden = false;
  requestAnimationFrame(() => thought.focus());
  return true;
}

function openThoughtComposer(session) {
  if (!document.getElementById('highlightEditor')?.hidden && !closeHighlightEditor({ restoreFocus: false })) return false;
  const pdfSession = session?.format === 'pdf' && Array.isArray(session.targets);
  if ((!session?.locator && !pdfSession) || !session?.range) return false;

  const editor = document.getElementById('highlightEditor');
  const title = document.getElementById('highlightEditorTitle');
  const text = document.getElementById('highlightEditorText');
  const color = document.getElementById('highlightEditorColor');
  const style = document.getElementById('highlightEditorStyle');
  const thought = document.getElementById('highlightEditorThought');
  const deleteButton = document.getElementById('btnDeleteHighlight');
  if (!editor || !title || !text || !color || !style || !thought) return false;

  _highlightEditorReturnFocus = document.activeElement;
  _highlightEditorMode = 'create-thought';
  _pendingThoughtSession = session;
  _activeHighlightEditorId = null;
  _activeHighlightEditorFormat = pdfSession ? 'pdf' : 'epub';
  _activeHighlightEditorBookId = state.currentBookId;
  title.textContent = '写想法';
  text.textContent = session.text || '';
  color.value = state.highlightColor;
  style.value = 'none';
  if (typeof syncCustomSelectValue === 'function') syncCustomSelectValue(color);
  if (typeof syncCustomSelectValue === 'function') syncCustomSelectValue(style);
  thought.value = '';
  _highlightEditorBaseline = highlightEditorSnapshot();
  if (deleteButton) deleteButton.hidden = true;
  const cardButton = document.getElementById('btnHighlightCard');
  if (cardButton) cardButton.hidden = true;
  editor.hidden = false;
  requestAnimationFrame(() => thought.focus());
  return true;
}

async function saveActiveHighlightEdits() {
  if (_highlightEditorSaving) return;
  _highlightEditorSaving = true;
  const saveButton = document.getElementById('btnSaveHighlight');
  if (saveButton) { saveButton.disabled = true; saveButton.setAttribute('aria-busy', 'true'); }
  try { await performHighlightEditorSave(); }
  finally {
    _highlightEditorSaving = false;
    if (saveButton) { saveButton.disabled = false; saveButton.removeAttribute('aria-busy'); }
  }
}

async function performHighlightEditorSave() {
  const thought = document.getElementById('highlightEditorThought');
  const color = document.getElementById('highlightEditorColor');
  const style = document.getElementById('highlightEditorStyle');
  if (!thought || !color || !style) return;

  const thoughtText = String(thought.value || '').trim().slice(0, 4000);
  const selectedColor = ['yellow', 'green', 'blue', 'pink'].includes(color.value)
    ? color.value
    : state.highlightColor;
  const selectedStyle = ['none', 'marker', 'wave', 'line'].includes(style.value)
    ? style.value
    : 'marker';

  if (_highlightEditorMode === 'create-thought') {
    if (!thoughtText) {
      showHighlightHint('请先写下你的想法');
      thought.focus();
      return;
    }
    const session = _pendingThoughtSession;
    const format = _activeHighlightEditorFormat;
    const bookId = _activeHighlightEditorBookId;
    try {
      if (format === 'pdf' && (state.contentType !== 'pdf'
        || state.currentBookId !== bookId || session?.bookId !== bookId)) {
        throw new Error('书籍已切换，请重新选择文本');
      }
      const annotation = await currentAnnotationAdapter(format).create(session, {
        kind: 'thought', style: selectedStyle, color: selectedColor, thought: thoughtText
      });
      if (!annotation) throw new Error('想法保存失败，请重新选择文本');
      if (format === 'epub') await _highlightSaveChain;
      if (_pendingThoughtSession !== session || state.currentBookId !== bookId) return;
      clearReaderSelection();
      closeHighlightEditor({ force: true });
    } catch (error) {
      if (_pendingThoughtSession !== session || state.currentBookId !== bookId) return;
      showHighlightHint(error.message || '想法保存失败，请重试');
      thought.focus();
    }
    return;
  }

  if (!_activeHighlightEditorId) return;
  if (_activeHighlightEditorFormat === 'pdf') {
    const annotationId = _activeHighlightEditorId;
    const bookId = _activeHighlightEditorBookId;
    try {
      if (state.contentType !== 'pdf' || state.currentBookId !== bookId) {
        throw new Error('书籍已切换，请重新打开标记');
      }
      await window.browserHost.updatePdfAnnotation(annotationId, {
        color: selectedColor, style: selectedStyle, thought: thoughtText
      }, bookId);
      if (state.currentBookId !== bookId || _activeHighlightEditorId !== annotationId) return;
      setPdfAnnotationRendererRecords(bookId, pdfAnnotationCache(bookId));
      renderNotesPanel();
      closeHighlightEditor({ force: true });
    } catch (error) {
      if (_activeHighlightEditorId !== annotationId || state.currentBookId !== bookId) return;
      showHighlightHint(error.message || '标记更新失败，请重试');
      thought.focus();
    }
    return;
  }

  const highlights = loadHighlights();
  const index = highlights.findIndex((item) => item.id === _activeHighlightEditorId);
  if (index < 0) return closeHighlightEditor({ force: true });

  highlights[index] = {
    ...highlights[index],
    color: selectedColor,
    style: selectedStyle,
    thought: thoughtText,
    note: thoughtText,
    updatedAt: new Date().toISOString()
  };
  saveHighlights(highlights);
  if (typeof renderNotesPanel === 'function') renderNotesPanel();
  redrawDomHighlights();
  try {
    await queueHighlightSave();
    closeHighlightEditor({ force: true });
  } catch {
    thought.focus();
  }
}

// Recolour or restyle one annotation without opening the editor (the phone
// annotation bubble). Returns the updated record, or null.
async function updateAnnotationAppearance(id, { color, style } = {}) {
  if (!id) return null;
  const changes = {};
  if (['yellow', 'green', 'blue', 'pink'].includes(color)) changes.color = color;
  if (['marker', 'wave', 'line'].includes(style)) changes.style = style;
  if (!Object.keys(changes).length) return null;
  if (state.contentType === 'pdf') {
    const bookId = state.currentBookId;
    try {
      const updated = await window.browserHost.updatePdfAnnotation(id, changes, bookId);
      if (state.currentBookId === bookId && state.contentType === 'pdf') {
        setPdfAnnotationRendererRecords(bookId, pdfAnnotationCache(bookId));
        if (typeof renderNotesPanel === 'function') renderNotesPanel();
      }
      return updated || changes;
    } catch (error) {
      showHighlightHint(error.message || '标记更新失败，请重试');
      return null;
    }
  }
  const highlights = loadHighlights();
  const index = highlights.findIndex((item) => item.id === id);
  if (index < 0) return null;
  highlights[index] = { ...highlights[index], ...changes, updatedAt: new Date().toISOString() };
  saveHighlights(highlights);
  if (typeof renderNotesPanel === 'function') renderNotesPanel();
  redrawDomHighlights();
  try {
    await queueHighlightSave();
  } catch {
    showHighlightHint('标记更新失败，请重试');
    return null;
  }
  return highlights[index];
}

async function deleteHighlightById(id) {
  if (!id) return false;
  if (!window.confirm('删除这条标记及其想法？书籍原文不会改变，此操作无法撤销。')) return false;
  if (state.contentType === 'pdf') {
    const bookId = state.currentBookId;
    try {
      const result = await window.browserHost.deletePdfAnnotation(id, bookId);
      if (!result.deleted) return false;
      if (state.currentBookId === bookId && state.contentType === 'pdf') {
        setPdfAnnotationRendererRecords(bookId, pdfAnnotationCache(bookId));
        renderNotesPanel();
      }
      return true;
    } catch (error) {
      if (state.currentBookId !== bookId) return false;
      showHighlightHint(error.message || '标记删除失败，请重试');
      return false;
    }
  }
  const remaining = loadHighlights().filter((item) => item.id !== id);
  if (remaining.length === loadHighlights().length) return false;
  saveHighlights(remaining);
  if (typeof renderNotesPanel === 'function') renderNotesPanel();
  redrawDomHighlights();
  try {
    await queueHighlightSave();
    return true;
  } catch {
    return false;
  }
}

async function deleteActiveHighlight() {
  if (!_activeHighlightEditorId) return false;
  const annotationId = _activeHighlightEditorId;
  const bookId = state.currentBookId;
  const deleted = await deleteHighlightById(annotationId);
  if (state.currentBookId !== bookId || _activeHighlightEditorId !== annotationId) return deleted;
  if (deleted) closeHighlightEditor({ force: true });
  else document.getElementById('btnDeleteHighlight')?.focus();
  return deleted;
}

function setupHighlightEditor() {
  const editor = document.getElementById('highlightEditor');
  if (!editor || editor._zhenshuBound) return;
  editor._zhenshuBound = true;

  document.getElementById('btnCloseHighlightEditor')?.addEventListener('click', () => closeHighlightEditor());
  document.getElementById('btnSaveHighlight')?.addEventListener('click', saveActiveHighlightEdits);
  document.getElementById('btnDeleteHighlight')?.addEventListener('click', deleteActiveHighlight);
  document.getElementById('btnHighlightCard')?.addEventListener('click', () => {
    const id = _activeHighlightEditorId;
    const bookId = _activeHighlightEditorBookId;
    if (!id || !bookId || typeof openNoteCardForAnnotation !== 'function') return;
    const record = currentAnnotationAdapter(state.contentType).list().find((item) => item.id === id);
    // The card shows the thought as typed, even before it is saved.
    const thought = String(document.getElementById('highlightEditorThought')?.value || '').trim();
    void openNoteCardForAnnotation(bookId, id, { ...record, thought }, { thought });
  });
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
  return `~/Documents/枕书/${filename}`;
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

function drawHighlightRects(id, range, color = 'yellow', style = 'marker') {
  const layer = ensureHighlightLayer();
  const article = document.getElementById('article');
  if (!layer || !article || !range) return false;

  const annotation = normalizeAnnotation({ color, style });
  const normalizedColor = annotation.color;
  const normalizedStyle = annotation.style;
  const articleRect = article.getBoundingClientRect();
  // Range rects are viewport coordinates, while the highlight layer is an
  // absolutely positioned child of the scrollable article. In paged mode the
  // visible spread is offset by article.scrollLeft; omitting that offset draws
  // a saved marker back at the first spread, so the save toast succeeds while
  // no marker is visible on the page the user selected.
  const scrollLeft = article.scrollLeft || 0;
  const scrollTop = article.scrollTop || 0;
  let drew = false;
  for (const rect of range.getClientRects()) {
    if (rect.width < 2 || rect.height < 2) continue;
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'br-highlight-box';
    box.dataset.highlightId = id;
    box.dataset.highlightColor = normalizedColor;
    box.setAttribute('data-annotation-style', normalizedStyle);
    box.setAttribute('aria-label', '编辑划线');
    box.style.left = `${rect.left - articleRect.left + scrollLeft}px`;
    box.style.top = `${rect.top - articleRect.top + scrollTop}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    if (normalizedStyle === 'wave') {
      const width = Math.max(8, Math.ceil(rect.width));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'br-highlight-wave');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('viewBox', `0 0 ${width} 6`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const points = [];
      for (let x = 0; x <= width; x += 4) {
        const y = 3 + (Math.floor(x / 4) % 2 === 0 ? -1.3 : 1.3);
        points.push(`${x},${y}`);
      }
      path.setAttribute('d', `M ${points.join(' L ')}`);
      svg.appendChild(path);
      box.appendChild(svg);
    }
    box.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Phones get the compact annotation bubble; desktops the full editor.
      if (typeof isMobileReaderSurface === 'function' && isMobileReaderSurface()
          && typeof openAnnotationMenu === 'function' && openAnnotationMenu(id)) return;
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
    kind: 'highlight',
    style: 'marker',
    color: state.highlightColor,
    thought: '',
    note: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10)
  });
  saveHighlights(highlights);
  if (typeof renderNotesPanel === 'function') renderNotesPanel();
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
  if (!article || article._zhenshuDomHighlightBound) return;
  article._zhenshuDomHighlightBound = true;

  const readSelection = () => {
    if (state.contentType !== 'epub') return;
    if (typeof showSelectionMenuForCurrentSelection === 'function'
      && showSelectionMenuForCurrentSelection()) return;
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    setPendingDomHighlight(range, sel.toString());
  };

  article.addEventListener('mouseup', () => setTimeout(readSelection, 0));
  article.addEventListener('pointerup', () => setTimeout(readSelection, 0));
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
    const annotation = normalizeAnnotation(highlight);
    if (range && annotation.style !== 'none') {
      drawHighlightRects(annotation.id, range, annotation.color, annotation.style);
    }
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
