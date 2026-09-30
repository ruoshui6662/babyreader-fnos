'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

async function createControllerHarness({ getDocument, onOutline, onPageChange, setupWindow } = {}) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/babyreader-fnos/' });
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  setupWindow?.(window);
  const html = await fs.readFile(path.resolve(__dirname, '../app/ui/index.html'), 'utf8');
  window.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  const [stateSource, schedulerSource, pdfSource] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../app/ui/core/state.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../app/ui/reader/pdf-render-scheduler.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../app/ui/reader/pdf.js'), 'utf8')
  ]);
  window.eval(`${stateSource}\nfunction savePdfProgress() {}\n${schedulerSource}\n${pdfSource}\nwindow.testPdfSpreadForPage = pdfSpreadForPage;`);
  const controller = window.createPdfReaderController({
    document: window.document,
    window,
    getDocument: getDocument || (() => { throw new Error('unexpected PDF load'); }),
    onOutline,
    onPageChange
  });
  return { window, controller };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, message, { attempts = 100, delay = 5 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  assert.fail(typeof message === 'function' ? message() : message);
}

function fakePage() {
  return {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {}
  };
}

test('PDF debug state exposes bounded rendering signals without changing the reader UI', async () => {
  const { controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });

  await controller.openPdf('d'.repeat(64));
  await waitUntil(() => {
    const state = controller.getDebugState();
    return state.activeRenderCount === 0 && state.queuedPages.length === 0;
  }, 'PDF scheduler should settle before its debug state is asserted');

  assert.deepEqual(JSON.parse(JSON.stringify(controller.getDebugState())), {
    generation: controller.getGeneration(),
    activeRenderCount: 0,
    queuedPages: [],
    renderedPages: 4,
    cachedPageSizeCount: 4,
    materializedPageCount: 4,
    lazyPageFrames: false,
    currentPage: 0,
    scale: 1,
    layoutMode: 'continuous'
  });
});

test('PDF controller admits only one visible render task and starts the next page after settlement', async () => {
  const starts = [];
  const gates = [];
  const { controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 4,
        getPage: async (pageNumber) => ({
          ...fakePage(),
          render: () => {
            const gate = deferred();
            starts.push(pageNumber);
            gates.push(gate);
            return { promise: gate.promise, cancel: () => gate.reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })) };
          }
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });

  await controller.openPdf('7'.repeat(64));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, [1]);
  assert.equal(controller.getDebugState().activeRenderCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getDebugState().queuedPages)), [1, 2, 3]);

  gates[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, [1, 2]);
  assert.equal(controller.getDebugState().activeRenderCount, 1);

  for (const gate of gates) gate.resolve();
});

test('PDF page frames keep canvas and text on one frameId until the replacement frame is complete', async () => {
  const replacement = deferred();
  let renderCount = 0;
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          ...fakePage(),
          view: [0, 0, 612, 792],
          render: () => {
            renderCount += 1;
            return { promise: renderCount === 1 ? Promise.resolve() : replacement.promise, cancel() {} };
          }
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });

  await controller.openPdf('3'.repeat(64));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const page = window.document.querySelector('.pdf-page[data-page-index="0"]');
  const firstFrame = controller.getRenderedPageGeometry(0);
  assert.match(firstFrame.frameId, /^1:0:/);
  assert.equal(page.querySelector('.pdf-page-canvas').dataset.frameId, firstFrame.frameId);
  assert.equal(page.querySelector('.pdf-page-text-layer').dataset.frameId, firstFrame.frameId);

  controller.setPdfScale(1.5);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.classList.contains('is-frame-pending'), true);
  assert.equal(page.querySelector('.pdf-page-canvas').style.width, '918px');
  assert.match(page.querySelector('.pdf-page-text-layer').style.transform, /scale\(1\.5/);
  assert.equal(page.querySelector('.pdf-page-canvas').dataset.frameId, firstFrame.frameId);
  assert.equal(page.querySelector('.pdf-page-text-layer').dataset.frameId, firstFrame.frameId);
  assert.equal(controller.getRenderedPageGeometry(0), null);

  replacement.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const secondFrame = controller.getRenderedPageGeometry(0);
  assert.notEqual(secondFrame.frameId, firstFrame.frameId);
  assert.equal(page.classList.contains('is-frame-pending'), false);
  assert.equal(page.querySelector('.pdf-page-canvas').dataset.frameId, secondFrame.frameId);
  assert.equal(page.querySelector('.pdf-page-text-layer').dataset.frameId, secondFrame.frameId);
});

