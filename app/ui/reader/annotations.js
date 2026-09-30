/* BabyReader UI module: reader/annotations */

'use strict';

function createPdfAnnotationId() {
  const crypto = window.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') return null;

  // randomUUID is unavailable on HTTP LAN origins, while getRandomValues remains available.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pdfAnnotationCache(bookId = state.currentBookId) {
  if (typeof loadPdfAnnotations === 'function') return loadPdfAnnotations(bookId);
  const records = state.userState?.books?.[bookId]?.pdfAnnotations;
  return Array.isArray(records) ? records : [];
}

function replacePdfAnnotationCache(bookId, records) {
  if (!bookId || !Array.isArray(records)) return false;
  if (typeof savePdfAnnotations === 'function') return savePdfAnnotations(bookId, records);
  const previous = state.userState.books[bookId] || {};
  state.userState.books[bookId] = { ...previous, pdfAnnotations: records };
  if (state.currentBookId === bookId && state.contentType === 'pdf') renderNotesPanel?.();
  return true;
}

function setPdfAnnotationRendererRecords(bookId, records, generation = null) {
  if (state.currentBookId !== bookId || state.contentType !== 'pdf') return false;
  const controller = window.pdfReaderController;
  if (controller?.getCurrentBookId?.() !== bookId) return false;
  const pageIndex = controller?.getCurrentPageIndex?.();
  const activeGeneration = controller?.getGeneration?.();
  if (!Number.isInteger(activeGeneration)
    || (Number.isInteger(generation) && generation !== activeGeneration)) return false;
  const currentGeneration = activeGeneration;
  const fingerprint = records.find((record) => record?.sourceStale !== true)?.sourceFingerprint;
  if (!fingerprint || !Number.isInteger(currentGeneration)) {
    window.clearPdfAnnotationSurface?.();
    return false;
  }
  const accepted = window.pdfAnnotationRenderer?.setAnnotations({
    bookId,
    generation: currentGeneration,
    sourceFingerprint: fingerprint,
    annotations: records
  }) === true;
  if (!accepted) return false;
  for (const annotation of records) {
    if (annotation.sourceStale) continue;
    for (const target of annotation.targets || []) {
      const page = controller?.getRenderedPageGeometry?.(target.pageIndex);
      if (page) window.renderPdfAnnotationPage?.({
        bookId, generation: currentGeneration, pageIndex: target.pageIndex, scale: page.scale
      });
    }
  }
  return true;
}

async function refreshPdfAnnotations(bookId = state.currentBookId) {
  if (!bookId || typeof window.browserHost?.getPdfAnnotations !== 'function') return [];
  const result = await window.browserHost.getPdfAnnotations(bookId);
  const records = Array.isArray(result?.annotations) ? result.annotations : [];
  if (state.currentBookId === bookId && state.contentType === 'pdf') {
    setPdfAnnotationRendererRecords(bookId, records);
    renderNotesPanel?.();
  }
  return records;
}

