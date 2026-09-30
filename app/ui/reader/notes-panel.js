/* BabyReader UI module: reader/notes-panel */

'use strict';

let _notesPanelFilter = 'all';
let _notesPanelSort = 'chapter';
let _notesPanelBound = false;

function notesChapterPathKey(value) {
  if (typeof exportChapterPathKey === 'function') return exportChapterPathKey(value);
  let path = String(value || '').trim();
  if (path.startsWith('epub-path:')) path = path.slice('epub-path:'.length);
  return path.split('#', 1)[0].replace(/\\/g, '/').replace(/^\.\/+/, '').toLocaleLowerCase();
}

function notesAnnotationThought(annotation) {
  return String(annotation?.thought || annotation?.note || '').trim();
}

function notesAnnotationHasMark(annotation) {
  return annotation?.style !== 'none';
}

function notesChapterInfo(annotation) {
  const key = notesChapterPathKey(
    annotation?.chapterHref
      || annotation?.domRange?.chapterHref
      || annotation?.locatorData?.chapterHref
  );
  const toc = Array.isArray(state.toc) ? state.toc : [];
  const index = toc.findIndex((item) => notesChapterPathKey(item?.target) === key);
  if (index >= 0) {
    return {
      label: String(toc[index].label || '').trim() || '未命名章节',
      order: index
    };
  }
  return {
    label: key ? (key.split('/').pop() || '未命名章节').replace(/\.(?:x?html?|xml)$/i, '') : '未定位章节',
    order: Number.MAX_SAFE_INTEGER
  };
}

function notesAnnotationStyleLabel(annotation) {
  return ({ marker: '马克笔', wave: '波浪线', line: '直线', none: '想法' })[annotation?.style] || '标记';
}

function notesPanelAnnotations() {
  const adapter = currentAnnotationAdapter(state.contentType);
  return adapter.list().filter((annotation) => annotation?.text || notesAnnotationThought(annotation));
}

function notesAnnotationById(annotationId) {
  const id = String(annotationId || '');
  return notesPanelAnnotations().find((annotation) => String(annotation.id || '') === id) || null;
}

function notesAnnotationChapterIndex(annotation) {
  const archive = state.epubArchive;
  if (!archive?.chapterIndexByPath) return -1;
  const key = notesChapterPathKey(
    annotation?.chapterHref
      || annotation?.domRange?.chapterHref
      || annotation?.locatorData?.chapterHref
  );
  if (!key) return -1;
  const entry = Object.entries(archive.chapterIndexByPath)
    .find(([path]) => notesChapterPathKey(path) === key);
  return Number.isInteger(entry?.[1]) ? entry[1] : -1;
}

function notesRangeTarget(range) {
  const container = range?.commonAncestorContainer;
  if (!container) return null;
  return container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
}

function setNotesItemError(annotationId, message = '') {
  const item = [...document.querySelectorAll('#notesList [data-annotation-id]')]
    .find((candidate) => candidate.dataset.annotationId === String(annotationId || ''));
  if (!item) return;
  item.querySelector('.notes-item-error')?.remove();
  if (!message) {
    delete item.dataset.notesError;
    return;
  }
  item.dataset.notesError = 'true';
  const error = document.createElement('p');
  error.className = 'notes-item-error';
  error.textContent = message;
  item.appendChild(error);
}

async function navigateToEpubAnnotation(annotation) {
  if (!annotation || state.contentType !== 'epub') return false;
  setNotesItemError(annotation.id, '');
  if (typeof isEpubChapterLoading === 'function' && isEpubChapterLoading()) {
    setNotesItemError(annotation.id, '阅读器正在切换章节，请稍后重试');
    return false;
  }

  const chapterIndex = notesAnnotationChapterIndex(annotation);
  if (chapterIndex < 0) {
    setNotesItemError(annotation.id, '原文位置已变化');
    return false;
  }

  const currentChapter = Number.isInteger(state.epubChapterIndex)
    ? state.epubChapterIndex
    : -1;
  if (chapterIndex !== currentChapter) {
    const rendered = await navigateToEpubChapter(chapterIndex, { page: 1 });
    if (!rendered) {
      setNotesItemError(annotation.id, '章节加载失败，请重试');
      return false;
    }
  }

  const range = rangeFromHighlight(annotation);
  const target = notesRangeTarget(range);
  if (!range || !target || !navigateToSemanticTarget(target)) {
    setNotesItemError(annotation.id, '原文位置已变化');
    return false;
  }

  redrawDomHighlights();
  updateReadingProgress({ chapterIndexHint: chapterIndex });
  return true;
}

function nextPdfAnnotationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function waitForPdfAnnotationGeometry(controller, pageIndex, bookId, generation) {
  // goToPdfPage schedules a render; wait for the current frame instead of
  // projecting against a canvas/text layer that may still belong to old scale.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await nextPdfAnnotationFrame();
    if (state.contentType !== 'pdf' || state.currentBookId !== bookId
        || window.pdfReaderController !== controller
        || controller.getCurrentBookId?.() !== bookId
        || controller.getGeneration?.() !== generation) return { stale: true };
    const geometry = controller.getRenderedPageGeometry?.(pageIndex);
    if (geometry?.bookId === bookId && geometry.generation === generation
        && geometry.pageIndex === pageIndex && geometry.pageElement?.isConnected
        && geometry.viewport && Array.isArray(geometry.pageView)) {
      return { geometry };
    }
  }
  return null;
}

function showPdfAnnotationTarget(pageElement, projectedQuads) {
  pageElement.querySelector('.pdf-note-navigation-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'pdf-note-navigation-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  for (const points of projectedQuads.slice(0, 40)) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left;
    const height = Math.max(...ys) - top;
    if (!(width > 0) || !(height > 0)) continue;
    const target = document.createElement('span');
    target.className = 'pdf-note-navigation-highlight';
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    overlay.appendChild(target);
  }
  if (!overlay.childElementCount) return false;
  pageElement.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), 1500);
  return true;
}

function scrollPdfAnnotationTarget(host, geometry, projectedQuads) {
  if (!host || !geometry?.pageElement || !projectedQuads.length) return false;
  const pageRect = geometry.pageElement.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const points = projectedQuads[0];
  const targetTop = pageRect.top + Math.min(...points.map(([, y]) => y));
  const targetCenterX = pageRect.left + (Math.min(...points.map(([x]) => x))
    + Math.max(...points.map(([x]) => x))) / 2;
  const hostHeight = host.clientHeight || window.innerHeight || 800;
  const safeTop = hostRect.top + Math.max(24, Math.min(96, hostHeight * 0.18));
  const pageWidth = pageRect.width || geometry.viewport.width || 0;
  const horizontalDelta = pageWidth > (host.clientWidth || window.innerWidth)
    ? targetCenterX - (hostRect.left + (host.clientWidth || window.innerWidth) / 2)
    : 0;
  const options = {
    top: targetTop - safeTop,
    left: horizontalDelta,
    behavior: 'auto'
  };
  if (typeof host.scrollBy === 'function') host.scrollBy(options);
  else {
    host.scrollTop += options.top;
    host.scrollLeft += options.left;
  }
  return true;
}

async function navigateToPdfAnnotation(annotation) {
  if (!annotation || state.contentType !== 'pdf') return false;
  setNotesItemError(annotation.id, '');
  if (annotation.sourceStale === true) {
    setNotesItemError(annotation.id, '原文已变化，不能定位；可删除旧标记');
    return false;
  }
  const controller = window.pdfReaderController;
  const pageCount = controller?.getPageCount?.() || 0;
  const targets = Array.isArray(annotation.targets) ? annotation.targets : [];
  const target = targets.find((item) => Number.isInteger(item?.pageIndex)
      && item.pageIndex >= 0 && item.pageIndex < pageCount && Array.isArray(item.quads) && item.quads.length)
    || targets.find((item) => Number.isInteger(item?.pageIndex)
      && item.pageIndex >= 0 && item.pageIndex < pageCount);
  const pageIndex = target?.pageIndex;
  if (!Number.isInteger(pageIndex) || !controller || !state.currentBookId
      || controller.getCurrentBookId?.() !== state.currentBookId) {
    setNotesItemError(annotation.id, '原文位置已变化');
    return false;
  }
  const bookId = state.currentBookId;
  const generation = controller.getGeneration?.();
  if (!controller.goToPdfPage(pageIndex)) {
    setNotesItemError(annotation.id, '页面加载失败，请重试');
    return false;
  }

  if (!Array.isArray(target.quads) || target.quads.length === 0
      || !Number.isInteger(generation)) {
    setNotesItemError(annotation.id, `已定位到第 ${pageIndex + 1} 页；精确原文位置不可用`);
    return true;
  }
  const ready = await waitForPdfAnnotationGeometry(controller, pageIndex, bookId, generation);
  if (ready?.stale) {
    setNotesItemError(annotation.id, '书籍或页面已切换，已取消旧位置定位');
    return false;
  }
  const geometry = ready?.geometry;
  const projectedQuads = geometry && window.pdfAnnotationGeometry?.projectPdfAnnotationTarget(target, geometry);
  if (!geometry || !Array.isArray(projectedQuads) || !projectedQuads.length) {
    setNotesItemError(annotation.id, `已定位到第 ${pageIndex + 1} 页；精确原文位置暂不可用`);
    return true;
  }
  const host = document.getElementById('pdfPages');
  if (!scrollPdfAnnotationTarget(host, geometry, projectedQuads)) {
    setNotesItemError(annotation.id, `已定位到第 ${pageIndex + 1} 页；精确原文位置暂不可用`);
    return true;
  }
  showPdfAnnotationTarget(geometry.pageElement, projectedQuads);
  return true;
}