test('PDF replacement failure preserves the old frame and offers a bounded page retry', async () => {
  let renderCount = 0;
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          ...fakePage(),
          view: [0, 0, 612, 792],
          render: () => {
            renderCount += 1;
            return {
              promise: renderCount === 2 ? Promise.reject(new Error('synthetic render failure')) : Promise.resolve(),
              cancel() {}
            };
          }
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });

  await controller.openPdf('2'.repeat(64));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const page = window.document.querySelector('.pdf-page[data-page-index="0"]');
  const oldFrameId = page.dataset.frameId;
  controller.setPdfScale(1.5);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(page.dataset.frameId, oldFrameId);
  assert.equal(page.getAttribute('aria-busy'), 'false');
  const retry = page.querySelector('.pdf-page-retry');
  assert.ok(retry);
  retry.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.notEqual(page.dataset.frameId, oldFrameId);
  assert.equal(page.querySelector('.pdf-page-retry'), null);
});

test('PDF controller cancels an off-buffer neighbor render after rapid reverse scrolling', async () => {
  const starts = [];
  const gates = new Map();
  const cancelled = [];
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 4,
        getPage: async (pageNumber) => ({
          ...fakePage(),
          render: () => {
            const gate = deferred();
            starts.push(pageNumber);
            gates.set(pageNumber, gate);
            return {
              promise: gate.promise,
              cancel: () => {
                cancelled.push(pageNumber);
                gate.reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' }));
              }
            };
          }
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 800 });
  host.getBoundingClientRect = () => ({ top: 0 });

  await controller.openPdf('5'.repeat(64));
  for (const [pageIndex, wrapper] of [...host.querySelectorAll('.pdf-page')].entries()) {
    Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 792 });
    wrapper.getBoundingClientRect = () => ({
      top: pageIndex * 1000 - host.scrollTop,
      bottom: pageIndex * 1000 + 792 - host.scrollTop
    });
  }
  gates.get(1).resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, [1, 2]);

  host.scrollTop = 3000;
  controller.renderVisiblePdfPages();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cancelled, [2]);
  assert.deepEqual(starts, [1, 2, 4]);
  gates.get(4).resolve();
});

test('PDF neighbor render failures stay page-local until the failed page becomes current', async () => {
  let failingPageAttempts = 0;
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async (pageNumber) => {
          if (pageNumber === 2) {
            failingPageAttempts += 1;
            throw new Error('synthetic neighbor failure');
          }
          return fakePage();
        },
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });

  await controller.openPdf('6'.repeat(64));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(window.document.getElementById('pdfReaderStatus').textContent, '3 页');
  assert.equal(window.document.querySelector('.pdf-page[data-page-index="1"]').dataset.renderState, 'error');
  assert.equal(failingPageAttempts, 1);

  controller.goToPdfPage(1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(failingPageAttempts, 2);
  assert.match(window.document.getElementById('pdfReaderStatus').textContent, /第 2 页无法渲染/);
});

test('PDF spreads keep the cover alone and pair following pages without losing the final page', async () => {
  const { window } = await createControllerHarness();
  const cases = [
    [0, 1, { firstPageIndex: 0, pageIndices: [0] }],
    [0, 2, { firstPageIndex: 0, pageIndices: [0] }],
    [1, 2, { firstPageIndex: 1, pageIndices: [1] }],
    [2, 3, { firstPageIndex: 1, pageIndices: [1, 2] }],
    [0, 4, { firstPageIndex: 0, pageIndices: [0] }],
    [2, 4, { firstPageIndex: 1, pageIndices: [1, 2] }],
    [3, 4, { firstPageIndex: 3, pageIndices: [3] }],
    [442, 444, { firstPageIndex: 441, pageIndices: [441, 442] }],
    [443, 444, { firstPageIndex: 443, pageIndices: [443] }]
  ];
  for (const [index, count, expected] of cases) {
    const actual = window.testPdfSpreadForPage(index, count);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  }
  assert.throws(() => window.testPdfSpreadForPage(-1, 4), /page index/i);
  assert.throws(() => window.testPdfSpreadForPage(4, 4), /page index/i);
  assert.throws(() => window.testPdfSpreadForPage(0.5, 4), /page index/i);
});

