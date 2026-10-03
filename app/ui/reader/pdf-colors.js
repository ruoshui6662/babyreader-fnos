/* 枕书 UI module: reader/pdf-colors */

'use strict';

/*
 * PDF page colours follow the reading theme (or stay as printed).
 *
 * The pages are canvases PDF.js has already drawn, so the colours change in
 * CSS, without re-rendering:
 *   light  as printed
 *   sepia  the white canvas is multiplied onto a warm paper colour: paper
 *          turns sepia, black text stays black
 *   dark   invert(1) hue-rotate(180deg) contrast(.76): lightness flips while
 *          hues stay (a blue heading stays blue), paper becomes #1f1f1f and
 *          text #e0e0e0 rather than pure black and white
 *
 * Inverting turns photos into negatives. Images are located from the page's
 * operator list, and their pixels are copied from the page canvas (a CSS
 * filter changes only how the canvas is shown, never its pixels) into small
 * canvases laid over them, so pictures keep their exact colours, only dimmed
 * a little for the dark page. A page that is mostly one image (a scanned
 * book) stays inverted, or its text would remain black on white.
 */

const PDF_SCANNED_PAGE_SHARE = 0.5;
const pdfImageRegionCache = new Map();

function pdfPageColorMode() {
  if (state.pdfPageColors === 'original') return 'original';
  return state.theme === 'dark' ? 'dark' : state.theme === 'sepia' ? 'sepia' : 'light';
}

function multiplyPdfTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function applyPdfTransform(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

// Images in PDF user space, as [x0, y0, x1, y1]: every image is drawn into
// the unit square under the current transformation matrix.
function pdfImageBoxesFromOperatorList(operatorList, ops) {
  const { fnArray = [], argsArray = [] } = operatorList || {};
  const boxes = [];
  const stack = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const addUnitSquare = (transform) => {
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => applyPdfTransform(transform, x, y));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  };
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index];
    const args = argsArray[index];
    if (fn === ops.save) stack.push(matrix);
    else if (fn === ops.restore) matrix = stack.pop() || matrix;
    else if (fn === ops.transform && Array.isArray(args) && args.length >= 6) matrix = multiplyPdfTransform(matrix, args);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(matrix);
      const formMatrix = args?.[0];
      if (formMatrix && formMatrix.length >= 6) matrix = multiplyPdfTransform(matrix, Array.from(formMatrix));
    } else if (fn === ops.paintFormXObjectEnd) matrix = stack.pop() || matrix;
    else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) addUnitSquare(matrix);
    else if (fn === ops.paintImageXObjectRepeat) {
      // [objId, scaleX, scaleY, positions]: the same image at several spots.
      const [, scaleX, scaleY, positions = []] = args || [];
      for (let at = 0; at + 1 < positions.length; at += 2) {
        addUnitSquare(multiplyPdfTransform(matrix, [scaleX, 0, 0, scaleY, positions[at], positions[at + 1]]));
      }
    }
  }
  return boxes;
}

// Image boxes for one page (cached per document and page), or [] when the
// page is essentially one image and should be inverted whole.
async function pdfPageImageBoxes(page, cacheKey) {
  if (pdfImageRegionCache.has(cacheKey)) return pdfImageRegionCache.get(cacheKey);
  const pending = (async () => {
    const ops = globalThis.pdfjsLib?.OPS || window.pdfjsOps;
    if (!ops || typeof page?.getOperatorList !== 'function') return [];
    const operatorList = await page.getOperatorList();
    const view = page.view || [0, 0, 1, 1];
    const pageArea = Math.max(1, (view[2] - view[0]) * (view[3] - view[1]));
    const boxes = pdfImageBoxesFromOperatorList(operatorList, ops)
      .map(([x0, y0, x1, y1]) => [Math.max(x0, view[0]), Math.max(y0, view[1]), Math.min(x1, view[2]), Math.min(y1, view[3])])
      .filter(([x0, y0, x1, y1]) => x1 - x0 > 1 && y1 - y0 > 1);
    const largest = boxes.reduce((max, [x0, y0, x1, y1]) => Math.max(max, ((x1 - x0) * (y1 - y0)) / pageArea), 0);
    return largest >= PDF_SCANNED_PAGE_SHARE ? [] : boxes;
  })().catch((error) => {
    // Not cached: a page cleaned up mid-request is simply asked again.
    pdfImageRegionCache.delete(cacheKey);
    console.warn('PDF 图片区域读取失败', error);
    return null;
  });
  pdfImageRegionCache.set(cacheKey, pending);
  return pending;
}

async function restorePdfPageImages(context) {
  const { pageElement, page, viewport, frameId, bookId, pageIndex } = context || {};
  if (!pageElement || !page || !viewport) return;
  const boxes = await pdfPageImageBoxes(page, `${bookId}:${pageIndex}`);
  if (pageElement.dataset.frameId !== frameId || boxes === null) return;
  let layer = pageElement.querySelector('.pdf-image-restore-layer');
  if (!boxes.length) {
    layer?.remove();
    return;
  }
  const canvas = context.canvas || pageElement.querySelector('.pdf-page-canvas');
  if (!canvas?.width) return;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'pdf-image-restore-layer';
    layer.setAttribute('aria-hidden', 'true');
  }
  if (layer.previousElementSibling !== canvas) canvas.after(layer);
  // Percentages of the page: right at any zoom level and rotation.
  const width = viewport.width || 1;
  const height = viewport.height || 1;
  const pixelsX = canvas.width / width;
  const pixelsY = canvas.height / height;
  layer.replaceChildren(...boxes.map(([x0, y0, x1, y1]) => {
    const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const left = Math.max(0, Math.min(...points.map((point) => point[0])));
    const top = Math.max(0, Math.min(...points.map((point) => point[1])));
    const right = Math.min(width, Math.max(...points.map((point) => point[0])));
    const bottom = Math.min(height, Math.max(...points.map((point) => point[1])));
    const region = document.createElement('canvas');
    region.className = 'pdf-image-restore';
    region.width = Math.max(1, Math.round((right - left) * pixelsX));
    region.height = Math.max(1, Math.round((bottom - top) * pixelsY));
    region.getContext('2d')?.drawImage(canvas,
      Math.round(left * pixelsX), Math.round(top * pixelsY), region.width, region.height,
      0, 0, region.width, region.height);
    region.style.left = `${(left / width) * 100}%`;
    region.style.top = `${(top / height) * 100}%`;
    region.style.width = `${((right - left) / width) * 100}%`;
    region.style.height = `${((bottom - top) / height) * 100}%`;
    return region;
  }));
}

// Pages committed while the mode is dark get their image overlays; other
// modes do not need them (and skip the operator-list work).
const pdfCommittedFrames = new Map();

function onPdfPageColorsFrameCommitted(context) {
  pdfCommittedFrames.set(context.pageIndex, context);
  if (pdfPageColorMode() === 'dark') void restorePdfPageImages(context);
}

function syncPdfPageColors() {
  const mode = pdfPageColorMode();
  document.body.dataset.pdfPageColors = mode;
  if (mode !== 'dark' || state.contentType !== 'pdf') return mode;
  for (const context of pdfCommittedFrames.values()) {
    if (context.pageElement?.isConnected && !context.pageElement.querySelector('.pdf-image-restore-layer')) {
      void restorePdfPageImages(context);
    }
  }
  return mode;
}

function resetPdfPageColors() {
  pdfCommittedFrames.clear();
  pdfImageRegionCache.clear();
}

window.onPdfPageFrameCommitted = onPdfPageColorsFrameCommitted;
