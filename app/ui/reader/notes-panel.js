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
  if (typeof loadHighlights !== 'function') return [];
  return loadHighlights().filter((annotation) => annotation?.text || notesAnnotationThought(annotation));
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

async function navigateToAnnotation(annotationId) {
  const annotation = notesAnnotationById(annotationId);
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

function filteredNotesPanelAnnotations(annotations) {
  if (_notesPanelFilter === 'marker') return annotations.filter(notesAnnotationHasMark);
  if (_notesPanelFilter === 'thought') return annotations.filter((annotation) => Boolean(notesAnnotationThought(annotation)));
  return annotations;
}

function sortNotesPanelAnnotations(annotations) {
  return annotations
    .map((annotation, index) => ({ annotation, index, chapter: notesChapterInfo(annotation) }))
    .sort((left, right) => {
      if (_notesPanelSort === 'time') {
        const rightTime = String(right.annotation.updatedAt || right.annotation.createdAt || right.annotation.date || '');
        const leftTime = String(left.annotation.updatedAt || left.annotation.createdAt || left.annotation.date || '');
        return rightTime.localeCompare(leftTime) || left.index - right.index;
      }
      return left.chapter.order - right.chapter.order || left.index - right.index;
    });
}

function createNotesPanelItem(annotation, chapter) {
  const item = document.createElement('article');
  item.className = 'notes-item';
  item.dataset.annotationId = annotation.id || '';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `定位到${chapter.label}的标记`);

  const meta = document.createElement('div');
  meta.className = 'notes-item-meta';
  const chapterLabel = document.createElement('span');
  chapterLabel.className = 'notes-item-chapter';
  chapterLabel.textContent = chapter.label;
  const styleLabel = document.createElement('span');
  styleLabel.className = 'notes-item-style';
  styleLabel.textContent = notesAnnotationStyleLabel(annotation);
  meta.append(chapterLabel, styleLabel);

  const quote = document.createElement('blockquote');
  quote.className = 'notes-item-quote';
  quote.textContent = annotation.text || '';

  item.append(meta, quote);
  const thought = notesAnnotationThought(annotation);
  if (thought) {
    const thoughtElement = document.createElement('p');
    thoughtElement.className = 'notes-item-thought';
    thoughtElement.textContent = `想法：${thought}`;
    item.appendChild(thoughtElement);
  }

  const actions = document.createElement('div');
  actions.className = 'notes-item-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.dataset.notesAction = 'edit';
  edit.setAttribute('aria-label', `编辑${thought ? '想法' : '批注'}`);
  edit.textContent = '编辑';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.notesAction = 'delete';
  remove.setAttribute('aria-label', '删除批注');
  remove.textContent = '删除';
  actions.append(edit, remove);
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
  const markCount = annotations.filter(notesAnnotationHasMark).length;
  const thoughtCount = annotations.filter((annotation) => Boolean(notesAnnotationThought(annotation))).length;
  summary.textContent = `${markCount} 条标记 · ${thoughtCount} 条想法`;

  document.querySelectorAll('[data-notes-filter]').forEach((button) => {
    const selected = button.dataset.notesFilter === _notesPanelFilter;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  });
  const sort = document.getElementById('notesSort');
  if (sort && sort.value !== _notesPanelSort) sort.value = _notesPanelSort;

  list.replaceChildren();
  const visible = sortNotesPanelAnnotations(filteredNotesPanelAnnotations(annotations));
  for (const { annotation, chapter } of visible) {
    list.appendChild(createNotesPanelItem(annotation, chapter));
  }
  emptyState.hidden = visible.length > 0;
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
    void navigateToAnnotation(item.dataset.annotationId);
  });
  document.addEventListener('keydown', (event) => {
    const item = event.target.closest?.('#notesList [data-annotation-id]');
    if (!item || !['Enter', ' '].includes(event.key)) return;
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
