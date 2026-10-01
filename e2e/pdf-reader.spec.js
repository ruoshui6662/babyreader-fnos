'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { waitForBookmarkRequest, waitForProgressSave } = require('./helpers/reader');

const APP_PATH = '/app/babyreader-fnos/';

test('PDF AI panel searches the whole searchable paper by default and keeps trusted citation navigation', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 850 });
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ configured: true, model: 'mock-model' }) }));
  let submitted;
  await page.route('**/ai/ask/stream', async (route) => {
    submitted = route.request().postDataJSON();
    const source = { citationIndex: 1, citationIndexes: [1], pageIndex: 1,
      chapterIndex: 1, chapterLabel: '第2页', startOffset: 0 };
    const frames = [
      `event: meta\ndata: ${JSON.stringify({ sources: [source], scope: 'page_range', model: 'mock-model' })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ delta: '依据在第二页【1】' })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ answer: '依据在第二页【1】', sources: [source], scope: 'page_range' })}\n\n`
    ].join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#btnAi')).toBeVisible();
  await page.locator('#btnAi').click();
  await expect(page.locator('#aiPdfScope')).toHaveCount(0);
  await expect(page.locator('#aiPdfPrivacy')).toBeVisible();
  const inputLayout = await page.evaluate(() => {
    const input = document.getElementById('aiQuestion').getBoundingClientRect();
    const send = document.getElementById('btnAiAsk').getBoundingClientRect();
    return { inputBottom: input.bottom, inputRight: input.right, sendBottom: send.bottom, sendRight: send.right };
  });
  expect(inputLayout.sendBottom).toBeLessThanOrEqual(inputLayout.inputBottom - 6);
  expect(inputLayout.sendBottom).toBeGreaterThan(inputLayout.inputBottom - 22);
  expect(inputLayout.sendRight).toBeLessThanOrEqual(inputLayout.inputRight - 6);
  await page.locator('#aiQuestion').fill('第二页说了什么？');
  await page.locator('#btnAiAsk').click();
  await expect(page.locator('.ai-source').last()).toContainText('第2页');
  expect(submitted).toMatchObject({ scope: 'searchable_book' });
  expect(submitted.context).toBeUndefined();
  await page.locator('.ai-source').last().click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '1');
  await expect(page.locator('#aiModal')).toBeVisible();
});

test('PDF single-page text selection opens the AI panel in selection scope', async ({ page }) => {
  let submitted;
  await page.route('**/api/ai/status', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ configured: true, model: 'mock-model' }) }));
  await page.route('**/ai/ask/stream', async (route) => {
    submitted = route.request().postDataJSON();
    const frames = [
      `event: meta\ndata: ${JSON.stringify({ sources: [], scope: 'selection', model: 'mock-model' })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ delta: '选文回答' })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ answer: '选文回答', sources: [], scope: 'selection' })}\n\n`
    ].join('');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  const target = await firstPage.evaluate((wrapper) => {
    const span = [...wrapper.querySelectorAll('.pdf-page-text-layer span')]
      .find((item) => item.textContent.includes('第一页'));
    const rect = span.getBoundingClientRect();
    return { start: { x: rect.left + 1, y: rect.top + rect.height / 2 },
      end: { x: rect.right - 1, y: rect.top + rect.height / 2 } };
  });
  await page.mouse.move(target.start.x, target.start.y);
  await page.mouse.down();
  await page.mouse.move(target.end.x, target.end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#selectionMenu [data-selection-action="ai"]')).toBeVisible();
  await page.locator('#selectionMenu [data-selection-action="ai"]').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await expect(page.locator('#aiPdfScope')).toHaveCount(0);
  await expect(page.locator('#aiSelectedText')).toContainText('第一页');
  const verified = await page.evaluate(async () => {
    const selectedText = document.getElementById('aiSelectedText').textContent;
    const bookId = window.pdfReaderController.getCurrentBookId();
    return window.browserHost.searchAiBook(bookId, {
      question: '这段讲了什么？', scope: 'selection', pageIndex: 0, selectedText
    });
  });
  expect(verified.sources[0].pageIndex).toBe(0);
  expect(verified.matches[0].text).toContain('第一页');
  await page.locator('#aiQuestion').fill('这段讲了什么？');
  await page.locator('#btnAiAsk').click();
  await expect.poll(() => submitted?.scope).toBe('selection');
  expect(submitted.selectedText).toContain('第一页');
});

test('restored PDF AI citation marked stale cannot navigate to a changed page', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.locator('#btnAi').click();
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await page.evaluate(() => {
    document.getElementById('aiInitialAnswerCard').hidden = false;
    window.__babyReaderAiApi.renderAiSources([
      { citationIndex: 1, chapterIndex: 0, chapterLabel: '第1页', stale: true }
    ], document.getElementById('aiSources'), '旧回答【1】');
  });
  const source = page.locator('#aiSources .ai-source');
  await expect(source).toHaveAttribute('aria-disabled', 'true');
  await expect(source).toContainText('来源已变化');
  await source.click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
});

test('PDF notes export downloads the current server records with page labels', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  const bookId = await page.evaluate(() => window.pdfReaderController.getCurrentBookId());
  const annotationId = '00000000-0000-4000-8000-000000000061';
  await page.evaluate(async ({ id, bookId }) => {
    await window.browserHost.createPdfAnnotation({
      version: 1, type: 'pdf', id, kind: 'highlight', style: 'marker', color: 'blue',
      text: '导出测试引文', thought: '导出测试想法',
      targets: [{ pageIndex: 1, quads: [[0.1, 0.2, 0.2, 0.2, 0.2, 0.23, 0.1, 0.23]] }]
    }, bookId);
  }, { id: annotationId, bookId });
  try {
    await expect(page.locator('#btnExportHighlights')).toBeVisible();
    const freshRead = page.waitForResponse((response) => response.request().method() === 'GET'
      && response.url().includes(`/api/books/${bookId}/pdf-annotations`));
    const downloadReady = page.waitForEvent('download');
    await page.locator('#btnExportHighlights').click();
    expect((await freshRead).ok()).toBeTruthy();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe('e2e-reader.md');
    const markdown = await fs.readFile(await download.path(), 'utf8');
    expect(markdown).toContain('## 第 2 页');
    expect(markdown).toContain('导出测试引文');
    expect(markdown).toContain('导出测试想法');
    expect(markdown).not.toContain('quads');
  } finally {
    await page.evaluate(({ id, bookId }) => window.browserHost.deletePdfAnnotation(id, bookId),
      { id: annotationId, bookId });
  }
});

test('Task 7 baseline records PDF readiness, rendering, anchor and viewport geometry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(APP_PATH);
  const startedAt = Date.now();
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  let maximumActiveRenders = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const active = await page.evaluate(() => window.pdfReaderController?.getDebugState?.().activeRenderCount || 0);
    maximumActiveRenders = Math.max(maximumActiveRenders, active);
    if (await page.locator('.pdf-page[data-page-index="0"][data-text-layer-state="ready"]').count()) break;
    await page.waitForTimeout(10);
  }
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  const firstReadyMs = Date.now() - startedAt;
  const beforeAnchor = await page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const target = document.querySelector('.pdf-page[data-page-index="0"]');
    return target.getBoundingClientRect().top - host.getBoundingClientRect().top;
  });
  await page.evaluate(() => window.pdfReaderController.setPdfScale(1.25));
  await expect.poll(() => page.evaluate(() => window.pdfReaderController.getDebugState().activeRenderCount)).toBe(0);
  const afterAnchor = await page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const target = document.querySelector('.pdf-page[data-page-index="0"]');
    return target.getBoundingClientRect().top - host.getBoundingClientRect().top;
  });
  const viewportGeometry = [];
  for (const [width, height] of [[320, 568], [375, 812], [800, 1000], [1100, 900], [1600, 900]]) {
    await page.setViewportSize({ width, height });
    viewportGeometry.push(await page.evaluate(({ width, height }) => {
      const controls = document.querySelector('.pdf-reader-controls').getBoundingClientRect();
      const title = document.getElementById('fileName').getBoundingClientRect();
      return {
        width,
        height,
        controls: { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom },
        title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom },
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
      };
    }, { width, height }));
  }
  const debugState = await page.evaluate(() => window.pdfReaderController.getDebugState());
  const baseline = {
    firstReadyMs,
    maximumActiveRenders,
    anchorDelta: afterAnchor - beforeAnchor,
    renderedPages: debugState.renderedPages,
    viewportGeometry
  };
  console.log(`TASK7_BASELINE ${JSON.stringify(baseline)}`);
  await testInfo.attach('task7-baseline.json', {
    body: Buffer.from(JSON.stringify(baseline, null, 2)),
    contentType: 'application/json'
  });
  expect(Number.isFinite(firstReadyMs)).toBeTruthy();
  expect(Number.isFinite(baseline.anchorDelta)).toBeTruthy();
  expect(viewportGeometry).toHaveLength(5);
});

