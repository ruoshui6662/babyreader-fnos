'use strict';

const { test, expect } = require('@playwright/test');
const { openEpubFixture, resetEpubFixtureState, resetReaderSettings } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

async function asPhone(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
  });
}

test('the app can be added to the home screen', async ({ page, request }) => {
  await page.goto(APP_PATH);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(new URL(href, page.url()).toString());
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: '枕书', display: 'standalone', start_url: './', scope: './' });
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, response.url()).toString())).ok()).toBeTruthy();
  }
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(new URL(touchIcon, page.url()).toString())).ok()).toBeTruthy();
});

test('the browser bar follows the reading theme', async ({ page }) => {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await page.reload();
  const color = page.locator('meta[name="theme-color"]');
  await page.locator('#btnLibraryTheme').click();
  const first = await color.getAttribute('content');
  await page.locator('#btnLibraryTheme').click();
  const second = await color.getAttribute('content');
  expect(new Set([first, second])).toEqual(new Set(['#141416', '#F2F3F5']));
});

test('phone pages run edge to edge with a narrow text inset', async ({ page }) => {
  await asPhone(page);
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await page.reload({ waitUntil: 'load' });
  await openEpubFixture(page);
  await expect(page.locator('body')).toHaveClass(/paged-reading/);
  await expect(page.locator('#article')).toHaveAttribute('data-text-script', /cjk|latin/);
  const layout = await page.evaluate(() => {
    const paragraph = document.querySelector('#article .epub-chapter p').getBoundingClientRect();
    const article = getComputedStyle(document.getElementById('article'));
    return { left: paragraph.left, right: paragraph.right, radius: article.borderTopLeftRadius, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY };
  });
  expect(layout.left).toBeGreaterThanOrEqual(12);
  expect(layout.left).toBeLessThanOrEqual(24);
  expect(layout.right).toBeGreaterThanOrEqual(390 - 24);
  expect(layout.radius).toBe('0px');
  expect(layout.overscroll).toBe('none');

  // Turning a page keeps the next column exactly in view.
  await page.mouse.click(370, 420);
  await expect.poll(() => page.evaluate(() => {
    const rects = [...document.querySelectorAll('#article .epub-chapter p')]
      .flatMap((element) => [...element.getClientRects()])
      .filter((rect) => rect.right > 0 && rect.left < innerWidth);
    return rects.length ? Math.round(Math.min(...rects.map((rect) => rect.left))) : -1;
  })).toBeGreaterThanOrEqual(12);
});

test('two fingers zoom a phone PDF', async ({ page }) => {
  await asPhone(page);
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-annotation' }).click();
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  const before = Number((await page.locator('#pdfZoomValue').textContent()).replace('%', ''));
  await page.locator('#pdfReaderSurface').evaluate((surface) => {
    const touch = (id, x, y) => new Touch({ identifier: id, target: surface, clientX: x, clientY: y });
    surface.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(1, 160, 400), touch(2, 220, 400)] }));
    surface.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(1, 130, 400), touch(2, 250, 400)] }));
    surface.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [touch(1, 130, 400)] }));
  });
  await expect.poll(async () => Number((await page.locator('#pdfZoomValue').textContent()).replace('%', ''))).toBeGreaterThan(before * 1.5);
  await expect(page.locator('#pdfPages')).not.toHaveAttribute('style', /scale\(/);
});
