'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  saveEpubFixtureProgress,
  resetReaderSettings,
  waitForSettingsSave,
  waitForProgressSave
} = require('./helpers/reader');

test.describe('Reading progress persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/app/babyreader-fnos/');
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await openEpubFixture(page);
  });

  test('restores chapter, double-page spread, and reading mode after reload and reopen', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();

    await expect(page.locator('#article')).toHaveAttribute(
      'data-pagination-track',
      /groups=([2-9]|[1-9][0-9]+)/
    );
    await expect(page.locator('#paginationStatus')).toBeVisible();

    await page.locator('#btnToc').click();
    const tocLinks = page.locator('#tocList a[data-target]');
    await expect(tocLinks).toHaveCount(3);
    const chapterSave = waitForProgressSave(page, (request) => {
      try {
        return String(JSON.parse(request.postData() || '{}').locator || '').includes('chapter2.xhtml');
      } catch {
        return false;
      }
    });
    await tocLinks.nth(1).click();
    await chapterSave;
    await expect(tocLinks.nth(1)).toHaveAttribute('aria-current', 'location');
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readingProgress')).toContainText('2/3');

    const pageSave = waitForProgressSave(page);
    await page.locator('#btnNextPage').click();
    await pageSave;

    const expected = {
      progress: await page.locator('#readingProgress').textContent(),
      spread: await page.locator('#paginationStatus').textContent(),
      scrollLeft: await page.locator('#article').evaluate((element) => element.scrollLeft)
    };
    expect(expected.scrollLeft).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await expect(page.locator('#readingProgress')).toHaveText(expected.progress);
    await expect(page.locator('#paginationStatus')).toHaveText(expected.spread);
    await expect(page.locator('#article')).toHaveAttribute('data-pagination-track', /groups=/);
    await expect.poll(() => page.locator('#article').evaluate((element) => element.scrollLeft))
      .toBe(expected.scrollLeft);

    await page.locator('#btnSettings').click();
    await expect(page.locator('#settingReadingMode')).toHaveValue('double');
    await page.locator('#btnCloseSettings').click();

    await page.locator('#btnBackToLibrary').click();
    await expect(page.locator('.library-view h1')).toHaveText('书库');
    await openEpubFixture(page);
    await expect(page.locator('#readingProgress')).toHaveText(expected.progress);
    await expect(page.locator('#paginationStatus')).toHaveText(expected.spread);
  });

  test('restores a saved later-chapter href before applying its saved page', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();

    await saveEpubFixtureProgress(page, {
      version: 2,
      type: 'semantic-position',
      href: 'OEBPS/chapter2.xhtml',
      anchor: '',
      textBefore: '',
      pageNumber: 3,
      scrollTop: 0,
      percentage: 0.5
    });

    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
    await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', 'OEBPS/chapter2.xhtml');
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    await expect(page.locator('#article')).not.toContainText('E2E EPUB Chapter 1');
    await expect(page.locator('#readingProgress')).toContainText('2/3');
    await expect.poll(() => page.locator('#article').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  });

  test('restores a saved continuous-scroll chapter and chapter-local position', async ({ page }) => {
    await saveEpubFixtureProgress(page, {
      version: 2,
      type: 'semantic-position',
      readingScope: 'chapter',
      href: 'OEBPS/chapter2.xhtml',
      anchor: '',
      textBefore: '',
      pageNumber: null,
      scrollTop: 0,
      chapterPercentage: 0.35,
      percentage: 0.45
    });

    await page.reload({ waitUntil: 'load' });
    await page.goto('/app/babyreader-fnos/');
    await expect(page.locator('.library-view h1')).toHaveText('书库');
    await page.locator('.library-book').filter({ hasText: 'E2E EPUB' }).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    if (await page.locator('#readerDrawer').isVisible()) {
      await page.locator('#btnCloseSettings').click();
    }
    await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
    await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', 'OEBPS/chapter2.xhtml');
    await expect(page.locator('#readingProgress')).toContainText('2/3');
    await expect.poll(() => page.locator('#reader').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test('falls back to chapter 1 page 1 when a saved chapter href is missing', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();

    await saveEpubFixtureProgress(page, {
      version: 2,
      type: 'semantic-position',
      href: 'missing.xhtml',
      anchor: '',
      textBefore: '',
      pageNumber: 3,
      scrollTop: 0,
      percentage: 0.75
    });

    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
    await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', 'OEBPS/chapter1.xhtml');
    await expect(page.locator('#readingProgress')).toContainText('1/3');
    await expect(page.locator('#article')).not.toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => page.locator('#article').evaluate((element) => element.scrollLeft)).toBe(0);
  });
});
