'use strict';

// R5: 字重 of the body text; 更多… hands a selection to the Android client.
const { test, expect } = require('@playwright/test');
const { openEpubFixture, resetReaderSettings, openMobileSettingsSheet } = require('./helpers/reader');

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openOnPhone(page, { client = false } = {}) {
  await page.addInitScript((client) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
    if (client) {
      window.__processed = [];
      window.ZhenshuNative = { setScreen() {}, server: () => 'nas', processText: (text) => window.__processed.push(text) };
    }
  }, client);
  await page.goto('/app/zhenshu/');
  await resetReaderSettings(page);
  await page.evaluate(() => fetch('/app/zhenshu/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fontWeight: 400 }) }));
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
}

const bodyWeight = (page) => page.evaluate(() => getComputedStyle(document.querySelector('#article .epub-chapter p')).fontWeight);

test('字重 sets the weight of the body text and is kept; headings keep theirs', async ({ page }) => {
  await openOnPhone(page);
  expect(await bodyWeight(page)).toBe('400');
  const headingBefore = await page.evaluate(() => getComputedStyle(document.querySelector('#article .epub-chapter h1, #article .epub-chapter h2')).fontWeight);
  await openMobileSettingsSheet(page);
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT'
    && JSON.parse(r.request().postData() || '{}').fontWeight === 500);
  await page.locator('#settingFontWeight [data-font-weight="500"]').click();
  await saved;
  expect(await bodyWeight(page)).toBe('500');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#article .epub-chapter h1, #article .epub-chapter h2')).fontWeight)).toBe(headingBefore);
  await page.reload();
  await openEpubFixture(page);
  expect(await bodyWeight(page)).toBe('500');
});

async function selectSomeText(page) {
  await page.evaluate(() => {
    const paragraph = document.querySelector('#article .epub-chapter p');
    const text = paragraph.firstChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 8);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.locator('#selectionMenu')).toBeVisible();
}

test('更多… shows only in the client and hands the selected text to it', async ({ page }) => {
  await openOnPhone(page, { client: true });
  await selectSomeText(page);
  const more = page.locator('#selectionMenu [data-selection-action="more"]');
  await expect(more).toBeVisible();
  const selected = await page.evaluate(() => String(getSelection()));
  await more.click();
  expect(await page.evaluate(() => window.__processed)).toEqual([selected]);
});

test('in a browser there is no 更多…', async ({ page }) => {
  await openOnPhone(page);
  await selectSomeText(page);
  await expect(page.locator('#selectionMenu [data-selection-action="more"]')).toBeHidden();
});
