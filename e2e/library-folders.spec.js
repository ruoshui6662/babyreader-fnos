'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

test('admins get the library folders with book counts; a healthy library shows no folder panel', async ({ page, request }) => {
  const library = await (await request.get(`${APP_PATH}api/library`)).json();
  expect(Array.isArray(library.folders?.scanned)).toBe(true);
  expect(library.folders.scanned.length).toBeGreaterThan(0);
  const total = library.folders.scanned.reduce((sum, folder) => sum + folder.bookCount, 0);
  expect(total).toBeGreaterThan(0);
  expect(library.folders.scanned.every((folder) => typeof folder.root === 'string' && folder.skippedCount === 0)).toBe(true);
  // Folder paths are not repeated inside the scan summary.
  expect(library.scan.roots).toBeUndefined();

  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await expect(page.locator('.library-folders')).toHaveCount(0);
});
