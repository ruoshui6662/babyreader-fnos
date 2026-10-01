'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

async function waitUntil(predicate, message, { attempts = 100, delay = 5 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  assert.fail(message);
}

const geometryPath = path.resolve(__dirname, '../app/ui/reader/pdf-annotation-geometry.js');
const rendererPath = path.resolve(__dirname, '../app/ui/reader/pdf-annotations.js');

async function createGeometryHarness(markup, rectsByPage = {}) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/zhenshu/' });
  window.document.write(markup);
  window.Range.prototype.getClientRects = function getClientRects() {
    let node = this.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const page = node?.closest?.('.pdf-page');
    return rectsByPage[Number(page?.dataset.pageIndex)] || [];
  };
  const source = await fs.readFile(geometryPath, 'utf8');
  window.eval(source);
  return { window, geometry: window.pdfAnnotationGeometry };
}

function rect(left, top, right, bottom) {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function affineViewport(pageView, scale, rotation) {
  const [x0, y0, x1, y1] = pageView;
  const width = x1 - x0;
  const height = y1 - y0;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const forward = (x, y) => {
    if (normalizedRotation === 0) return [(x - x0) * scale, (y1 - y) * scale];
    if (normalizedRotation === 90) return [(y1 - y) * scale, (x - x0) * scale];
    if (normalizedRotation === 180) return [(x1 - x) * scale, (y - y0) * scale];
    return [(y - y0) * scale, (x1 - x) * scale];
  };
  const inverse = (x, y) => {
    if (normalizedRotation === 0) return [x0 + x / scale, y1 - y / scale];
    if (normalizedRotation === 90) return [x0 + y / scale, y1 - x / scale];
    if (normalizedRotation === 180) return [x1 - x / scale, y0 + y / scale];
    return [x1 - y / scale, y0 + x / scale];
  };
  return {
    scale,
    rotation: normalizedRotation,
    width: (normalizedRotation % 180 ? height : width) * scale,
    height: (normalizedRotation % 180 ? width : height) * scale,
    convertToPdfPoint: inverse,
    convertToViewportPoint: forward
  };
}

function pageGeometry(pageElement, pageIndex, { scale = 1, rotation = 0, pageView = [0, 0, 100, 100], left = 40, top = 60 } = {}) {
  const viewport = affineViewport(pageView, scale, rotation);
  pageElement.getBoundingClientRect = () => rect(left, top, left + viewport.width, top + viewport.height);
  return {
    bookId: 'a'.repeat(64),
    generation: 7,
    pageIndex,
    pageElement,
    pageView,
    viewport,
    scale
  };
}

function selectionFor(window, startNode, startOffset, endNode, endOffset) {
  const range = window.document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return {
    isCollapsed: range.collapsed,
    rangeCount: 1,
    getRangeAt: (index) => index === 0 ? range : null,
    toString: () => range.toString()
  };
}

test('selection capture splits a native Range by page and keeps each visual line as a separate quad', async () => {
  const { window, geometry } = await createGeometryHarness(`
    <main>
      <div class="pdf-page" data-page-index="0"><div class="pdf-page-text-layer">
        <span id="adjacentColumn">RIGHT COLUMN WORDS </span><span id="line1">alpha</span><br><span id="line2"> beta</span>
      </div></div>
      <div class="pdf-page" data-page-index="1"><div class="pdf-page-text-layer"><span id="last">omega end</span></div></div>
    </main>`, {
    0: [rect(45, 65, 85, 77), rect(45, 82, 90, 94)],
    1: [rect(45, 65, 95, 77)]
  });
  const pages = [...window.document.querySelectorAll('.pdf-page')];
  const first = window.document.getElementById('line1').firstChild;
  const last = window.document.getElementById('last').firstChild;
  const selection = selectionFor(window, first, 0, last, 5);
  const geometries = new Map(pages.map((page, index) => [index, pageGeometry(page, index)]));

  const captured = geometry.capturePdfAnnotationSelection(selection, (index) => geometries.get(index));

  assert.equal(captured.text, 'alpha beta omega');
  assert.doesNotMatch(captured.text, /RIGHT COLUMN|end/);
  assert.equal(Array.from(captured.targets, (target) => target.pageIndex).join(','), '0,1');
  assert.equal(captured.targets[0].quads.length, 2, 'two visual lines must not be merged into a bounding box');
  assert.equal(captured.targets[1].quads.length, 1);
  assert.equal(captured.anchor.pageIndex, 0);
  assert.equal(captured.bookId, 'a'.repeat(64));
  assert.equal(captured.generation, 7);
  assert.ok(captured.contextBefore.length <= 1000);
  assert.ok(captured.contextAfter.length <= 1000);
});

test('selection capture enforces the page, quad, and quote budgets', async () => {
  const pagesMarkup = Array.from({ length: 9 }, (_, index) =>
    `<div class="pdf-page" data-page-index="${index}"><div class="pdf-page-text-layer"><span id="p${index}">page${index} </span></div></div>`).join('');
  const manyRects = Array.from({ length: 513 }, (_, index) => rect(41, 61 + index, 42, 62 + index));
  const { window, geometry } = await createGeometryHarness(pagesMarkup, Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [index, [rect(41, 61, 70, 72)]])
  ));
  const pages = [...window.document.querySelectorAll('.pdf-page')];
  const first = window.document.getElementById('p0').firstChild;
  const ninth = window.document.getElementById('p8').firstChild;
  const geometries = new Map(pages.map((page, index) => [index, pageGeometry(page, index)]));
  assert.equal(geometry.capturePdfAnnotationSelection(
    selectionFor(window, first, 0, ninth, ninth.length), (index) => geometries.get(index)
  ), null, 'selection spanning more than eight pages is rejected');

  const onePage = pages[0];
  const text = window.document.createTextNode('x'.repeat(4001));
  onePage.querySelector('.pdf-page-text-layer').replaceChildren(text);
  window.Range.prototype.getClientRects = () => [rect(41, 61, 70, 72)];
  assert.equal(geometry.capturePdfAnnotationSelection(
    selectionFor(window, text, 0, text, text.length), (index) => geometries.get(index)
  ), null, 'oversized quote text is rejected before save');

  const shortText = window.document.createTextNode('short');
  onePage.querySelector('.pdf-page-text-layer').replaceChildren(shortText);
  const wideGeometry = pageGeometry(onePage, 0, { pageView: [0, 0, 1000, 1000] });
  window.Range.prototype.getClientRects = () => manyRects;
  assert.equal(geometry.capturePdfAnnotationSelection(
    selectionFor(window, shortText, 0, shortText, shortText.length), (index) => index === 0 ? wideGeometry : null
  ), null, 'more than 512 line quads are rejected');
});

