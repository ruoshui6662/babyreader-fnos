'use strict';

// Display settings and bundled fonts (2026-10 commercial-grade UX plan,
// phase 2): visual controls drive the existing settings, and every bundled
// font ships with its OFL license.

const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState, resetReaderSettings } = require('./helpers/reader');

const APP_PATH = '/app/babyreader-fnos/';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await putSettings(page, { tocAutoOpen: false });
});

async function putSettings(page, settings) {
  await page.evaluate(async (body) => {
    const response = await fetch('/app/babyreader-fnos/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Settings setup failed: ${response.status}`);
  }, settings);
}

async function openEpubWithSettings(page) {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'E2E EPUB' }).first().click();
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter');
  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
}

test('every bundled font ships with its SIL OFL license', async ({ page }) => {
  for (const folder of ['noto-serif-sc', 'lxgw-wenkai', 'zhuque-fangsong', 'literata']) {
    const license = await page.request.get(`${APP_PATH}vendor/fonts/${folder}/LICENSE`);
    expect(license.ok(), folder).toBeTruthy();
    expect(await license.text(), folder).toContain('SIL Open Font License');
    const css = await page.request.get(`${APP_PATH}vendor/fonts/${folder}/font.css`);
    expect(css.ok(), folder).toBeTruthy();
    expect(await css.text(), folder).toContain('unicode-range');
  }
});

test('思源宋体 renders from the bundled files, and a font card switches and persists the face', async ({ page }) => {
  await putSettings(page, { readerFont: 'source-serif' });
  await openEpubWithSettings(page);
  await expect(page.locator('[data-font-choice="source-serif"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'Noto Serif SC' && face.status === 'loaded');
  })).toBe(true);

  const save = page.waitForResponse((response) => response.url().endsWith('/api/settings')
    && response.request().method() === 'PUT' && response.ok());
  await page.locator('[data-font-choice="wenkai"]').click();
  await save;
  await expect(page.locator('#article p').first()).toHaveCSS('font-family', /^"LXGW WenKai"/);

  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#article p').first()).toHaveCSS('font-family', /^"LXGW WenKai"/);
});

test('A− / A+ step through the size stops and stop at the ends', async ({ page }) => {
  await openEpubWithSettings(page);
  const label = page.locator('#settingFontSizeLabel');
  await expect(label).toHaveText('18px');
  await page.locator('#btnFontLarger').click();
  await expect(label).toHaveText('20px');
  await page.locator('#btnFontSmaller').click();
  await page.locator('#btnFontSmaller').click();
  await expect(label).toHaveText('15px');
  await expect(page.locator('#btnFontSmaller')).toBeDisabled();
});

test('layout presets and theme swatches apply and persist', async ({ page }) => {
  await openEpubWithSettings(page);
  await expect(page.locator('[data-layout-preset="standard"]')).toHaveAttribute('aria-pressed', 'true');

  const save = page.waitForResponse((response) => response.url().endsWith('/api/settings')
    && response.request().method() === 'PUT' && response.ok());
  await page.locator('[data-layout-preset="loose"]').click();
  await save;
  await expect(page.locator('[data-layout-preset="loose"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveCSS('--reader-line-height', '2.2');

  const themeSave = page.waitForResponse((response) => response.url().endsWith('/api/settings')
    && response.request().method() === 'PUT' && response.ok()
    && JSON.parse(response.request().postData() || '{}').theme === 'sepia');
  await page.locator('[data-theme-choice="sepia"]').click();
  await themeSave;
  await expect(page.locator('body')).toHaveClass(/theme-sepia/);
  await expect(page.locator('[data-theme-choice="sepia"]')).toHaveAttribute('aria-pressed', 'true');

  // The URL keeps ?book=, so a reload reopens the book directly.
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter');
  await page.locator('#btnSettings').click();
  await expect(page.locator('[data-layout-preset="loose"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-theme-choice="sepia"]')).toHaveAttribute('aria-pressed', 'true');
});
