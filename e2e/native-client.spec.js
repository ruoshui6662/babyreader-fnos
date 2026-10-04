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
      changeServer: () => window.__native.push(['changeServer'])
    };
  });
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await page.reload({ waitUntil: 'load' });
}

const lastReading = (page) => page.evaluate(() => window.__native.filter((call) => call[0] === 'setReading').at(-1));

test('the client is told when reading starts and ends, with the options that apply while reading', async ({ page }) => {
  await openInClient(page);
  await expect(page.locator('html')).toHaveAttribute('data-native-client', '');
  // The shelf: not reading.
  expect((await lastReading(page)).slice(1, 2)).toEqual([false]);

  await openEpubFixture(page);
  // Reading, dark theme; defaults: no immersive, screen on, volume keys.
  await expect.poll(() => lastReading(page)).toEqual(['setReading', true, true, false, true, true]);

  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  await showMobileReaderChrome(page);
  await page.locator('#btnMobileSettings').click();
  await page.locator('#btnSettingsMore').click();
  const group = page.locator('#settingsNativeGroup');
  await expect(group).toBeVisible();
  await expect(group.locator('#settingNativeServer')).toHaveText('192.168.1.10:5666');
  await group.locator('#settingNativeImmersive').click();
  await group.locator('#settingNativeVolumeKeys').click();
  await expect.poll(() => lastReading(page)).toEqual(['setReading', true, true, true, true, false]);
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
  await expect.poll(async () => (await lastReading(page))[1]).toBe(false);
  expect(await page.evaluate(() => window.zhenshuNative.back())).toBe(false);
  expect(await page.evaluate(() => window.zhenshuNative.turn(1))).toBe(false);
});

test('in a browser there is no client group', async ({ page }) => {
  await page.goto(APP_PATH);
  await expect(page.locator('html')).not.toHaveAttribute('data-native-client', '');
  await expect(page.locator('#settingsNativeGroup')).toBeHidden();
});