test('PDF reader controls stay hidden on the library until a PDF is opened', async ({ page }) => {
  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await expect(page.locator('#pdfReaderSurface')).toBeHidden();

  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await expect(page.locator('#pdfReaderSurface')).toBeHidden();
});

test('PDF library card renders the first page as its cover', async ({ page }) => {
  await page.goto(APP_PATH);
  const card = page.locator('.library-book').filter({ hasText: 'e2e-reader' });
  await expect(card).toBeVisible();
  const cover = card.locator('img.library-book-cover');
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(cover).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  const dimensions = await cover.evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  expect(dimensions.width).toBeLessThanOrEqual(384);
  expect(dimensions.height).toBeLessThanOrEqual(384);
  const inkPixels = await cover.evaluate((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 220 && pixels[index + 1] < 220 && pixels[index + 2] < 220) ink += 1;
    }
    return ink;
  });
  expect(inkPixels).toBeGreaterThan(20);
  await card.click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await page.locator('#btnBackToLibrary').click();
  const returnedCover = page.locator('.library-book').filter({ hasText: 'e2e-reader' }).locator('img.library-book-cover');
  await expect(returnedCover).toBeVisible();
  await expect.poll(() => returnedCover.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
});

test('A broken PDF keeps its placeholder without blocking other PDF covers', async ({ page }) => {
  await page.goto(APP_PATH);
  const broken = page.locator('.library-book').filter({ hasText: 'e2e-corrupt' });
  await expect(broken).toBeVisible();
  await expect(page.locator('.library-book').filter({ hasText: 'e2e-reader' }).locator('img.library-book-cover'))
    .toBeVisible();
  await expect(broken.locator('span.library-book-cover')).toBeVisible();
  await expect(broken.locator('img.library-book-cover')).toHaveCount(0);
});

test('PDF page announcement is readable by assistive technology but not painted in the page', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.locator('#pdfZoomIn').click();
  const announcement = page.locator('#pdfReaderAnnouncement');
  await expect(announcement).toContainText('页');
  await expect(announcement).toHaveAttribute('aria-live', 'polite');
  const visibility = await announcement.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    position: getComputedStyle(element).position,
    clipPath: getComputedStyle(element).clipPath
  }));
  expect(visibility.width).toBeLessThanOrEqual(1);
  expect(visibility.height).toBeLessThanOrEqual(1);
  expect(visibility.position).toBe('absolute');
  expect(visibility.clipPath).toBe('inset(50%)');
});

test('PDF page bookmarks persist, restore the exact page, and can be deleted', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(APP_PATH);
  const book = page.locator('.library-book').filter({ hasText: 'e2e-reader' });
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }

  // The E2E server keeps the fixture's progress between browser contexts.
  // Start from a known page so the following navigation always triggers a save.
  const initialPage = Number(await page.locator('#pdfReaderSurface').getAttribute('data-current-page'));
  if (initialPage !== 0) {
    const resetProgress = waitForProgressSave(page);
    await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
    await resetProgress;
  }

  const progressSave = waitForProgressSave(page);
  await page.locator('#pdfPageNumber').fill('3');
  await page.locator('#pdfPageNumber').press('Enter');
  await progressSave;
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('#btnBookmarks')).toBeEnabled();
  const create = waitForBookmarkRequest(page, 'POST');
  await page.locator('#btnBookmarks').click();
  await create;
  await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');

  const moveAway = waitForProgressSave(page);
  await page.locator('#pdfPageNumber').fill('4');
  await page.locator('#pdfPageNumber').press('Enter');
  await moveAway;
  await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'false');
  const returnToBookmark = waitForProgressSave(page);
  await page.locator('#pdfPageNumber').fill('3');
  await page.locator('#pdfPageNumber').press('Enter');
  await returnToBookmark;
  await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  const listRequest = waitForBookmarkRequest(page, 'GET');
  await page.evaluate(() => openReaderPanel('bookmarks', document.getElementById('btnBookmarks')));
  await listRequest;
  await expect(page.locator('.bookmark-row-title')).toHaveText('第 3 页');
  await expect(page.locator('.bookmark-row-meta')).toHaveText('PDF · 第 3 页');

  await page.locator('.bookmark-row-main').click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('#readerDrawer')).toBeHidden();
  await page.evaluate(() => openReaderPanel('bookmarks', document.getElementById('btnBookmarks')));
  await expect(page.locator('.bookmark-row')).toHaveCount(1);
  const remove = waitForBookmarkRequest(page, 'DELETE');
  await page.locator('.bookmark-row-delete').click();
  await remove;
  await expect(page.locator('.bookmark-row')).toHaveCount(0);
  await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'false');

  const finalResetProgress = waitForProgressSave(page);
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await finalResetProgress;
});

test('authorized PDF opens locally, navigates pages and zooms without leaving the reader', async ({ page }) => {
  const externalRequests = [];
  const pageErrors = [];
  const pdfResponses = [];
  const vendorResponses = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:8099') externalRequests.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/books/') && response.url().endsWith('/content')) {
      pdfResponses.push({ status: response.status(), type: response.headers()['content-type'] });
    }
    if (response.url().includes('/vendor/pdfjs/') && response.url().endsWith('.mjs')) {
      vendorResponses.push({ url: new URL(response.url()).pathname, status: response.status(), type: response.headers()['content-type'] });
    }
  });

  await page.goto(APP_PATH);
  const book = page.locator('.library-book').filter({ hasText: 'e2e-reader' });
  await expect(book).toBeVisible();
  await book.click();

  await expect(page.locator('body')).toHaveClass(/is-pdf-reader/);
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await expect(page.locator('#article')).toBeHidden();

  await page.locator('#pdfPageNumber').fill('3');
  await page.locator('#pdfPageNumber').press('Enter');
  await expect(page.locator('#pdfPageNumber')).toHaveValue('3');
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await page.locator('#pdfPageNumber').fill('999');
  await page.locator('#pdfPageNumber').press('Enter');
  await expect(page.locator('#pdfPageNumber')).toHaveValue('3');

  const beforeScale = await page.locator('#pdfPages canvas').last().getAttribute('width');
  await page.locator('#pdfZoomIn').click();
  await expect.poll(async () => page.locator('#pdfPages canvas').last().getAttribute('width'))
    .not.toBe(beforeScale);

  expect(externalRequests).toEqual([]);
  expect(
    pdfResponses.some((response) => response.status === 206 && response.type.startsWith('application/pdf')),
    JSON.stringify(pdfResponses)
  ).toBeTruthy();
  expect(vendorResponses.some((response) => response.url.endsWith('/build/pdf.mjs')
    && response.status === 200 && response.type.startsWith('text/javascript'))).toBeTruthy();
  expect(vendorResponses.some((response) => response.url.endsWith('/build/pdf.worker.mjs')
    && response.status === 200 && response.type.startsWith('text/javascript'))).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test('PDF text selection keeps canvas glyph appearance and survives page virtualization', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfReaderStatus')).toBeHidden();
  await expect(page.locator('#pdfPageCount')).toHaveText('/ 4');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  await expect(firstPage.locator('.pdf-page-text-layer span').first()).toBeAttached();

  const selected = await page.evaluate(() => {
    const textLayer = document.querySelector('.pdf-page[data-page-index="0"] .pdf-page-text-layer');
    const span = textLayer.querySelector('span');
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const selectedBackground = getComputedStyle(span, '::selection').backgroundColor;
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const probeContext = probe.getContext('2d');
    probeContext.fillStyle = selectedBackground;
    probeContext.fillRect(0, 0, 1, 1);
    return {
      text: selection.toString(),
      color: getComputedStyle(span, '::selection').color,
      backgroundOpacity: probeContext.getImageData(0, 0, 1, 1).data[3] / 255,
      blendMode: getComputedStyle(textLayer).mixBlendMode
    };
  });
  expect(selected.text).toContain('第一页');
  expect(selected.color).toMatch(/rgba\([^)]*,\s*0\)/);
  // Opaque tint multiplied onto the canvas: overlapping PDF.js spans cannot
  // stack into darker blocks, and canvas glyphs still show through.
  expect(selected.backgroundOpacity).toBe(1);
  expect(selected.blendMode).toBe('multiply');

  await page.locator('#pdfPages').evaluate((host) => {
    host.scrollTop = host.scrollHeight;
    host.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.evaluate(() => window.getSelection().toString()))
    .toBe(selected.text);
  await expect(firstPage.locator('.pdf-page-text-layer span').first()).toBeAttached();

  await page.evaluate(() => window.getSelection().removeAllRanges());
  await expect.poll(() => firstPage.locator('.pdf-page-text-layer').evaluate((layer) => layer.childElementCount))
    .toBe(0);
});

