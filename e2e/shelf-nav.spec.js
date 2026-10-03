'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';
const heading = (page) => page.locator('.library-view h1');

test.describe('Shelf navigation', () => {
  test('desktop rail switches 书库 / 阅读统计 / 笔记 with the URL, refresh and back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(APP_PATH);
    await expect(heading(page)).toHaveText('书库');
    const nav = page.locator('#shelfNav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('.shelf-nav-button')).toHaveText(['书库', '阅读统计', '笔记']);
    await expect(nav.locator('[data-shelf-view="library"]')).toHaveAttribute('aria-current', 'page');
    const rail = await nav.boundingBox();
    expect(rail.x).toBe(0);
    expect(rail.width).toBe(200);
    // The shelf content starts to the right of the rail.
    const reader = await page.locator('#reader').boundingBox();
    expect(reader.x).toBe(200);

    await nav.locator('[data-shelf-view="stats"]').click();
    await expect(heading(page)).toHaveText('阅读统计');
    await expect(page).toHaveURL(/\?view=stats$/);
    await nav.locator('[data-shelf-view="notes"]').click();
    await expect(heading(page)).toHaveText('笔记');
    await expect(page).toHaveURL(/\?view=notes$/);

    await page.reload();
    await expect(heading(page)).toHaveText('笔记');
    await expect(nav.locator('[data-shelf-view="notes"]')).toHaveAttribute('aria-current', 'page');

    await page.goBack();
    await expect(heading(page)).toHaveText('阅读统计');
    await page.goBack();
    await expect(heading(page)).toHaveText('书库');
    await expect(page).not.toHaveURL(/view=/);
  });

  test('narrow desktop windows show an icon-only rail', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto(APP_PATH);
    await expect(heading(page)).toHaveText('书库');
    expect((await page.locator('#shelfNav').boundingBox()).width).toBe(72);
    await expect(page.locator('#shelfNav .shelf-nav-label').first()).toBeHidden();
  });

  test('the navigation is hidden while reading, and returning lands on the page the book was opened from', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(APP_PATH);
    await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
    await expect(page.locator('#article')).toContainText('E2E Reader');
    await expect(page.locator('#shelfNav')).toBeHidden();
    await page.locator('#btnBackToLibrary').click();
    await expect(heading(page)).toHaveText('书库');
    await expect(page.locator('#shelfNav')).toBeVisible();

    // A book opened while 阅读统计 is in the URL returns there.
    await page.goto(`${APP_PATH}?view=stats`);
    await expect(heading(page)).toHaveText('阅读统计');
    const bookId = await page.evaluate(async () => (await window.browserHost.getLibrary()).books.find((book) => book.title === 'E2E Markdown').id);
    await page.goto(`${APP_PATH}?view=stats&book=${bookId}`);
    await expect(page.locator('#article')).toContainText('E2E Reader');
    await page.locator('#btnBackToLibrary').click();
    await expect(heading(page)).toHaveText('阅读统计');
  });

  test('phones get a bottom tab bar that leaves the shelf room above it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    await page.goto(APP_PATH);
    await expect(heading(page)).toHaveText('书库');
    const bar = await page.locator('#shelfNav').boundingBox();
    expect(Math.round(bar.y + bar.height)).toBe(844);
    expect(Math.round(bar.width)).toBe(390);
    const reader = await page.locator('#reader').boundingBox();
    expect(Math.round(reader.y + reader.height)).toBeLessThanOrEqual(Math.round(bar.y) + 1);
    await page.locator('#shelfNav [data-shelf-view="stats"]').click();
    await expect(heading(page)).toHaveText('阅读统计');
    await page.goBack();
    await expect(heading(page)).toHaveText('书库');
  });
});
