'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  showMobileReaderChrome
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

async function openOnPhone(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
  });
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await page.reload({ waitUntil: 'load' });
  await openEpubFixture(page);
  await expect(page.locator('html')).toHaveAttribute('data-reader-surface', 'mobile');
}

// Nothing in an open sheet may be wider than the screen.
async function expectNoSideways(page, selector) {
  const overflow = await page.locator(selector).evaluate((sheet) => ({
    sheet: sheet.scrollWidth - sheet.clientWidth,
    page: document.documentElement.scrollWidth - innerWidth,
    right: Math.round(sheet.getBoundingClientRect().right - innerWidth)
  }));
  expect(overflow.sheet).toBeLessThanOrEqual(0);
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.right).toBeLessThanOrEqual(0);
}

test.describe('Phone panels', () => {
  for (const width of [375, 390, 430]) {
    test(`settings, contents and AI fit a ${width}px phone`, async ({ page }) => {
      await openOnPhone(page, width);

      await showMobileReaderChrome(page);
      await page.locator('#btnMobileSettings').click();
      const settings = page.locator('#readerSettingsSheet');
      await expect(settings).toBeVisible();
      await expect(settings.locator('.sheet-grip')).toBeVisible();
      // The short sheet: appearance and 翻页方式; the rest behind 更多设置.
      await expect(settings.locator('[data-settings-group="typography"]')).toBeHidden();
      await expect(settings.locator('[data-reading-mode-choice="double"]')).toHaveAttribute('aria-checked', 'true');
      await expectNoSideways(page, '#readerSettingsSheet');
      await page.locator('#btnSettingsMore').click();
      await expect(settings.locator('[data-settings-group="typography"]')).toBeVisible();
      await expectNoSideways(page, '#readerSettingsSheet');
      await page.goBack();
      await expect(settings).toBeHidden();

      await showMobileReaderChrome(page);
      await page.locator('#btnMobileToc').click();
      await expect(page.locator('#readerDrawer')).toBeVisible();
      await expectNoSideways(page, '#readerDrawer');
      await page.goBack();
      await expect(page.locator('#readerDrawer')).toBeHidden();

      await showMobileReaderChrome(page);
      await page.locator('#btnMobileAi').click();
      const ai = page.locator('#aiModal');
      await expect(ai).toBeVisible();
      await expect(page.locator('#btnAiBookMap')).toBeHidden();
      await expect(page.locator('#btnAiMore')).toBeVisible();
      await expectNoSideways(page, '#aiModal');
      const box = await ai.boundingBox();
      expect(Math.round(box.width)).toBe(width);
      expect(Math.round(box.y + box.height)).toBe(844);
    });
  }

  test('翻页方式 switches between paging and scrolling and 更多设置 collapses on reopen', async ({ page }) => {
    await openOnPhone(page, 390);
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileSettings').click();
    await page.locator('[data-reading-mode-choice="scroll"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-reading-mode', 'scroll');
    await expect(page.locator('[data-reading-mode-choice="scroll"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#btnSettingsMore').click();
    await expect(page.locator('#readerSettingsSheet')).toHaveClass(/is-expanded/);
    await page.locator('[data-reading-mode-choice="double"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-reading-mode', 'double');
    await page.goBack();
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileSettings').click();
    await expect(page.locator('#readerSettingsSheet')).not.toHaveClass(/is-expanded/);
  });

  test('dragging a sheet down by its grip closes it; a short drag springs back', async ({ page }) => {
    await openOnPhone(page, 390);
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileSettings').click();
    const settings = page.locator('#readerSettingsSheet');
    await expect(settings).toBeVisible();
    const drag = (distance) => settings.locator('.sheet-grip').evaluate((grip, dy) => {
      const rect = grip.getBoundingClientRect();
      const fire = (type, y) => grip.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerType: 'touch', pointerId: 3, clientX: rect.x + 10, clientY: y
      }));
      fire('pointerdown', rect.y);
      fire('pointermove', rect.y + dy / 2);
      fire('pointermove', rect.y + dy);
      fire('pointerup', rect.y + dy);
    }, distance);
    await drag(30);
    await expect(settings).toBeVisible();
    await expect(settings).toHaveAttribute('style', /^(?!.*translateY)/);
    await drag(220);
    await expect(settings).toBeHidden();
  });

  test('contents marks the current chapter; AI actions live behind ⋯', async ({ page }) => {
    await openOnPhone(page, 390);
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileNextChapter').click();
    await expect(page.locator('#readingProgress')).toContainText('第 2/');
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileToc').click();
    await expect(page.locator('.toc a[aria-current="location"]')).toHaveText('第二章');
    await page.goBack();

    await showMobileReaderChrome(page);
    await page.locator('#btnMobileAi').click();
    await page.locator('#btnAiMore').click();
    await expect(page.locator('#aiMoreMenu')).toBeVisible();
    await page.locator('#aiMoreMenu [data-ai-proxy="btnAiConversations"]').click();
    await expect(page.locator('#aiMoreMenu')).toBeHidden();
    await expect(page.locator('#aiConversationsView')).toBeVisible();
    // Back closes the conversation list first, then the AI panel.
    await page.goBack();
    await expect(page.locator('#aiConversationsView')).toBeHidden();
    await expect(page.locator('#aiModal')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#aiModal')).toBeHidden();
  });
});