test('real pointer text selection survives scroll and can be repeated after zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  const textSpan = firstPage.locator('.pdf-page-text-layer span').first();
  const target = await textSpan.evaluate((span) => {
    const text = span.firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(5, text.length));
    const start = range.getBoundingClientRect();
    range.setStart(text, Math.max(0, text.length - 5));
    range.setEnd(text, text.length);
    const end = range.getBoundingClientRect();
    return { start: { x: start.left + 1, y: start.top + start.height / 2 }, end: { x: end.right - 1, y: end.top + end.height / 2 } };
  });

  await page.mouse.move(target.start.x, target.start.y);
  await page.mouse.down();
  await page.mouse.move(target.end.x, target.end.y, { steps: 12 });
  await page.mouse.up();
  const selectedText = await page.evaluate(() => window.getSelection().toString());
  expect(selectedText.length).toBeGreaterThan(3);

  await page.locator('#pdfPages').evaluate((host) => {
    host.scrollTop = host.scrollHeight;
    host.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe(selectedText);

  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await page.locator('#pdfZoomIn').click();
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  const zoomedTarget = await textSpan.evaluate((span) => {
    const text = span.firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(5, text.length));
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(zoomedTarget.x, zoomedTarget.y);
  await page.mouse.down();
  await page.mouse.move(zoomedTarget.x + 40, zoomedTarget.y, { steps: 8 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.getSelection().toString())).length).toBeGreaterThan(1);
});

test('PDF annotation overlay preserves a real multi-line selection and follows zoom without changing canvas glyphs', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(APP_PATH);
  const initialAnnotations = page.waitForResponse((response) =>
    response.request().method() === 'GET' && response.url().includes('/pdf-annotations'));
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  expect((await initialAnnotations).ok()).toBeTruthy();
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  const target = await firstPage.evaluate((wrapper) => {
    const spans = [...wrapper.querySelectorAll('.pdf-page-text-layer span')];
    const first = spans.find((span) => span.textContent.includes('第一页'));
    const second = spans.find((span) => span.textContent.includes('第二行'));
    if (!first || !second) throw new Error('synthetic PDF fixture must expose two selectable visual lines');
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    return {
      start: { x: firstRect.left + 1, y: firstRect.top + firstRect.height / 2 },
      end: { x: secondRect.right - 1, y: secondRect.top + secondRect.height / 2 }
    };
  });
  await page.mouse.move(target.start.x, target.start.y);
  await page.mouse.down();
  await page.mouse.move(target.end.x, target.end.y, { steps: 12 });
  await page.mouse.up();
  const canvasBefore = await firstPage.locator('.pdf-page-canvas').evaluate((canvas) => canvas.toDataURL());
  const captured = await page.evaluate(() => {
    const result = window.pdfAnnotationGeometry.capturePdfAnnotationSelection(
      window.getSelection(), (pageIndex) => window.pdfReaderController.getRenderedPageGeometry(pageIndex)
    );
    if (!result) throw new Error('real pointer selection should become a bounded PDF annotation target');
    const accepted = window.pdfAnnotationRenderer.setAnnotations({
      bookId: result.bookId,
      generation: result.generation,
      sourceFingerprint: 'f'.repeat(64),
      annotations: [{
        id: 'e2e-pdf-annotation', sourceFingerprint: 'f'.repeat(64), style: 'marker', color: 'yellow',
        sourceStale: false, targets: result.targets
      }]
    });
    if (!accepted) throw new Error('test annotation session was rejected');
    const pageGeometry = window.pdfReaderController.getRenderedPageGeometry(0);
    if (!window.renderPdfAnnotationPage({
      bookId: result.bookId, generation: result.generation, pageIndex: 0, scale: pageGeometry.scale
    })) throw new Error('test annotation page frame was rejected');
    const selectionText = result.text;
    const quadCount = result.targets[0]?.quads.length || 0;
    const geometry = window.pdfReaderController.getRenderedPageGeometry(0);
    const projected = window.pdfAnnotationGeometry.projectPdfAnnotationTarget(result.targets[0], geometry);
    const quad = projected[0];
    const pixel = [
      Math.floor((quad[0][0] + quad[2][0]) / 2),
      Math.floor((quad[0][1] + quad[2][1]) / 2)
    ];
    window.getSelection().removeAllRanges();
    return { selectionText, quadCount, pixel, targets: result.targets };
  });
  expect(captured.selectionText).toContain('第一页');
  expect(captured.selectionText).toContain('第二行');
  expect(captured.quadCount).toBeGreaterThanOrEqual(2);
  const overlay = firstPage.locator('.pdf-annotation-layer');
  await expect(overlay).toBeAttached();
  await expect.poll(() => overlay.evaluate((canvas, pixel) => {
    const context = canvas.getContext('2d');
    return context.getImageData(pixel[0], pixel[1], 1, 1).data[3];
  }, captured.pixel)).toBeGreaterThan(0);
  expect(await firstPage.locator('.pdf-page-canvas').evaluate((canvas) => canvas.toDataURL())).toBe(canvasBefore);

  await page.mouse.move(target.start.x, target.start.y);
  await page.mouse.down();
  await page.mouse.move(target.end.x, target.end.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toContain('第二行');
  await page.evaluate(() => window.getSelection().removeAllRanges());

  await page.locator('#pdfZoomIn').click();
  await expect.poll(() => firstPage.locator('.pdf-annotation-layer').evaluate((canvas) => canvas.width))
    .toBeGreaterThan(0);
  const zoomPixel = await page.evaluate((targetRecord) => {
    const geometry = window.pdfReaderController.getRenderedPageGeometry(0);
    const projected = window.pdfAnnotationGeometry.projectPdfAnnotationTarget(targetRecord, geometry);
    return [Math.floor((projected[0][0][0] + projected[0][2][0]) / 2),
      Math.floor((projected[0][0][1] + projected[0][2][1]) / 2)];
  }, captured.targets[0]);
  await expect.poll(() => overlay.evaluate((canvas, pixel) =>
    canvas.getContext('2d').getImageData(pixel[0], pixel[1], 1, 1).data[3], zoomPixel
  )).toBeGreaterThan(0);
  await page.locator('#pdfPages').evaluate((host) => {
    host.scrollTop = host.scrollHeight;
    host.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => firstPage.locator('.pdf-annotation-layer').count()).toBe(0);
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await expect(firstPage.locator('.pdf-annotation-layer')).toBeAttached();
  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.pdf-annotation-layer')).toHaveCount(0);
  expect(await page.locator('body').evaluate((body) => body.classList.contains('is-epub'))).toBe(false);
});

test('PDF selection menu creates a persistent annotation that can be located, edited, and deleted', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');

  const target = await firstPage.evaluate((wrapper) => {
    const span = [...wrapper.querySelectorAll('.pdf-page-text-layer span')]
      .find((item) => item.textContent.includes('第一页'));
    if (!span) throw new Error('annotation fixture must expose selectable first-page text');
    const rect = span.getBoundingClientRect();
    return {
      start: { x: rect.left + 1, y: rect.top + rect.height / 2 },
      end: { x: rect.right - 1, y: rect.top + rect.height / 2 }
    };
  });
  await page.mouse.move(target.start.x, target.start.y);
  await page.mouse.down();
  await page.mouse.move(target.end.x, target.end.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.locator('#selectionMenu').isVisible()).toBeTruthy();
  await expect(page.locator('#selectionMenu [data-selection-action="ai"]')).toBeVisible();

  const createRequest = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/pdf-annotations'));
  await page.locator('#selectionMenu [data-selection-action="marker"]').click();
  const createResponse = await createRequest;
  expect(createResponse.ok()).toBeTruthy();
  await expect(firstPage.locator('.pdf-annotation-layer')).toBeAttached();
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('.pdf-page[data-page-index="0"] .pdf-annotation-layer')).toBeAttached();
  const initialScale = await page.evaluate(() => window.pdfReaderController.getRenderedPageGeometry(0).scale);
  await page.locator('#pdfZoomIn').click();
  await expect.poll(() => page.evaluate(() => window.pdfReaderController.getRenderedPageGeometry(0)?.scale || 0))
    .toBeGreaterThan(initialScale);
  await page.locator('#btnNotes').click();
  const note = page.locator('#notesList [data-annotation-id]').first();
  await expect(note).toContainText('第 1 页');
  await expect(note.locator('.notes-item-quote')).toContainText('第一页');

  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await page.locator('#notesList [data-annotation-id]').first().click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '0');
  const locatedText = page.locator('.pdf-page[data-page-index="0"] .pdf-note-navigation-highlight').first();
  await expect(locatedText).toBeVisible();
  await expect.poll(() => locatedText.evaluate((target) => {
    const host = document.getElementById('pdfPages').getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    return rect.top >= host.top && rect.bottom <= host.bottom && rect.left >= host.left && rect.right <= host.right;
  })).toBeTruthy();

  await page.locator('#notesList [data-notes-action="edit"]').click();
  await expect(page.locator('#highlightEditor')).toBeVisible();
  await page.locator('#highlightEditorColor').selectOption('green');
  await page.locator('#highlightEditorStyle').selectOption('wave');
  await page.locator('#highlightEditorThought').fill('Task 4 持久化想法');
  const updateRequest = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' && response.url().includes('/pdf-annotations/'));
  await page.locator('#btnSaveHighlight').click();
  const updateResponse = await updateRequest;
  expect(updateResponse.ok()).toBeTruthy();
  await expect(page.locator('#highlightEditor')).toBeHidden();
  await expect(page.locator('#notesList .notes-item-thought')).toContainText('Task 4 持久化想法');
  await expect(page.locator('#notesList .notes-item-style')).toHaveText('波浪线');

  await page.locator('#btnCloseSettings').click();
  await page.locator('#btnBackToLibrary').click();
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  await expect(page.locator('.pdf-page[data-page-index="0"] .pdf-annotation-layer')).toBeAttached();
  await page.locator('#btnNotes').click();
  await expect(page.locator('#notesList .notes-item-thought')).toContainText('Task 4 持久化想法');

  await page.locator('#notesList [data-notes-action="edit"]').click();
  await page.locator('#highlightEditorThought').fill('');
  const removeThoughtRequest = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' && response.url().includes('/pdf-annotations/'));
  await page.locator('#btnSaveHighlight').click();
  expect((await removeThoughtRequest).ok()).toBeTruthy();
  await expect(page.locator('#notesList .notes-item-thought')).toHaveCount(0);

  const deleteRequest = page.waitForResponse((response) =>
    response.request().method() === 'DELETE' && response.url().includes('/pdf-annotations/'));
  await page.locator('#notesList [data-notes-action="delete"]').click();
  const deleteResponse = await deleteRequest;
  expect(deleteResponse.ok()).toBeTruthy();
  await expect(page.locator('#notesList [data-annotation-id]')).toHaveCount(0);
});

