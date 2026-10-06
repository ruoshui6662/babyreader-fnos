/* 枕书 UI module: reader/progress */

'use strict';

function ensureTocElement() {
  return document.getElementById('toc');
}

function renderToc() {
  const toc = ensureTocElement();
  const list = document.getElementById('tocList');
  const emptyState = document.getElementById('tocEmptyState');
  const hasToc = state.toc.length > 0;

  if (toc) toc.hidden = !hasToc;
  if (emptyState) emptyState.hidden = hasToc;
  updateTopbarState();
  if (!list) return;

  list.innerHTML = hasToc
    ? state.toc.map((item) => {
      const depth = Math.min(Number(item.depth || 0), 3);
      return `<li class="toc-depth-${depth}"><a href="#" data-target="${escapeHtmlAttribute(item.target)}">${escapeHtml(item.label)}</a></li>`;
    }).join('')
    : '';
}

function normalizeTextContext(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function chapterScrollPercentage(reader) {
  if (!reader) return 0;
  const range = Math.max(1, reader.scrollHeight - reader.clientHeight);
  return Math.max(0, Math.min(1, reader.scrollTop / range));
}

// Each chapter's share of the book, by the size of its text in the archive
// (a long chapter is a larger part of the book than a two-line one); equal
// shares when the sizes are not known. Measured once per opened book.
function epubChapterWeights() {
  const archive = state.epubArchive;
  if (!archive || !Array.isArray(archive.spine) || !archive.spine.length) return null;
  if (archive.chapterWeights) return archive.chapterWeights;
  const sizes = archive.spine.map((chapter) => {
    try {
      const file = typeof getZipFile === 'function' ? getZipFile(archive.zip, chapter.fullPath) : archive.zip?.file?.(chapter.fullPath);
      return Number(file?._data?.uncompressedSize);
    } catch {
      return NaN;
    }
  });
  const known = sizes.every((size) => Number.isFinite(size) && size > 0);
  // A floor, so a cover or title page still counts for a little.
  const weights = known ? sizes.map((size) => Math.max(size, 1024)) : sizes.map(() => 1);
  const starts = [];
  let total = 0;
  for (const weight of weights) {
    starts.push(total);
    total += weight;
  }
  archive.chapterWeights = { weights, starts, total };
  return archive.chapterWeights;
}

// Where in the whole book (0..1) a point `within` (0..1) of chapter
// `chapterIndex` is.
function epubBookFraction(chapterIndex, within, chapterCount) {
  const fraction = Math.max(0, Math.min(1, Number(within) || 0));
  const weights = epubChapterWeights();
  if (!weights || !Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= weights.weights.length) {
    return Math.max(0, Math.min(1, (chapterIndex + fraction) / Math.max(1, chapterCount)));
  }
  return Math.max(0, Math.min(1, (weights.starts[chapterIndex] + weights.weights[chapterIndex] * fraction) / weights.total));
}

// The chapter at a point of the whole book (the progress slider).
function epubChapterAtFraction(ratio, chapterCount) {
  const count = Math.max(1, chapterCount);
  const weights = epubChapterWeights();
  const target = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (!weights) return Math.min(count - 1, Math.floor(target * count));
  const point = target * weights.total;
  let index = 0;
  while (index < weights.weights.length - 1 && weights.starts[index + 1] <= point) index += 1;
  return index;
}

function currentReadingLocator(reader) {
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  const chapterCount = state.epubArchive ? Math.max(1, state.epubChapterCount) : Math.max(1, chapters.length);
  const readerRect = reader.getBoundingClientRect();
  const paged = state.effectiveReadingMode !== 'scroll';
  const viewportTop = readerRect.top + (paged ? 0 : readerTopInset(reader)) + 8;
  const viewportLeft = readerRect.left + 8;
  const viewportRight = readerRect.right - 8;
  let chapter = chapters[0] || null;

  if (paged) {
    const visibleChapters = chapters.filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.right >= viewportLeft && rect.left <= viewportRight;
    });
    // A double-page spread can straddle a chapter boundary. The later
    // chapter is the semantic reading position after a TOC jump or page turn;
    // choosing the first intersecting chapter saved progress back to the
    // previous chapter.
    chapter = visibleChapters[visibleChapters.length - 1] || chapter;
  } else {
    for (const candidate of chapters) {
      if (candidate.getBoundingClientRect().top <= viewportTop) chapter = candidate;
      else break;
    }
  }

  const semanticNodes = chapter
    ? [...chapter.querySelectorAll('[id], p, li, h1, h2, h3, h4, blockquote')]
    : [];
  const visibleNode = semanticNodes.find((node) => {
    const rect = node.getBoundingClientRect();
    if (paged) {
      return rect.right >= viewportLeft && rect.left <= viewportRight
        && rect.bottom >= readerRect.top && rect.top <= readerRect.bottom;
    }
    return rect.bottom >= viewportTop && normalizeTextContext(node.textContent);
  }) || null;
  const anchor = visibleNode?.id ? visibleNode : visibleNode?.closest?.('[id]');
  const pageRange = Math.max(1, state.pageCount - 1);
  const chapterIndex = state.epubArchive && Number.isInteger(state.epubChapterIndex)
    ? Math.max(0, Math.min(chapterCount - 1, state.epubChapterIndex))
    : Math.max(0, chapters.indexOf(chapter));
  const chapterPercentage = paged ? null : chapterScrollPercentage(reader);
  // Progress through the whole book. A chapter-at-a-time (archive) EPUB
  // pages through one chapter, so its page fraction is placed within that
  // chapter's share of the book; saving the bare page fraction made every
  // chapter's end read as nearly 100% (and marked the book finished).
  const pageFraction = Math.max(0, Math.min(1, (state.pageNumber - 1) / pageRange));
  const percentage = paged
    ? state.epubArchive ? epubBookFraction(chapterIndex, pageFraction, chapterCount) : pageFraction
    : state.epubArchive
      ? epubBookFraction(chapterIndex, chapterPercentage, chapterCount)
      : Math.max(0, Math.min(1, (chapterIndex + chapterPercentage) / chapterCount));

  return {
    version: 2,
    type: 'semantic-position',
    readingScope: paged ? 'page' : 'chapter',
    href: chapter?.dataset.sourcePath || '',
    anchor: anchor?.id || '',
    textBefore: normalizeTextContext(visibleNode?.textContent).slice(0, 120),
    pageNumber: paged ? state.pageNumber : null,
    scrollTop: Math.max(0, reader.scrollTop),
    percentage,
    chapterPercentage
  };
}

