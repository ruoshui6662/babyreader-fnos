'use strict';

const { test, expect } = require('@playwright/test');

test('oversized EPUB resources do not block the first page in double-page mode', async ({ page }) => {
  await page.goto('/app/zhenshu/');
  await expect(page.locator('.library-view h1')).toHaveText('书库');

  await page.locator('.library-book').filter({ hasText: 'E2E Stress EPUB' }).click();
  await expect(page.locator('#article')).toContainText('Stress fixture');
  await expect(page.locator('#article')).toHaveAttribute('data-epub-skipped-resource-count', '1');

  await page.locator('#btnSettings').click();
  await page.locator('#settingReadingMode').selectOption('double');
  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#article')).toHaveAttribute('data-pagination-geometry', /mode=double/);

  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
});

test('reused EPUB images survive many chapter references and are revoked when the book closes', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__epubUrlTracker = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__epubUrlTracker.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__epubUrlTracker.revoked.push(url);
      return revoke(url);
    };
  });
  await page.goto('/app/zhenshu/');
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await page.locator('.library-book').filter({ hasText: 'E2E Repeated Image EPUB' }).click();

  const image = page.locator('#article img[alt="Repeated shared image"]');
  await expect(page.locator('#article')).toContainText('Repeated image chapter 1');
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth === 1)).toBe(true);
  const firstUrl = await image.getAttribute('src');
  expect(firstUrl).toMatch(/^blob:/);

  for (let chapterIndex = 1; chapterIndex < 8; chapterIndex += 1) {
    const rendered = await page.evaluate((index) => window.renderEpubChapter(index), chapterIndex);
    expect(rendered).toBe(true);
    await expect(page.locator('#article')).toContainText(`Repeated image chapter ${chapterIndex + 1}`);
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth === 1)).toBe(true);
    expect(await image.getAttribute('src')).toBe(firstUrl);
  }

  await expect(page.locator('#article')).toHaveAttribute('data-epub-skipped-resource-count', '0');
  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const urls = await page.evaluate(() => window.__epubUrlTracker);
  expect(urls.created).toHaveLength(1);
  expect(urls.revoked).toEqual(urls.created);
  expect(pageErrors).toEqual([]);
});
