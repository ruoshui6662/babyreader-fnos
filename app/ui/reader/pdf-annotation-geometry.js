/* 枕书 UI module: reader/pdf-annotation-geometry */

'use strict';

(function publishPdfAnnotationGeometry(root) {
  const MAX_PAGES = 8;
  const MAX_QUADS = 512;
  const MAX_TEXT_LENGTH = 4000;
  const MAX_CONTEXT_LENGTH = 1000;
  const RECT_EPSILON = 0.01;

  function comparePoints(doc, nodeA, offsetA, nodeB, offsetB) {
    const pointA = doc.createRange();
    pointA.setStart(nodeA, offsetA);
    pointA.collapse(true);
    const pointB = doc.createRange();
    pointB.setStart(nodeB, offsetB);
    pointB.collapse(true);
    return pointA.compareBoundaryPoints(root.Range.START_TO_START, pointB);
  }

  function pointOffsetWithin(rootNode, node, offset) {
    const range = rootNode.ownerDocument.createRange();
    range.selectNodeContents(rootNode);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  function boundedContext(text, offset, before) {
    if (before) return text.slice(Math.max(0, offset - MAX_CONTEXT_LENGTH), offset);
    return text.slice(offset, offset + MAX_CONTEXT_LENGTH);
  }

  function pageSubrange(sourceRange, layer) {
    const doc = layer.ownerDocument;
    const layerRange = doc.createRange();
    layerRange.selectNodeContents(layer);
    const [layerStartNode, layerStartOffset] = [layerRange.startContainer, layerRange.startOffset];
    const [layerEndNode, layerEndOffset] = [layerRange.endContainer, layerRange.endOffset];
    if (comparePoints(doc, sourceRange.endContainer, sourceRange.endOffset, layerStartNode, layerStartOffset) <= 0
      || comparePoints(doc, sourceRange.startContainer, sourceRange.startOffset, layerEndNode, layerEndOffset) >= 0) {
      return null;
    }

    const result = sourceRange.cloneRange();
    if (comparePoints(doc, sourceRange.startContainer, sourceRange.startOffset, layerStartNode, layerStartOffset) < 0) {
      result.setStart(layerStartNode, layerStartOffset);
    }
    if (comparePoints(doc, sourceRange.endContainer, sourceRange.endOffset, layerEndNode, layerEndOffset) > 0) {
      result.setEnd(layerEndNode, layerEndOffset);
    }
    return result;
  }

  function normalizeQuad(rect, geometry, pageRect) {
    const view = geometry.pageView;
    if (!Array.isArray(view) && !ArrayBuffer.isView(view)) return null;
    if (view.length < 4 || [...view].slice(0, 4).some((value) => !Number.isFinite(value))) return null;
    const [xMin, yMin, xMax, yMax] = view;
    if (!(xMax > xMin) || !(yMax > yMin)) return null;
    const local = [
      [rect.left - pageRect.left, rect.top - pageRect.top],
      [rect.right - pageRect.left, rect.top - pageRect.top],
      [rect.right - pageRect.left, rect.bottom - pageRect.top],
      [rect.left - pageRect.left, rect.bottom - pageRect.top]
    ];
    const quad = [];
    for (const [x, y] of local) {
      const point = geometry.viewport.convertToPdfPoint(x, y);
      if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) return null;
      const nx = (point[0] - xMin) / (xMax - xMin);
      const ny = (point[1] - yMin) / (yMax - yMin);
      if (nx < -0.001 || nx > 1.001 || ny < -0.001 || ny > 1.001) return null;
      quad.push(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)));
    }
    return quad;
  }

  function rectFromClientRect(input) {
    const left = Number(input?.left);
    const top = Number(input?.top);
    const right = Number(input?.right ?? (left + Number(input?.width)));
    const bottom = Number(input?.bottom ?? (top + Number(input?.height)));
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
    return { left, top, right, bottom };
  }

  function sameOrNearlySameRect(a, b) {
    const intersectionWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const intersectionHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const intersection = intersectionWidth * intersectionHeight;
    const smallerArea = Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top));
    return smallerArea > 0 && intersection / smallerArea >= 0.98
      && Math.abs(a.left - b.left) <= RECT_EPSILON
      && Math.abs(a.top - b.top) <= RECT_EPSILON
      && Math.abs(a.right - b.right) <= RECT_EPSILON
      && Math.abs(a.bottom - b.bottom) <= RECT_EPSILON;
  }

  function capturePdfAnnotationSelection(selection, getRenderedPageGeometry) {
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1
      || typeof getRenderedPageGeometry !== 'function') return null;
    const sourceRange = selection.getRangeAt(0);
    const doc = sourceRange?.startContainer?.ownerDocument;
    if (!doc || sourceRange.collapsed) return null;
    const startLayer = (sourceRange.startContainer.nodeType === 1
      ? sourceRange.startContainer : sourceRange.startContainer.parentElement)?.closest?.('.pdf-page-text-layer');
    const endLayer = (sourceRange.endContainer.nodeType === 1
      ? sourceRange.endContainer : sourceRange.endContainer.parentElement)?.closest?.('.pdf-page-text-layer');
    if (!startLayer || !endLayer) return null;

    const text = String(selection.toString?.() ?? sourceRange.toString()).replace(/\s+/gu, ' ').trim();
    if (!text || text.length > MAX_TEXT_LENGTH) return null;
    const layers = [...doc.querySelectorAll('.pdf-page-text-layer')];
    const selectedPages = [];
    const seenPageIndices = new Set();
    let sessionBookId = null;
    let sessionGeneration = null;
    let quadCount = 0;
    let contextBefore = '';
    let contextAfter = '';

    for (const layer of layers) {
      const clipped = pageSubrange(sourceRange, layer);
      if (!clipped || !clipped.toString()) continue;
      const pageElement = layer.closest('.pdf-page');
      const pageIndex = Number(pageElement?.dataset.pageIndex);
      if (!pageElement || !Number.isInteger(pageIndex) || pageIndex < 0 || seenPageIndices.has(pageIndex)) return null;
      const geometry = getRenderedPageGeometry(pageIndex);
      if (!geometry || geometry.pageIndex !== pageIndex || geometry.pageElement !== pageElement
        || !geometry.bookId || !Number.isInteger(geometry.generation) || !geometry.viewport
        || typeof geometry.viewport.convertToPdfPoint !== 'function') return null;
      if (sessionBookId === null) {
        sessionBookId = geometry.bookId;
        sessionGeneration = geometry.generation;
      } else if (geometry.bookId !== sessionBookId || geometry.generation !== sessionGeneration) {
        return null;
      }
      if (selectedPages.length >= MAX_PAGES) return null;
      seenPageIndices.add(pageIndex);
      const pageRect = pageElement.getBoundingClientRect();
      if (!Number.isFinite(pageRect?.left) || !Number.isFinite(pageRect?.top)
        || !(pageRect.right > pageRect.left) || !(pageRect.bottom > pageRect.top)) return null;
      const uniqueRects = [];
      for (const item of clipped.getClientRects?.() || []) {
        const candidate = rectFromClientRect(item);
        if (!candidate || candidate.right <= pageRect.left || candidate.left >= pageRect.right
          || candidate.bottom <= pageRect.top || candidate.top >= pageRect.bottom) continue;
        if (uniqueRects.some((existing) => sameOrNearlySameRect(existing, candidate))) continue;
        uniqueRects.push(candidate);
      }
      const quads = uniqueRects.map((item) => normalizeQuad(item, geometry, pageRect));
      if (!quads.length || quads.some((quad) => !quad)) return null;
      quadCount += quads.length;
      if (quadCount > MAX_QUADS) return null;
      selectedPages.push({ pageIndex, quads });

      if (layer === startLayer) {
        try {
          const offset = pointOffsetWithin(layer, sourceRange.startContainer, sourceRange.startOffset);
          contextBefore = boundedContext(layer.textContent || '', offset, true);
        } catch { return null; }
      }
      if (layer === endLayer) {
        try {
          const offset = pointOffsetWithin(layer, sourceRange.endContainer, sourceRange.endOffset);
          contextAfter = boundedContext(layer.textContent || '', offset, false);
        } catch { return null; }
      }
    }

    if (!selectedPages.length || selectedPages[0].pageIndex !== Number(startLayer.closest('.pdf-page')?.dataset.pageIndex)
      || selectedPages.at(-1).pageIndex !== Number(endLayer.closest('.pdf-page')?.dataset.pageIndex)) return null;
    selectedPages.sort((a, b) => a.pageIndex - b.pageIndex);
    const firstTarget = selectedPages[0];
    return Object.freeze({
      text,
      contextBefore,
      contextAfter,
      targets: selectedPages,
      anchor: { type: 'pdf', pageIndex: firstTarget.pageIndex, quad: firstTarget.quads[0] },
      bookId: sessionBookId,
      generation: sessionGeneration
    });
  }

  function projectPdfAnnotationTarget(target, pageGeometry) {
    if (!target || !Array.isArray(target.quads) || !pageGeometry?.pageElement
      || !pageGeometry.viewport || typeof pageGeometry.viewport.convertToViewportPoint !== 'function') return [];
    const view = pageGeometry.pageView;
    if ((!Array.isArray(view) && !ArrayBuffer.isView(view)) || view.length < 4) return [];
    const [xMin, yMin, xMax, yMax] = view;
    if (![xMin, yMin, xMax, yMax].every(Number.isFinite) || !(xMax > xMin) || !(yMax > yMin)) return [];
    const bounds = pageGeometry.pageElement.getBoundingClientRect();
    if (!Number.isFinite(bounds?.left) || !Number.isFinite(bounds?.top)) return [];
    return target.quads.map((quad) => {
      if (!Array.isArray(quad) || quad.length !== 8 || !quad.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
      const points = [];
      for (let index = 0; index < 8; index += 2) {
        const pdfX = xMin + quad[index] * (xMax - xMin);
        const pdfY = yMin + quad[index + 1] * (yMax - yMin);
        const viewportPoint = pageGeometry.viewport.convertToViewportPoint(pdfX, pdfY);
        if (!Array.isArray(viewportPoint) || viewportPoint.length < 2 || !viewportPoint.slice(0, 2).every(Number.isFinite)) return null;
        points.push([viewportPoint[0], viewportPoint[1]]);
      }
      return points;
    }).filter(Boolean);
  }

  root.pdfAnnotationGeometry = Object.freeze({
    MAX_SELECTION_PAGES: MAX_PAGES,
    capturePdfAnnotationSelection,
    projectPdfAnnotationTarget
  });
})(globalThis);