test('PDF layout regroups the same page and text-layer nodes only when double is effective', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('a'.repeat(64));
  const originalPages = [...host.querySelectorAll('.pdf-page')];
  originalPages[2].querySelector('.pdf-page-text-layer').dataset.testSentinel = 'kept';

  assert.equal(controller.setLayoutMode('double'), true);
  assert.equal(controller.getEffectiveLayoutMode(), 'double');
  assert.deepEqual([...host.children].map((row) => [...row.querySelectorAll('.pdf-page')]
    .map((page) => Number(page.dataset.pageIndex))), [[0], [1, 2], [3]]);
  assert.equal(host.querySelector('.pdf-page[data-page-index="2"]'), originalPages[2]);
  assert.equal(originalPages[2].querySelector('.pdf-page-text-layer').dataset.testSentinel, 'kept');

  assert.equal(controller.setLayoutMode('continuous'), true);
  assert.equal(controller.getEffectiveLayoutMode(), 'continuous');
  assert.deepEqual([...host.children], originalPages);
  assert.equal(controller.setLayoutMode('bogus'), false);
  assert.equal(controller.getEffectiveLayoutMode(), 'continuous');
});

test('an active PDF text selection pins its page until selection is collapsed', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 800 });
  host.getBoundingClientRect = () => ({ top: 0 });
  await controller.openPdf('a'.repeat(64));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const page = window.document.querySelector('.pdf-page[data-page-index="0"]');
  const textLayer = page.querySelector('.pdf-page-text-layer');
  const text = window.document.createElement('span');
  text.textContent = 'selected PDF text';
  textLayer.append(text);
  const range = window.document.createRange();
  range.selectNodeContents(text);
  window.getSelection().addRange(range);

  for (const [index, wrapper] of [...host.querySelectorAll('.pdf-page')].entries()) {
    const absoluteTop = index * 900;
    wrapper.getBoundingClientRect = () => ({
      top: absoluteTop - host.scrollTop,
      bottom: absoluteTop + 792 - host.scrollTop
    });
    Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 792 });
  }
  host.scrollTop = 2500;
  controller.renderVisiblePdfPages();

  assert.equal(textLayer.contains(text), true);
  assert.ok(page.querySelector('canvas').width > 0);

  window.getSelection().removeAllRanges();
  window.document.dispatchEvent(new window.Event('selectionchange'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(textLayer.childNodes.length, 0);
});

test('PDF selection spanning more than the supported cache window is safely cleared', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 9, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  await controller.openPdf('9'.repeat(64));
  const start = window.document.querySelector('.pdf-page[data-page-index="0"] .pdf-page-text-layer');
  const end = window.document.querySelector('.pdf-page[data-page-index="8"] .pdf-page-text-layer');
  const startText = window.document.createTextNode('beginning');
  const endText = window.document.createTextNode('ending');
  start.append(startText);
  end.append(endText);
  const range = window.document.createRange();
  range.setStart(startText, 0);
  range.setEnd(endText, endText.length);
  window.getSelection().addRange(range);

  window.document.dispatchEvent(new window.Event('selectionchange'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(window.getSelection().isCollapsed, true);
  assert.match(window.document.getElementById('pdfReaderStatus').textContent, /最多保留 8 页/);
});

test('PDF selection is cleared before its pinned canvases exceed the pixel memory budget', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 2, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  await controller.openPdf('8'.repeat(64));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = window.document.querySelector('.pdf-page[data-page-index="0"]');
  const second = window.document.querySelector('.pdf-page[data-page-index="1"]');
  const firstText = window.document.createTextNode('beginning');
  const secondText = window.document.createTextNode('ending');
  first.querySelector('.pdf-page-text-layer').append(firstText);
  second.querySelector('.pdf-page-text-layer').append(secondText);
  first.querySelector('canvas').width = 32000001;
  const range = window.document.createRange();
  range.setStart(firstText, 0);
  range.setEnd(secondText, secondText.length);
  window.getSelection().addRange(range);

  window.document.dispatchEvent(new window.Event('selectionchange'));

  assert.equal(window.getSelection().isCollapsed, true);
  assert.match(window.document.getElementById('pdfReaderStatus').textContent, /占用过多内存/);
});

