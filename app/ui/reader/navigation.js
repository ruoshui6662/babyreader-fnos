/* 枕书 UI module: reader/navigation */

'use strict';

/* ============================================================
   Keyboard Shortcuts
   ============================================================ */
function isShortcutModifierDown(e) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  return isMac ? e.metaKey : e.ctrlKey;
}

function handleKeyboardShortcut(e) {
  if (!isShortcutModifierDown(e)) return false;

  switch (e.key.toLowerCase()) {
    case 'o':
      e.preventDefault();
      void returnToLibrary();
      return true;

    case 's':
      e.preventDefault();
      if (state.mode === 'edit') {
        const editor = document.getElementById('editor');
        if (editor) state.content = editor.value;
      }
      saveFileBrowser();
      return true;

    case '=':
    case '+':
      e.preventDefault();
      if (state.contentType === 'pdf') {
        window.pdfReaderController?.zoomBy(0.1);
        return true;
      }
      zoomLevel = Math.min(200, zoomLevel + 10);
      applyZoom();
      return true;

    case '-':
      e.preventDefault();
      if (state.contentType === 'pdf') {
        window.pdfReaderController?.zoomBy(-0.1);
        return true;
      }
      zoomLevel = Math.max(60, zoomLevel - 10);
      applyZoom();
      return true;

    case '0':
      e.preventDefault();
      if (state.contentType === 'pdf') {
        window.pdfReaderController?.setPdfScale(1);
        return true;
      }
      zoomLevel = 100;
      applyZoom();
      return true;

    case 'h':
      if (state.contentType === 'epub') {
        e.preventDefault();
        if (!runPendingHighlight() && !highlightCurrentDomSelection()) {
          showHighlightHint('先选中一段 EPUB 文本');
        }
        return true;
      }
      return false;

    case 'e':
      if (e.shiftKey && state.contentType === 'pdf'
        && e.target?.closest?.('input, textarea, [contenteditable="true"]')) return false;
      if (e.shiftKey && (state.contentType === 'epub' || state.contentType === 'pdf')) {
        e.preventDefault();
        exportHighlights();
        return true;
      }
      if (!e.shiftKey && state.contentType !== 'epub') {
        e.preventDefault();
        setMode(state.mode === 'read' ? 'edit' : 'read');
        return true;
      }
      return false;

    default:
      return false;
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', handleKeyboardShortcut);
}

function setupEpubContentKeyboard(contents) {
  const doc = contents?.document;
  if (!doc || doc._zhenshuShortcutsBound) return;
  doc._zhenshuShortcutsBound = true;
  doc.addEventListener('keydown', handleKeyboardShortcut, true);
}

function setupEpubContentSelection(contents) {
  const doc = contents?.document;
  const win = contents?.window;
  if (!doc || !win || doc._zhenshuSelectionBound) return;
  doc._zhenshuSelectionBound = true;

  const readSelection = () => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    let range;
    let cfiRange;
    try {
      range = sel.getRangeAt(0);
      if (typeof contents.cfiFromRange === 'function') {
        cfiRange = contents.cfiFromRange(range);
      } else if (typeof contents.section?.cfiFromRange === 'function') {
        cfiRange = contents.section.cfiFromRange(range);
      } else if (state.epubBook?.cfiFromRange) {
        cfiRange = state.epubBook.cfiFromRange(range);
      }
    } catch {
      return;
    }

    if (!cfiRange) return;
    setPendingHighlight(cfiRange, contents, range, sel.toString());
  };

  doc.addEventListener('mouseup', () => setTimeout(readSelection, 0));
  doc.addEventListener('pointerup', () => setTimeout(readSelection, 0));
  doc.addEventListener('keyup', () => setTimeout(readSelection, 0));
  doc.addEventListener('touchend', () => setTimeout(readSelection, 120));
  doc.addEventListener('selectionchange', () => setTimeout(readSelection, 0));
}

function findChapterBySourcePath(sourcePath) {
  if (!sourcePath) return null;
  let normalized;
  try {
    normalized = normalizeZipPath(sourcePath);
  } catch {
    return null;
  }
  return [...document.querySelectorAll('#article .epub-chapter')]
    .find((chapter) => chapter.dataset.sourcePath === normalized) || null;
}

function describeEpubNavigationFailure(target, sourceChapter = null) {
  const source = sourceChapter?.dataset.sourcePath || '目录';
  return `无法跳转：${String(target || '(空链接)')}（来源：${source}）`;
}