test('PDF mark styles save on HTTP LAN where crypto.randomUUID is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(APP_PATH);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  expect(await page.evaluate(() => typeof crypto.getRandomValues)).toBe('function');
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');

  const target = await firstPage.evaluate((wrapper) => {
    const span = [...wrapper.querySelectorAll('.pdf-page-text-layer span')]
      .find((item) => item.textContent.includes('第一页'));
    if (!span) throw new Error('annotation fixture must expose selectable first-page text');
    const rect = span.getBoundingClientRect();
    return {
      start: { x: rect.left + 1, y: rect.top + rect.height / 2 },
      end: { x: rect.right - 1, y: rect.top + rect.height / 2 }
    };
  });
  for (const style of ['marker', 'wave', 'line']) {
    await page.mouse.move(target.start.x, target.start.y);
    await page.mouse.down();
    await page.mouse.move(target.end.x, target.end.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#selectionMenu')).toBeVisible();

    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/pdf-annotations'),
    { timeout: 4000 });
    await page.locator(`#selectionMenu [data-selection-action="${style}"]`).click();
    const response = await created;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON().style).toBe(style);
    expect(response.request().postDataJSON().id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expect(firstPage.locator('.pdf-annotation-layer')).toBeAttached();
  }
});

test('PDF color preference saves and colors new marks without EPUB reflow', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  await page.locator('#btnSettings').click();
  await expect(page.locator('[data-settings-group="highlight"]')).toBeVisible();
  const trigger = page.locator('[data-custom-select-for="settingHighlightColor"] .custom-select-trigger');
  await trigger.click();
  const menu = page.locator('#custom-options-settingHighlightColor');
  await expect(menu.locator('[role="option"]')).toHaveCount(4);

  await page.evaluate(() => {
    window.__pdfColorApplyZoomCalls = 0;
    const original = window.applyZoom;
    window.applyZoom = (...args) => {
      window.__pdfColorApplyZoomCalls += 1;
      return original(...args);
    };
  });
  const settingsSaved = page.waitForResponse((response) =>
    response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
  await menu.locator('[role="option"][data-value="green"]').click();
  expect((await settingsSaved).ok()).toBeTruthy();
  await expect(page.locator('#settingHighlightColor')).toHaveValue('green');
  expect(await page.evaluate(() => window.__pdfColorApplyZoomCalls)).toBe(0);
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '0');
  await expect.poll(async () => page.evaluate(async () =>
    (await window.browserHost.getUserState()).settings.highlightColor)).toBe('green');
  await page.locator('#btnCloseSettings').click();

  const target = await firstPage.evaluate((wrapper) => {
    const span = [...wrapper.querySelectorAll('.pdf-page-text-layer span')]
      .find((item) => item.textContent.includes('第一页'));
    if (!span) throw new Error('annotation fixture must expose selectable first-page text');
    const rect = span.getBoundingClientRect();
    return {
      start: { x: rect.left + 1, y: rect.top + rect.height / 2 },
      end: { x: rect.right - 1, y: rect.top + rect.height / 2 }
    };
  });
  for (const style of ['marker', 'wave', 'line']) {
    await page.mouse.move(target.start.x, target.start.y);
    await page.mouse.down();
    await page.mouse.move(target.end.x, target.end.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#selectionMenu')).toBeVisible();
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/pdf-annotations'));
    await page.locator(`#selectionMenu [data-selection-action="${style}"]`).click();
    const response = await created;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ color: 'green', style });
    await expect(firstPage.locator('.pdf-annotation-layer')).toBeAttached();
  }
});

test('real mouse selection on the right page keeps a repeated two-column quote on that page', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-columns' }).click();
  await page.evaluate(() => window.pdfReaderController.setLayoutMode('double'));
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  const rightPage = page.locator('.pdf-page[data-page-index="2"]');
  await expect(rightPage).toHaveAttribute('data-text-layer-state', 'ready');
  await rightPage.scrollIntoViewIfNeeded();
  const position = await rightPage.evaluate((wrapper) => {
    const span = [...wrapper.querySelectorAll('.pdf-page-text-layer span')]
      .find((item) => item.textContent.includes('右栏重复词'));
    if (!span) throw new Error('right-column fixture text was not rendered');
    const rectangle = span.getBoundingClientRect();
    return {
      start: { x: rectangle.left + 2, y: rectangle.top + rectangle.height / 2 },
      end: { x: rectangle.right - 2, y: rectangle.top + rectangle.height / 2 }
    };
  });
  await page.mouse.move(position.start.x, position.start.y);
  await page.mouse.down();
  await page.mouse.move(position.end.x, position.end.y, { steps: 10 });
  await page.mouse.up();
  const capture = await page.evaluate(() => window.pdfAnnotationGeometry.capturePdfAnnotationSelection(
    window.getSelection(), (index) => window.pdfReaderController.getRenderedPageGeometry(index)
  ));
  expect(capture?.text).toContain('右栏重复词');
  expect(capture.text).not.toContain('左栏独有结论');
  expect(capture.targets.map((target) => target.pageIndex)).toEqual([2]);
  expect(capture.targets[0].quads.every((quad) => Math.min(quad[0], quad[2], quad[4], quad[6]) > 0.45)).toBe(true);
});

