/* BabyReader UI module: reader/pdf-annotations */

'use strict';

const PDF_ANNOTATION_COLORS = Object.freeze({
  yellow: { fill: 'rgba(245, 196, 66, 0.32)', stroke: 'rgba(205, 145, 0, 0.95)' },
  green: { fill: 'rgba(91, 190, 125, 0.30)', stroke: 'rgba(31, 132, 70, 0.95)' },
  blue: { fill: 'rgba(79, 146, 230, 0.30)', stroke: 'rgba(40, 100, 190, 0.95)' },
  pink: { fill: 'rgba(225, 105, 155, 0.30)', stroke: 'rgba(185, 55, 110, 0.95)' }
});
const MAX_PDF_ANNOTATION_CANVAS_PIXELS = 16000000;

function createPdfAnnotationRenderer({
  document: doc = document,
  window: win = window,
  getRenderedPageGeometry,
  requestAnimationFrame = (callback) => win.requestAnimationFrame(callback),
  cancelAnimationFrame = (id) => win.cancelAnimationFrame(id),
  devicePixelRatio = Number(win.devicePixelRatio) || 1
} = {}) {
  let session = null;
  let annotations = [];
  let destroyed = false;
  let revision = 0;
  const renderedPages = new Map();
  const pendingFrames = new Map();

  function cancelPending(pageIndex) {
    const pending = pendingFrames.get(pageIndex);
    if (pending != null) cancelAnimationFrame?.(pending);
    pendingFrames.delete(pageIndex);
  }

  function removeCanvas(pageIndex, pageElement = null) {
    const target = pageElement || renderedPages.get(pageIndex)?.pageElement
      || doc.querySelector(`.pdf-page[data-page-index="${pageIndex}"]`);
    target?.querySelector('.pdf-annotation-layer')?.remove();
  }

  function clearPdfAnnotationPage({ bookId, generation, pageIndex } = {}) {
    const rendered = renderedPages.get(pageIndex);
    if (bookId && session?.bookId && bookId !== session.bookId) return false;
    if (Number.isInteger(generation) && session?.generation != null && generation !== session.generation) return false;
    cancelPending(pageIndex);
    removeCanvas(pageIndex, rendered?.pageElement);
    renderedPages.delete(pageIndex);
    return true;
  }

  function invalidatePdfAnnotationSurface() {
    revision += 1;
    for (const pageIndex of [...renderedPages.keys()]) {
      cancelPending(pageIndex);
      removeCanvas(pageIndex, renderedPages.get(pageIndex)?.pageElement);
    }
    renderedPages.clear();
  }

  function clearPdfAnnotationSurface() {
    invalidatePdfAnnotationSurface();
    session = null;
    annotations = [];
  }

  function setAnnotations({ bookId, generation, sourceFingerprint, annotations: records } = {}) {
    if (destroyed || typeof bookId !== 'string' || !Number.isInteger(generation)
      || !/^[a-f0-9]{64}$/i.test(String(sourceFingerprint || '')) || !Array.isArray(records)) {
      clearPdfAnnotationSurface();
      return false;
    }
    if (session && (session.bookId !== bookId || session.generation !== generation
      || session.sourceFingerprint !== sourceFingerprint)) clearPdfAnnotationSurface();
    session = { bookId, generation, sourceFingerprint };
    annotations = records.filter((record) => record && record.sourceStale !== true
      && record.sourceFingerprint === sourceFingerprint && Array.isArray(record.targets));
    for (const [pageIndex, rendered] of renderedPages) {
      renderPdfAnnotationPage({ bookId, generation, pageIndex, scale: rendered.scale, frameId: rendered.frameId });
    }
    return true;
  }

  function paintPage(pageIndex, requestedRevision, requestedContext) {
    if (destroyed || requestedRevision !== revision || !session
      || requestedContext.bookId !== session.bookId || requestedContext.generation !== session.generation) return;
    const geometry = getRenderedPageGeometry?.(pageIndex);
    if (!geometry || geometry.bookId !== session.bookId || geometry.generation !== session.generation
      || geometry.pageIndex !== pageIndex || geometry.scale !== requestedContext.scale
      || (requestedContext.frameId && geometry.frameId !== requestedContext.frameId)
      || geometry.pageElement !== requestedContext.pageElement || !geometry.viewport
      || !Number.isFinite(geometry.viewport.width) || !Number.isFinite(geometry.viewport.height)) {
      return;
    }
    const pageAnnotations = annotations.filter((annotation) => annotation.targets.some((target) => target.pageIndex === pageIndex));
    if (!pageAnnotations.length) {
      removeCanvas(pageIndex, geometry.pageElement);
      return;
    }

    let canvas = geometry.pageElement.querySelector('.pdf-annotation-layer');
    if (!canvas) {
      canvas = doc.createElement('canvas');
      canvas.className = 'pdf-annotation-layer';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'absolute';
      canvas.style.pointerEvents = 'none';
      geometry.pageElement.appendChild(canvas);
    }
    const cssWidth = Math.max(1, Math.ceil(geometry.viewport.width));
    const cssHeight = Math.max(1, Math.ceil(geometry.viewport.height));
    const pixelBudgetScale = Math.sqrt(MAX_PDF_ANNOTATION_CANVAS_PIXELS / (cssWidth * cssHeight));
    const outputScale = Math.max(0.1, Math.min(2, Number(devicePixelRatio) || 1, pixelBudgetScale));
    canvas.width = Math.ceil(cssWidth * outputScale);
    canvas.height = Math.ceil(cssHeight * outputScale);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.dataset.pageIndex = String(pageIndex);
    canvas.dataset.generation = String(session.generation);
    canvas.dataset.scale = String(geometry.scale);
    if (geometry.frameId) canvas.dataset.frameId = geometry.frameId;

    const context = canvas.getContext?.('2d');
    if (!context) return;
    context.setTransform?.(outputScale, 0, 0, outputScale, 0, 0);
    context.clearRect?.(0, 0, cssWidth, cssHeight);
    for (const annotation of pageAnnotations) {
      const target = annotation.targets.find((item) => item.pageIndex === pageIndex);
      const style = ['marker', 'wave', 'line'].includes(annotation.style) ? annotation.style : 'marker';
      const color = PDF_ANNOTATION_COLORS[annotation.color] || PDF_ANNOTATION_COLORS.yellow;
      if (style === 'none') continue;
      for (const quad of win.pdfAnnotationGeometry.projectPdfAnnotationTarget(target, geometry)) {
        if (!Array.isArray(quad) || quad.length !== 4 || quad.some((point) => !point.every(Number.isFinite))) continue;
        if (style === 'marker') {
          context.beginPath();
          context.moveTo(quad[0][0], quad[0][1]);
          for (const point of quad.slice(1)) context.lineTo(point[0], point[1]);
          context.closePath();
          context.fillStyle = color.fill;
          context.fill();
        } else {
          context.strokeStyle = color.stroke;
          context.lineWidth = 1.5;
          context.beginPath();
          if (style === 'line') {
            context.moveTo(quad[3][0], quad[3][1]);
            context.lineTo(quad[2][0], quad[2][1]);
          } else {
            const left = quad[3];
            const right = quad[2];
            const dx = right[0] - left[0];
            const dy = right[1] - left[1];
            const length = Math.hypot(dx, dy);
            const steps = Math.max(2, Math.ceil(length / 4));
            for (let step = 0; step <= steps; step += 1) {
              const ratio = step / steps;
              const wave = (step % 2 === 0 ? -1 : 1) * 1.25;
              const x = left[0] + dx * ratio + (length ? -dy / length * wave : 0);
              const y = left[1] + dy * ratio + (length ? dx / length * wave : 0);
              if (step === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            }
          }
          context.stroke();
        }
      }
    }
  }

  function renderPdfAnnotationPage({ bookId, generation, pageIndex, scale, frameId } = {}) {
    if (destroyed || !Number.isInteger(pageIndex) || pageIndex < 0 || !Number.isFinite(scale)) return false;
    const geometry = getRenderedPageGeometry?.(pageIndex);
    if (!geometry || geometry.bookId !== bookId || geometry.generation !== generation
      || geometry.pageIndex !== pageIndex || geometry.scale !== scale || !geometry.pageElement
      || (frameId && geometry.frameId !== frameId)) return false;
    if (session && (bookId !== session.bookId || generation !== session.generation)) return false;
    cancelPending(pageIndex);
    const context = {
      bookId, generation, pageIndex, scale,
      frameId: frameId || geometry.frameId || null,
      pageElement: geometry.pageElement
    };
    renderedPages.set(pageIndex, context);
    if (!session) return true;
    const requestedRevision = revision;
    const requestFrameId = requestAnimationFrame?.(() => {
      if (pendingFrames.get(pageIndex) === requestFrameId) pendingFrames.delete(pageIndex);
      paintPage(pageIndex, requestedRevision, context);
    });
    if (requestFrameId != null) pendingFrames.set(pageIndex, requestFrameId);
    else paintPage(pageIndex, requestedRevision, context);
    return true;
  }

  function onPageFrameCommitted(context = {}) {
    if (typeof context.frameId !== 'string' || !context.frameId) return false;
    cancelPending(context.pageIndex);
    removeCanvas(context.pageIndex, context.pageElement);
    return renderPdfAnnotationPage(context);
  }

  function destroy() {
    clearPdfAnnotationSurface();
    destroyed = true;
  }

  return {
    clearPdfAnnotationPage,
    clearPdfAnnotationSurface,
    destroy,
    invalidatePdfAnnotationSurface,
    onPageFrameCommitted,
    renderPdfAnnotationPage,
    setAnnotations
  };
}

window.createPdfAnnotationRenderer = createPdfAnnotationRenderer;
window.pdfAnnotationRenderer = createPdfAnnotationRenderer({
  document,
  window,
  getRenderedPageGeometry: (pageIndex) => window.pdfReaderController?.getRenderedPageGeometry?.(pageIndex)
});
window.renderPdfAnnotationPage = (context) => window.pdfAnnotationRenderer.renderPdfAnnotationPage(context);
window.clearPdfAnnotationPage = (context) => window.pdfAnnotationRenderer.clearPdfAnnotationPage(context);
window.clearPdfAnnotationSurface = () => window.pdfAnnotationRenderer.clearPdfAnnotationSurface();
window.invalidatePdfAnnotationSurface = () => window.pdfAnnotationRenderer.invalidatePdfAnnotationSurface();
