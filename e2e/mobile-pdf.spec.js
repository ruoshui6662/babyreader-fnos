'use strict';

// PDFs on a phone: no desktop toolbar; a page at a time (翻页) by default,
// turned by a tap on either side, a swipe or the volume keys; 上下滚动 in
// settings shows the pages as one scroll.
const { test, expect } = require('@playwright/test');
const { resetReaderSettings, showMobileReaderChrome } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openPdfOnPhone(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
  });
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await page.reload({ waitUntil: 'load' });
  await page.locator('.library-book').filter({ hasText: 'e2e-columns' }).first().click();
  await expect(page.locator('#pdfPages')).toHaveAttribute('data-phone-paged', 'true');
  await expect(page.locator('.pdf-page.is-current-page')).toHaveCount(1);
  // Start on the first page whatever an earlier run saved.
  await page.evaluate(() => pdfReaderController.goToPdfPage(0));
  await expect.poll(() => page.evaluate(() => pdfReaderController.getCurrentPageIndex())).toBe(0);
  // The page fits the width a moment after opening; until then it is wider
  // than the screen and a swipe pans it instead of turning.
  await expect.poll(() => page.evaluate(() => pdfReaderController.phonePagedZoomed())).toBe(false);
}

const current = (page) => page.evaluate(() => pdfReaderController.getCurrentPageIndex());

test('a phone shows one PDF page across the width, without the desktop toolbar; taps and swipes turn it', async ({ page }) => {
  await openPdfOnPhone(page);
  await expect(page.locator('.pdf-reader-controls')).toBeHidden();
  const visible = await page.locator('#pdfPages > .pdf-page').evaluateAll((pages) => pages.filter((p) => p.offsetParent).length);
  expect(visible).toBe(1);
  const box = await page.locator('.pdf-page.is-current-page').boundingBox();
  expect(box.width).toBeGreaterThan(370);

  await page.mouse.click(370, 420);
  await expect.poll(() => current(page)).toBe(1);
  await page.mouse.click(20, 420);
  await expect.poll(() => current(page)).toBe(0);

  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: 420 }] });
  for (const x of [280, 220, 160]) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 424 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => current(page)).toBe(1);

  // The phone toolbar's 上一页 / 下一页 (a tap right after a swipe is ignored).
  await page.waitForTimeout(450);
  await showMobileReaderChrome(page);
  await page.locator('#btnMobileProgress').click();
  await page.locator('#btnMobileNextChapter').click();
  await expect.poll(() => current(page)).toBe(2);
  await page.locator('#btnMobilePreviousChapter').click();
  await expect.poll(() => current(page)).toBe(1);
});

test('上下滚动 shows the pages as one scroll, and the choice is kept', async ({ page }) => {
  await openPdfOnPhone(page);
  await showMobileReaderChrome(page);
  await page.locator('#btnMobileSettings').click();
  await page.locator('#btnMobileMoreSettings').click();
  const modes = page.locator('.settings-pdf-phone-modes');
  await expect(modes).toBeVisible();
  await expect(page.locator('#readerSettingsSheet .settings-pdf-layout-field')).toBeHidden();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT'
    && JSON.parse(r.request().postData() || '{}').mobilePdfMode === 'scroll');
  await modes.locator('[data-pdf-phone-mode="scroll"]').click();
  await saved;
  await expect(page.locator('#pdfPages')).not.toHaveAttribute('data-phone-paged', 'true');
  const visible = await page.locator('#pdfPages > .pdf-page').evaluateAll((pages) => pages.filter((p) => p.offsetParent).length);
  expect(visible).toBeGreaterThan(1);
});