test('image-only PDF keeps annotation creation unavailable without selectable text', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-image-only' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('1 页');
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  const imagePixel = await page.evaluate(() => {
    const geometry = window.pdfReaderController.getRenderedPageGeometry(0);
    const canvas = geometry.pageElement.querySelector('.pdf-page-canvas');
    const [x, y] = geometry.viewport.convertToViewportPoint(100, 650);
    return Array.from(canvas.getContext('2d').getImageData(
      Math.floor(x * canvas.width / geometry.viewport.width),
      Math.floor(y * canvas.height / geometry.viewport.height), 1, 1
    ).data);
  });
  expect(imagePixel[0]).toBeGreaterThan(200);
  expect(imagePixel[1]).toBeLessThan(100);
  expect(imagePixel[2]).toBeLessThan(100);
  await expect(page.locator('.pdf-page[data-page-index="0"] .pdf-page-text-layer span')).toHaveCount(0);
  expect(await page.evaluate(() => window.pdfAnnotationGeometry.capturePdfAnnotationSelection(
    window.getSelection(), (index) => window.pdfReaderController.getRenderedPageGeometry(index)
  ))).toBeNull();
  await expect(page.locator('#selectionMenu')).toBeHidden();
  await expect(page.locator('.pdf-annotation-layer')).toHaveCount(0);
});

test('a stale-source PDF annotation remains visible in the list but cannot paint or navigate', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  const annotationId = '00000000-0000-4000-8000-000000000701';
  await page.evaluate(async (id) => {
    await window.browserHost.createPdfAnnotation({
      version: 1, type: 'pdf', id, kind: 'highlight', style: 'marker', color: 'yellow',
      text: '来源变化前的引文', contextBefore: '', contextAfter: '', thought: '',
      targets: [{ pageIndex: 0, quads: [[0.1, 0.1, 0.3, 0.1, 0.3, 0.12, 0.1, 0.12]] }]
    });
  }, annotationId);
  await page.locator('#btnBackToLibrary').click();
  await page.route('**/api/books/*/pdf-annotations', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: {
      ...payload,
      annotations: payload.annotations.map((annotation) => ({ ...annotation, sourceStale: true }))
    } });
  });
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  await expect(page.locator('.pdf-annotation-layer')).toHaveCount(0);
  await page.locator('#btnNotes').click();
  const row = page.locator(`#notesList [data-annotation-id="${annotationId}"]`);
  await expect(row).toContainText('原文已变化');
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row.locator('[data-notes-action="edit"]')).toHaveCount(0);
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '0');
  await expect(page.locator('.pdf-annotation-layer')).toHaveCount(0);
});

test('PDF selectable text uses the same viewport-scaled font geometry as the canvas', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));

  const textGeometry = () => page.locator('.pdf-page[data-page-index="0"] .pdf-page-text-layer span').first()
    .evaluate((span) => {
      const layer = span.closest('.pdf-page-text-layer');
      return {
        actual: Number.parseFloat(getComputedStyle(span).fontSize),
        expected: Number.parseFloat(getComputedStyle(span).getPropertyValue('--font-height'))
          * Number.parseFloat(getComputedStyle(layer).getPropertyValue('--total-scale-factor'))
      };
    });

  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  let geometry = await textGeometry();
  expect(geometry.actual / geometry.expected).toBeGreaterThan(0.95);
  expect(geometry.actual / geometry.expected).toBeLessThan(1.05);

  await page.locator('#pdfZoomIn').click();
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  await expect.poll(async () => (await textGeometry()).expected).toBeGreaterThan(geometry.expected);
  geometry = await textGeometry();
  expect(geometry.actual / geometry.expected).toBeGreaterThan(0.95);
  expect(geometry.actual / geometry.expected).toBeLessThan(1.05);
});

test('rapid PDF zoom changes commit canvas and text layer at the same final viewport', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  await page.evaluate(() => {
    window.pdfReaderController.setPdfScale(1.4);
    window.pdfReaderController.setPdfScale(0.8);
    window.pdfReaderController.setPdfScale(1.2);
  });
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect.poll(() => page.evaluate(() => window.pdfReaderController.getRenderedPageGeometry(0)?.scale || 0))
    .toBeCloseTo(1.2, 2);
  const frame = await firstPage.evaluate((wrapper) => ({
    page: wrapper.getBoundingClientRect().width,
    canvas: wrapper.querySelector('canvas').getBoundingClientRect().width,
    text: wrapper.querySelector('.pdf-page-text-layer').getBoundingClientRect().width
  }));
  expect(Math.abs(frame.canvas - frame.page)).toBeLessThan(1);
  expect(Math.abs(frame.text - frame.page)).toBeLessThan(1);
});

test('PDF fit-width zoom follows a resized reading viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();

  await page.locator('#pdfFitWidth').click();
  const wideScale = Number((await page.locator('#pdfZoomValue').textContent()).replace('%', ''));
  await page.setViewportSize({ width: 600, height: 800 });

  await expect.poll(async () => Number((await page.locator('#pdfZoomValue').textContent()).replace('%', '')))
    .toBeLessThan(wideScale);
});

test('PDF automatic opening scale adapts when the reader narrows', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await expect(page.locator('#pdfZoomValue')).toHaveText('100%');
  await page.setViewportSize({ width: 390, height: 800 });

  await expect.poll(async () => Number((await page.locator('#pdfZoomValue').textContent()).replace('%', '')))
    .toBeLessThan(100);
  const width = await page.locator('#pdfPages').evaluate((host) => ({ client: host.clientWidth, scroll: host.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});

test('PDF fit-width uses the actual padded page viewport without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await page.locator('#pdfFitWidth').click();

  const bounds = await page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const wrapper = document.querySelector('.pdf-page[data-page-index="0"]');
    return {
      hostWidth: host.clientWidth,
      scrollWidth: host.scrollWidth,
      pageLeft: wrapper.getBoundingClientRect().left,
      pageRight: wrapper.getBoundingClientRect().right,
      hostLeft: host.getBoundingClientRect().left,
      hostRight: host.getBoundingClientRect().right
    };
  });
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.hostWidth + 1);
  expect(bounds.pageLeft).toBeGreaterThanOrEqual(bounds.hostLeft);
  expect(bounds.pageRight).toBeLessThanOrEqual(bounds.hostRight);
});

test('PDF enlarged page remains fully reachable by horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await page.evaluate(() => window.pdfReaderController.setPdfScale(2));

  await expect.poll(async () => page.locator('.pdf-page[data-page-index="0"] canvas').evaluate((canvas) => canvas.getBoundingClientRect().width))
    .toBeGreaterThan(1000);
  const size = await page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const wrapper = document.querySelector('.pdf-page[data-page-index="0"]');
    const canvas = wrapper.querySelector('canvas');
    return {
      wrapperWidth: wrapper.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width,
      viewportWidth: host.clientWidth,
      scrollWidth: host.scrollWidth
    };
  });
  expect(size.wrapperWidth).toBeGreaterThanOrEqual(size.canvasWidth - 1);
  expect(size.scrollWidth).toBeGreaterThan(size.viewportWidth);
});

test('PDF zoom keeps the selected page at the reading viewport', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await page.evaluate(() => window.pdfReaderController.setPdfScale(2));
  await expect.poll(async () => page.locator('.pdf-page[data-page-index="2"] canvas').evaluate((canvas) => canvas.getBoundingClientRect().width))
    .toBeGreaterThan(1000);

  const position = await page.evaluate(() => {
    const host = document.getElementById('pdfPages').getBoundingClientRect();
    const target = document.querySelector('.pdf-page[data-page-index="2"]').getBoundingClientRect();
    return { top: target.top - host.top, bottom: target.bottom - host.top, hostHeight: host.height };
  });
  expect(position.top).toBeGreaterThanOrEqual(-10);
  expect(position.top).toBeLessThan(90);
  expect(position.bottom).toBeGreaterThan(0);
  await expect(page.locator('#pdfPageNumber')).toHaveValue('3');
});