test('double-page navigation keeps a directly selected right page until the reader moves to another spread', async () => {
  const changes = [];
  const { window, controller } = await createControllerHarness({
    onPageChange: (change) => changes.push(change.pageIndex),
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('b'.repeat(64));
  controller.setLayoutMode('double');
  controller.goToPdfPage(2);
  assert.equal(controller.getCurrentPageIndex(), 2);
  host.getBoundingClientRect = () => ({ top: 0 });
  for (const page of host.querySelectorAll('.pdf-page')) {
    const index = Number(page.dataset.pageIndex);
    page.getBoundingClientRect = () => index === 0
      ? { top: -800, bottom: -20 }
      : index <= 2 ? { top: 0, bottom: 800 } : { top: 840, bottom: 1640 };
  }
  host.dispatchEvent(new window.Event('scroll'));
  assert.equal(controller.getCurrentPageIndex(), 2);
  assert.equal(changes.at(-1), 2);

  window.document.getElementById('pdfNextPage').click();
  assert.equal(controller.getCurrentPageIndex(), 3);
  assert.equal(window.document.getElementById('pdfNextPage').disabled, true);
  window.document.getElementById('pdfPreviousPage').click();
  assert.equal(controller.getCurrentPageIndex(), 1);
  controller.goToPdfPage(0);
  assert.equal(window.document.getElementById('pdfPreviousPage').disabled, true);
  controller.setLayoutMode('single');
  controller.goToPdfPage(2);
  window.document.getElementById('pdfNextPage').click();
  assert.equal(controller.getCurrentPageIndex(), 3);
});

test('switching to double disables next at the final two-page spread without changing the saved page', async () => {
  const changes = [];
  const { window, controller } = await createControllerHarness({
    onPageChange: (change) => changes.push(change.pageIndex),
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 3, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('d'.repeat(64));
  controller.goToPdfPage(1);
  assert.equal(window.document.getElementById('pdfNextPage').disabled, false);
  controller.setLayoutMode('double');
  assert.equal(controller.getCurrentPageIndex(), 1);
  assert.equal(window.document.getElementById('pdfNextPage').disabled, true);
  assert.deepEqual(changes, [1]);
});

test('a stale scroll event during PDF regrouping does not overwrite the selected right page', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('e'.repeat(64));
  controller.goToPdfPage(2);
  controller.setLayoutMode('double');
  host.getBoundingClientRect = () => ({ top: 0 });
  for (const page of host.querySelectorAll('.pdf-page')) {
    page.getBoundingClientRect = () => ({ top: 0, bottom: 800 });
  }
  host.dispatchEvent(new window.Event('scroll'));
  assert.equal(controller.getCurrentPageIndex(), 2);
});

test('scroll position resolves deep PDF pages in document coordinates instead of snapping back to page one', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.getBoundingClientRect = () => ({ top: 0 });
  await controller.openPdf('7'.repeat(64));
  host.scrollTop = 1648;
  for (const [index, wrapper] of [...host.querySelectorAll('.pdf-page')].entries()) {
    const top = 96 + index * 812 - host.scrollTop;
    wrapper.getBoundingClientRect = () => ({ top, bottom: top + 792 });
  }

  host.dispatchEvent(new window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(controller.getCurrentPageIndex(), 2);
  assert.equal(window.document.getElementById('pdfPageNumber').value, '3');
});

test('double PDF fit-width uses both actual page widths and the spread gap', async () => {
  const widths = [612, 400, 600];
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async (number) => ({
          ...fakePage(),
          getViewport: ({ scale }) => ({ width: widths[number - 1] * scale, height: 792 * scale })
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.style.padding = '0px';
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('f'.repeat(64));
  controller.setLayoutMode('double');
  controller.goToPdfPage(1);
  window.document.getElementById('pdfFitWidth').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '98%');
  assert.equal(controller.getCurrentPageIndex(), 1);
});

test('PDF double preference survives a 899px fallback and returns at 900px without changing manual zoom', async () => {
  let width = 899;
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 3, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.style.padding = '0px';
  Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => width });
  await controller.openPdf('f'.repeat(64));
  controller.goToPdfPage(2);
  controller.setLayoutMode('double');
  assert.equal(controller.getEffectiveLayoutMode(), 'single');
  controller.setPdfScale(1.5);
  width = 900;
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(controller.getEffectiveLayoutMode(), 'double');
  assert.equal(controller.getCurrentPageIndex(), 2);
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '150%');
  width = 899;
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(controller.getEffectiveLayoutMode(), 'single');
  assert.equal(controller.getCurrentPageIndex(), 2);
});

test('double fit-width reports a failed right page without replacing the visible page', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async (number) => {
          if (number === 3) throw new Error('private document details');
          return fakePage();
        },
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.style.padding = '0px';
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('f'.repeat(64));
  controller.setLayoutMode('double');
  controller.goToPdfPage(1);
  window.document.getElementById('pdfFitWidth').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getCurrentPageIndex(), 1);
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '100%');
  assert.match(window.document.getElementById('pdfReaderStatus').textContent, /第 3 页无法(读取页面尺寸|渲染)/);
  assert.doesNotMatch(window.document.getElementById('pdfReaderStatus').textContent, /private document details/);
});

