'use strict';

const { test, expect } = require('@playwright/test');
const { openEpubFixture, resetEpubFixtureState, resetReaderSettings } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

// Selects text the way a phone does: the selection appears and changes with
// no touchend/pointerup (Android hands the touch to the system).
async function selectLikeAPhone(page, start = 4, end = 20) {
  await page.evaluate(([from, to]) => {
    const paragraph = document.querySelector('#article .epub-chapter p');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, from);
    range.setEnd(paragraph.firstChild, to);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, [start, end]);
}

test.describe('Phone text selection and highlighting', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
      try { localStorage.removeItem('zhenshu-annotation-style'); } catch {}
    });
    await page.goto(APP_PATH);
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
    await expect(page.locator('html')).toHaveAttribute('data-reader-surface', 'mobile');
  });

  test('a selection without touchend opens a one-row menu below it', async ({ page }) => {
    await selectLikeAPhone(page);
    const menu = page.locator('#selectionMenu');
    await expect(menu).toBeVisible();
    // In on-screen order (the phone reorders the buttons with CSS).
    const visible = await menu.evaluate((element) => [...element.querySelectorAll('button')]
      .filter((button) => button.offsetParent)
      .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left)
      .map((button) => button.textContent.trim()));
    expect(visible).toEqual(['划线', '写想法', '复制', '问 AI', '搜索']);
    const geometry = await page.evaluate(() => {
      const range = window.getSelection().getRangeAt(0).getBoundingClientRect();
      const box = document.getElementById('selectionMenu').getBoundingClientRect();
      return { selectionBottom: range.bottom, menuTop: box.top, menuHeight: box.height, menuWidth: box.width };
    });
    expect(geometry.menuTop).toBeGreaterThan(geometry.selectionBottom);
    expect(geometry.menuHeight).toBeLessThan(60);
    expect(geometry.menuWidth).toBeLessThanOrEqual(390 - 16);
  });

  test('adjusting the selection keeps the menu; clearing it closes the menu', async ({ page }) => {
    await selectLikeAPhone(page);
    await expect(page.locator('#selectionMenu')).toBeVisible();
    // A finger touching a selection handle must not close the menu.
    await page.evaluate(() => {
      document.querySelector('#article p').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    });
    await selectLikeAPhone(page, 4, 40);
    await page.waitForTimeout(400);
    await expect(page.locator('#selectionMenu')).toBeVisible();
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await expect(page.locator('#selectionMenu')).toBeHidden();
  });

  test('划线 marks at once, then the bubble changes colour and style; tapping the mark reopens it', async ({ page }) => {
    await selectLikeAPhone(page);
    await page.locator('#selectionMenu [data-selection-action="highlight"]').click();
    const bubble = page.locator('#annotationMenu');
    await expect(bubble).toBeVisible();
    await expect(page.locator('.br-highlight-box').first()).toHaveAttribute('data-annotation-style', 'marker');

    await bubble.locator('[data-annotation-color="green"]').click();
    await expect(page.locator('.br-highlight-box').first()).toHaveAttribute('data-highlight-color', 'green');
    await bubble.locator('[data-annotation-style="line"]').click();
    await expect(page.locator('.br-highlight-box').first()).toHaveAttribute('data-annotation-style', 'line');

    // A tap elsewhere closes the bubble and does not also open the toolbar.
    await page.evaluate(() => {
      const paragraph = document.querySelectorAll('#article p')[2];
      paragraph.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      paragraph.click();
    });
    await expect(bubble).toBeHidden();
    await expect(page.locator('#mobileReaderToolbar')).toBeHidden();

    await page.locator('.br-highlight-box').first().click();
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('[data-annotation-color="green"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(bubble.locator('[data-annotation-style="line"]')).toHaveAttribute('aria-pressed', 'true');

    // The next one-tap 划线 reuses the last style.
    await page.locator('#annotationMenu [data-annotation-action="copy"]').click();
    await expect(page.locator('#annotationMenu')).toBeHidden();
    await page.waitForTimeout(300);
    await selectLikeAPhone(page, 30, 40);
    await page.locator('#selectionMenu [data-selection-action="highlight"]').click();
    await expect.poll(() => page.locator('.br-highlight-box[data-annotation-style="line"]').evaluateAll(
      (boxes) => new Set(boxes.map((box) => box.dataset.highlightId)).size)).toBe(2);
  });

  test('deleting from the bubble removes the mark', async ({ page }) => {
    await selectLikeAPhone(page);
    await page.locator('#selectionMenu [data-selection-action="highlight"]').click();
    await expect(page.locator('.br-highlight-box')).not.toHaveCount(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#annotationMenu [data-annotation-action="delete"]').click();
    await expect(page.locator('.br-highlight-box')).toHaveCount(0);
  });
});
