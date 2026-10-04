'use strict';

// The Android client (clients/android) exposes window.ZhenshuNative to the
// page. These tests stand in for the shell with a recording stub.
const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  showMobileReaderChrome
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openInClient(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 ZhenshuAndroid/0.1'
    });
    window.__native = [];
    window.ZhenshuNative = {
      version: () => '0.1.0',
      server: () => '192.168.1.10:5666',
      setReading: (...args) => window.__native.push(['setReading', ...args]),
      setScreen: (...args) => window.__native.push(['setScreen', ...args]),
      changeServer: () => window.__native.push(['changeServer']),
      saveFile: (name, mime, base64) => {
        window.__native.push(['saveFile', name, mime, base64]);
        return `下载/枕书/${name}`;
      },
      printHtml: (html, title) => window.__native.push(['printHtml', html.length, title])
    };
  });
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await page.reload({ waitUntil: 'load' });
}

// [reading, topColor, bottomColor, hideStatusBar, keepOn, volumeKeys]
const lastReading = (page) => page.evaluate(() => window.__native.filter((call) => call[0] === 'setScreen').at(-1)?.slice(1));

test('the client is told when reading starts and ends, with the options that apply while reading', async ({ page }) => {
  await openInClient(page);
  await expect(page.locator('html')).toHaveAttribute('data-native-client', '');
  // The shelf: not reading.
  await expect.poll(async () => (await lastReading(page))?.[0]).toBe(false);

  await openEpubFixture(page);
  // Reading; defaults: status bar shown, screen on, volume keys. The bar
  // colours are the page's own at the top and bottom edge.
  await expect.poll(async () => (await lastReading(page))?.[0]).toBe(true);
  const [, top, bottom, ...options] = await lastReading(page);
  expect(options).toEqual([false, true, true]);
  const edges = await page.evaluate(() => [screenEdgeColor(1), screenEdgeColor(window.innerHeight - 2)]);
  expect([top, bottom]).toEqual(edges);
  expect(top).toMatch(/^rgb/);

  // A light theme: the bars follow the page.
  await page.evaluate(() => { state.theme = 'light'; applyTheme?.(); document.body.classList.add('theme-light'); syncNativeClient(); });
  await expect.poll(async () => (await lastReading(page))?.[1]).not.toBe(top);

  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  await showMobileReaderChrome(page);
  await page.locator('#btnMobileSettings').click();
  await page.locator('#btnMobileMoreSettings').click();
  const group = page.locator('#settingsNativeGroup');
  await expect(group).toBeVisible();
  await expect(group.locator('#settingNativeServer')).toHaveText('192.168.1.10:5666');
  await group.locator('#settingNativeImmersive').click();
  await group.locator('#settingNativeVolumeKeys').click();
  await expect.poll(async () => (await lastReading(page))?.slice(3)).toEqual([true, true, false]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zhenshu.client'))))
    .toMatchObject({ immersive: true, volumeKeys: false });
  await group.locator('#btnNativeChangeServer').click();
  expect(await page.evaluate(() => window.__native.some((call) => call[0] === 'changeServer'))).toBe(true);
});

test('the back key closes what is open, then leaves the book, then lets the shell decide; volume keys turn pages', async ({ page }) => {
  await openInClient(page);
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  await expect.poll(() => page.evaluate(() => state.pageGroupCount)).toBeGreaterThan(1);

  expect(await page.evaluate(() => window.zhenshuNative.turn(1))).toBe(true);
  await expect.poll(() => page.evaluate(() => state.pageGroup)).toBe(1);
  expect(await page.evaluate(() => window.zhenshuNative.turn(-1))).toBe(true);
  await expect.poll(() => page.evaluate(() => state.pageGroup)).toBe(0);

  await showMobileReaderChrome(page);
  await page.locator('#btnMobileToc').click();
  await expect(page.locator('#readerDrawer')).toBeVisible();
  expect(await page.evaluate(() => window.zhenshuNative.back())).toBe(true);
  await expect(page.locator('#readerDrawer')).toBeHidden();

  expect(await page.evaluate(() => window.zhenshuNative.back())).toBe(true);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await expect.poll(async () => (await lastReading(page))?.[0]).toBe(false);
  expect(await page.evaluate(() => window.zhenshuNative.back())).toBe(false);
  expect(await page.evaluate(() => window.zhenshuNative.turn(1))).toBe(false);
});

test('files the page makes are handed to the client, even when the link is revoked at once; PDF goes to the print panel', async ({ page }) => {
  await openInClient(page);
  await page.evaluate(() => {
    // Markdown export (notes page) and the reader's pattern: a detached
    // link whose URL is revoked right after the click.
    downloadNotesFile('# 笔记\n第一条', '读书笔记.md', 'text/markdown;charset=utf-8');
    const url = URL.createObjectURL(new Blob(['划线'], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '划线.md';
    link.click();
    URL.revokeObjectURL(url);
  });
  await expect.poll(() => page.evaluate(() => window.__native.filter((call) => call[0] === 'saveFile').length)).toBe(2);
  const saved = await page.evaluate(() => window.__native.filter((call) => call[0] === 'saveFile')
    .map(([, name, mime, base64]) => [name, mime, new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))]));
  expect(saved).toEqual([
    ['读书笔记.md', 'text/markdown;charset=utf-8', '# 笔记\n第一条'],
    ['划线.md', 'text/markdown', '划线']
  ]);
  await expect(page.locator('#readerFeedback')).toContainText('已保存到 下载/枕书/');

  await page.evaluate(() => printNotesPdf([], { all: true }));
  const printed = await page.evaluate(() => window.__native.find((call) => call[0] === 'printHtml'));
  expect(printed[1]).toBeGreaterThan(100);
  expect(printed[2]).toMatch(/^全部读书笔记-\d{8}$/);
  await expect(page.locator('#notesPrintFrame')).toHaveCount(0);
});

test('immersive reading in the client: the page runs to the top, the time sits top left, AI floats above the toolbar', async ({ page }) => {
  await openInClient(page);
  await page.evaluate(() => localStorage.setItem('zhenshu.client', JSON.stringify({ immersive: true, keepOn: true, volumeKeys: true })));
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  // The shell reports the camera band's height.
  await page.evaluate(() => document.documentElement.style.setProperty('--app-safe-top', '40px'));
  await expect(page.locator('html')).toHaveAttribute('data-reading-clock', '');
  const clock = page.locator('#mobileReadingClock');
  await expect(clock).toBeVisible();
  await expect(clock).toHaveText(/^\d{2}:\d{2}$/);
  const layout = await page.evaluate(() => ({
    clock: document.getElementById('mobileReadingClock').getBoundingClientRect().toJSON(),
    readerTop: getComputedStyle(document.getElementById('reader')).top
  }));
  expect(layout.clock.top).toBe(0);
  expect(layout.clock.height).toBe(40);
  expect(layout.clock.left).toBeLessThan(40);
  // The reading area eases into place.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('reader')).top)).toBe('40px');

  // The chrome hides the clock; its top bar starts at the very top.
  await showMobileReaderChrome(page);
  await expect(clock).toBeHidden();
  // It slides in from above.
  await expect.poll(async () => Math.round((await page.locator('.reader-shell-nav').boundingBox()).y)).toBe(0);
  await expect(page.locator('#btnMobileAiFloat')).toBeVisible();
  await page.locator('#btnMobileAiFloat').click();
  await expect(page.locator('#aiModal')).toBeVisible();
});

test('in a browser there is no client group', async ({ page }) => {
  await page.goto(APP_PATH);
  await expect(page.locator('html')).not.toHaveAttribute('data-native-client', '');
  await expect(page.locator('#settingsNativeGroup')).toBeHidden();
});