function findTextContextNode(context) {
  const needle = normalizeTextContext(context);
  if (!needle) return null;
  return [...document.querySelectorAll('#article p, #article li, #article h1, #article h2, #article h3, #article h4, #article blockquote')]
    .find((node) => normalizeTextContext(node.textContent).includes(needle));
}

function updateReadingProgress(options = {}) {
  const reader = document.getElementById('reader');
  const progress = document.getElementById('readingProgress');
  if (!reader || !progress || state.contentType !== 'epub') return;

  const paged = state.effectiveReadingMode !== 'scroll';
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  const chapterCount = state.epubArchive ? Math.max(1, state.epubChapterCount) : Math.max(1, chapters.length);
  // In paged mode the visible window is the article's own border box (the
  // reader adds viewport insets the track never occupies); in scroll mode it
  // is the reader's vertical viewport.
  const visibleRect = paged
    ? document.getElementById('article')?.getBoundingClientRect() ?? reader.getBoundingClientRect()
    : reader.getBoundingClientRect();
  const viewportTop = visibleRect.top + (paged ? 0 : readerTopInset(reader)) + 8;
  const viewportLeft = visibleRect.left + 8;
  const viewportRight = visibleRect.right - 8;
  const chapterIndexHint = typeof options === 'object' && Number.isInteger(options?.chapterIndexHint)
    ? Math.max(0, Math.min(chapterCount - 1, options.chapterIndexHint))
    : state.epubArchive && Number.isInteger(state.epubChapterIndex)
      ? Math.max(0, Math.min(chapterCount - 1, state.epubChapterIndex))
      : null;
  let chapterIndex = chapterIndexHint ?? 0;
  if (chapterIndexHint === null) {
    for (let index = 0; index < chapters.length; index += 1) {
      const rect = chapters[index].getBoundingClientRect();
      if (paged) {
        if (rect.right >= viewportLeft && rect.left <= viewportRight) {
          chapterIndex = index;
        }
      } else if (rect.top <= viewportTop) {
        chapterIndex = index;
      } else {
        break;
      }
    }
  }
  state.currentChapterIndex = chapterIndex;
  const chapterPercentage = paged ? null : chapterScrollPercentage(reader);
  // Always progress through the whole book. A chapter-windowed (archive)
  // EPUB paginates one chapter at a time, so its page fraction is
  // chapter-local and is scaled into the chapter's share of the book.
  const pageFraction = Math.max(0, Math.min(1, (state.pageNumber - 1) / Math.max(1, state.pageCount - 1)));
  const percentage = paged
    ? state.epubArchive
      ? epubBookFraction(chapterIndex, pageFraction, chapterCount)
      : pageFraction
    : state.epubArchive
      ? epubBookFraction(chapterIndex, chapterPercentage, chapterCount)
      : Math.max(0, Math.min(1, (chapterIndex + chapterPercentage) / chapterCount));
  progress.textContent = `第 ${chapterIndex + 1}/${chapterCount} 章 · ${Math.round(percentage * 100)}%`;
  state.readingPercentage = percentage;
  if (typeof syncMobileReadingBar === 'function') syncMobileReadingBar();

  const previous = document.getElementById('btnPreviousChapter');
  const next = document.getElementById('btnNextChapter');
  const scrollChapterHeader = document.getElementById('scrollChapterHeader');
  const scrollChapterFooter = document.getElementById('scrollChapterFooter');
  const scrollPrevious = document.getElementById('btnScrollPreviousChapter');
  const scrollNext = document.getElementById('btnScrollNextChapter');
  const mobilePrevious = document.getElementById('btnMobilePreviousChapter');
  const mobileNext = document.getElementById('btnMobileNextChapter');
  const loading = isEpubChapterLoading();
  const atStart = chapterIndex <= 0;
  const atEnd = chapterIndex >= chapterCount - 1;
  if (previous) previous.disabled = loading || atStart;
  if (next) next.disabled = loading || atEnd;
  const isScrollMode = state.effectiveReadingMode === 'scroll';
  if (scrollChapterHeader) scrollChapterHeader.hidden = !isScrollMode;
  if (scrollChapterFooter) scrollChapterFooter.hidden = !isScrollMode || atEnd;
  if (scrollPrevious) {
    scrollPrevious.hidden = !isScrollMode || atStart;
    scrollPrevious.disabled = loading || atStart;
  }
  if (scrollNext) {
    scrollNext.hidden = !isScrollMode || atEnd;
    scrollNext.disabled = loading || atEnd;
  }
  if (mobilePrevious) mobilePrevious.disabled = loading || atStart;
  if (mobileNext) mobileNext.disabled = loading || atEnd;
}