test('a pending double-page fit cannot overwrite a manual zoom or a new book', async () => {
  const pendingRight = deferred();
  const { window, controller } = await createControllerHarness({
    getDocument: ({ url }) => ({
      promise: Promise.resolve({
        numPages: url.includes('a'.repeat(64)) ? 3 : 1,
        getPage: async (number) => number === 3 ? pendingRight.promise : fakePage(),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.style.padding = '0px';
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  await controller.openPdf('a'.repeat(64));
  controller.setLayoutMode('double');
  controller.goToPdfPage(1);
  window.document.getElementById('pdfFitWidth').click();
  controller.setPdfScale(1.5);
  await controller.openPdf('b'.repeat(64));
  pendingRight.resolve(fakePage());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getCurrentBookId(), 'b'.repeat(64));
  assert.equal(controller.getCurrentPageIndex(), 0);
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '100%');
  assert.equal(host.querySelectorAll('.pdf-page').length, 1);
});

test('PDF dimension cache stays bounded while every page shell keeps stable fallback geometry', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 129, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  await controller.openPdf('a'.repeat(64));
  await waitUntil(() => controller.getDebugState().queuedPages.length === 0,
    'all PDF page sizes should finish loading');
  const widths = [...host.querySelectorAll('.pdf-page')].filter((page) => page.style.width);
  assert.equal(widths.length, 129, 'fallback geometry prevents unrendered page shells from collapsing');
  assert.ok(controller.getDebugState().cachedPageSizeCount <= 128);
  assert.ok(host.querySelector('.pdf-page[data-page-index="0"]').style.width);
  assert.ok(host.querySelector('.pdf-page[data-page-index="128"]').style.width);
});

test('large PDFs keep lightweight page shells and materialize a direct jump without observing every page', async () => {
  for (const pageCount of [500, 5000]) {
    const observed = [];
    const { window, controller } = await createControllerHarness({
      setupWindow(win) {
        win.IntersectionObserver = class {
          observe(element) { observed.push(element); }
          disconnect() {}
        };
      },
      getDocument: () => ({
        promise: Promise.resolve({ numPages: pageCount, getPage: async () => fakePage(), destroy: async () => {} }),
        destroy: async () => {}
      })
    });
    const host = window.document.getElementById('pdfPages');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 800 });

    await controller.openPdf('a'.repeat(64));

    assert.equal(host.querySelectorAll('.pdf-page').length, pageCount);
    assert.ok(host.querySelectorAll('.pdf-page-canvas').length <= 10,
      `${pageCount} pages should not allocate one canvas per page`);
    assert.ok(host.querySelectorAll('.pdf-page-text-layer').length <= 10,
      `${pageCount} pages should not allocate one text layer per page`);
    assert.ok(observed.length <= 10, `${pageCount} pages should not register one observer target per page`);
    assert.ok(host.querySelector('.pdf-page[data-page-index="0"]').style.width);
    assert.ok(host.querySelector('.pdf-page[data-page-index="0"]').style.aspectRatio);

    const target = pageCount - 1;
    const wrappers = [...host.querySelectorAll('.pdf-page')];
    host.getBoundingClientRect = () => ({ top: 0 });
    host.scrollTop = target * 800;
    wrappers.forEach((wrapper, index) => {
      wrapper.getBoundingClientRect = () => ({ top: (index - target) * 800, bottom: (index - target + 1) * 800 });
      Object.defineProperty(wrapper, 'offsetHeight', { configurable: true, value: 800 });
      Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 800 });
    });

    assert.equal(controller.goToPdfPage(target), true);
    const targetWrapper = host.querySelector(`.pdf-page[data-page-index="${target}"]`);
    await waitUntil(() => targetWrapper?.dataset.renderState === 'ready' && targetWrapper.dataset.frameId,
      () => `direct page ${target + 1} jump should materialize its frame: ${JSON.stringify(controller.getDebugState())}`);
    assert.equal(targetWrapper.querySelector('.pdf-page-canvas')?.dataset.frameId, targetWrapper.dataset.frameId);
    assert.equal(targetWrapper.querySelector('.pdf-page-text-layer')?.dataset.frameId, targetWrapper.dataset.frameId);
    assert.ok(host.querySelectorAll('.pdf-page-canvas').length <= 10);
    await controller.destroyPdfReader();
  }
});

