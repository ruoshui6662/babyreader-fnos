'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  showMobileReaderChrome
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openOnPhone(page) {
  await page.addInitScript((ua) => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
  }, PHONE_UA);
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await page.reload({ waitUntil: 'load' });
  await openEpubFixture(page);
  await expect(page.locator('html')).toHaveAttribute('data-reader-surface', 'mobile');
  await expect(page.locator('body')).toHaveAttribute('data-reading-mode', 'double');
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  await expect.poll(() => page.evaluate(() => state.pageGroupCount)).toBeGreaterThan(2);
}

const pageGroup = (page) => page.evaluate(() => state.pageGroup);

async function openSettings(page) {
  await showMobileReaderChrome(page);
  await page.locator('#btnMobileSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
}

async function touchSwipe(page, xs, y = 420) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xs[0], y }] });
  for (const x of xs.slice(1)) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 2 }] });
  return {
    client,
    end: () => client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  };
}

test.describe('Phone page turning', () => {
  test.describe('first time', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test('the 点击区域 guide shows once, names each part of the page, and a tap dismisses it', async ({ page }) => {
      await openOnPhone(page);
      const guide = page.locator('#tapGuide');
      await expect(guide).toBeVisible();
      await expect(guide.locator('.tap-guide-zone')).toHaveText([/上一页/, /菜单/, /下一页/]);
      await expect(guide).toContainText('左右滑动也可以翻页');
      await guide.click();
      await expect(guide).toHaveCount(0);
      await page.reload({ waitUntil: 'load' });
      await openEpubFixture(page);
      await expect(page.locator('#tapGuide')).toHaveCount(0);
    });
  });

  test('settings offer 翻页动画, 点击翻页 and 左右滑动翻页 for paging, and they persist', async ({ page }) => {
    await openOnPhone(page);
    await openSettings(page);
    const sheet = page.locator('#readerSettingsSheet');
    await expect(sheet.locator('#settingPageTurnAnimation [aria-checked="true"]')).toHaveText('平移');
    await expect(sheet.locator('#settingTapToTurn [aria-checked="true"]')).toHaveText('左右分区');
    await expect(sheet.locator('#settingSwipeToTurn')).toBeChecked();

    const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT'
      && JSON.parse(r.request().postData() || '{}').tapToTurn === 'forward');
    await sheet.locator('[data-page-turn="fade"]').click();
    await sheet.locator('[data-tap-turn="forward"]').click();
    await expect(sheet.locator('#settingTapToTurnHint')).toContainText('单手');
    await sheet.locator('#settingSwipeToTurn').click();
    const body = JSON.parse((await saved).request().postData());
    expect(body).toMatchObject({ pageTurnAnimation: 'fade', tapToTurn: 'forward', swipeToTurn: false });

    // Scrolling has no pages to turn: the rows go away.
    await sheet.locator('[data-reading-mode-choice="scroll"]').click();
    await expect(sheet.locator('#settingPageTurnAnimation')).toBeHidden();
    await sheet.locator('[data-reading-mode-choice="double"]').click();
    await expect(sheet.locator('#settingPageTurnAnimation')).toBeVisible();

    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
    await openSettings(page);
    await expect(sheet.locator('#settingPageTurnAnimation [aria-checked="true"]')).toHaveText('淡入');
    await expect(sheet.locator('#settingTapToTurn [aria-checked="true"]')).toHaveText('点击下一页');
    await expect(sheet.locator('#settingSwipeToTurn')).not.toBeChecked();
  });

  test('左右分区 turns back on the left; 点击下一页 turns forward on either side', async ({ page }) => {
    await openOnPhone(page);
    await page.mouse.click(370, 420);
    await expect.poll(() => pageGroup(page)).toBe(1);
    await page.mouse.click(370, 420);
    await expect.poll(() => pageGroup(page)).toBe(2);
    await page.mouse.click(20, 420);
    await expect.poll(() => pageGroup(page)).toBe(1);

    await openSettings(page);
    await page.locator('[data-tap-turn="forward"]').click();
    await page.goBack();
    await expect(page.locator('#readerSettingsSheet')).toBeHidden();
    await page.mouse.click(20, 420);
    await expect.poll(() => pageGroup(page)).toBe(2);
    await page.mouse.click(370, 420);
    await expect.poll(() => pageGroup(page)).toBe(3);
    // The middle still shows the menu.
    await page.mouse.click(195, 420);
    await expect(page.locator('#mobileReaderToolbar')).toBeVisible();
  });

  test('平移: the page follows the finger, then slides on to the next page; a short pull springs back', async ({ page }) => {
    await openOnPhone(page);
    const article = page.locator('#article');
    const width = await page.evaluate(() => state.pageGroupWidth);

    const pull = await touchSwipe(page, [300, 290, 270]);
    const midway = await article.evaluate((el) => el.scrollLeft);
    expect(midway).toBeGreaterThan(20);
    expect(midway).toBeLessThan(width / 2);
    await pull.end();
    await expect.poll(() => article.evaluate((el) => Math.round(el.scrollLeft))).toBe(0);
    expect(await pageGroup(page)).toBe(0);

    const swipe = await touchSwipe(page, [320, 280, 220, 160]);
    await swipe.end();
    await expect.poll(() => pageGroup(page)).toBe(1);
    await expect.poll(() => article.evaluate((el) => Math.round(el.scrollLeft))).toBe(Math.round(width));
  });

  test('with 左右滑动翻页 off a swipe does not turn the page; taps still do', async ({ page }) => {
    await openOnPhone(page);
    await openSettings(page);
    await page.locator('#settingSwipeToTurn').click();
    await page.goBack();
    await expect(page.locator('#readerSettingsSheet')).toBeHidden();
    const swipe = await touchSwipe(page, [320, 280, 220, 160]);
    await swipe.end();
    await page.waitForTimeout(400);
    expect(await pageGroup(page)).toBe(0);
    await expect.poll(() => page.locator('#article').evaluate((el) => Math.round(el.scrollLeft))).toBe(0);
    await page.mouse.click(370, 420);
    await expect.poll(() => pageGroup(page)).toBe(1);
  });
});
