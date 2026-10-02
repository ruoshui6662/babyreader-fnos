'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureBookmarks,
  resetEpubFixtureState,
  resetReaderSettings,
  waitForBookmarkRequest,
  waitForSettingsSave,
  showMobileReaderChrome
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

async function closeDefaultDrawer(page) {
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }
  await expect(page.locator('#readerDrawer')).toBeHidden();
}

async function openBookmarkPanel(page) {
  await page.evaluate(() => openReaderPanel('bookmarks', document.getElementById('btnBookmarks')));
  await expect(page.locator('#readerPanelBookmarks')).toBeVisible();
  await expect(page.locator('#bookmarkPanelStatus')).toBeHidden();
}

async function navigateToChapter(page, chapterIndex) {
  await page.locator('#btnToc').click();
  const tocLinks = page.locator('#tocList a[data-target]');
  await expect(tocLinks).toHaveCount(3);
  await tocLinks.nth(chapterIndex).click();
  await expect(page.locator('#article .epub-chapter')).toHaveAttribute(
    'data-source-path',
    new RegExp(`chapter${chapterIndex + 1}\\.xhtml`)
  );
  await closeDefaultDrawer(page);
}

test.describe('EPUB bookmarks', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(APP_PATH);
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await resetEpubFixtureBookmarks(page);
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await closeDefaultDrawer(page);
  });

  test('creates, refreshes, and deletes a bookmark from the Drawer', async ({ page }) => {
    const create = waitForBookmarkRequest(page, 'POST');
    await expect(page.locator('#btnBookmarks')).toBeEnabled();
    await page.locator('#btnBookmarks').click();
    await create;
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');

    await openBookmarkPanel(page);
    await expect(page.locator('.bookmark-row')).toHaveCount(1);
    await expect(page.locator('.bookmark-row-main')).toContainText('E2E EPUB Chapter 1');

    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await closeDefaultDrawer(page);
    const refresh = waitForBookmarkRequest(page, 'GET');
    await openBookmarkPanel(page);
    await refresh;
    await expect(page.locator('.bookmark-row')).toHaveCount(1);

    const remove = waitForBookmarkRequest(page, 'DELETE');
    await page.locator('.bookmark-row-delete').click();
    await remove;
    await expect(page.locator('.bookmark-row')).toHaveCount(0);
    await expect(page.locator('#bookmarkEmptyState')).toBeVisible();
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'false');
  });

  test('repeated toolbar activation removes the same bookmark instead of duplicating it', async ({ page }) => {
    const create = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await create;

    const remove = waitForBookmarkRequest(page, 'DELETE');
    await page.locator('#btnBookmarks').click();
    await remove;

    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'false');
    await openBookmarkPanel(page);
    await expect(page.locator('.bookmark-row')).toHaveCount(0);
  });

  test('deleting one bookmark keeps another bookmark and the current active state', async ({ page }) => {
    const firstCreate = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await firstCreate;
    await navigateToChapter(page, 1);

    const secondCreate = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await secondCreate;
    await openBookmarkPanel(page);
    await expect(page.locator('.bookmark-row')).toHaveCount(2);

    const remove = waitForBookmarkRequest(page, 'DELETE');
    await page.locator('.bookmark-row').first().locator('.bookmark-row-delete').click();
    await remove;
    await expect(page.locator('.bookmark-row')).toHaveCount(1);
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');
  });

  test('bookmark list jumps back to another chapter and closes the Drawer', async ({ page }) => {
    const create = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await create;
    await navigateToChapter(page, 1);
    await openBookmarkPanel(page);

    await page.locator('.bookmark-row-main').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
    await expect(page.locator('#article .epub-chapter')).toHaveAttribute(
      'data-source-path',
      /chapter1\.xhtml/
    );
  });

  test('bookmark controls remain usable in scroll and double-page reading modes', async ({ page }) => {
    await expect(page.locator('body')).toHaveClass(/continuous-scroll/);
    await expect(page.locator('#btnBookmarks')).toBeEnabled();
    await expect(page.locator('#btnBookmarks')).toHaveCSS('width', '44px');
    // Captioned rail buttons (2026-10, option 3) are 52px tall.
    await expect(page.locator('#btnBookmarks')).toHaveCSS('height', '52px');

    await page.locator('#btnSettings').click();
    const save = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await save;
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('body')).toHaveClass(/double-page-reading/);

    const create = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await create;
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');

    await openBookmarkPanel(page);
    await expect(page.locator('.bookmark-row')).toHaveCount(1);

    await page.locator('#btnCloseSettings').click();
    await page.setViewportSize({ width: 820, height: 800 });
    await expect(page.locator('body')).toHaveClass(/single-page-reading/);
  });

  test('refreshes the bookmark state after a page turn and allows a new page bookmark', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = waitForSettingsSave(page);
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('body')).toHaveClass(/double-page-reading/);
    await expect(page.locator('#btnNextPage')).toBeEnabled();

    const firstCreate = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await firstCreate;
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#btnNextPage').click();
    await expect.poll(() => page.evaluate(() => state.pageGroup)).toBe(1);
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-label', '添加当前书签');

    const secondCreate = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await secondCreate;
    await expect(page.locator('#btnBookmarks')).toHaveAttribute('aria-pressed', 'true');

    await openBookmarkPanel(page);
    await expect(page.locator('.bookmark-row')).toHaveCount(2);
  });

  test('Drawer supports keyboard focus recovery and Tab traversal', async ({ page }) => {
    const create = waitForBookmarkRequest(page, 'POST');
    await page.locator('#btnBookmarks').click();
    await create;

    const settings = page.locator('#btnSettings');
    await settings.focus();
    await settings.press('Enter');
    await expect(page.locator('#readerSettingsSheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#readerSettingsSheet')).toBeHidden();
    await expect(settings).toBeFocused();

    await openBookmarkPanel(page);
    await page.locator('#drawerTabBookmarks').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.bookmark-row-main').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#readerDrawer')).toBeHidden();
  });
});

test.describe('Mobile EPUB bookmarks', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    await page.goto(APP_PATH);
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await resetEpubFixtureBookmarks(page);
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await closeDefaultDrawer(page);
  });

  test('mobile entry opens the bookmark Drawer and keeps a 44px touch target', async ({ page }) => {
    await expect(page.locator('#mobileReaderToolbar')).toBeHidden();
    await showMobileReaderChrome(page);
    // The top bar marks the page; the list lives in the ⋯ menu.
    const topBookmark = page.locator('#btnMobileTopBookmark');
    await expect(topBookmark).toBeVisible();
    await expect(topBookmark).toBeEnabled();
    await page.locator('#btnMobileMore').click();
    const mobileBookmarks = page.locator('#mobileMoreMenu [data-reader-action="openBookmarks"]');
    await expect(mobileBookmarks).toBeVisible();
    await expect(mobileBookmarks).toBeEnabled();
    for (const target of [topBookmark, mobileBookmarks]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await mobileBookmarks.click();
    await expect(page.locator('#readerDrawer')).toBeVisible();
    await expect(page.locator('#readerPanelBookmarks')).toBeVisible();
    await expect(page.locator('#drawerTabBookmarks')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#bookmarkEmptyState')).toBeVisible();
  });
});