test('closing PDF reader cancels an in-flight document load and keeps the surface closed', async () => {
  let destroyCalls = 0;
  const started = deferred();
  const loading = deferred();
  const { window, controller } = await createControllerHarness({
    getDocument: () => {
      started.resolve();
      return {
      promise: loading.promise,
      destroy: async () => { destroyCalls += 1; }
      };
    }
  });

  const opening = controller.openPdf('a'.repeat(64));
  await started.promise;
  await controller.destroyPdfReader();
  const staleDocument = { numPages: 1, destroy: async () => { destroyCalls += 1; } };
  loading.resolve(staleDocument);
  await opening;

  assert.equal(destroyCalls, 2, 'both the loading task and stale resolved document are released');
  assert.equal(window.document.body.classList.contains('is-pdf-reader'), false);
  assert.equal(window.document.querySelector('#pdfReaderSurface').hidden, true);
  assert.equal(window.document.querySelector('#pdfPages')?.children.length, 0);
});

test('a late first PDF load cannot replace the second book after a rapid switch', async () => {
  const first = deferred();
  const second = deferred();
  const firstStarted = deferred();
  const loadingTasks = new Map();
  const { window, controller } = await createControllerHarness({
    getDocument: ({ url }) => {
      if (url.includes('a'.repeat(64))) firstStarted.resolve();
      const task = {
        promise: (url.includes('a'.repeat(64)) ? first : second).promise,
        destroy: async () => {}
      };
      loadingTasks.set(url, task);
      return task;
    }
  });

  const firstOpen = controller.openPdf('a'.repeat(64));
  await firstStarted.promise;
  const secondOpen = controller.openPdf('b'.repeat(64));
  second.resolve({ numPages: 2, getPage: async () => fakePage(), destroy: async () => {} });
  await secondOpen;
  first.resolve({ numPages: 1, destroy: async () => {} });
  await firstOpen;

  assert.equal(controller.getCurrentBookId(), 'b'.repeat(64));
  assert.equal(window.document.querySelector('#pdfReaderSurface').dataset.bookId, 'b'.repeat(64));
  assert.equal(window.document.querySelectorAll('#pdfPages [data-page-index]').length, 2);
  assert.equal(loadingTasks.size, 2);
});

test('PDF loading errors are shown as safe reader text and tear down partial state', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.reject(Object.assign(new Error('<img src=x onerror=alert(1)>'), { name: 'InvalidPDFException' })),
      destroy: async () => {}
    })
  });

  await assert.rejects(controller.openPdf('c'.repeat(64)));
  const error = window.document.querySelector('#pdfReaderStatus');
  assert.equal(error.textContent.includes('<img'), false);
  assert.equal(error.querySelector('img'), null);
  assert.match(error.textContent, /PDF/);
  assert.equal(window.document.body.classList.contains('is-pdf-reader'), true);
  assert.equal(window.document.querySelector('#pdfReaderSurface').hidden, false);
});