test('selection outside the PDF text layer, collapsed ranges, and unavailable rendered pages are rejected', async () => {
  const { window, geometry } = await createGeometryHarness(`
    <p id="outside">not a PDF</p>
    <div class="pdf-page" data-page-index="0"><div class="pdf-page-text-layer"><span id="inside">PDF text</span></div></div>`);
  const page = window.document.querySelector('.pdf-page');
  const text = window.document.getElementById('inside').firstChild;
  const outside = window.document.getElementById('outside').firstChild;
  const getPage = (index) => index === 0 ? pageGeometry(page, 0) : null;

  assert.equal(geometry.capturePdfAnnotationSelection(selectionFor(window, outside, 0, text, 3), getPage), null);
  assert.equal(geometry.capturePdfAnnotationSelection(selectionFor(window, text, 2, text, 2), getPage), null);
  assert.equal(geometry.capturePdfAnnotationSelection(selectionFor(window, text, 0, text, 3), () => null), null);
});

test('normalized PDF quads round-trip through rotation and zoom without leaving the page', async () => {
  const { window, geometry } = await createGeometryHarness(`
    <div class="pdf-page" data-page-index="3"><div class="pdf-page-text-layer"><span id="text">selected words</span></div></div>`);
  const page = window.document.querySelector('.pdf-page');
  const text = window.document.getElementById('text').firstChild;
  const pageView = [10, 20, 110, 220];

  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [0.5, 1, 2]) {
      const g = pageGeometry(page, 3, { pageView, rotation, scale, left: 43, top: 61 });
      const original = rect(8, 12, Math.min(g.viewport.width - 8, 46), Math.min(g.viewport.height - 12, 62));
      window.Range.prototype.getClientRects = () => [rect(
        original.left + 43, original.top + 61, original.right + 43, original.bottom + 61
      )];
      const selection = selectionFor(window, text, 0, text, text.length);
      const captured = geometry.capturePdfAnnotationSelection(selection, () => g);

      assert.ok(captured, `capture must work at rotation ${rotation} and scale ${scale}`);
      const quad = captured.targets[0].quads[0];
      assert.equal(quad.length, 8);
      assert.ok(quad.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
      const projected = geometry.projectPdfAnnotationTarget(captured.targets[0], g);
      assert.equal(projected.length, 1);
      const expected = [
        [original.left, original.top], [original.right, original.top],
        [original.right, original.bottom], [original.left, original.bottom]
      ];
      projected[0].forEach((point, index) => {
        assert.ok(Math.abs(point[0] - expected[index][0]) <= 0.5, `x round-trip at rotation ${rotation}, scale ${scale}`);
        assert.ok(Math.abs(point[1] - expected[index][1]) <= 0.5, `y round-trip at rotation ${rotation}, scale ${scale}`);
      });
    }
  }
});

