'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

test('admins get the library folders with book counts and source; a healthy library shows them once', async ({ page, request }) => {
  const library = await (await request.get(`${APP_PATH}api/library`)).json();
  expect(Array.isArray(library.folders?.scanned)).toBe(true);
  expect(library.folders.scanned.length).toBeGreaterThan(0);
  const total = library.folders.scanned.reduce((sum, folder) => sum + folder.bookCount, 0);
  expect(total).toBeGreaterThan(0);
  expect(library.folders.scanned.every((folder) => typeof folder.root === 'string' && folder.skippedCount === 0)).toBe(true);
  expect(library.folders.scanned.every((folder) => ['configured', 'accessible', 'shared'].includes(folder.source))).toBe(true);
  // Folder paths are not repeated inside the scan summary.
  expect(library.scan.roots).toBeUndefined();

  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  // Nothing wrong: a one-time notice naming each folder's source; after
  // 知道了 it is gone, and a reload does not bring it back.
  const notice = page.locator('.library-folders.is-notice');
  await expect(notice).toBeVisible();
  await expect(notice.locator('li').first()).toContainText(/(应用设置|应用共享文件夹|fnOS 授权) · \d+ 本/);
  await notice.getByRole('button', { name: '知道了' }).click();
  await expect(page.locator('.library-folders')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await expect(page.locator('.library-folders')).toHaveCount(0);
});