test('password-protected PDFs receive a specific safe message without exposing parser errors', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.reject(Object.assign(new Error('provider detail'), { name: 'PasswordException' })),
      destroy: async () => {}
    })
  });
  await assert.rejects(controller.openPdf('1'.repeat(64)));
  assert.equal(window.document.querySelector('#pdfReaderStatus').textContent, '此 PDF 受密码保护，当前版本暂不支持打开。');
  assert.equal(window.document.querySelector('#pdfPages').children.length, 0);
});

test('PDFs exceeding the page budget fail closed before allocating page elements', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 10001, destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  await assert.rejects(controller.openPdf('2'.repeat(64)));
  assert.equal(window.document.querySelector('#pdfReaderStatus').textContent, '此 PDF 页数超过当前版本支持范围。');
  assert.equal(window.document.querySelector('#pdfPages').children.length, 0);
});

test('closing the reader cancels an active canvas render task', async () => {
  const started = deferred();
  let cancelCalls = 0;
  let rejectRender;
  const document = {
    numPages: 1,
    getPage: async () => ({
      getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => {
        const promise = new Promise((resolve, reject) => { rejectRender = reject; });
        started.resolve();
        return {
          promise,
          cancel: () => {
            cancelCalls += 1;
            rejectRender(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' }));
          }
        };
      },
      cleanup: () => {}
    }),
    getOutline: async () => null,
    destroy: async () => {}
  };
  const { controller } = await createControllerHarness({
    getDocument: () => ({ promise: Promise.resolve(document), destroy: async () => {} })
  });

  await controller.openPdf('e'.repeat(64));
  await started.promise;
  await controller.destroyPdfReader();
  assert.equal(cancelCalls, 1);
});

test('PDF outline destinations are normalized to safe zero-based page targets', async () => {
  const reference = { num: 7, gen: 0 };
  const result = [];
  const { controller } = await createControllerHarness({
    onOutline: (outline) => result.push(...outline),
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async () => fakePage(),
        getOutline: async () => [{ title: 'Chapter 2', dest: [reference], url: 'https://attacker.invalid/' }],
        getDestination: async () => null,
        getPageIndex: async (pageRef) => pageRef === reference ? 1 : -1,
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  await controller.openPdf('f'.repeat(64));

  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'Chapter 2');
  assert.equal(result[0].target, 'pdf-page:1');
  assert.equal(result[0].depth, 0);
});

test('PDF open restores a valid zero-based saved page and clamps out-of-range pages', async () => {
  const makeDocument = () => ({
    numPages: 3,
    getPage: async () => fakePage(),
    destroy: async () => {}
  });
  const { controller } = await createControllerHarness({
    getDocument: () => ({ promise: Promise.resolve(makeDocument()), destroy: async () => {} })
  });

  await controller.openPdf('a'.repeat(64), undefined, { version: 1, type: 'pdf', pageIndex: 2 });
  assert.equal(controller.getCurrentPageIndex(), 2);
  await controller.openPdf('b'.repeat(64), undefined, { version: 1, type: 'pdf', pageIndex: 99 });
  assert.equal(controller.getCurrentPageIndex(), 2);
  await controller.openPdf('c'.repeat(64), undefined, { version: 1, type: 'pdf', pageIndex: -1 });
  assert.equal(controller.getCurrentPageIndex(), 0);
  await controller.openPdf('d'.repeat(64), undefined, { version: 2, type: 'epub', pageIndex: 2 });
  assert.equal(controller.getCurrentPageIndex(), 0);
});

test('initial PDF restore ignores scroll events until the saved page anchor settles', async () => {
  const changes = [];
  const { window, controller } = await createControllerHarness({
    onPageChange: (change) => changes.push(change),
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 4, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
  host.getBoundingClientRect = () => ({ top: 0 });

  await controller.openPdf('a'.repeat(64), undefined, { version: 1, type: 'pdf', pageIndex: 3 });
  for (const page of host.querySelectorAll('.pdf-page')) {
    page.getBoundingClientRect = () => ({ top: 0, bottom: 800 });
  }
  host.dispatchEvent(new window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(controller.getCurrentPageIndex(), 3);
  assert.deepEqual(changes, []);
});

test('PDF page changes emit book and document generation for stale-save rejection', async () => {
  const changes = [];
  const { controller } = await createControllerHarness({
    onPageChange: (change) => changes.push(change),
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 3, getPage: async () => fakePage(), destroy: async () => {} }),
      destroy: async () => {}
    })
  });
  await controller.openPdf('e'.repeat(64));
  const generation = controller.getGeneration();
  controller.goToPdfPage(1);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].bookId, 'e'.repeat(64));
  assert.equal(changes[0].pageIndex, 1);
  assert.equal(changes[0].generation, generation);
});

