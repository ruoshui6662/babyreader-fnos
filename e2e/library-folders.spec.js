'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

test('admins get the library folders with book counts and source; a healthy library folds the panel', async ({ page, request }) => {
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
  // Nothing wrong: one folded line, opened on demand, naming each folder's source.
  await expect(page.locator('.library-folders:not(.is-quiet)')).toHaveCount(0);
  const quiet = page.locator('details.library-folders.is-quiet');
  await expect(quiet).toBeVisible();
  await quiet.locator('summary').click();
  await expect(quiet.locator('li').first()).toContainText(/(应用设置|应用共享文件夹|fnOS 授权) · \d+ 本/);
});
