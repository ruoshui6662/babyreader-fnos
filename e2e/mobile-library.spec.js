'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

test.describe('Phone library', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    await page.goto(APP_PATH);
    await expect(page.locator('.library-view h1')).toHaveText('书库');
    await expect(page.locator('html')).toHaveAttribute('data-reader-surface', 'mobile');
  });

  test('header actions sit behind ⋯ and run the real buttons', async ({ page }) => {
    await expect(page.locator('.library-scan-button')).toBeHidden();
    const more = page.locator('.library-more-button');
    await expect(more).toBeVisible();
    const box = await more.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    await more.click();
    const menu = page.locator('.library-more-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '重新扫描' })).toBeVisible();
    // Picking an item runs the real (hidden) header button.
    const scan = page.waitForRequest((request) => request.method() === 'POST' && /scan/.test(request.url()));
    await menu.getByRole('menuitem', { name: '重新扫描' }).click();
    await scan;
    await expect(menu).toBeHidden();
    await expect(page.locator('.library-view h1')).toHaveText('书库');
  });

  test('a long press on a book opens its sheet instead of the book', async ({ page }) => {
    const book = page.locator('.library-book').filter({ hasText: 'E2E EPUB' }).first();
    await book.evaluate(async (element) => {
      const rect = element.getBoundingClientRect();
      const init = { bubbles: true, pointerType: 'touch', clientX: rect.x + 20, clientY: rect.y + 20 };
      element.dispatchEvent(new PointerEvent('pointerdown', init));
      await new Promise((resolve) => setTimeout(resolve, 650));
      element.dispatchEvent(new PointerEvent('pointerup', init));
      element.click();
    });
    const sheet = page.locator('.library-book-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/is-library/);
    // Without library organization: no rename or categories.
    await expect(sheet.locator('.library-book-sheet-action')).toHaveText(['打开', '书籍信息', '取消']);

    await sheet.getByRole('button', { name: '书籍信息' }).click();
    await expect(sheet.locator('.library-book-info')).toContainText('EPUB');
    await expect(sheet.locator('.library-book-info')).toContainText('Playwright');
    await sheet.getByRole('button', { name: '返回' }).click();

    await sheet.getByRole('button', { name: '取消' }).click();
    await expect(sheet).toHaveCount(0);

    // A short tap still opens the book.
    await book.click();
    await expect(page.locator('#fileName')).toHaveText('E2E EPUB');
  });

  test('the sheet opens the book and closes on the backdrop', async ({ page }) => {
    const book = page.locator('.library-book').filter({ hasText: 'E2E EPUB' }).first();
    await book.dispatchEvent('contextmenu');
    const sheet = page.locator('.library-book-sheet');
    await expect(sheet).toBeVisible();
    await page.locator('.library-book-sheet-backdrop').click({ position: { x: 20, y: 20 } });
    await expect(sheet).toHaveCount(0);
    await book.dispatchEvent('contextmenu');
    await sheet.getByRole('button', { name: '打开' }).click();
    await expect(page.locator('#fileName')).toHaveText('E2E EPUB');
  });
});