async function navigateToAnnotation(annotationId) {
  const annotation = notesAnnotationById(annotationId);
  if (!annotation) return false;
  return currentAnnotationAdapter(state.contentType).navigate(annotation);
}

function filteredNotesPanelAnnotations(annotations) {
  if (_notesPanelFilter === 'marker') return annotations.filter(notesAnnotationHasMark);
  if (_notesPanelFilter === 'thought') return annotations.filter((annotation) => Boolean(notesAnnotationThought(annotation)));
  return annotations;
}

function sortNotesPanelAnnotations(annotations) {
  return annotations
    .map((annotation, index) => ({ annotation, index, view: annotationViewModel(annotation, state.contentType) }))
    .sort((left, right) => {
      if (_notesPanelSort === 'time') {
        const rightTime = String(right.annotation.updatedAt || right.annotation.createdAt || right.annotation.date || '');
        const leftTime = String(left.annotation.updatedAt || left.annotation.createdAt || left.annotation.date || '');
        return rightTime.localeCompare(leftTime) || left.index - right.index;
      }
      return left.view.locationOrder - right.view.locationOrder || left.index - right.index;
    });
}

function createNotesPanelItem(annotation, chapter) {
  const view = annotationViewModel(annotation, state.contentType);
  const item = document.createElement('article');
  item.className = 'notes-item';
  item.dataset.annotationId = view.id;
  item.dataset.annotationNavigable = view.canNavigate ? 'true' : 'false';
  item.tabIndex = view.canNavigate ? 0 : -1;
  item.setAttribute('role', 'group');
  item.setAttribute('aria-label', view.canNavigate ? `定位到${view.locationLabel}的标记` : `${view.locationLabel}，原文已变化`);
  if (view.isStale) item.setAttribute('aria-disabled', 'true');

  const meta = document.createElement('div');
  meta.className = 'notes-item-meta';
  const chapterLabel = document.createElement('span');
  chapterLabel.className = 'notes-item-chapter';
  chapterLabel.textContent = view.locationLabel;
  const styleLabel = document.createElement('span');
  styleLabel.className = 'notes-item-style';
  styleLabel.textContent = notesAnnotationStyleLabel(annotation);
  meta.append(chapterLabel, styleLabel);

  const quote = document.createElement('blockquote');
  quote.className = 'notes-item-quote';
  quote.textContent = annotation.text || '';

  item.append(meta, quote);
  if (view.isStale) {
    const stale = document.createElement('p');
    stale.className = 'notes-item-stale';
    stale.textContent = '原文已变化，不能定位或编辑';
    item.appendChild(stale);
  }
  const thought = view.thought;
  if (thought) {
    const thoughtElement = document.createElement('p');
    thoughtElement.className = 'notes-item-thought';
    thoughtElement.textContent = `想法：${thought}`;
    item.appendChild(thoughtElement);
  }

  const actions = document.createElement('div');
  actions.className = 'notes-item-actions';
  if (view.canEdit) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.notesAction = 'edit';
    edit.setAttribute('aria-label', `编辑${thought ? '想法' : '批注'}`);
    edit.textContent = '编辑';
    actions.append(edit);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.notesAction = 'delete';
  remove.setAttribute('aria-label', '删除批注');
  remove.textContent = '删除';
  actions.append(remove);
  item.appendChild(actions);
  return item;
}