test('the PDF controller exposes geometry only for the currently rendered page and real page index', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/zhenshu/' });
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  const [stateSource, schedulerSource, pdfSource] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../app/ui/core/state.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../app/ui/reader/pdf-render-scheduler.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../app/ui/reader/pdf.js'), 'utf8')
  ]);
  window.eval(`${stateSource}\nfunction savePdfProgress() {}\n${schedulerSource}\n${pdfSource}`);
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  Object.defineProperty(window.document.getElementById('pdfPages'), 'clientWidth', { configurable: true, value: 1000 });
  const controller = window.createPdfReaderController({
    document: window.document,
    window,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 4,
        getPage: async () => ({
          view: [0, 0, 612, 792],
          getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale, scale, convertToPdfPoint: () => [0, 0] }),
          render: () => ({ promise: Promise.resolve(), cancel() {} }),
          cleanup() {}
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });

  assert.equal(typeof controller.getRenderedPageGeometry, 'function');
  assert.equal(controller.getRenderedPageGeometry(0), null);
  await controller.openPdf('b'.repeat(64));
  const geometry = await waitUntil(() => controller.getRenderedPageGeometry(0),
    'the first PDF frame should commit before geometry is read');
  assert.equal(geometry.bookId, 'b'.repeat(64));
  assert.equal(geometry.pageIndex, 0);
  assert.deepEqual(Array.from(geometry.pageView), [0, 0, 612, 792]);
  assert.equal(geometry.pageElement.dataset.pageIndex, '0');
  assert.ok(geometry.viewport);
  assert.ok(geometry.scale > 0);
  assert.equal(controller.getRenderedPageGeometry(99), null);
  controller.setPdfScale(1.5);
  assert.equal(controller.getRenderedPageGeometry(0), null, 'geometry from the prior zoom must not be reused');
  controller.setLayoutMode('double');
  assert.equal(controller.getEffectiveLayoutMode(), 'double');
  assert.equal(controller.goToPdfPage(2), true);
  const rightPageGeometry = await waitUntil(() => controller.getRenderedPageGeometry(2),
    'the target spread page should commit before geometry is read');
  assert.equal(rightPageGeometry.pageIndex, 2, 'the right page keeps its PDF page index, not its spread row');
  await controller.destroyPdfReader();
  assert.equal(controller.getRenderedPageGeometry(0), null);
});

