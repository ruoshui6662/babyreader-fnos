/* BabyReader UI module: reader/pdf */

'use strict';

const PDFJS_ASSET_ROOT = '/app/babyreader-fnos/vendor/pdfjs/';
const MAX_PDF_PAGE_COUNT = 10000;
const MAX_CANVAS_PIXELS = 16000000;
const MAX_CANVAS_EDGE = 8192;
const MAX_PDF_TEXT_LAYER_CHARACTERS = 250000;
const MAX_CACHED_PDF_PAGE_SIZES = 128;
const PDF_LAZY_FRAME_PAGE_THRESHOLD = 250;
const MAX_PDF_SELECTION_PAGES = window.pdfAnnotationGeometry?.MAX_SELECTION_PAGES || 8;
const MAX_PDF_SELECTION_CANVAS_PIXELS = 32000000;
const PDF_SPREAD_GAP = 16; // Keep in sync with .pdf-spread gap in styles.css.
const PDFJS_OPTIONS = Object.freeze({
  rangeChunkSize: 64 * 1024,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: false,
  isEvalSupported: false,
  enableScripting: false,
  enableXfa: false,
  useWorkerFetch: false,
  cMapUrl: `${PDFJS_ASSET_ROOT}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_ASSET_ROOT}standard_fonts/`,
  wasmUrl: `${PDFJS_ASSET_ROOT}wasm/`,
  iccUrl: `${PDFJS_ASSET_ROOT}iccs/`,
  imageResourcesPath: `${PDFJS_ASSET_ROOT}image_decoders/`
});

function pdfSpreadForPage(pageIndex, pageCount) {
  if (!Number.isInteger(pageIndex) || !Number.isInteger(pageCount)
      || pageCount < 1 || pageIndex < 0 || pageIndex >= pageCount) {
    throw new RangeError('Invalid PDF page index or count');
  }
  const firstPageIndex = pageIndex === 0 ? 0 : 1 + 2 * Math.floor((pageIndex - 1) / 2);
  const pageIndices = [firstPageIndex];
  if (firstPageIndex > 0 && firstPageIndex + 1 < pageCount) pageIndices.push(firstPageIndex + 1);
  return { firstPageIndex, pageIndices };
}

