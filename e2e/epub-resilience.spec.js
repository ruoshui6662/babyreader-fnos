'use strict';

const { test, expect } = require('@playwright/test');

test('oversized EPUB resources do not block the first page in double-page mode', async ({ page }) => {
  await page.goto('/app/babyreader-fnos/');
  await expect(page.locator('.library-view h1')).toHaveText('书库');

  await page.locator('.library-book').filter({ hasText: 'E2E Stress EPUB' }).click();
  await expect(page.locator('#article')).toContainText('Stress fixture');
  await expect(page.locator('#article')).toHaveAttribute('data-epub-skipped-resource-count', '1');

  await page.locator('#btnSettings').click();
  await page.locator('#settingReadingMode').selectOption('double');
  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#article')).toHaveAttribute('data-pagination-geometry', /mode=double/);

  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerDrawer')).toBeVisible();
});
