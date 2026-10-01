'use strict';

// Brand (2026-10 plan, phase 3): one cat-ears-and-book mark for the fnOS
// icons, the favicon and the top bar.

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

test('the brand mark is served as favicon, launcher icons and top-bar mark', async ({ page }) => {
  await page.goto(APP_PATH);
  await expect(page.locator('link[rel~="icon"][type="image/svg+xml"]')).toHaveAttribute('href', 'images/logo.svg');
  for (const [file, type] of [['images/logo.svg', 'image/svg+xml'], ['images/icon_64.png', 'image/png'], ['images/icon_256.png', 'image/png']]) {
    const response = await page.request.get(`${APP_PATH}${file}`);
    expect(response.ok(), file).toBeTruthy();
    expect(response.headers()['content-type'], file).toContain(type);
  }
  const mark = page.locator('.topbar .app-mark');
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
});
