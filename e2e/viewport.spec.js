'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  waitForSettingsSave
} = require('./helpers/reader');

test.describe('Viewport transition persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/app/zhenshu/');
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await openEpubFixture(page);
  });

  test('reflows pagination when the reader container changes without window.resize', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();

    const before = await page.locator('#article').getAttribute('data-pagination-geometry');
    expect(before).toContain('mode=double');

    await page.evaluate(() => {
      const reader = document.querySelector('#reader');
      reader.style.width = '820px';
      reader.style.maxWidth = '820px';
      reader.style.marginInline = 'auto';
    });

    await expect.poll(() => page.locator('#article').getAttribute('data-pagination-geometry'))
      .not.toBe(before);
  });

  test('next-page control advances through every available spread', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#article')).toHaveAttribute('data-pagination-track', /groups=/);

    const groups = await page.locator('#article').getAttribute('data-pagination-track');
    const groupCount = Number(groups.match(/groups=(\d+)/)?.[1] || 0);
    expect(groupCount).toBeGreaterThan(2);

    for (let group = 1; group < groupCount; group += 1) {
      const before = await page.locator('#article').evaluate((element) => element.scrollLeft);
      await expect(page.locator('#btnNextPage')).toBeEnabled();
      await page.locator('#btnNextPage').click();
      await expect.poll(() => page.locator('#article').evaluate((element) => element.scrollLeft))
        .not.toBe(before);
    }

    const chapterBeforeBoundary = await page.locator('#article .epub-chapter').getAttribute('data-source-path');
    await expect(page.locator('#btnNextPage')).toBeEnabled();
    await page.locator('#btnNextPage').click();
    await expect.poll(() => page.locator('#article .epub-chapter').getAttribute('data-source-path'))
      .not.toBe(chapterBeforeBoundary);
  });
});
