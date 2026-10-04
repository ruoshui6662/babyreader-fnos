'use strict';

// 阅读样式 (R4): own papers, 日夜跟随系统, 亮度 in the client.
const { test, expect } = require('@playwright/test');
const { openEpubFixture, resetReaderSettings, showMobileReaderChrome } = require('./helpers/reader');

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openOnPhone(page, { client = false } = {}) {
  await page.addInitScript((client) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
    if (client) {
      window.__brightness = [];
      window.ZhenshuNative = { setScreen() {}, setBrightness: (level) => window.__brightness.push(level), server: () => 'nas' };
    }
  }, client);
  await page.goto('/app/zhenshu/');
  await resetReaderSettings(page);
  await page.evaluate(() => fetch('/app/zhenshu/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readerStyles: [], readerStyle: null, themeAuto: { enabled: false, day: 'light', night: 'dark' } }) }));
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
}

async function openThemePanel(page) {
  await showMobileReaderChrome(page);
  await page.locator('#btnMobileTheme').click();
  await expect(page.locator('#mobilePanelTheme')).toBeVisible();
}

test('an own style: paper, ink and texture paint the page, are kept, and can be deleted', async ({ page }) => {
  await openOnPhone(page);
  await openThemePanel(page);
  await expect(page.locator('#mobileBrightnessField')).toBeHidden();
  await page.locator('.mobile-swatch-add').click();
  await page.locator('.mobile-color-row button[title="夜墨"]').click();
  // A dark paper gets a light ink and a dark base for the chrome.
  await expect.poll(() => page.evaluate(() => [state.theme, getComputedStyle(document.body).getPropertyValue('--color-bg').trim(), getComputedStyle(document.body).getPropertyValue('--color-text').trim()]))
    .toEqual(['dark', '#1b1d20', '#ddd8cf']);
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT'
    && JSON.parse(r.request().postData() || '{}').readerStyles?.[0]?.texture === 'linen');
  await page.locator('#mobileSubBody .mobile-segments button', { hasText: '细麻' }).click();
  const body = JSON.parse((await saved).request().postData());
  expect(body.readerStyles[0]).toMatchObject({ bg: '#1b1d20', ink: '#ddd8cf', texture: 'linen' });
  expect(body.readerStyle).toBe(body.readerStyles[0].id);
  await expect(page.locator('body')).toHaveAttribute('data-paper-texture', 'linen');

  await page.reload();
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--color-bg').trim())).toBe('#1b1d20');

  // A built-in theme takes over; the own one stays in the list.
  await openThemePanel(page);
  await page.locator('[data-mobile-theme="sepia"]').click();
  await expect.poll(() => page.evaluate(() => [state.readerStyle, state.theme])).toEqual([null, 'sepia']);
  await expect(page.locator('[data-mobile-own-style]')).toHaveCount(1);
  // Choose it, tap again to edit, delete it.
  await page.locator('[data-mobile-own-style]').click();
  await page.locator('[data-mobile-own-style]').click();
  await page.locator('#mobileSubBody .is-destructive').click();
  await expect(page.locator('[data-mobile-own-style]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => state.readerStyle)).toBe(null);
});

test('日夜跟随系统 switches between the day and the night style', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openOnPhone(page);
  await openThemePanel(page);
  await page.locator('[data-mobile-theme="sepia"]').click();
  await page.locator('#mobileThemeAuto').check();
  await expect(page.locator('#mobileThemeAutoHint')).toContainText('日间用“护眼”，夜间用“深色”');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.evaluate(() => state.theme)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => page.evaluate(() => state.theme)).toBe('sepia');
});

test('亮度 in the client: set while reading, handed back to the system otherwise', async ({ page }) => {
  await openOnPhone(page, { client: true });
  await openThemePanel(page);
  const field = page.locator('#mobileBrightnessField');
  await expect(field).toBeVisible();
  await expect(page.locator('#mobileBrightness')).toBeDisabled();
  await page.locator('#mobileBrightnessSystem').uncheck();
  await page.locator('#mobileBrightness').evaluate((input) => {
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__brightness.at(-1))).toBeCloseTo(0.3, 2);
  await page.evaluate(() => returnToLibrary());
  await expect.poll(() => page.evaluate(() => window.__brightness.at(-1))).toBe(-1);
});
