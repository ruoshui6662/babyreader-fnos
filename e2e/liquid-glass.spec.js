'use strict';

const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState, openEpubFixture, selectArticleText } = require('./helpers/reader');

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
  // Settings live on the server: leave them off for the specs that follow.
  test.afterEach(async ({ page }) => {
    await page.goto(APP_PATH);
    await setSettings(page, { liquidGlass: false, glassAmbient: 'cover' });
  });

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
    // E2E EPUB's generated cover is indigo: the light's hue follows it, not the pale-blue fallback (211).
    const hues = await page.evaluate(() => JSON.parse(localStorage.getItem('zhenshu-glass-ambient')).last.palette.map((colour) => colour[0]));
    expect(hues[0]).toBeGreaterThan(220);
    expect(hues[0]).toBeLessThan(245);
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

  test('G2 shelf chrome: floating sidebar and capsules on desktop; all back when off', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await setSettings(page, { theme: 'dark', liquidGlass: true, glassAmbient: 'cover' });
    await page.goto(APP_PATH);
    const nav = page.locator('#shelfNav');
    await expect(nav).toHaveCSS('border-radius', '22px');
    await expect(nav).toHaveCSS('left', '12px');
    await expect(page.locator('.library-header-actions')).toHaveCSS('border-radius', '999px');
    // Nothing scrolls under the desktop chrome: tint and rim, no live blur.
    await expect(nav).toHaveCSS('backdrop-filter', 'none');
    // The page itself stays opaque (cheap scrolling); the light is on top of it.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.reader')).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.article.is-library'), '::before').backgroundImage)).toContain('radial-gradient');

    await page.evaluate(() => setLiquidGlass(false));
    await expect(nav).toHaveCSS('border-radius', '0px');
    await expect(nav).toHaveCSS('left', '0px');
    await expect(page.locator('.library-header-actions')).toHaveCSS('border-radius', '0px');
  });

  test('G2 phones: a floating tab bar the shelf scrolls under; the choose bar sits above it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
    });
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await setSettings(page, { theme: 'light', liquidGlass: true, glassAmbient: 'cover' });
    const bookId = await page.evaluate(async () => {
      const library = await window.browserHost.getLibrary();
      const epub = library.books.find((book) => book.title === 'E2E EPUB');
      await fetch(`/app/zhenshu/api/books/${epub.id}/highlights`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ highlights: [{ id: 'g2', locator: JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: 5 }), chapterHref: 'OEBPS/chapter1.xhtml', text: '玻璃下的一句话。', color: 'yellow', createdAt: new Date().toISOString() }] })
      });
      return epub.id;
    });
    await page.goto(APP_PATH);
    const nav = page.locator('#shelfNav');
    await expect(nav).toHaveCSS('border-radius', '31px');
    const navBox = await nav.boundingBox();
    expect(navBox.x).toBeGreaterThanOrEqual(16);
    expect(844 - (navBox.y + navBox.height)).toBeGreaterThanOrEqual(12);
    // The shelf runs to the bottom edge, under the bar.
    const reader = await page.locator('.reader').boundingBox();
    expect(reader.y + reader.height).toBeGreaterThan(navBox.y + navBox.height);

    await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
    await page.locator('.notes-long-image').click();
    const bar = await page.locator('.notes-select-bar').boundingBox();
    const tabs = await nav.boundingBox();
    expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y);
  });

  test('G3 reader: glass rail and selection menu; the text is untouched; off restores', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await setSettings(page, { theme: 'light', liquidGlass: true });
    await openEpubFixture(page);
    if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
    const rail = page.locator('#readerFloatingToolbar');
    await expect(rail).toHaveCSS('border-radius', '20px');
    // Text scrolls past the rail: no live blur there.
    await expect(rail).toHaveCSS('backdrop-filter', 'none');
    const paper = await page.locator('#article').evaluate((article) => getComputedStyle(article).backgroundColor);
    const target = await page.evaluate(() => document.querySelector('#article .epub-chapter p').textContent.trim().slice(2, 12));
    expect(await selectArticleText(page, target)).toBe(true);
    const menu = page.locator('.selection-menu:not(.annotation-menu)');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('backdrop-filter', /blur\(20px\)/);
    await page.evaluate(() => setLiquidGlass(false));
    await expect(menu).toHaveCSS('backdrop-filter', 'none');
    await expect(rail).not.toHaveCSS('border-radius', '20px');
    // The page itself never changed.
    expect(await page.locator('#article').evaluate((article) => getComputedStyle(article).backgroundColor)).toBe(paper);
  });

  test('G3 phones: the reading tools float as a glass card', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
    });
    await page.goto(APP_PATH);
    await resetEpubFixtureState(page);
    await setSettings(page, { theme: 'dark', liquidGlass: true });
    await openEpubFixture(page);
    await page.evaluate(() => setMobileChromeOpen(true));
    const tools = page.locator('#mobileReaderToolbar');
    await expect(tools).toBeVisible();
    await expect(tools).toHaveCSS('border-radius', '24px');
    const box = await tools.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(12);
    expect(844 - (box.y + box.height)).toBeGreaterThanOrEqual(12);
  });
});