test('PDF zoom preserves a reading anchor sixty percent into a page', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  await expect(page.locator('.pdf-page[data-page-index="2"] canvas')).toBeVisible();
  await page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const wrapper = document.querySelector('.pdf-page[data-page-index="2"]');
    const line = Math.min(120, Math.max(24, Math.round(host.clientHeight * 0.2)));
    host.scrollTop += wrapper.getBoundingClientRect().top - host.getBoundingClientRect().top
      + wrapper.getBoundingClientRect().height * 0.6 - line;
  });
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  const normalizedPosition = async () => page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const wrapper = document.querySelector('.pdf-page[data-page-index="2"]');
    const line = Math.min(120, Math.max(24, Math.round(host.clientHeight * 0.2)));
    return (host.getBoundingClientRect().top + line - wrapper.getBoundingClientRect().top)
      / wrapper.getBoundingClientRect().height;
  });
  const before = await normalizedPosition();
  expect(before).toBeGreaterThan(0.5);
  await page.evaluate(() => window.pdfReaderController.setPdfScale(1.5));
  const after = await normalizedPosition();
  expect(Math.abs(after - before)).toBeLessThan(0.01);
  await page.evaluate(() => window.pdfReaderController.setLayoutMode('double'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(Math.abs((await normalizedPosition()) - before)).toBeLessThan(0.01);
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect.poll(async () => page.evaluate(() => window.pdfReaderController.getEffectiveLayoutMode())).toBe('single');
  expect(Math.abs((await normalizedPosition()) - before)).toBeLessThan(0.01);
  await expect(page.locator('#pdfPageNumber')).toHaveValue('3');
});

test('PDF navigation and zoom controls form one compact group on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();

  const gap = await page.evaluate(() => {
    const next = document.getElementById('pdfNextPage').getBoundingClientRect();
    const zoomOut = document.getElementById('pdfZoomOut').getBoundingClientRect();
    return zoomOut.left - next.right;
  });
  expect(gap).toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(32);
});

test('PDF toolbar keeps controls usable across portrait desktop and mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await expect(page.locator('#pdfPageNumber')).toHaveValue('1');

  for (const [width, height] of [[1600, 900], [1100, 900], [800, 1000], [430, 932], [375, 812], [320, 568]]) {
    await page.setViewportSize({ width, height });
    const expectedMode = width > 1100 ? 'wide' : width > 430 ? 'compact' : 'mobile';
    await expect(page.locator('.pdf-reader-controls')).toHaveAttribute('data-pdf-toolbar-mode', expectedMode);
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const controls = rect('.pdf-reader-controls');
      const title = rect('.topbar-left');
      const groups = [...document.querySelectorAll('.pdf-control-group')].map((item) => item.getBoundingClientRect().toJSON());
      const buttons = [...document.querySelectorAll('.pdf-reader-controls button')].map((item) => item.getBoundingClientRect().toJSON());
      const pages = rect('#pdfPages');
      return {
        mode: document.querySelector('.pdf-reader-controls').dataset.pdfToolbarMode,
        controls, title, groups, buttons, pages,
        overflow: document.documentElement.scrollWidth - innerWidth
      };
    });
    expect(layout.mode, `toolbar mode at ${width}px`).toBe(expectedMode);
    expect(layout.overflow, `root overflow at ${width}px`).toBeLessThanOrEqual(1);
    expect(layout.buttons.every((button) => button.width >= 44 && button.height >= 44),
      `button targets at ${width}px`).toBeTruthy();
    expect(layout.groups.every((group) => group.left >= -1 && group.right <= width + 1),
      `group clipping at ${width}px`).toBeTruthy();
    expect(layout.pages.top).toBeGreaterThanOrEqual(layout.controls.bottom - 1);
    if (layout.mode === 'wide') {
      expect(layout.title.right).toBeLessThanOrEqual(layout.groups[0].left + 1);
    } else {
      expect(layout.title.bottom).toBeLessThanOrEqual(layout.controls.top + 1);
    }
    if (width === 320) expect(layout.controls.height).toBeLessThanOrEqual(110);
    if (width === 430) expect(Math.abs(layout.groups[0].top - layout.groups[1].top)).toBeLessThanOrEqual(1);
  }
});

test('PDF page and zoom controls announce deliberate changes but not passive scrolling', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.locator('#pdfNextPage').click();
  await expect(page.locator('#pdfReaderAnnouncement')).toContainText('页');
  await page.locator('#pdfZoomIn').click();
  await expect(page.locator('#pdfReaderAnnouncement')).toContainText('缩放');
  const announcement = await page.locator('#pdfReaderAnnouncement').textContent();
  await page.locator('#pdfPages').evaluate((host) => { host.scrollTop += 300; });
  await page.waitForTimeout(100);
  await expect(page.locator('#pdfReaderAnnouncement')).toHaveText(announcement);
});

test('PDF page viewport keeps native keyboard scrolling without changing EPUB navigation', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await page.locator('#pdfPages').focus();
  await expect(page.locator('#pdfPages')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(async () => page.locator('#pdfPages').evaluate((host) => host.scrollTop)).toBeGreaterThan(100);
  await page.keyboard.press('PageUp');
  await expect.poll(async () => page.locator('#pdfPages').evaluate((host) => host.scrollTop)).toBeLessThan(100);
});

test('PDF search and focus stay discernible in forced colors with reduced motion', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.locator('#pdfPages').focus();
  const focus = await page.locator('#pdfPages').evaluate((host) => {
    const style = getComputedStyle(host);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focus.style).toBe('solid');
  expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
  await page.locator('#btnSearch').click();
  await page.locator('#readerSearchQuery').fill('第二页精确定位词');
  await page.locator('#readerSearchSubmit').click();
  await expect(page.locator('.reader-search-result')).toHaveCount(1);
  await page.locator('.reader-search-result').click();
  await expect(page.locator('.pdf-search-hit-rect').first()).toBeVisible();
  const outline = await page.locator('.pdf-search-hit-rect').first().evaluate((hit) => getComputedStyle(hit).outlineStyle);
  expect(outline).toBe('solid');
});

test('PDF repeated scroll zoom resize search and reopen keeps rendering bounded', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(APP_PATH);
  for (let cycle = 0; cycle < 5; cycle += 1) {
    if (cycle > 0) {
      await page.locator('#btnBackToLibrary').click();
      await expect(page.locator('.library-view h1')).toHaveText('书库');
    }
    await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
    await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
    await page.evaluate(() => window.pdfReaderController.goToPdfPage(1));
    await page.evaluate(() => {
      const host = document.getElementById('pdfPages');
      host.scrollTop += 150;
    });
    await page.evaluate((index) => window.pdfReaderController.setPdfScale(1 + index * 0.1), cycle);
    await page.setViewportSize({ width: 800, height: 900 });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.locator('#btnSearch').click();
    await page.locator('#readerSearchQuery').fill('第二页精确定位词');
    await page.locator('#readerSearchSubmit').click();
    await expect(page.locator('.reader-search-result')).toHaveCount(1);
    await page.locator('.reader-search-result').click();
    await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '1');
    await expect(page.locator('#readerSearchSheet')).toBeVisible();
    await page.locator('#readerSearchSheet [aria-label="关闭搜索"]').click();
    const state = await page.evaluate(() => ({
      ...window.pdfReaderController.getDebugState(),
      canvasCount: document.querySelectorAll('#pdfPages .pdf-page-canvas').length,
      textLayerCount: document.querySelectorAll('#pdfPages .pdf-page-text-layer').length
    }));
    expect(state.activeRenderCount).toBeLessThanOrEqual(1);
    expect(state.renderedPages).toBeLessThanOrEqual(4);
    expect(state.canvasCount).toBeLessThanOrEqual(4);
    expect(state.textLayerCount).toBeLessThanOrEqual(4);
  }
  expect(errors).toEqual([]);
});

test('PDF desktop controls visually join the reader topbar without moving the document start', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  const geometry = await page.evaluate(() => {
    const topbar = document.getElementById('topbar').getBoundingClientRect();
    const controls = document.querySelector('.pdf-reader-controls').getBoundingClientRect();
      const status = document.getElementById('pdfReaderStatus').getBoundingClientRect();
      const pages = document.getElementById('pdfPages').getBoundingClientRect();
    const groups = [...document.querySelectorAll('.pdf-control-group')].map((node) => node.getBoundingClientRect());
    return {
      topbar: topbar.toJSON(),
      controls: controls.toJSON(),
        status: status.toJSON(),
        pages: pages.toJSON(),
      groups: groups.map((rect) => rect.toJSON())
    };
  });
  expect(Math.abs(geometry.controls.top - geometry.topbar.top)).toBeLessThanOrEqual(1);
  expect(geometry.controls.bottom).toBeLessThanOrEqual(geometry.topbar.bottom + 1);
  expect(geometry.status.height).toBe(0);
  expect(geometry.pages.top).toBeGreaterThanOrEqual(geometry.topbar.bottom - 1);
  expect(geometry.groups[1].left - geometry.groups[0].right).toBeGreaterThanOrEqual(8);
});