function renderNotesPanel() {
  const panel = document.getElementById('readerPanelNotes');
  const list = document.getElementById('notesList');
  const emptyState = document.getElementById('notesEmptyState');
  const summary = document.getElementById('notesPanelSummary');
  if (!panel || !list || !emptyState || !summary) return false;

  const annotations = notesPanelAnnotations();
  const markCount = annotations.filter((annotation) => annotationViewModel(annotation, state.contentType).hasMark).length;
  const thoughtCount = annotations.filter((annotation) => Boolean(notesAnnotationThought(annotation))).length;
  summary.textContent = `${markCount} 条标记 · ${thoughtCount} 条想法`;

  document.querySelectorAll('[data-notes-filter]').forEach((button) => {
    const selected = button.dataset.notesFilter === _notesPanelFilter;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  });
  const sort = document.getElementById('notesSort');
  const locationOption = sort?.querySelector('option[value="chapter"]');
  if (locationOption) locationOption.textContent = state.contentType === 'pdf' ? '按页' : '按章节';
  if (sort && sort.value !== _notesPanelSort) sort.value = _notesPanelSort;
  if (typeof syncCustomSelectValue === 'function') syncCustomSelectValue(sort);

  list.replaceChildren();
  const visible = sortNotesPanelAnnotations(filteredNotesPanelAnnotations(annotations));
  for (const { annotation, view } of visible) {
    list.appendChild(createNotesPanelItem(annotation, view));
  }
  emptyState.hidden = visible.length > 0;
  emptyState.textContent = annotations.length ? '当前筛选下没有内容，试试其他筛选。' : '还没有标记或想法。选中正文后，可划线或写下想法。';
  list.hidden = visible.length === 0;
  return true;
}

function setNotesPanelFilter(filter) {
  if (!['all', 'marker', 'thought'].includes(filter)) return false;
  _notesPanelFilter = filter;
  return renderNotesPanel();
}

function setNotesPanelSort(sort) {
  if (!['chapter', 'time'].includes(sort)) return false;
  _notesPanelSort = sort;
  return renderNotesPanel();
}

function setupNotesPanel() {
  if (_notesPanelBound) return;
  _notesPanelBound = true;
  document.addEventListener('click', (event) => {
    const filter = event.target.closest?.('[data-notes-filter]');
    if (!filter) return;
    event.preventDefault();
    setNotesPanelFilter(filter.dataset.notesFilter);
  });
  document.addEventListener('click', (event) => {
    const action = event.target.closest?.('#notesList [data-notes-action]');
    if (action) {
      const item = action.closest('[data-annotation-id]');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      const id = item.dataset.annotationId;
      if (action.dataset.notesAction === 'edit') {
        openHighlightEditor(id);
      } else if (action.dataset.notesAction === 'delete' && typeof deleteHighlightById === 'function') {
        void deleteHighlightById(id).then((deleted) => {
          if (!deleted) return;
          const focusTarget = document.querySelector('#notesList [data-annotation-id]')
            || document.getElementById('drawerTabNotes');
          focusTarget?.focus?.();
        });
      }
      return;
    }
    const item = event.target.closest?.('#notesList [data-annotation-id]');
    if (!item || event.target.closest('button, a, input, textarea, select')) return;
    if (item.dataset.annotationNavigable !== 'true') return;
    void navigateToAnnotation(item.dataset.annotationId);
  });
  document.addEventListener('keydown', (event) => {
    if (event.target.closest?.('#notesList button, #notesList a, #notesList input, #notesList textarea, #notesList select')) return;
    const item = event.target.closest?.('#notesList [data-annotation-id]');
    if (!item || item.dataset.annotationNavigable !== 'true' || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    void navigateToAnnotation(item.dataset.annotationId);
  });
  document.getElementById('notesSort')?.addEventListener('change', (event) => {
    setNotesPanelSort(event.target.value);
  });
  renderNotesPanel();
}

window.__babyReaderNotesPanelApi = {
  renderNotesPanel,
  setNotesPanelFilter,
  setNotesPanelSort,
  setupNotesPanel,
  navigateToAnnotation,
  createNotesPanelItem
};
