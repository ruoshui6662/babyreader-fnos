/* BabyReader UI module: reader/progress */

'use strict';

function ensureTocElement() {
  return document.getElementById('toc');
}

function renderToc() {
  const toc = ensureTocElement();
  const list = document.getElementById('tocList');
  const emptyState = document.getElementById('tocEmptyState');
  const hasToc = state.contentType === 'epub' && state.toc.length > 0;

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

function currentReadingLocator(reader) {
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  const readerRect = reader.getBoundingClientRect();
  const paged = state.effectiveReadingMode !== 'scroll';
  const viewportTop = readerRect.top + 8;
  const viewportLeft = readerRect.left + 8;
  const viewportRight = readerRect.right - 8;
  let chapter = chapters[0] || null;

  if (paged) {
    chapter = chapters.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.right >= viewportLeft && rect.left <= viewportRight;
    }) || chapter;
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
  const scrollRange = Math.max(1, reader.scrollHeight - reader.clientHeight);
  const pageRange = Math.max(1, state.pageCount - 1);
  const percentage = paged
    ? Math.max(0, Math.min(1, (state.pageNumber - 1) / pageRange))
    : Math.max(0, Math.min(1, reader.scrollTop / scrollRange));

  return {
    version: 2,
    type: 'semantic-position',
    href: chapter?.dataset.sourcePath || '',
    anchor: anchor?.id || '',
    textBefore: normalizeTextContext(visibleNode?.textContent).slice(0, 120),
    pageNumber: paged ? state.pageNumber : null,
    scrollTop: Math.max(0, reader.scrollTop),
    percentage
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
  const percentage = paged
    ? Math.max(0, Math.min(1, (state.pageNumber - 1) / Math.max(1, state.pageCount - 1)))
    : Math.max(0, Math.min(1, reader.scrollTop / Math.max(1, reader.scrollHeight - reader.clientHeight)));
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  // In paged mode the visible window is the article's own border box (the
  // reader adds viewport insets the track never occupies); in scroll mode it
  // is the reader's vertical viewport.
  const visibleRect = paged
    ? document.getElementById('article')?.getBoundingClientRect() ?? reader.getBoundingClientRect()
    : reader.getBoundingClientRect();
  const viewportTop = visibleRect.top + 8;
  const viewportLeft = visibleRect.left + 8;
  const viewportRight = visibleRect.right - 8;
  const chapterIndexHint = typeof options === 'object' && Number.isInteger(options?.chapterIndexHint)
    ? Math.max(0, Math.min(chapters.length - 1, options.chapterIndexHint))
    : null;
  let chapterIndex = chapterIndexHint ?? 0;
  if (chapterIndexHint === null) {
    for (let index = 0; index < chapters.length; index += 1) {
      const rect = chapters[index].getBoundingClientRect();
      if (paged) {
        if (rect.right >= viewportLeft && rect.left <= viewportRight) {
          chapterIndex = index;
          break;
        }
      } else if (rect.top <= viewportTop) {
        chapterIndex = index;
      } else {
        break;
      }
    }
  }
  state.currentChapterIndex = chapterIndex;
  progress.textContent = `${Math.round(percentage * 100)}% · ${chapterIndex + 1}/${Math.max(1, chapters.length)}`;

  const previous = document.getElementById('btnPreviousChapter');
  const next = document.getElementById('btnNextChapter');
  const mobilePrevious = document.getElementById('btnMobilePreviousChapter');
  const mobileNext = document.getElementById('btnMobileNextChapter');
  const atStart = chapterIndex <= 0;
  const atEnd = chapterIndex >= chapters.length - 1;
  if (previous) previous.disabled = atStart;
  if (next) next.disabled = atEnd;
  if (mobilePrevious) mobilePrevious.disabled = atStart;
  if (mobileNext) mobileNext.disabled = atEnd;
}

function navigateChapter(delta) {
  if (state.contentType !== 'epub' || !Number.isInteger(delta) || delta === 0) return false;
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

  let target = null;
  if (saved.href) {
    target = [...document.querySelectorAll('#article .epub-chapter')]
      .find((chapter) => chapter.dataset.sourcePath === saved.href) || null;
  }
  if (saved.anchor) {
    const anchored = document.getElementById(saved.anchor);
    if (anchored && (!target || target.contains(anchored))) target = anchored;
  }
  if (!target && saved.textBefore) target = findTextContextNode(saved.textBefore);

  if (state.effectiveReadingMode === 'scroll') {
    if (target) {
      target.scrollIntoView({ block: 'start' });
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
  if (target) {
    page = pageNumberForElement(target);
  } else if (Number.isFinite(saved.percentage)) {
    page = Math.max(1, Math.round(saved.percentage * Math.max(1, state.pageCount - 1)) + 1);
  }

  page = Math.min(state.pageCount, page);
  return setPageGroup(pageGroupForPage(page), { behavior: 'auto', save: false });
}

function restoreTextScroll() {
  const saved = savedPosition();
  if (!saved) return;
  requestAnimationFrame(() => requestAnimationFrame(() => restoreReadingLocator(saved)));
}

const saveTextScroll = debounce(() => {
  if (!state.currentPath || state.mode !== 'read') return Promise.resolve();
  const reader = document.getElementById('reader');
  if (!reader) return Promise.resolve();
  updateReadingProgress();
  return savePosition(currentReadingLocator(reader));
}, 250);
