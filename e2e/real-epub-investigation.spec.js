'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');

const samplePath = process.env.BABYREADER_E2E_SAMPLE_EPUB;
const sampleTitle = process.env.BABYREADER_E2E_SAMPLE_TITLE || (samplePath ? path.basename(samplePath, '.epub') : '');
const readinessThrottleRate = Math.max(1, Number(process.env.BABYREADER_E2E_CPU_THROTTLE) || 12);

async function setCpuThrottle(page, rate) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

async function readChapterReadiness(page, previousSourcePath = '') {
  return page.locator('#article').evaluate((article, previousPath) => {
    const chapter = article.querySelector('.epub-chapter');
    const status = document.getElementById('paginationStatus')?.textContent?.trim() || '';
    const geometry = article.dataset.paginationGeometry || '';
    const track = article.dataset.paginationTrack || '';
    const isVisible = (element) => {
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || Number.parseFloat(style.opacity || '1') <= 0) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const hasVisibleText = Boolean(
      chapter
      && isVisible(chapter)
      && chapter.textContent.trim().length > 0
    );
    const hasVisibleMedia = Boolean(chapter && Array.from(chapter.querySelectorAll('img, svg, canvas')).some((media) => {
      if (!isVisible(media)) return false;
      if (media.tagName === 'IMG') return media.complete && media.naturalWidth > 0;
      if (media.tagName === 'CANVAS') return media.width > 0 && media.height > 0;
      return media.querySelector('path, rect, circle, ellipse, line, polyline, polygon, image, text, use, foreignObject') !== null;
    }));
    const navigationReady = ['btnNextPage', 'btnNextChapter', 'btnScrollNextChapter'].some((id) => {
      const action = document.getElementById(id);
      return Boolean(action && !action.disabled && isVisible(action));
    });
    const sourcePath = chapter?.dataset.sourcePath || '';
    const uniqueChapter = Boolean(chapter) && article.querySelectorAll('.epub-chapter').length === 1;
    const sourcePathChanged = !previousPath || sourcePath !== previousPath;
    const paginationReady = /mode=scroll/.test(geometry)
      || (/mode=double/.test(geometry) && /groups=\d+/.test(track));
    const navigationBusy = article.getAttribute('aria-busy') === 'true';
    return {
      chapterHasVisibleMedia: hasVisibleMedia,
      chapterHasVisibleText: hasVisibleText,
      geometry,
      navigationBusy,
      navigationReady,
      sourcePath,
      status,
      track,
      uniqueChapter,
      settled: uniqueChapter
        && sourcePathChanged
        && (hasVisibleText || hasVisibleMedia)
        && !/^正在打开/.test(status)
        && paginationReady
        && !navigationBusy
        && navigationReady
    };
  }, previousSourcePath);
}

async function waitForChapterToSettle(page, previousSourcePath = '') {
  await expect.poll(() => readChapterReadiness(page, previousSourcePath), { timeout: 8_000 })
    .toMatchObject({ settled: true });
  return readChapterReadiness(page, previousSourcePath);
}

function maxLongTaskMs(longTasks) {
  return Math.max(0, ...longTasks.map((entry) => entry.duration));
}

async function openSampleInScrollMode(page, throttleRate, pageErrors) {
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await setCpuThrottle(page, throttleRate);
  await page.goto('/app/babyreader-fnos/');
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await page.evaluate(async () => {
    const response = await fetch('/app/babyreader-fnos/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readingMode: 'scroll', continuousScroll: true })
    });
    if (!response.ok) throw new Error(`Unable to save double-page mode: ${response.status}`);
  });
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await page.evaluate(() => {
    window.__babyReaderLongTasks = [];
    if (!('PerformanceObserver' in window)) return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__babyReaderLongTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  });

  const openedAt = Date.now();
  await page.locator('.library-book').filter({ hasText: sampleTitle }).click();
  const readiness = await waitForChapterToSettle(page);
  const openedMs = Date.now() - openedAt;
  expect(openedMs).toBeLessThanOrEqual(8_000);
  return {
    openedMs,
    readiness,
    longTasks: await page.evaluate(() => window.__babyReaderLongTasks || [])
  };
}

test('optional real EPUB makes its first scroll chapter interactive within eight seconds at 12x CPU throttle', async ({ page }) => {
  test.skip(!samplePath, 'Set BABYREADER_E2E_SAMPLE_EPUB to run this local-only investigation.');
  const pageErrors = [];
  const result = await openSampleInScrollMode(page, readinessThrottleRate, pageErrors);
  const maxObservedLongTaskMs = maxLongTaskMs(result.longTasks);
  console.log(`REAL_EPUB_FIRST_CHAPTER ${JSON.stringify({ throttleRate: readinessThrottleRate, ...result, maxObservedLongTaskMs })}`);
  expect(pageErrors).toEqual([]);
});

test('optional real EPUB changes source path at a scroll chapter boundary with one mounted chapter', async ({ page }) => {
  test.skip(!samplePath, 'Set BABYREADER_E2E_SAMPLE_EPUB to run this local-only investigation.');
  const pageErrors = [];
  const result = await openSampleInScrollMode(page, 4, pageErrors);
  const before = await page.locator('#article').evaluate((article) => ({
    chapterPath: article.querySelector('.epub-chapter')?.dataset.sourcePath || '',
    readerScrollTop: document.getElementById('reader')?.scrollTop || 0
  }));
  const next = page.locator('#btnScrollNextChapter');
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  await page.locator('#reader').evaluate((reader) => {
    reader.scrollTop = reader.scrollHeight;
    reader.dispatchEvent(new Event('scroll'));
  });
  await next.click();
  await expect.poll(() => page.locator('#article .epub-chapter').getAttribute('data-source-path'), { timeout: 8_000 })
    .not.toBe(before.chapterPath);
  const after = await waitForChapterToSettle(page, before.chapterPath);
  expect(after.uniqueChapter).toBe(true);
  await expect.poll(() => page.locator('#reader').evaluate((reader) => reader.scrollTop), { timeout: 8_000 })
    .toBe(0);

  const longTasks = await page.evaluate(() => window.__babyReaderLongTasks || []);
  const maxObservedLongTaskMs = maxLongTaskMs(longTasks);
  console.log(`REAL_EPUB_BOUNDARY ${JSON.stringify({ ...before, after, ...result, longTasks, maxObservedLongTaskMs })}`);
  expect(maxObservedLongTaskMs).toBeLessThanOrEqual(1_000);
  expect(pageErrors).toEqual([]);
});