function navigateChapter(delta) {
  if (state.contentType !== 'epub' || !Number.isInteger(delta) || delta === 0) return false;
  if (isEpubChapterLoading()) return false;
  if (state.epubArchive) {
    const targetIndex = state.epubChapterIndex + Math.sign(delta);
    if (targetIndex < 0 || targetIndex >= state.epubChapterCount) return false;
    return navigateToEpubChapter(targetIndex, { page: 1 });
  }
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  if (!chapters.length) return false;

  updateReadingProgress();
  const currentIndex = Math.max(0, Math.min(chapters.length - 1, state.currentChapterIndex));
  const targetIndex = currentIndex + Math.sign(delta);
  if (targetIndex < 0 || targetIndex >= chapters.length) {
    updateTopbarState();
    return false;
  }

  state.currentChapterIndex = targetIndex;
  navigateToSemanticTarget(chapters[targetIndex]);
  requestAnimationFrame(() => updateReadingProgress({ chapterIndexHint: targetIndex }));
  return true;
}

function restoreReadingLocator(saved) {
  const reader = document.getElementById('reader');
  if (!reader || !saved) return false;

  let chapter = null;
  let target = null;
  if (saved.href) {
    chapter = [...document.querySelectorAll('#article .epub-chapter')]
      .find((chapter) => chapter.dataset.sourcePath === saved.href) || null;
  }
  if (saved.anchor) {
    const anchored = document.getElementById(saved.anchor);
    if (anchored && (!chapter || chapter.contains(anchored))) target = anchored;
  }
  if (!target && saved.textBefore) target = findTextContextNode(saved.textBefore);

  if (state.effectiveReadingMode === 'scroll') {
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return true;
    }
    if (Number.isFinite(saved.chapterPercentage)) {
      const range = Math.max(0, reader.scrollHeight - reader.clientHeight);
      reader.scrollTop = range * Math.max(0, Math.min(1, saved.chapterPercentage));
      return true;
    }
    if (Number.isFinite(saved.percentage)) {
      const range = Math.max(0, reader.scrollHeight - reader.clientHeight);
      reader.scrollTop = range * Math.max(0, Math.min(1, saved.percentage));
      return true;
    }
    if (Number.isFinite(saved.scrollTop)) {
      reader.scrollTop = Math.max(0, saved.scrollTop);
      return true;
    }
    return false;
  }

  let page = Number.isFinite(saved.pageNumber) ? Math.max(1, Math.floor(saved.pageNumber)) : 1;
  if (!Number.isFinite(saved.pageNumber) && (target || chapter)) {
    page = pageNumberForElement(target || chapter);
  } else if (!Number.isFinite(saved.pageNumber) && Number.isFinite(saved.percentage)) {
    page = Math.max(1, Math.round(saved.percentage * Math.max(1, state.pageCount - 1)) + 1);
  }

  page = Math.min(state.pageCount, page);
  return setPageGroup(pageGroupForPage(page), { behavior: 'auto', save: false });
}