function setCurrentTocTarget(target) {
  document.querySelectorAll('.toc a[data-target]').forEach((link) => {
    const current = link.getAttribute('data-target') === target;
    link.classList.toggle('current', current);
    if (current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

async function navigateEpubTarget(target, sourceChapter = null) {
  if (!target || state.contentType !== 'epub' || isEpubChapterLoading()) return false;

  const archive = state.epubArchive;
  if (!archive?.chapterIndexByPath) return false;

  const rawTarget = String(target).startsWith('epub-path:') ? String(target).slice('epub-path:'.length) : target;
  const split = splitHref(rawTarget);
  let chapterPath = sourceChapter?.dataset.sourcePath || archive.spine?.[state.epubChapterIndex]?.fullPath || '';
  try {
    if (split.path) {
      chapterPath = String(target).startsWith('epub-path:')
        ? normalizeZipPath(split.path)
        : resolveZipPath(getDirPath(chapterPath), split.path);
    }
    chapterPath = normalizeZipPath(chapterPath);
  } catch (error) {
    console.warn('EPUB 内部链接路径无效', { target, source: sourceChapter?.dataset.sourcePath || '', error });
    return false;
  }

  const chapterIndex = archive.chapterIndexByPath[chapterPath];
  if (!Number.isInteger(chapterIndex)) {
    console.warn('EPUB 章节不存在', { target, chapterPath });
    return false;
  }
  const fragment = split.fragment ? decodeEpubPath(split.fragment) : '';
  if (chapterIndex !== state.epubChapterIndex) {
    const rendered = await navigateToEpubChapter(chapterIndex, { page: 1, fragment });
    if (!rendered) return false;
  }
  if (state.epubArchive !== archive || state.epubChapterIndex !== chapterIndex || isEpubChapterLoading()) return false;

  const chapter = findChapterBySourcePath(chapterPath);
  if (!chapter) return false;
  let node = chapter;
  if (fragment) {
    const anchored = [...chapter.querySelectorAll('[id]')].find((candidate) => candidate.id === fragment);
    if (!anchored) {
      console.warn('EPUB 锚点不存在', { target, fragment, chapter: chapter?.dataset.sourcePath || '' });
      return false;
    }
    node = anchored;
  }
  if (!node) {
    console.warn('EPUB 章节不存在', { target, source: sourceChapter?.dataset.sourcePath || '' });
    return false;
  }

  if (!navigateToSemanticTarget(node)) return false;
  setCurrentTocTarget(target);
  updateReadingProgress({ chapterIndexHint: chapterIndex });
  return true;
}

function setupTocNavigation() {
  document.addEventListener('click', (e) => {
    const tocLink = e.target.closest?.('.toc a[data-target]');
    if (tocLink) {
      e.preventDefault();
      e.stopPropagation();
      const target = tocLink.getAttribute('data-target');
      // On phones the contents panel is a sheet over the page: close it once
      // the jump lands so the chosen chapter is visible. Desktop keeps the
      // side panel open for browsing.
      const closeSheetOnPhone = () => {
        if (typeof isMobileReaderSurface === 'function' && isMobileReaderSurface()) {
          closeReaderPanel({ restoreFocus: false });
        }
      };
      const jump = (typeof withJumpBack === 'function' ? withJumpBack : (jump) => jump());
      if (state.contentType === 'pdf') {
        const match = /^pdf-page:(\d+)$/.exec(target || '');
        void jump(() => Boolean(match && window.pdfReaderController?.goToPdfPage(Number(match[1])))).then((navigated) => {
          if (!navigated) showHighlightHint('无法定位到该 PDF 页面');
          else closeSheetOnPhone();
        });
        return;
      }
      void jump(() => navigateEpubTarget(target)).then((navigated) => {
        if (!navigated) showHighlightHint(describeEpubNavigationFailure(target));
        else closeSheetOnPhone();
      });
      return;
    }

    const internalLink = e.target.closest?.('#article a[data-epub-href]');
    if (!internalLink || state.contentType !== 'epub') return;
    e.preventDefault();
    e.stopPropagation();
    const sourceChapter = internalLink.closest('.epub-chapter');
    const target = internalLink.getAttribute('data-epub-href');
    navigateEpubTarget(target, sourceChapter).then((navigated) => {
      if (!navigated) showHighlightHint(describeEpubNavigationFailure(target, sourceChapter));
    });
  });
}
