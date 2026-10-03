'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

test('a GBK-encoded TXT book reads, and searches, as Chinese instead of mojibake', async ({ page }) => {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'e2e-gbk-novel' }).click();
  await expect(page.locator('#article h2')).toHaveText('第一章 编码');
  await expect(page.locator('#article')).toContainText('这是一本用GBK编码保存的小说，搜索关键词是青石板路。');
  await expect(page.locator('#article')).toContainText('第二段也要正常显示，不能变成乱码。');
  await expect(page.locator('#article')).not.toContainText('�');

  // In-book search reads the same decoded text.
  await page.locator('#btnSearch').click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await page.locator('#readerSearchQuery').fill('青石板路');
  await page.locator('#readerSearchForm').press('Enter');
  await expect(page.locator('#readerSearchForm')).toHaveAttribute('data-reader-search-state', 'results');
  await expect(page.locator('.reader-search-result').first()).toContainText('青石板路');
});