test('PDF zoom keyboard shortcuts change PDF scale instead of text-reader font size', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfZoomValue')).toHaveText('100%');

  await page.keyboard.press('Control+=');
  await expect(page.locator('#pdfZoomValue')).toHaveText('110%');
  await page.keyboard.press('Control+-');
  await expect(page.locator('#pdfZoomValue')).toHaveText('100%');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+0');
  await expect(page.locator('#pdfZoomValue')).toHaveText('100%');
});

test('rapid PDF book switching and return-to-library release the old reader surface', async ({ page }) => {
  await page.goto(APP_PATH);
  const book = page.locator('.library-book').filter({ hasText: 'e2e-reader' });
  await book.click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.library-view h1')).toBeVisible();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await expect(page.locator('body')).not.toHaveClass(/is-pdf-reader/);
  await expect(page.locator('#pdfPages')).toBeEmpty();

  const textBook = page.locator('.library-book').filter({ hasText: 'E2E Markdown' });
  await expect(textBook).toBeVisible();
  await textBook.click();
  await expect(page.locator('#article')).toContainText('E2E Reader');
  await expect(page.locator('body')).not.toHaveClass(/is-pdf-reader/);
  await expect(page.locator('#pdfPages')).toBeEmpty();
});

test('corrupt PDF displays a safe controlled error and remains closable', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-corrupt' }).click();

  await expect(page.locator('#pdfReaderStatus')).toContainText('无法打开此 PDF');
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).not.toContainText('Invalid PDF');
  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
});

test.describe('mobile PDF layout', () => {
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('mobile PDF text selection still exposes the shared marking actions', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  const firstPage = page.locator('.pdf-page[data-page-index="0"]');
  await expect(firstPage).toHaveAttribute('data-text-layer-state', 'ready');
  await page.evaluate(() => {
    const layer = document.querySelector('.pdf-page[data-page-index="0"] .pdf-page-text-layer');
    const span = [...layer.querySelectorAll('span')].find((item) => item.textContent.includes('第一页'));
    if (!span?.firstChild) throw new Error('mobile selection fixture has no first-page text');
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, Math.min(6, span.firstChild.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    layer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  });

  await expect(page.locator('#selectionMenu')).toBeVisible();
  await expect(page.locator('#btnMobileHighlight')).toBeDisabled();
  await expect(page.locator('#selectionMenu [data-selection-action="marker"]')).toBeVisible();
  const bounds = await page.locator('#selectionMenu').evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
});

test('PDF controls remain within a narrow mobile viewport and follow the dark theme', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await page.evaluate(() => applyTheme('dark', false));

  const metrics = await page.evaluate(() => {
    const controls = document.querySelector('.pdf-reader-controls');
    const pages = document.getElementById('pdfPages');
    const fit = document.getElementById('pdfFitWidth').getBoundingClientRect();
    return {
      mobileProfile: document.documentElement.dataset.readerSurface,
      controlsBackground: getComputedStyle(controls).backgroundColor,
      controlsColor: getComputedStyle(controls).color,
      pagesWidth: pages.clientWidth,
      pagesScrollWidth: pages.scrollWidth,
      fitRight: fit.right,
      viewportWidth: innerWidth
    };
  });
  expect(metrics.mobileProfile).toBe('mobile');
  expect(metrics.controlsBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(metrics.controlsColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(metrics.pagesScrollWidth).toBeLessThanOrEqual(metrics.pagesWidth + 1);
  expect(metrics.fitRight).toBeLessThanOrEqual(metrics.viewportWidth);
});

test('mobile PDF zoom keeps the selected page visible without clipping its canvas', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  await page.evaluate(() => window.pdfReaderController.setPdfScale(2));
  await expect.poll(async () => page.locator('.pdf-page[data-page-index="2"] canvas').evaluate((canvas) => canvas.getBoundingClientRect().width))
    .toBeGreaterThan(1000);

  const geometry = await page.evaluate(() => {
    const host = document.getElementById('pdfPages');
    const wrapper = document.querySelector('.pdf-page[data-page-index="2"]');
    return {
      pageTop: wrapper.getBoundingClientRect().top - host.getBoundingClientRect().top,
      wrapperWidth: wrapper.getBoundingClientRect().width,
      canvasWidth: wrapper.querySelector('canvas').getBoundingClientRect().width
    };
  });
  expect(geometry.pageTop).toBeGreaterThanOrEqual(-10);
  expect(geometry.pageTop).toBeLessThan(90);
  expect(geometry.wrapperWidth).toBeGreaterThanOrEqual(geometry.canvasWidth - 1);
});

test('mobile PDF toolbar contains both control groups above the document', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const controls = document.querySelector('.pdf-reader-controls').getBoundingClientRect();
    const lastGroup = document.querySelector('.pdf-reader-controls .pdf-control-group:last-child').getBoundingClientRect();
    const pages = document.getElementById('pdfPages').getBoundingClientRect();
    return { controlsBottom: controls.bottom, groupBottom: lastGroup.bottom, pagesTop: pages.top };
  });
  expect(layout.controlsBottom).toBeGreaterThanOrEqual(layout.groupBottom - 1);
  expect(layout.pagesTop).toBeGreaterThanOrEqual(layout.controlsBottom - 1);
});
});

test('PDF reading page persists across refresh and return-to-library reopen', async ({ page }) => {
  const progressResponses = [];
  page.on('response', (response) => {
    if (/\/api\/books\/[a-f0-9]{64}\/progress$/.test(new URL(response.url()).pathname)) {
      progressResponses.push({ status: response.status(), method: response.request().method() });
    }
  });
  await page.goto(APP_PATH);
  const book = page.locator('.library-book').filter({ hasText: 'e2e-reader' });
  await book.click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');

  expect(await page.evaluate(() => {
    window.pdfReaderController.goToPdfPage(0);
    return window.pdfReaderController.goToPdfPage(2);
  })).toBeTruthy();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect.poll(() => progressResponses.length, { timeout: 4000 }).toBeGreaterThan(0);
  expect(progressResponses[0].status, JSON.stringify(progressResponses)).toBe(200);

  await page.reload();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfPageNumber')).toHaveValue('3');

  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await page.reload();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfPageNumber')).toHaveValue('1');

  const reopenSave = page.waitForResponse((response) => response.request().method() === 'PUT'
    && /\/api\/books\/[a-f0-9]{64}\/progress$/.test(new URL(response.url()).pathname));
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(2));
  expect((await reopenSave).status()).toBe(200);

  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#pdfPageNumber')).toHaveValue('3');

  await page.evaluate(async () => window.browserHost.saveProgress({
    locator: JSON.stringify({ version: 1, type: 'pdf', pageIndex: 999 }),
    percentage: null
  }));
  await page.reload();
  await expect(page.locator('#pdfPageNumber')).toHaveValue('4');

  await page.evaluate(async () => window.browserHost.saveProgress({
    locator: JSON.stringify({ version: 1, type: 'pdf', pageIndex: -1 }),
    percentage: null
  }));
  await page.reload();
  await expect(page.locator('#pdfPageNumber')).toHaveValue('1');
});

test('PDF full-text search retains its surface and navigates to a verified text-layer hit', async ({ page }) => {
  const aiRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/books/') && request.url().includes('/ai/')) aiRequests.push(request.url());
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await expect(page.locator('#btnSearch')).toBeEnabled();

  await page.locator('#btnSearch').click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await page.locator('#readerSearchQuery').fill('第二页精确定位词');
  const response = page.waitForResponse((item) => item.request().method() === 'GET'
    && item.url().includes('/api/books/') && item.url().includes('/search') && item.ok());
  await page.locator('#readerSearchForm').press('Enter');
  const searchResponse = await response;
  const payload = await searchResponse.json();
  expect(payload.results[0].locator).toMatchObject({ type: 'pdf', pageIndex: 1, quote: '第二页精确定位词' });
  await expect(page.locator('.reader-search-result')).toHaveCount(1);
  await page.locator('.reader-search-result').click();

  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '1');
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await expect(page.locator('.pdf-page[data-page-index="1"] .textLayer span').filter({ hasText: '第二页精确定位词' })).toBeVisible();
  await expect(page.locator('.pdf-page[data-page-index="1"] .pdf-search-hit-layer')).toBeVisible();
  expect(aiRequests).toEqual([]);
});