test('PDF annotation overlays stay on their source page and reject stale page frames', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/zhenshu/' });
  window.document.write(`
    <div class="pdf-page" data-page-index="0"><canvas class="pdf-page-canvas"></canvas><div class="pdf-page-text-layer"></div></div>
    <div class="pdf-page" data-page-index="1"><canvas class="pdf-page-canvas"></canvas><div class="pdf-page-text-layer"></div></div>`);
  const drawCalls = [];
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      setTransform(...args) { drawCalls.push(['setTransform', ...args]); },
      clearRect(...args) { drawCalls.push(['clearRect', ...args]); },
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { drawCalls.push(['fill']); }, stroke() { drawCalls.push(['stroke']); }
    };
  };
  const [geometrySource, rendererSource] = await Promise.all([
    fs.readFile(geometryPath, 'utf8'),
    fs.readFile(rendererPath, 'utf8')
  ]);
  window.eval(`${geometrySource}\n${rendererSource}`);
  const pageElements = [...window.document.querySelectorAll('.pdf-page')];
  const geometries = new Map(pageElements.map((element, pageIndex) => [
    pageIndex, pageGeometry(element, pageIndex)
  ]));
  let frameId = 0;
  const frames = new Map();
  const renderer = window.createPdfAnnotationRenderer({
    document: window.document,
    window,
    getRenderedPageGeometry: (pageIndex) => geometries.get(pageIndex) || null,
    requestAnimationFrame: (callback) => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    devicePixelRatio: 1
  });
  const sourceFingerprint = 'f'.repeat(64);
  const record = {
    id: 'annotation-1', sourceFingerprint, style: 'marker', color: 'yellow', sourceStale: false,
    targets: [
      { pageIndex: 0, quads: [[0.1, 0.1, 0.4, 0.1, 0.4, 0.2, 0.1, 0.2]] },
      { pageIndex: 1, quads: [[0.2, 0.2, 0.5, 0.2, 0.5, 0.3, 0.2, 0.3]] }
    ]
  };
  const changedSourceRecord = {
    ...record, id: 'stale-source', sourceFingerprint: '0'.repeat(64), sourceStale: false
  };
  const serverMarkedStaleRecord = {
    ...record, id: 'server-marked-stale', sourceStale: true
  };
  renderer.setAnnotations({
    bookId: 'a'.repeat(64), generation: 7, sourceFingerprint,
    annotations: [record, changedSourceRecord, serverMarkedStaleRecord]
  });
  renderer.renderPdfAnnotationPage({ bookId: 'a'.repeat(64), generation: 7, pageIndex: 0, scale: 1 });
  renderer.renderPdfAnnotationPage({ bookId: 'a'.repeat(64), generation: 7, pageIndex: 1, scale: 1 });
  for (const callback of frames.values()) callback();
  frames.clear();

  const overlays = [...window.document.querySelectorAll('.pdf-annotation-layer')];
  assert.equal(overlays.length, 2);
  assert.equal(overlays[0].parentElement.dataset.pageIndex, '0');
  assert.equal(overlays[1].parentElement.dataset.pageIndex, '1');
  for (const overlay of overlays) {
    assert.equal(overlay.parentElement.querySelector('canvas'), overlay.previousElementSibling.previousElementSibling);
    assert.equal(window.getComputedStyle(overlay).pointerEvents, 'none');
  }
  assert.equal(drawCalls.filter(([name]) => name === 'fill').length, 2);

  renderer.clearPdfAnnotationPage({ bookId: 'a'.repeat(64), generation: 7, pageIndex: 0 });
  assert.equal(pageElements[0].querySelector('.pdf-annotation-layer'), null);
  assert.ok(pageElements[1].querySelector('.pdf-annotation-layer'));

  const page1Geometry = geometries.get(1);
  renderer.renderPdfAnnotationPage({ bookId: 'a'.repeat(64), generation: 7, pageIndex: 1, scale: 1 });
  page1Geometry.scale = 2;
  for (const callback of frames.values()) callback();
  frames.clear();
  assert.equal(drawCalls.filter(([name]) => name === 'fill').length, 2, 'old-scale frame is not painted');

  renderer.setAnnotations({ bookId: 'b'.repeat(64), generation: 8, sourceFingerprint: 'e'.repeat(64), annotations: [] });
  assert.equal(window.document.querySelectorAll('.pdf-annotation-layer').length, 0, 'switching book clears old page marks');
  renderer.renderPdfAnnotationPage({ bookId: 'a'.repeat(64), generation: 7, pageIndex: 1, scale: 1 });
  assert.equal(window.document.querySelectorAll('.pdf-annotation-layer').length, 0, 'a late old generation cannot restore marks');
  renderer.clearPdfAnnotationSurface();
  renderer.destroy();
});

test('PDF annotation renderer paints only the newest committed page frameId', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/' });
  window.document.write('<div class="pdf-page" data-page-index="0"><canvas class="pdf-page-canvas"></canvas><div class="pdf-page-text-layer"></div></div>');
  let fillCount = 0;
  window.HTMLCanvasElement.prototype.getContext = () => ({
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    set fillStyle(value) {}, fill() { fillCount += 1; }
  });
  const [geometrySource, rendererSource] = await Promise.all([
    fs.readFile(geometryPath, 'utf8'),
    fs.readFile(rendererPath, 'utf8')
  ]);
  window.eval(`${geometrySource}\n${rendererSource}`);
  const pageElement = window.document.querySelector('.pdf-page');
  let geometry = { ...pageGeometry(pageElement, 0), frameId: 'frame-1' };
  const callbacks = [];
  const renderer = window.createPdfAnnotationRenderer({
    document: window.document,
    window,
    getRenderedPageGeometry: () => geometry,
    requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelAnimationFrame: () => {},
    devicePixelRatio: 1
  });
  const sourceFingerprint = 'f'.repeat(64);
  renderer.setAnnotations({
    bookId: 'a'.repeat(64), generation: 7, sourceFingerprint,
    annotations: [{
      id: 'annotation-frame', sourceFingerprint, style: 'marker', color: 'yellow', sourceStale: false,
      targets: [{ pageIndex: 0, quads: [[0.1, 0.1, 0.4, 0.1, 0.4, 0.2, 0.1, 0.2]] }]
    }]
  });

  assert.equal(renderer.onPageFrameCommitted({ ...geometry, scale: 1 }), true);
  geometry = { ...geometry, frameId: 'frame-2' };
  assert.equal(renderer.onPageFrameCommitted({ ...geometry, scale: 1 }), true);
  callbacks[0]();
  callbacks[1]();

  const overlay = pageElement.querySelector('.pdf-annotation-layer');
  assert.equal(fillCount, 1);
  assert.equal(overlay.dataset.frameId, 'frame-2');
});
