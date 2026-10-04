'use strict';

// 页眉页脚 (phones): the page's own status lines, set in 设置 › 更多设置.
const { test, expect } = require('@playwright/test');
const { openEpubFixture, resetReaderSettings, openMobileSettingsSheet } = require('./helpers/reader');

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openOnPhone(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
  });
  await page.goto('/app/zhenshu/');
  await resetReaderSettings(page);
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
}

const tips = (page) => page.evaluate(() => ({
  header: [...document.querySelectorAll('#mobileReadingHeader [data-tip-slot]')].map((slot) => slot.dataset.tip),
  footer: [...document.querySelectorAll('#mobileReadingFooter [data-tip-slot]')].map((slot) => slot.dataset.tip)
}));

test('the default 页眉页脚 shows time and chapter on top, page and progress below', async ({ page }) => {
  await openOnPhone(page);
  const header = page.locator('#mobileReadingHeader');
  await expect(header).toBeVisible();
  expect(await tips(page)).toEqual({ header: ['time', 'none', 'chapter'], footer: ['page', 'none', 'progress'] });
  await expect(header.locator('[data-tip="time"]')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(header.locator('[data-tip="chapter"]')).not.toHaveText('');
  await expect(page.locator('#mobileReadingFooter [data-tip="page"]')).toHaveText(/^\d+\/\d+$/);
  await expect(page.locator('#mobileReadingFooter [data-tip="progress"]')).toHaveText(/^\d+%$/);
  // The text starts below the header band.
  const top = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('reader')).top));
  expect(top).toBeGreaterThanOrEqual(26);
});

test('极简 drops the header; 自定义 sets each place and is kept', async ({ page }) => {
  await openOnPhone(page);
  await openMobileSettingsSheet(page);
  const group = page.locator('#settingsTipsGroup');
  await expect(group).toBeVisible();
  await group.locator('[data-tips-preset="minimal"]').click();
  await expect(page.locator('#settingReaderTipsHint')).toHaveText('页眉：不显示；页脚：进度');
  await page.goBack();
  await expect(page.locator('#mobileReadingHeader')).toBeHidden();
  expect((await tips(page)).footer).toEqual(['none', 'none', 'progress']);

  await openMobileSettingsSheet(page);
  await group.locator('[data-tips-preset="custom"]').click();
  const custom = page.locator('#settingReaderTipsCustom');
  await expect(custom).toBeVisible();
  // In a browser there is no battery to show.
  await expect(custom.locator('[data-tip-item="battery"]')).toHaveCount(0);
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT'
    && JSON.parse(r.request().postData() || '{}').readerTips?.header?.[1] === 'book');
  await custom.locator('[aria-label="页眉中"] [data-tip-item="book"]').click();
  expect(JSON.parse((await saved).request().postData()).readerTips)
    .toEqual({ preset: 'custom', header: ['none', 'book', 'none'], footer: ['none', 'none', 'progress'] });

  await page.reload();
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  expect(await tips(page)).toEqual({ header: ['none', 'book', 'none'], footer: ['none', 'none', 'progress'] });
  await expect(page.locator('#mobileReadingHeader [data-tip="book"]')).toHaveText('E2E EPUB');
});