function createPdfReaderController({
  document: doc = document,
  window: win = window,
  getDocument,
  onPageChange = () => {},
  getContentUrl = (bookId) => `${API_PREFIX}/books/${encodeURIComponent(bookId)}/content`,
  onOutline = (outline) => {
    state.toc = outline;
    if (typeof renderToc === 'function') renderToc();
  },
  maxOutlineEntries = 500
} = {}) {
  let generation = 0;
  let currentBookId = null;
  let loadingTask = null;
  let pdfDocument = null;
  let pdfJsApi = null;
  let observer = null;
  let scale = 1;
  let zoomMode = 'auto';
  let zoomRevision = 0;
  let fitRequestId = 0;
  let defaultPageSize = null;
  let destroyed = true;
  let layoutPreference = 'continuous';
  let effectiveLayoutMode = 'continuous';
  let scrollGuardRevision = 0;
  let scrollGuardActive = false;
  let scrollFrame = 0;
  let selectionFrame = 0;
  let renderRevision = 0;
  let frameSequence = 0;
  let renderScheduler = null;
  let lazyPageFrames = false;
  let lastViewportTop = 0;
  let scrollDirection = 'down';
  const pages = new Map();
  const pageSizes = new Map();
  const pendingPages = new Map();
  const renderTasks = new Map();
  const renderedPages = new Map();
  const materializedPages = new Set();

  const surface = () => doc.getElementById('pdfReaderSurface');
  const reader = () => doc.getElementById('reader');
  const pageHost = () => doc.getElementById('pdfPages');
  const status = () => doc.getElementById('pdfReaderStatus');

  function availablePageWidth(fallbackWidth = 840) {
    const host = pageHost();
    const style = host ? win.getComputedStyle(host) : null;
    const horizontalPadding = (Number.parseFloat(style?.paddingLeft) || 0)
      + (Number.parseFloat(style?.paddingRight) || 0);
    return Math.max(1, (host?.clientWidth || fallbackWidth) - horizontalPadding);
  }

  function setStatus(message, isError = false) {
    const target = status();
    if (!target) return;
    target.textContent = message;
    target.hidden = !message || (!isError && /^\d+ 页$/.test(message));
    target.classList.toggle('is-error', Boolean(isError));
    target.setAttribute('role', isError ? 'alert' : 'status');
  }

  function announcePdfPosition() {
    if (!pdfDocument || destroyed) return;
    const target = doc.getElementById('pdfReaderAnnouncement');
    if (!target) return;
    const pageIndex = Number(surface()?.dataset.currentPage) || 0;
    target.textContent = `第 ${pageIndex + 1} / ${pdfDocument.numPages} 页，缩放 ${Math.round(scale * 100)}%`;
  }

  function syncPdfToolbarMode() {
    const controls = doc.querySelector('.pdf-reader-controls');
    const mode = doc.documentElement.dataset.readerSurface === 'mobile' || win.innerWidth <= 430
      ? 'mobile' : win.innerWidth <= 1100 ? 'compact' : 'wide';
    if (controls) controls.dataset.pdfToolbarMode = mode;
    doc.body.dataset.pdfToolbarMode = mode;
    return mode;
  }

  function clearPageState() {
    win.clearPdfAnnotationSurface?.();
    renderScheduler?.destroy();
    renderScheduler = null;
    scrollGuardRevision += 1;
    scrollGuardActive = false;
    if (scrollFrame) {
      win.cancelAnimationFrame?.(scrollFrame);
      scrollFrame = 0;
    }
    if (selectionFrame) {
      win.cancelAnimationFrame?.(selectionFrame);
      selectionFrame = 0;
    }
    observer?.disconnect();
    observer = null;
    for (const task of renderTasks.values()) {
      try { task.cancel(); } catch { /* A render may already have completed. */ }
    }
    renderTasks.clear();
    pendingPages.clear();
    renderedPages.clear();
    materializedPages.clear();
    pages.clear();
    pageSizes.clear();
    lastViewportTop = 0;
    scrollDirection = 'down';
    defaultPageSize = null;
    lazyPageFrames = false;
    const host = pageHost();
    host?.style.removeProperty('--pdf-placeholder-width');
    host?.style.removeProperty('--pdf-placeholder-aspect');
    host?.replaceChildren();
    host?.removeAttribute('data-pdf-layout');
    effectiveLayoutMode = 'continuous';
  }

  async function destroyPdfReader() {
    generation += 1;
    destroyed = true;
    currentBookId = null;
    const task = loadingTask;
    const docToDestroy = pdfDocument;
    loadingTask = null;
    pdfDocument = null;
    clearPageState();
    try { await task?.destroy?.(); } catch { /* Teardown is best effort and idempotent. */ }
    if (docToDestroy && docToDestroy !== task?.document) {
      try { await docToDestroy.destroy?.(); } catch { /* PDF.js can reject during cancellation. */ }
    }
    const pdfSurface = surface();
    if (pdfSurface) {
      pdfSurface.hidden = true;
      pdfSurface.removeAttribute('data-book-id');
      pdfSurface.removeAttribute('data-current-page');
    }
    doc.body.classList.remove('is-pdf-reader');
    const article = doc.getElementById('article');
    if (article) article.style.display = '';
  }

  function makePageSlots(numPages) {
    const host = pageHost();
    if (!host) throw new Error('PDF 阅读区域未初始化');
    const fragment = doc.createDocumentFragment();
    lazyPageFrames = numPages > PDF_LAZY_FRAME_PAGE_THRESHOLD;
    for (let pageIndex = 0; pageIndex < numPages; pageIndex += 1) {
      const wrapper = doc.createElement('section');
      wrapper.className = 'pdf-page';
      wrapper.dataset.pageIndex = String(pageIndex);
      wrapper.setAttribute('aria-label', `第 ${pageIndex + 1} 页`);
      wrapper.setAttribute('role', 'group');
      if (!lazyPageFrames) ensurePageFrameElements(wrapper, pageIndex);
      fragment.append(wrapper);
      pages.set(pageIndex, wrapper);
    }
    host.replaceChildren(fragment);
  }

  function ensurePageFrameElements(wrapper, pageIndex) {
    if (!wrapper) return null;
    let canvas = wrapper.querySelector('.pdf-page-canvas');
    let textLayer = wrapper.querySelector('.pdf-page-text-layer');
    if (!canvas) {
      canvas = doc.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.setAttribute('aria-label', `PDF 第 ${pageIndex + 1} 页`);
      wrapper.append(canvas);
    }
    if (!textLayer) {
      textLayer = doc.createElement('div');
      textLayer.className = 'textLayer pdf-page-text-layer';
      wrapper.append(textLayer);
    }
    materializedPages.add(pageIndex);
    return { canvas, textLayer };
  }

  function dematerializePageFrame(pageIndex) {
    if (!lazyPageFrames) return false;
    const wrapper = pages.get(pageIndex);
    const textLayer = wrapper?.querySelector('.pdf-page-text-layer');
    if (!wrapper || selectionIntersectsTextLayer(textLayer)) return false;
    win.clearPdfAnnotationPage?.({ bookId: currentBookId, generation, pageIndex });
    wrapper.replaceChildren();
    wrapper.dataset.textLayerState = 'idle';
    wrapper.dataset.renderState = 'idle';
    wrapper.removeAttribute('data-frame-id');
    wrapper.setAttribute('aria-busy', 'false');
    materializedPages.delete(pageIndex);
    return true;
  }

  function captureReadingAnchor(pageIndex = Number(surface()?.dataset.currentPage) || 0) {
    const host = pageHost();
    const wrapper = pages.get(pageIndex);
    if (!host || !wrapper) return null;
    const hostRect = host.getBoundingClientRect();
    const pageRect = wrapper.getBoundingClientRect();
    const height = pageRect.height || pageRect.bottom - pageRect.top;
    if (!Number.isFinite(height) || height <= 0) return null;
    const readingLine = Math.min(120, Math.max(24, Math.round((host.clientHeight || 800) * 0.2)));
    const pageOffset = pageRect.top - hostRect.top;
    if (pageOffset >= -8 && pageOffset <= readingLine) {
      return { pageIndex, normalizedY: 0, viewportOffset: pageOffset };
    }
    return {
      pageIndex,
      normalizedY: Math.max(0, Math.min(1, (hostRect.top + readingLine - pageRect.top) / height)),
      viewportOffset: readingLine
    };
  }

  function restoreReadingAnchor(anchor) {
    if (!anchor) return false;
    const host = pageHost();
    const wrapper = pages.get(anchor.pageIndex);
    if (!host || !wrapper) return false;
    const hostRect = host.getBoundingClientRect();
    const pageRect = wrapper.getBoundingClientRect();
    const height = pageRect.height || pageRect.bottom - pageRect.top;
    if (!Number.isFinite(height) || height <= 0) return false;
    const normalizedY = Number.isFinite(anchor.normalizedY) && anchor.normalizedY >= 0 && anchor.normalizedY <= 1
      ? anchor.normalizedY : 0;
    const viewportOffset = Number.isFinite(anchor.viewportOffset) ? anchor.viewportOffset : 0;
    host.scrollTop += pageRect.top + normalizedY * height - hostRect.top - viewportOffset;
    return true;
  }

  function syncPdfLayout() {
    const host = pageHost();
    if (!host || !pdfDocument) return false;
    const nextMode = layoutPreference === 'double' && availablePageWidth() < 900
      ? 'single' : layoutPreference;
    if (nextMode === effectiveLayoutMode && host.dataset.pdfLayout === nextMode) return false;
    const hadLayout = host.hasAttribute('data-pdf-layout');
    const selectedPage = Number(surface()?.dataset.currentPage) || 0;
    const anchor = hadLayout ? captureReadingAnchor(selectedPage) : null;
    const fragment = doc.createDocumentFragment();
    if (nextMode === 'double') {
      for (let pageIndex = 0; pageIndex < pdfDocument.numPages;) {
        const spread = pdfSpreadForPage(pageIndex, pdfDocument.numPages);
        const row = doc.createElement('div');
        row.className = 'pdf-spread';
        row.dataset.spreadStart = String(spread.firstPageIndex);
        for (const index of spread.pageIndices) row.appendChild(pages.get(index));
        fragment.appendChild(row);
        pageIndex = spread.pageIndices.at(-1) + 1;
      }
    } else {
      for (const page of pages.values()) fragment.appendChild(page);
    }
    host.replaceChildren(fragment);
    host.dataset.pdfLayout = nextMode;
    effectiveLayoutMode = nextMode;
    updatePageControls(selectedPage, { persist: false });
    if (hadLayout) restoreReadingAnchor(anchor);
    if (hadLayout) {
      const revision = ++scrollGuardRevision;
      const expectedGeneration = generation;
      scrollGuardActive = true;
      win.requestAnimationFrame(() => {
        if (destroyed || revision !== scrollGuardRevision || expectedGeneration !== generation) return;
        restoreReadingAnchor(anchor);
        win.requestAnimationFrame(() => {
          if (revision === scrollGuardRevision && expectedGeneration === generation) scrollGuardActive = false;
        });
      });
    }
    renderVisiblePdfPages();
    return true;
  }

  function setLayoutMode(mode) {
    if (!['continuous', 'single', 'double'].includes(mode)) return false;
    layoutPreference = mode;
    fitRequestId += 1;
    syncPdfLayout();
    if (pdfDocument && zoomMode === 'fit-width') void fitPdfWidth();
    announcePdfPosition();
    return true;
  }

  function rememberPageSize(pageIndex, size) {
    pageSizes.delete(pageIndex);
    pageSizes.set(pageIndex, size);
    if (pageSizes.size > MAX_CACHED_PDF_PAGE_SIZES) {
      const evictedIndex = pageSizes.keys().next().value;
      pageSizes.delete(evictedIndex);
      const evictedWrapper = pages.get(evictedIndex);
      if (evictedWrapper && defaultPageSize) {
        evictedWrapper.style.width = `${Math.ceil(defaultPageSize.width * scale)}px`;
        evictedWrapper.style.aspectRatio = `${defaultPageSize.width} / ${defaultPageSize.height}`;
      }
    }
  }

  function selectionIntersectsTextLayer(textLayer) {
    const selection = doc.getSelection?.();
    if (!textLayer || !selection || selection.isCollapsed) return false;
    for (let index = 0; index < selection.rangeCount; index += 1) {
      try {
        if (selection.getRangeAt(index).intersectsNode(textLayer)) return true;
      } catch {
        // A selection can become stale while the browser is updating its ranges.
      }
    }
    return false;
  }

  function selectionPageSpan(selection) {
    let first = Infinity;
    let last = -1;
    for (let index = 0; index < selection.rangeCount; index += 1) {
      try {
        const range = selection.getRangeAt(index);
        for (const node of [range.startContainer, range.endContainer]) {
          const page = node.nodeType === 1 ? node.closest?.('.pdf-page') : node.parentElement?.closest?.('.pdf-page');
          const pageIndex = Number(page?.dataset.pageIndex);
          if (Number.isInteger(pageIndex)) {
            first = Math.min(first, pageIndex);
            last = Math.max(last, pageIndex);
          }
        }
      } catch {
        // The browser may replace a range while dispatching selectionchange.
      }
    }
    return last < first ? null : { first, last, pageCount: last - first + 1 };
  }

  function enforceSelectionBudget(extraPageIndex = -1, extraCanvasPixels = 0) {
    const selection = doc.getSelection?.();
    if (!selection || selection.isCollapsed || destroyed) return true;
    const span = selectionPageSpan(selection);
    if (!span) return true;
    let reason = '';
    if (span.pageCount > MAX_PDF_SELECTION_PAGES) {
      reason = `为避免占用过多内存，PDF 文本选区最多保留 ${MAX_PDF_SELECTION_PAGES} 页，请缩小选区。`;
    } else {
      let canvasPixels = 0;
      for (const [pageIndex] of renderedPages) {
        if (pageIndex < span.first || pageIndex > span.last) continue;
        const canvas = pages.get(pageIndex)?.querySelector('canvas');
        if (canvas) canvasPixels += canvas.width * canvas.height;
      }
      if (extraPageIndex >= span.first && extraPageIndex <= span.last
          && !renderedPages.has(extraPageIndex)) {
        canvasPixels += extraCanvasPixels;
      }
      if (canvasPixels > MAX_PDF_SELECTION_CANVAS_PIXELS) {
        reason = '为避免占用过多内存，PDF 文本选区已收起，请降低缩放或缩小选区后重试。';
      }
    }
    if (!reason) return true;
    selection.removeAllRanges();
    setStatus(reason);
    return false;
  }

  function scheduleSelectionCleanup() {
    const selection = doc.getSelection?.();
    if (destroyed) return;
    if (selection && !selection.isCollapsed && !enforceSelectionBudget()) return;
    if (selection && !selection.isCollapsed) return;
    if (selectionFrame) return;
    selectionFrame = win.requestAnimationFrame(() => {
      selectionFrame = 0;
      if ([...renderedPages.values()].some((record) => record.scale !== scale)) renderRevision += 1;
      renderVisiblePdfPages();
    });
  }

  function updatePageControls(pageIndex, { persist = true } = {}) {
    const pageNumber = pageIndex + 1;
    const input = doc.getElementById('pdfPageNumber');
    const previous = doc.getElementById('pdfPreviousPage');
    const next = doc.getElementById('pdfNextPage');
    const pdfSurface = surface();
    const previousPageIndex = pdfSurface?.getAttribute('data-current-page');
    if (input) {
      input.value = String(pageNumber);
      input.max = String(pdfDocument?.numPages || 1);
    }
    const group = effectiveLayoutMode === 'double' && pdfDocument
      ? pdfSpreadForPage(pageIndex, pdfDocument.numPages) : null;
    if (previous) previous.disabled = group ? group.firstPageIndex === 0 : pageIndex <= 0;
    if (next) next.disabled = group
      ? group.pageIndices.at(-1) >= pdfDocument.numPages - 1
      : pageIndex >= (pdfDocument?.numPages || 1) - 1;
    pdfSurface?.setAttribute('data-current-page', String(pageIndex));
    if (persist && previousPageIndex !== String(pageIndex) && currentBookId) {
      onPageChange({ bookId: currentBookId, pageIndex, generation });
    }
    const label = doc.getElementById('pdfPageCount');
    if (label) label.textContent = `/ ${pdfDocument?.numPages || 0}`;
  }

  function scaleForPage(page) {
    return Math.max(0.35, Math.min(2, scale));
  }

  function updatePageSlotSizes() {
    const host = pageHost();
    if (host && defaultPageSize) {
      host.style.setProperty('--pdf-placeholder-width', `${Math.ceil(defaultPageSize.width * scale)}px`);
      host.style.setProperty('--pdf-placeholder-aspect', `${defaultPageSize.width} / ${defaultPageSize.height}`);
    }
    for (const [pageIndex, wrapper] of pages) {
      const size = pageSizes.get(pageIndex) || defaultPageSize;
      if (!size || !wrapper) continue;
      wrapper.style.width = `${Math.ceil(size.width * scale)}px`;
      wrapper.style.aspectRatio = `${size.width} / ${size.height}`;
    }
  }

  function firstPageAtOrAfter(offset, hostTop, scrollTop) {
    let low = 0;
    let high = pages.size;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const wrapper = pages.get(middle);
      if (!wrapper) {
        high = middle;
        continue;
      }
      const top = wrapper.getBoundingClientRect().top - hostTop + scrollTop;
      if (top < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  async function renderPdfTextLayer(page, wrapper, viewport, expectedGeneration, expectedScale) {
    const currentLayer = wrapper.querySelector('.pdf-page-text-layer');
    if (!currentLayer) return null;
    const container = doc.createElement('div');
    container.className = 'textLayer pdf-page-text-layer';
    container.style.width = `${Math.ceil(viewport.width)}px`;
    container.style.height = `${Math.ceil(viewport.height)}px`;
    container.style.setProperty('--total-scale-factor', String(viewport.scale));
    if (typeof pdfJsApi?.TextLayer !== 'function') return { container, state: 'unavailable' };
    try {
      const content = await page.getTextContent({ includeMarkedContent: false });
      let characterCount = 0;
      for (const item of content.items || []) {
        if (typeof item?.str === 'string') characterCount += item.str.length;
        if (characterCount > MAX_PDF_TEXT_LAYER_CHARACTERS) break;
      }
      if (destroyed || expectedGeneration !== generation || expectedScale !== scale) return null;
      if (characterCount > MAX_PDF_TEXT_LAYER_CHARACTERS) {
        return { container, state: 'unavailable' };
      }
      const layer = new pdfJsApi.TextLayer({ textContentSource: content, container, viewport });
      await layer.render();
      if (destroyed || expectedGeneration !== generation || expectedScale !== scale) return null;
      return { container, state: 'ready' };
    } catch {
      if (destroyed || expectedGeneration !== generation || expectedScale !== scale) return null;
      container.replaceChildren();
      return { container, state: 'unavailable' };
    }
  }

  function commitPdfPageFrame({ pageIndex, page, viewport, viewportScale, canvas, textLayer },
    expectedGeneration, expectedScale) {
    return new Promise((resolve) => {
      const commit = () => {
        const wrapper = pages.get(pageIndex);
        const currentCanvas = wrapper?.querySelector('.pdf-page-canvas');
        const currentTextLayer = wrapper?.querySelector('.pdf-page-text-layer');
        if (!wrapper || !currentCanvas || !currentTextLayer || !canvas || !textLayer?.container
            || destroyed || expectedGeneration !== generation || expectedScale !== scale) {
          resolve(false);
          return;
        }
        const frameId = `${expectedGeneration}:${pageIndex}:${++frameSequence}`;
        canvas.classList.add('pdf-frame-enter');
        textLayer.container.classList.add('pdf-frame-enter');
        canvas.dataset.frameId = frameId;
        textLayer.container.dataset.frameId = frameId;
        currentCanvas.replaceWith(canvas);
        currentTextLayer.replaceWith(textLayer.container);
        renderedPages.get(pageIndex)?.page?.cleanup?.();
        renderedPages.set(pageIndex, {
          page,
          scale: expectedScale,
          viewportScale,
          viewport,
          rotation: Number(viewport.rotation) || 0,
          frameId
        });
        wrapper.dataset.frameId = frameId;
        wrapper.dataset.textLayerState = textLayer.state;
        wrapper.dataset.renderState = 'ready';
        wrapper.setAttribute('aria-busy', 'false');
        wrapper.classList.remove('is-frame-pending');
        wrapper.style.removeProperty('--pdf-frame-scale-x');
        wrapper.style.removeProperty('--pdf-frame-scale-y');
        for (const layer of wrapper.querySelectorAll('.pdf-annotation-layer, .pdf-search-hit-layer')) {
          layer.style.removeProperty('transform');
          layer.style.removeProperty('transform-origin');
        }
        wrapper.querySelector('.pdf-page-retry')?.remove();
        const context = {
          frameId,
          bookId: currentBookId,
          generation: expectedGeneration,
          pageIndex,
          scale: viewportScale,
          rotation: Number(viewport.rotation) || 0,
          viewport,
          pageElement: wrapper,
          canvas,
          textLayer: textLayer.container,
          textLayerState: textLayer.state
        };
        if (typeof win.pdfAnnotationRenderer?.onPageFrameCommitted === 'function') {
          win.pdfAnnotationRenderer.onPageFrameCommitted(context);
        } else {
          win.renderPdfAnnotationPage?.(context);
        }
        win.onPdfSearchPageFrameCommitted?.(context);
        win.onPdfPageFrameCommitted?.(context);
        resolve(true);
      };
      const animationFrame = win.requestAnimationFrame?.(commit);
      if (animationFrame == null) commit();
    });
  }

  function showPdfPageRetry(wrapper, pageIndex) {
    wrapper.setAttribute('aria-busy', 'false');
    let button = wrapper.querySelector('.pdf-page-retry');
    if (button) return button;
    button = doc.createElement('button');
    button.type = 'button';
    button.className = 'pdf-page-retry';
    button.textContent = '重试本页';
    button.setAttribute('aria-label', `重试第 ${pageIndex + 1} 页`);
    button.addEventListener('click', () => {
      if (destroyed || !pdfDocument || !pages.has(pageIndex)) return;
      button.remove();
      wrapper.dataset.renderState = 'idle';
      renderRevision += 1;
      setStatus(`${pdfDocument.numPages} 页`);
      renderVisiblePdfPages();
    });
    wrapper.append(button);
    return button;
  }

  function renderQueueGeneration() {
    return `${generation}:${renderRevision}`;
  }

  async function renderPage(pageIndex, expectedGeneration = generation, expectedScale = scale) {
    if (!pdfDocument || destroyed || expectedGeneration !== generation || expectedScale !== scale) return 'stale';
    if (renderTasks.has(pageIndex) || pendingPages.has(pageIndex)) return 'deferred';
    const wrapper = pages.get(pageIndex);
    if (!wrapper) return 'stale';
    const frameElements = ensurePageFrameElements(wrapper, pageIndex);
    const canvas = frameElements?.canvas;
    if (!canvas) return 'stale';
    const cached = renderedPages.get(pageIndex);
    if (cached?.scale === expectedScale) return 'ready';
    if (cached && selectionIntersectsTextLayer(wrapper.querySelector('.pdf-page-text-layer'))) return 'deferred';
    let page;
    pendingPages.set(pageIndex, expectedGeneration);
    try {
      page = await pdfDocument.getPage(pageIndex + 1);
    } catch {
      if (pendingPages.get(pageIndex) === expectedGeneration) pendingPages.delete(pageIndex);
      if (!destroyed && expectedGeneration === generation && expectedScale === scale) {
        wrapper.dataset.renderState = 'error';
        showPdfPageRetry(wrapper, pageIndex);
        if ((Number(surface()?.dataset.currentPage) || 0) === pageIndex) {
          setStatus(`第 ${pageIndex + 1} 页无法渲染。`, true);
        }
      }
      return !destroyed && expectedGeneration === generation && expectedScale === scale ? 'failed' : 'stale';
    }
    if (pendingPages.get(pageIndex) === expectedGeneration) pendingPages.delete(pageIndex);
    if (destroyed || expectedGeneration !== generation || expectedScale !== scale) {
      page.cleanup?.();
      return 'stale';
    }
    const pageScale = scaleForPage(page);
    const renderScale = expectedScale;
    const viewport = page.getViewport({ scale: pageScale });
    rememberPageSize(pageIndex, { width: viewport.width / pageScale, height: viewport.height / pageScale });
    wrapper.style.width = `${Math.ceil(viewport.width)}px`;
    wrapper.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    wrapper.setAttribute('aria-busy', 'true');
    if (cached?.viewport?.width > 0 && cached?.viewport?.height > 0) {
      const scaleX = viewport.width / cached.viewport.width;
      const scaleY = viewport.height / cached.viewport.height;
      wrapper.classList.add('is-frame-pending');
      wrapper.style.setProperty('--pdf-frame-scale-x', String(scaleX));
      wrapper.style.setProperty('--pdf-frame-scale-y', String(scaleY));
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      for (const layer of wrapper.querySelectorAll('.pdf-page-text-layer, .pdf-annotation-layer, .pdf-search-hit-layer')) {
        layer.style.transformOrigin = 'top left';
        layer.style.transform = `scale(${scaleX}, ${scaleY})`;
      }
    }
    const targetOutputScale = Math.max(1, Math.min(2, Number(win.devicePixelRatio) || 1));
    const pixelBudgetScale = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
    const edgeBudgetScale = Math.min(MAX_CANVAS_EDGE / viewport.width, MAX_CANVAS_EDGE / viewport.height);
    const outputScale = Math.max(0.1, Math.min(targetOutputScale, pixelBudgetScale, edgeBudgetScale));
    if (!enforceSelectionBudget(pageIndex, Math.ceil(viewport.width * outputScale)
        * Math.ceil(viewport.height * outputScale))) {
      scheduleSelectionCleanup();
    }
    // Render into a detached canvas so resizing never clears the currently
    // visible bitmap. Swap it into the page only after PDF.js has completed.
    const stagingCanvas = doc.createElement('canvas');
    stagingCanvas.className = canvas.className;
    stagingCanvas.setAttribute('aria-label', canvas.getAttribute('aria-label') || `PDF 第 ${pageIndex + 1} 页`);
    stagingCanvas.width = Math.ceil(viewport.width * outputScale);
    stagingCanvas.height = Math.ceil(viewport.height * outputScale);
    stagingCanvas.style.width = `${Math.ceil(viewport.width)}px`;
    stagingCanvas.style.height = `${Math.ceil(viewport.height)}px`;
    const context = stagingCanvas.getContext?.('2d', { alpha: false });
    if (!context) {
      const textLayerFrame = await renderPdfTextLayer(page, wrapper, viewport, expectedGeneration, renderScale);
      if (await commitPdfPageFrame({
        pageIndex, page, viewport, viewportScale: pageScale, canvas: stagingCanvas, textLayer: textLayerFrame
      }, expectedGeneration, renderScale)) {
        return 'ready';
      }
      page.cleanup?.();
      return !destroyed && expectedGeneration === generation && expectedScale === scale ? 'failed' : 'stale';
    }
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
      background: win.getComputedStyle(doc.body).getPropertyValue('--pdf-page-background').trim() || '#ffffff'
    });
    renderTasks.set(pageIndex, task);
    try {
      await task.promise;
      if (!destroyed && expectedGeneration === generation) {
        const textLayerFrame = await renderPdfTextLayer(page, wrapper, viewport, expectedGeneration, renderScale);
        if (!destroyed && expectedGeneration === generation && renderScale === scale && textLayerFrame
            && wrapper.querySelector('canvas') === canvas) {
          const committed = await commitPdfPageFrame({
            pageIndex, page, viewport, viewportScale: pageScale, canvas: stagingCanvas, textLayer: textLayerFrame
          }, expectedGeneration, renderScale);
          return committed ? 'ready' : 'stale';
        }
      }
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException' && !destroyed && expectedGeneration === generation) {
        wrapper.dataset.renderState = 'error';
        showPdfPageRetry(wrapper, pageIndex);
        if ((Number(surface()?.dataset.currentPage) || 0) === pageIndex) {
          setStatus('此 PDF 页面渲染失败，请尝试重新打开。', true);
        }
      }
      return error?.name === 'RenderingCancelledException' ? 'stale' : 'failed';
    } finally {
      if (renderTasks.get(pageIndex) === task) renderTasks.delete(pageIndex);
      if (destroyed || expectedGeneration !== generation || expectedScale !== scale) page.cleanup?.();
    }
    return 'stale';
  }

  function releasePageFrame(pageIndex) {
    const record = renderedPages.get(pageIndex);
    if (!record) return false;
    const wrapper = pages.get(pageIndex);
    const textLayer = wrapper?.querySelector('.pdf-page-text-layer');
    if (selectionIntersectsTextLayer(textLayer)) return false;
    win.clearPdfAnnotationPage?.({ bookId: currentBookId, generation, pageIndex });
    record.page?.cleanup?.();
    renderedPages.delete(pageIndex);
    const canvas = wrapper?.querySelector('canvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = '';
      canvas.style.height = '';
    }
    textLayer?.replaceChildren();
    if (wrapper) {
      wrapper.dataset.textLayerState = 'idle';
      wrapper.dataset.renderState = 'idle';
      wrapper.removeAttribute('data-frame-id');
      wrapper.setAttribute('aria-busy', 'false');
    }
    dematerializePageFrame(pageIndex);
    return true;
  }

  function pumpScheduledRender() {
    if (!renderScheduler || destroyed) return;
    const job = renderScheduler.next();
    if (!job || !renderScheduler.markRunning(job)) return;
    const expectedGeneration = generation;
    const expectedScale = scale;
    let outcome = 'stale';
    void renderPage(job.pageIndex, expectedGeneration, expectedScale).then((result) => {
      outcome = result;
      if (!renderScheduler) return;
      if (result === 'ready') renderScheduler.markReady(job);
      else if (result === 'failed') renderScheduler.markFailed(job);
      else renderScheduler.markDeferred(job);
    }).finally(() => {
      if (!destroyed && outcome !== 'deferred') renderVisiblePdfPages();
    });
  }

  function renderVisiblePdfPages() {
    if (!pdfDocument || destroyed || !renderScheduler) return;
    const host = pageHost();
    const readerEl = host;
    const readerTop = readerEl?.getBoundingClientRect().top || 0;
    const viewportTop = readerEl?.scrollTop || 0;
    const viewportBottom = viewportTop + (readerEl?.clientHeight || win.innerHeight || 800);
    if (viewportTop > lastViewportTop + 1) scrollDirection = 'down';
    else if (viewportTop < lastViewportTop - 1) scrollDirection = 'up';
    lastViewportTop = viewportTop;
    const margin = readerEl?.clientHeight || 800;
    const inBuffer = new Set();
    const visible = new Set();
    const bufferTop = viewportTop - margin;
    const bufferBottom = viewportBottom + margin;
    const firstPage = firstPageAtOrAfter(bufferTop, readerTop, viewportTop);
    const startPage = Math.max(0, firstPage - 2);
    for (let pageIndex = startPage; pageIndex < pages.size; pageIndex += 1) {
      const wrapper = pages.get(pageIndex);
      if (!wrapper) continue;
      const top = wrapper.getBoundingClientRect().top - readerTop + viewportTop;
      if (top > bufferBottom) break;
      const bottom = top + Math.max(wrapper.offsetHeight, wrapper.clientHeight);
      if (bottom >= bufferTop) {
        inBuffer.add(pageIndex);
        if (bottom >= viewportTop && top <= viewportBottom) visible.add(pageIndex);
      }
    }
    const selection = doc.getSelection?.();
    const selectedSpan = selection && !selection.isCollapsed ? selectionPageSpan(selection) : null;
    const selected = selectedSpan
      ? Array.from({ length: selectedSpan.pageCount }, (_, index) => selectedSpan.first + index)
      : [];
    renderScheduler.update({
      visible: [...visible],
      buffered: [...inBuffer],
      selected,
      currentPage: Number(surface()?.dataset.currentPage) || 0,
      scrollDirection,
      generation: renderQueueGeneration()
    });
    const selectedSet = new Set(selected);
    for (const pageIndex of renderScheduler.getState().runningPages) {
      if (inBuffer.has(pageIndex) || selectedSet.has(pageIndex)) continue;
      try { renderTasks.get(pageIndex)?.cancel?.(); } catch { /* The task may already be settling. */ }
    }
    const released = [];
    for (const [pageIndex, record] of renderedPages) {
      if (!inBuffer.has(pageIndex) && !renderTasks.has(pageIndex)) {
        if (releasePageFrame(pageIndex)) released.push(pageIndex);
      }
    }
    if (lazyPageFrames) {
      for (const pageIndex of [...materializedPages]) {
        if (inBuffer.has(pageIndex) || selectedSet.has(pageIndex) || renderedPages.has(pageIndex)
            || renderTasks.has(pageIndex) || pendingPages.has(pageIndex)) continue;
        dematerializePageFrame(pageIndex);
      }
    }
    if (released.length) renderScheduler.evict(released);
    for (const pageIndex of renderScheduler.evict()) releasePageFrame(pageIndex);
    if (host) host.dataset.renderedPageCount = String(renderedPages.size);
    pumpScheduledRender();
  }

  function observePages(expectedGeneration) {
    const scrollRoot = pageHost();
    if (!scrollRoot || lazyPageFrames || typeof win.IntersectionObserver !== 'function') {
      renderVisiblePdfPages();
      return;
    }
    observer = new win.IntersectionObserver((entries) => {
      if (destroyed || expectedGeneration !== generation) return;
      if (entries.some((entry) => entry.isIntersecting)) renderVisiblePdfPages();
    }, { root: scrollRoot, rootMargin: '100% 0px' });
    for (const wrapper of pages.values()) observer.observe(wrapper);
  }

  async function resolveOutline(items, expectedGeneration, result = [], depth = 0) {
    if (!Array.isArray(items) || depth > 8 || result.length >= maxOutlineEntries) return result;
    for (const item of items) {
      if (destroyed || expectedGeneration !== generation || result.length >= maxOutlineEntries) break;
      if (item?.dest != null && typeof item.title === 'string') {
        try {
          const destination = typeof item.dest === 'string'
            ? await pdfDocument.getDestination(item.dest)
            : item.dest;
          const pageReference = Array.isArray(destination) ? destination[0] : null;
          if (pageReference && typeof pageReference === 'object') {
            const pageIndex = await pdfDocument.getPageIndex(pageReference);
            if (Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pdfDocument.numPages) {
              result.push({ label: item.title.slice(0, 240), target: `pdf-page:${pageIndex}`, depth });
            }
          }
        } catch {
          // Unresolvable outline destinations are ignored; never follow item.url.
        }
      }
      await resolveOutline(item?.items, expectedGeneration, result, depth + 1);
    }
    return result;
  }

  // Without an outline the contents fall back to a page list, so every
  // format offers the same 目录 entry (thinned out for very long PDFs).
  function pageListOutline() {
    const pageCount = Number(pdfDocument?.numPages) || 0;
    const step = Math.max(1, Math.ceil(pageCount / maxOutlineEntries));
    const entries = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += step) {
      entries.push({ label: `第 ${pageIndex + 1} 页`, target: `pdf-page:${pageIndex}`, depth: 0, generated: true });
    }
    return entries;
  }

  async function loadOutline(expectedGeneration) {
    if (typeof pdfDocument?.getOutline !== 'function') return;
    const outline = await pdfDocument.getOutline();
    if (destroyed || expectedGeneration !== generation) return;
    const resolved = outline ? await resolveOutline(outline, expectedGeneration) : [];
    if (destroyed || expectedGeneration !== generation) return;
    onOutline(resolved.length ? resolved : pageListOutline());
  }

  async function openPdf(bookId, contentUrl = getContentUrl(bookId), savedLocator = null) {
    if (!/^[a-f0-9]{64}$/i.test(String(bookId || ''))) throw new Error('书籍标识无效');
    const requestedGeneration = generation + 1;
    await destroyPdfReader();
    if (generation !== requestedGeneration) return;
    const currentGeneration = generation;
    destroyed = false;
    currentBookId = bookId;
    renderRevision += 1;
    if (typeof win.createPdfRenderScheduler !== 'function') {
      throw new Error('PDF 渲染调度器未初始化');
    }
    renderScheduler = win.createPdfRenderScheduler({ maxConcurrent: 1, maxFrames: 10 });
    scale = 1;
    zoomMode = 'auto';
    zoomRevision += 1;
    fitRequestId += 1;
    const pdfSurface = surface();
    const article = doc.getElementById('article');
    const epubShell = doc.getElementById('epubShell');
    if (!pdfSurface || !pageHost()) throw new Error('PDF 阅读区域未初始化');
    pdfSurface.hidden = false;
    pdfSurface.dataset.bookId = bookId;
    doc.body.classList.add('is-pdf-reader');
    syncPdfToolbarMode();
    if (article) article.style.display = 'none';
    if (epubShell) epubShell.style.display = 'none';
    setStatus('正在打开 PDF…');
    state.toc = [];
    if (typeof renderToc === 'function') renderToc();

    try {
      pdfJsApi = getDocument ? null : await import(`${PDFJS_ASSET_ROOT}build/pdf.mjs`);
      if (pdfJsApi) pdfJsApi.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_ROOT}build/pdf.worker.mjs`;
      if (destroyed || currentGeneration !== generation) return;
      const resolved = new URL(contentUrl, win.location.href);
      if (resolved.origin !== win.location.origin || !resolved.pathname.startsWith(`${API_PREFIX}/books/`)) {
        throw new Error('PDF 内容地址无效');
      }
      loadingTask = getDocument
        ? getDocument({ url: resolved.href, ...PDFJS_OPTIONS })
        : pdfJsApi.getDocument({ url: resolved.href, ...PDFJS_OPTIONS });
      const opened = await loadingTask.promise;
      if (destroyed || currentGeneration !== generation || currentBookId !== bookId) {
        await opened.destroy?.();
        return;
      }
      pdfDocument = opened;
      if (!Number.isInteger(opened.numPages) || opened.numPages < 1 || opened.numPages > MAX_PDF_PAGE_COUNT) {
        throw Object.assign(new Error('PDF page count exceeds the supported limit'), { name: 'PDFPageLimitException' });
      }
      makePageSlots(opened.numPages);
      syncPdfLayout();
      const firstPage = await opened.getPage(1);
      defaultPageSize = firstPage.getViewport({ scale: 1 });
      scale = Math.min(1, Math.max(0.35, availablePageWidth() / defaultPageSize.width));
      updatePageSlotSizes();
      const zoomLabel = doc.getElementById('pdfZoomValue');
      if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      firstPage.cleanup?.();
      const savedPageIndex = savedLocator?.type === 'pdf' && Number.isInteger(savedLocator.pageIndex)
        ? Math.max(0, Math.min(opened.numPages - 1, savedLocator.pageIndex))
        : 0;
      updatePageControls(savedPageIndex, { persist: false });
      if (savedPageIndex > 0) pages.get(savedPageIndex)?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      setStatus(`${opened.numPages} 页`);
      observePages(currentGeneration);
      await loadOutline(currentGeneration);
      requestAnimationFrame(() => renderVisiblePdfPages());
      return opened;
    } catch (error) {
      if (!destroyed && currentGeneration === generation) {
        const passwordError = error?.name === 'PasswordException';
        const pageLimitError = error?.name === 'PDFPageLimitException';
        setStatus(passwordError
          ? '此 PDF 受密码保护，当前版本暂不支持打开。'
          : pageLimitError
            ? '此 PDF 页数超过当前版本支持范围。'
            : '无法打开此 PDF。文件可能损坏或格式不受支持。', true);
        destroyed = true;
        observer?.disconnect();
        observer = null;
        clearPageState();
        const failedTask = loadingTask;
        const failedDocument = pdfDocument;
        loadingTask = null;
        pdfDocument = null;
        try { await failedTask?.destroy?.(); } catch { /* Failed document teardown is best effort. */ }
        try { await failedDocument?.destroy?.(); } catch { /* Failed document teardown is best effort. */ }
      }
      throw error;
    }
  }

  function goToPdfPage(pageIndex) {
    if (!pdfDocument || !Number.isInteger(pageIndex)) return false;
    const targetIndex = Math.max(0, Math.min(pdfDocument.numPages - 1, pageIndex));
    const wrapper = pages.get(targetIndex);
    if (!wrapper) return false;
    updatePageControls(targetIndex);
    announcePdfPosition();
    wrapper.scrollIntoView({ block: 'start', behavior: 'auto' });
    renderVisiblePdfPages();
    if (zoomMode === 'fit-width') void fitPdfWidth();
    return true;
  }

  function goToPageNumber(value) {
    const pageNumber = Number(String(value).trim());
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > (pdfDocument?.numPages || 0)) {
      const input = doc.getElementById('pdfPageNumber');
      if (input) input.value = String((Number(surface()?.dataset.currentPage) || 0) + 1);
      return false;
    }
    return goToPdfPage(pageNumber - 1);
  }

  function stepPdfPage(direction) {
    if (!pdfDocument || ![-1, 1].includes(direction)) return false;
    const current = Number(surface()?.dataset.currentPage) || 0;
    let target = current + direction;
    if (effectiveLayoutMode === 'double') {
      const spread = pdfSpreadForPage(current, pdfDocument.numPages);
      target = direction > 0
        ? spread.pageIndices.at(-1) + 1
        : spread.firstPageIndex <= 1 ? 0 : spread.firstPageIndex - 2;
    }
    if (target < 0 || target >= pdfDocument.numPages || target === current) return false;
    return goToPdfPage(target);
  }

  function setPdfScale(nextScale, { mode = 'manual' } = {}) {
    const parsed = Number(nextScale);
    if (!Number.isFinite(parsed)) return false;
    const activePageIndex = Number(surface()?.dataset.currentPage) || 0;
    const next = Math.max(mode === 'manual' ? 0.5 : 0.35, Math.min(2, parsed));
    const scaleChanged = Math.abs(next - scale) > 0.005;
    zoomMode = mode;
    zoomRevision += 1;
    if (!scaleChanged) {
      const label = doc.getElementById('pdfZoomValue');
      if (label) label.textContent = `${Math.round(scale * 100)}%`;
      if (mode !== 'auto') announcePdfPosition();
      return true;
    }

    const anchor = captureReadingAnchor(activePageIndex);
    const guardedGeneration = generation;
    const guardedRevision = ++scrollGuardRevision;
    scrollGuardActive = true;
    scale = next;
    renderRevision += 1;
    win.invalidatePdfAnnotationSurface?.();
    updatePageSlotSizes();
    for (const task of renderTasks.values()) {
      try { task.cancel(); } catch { /* Rendering may already have settled. */ }
    }
    // Keep existing page bitmaps alive while replacement canvases render.
    // renderVisiblePdfPages still evicts pages outside its viewport buffer.
    restoreReadingAnchor(anchor);
    win.requestAnimationFrame(() => {
      if (guardedGeneration !== generation || guardedRevision !== scrollGuardRevision) return;
      restoreReadingAnchor(anchor);
      win.requestAnimationFrame(() => {
        if (guardedGeneration === generation && guardedRevision === scrollGuardRevision) scrollGuardActive = false;
      });
    });
    renderVisiblePdfPages();
    if (pdfDocument) updatePageControls(activePageIndex, { persist: false });
    const label = doc.getElementById('pdfZoomValue');
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
    if (mode !== 'auto') announcePdfPosition();
    return true;
  }

  async function fitPdfWidth() {
    if (!pdfDocument || destroyed) return false;
    const opened = pdfDocument;
    const expectedGeneration = generation;
    const expectedZoomRevision = zoomRevision;
    const requestId = ++fitRequestId;
    const pageIndex = Number(surface()?.dataset.currentPage) || 0;
    const expectedMode = effectiveLayoutMode;
    const indices = expectedMode === 'double'
      ? pdfSpreadForPage(pageIndex, opened.numPages).pageIndices : [pageIndex];
    const isCurrent = () => !destroyed && expectedGeneration === generation && pdfDocument === opened
      && expectedZoomRevision === zoomRevision && requestId === fitRequestId
      && expectedMode === effectiveLayoutMode && pageIndex === (Number(surface()?.dataset.currentPage) || 0);
    let combinedWidth = PDF_SPREAD_GAP * (indices.length - 1);
    for (const index of indices) {
      let size = pageSizes.get(index);
      if (!Number.isFinite(size?.width) || size.width <= 0) size = null;
      if (!size) {
        let page;
        try {
          page = await opened.getPage(index + 1);
          if (!isCurrent()) return false;
          const viewport = page.getViewport({ scale: 1 });
          size = { width: viewport.width, height: viewport.height };
          if (!Number.isFinite(size.width) || size.width <= 0) throw new Error('Invalid page width');
          rememberPageSize(index, size);
        } catch {
          if (isCurrent()) setStatus(`第 ${index + 1} 页无法读取页面尺寸。`, true);
          return false;
        } finally {
          if (page && !renderedPages.has(index) && !pendingPages.has(index) && !renderTasks.has(index)) {
            page.cleanup?.();
          }
        }
      }
      if (!isCurrent()) return false;
      combinedWidth += size.width;
    }
    if (combinedWidth <= 0) return false;
    return setPdfScale(availablePageWidth(win.innerWidth || 800) / combinedWidth, { mode: 'fit-width' });
  }

  function setPageFromScroll() {
    if (!pdfDocument || destroyed || scrollGuardActive) return;
    const previousPageIndex = Number(surface()?.dataset.currentPage) || 0;
    const readerEl = pageHost();
    const reference = readerEl?.getBoundingClientRect().top || 0;
    const scrollTop = readerEl?.scrollTop || 0;
    const readingLineOffset = Math.min(120, Math.max(24, Math.round((readerEl?.clientHeight || 800) * 0.2)));
    const firstAtOrAfter = firstPageAtOrAfter(scrollTop + readingLineOffset, reference, scrollTop);
    let current = Math.max(0, Math.min(pages.size - 1, firstAtOrAfter));
    if (firstAtOrAfter > 0) {
      const previous = pages.get(firstAtOrAfter - 1);
      if (previous && previous.getBoundingClientRect().bottom > reference + readingLineOffset) {
        current = firstAtOrAfter - 1;
      }
    }
    if (effectiveLayoutMode === 'double') {
      const visibleSpread = pdfSpreadForPage(current, pdfDocument.numPages);
      const selectedSpread = pdfSpreadForPage(previousPageIndex, pdfDocument.numPages);
      current = visibleSpread.firstPageIndex === selectedSpread.firstPageIndex
        ? previousPageIndex : visibleSpread.firstPageIndex;
    }
    updatePageControls(current);
    renderVisiblePdfPages();
    if (current !== previousPageIndex && zoomMode === 'fit-width') void fitPdfWidth();
  }

  function schedulePageFromScroll() {
    if (scrollFrame) return;
    scrollFrame = win.requestAnimationFrame(() => {
      scrollFrame = 0;
      setPageFromScroll();
    });
  }

  doc.getElementById('pdfPreviousPage')?.addEventListener('click', () => {
    stepPdfPage(-1);
  });
  doc.getElementById('pdfNextPage')?.addEventListener('click', () => {
    stepPdfPage(1);
  });
  doc.getElementById('pdfPageNumber')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); goToPageNumber(event.currentTarget.value); }
  });
  doc.getElementById('pdfPageNumber')?.addEventListener('change', (event) => goToPageNumber(event.currentTarget.value));
  doc.getElementById('pdfZoomOut')?.addEventListener('click', () => setPdfScale(scale - 0.1));
  doc.getElementById('pdfZoomIn')?.addEventListener('click', () => setPdfScale(scale + 0.1));
  doc.getElementById('pdfFitWidth')?.addEventListener('click', () => { void fitPdfWidth(); });
  pageHost()?.addEventListener('scroll', schedulePageFromScroll, { passive: true });
  doc.addEventListener('selectionchange', scheduleSelectionCleanup);
  win.addEventListener('resize', () => {
    if (!pdfDocument || destroyed) return;
    syncPdfToolbarMode();
    syncPdfLayout();
    if (zoomMode === 'fit-width') void fitPdfWidth();
    else if (zoomMode === 'auto' && defaultPageSize) {
      const nextScale = Math.min(1, Math.max(0.35, availablePageWidth() / defaultPageSize.width));
      if (Math.abs(nextScale - scale) > 0.001) setPdfScale(nextScale, { mode: 'auto' });
    }
  });

  return {
    destroyPdfReader,
    getGeneration: () => generation,
    getDebugState: () => ({
      generation,
      activeRenderCount: renderScheduler?.getState().activeCount || 0,
      queuedPages: renderScheduler?.getState().queuedPages || [],
      renderedPages: renderedPages.size,
      cachedPageSizeCount: pageSizes.size,
      materializedPageCount: materializedPages.size,
      lazyPageFrames,
      currentPage: Number(surface()?.dataset.currentPage) || 0,
      scale,
      layoutMode: effectiveLayoutMode
    }),
    getCurrentBookId: () => currentBookId,
    getRenderedPageGeometry(pageIndex) {
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || destroyed || !pdfDocument || !currentBookId) return null;
      const rendered = renderedPages.get(pageIndex);
      const pageElement = pages.get(pageIndex);
      const canvas = pageElement?.querySelector('canvas');
      const textLayer = pageElement?.querySelector('.pdf-page-text-layer');
      if (!rendered || rendered.scale !== scale || !rendered.viewport || !rendered.page?.view
        || !pageElement || !canvas || !textLayer || !pageElement.isConnected) return null;
      return {
        frameId: rendered.frameId,
        bookId: currentBookId,
        generation,
        pageIndex,
        pageElement,
        pageView: Array.from(rendered.page.view),
        viewport: rendered.viewport,
        scale: rendered.viewportScale,
        rotation: rendered.rotation,
        textLayerState: pageElement.dataset.textLayerState || 'unavailable'
      };
    },
    getCurrentPageIndex: () => Number(surface()?.dataset.currentPage) || 0,
    getPageCount: () => pdfDocument?.numPages || 0,
    getEffectiveLayoutMode: () => effectiveLayoutMode,
    goToPageNumber,
    goToPdfPage,
    openPdf,
    renderVisiblePdfPages,
    setLayoutMode,
    setPdfScale,
    zoomBy: (delta) => setPdfScale(scale + delta)
  };
}

const pdfReaderController = createPdfReaderController({
  onPageChange: (change) => {
    savePdfProgress(change);
    if (typeof renderBookmarkButtonState === 'function') renderBookmarkButtonState();
  }
});
window.pdfReaderController = pdfReaderController;
window.createPdfReaderController = createPdfReaderController;
function destroyPdfReader() {
  return pdfReaderController.destroyPdfReader();
}