function createPdfAnnotationSelectionSession(selection = window.getSelection?.()) {
  if (!selection || selection.isCollapsed || !window.pdfAnnotationGeometry
    || !window.pdfReaderController?.getRenderedPageGeometry) return null;
  const captured = window.pdfAnnotationGeometry.capturePdfAnnotationSelection(
    selection,
    (pageIndex) => window.pdfReaderController.getRenderedPageGeometry(pageIndex)
  );
  if (!captured || captured.bookId !== state.currentBookId
    || state.contentType !== 'pdf') return null;
  let rect = null;
  try { rect = selection.getRangeAt(0).getBoundingClientRect(); } catch { /* use the viewport fallback */ }
  return Object.freeze({
    ...captured,
    format: 'pdf',
    locator: captured.anchor,
    range: selection.getRangeAt(0).cloneRange(),
    menuAnchor: rect && (rect.width || rect.height)
      ? { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
      : { left: window.innerWidth / 2, top: 80, bottom: 100 },
    createdAt: Date.now()
  });
}

async function createPdfAnnotationFromSession(session, {
  kind = 'highlight', style = 'marker', color = state.highlightColor, thought = ''
} = {}) {
  const controller = window.pdfReaderController;
  if (!session || session.format !== 'pdf' || session.bookId !== state.currentBookId
    || state.contentType !== 'pdf' || !Array.isArray(session.targets)
    || typeof window.browserHost?.createPdfAnnotation !== 'function') return null;
  for (const target of session.targets) {
    const geometry = controller?.getRenderedPageGeometry?.(target.pageIndex);
    if (!geometry || geometry.bookId !== session.bookId || geometry.generation !== session.generation) return null;
  }
  const annotationId = createPdfAnnotationId();
  if (!annotationId) return null;
  const payload = {
    version: 1,
    type: 'pdf',
    id: annotationId,
    kind,
    style,
    color,
    text: session.text,
    contextBefore: session.contextBefore || '',
    contextAfter: session.contextAfter || '',
    thought: String(thought || '').slice(0, 4000),
    targets: session.targets
  };
  const result = await window.browserHost.createPdfAnnotation(payload, session.bookId);
  const annotation = result?.annotation;
  if (!annotation || state.currentBookId !== session.bookId || state.contentType !== 'pdf') return null;
  setPdfAnnotationRendererRecords(session.bookId, pdfAnnotationCache(session.bookId), session.generation);
  renderNotesPanel?.();
  updateTopbarState?.();
  return annotation;
}

function annotationViewModel(record, format = record?.type || state.contentType) {
  const annotation = record && typeof record === 'object' ? record : {};
  const isPdf = format === 'pdf' || annotation.type === 'pdf';
  const targets = Array.isArray(annotation.targets) ? annotation.targets : [];
  const firstPage = targets[0]?.pageIndex;
  const lastPage = targets.at(-1)?.pageIndex;
  const chapterInfo = !isPdf && typeof notesChapterInfo === 'function'
    ? notesChapterInfo(annotation)
    : null;
  const locationLabel = isPdf
    ? Number.isInteger(firstPage)
      ? firstPage === lastPage ? `第 ${firstPage + 1} 页` : `第 ${firstPage + 1}–${lastPage + 1} 页`
      : '未定位页面'
    : (chapterInfo?.label || '未定位章节');
  const style = ['marker', 'wave', 'line', 'none'].includes(annotation.style) ? annotation.style : 'marker';
  const thought = String(annotation.thought || annotation.note || '').trim();
  return {
    id: String(annotation.id || ''),
    format: isPdf ? 'pdf' : 'epub',
    kind: annotation.kind === 'thought' ? 'thought' : 'highlight',
    text: String(annotation.text || ''),
    thought,
    style,
    color: ['yellow', 'green', 'blue', 'pink'].includes(annotation.color) ? annotation.color : 'yellow',
    locationLabel,
    locationOrder: isPdf
      ? (Number.isInteger(firstPage) ? firstPage : Number.MAX_SAFE_INTEGER)
      : (chapterInfo?.order ?? Number.MAX_SAFE_INTEGER),
    hasMark: style !== 'none',
    isStale: isPdf && annotation.sourceStale === true,
    canNavigate: !isPdf || annotation.sourceStale !== true,
    canEdit: !isPdf || annotation.sourceStale !== true,
    record: annotation
  };
}

function currentAnnotationAdapter(format = state.contentType) {
  if (format === 'epub') {
    return Object.freeze({
      format,
      captureSelection: (selection) => window.__babyReaderSelectionMenuApi?.captureSelectionSession(selection) || null,
      create: (session, options) => createAnnotationFromSession(session, options),
      edit: (id) => openHighlightEditor(id),
      remove: (id) => deleteHighlightById(id),
      navigate: (record) => navigateToEpubAnnotation(record),
      list: () => loadHighlights()
    });
  }
  if (format === 'pdf') {
    return Object.freeze({
      format,
      captureSelection: (selection) => createPdfAnnotationSelectionSession(selection),
      create: (session, options) => createPdfAnnotationFromSession(session, options),
      edit: (id) => openHighlightEditor(id),
      remove: (id) => deleteHighlightById(id),
      navigate: (record) => navigateToPdfAnnotation(record),
      list: () => pdfAnnotationCache()
    });
  }
  return Object.freeze({
    format: String(format || ''),
    captureSelection: () => null,
    create: async () => null,
    edit: () => false,
    remove: async () => false,
    navigate: async () => false,
    list: () => []
  });
}

window.__babyReaderAnnotationsApi = {
  annotationViewModel,
  currentAnnotationAdapter,
  pdfAnnotationCache,
  refreshPdfAnnotations,
  replacePdfAnnotationCache,
  setPdfAnnotationRendererRecords
};
