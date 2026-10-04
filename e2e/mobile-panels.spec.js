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

  test('目录 / 书签 / 标记与想法 open as a left drawer with the book on top; tap outside or swipe left closes it', async ({ page }) => {
    await openOnPhone(page, 390);
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileToc').click();
    const drawer = page.locator('#readerDrawer');
    await expect(drawer).toBeVisible();
    await page.waitForTimeout(400); // the slide-in
    const box = await drawer.boundingBox();
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.height)).toBe(844);
    expect(box.width).toBeLessThan(390 * 0.86);
    await expect(drawer.locator('.sheet-grip')).toBeHidden();
    await expect(drawer.locator('.reader-drawer-book-title')).toHaveText('E2E EPUB');
    await expect(drawer.locator('.reader-drawer-book-meta')).toContainText(/已读 \d+%/);
    await expect(drawer.locator('#tocList a').first()).toBeVisible();
    for (const tab of ['#drawerTabToc', '#drawerTabBookmarks', '#drawerTabNotes']) {
      expect(await page.locator(tab).evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true);
    }
    await expectNoSideways(page, '#readerDrawer');

    // Tap outside closes it.
    await page.mouse.click(380, 400);
    await expect(drawer).toBeHidden();

    // A swipe to the left closes it; a short one springs back.
    await showMobileReaderChrome(page);
    await page.locator('#btnMobileToc').click();
    await page.waitForTimeout(400);
    const client = await page.context().newCDPSession(page);
    const swipe = async (xs) => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 250, y: 500 }] });
      for (const x of xs) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 504 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe([235, 220]);
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveCSS('transform', 'none');
    await swipe([230, 200, 160, 120]);
    await expect(drawer).toBeHidden();
  });

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
