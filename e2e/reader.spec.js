'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/babyreader-fnos/';

async function openFixtureBook(page) {
  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const book = page.locator('.library-book').filter({ hasText: 'E2E Markdown' });
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.locator('#fileName')).toHaveText('E2E Markdown');
  await expect(page.locator('#article')).toContainText('E2E Reader');
}

async function openEpubFixture(page) {
  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const book = page.locator('.library-book').filter({ hasText: 'E2E EPUB' });
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.locator('#fileName')).toHaveText('E2E EPUB');
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter');
}

test('loads split UI modules in Chromium and opens a real library book', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openFixtureBook(page);

  const loadedScripts = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.endsWith('.js'))
  );

  for (const modulePath of [
    '/app/babyreader-fnos/core/state.js',
    '/app/babyreader-fnos/core/utils.js',
    '/app/babyreader-fnos/core/api.js',
    '/app/babyreader-fnos/core/user-state.js',
    '/app/babyreader-fnos/reader/epub.js',
    '/app/babyreader-fnos/reader/document.js',
    '/app/babyreader-fnos/reader/editor.js',
    '/app/babyreader-fnos/reader/highlights.js',
    '/app/babyreader-fnos/reader/actions.js',
    '/app/babyreader-fnos/reader/progress.js',
    '/app/babyreader-fnos/reader/pagination.js',
    '/app/babyreader-fnos/reader/settings.js',
    '/app/babyreader-fnos/reader/navigation.js',
    '/app/babyreader-fnos/reader/lifecycle.js',
    '/app/babyreader-fnos/shell/drawer.js',
    '/app/babyreader-fnos/library/view.js',
    '/app/babyreader-fnos/app.js'
  ]) {
    expect(loadedScripts).toContain(modulePath);
  }

  expect(pageErrors).toEqual([]);
});

test('settings drawer changes theme and typography in a real browser', async ({ page }) => {
  await openFixtureBook(page);

  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerDrawer')).toBeVisible();
  await expect(page.locator('#settingsUser')).toContainText('Playwright User');

  await page.locator('#settingTheme').selectOption('sepia');
  await expect(page.locator('body')).toHaveClass(/theme-sepia/);

  await page.locator('#settingFontFamily').selectOption('songti');
  const settingsSaved = page.waitForResponse((response) =>
    response.url().endsWith('/api/settings')
      && response.request().method() === 'PUT'
      && response.ok()
  );
  await page.locator('#settingTextIndent').evaluate((element) => {
    element.value = '1.5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settingsSaved;

  await expect(page.locator('html')).toHaveCSS(
    '--reader-font-family',
    /SimSun|STSong|Songti SC|宋体|serif/
  );
  await expect(page.locator('html')).toHaveCSS('--reader-text-indent', '1.5em');

  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#readerDrawer')).toBeHidden();

  await page.reload();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
  await page.locator('#btnSettings').click();
  await expect(page.locator('#settingTheme')).toHaveValue('sepia');
  await expect(page.locator('#settingFontFamily')).toHaveValue('songti');
  await expect(page.locator('#settingTextIndent')).toHaveValue('1.5');
  await expect(page.locator('body')).toHaveClass(/theme-sepia/);
});

test('EPUB TOC navigates between chapters and updates semantic reading state', async ({ page }) => {
  await openEpubFixture(page);

  await page.locator('#btnToc').click();
  await expect(page.locator('#readerDrawer')).toBeVisible();
  const tocLinks = page.locator('#tocList a[data-target]');
  await expect(tocLinks).toHaveCount(2);
  await expect(tocLinks.nth(1)).toHaveText('第二章');

  await tocLinks.nth(1).click();
  await expect(tocLinks.nth(1)).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#readingProgress')).toContainText('2/2');
});

test('reader shell has unique IDs, reserved actions disabled, and restores Drawer focus', async ({ page }) => {
  await openFixtureBook(page);

  const duplicateIds = await page.evaluate(() => {
    const counts = new Map();
    for (const element of document.querySelectorAll('[id]')) {
      counts.set(element.id, (counts.get(element.id) || 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1);
  });
  expect(duplicateIds).toEqual([]);

  for (const selector of ['#btnSearch', '#btnBookmarks', '#btnNotes', '#btnAi']) {
    await expect(page.locator(selector)).toBeDisabled();
  }

  const settingsButton = page.locator('#btnSettings');
  await settingsButton.focus();
  await settingsButton.click();
  await expect(page.locator('#readerDrawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#readerDrawer')).toBeHidden();
  await expect(settingsButton).toBeFocused();
});

test('mobile viewport exposes the mobile reader toolbar without script errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });

  await openEpubFixture(page);

  await expect(page.locator('#mobileReaderToolbar')).toBeVisible();
  await page.locator('#btnMobileSettings').click();
  await expect(page.locator('#readerDrawer')).toBeVisible();
  await expect(page.locator('#settingReadingMode')).toHaveValue('scroll');
  expect(pageErrors).toEqual([]);
});