test('double-page PDF keeps an exact right-page search hit and its search panel', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.setLayoutMode('double'));
  await expect(page.locator('#pdfPages > .pdf-spread')).toHaveCount(3);
  await page.locator('#pdfPageNumber').fill('3');
  await page.locator('#pdfPageNumber').press('Enter');
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await page.locator('#pdfNextPage').click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '3');
  await page.locator('#pdfPreviousPage').click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '1');
  await page.evaluate(() => window.pdfReaderController.setPdfScale(1.25));
  await expect(page.locator('#pdfZoomValue')).toHaveText('125%');

  await page.locator('#btnSearch').click();
  await page.locator('#readerSearchQuery').fill('跨页唯一命中');
  const searchResponse = page.waitForResponse((item) => item.request().method() === 'GET'
    && item.url().includes('/api/books/') && item.url().includes('/search') && item.ok());
  await page.locator('#readerSearchForm').press('Enter');
  await searchResponse;
  await expect(page.locator('.reader-search-result').first()).toBeVisible();
  await page.locator('.reader-search-result').first().click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('.pdf-page[data-page-index="2"] .pdf-search-hit-rect')).toHaveCount(1);
  const hit = await page.locator('.pdf-page[data-page-index="2"] .pdf-search-hit-rect').boundingBox();
  const rightPage = await page.locator('.pdf-page[data-page-index="2"]').boundingBox();
  expect(hit.x).toBeGreaterThanOrEqual(rightPage.x);
  expect(hit.y).toBeGreaterThanOrEqual(rightPage.y);
  expect(hit.x + hit.width).toBeLessThanOrEqual(rightPage.x + rightPage.width + 1);
  expect(hit.y + hit.height).toBeLessThanOrEqual(rightPage.y + rightPage.height + 1);
  const pair = await page.locator('.pdf-page[data-page-index="1"], .pdf-page[data-page-index="2"]').evaluateAll((nodes) =>
    nodes.map((node) => ({ index: Number(node.dataset.pageIndex), box: node.getBoundingClientRect().toJSON() })));
  expect(pair[1].box.x).toBeGreaterThan(pair[0].box.x);
  expect(Math.abs(pair[1].box.y - pair[0].box.y)).toBeLessThan(2);
});

test('PDF has its own saved layout setting without exposing EPUB typography controls', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  const epubModeBefore = await page.evaluate(async () => (await window.browserHost.getUserState()).settings.readingMode);
  await page.locator('#btnSettings').click();
  await expect(page.locator('[data-custom-select-for="settingPdfLayoutMode"] .custom-select-trigger')).toBeVisible();
  await expect(page.locator('[data-custom-select-for="settingReadingMode"] .custom-select-trigger')).toBeHidden();
  await expect(page.locator('#settingFontFamily').locator('..')).toBeHidden();
  await expect(page.locator('[data-settings-group="typography"]')).toBeHidden();
  await expect(page.locator('[data-settings-group="highlight"]')).toBeVisible();
  await expect(page.locator('#settingTheme').locator('..')).toBeVisible();
  await page.locator('#settingPdfLayoutMode').selectOption('double');
  await expect(page.locator('#pdfPages')).toHaveAttribute('data-pdf-layout', 'double');
  await expect.poll(async () => (await page.evaluate(() => window.browserHost.getUserState())).settings.pdfLayoutMode)
    .toBe('double');

  await page.reload();
  await expect(page.locator('#pdfPages')).toHaveAttribute('data-pdf-layout', 'double');
  await page.locator('#btnBackToLibrary').click();
  await page.locator('.library-book').filter({ hasText: 'E2E EPUB' }).click();
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter');
  await page.locator('#btnSettings').click();
  await expect(page.locator('[data-custom-select-for="settingPdfLayoutMode"] .custom-select-trigger')).toBeHidden();
  await expect(page.locator('[data-custom-select-for="settingReadingMode"] .custom-select-trigger')).toBeVisible();
  expect(await page.evaluate(async () => (await window.browserHost.getUserState()).settings.readingMode))
    .toBe(epubModeBefore || 'scroll');
});

test('PDF double layout falls back on narrow screens and restores the exact right page and manual zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => {
    window.pdfReaderController.goToPdfPage(2);
    window.pdfReaderController.setPdfScale(1.25);
    window.pdfReaderController.setLayoutMode('double');
  });
  await expect(page.locator('#pdfPages')).toHaveAttribute('data-pdf-layout', 'double');
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');

  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator('#pdfPages')).toHaveAttribute('data-pdf-layout', 'single');
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('#pdfZoomValue')).toHaveText('125%');
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.locator('#pdfPages')).toHaveAttribute('data-pdf-layout', 'double');
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('#pdfZoomValue')).toHaveText('125%');
});

test('PDF repeated phrase search highlights the occurrence matched by page offset and context', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.evaluate(() => window.pdfReaderController.goToPdfPage(0));
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-text-layer-state', 'ready');
  await page.locator('#btnSearch').click();
  await page.locator('#readerSearchQuery').fill('重复检索词');
  const response = page.waitForResponse((item) => item.request().method() === 'GET'
    && item.url().includes('/api/books/') && item.url().includes('/search') && item.ok());
  await page.locator('#readerSearchForm').press('Enter');
  const payload = await (await response).json();
  expect(payload.results).toHaveLength(2);
  expect(payload.results[0].locator.pageIndex).toBe(0);
  expect(payload.results[1].locator.textOffset).toBeGreaterThan(payload.results[0].locator.textOffset);

  const expected = await page.evaluate(({ snippet, offset }) => {
    const layer = document.querySelector('.pdf-page[data-page-index="0"] .pdf-page-text-layer');
    const page = document.querySelector('.pdf-page[data-page-index="0"]');
    const target = window.readerSearchApi.findSearchTextRange(layer, '重复检索词', { offset, snippet });
    const rect = target?.range.getBoundingClientRect();
    const pageRect = page?.getBoundingClientRect();
    return rect && pageRect ? { top: rect.top - pageRect.top, left: rect.left - pageRect.left } : null;
  }, { snippet: payload.results[1].snippet, offset: payload.results[1].locator.textOffset });
  expect(expected).not.toBeNull();

  await page.locator('.reader-search-result').nth(1).click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '0');
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await expect(page.locator('.pdf-page[data-page-index="0"] .pdf-search-hit-rect')).toHaveCount(1);
  const actual = await page.locator('.pdf-page[data-page-index="0"] .pdf-search-hit-rect').boundingBox();
  const pageBox = await page.locator('.pdf-page[data-page-index="0"]').boundingBox();
  expect(Math.abs(actual.y - pageBox.y - expected.top)).toBeLessThan(2);
  expect(Math.abs(actual.x - pageBox.x - expected.left)).toBeLessThan(2);
});

test('PDF search falls back to an explicit page-only message when the text layer cannot verify a hit', async ({ page }) => {
  await page.route('**/api/books/*/search?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        query: '不存在的精确短语',
        scope: 'book',
        hasMore: false,
        nextCursor: null,
        truncated: false,
        results: [{
          id: 'pdf:2:0:8',
          chapterIndex: 2,
          chapterLabel: '第 3 页',
          snippet: '不存在的精确短语',
          matchText: '不存在的精确短语',
          locator: { version: 1, type: 'pdf', pageIndex: 2, textOffset: 0, quote: '不存在的精确短语' }
        }]
      })
    });
  });
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-reader' }).click();
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.locator('#btnSearch').click();
  await page.locator('#readerSearchQuery').fill('不存在的精确短语');
  await page.locator('#readerSearchForm').press('Enter');
  await expect(page.locator('.reader-search-result')).toHaveCount(1);
  await page.locator('.reader-search-result').click();

  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await expect(page.locator('.pdf-page[data-page-index="2"] .pdf-search-hit-layer')).toHaveCount(0);
  await expect(page.locator('#fileName')).toContainText('无法确认精确文本');
});
