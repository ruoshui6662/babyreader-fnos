'use strict';

const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState, openEpubFixture } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const SCREENSHOT_DIR = process.env.ZHENSHU_SCREENSHOT_DIR || null;

async function setSettings(page, patch) {
  await page.evaluate(async (patch) => {
    const current = await (await fetch('/app/zhenshu/api/settings')).json();
    await fetch('/app/zhenshu/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, ...patch }) });
    try { localStorage.removeItem('zhenshu-glass-ambient'); } catch { /* ignore */ }
  }, patch);
}

// A recent progress makes E2E EPUB the 继续阅读 book.
async function readRecently(page) {
  await page.evaluate(async () => {
    const library = await window.browserHost.getLibrary();
    const epub = library.books.find((book) => book.title === 'E2E EPUB');
    await fetch(`/app/zhenshu/api/books/${epub.id}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locator: JSON.stringify({ type: 'epub', chapterIndex: 0, percentage: 0.1 }), percentage: 0.1 })
    });
  });
}

const ambient = (page) => page.evaluate(() => [1, 2, 3].map((index) => getComputedStyle(document.documentElement).getPropertyValue(`--amb-${index}`).trim()));

test.describe('液态玻璃', () => {
  test('off by default; the shelf 外观 menu turns it on, it is saved and survives a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await setSettings(page, { theme: 'light', liquidGlass: false, glassAmbient: 'cover' });
    await readRecently(page);
    await page.goto(APP_PATH);
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'off');
    // Off: the shelf keeps its plain stage, no ambient light.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toBe('none');

    await page.locator('#btnLibraryAppearance').click();
    const menu = page.locator('#libraryAppearanceMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-glass-ambient]').first()).toBeDisabled();
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/g1-menu-off.png` });

    const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT'
      && response.request().postDataJSON()?.liquidGlass === true);
    await menu.locator('#libraryLiquidGlass').check();
    expect((await saved).ok()).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'on');
    await expect(menu).toHaveCSS('backdrop-filter', /blur\(16px\)/);
    // Cover light: taken from the E2E EPUB generated cover, then cached.
    await expect.poll(async () => (await ambient(page))[0]).toMatch(/^(hsl|rgba?|color)\(/);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toContain('radial-gradient');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('zhenshu-glass-ambient') || '{}').last?.palette?.length || 0)).toBe(3);
    if (SCREENSHOT_DIR) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/g1-library-light-cover.png` });
    }

    // 淡蓝: the iOS blue hue.
    await menu.locator('[data-glass-ambient="uniform"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-glass-ambient', 'uniform');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--amb-1'))).toContain('hsl(211');

    // Dark theme refits the light; the reload keeps everything.
    await menu.locator('[data-theme-choice="dark"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--amb-1'))).toBe('hsl(211 55% 20% / .9)');
    await page.waitForTimeout(600); // the settings save is debounced
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'on');
    await expect(page.locator('html')).toHaveAttribute('data-glass-ambient', 'uniform');
    await expect(page.locator('body')).not.toHaveClass(/theme-light/);
  });

  test('the reader settings carry the same switch and ambient choice', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await setSettings(page, { liquidGlass: false, glassAmbient: 'cover' });
    await openEpubFixture(page);
    if (!(await page.locator('#readerSettingsSheet').isVisible())) await page.locator('#btnSettings').click();
    await expect(page.locator('#settingGlassAmbientField')).toBeHidden();
    await page.locator('#settingLiquidGlass').check();
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'on');
    await expect(page.locator('#settingGlassAmbientField')).toBeVisible();
    await page.locator('#settingGlassAmbient [data-glass-ambient="uniform"]').click();
    await expect(page.locator('#settingGlassAmbient [data-glass-ambient="uniform"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-glass-ambient', 'uniform');
    await page.locator('#settingLiquidGlass').uncheck();
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'off');
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--amb-1'))).toBe('');
  });

  test('the 外观 button belongs to the shelf only', async ({ page }) => {
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await expect(page.locator('#btnLibraryAppearance')).toBeVisible();
    await openEpubFixture(page);
    await expect(page.locator('#btnLibraryAppearance')).toBeHidden();
  });
});