test('PDF API open passes the authorized same-origin URL without buffering the whole response', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/app/babyreader-fnos/' });
  window.eval([
    await fs.readFile(path.resolve(__dirname, '../app/ui/core/state.js'), 'utf8'),
    await fs.readFile(path.resolve(__dirname, '../app/ui/core/api.js'), 'utf8')
  ].join('\n'));
  const calls = [];
  window.appHost = { receiveDocument: async (payload) => { calls.push(payload); } };
  window.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => { throw new Error('must not buffer full PDF'); },
    text: async () => { throw new Error('must not decode PDF as text'); }
  });

  await window.browserHost.openBook({
    id: 'd'.repeat(64), type: 'pdf', title: 'Long PDF', relativePath: 'private/file.pdf'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'pdf');
  assert.equal(calls[0].contentUrl, '/app/babyreader-fnos/api/books/' + 'd'.repeat(64) + '/content');
  assert.equal(calls[0].content, undefined);
  assert.equal(calls[0].data, undefined);
});

test('PDF zoom label shows the effective scale chosen when opening a wide page', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          ...fakePage(),
          getViewport: ({ scale }) => ({ width: 1200 * scale, height: 1600 * scale })
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  window.document.getElementById('pdfPages').style.padding = '24px 20px 56px';

  await controller.openPdf('a'.repeat(64));

  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '67%');
});

test('PDF zoom sizes every unrendered page shell from the reliable default page geometry', async () => {
  const renderGate = deferred();
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async () => ({
          ...fakePage(),
          render: () => ({ promise: renderGate.promise, cancel() {} })
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });

  await controller.openPdf('4'.repeat(64));
  controller.setPdfScale(2);
  const widths = [...window.document.querySelectorAll('.pdf-page')].map((page) => page.style.width);
  assert.deepEqual(widths, ['1224px', '1224px', '1224px']);
  renderGate.resolve();
});

test('a delayed fit-width response cannot override a newer manual zoom choice', async () => {
  const delayedPage = deferred();
  let delayPageRequests = false;
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => delayPageRequests ? delayedPage.promise : fakePage(),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  await controller.openPdf('a'.repeat(64));
  delayPageRequests = true;

  window.document.getElementById('pdfFitWidth').click();
  controller.setPdfScale(1.5);
  delayedPage.resolve(fakePage());
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '150%');
});

test('fit-width recalculates when paging to a PDF sheet with a different width', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (number) => ({
          ...fakePage(),
          getViewport: ({ scale }) => ({
            width: (number === 1 ? 612 : 1000) * scale,
            height: 792 * scale
          })
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.style.padding = '24px 20px 56px';
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
  await controller.openPdf('a'.repeat(64));

  window.document.getElementById('pdfFitWidth').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '124%');

  controller.goToPdfPage(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '76%');
});

test('fit-width recalculates after scrolling onto a differently sized PDF page', async () => {
  const { window, controller } = await createControllerHarness({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (number) => ({
          ...fakePage(),
          getViewport: ({ scale }) => ({ width: (number === 1 ? 612 : 1000) * scale, height: 792 * scale })
        }),
        destroy: async () => {}
      }),
      destroy: async () => {}
    })
  });
  const host = window.document.getElementById('pdfPages');
  host.style.padding = '24px 20px 56px';
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
  await controller.openPdf('a'.repeat(64));
  window.document.getElementById('pdfFitWidth').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '124%');

  host.getBoundingClientRect = () => ({ top: 0 });
  host.children[0].getBoundingClientRect = () => ({ top: -792, bottom: 0 });
  host.children[1].getBoundingClientRect = () => ({ top: 0, bottom: 792 });
  host.dispatchEvent(new window.Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(controller.getCurrentPageIndex(), 1);
  assert.equal(window.document.getElementById('pdfZoomValue').textContent, '76%');
});