function restoreTextScroll() {
  if (state.epubRenderPending) return;
  const saved = savedPosition();
  if (!saved) return;
  if (state.contentType === 'epub' && state.epubArchive && !isEpubChapterLoading()) {
    if (!saved.href) {
      return navigateToEpubChapter(0, { locator: saved });
    }
    try {
      const chapterPath = normalizeZipPath(saved.href);
      const chapterIndex = state.epubArchive.chapterIndexByPath?.[chapterPath];
      if (Number.isInteger(chapterIndex) && chapterIndex !== state.epubChapterIndex) {
        return navigateToEpubChapter(chapterIndex, { locator: saved });
      }
      if (!Number.isInteger(chapterIndex)) {
        return navigateToEpubChapter(0, { locator: saved });
      }
    } catch (error) {
      console.warn('保存的 EPUB 章节路径无效', { href: saved.href, error });
      return navigateToEpubChapter(0, { locator: saved });
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => restoreReadingLocator(saved)));
}

const saveTextScroll = debounce(() => {
  if (!state.currentPath || state.mode !== 'read' || state.contentType === 'pdf') return Promise.resolve();
  const reader = document.getElementById('reader');
  if (!reader) return Promise.resolve();
  updateReadingProgress();
  return savePosition(currentReadingLocator(reader));
}, 250);

let pendingPdfProgress = null;
let pdfProgressTimer = null;

function savePdfProgress(change) {
  if (state.contentType !== 'pdf'
      || !change
      || !/^[a-f0-9]{64}$/i.test(String(change.bookId || ''))
      || !Number.isInteger(change.pageIndex)
      || !Number.isInteger(change.generation)) return;
  pendingPdfProgress = {
    bookId: change.bookId,
    pageIndex: Math.max(0, change.pageIndex),
    generation: change.generation
  };
  if (pdfProgressTimer) clearTimeout(pdfProgressTimer);
  pdfProgressTimer = setTimeout(() => {
    void flushPdfProgressSave().catch((error) => console.error('保存 PDF 阅读进度失败', error));
  }, 250);
}

async function flushPdfProgressSave({ keepalive = false } = {}) {
  if (pdfProgressTimer) clearTimeout(pdfProgressTimer);
  pdfProgressTimer = null;
  const pending = pendingPdfProgress;
  pendingPdfProgress = null;
  if (!pending
      || state.contentType !== 'pdf'
      || state.currentBookId !== pending.bookId
      || pdfReaderController.getCurrentBookId() !== pending.bookId
      || pdfReaderController.getGeneration() !== pending.generation) return;
  const pageCount = pdfReaderController.getPageCount?.() || 0;
  const percentage = pageCount > 1 ? Math.min(1, pending.pageIndex / (pageCount - 1)) : null;
  return savePosition({
    version: 1,
    type: 'pdf',
    pageIndex: pending.pageIndex,
    ...(percentage === null ? {} : { percentage })
  }, { keepalive });
}

window.addEventListener('pagehide', () => {
  void flushPdfProgressSave({ keepalive: true }).catch(() => {});
});
