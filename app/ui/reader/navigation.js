/* BabyReader UI module: reader/navigation */

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
      window.browserHost.getLibrary()
        .then(renderLibrary)
        .catch((error) => showHighlightHint(error.message));
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
      zoomLevel = Math.min(200, zoomLevel + 10);
      applyZoom();
      return true;

    case '-':
      e.preventDefault();
      zoomLevel = Math.max(60, zoomLevel - 10);
      applyZoom();
      return true;

    case '0':
      e.preventDefault();
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
      if (e.shiftKey && state.contentType === 'epub') {
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
  if (!doc || doc._babyreaderShortcutsBound) return;
  doc._babyreaderShortcutsBound = true;
  doc.addEventListener('keydown', handleKeyboardShortcut, true);
}

function setupEpubContentSelection(contents) {
  const doc = contents?.document;
  const win = contents?.window;
  if (!doc || !win || doc._babyreaderSelectionBound) return;
  doc._babyreaderSelectionBound = true;

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

function navigateEpubTarget(target, sourceChapter = null) {
  if (!target || state.contentType !== 'epub') return false;

  const split = splitHref(target);
  let chapter = sourceChapter;
  if (split.path) {
    try {
      const baseDir = getDirPath(sourceChapter?.dataset.sourcePath || '');
      chapter = findChapterBySourcePath(resolveZipPath(baseDir, split.path));
    } catch (error) {
      console.warn('EPUB 内部链接路径无效', { target, source: sourceChapter?.dataset.sourcePath || '', error });
      return false;
    }
  }

  let node = chapter;
  if (split.fragment) {
    const fragment = decodeEpubPath(split.fragment);
    const anchored = chapter
      ? [...chapter.querySelectorAll('[id]')].find((candidate) => candidate.id === fragment)
      : document.getElementById(fragment);
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

  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  const targetChapter = chapter || node.closest?.('.epub-chapter') || null;
  const chapterIndex = chapters.indexOf(targetChapter);
  navigateToSemanticTarget(node);
  setCurrentTocTarget(target);
  requestAnimationFrame(() => updateReadingProgress({ chapterIndexHint: chapterIndex >= 0 ? chapterIndex : null }));
  return true;
}

function setupTocNavigation() {
  document.addEventListener('click', (e) => {
    const tocLink = e.target.closest?.('.toc a[data-target]');
    if (tocLink) {
      e.preventDefault();
      e.stopPropagation();
      const target = tocLink.getAttribute('data-target');
      if (!navigateEpubTarget(target)) {
        showHighlightHint(describeEpubNavigationFailure(target));
      }
      return;
    }

    const internalLink = e.target.closest?.('#article a[data-epub-href]');
    if (!internalLink || state.contentType !== 'epub') return;
    e.preventDefault();
    e.stopPropagation();
    const sourceChapter = internalLink.closest('.epub-chapter');
    const target = internalLink.getAttribute('data-epub-href');
    if (!navigateEpubTarget(target, sourceChapter)) {
      showHighlightHint(describeEpubNavigationFailure(target, sourceChapter));
    }
  });
}
