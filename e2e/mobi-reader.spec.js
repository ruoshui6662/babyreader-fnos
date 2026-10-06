const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { createMobiFixture } = require('../tests/fixtures/mobi-fixtures');

// MOBI plan Task 3: a generated MOBI6 book is scanned, opened through its
// derived EPUB, navigated, searched and resumed in a real browser. The spec
// adds its own book and switch and removes both afterwards (workers: 1), so
// the shared fixture library is unchanged for every other spec.

const APP_PATH = '/app/zhenshu/';
const RUNTIME = path.resolve(__dirname, '..', process.env.ZHENSHU_E2E_RUNTIME_ROOT || '.runtime/e2e-resource-lifecycle');
const MOBI_FILE = path.join(RUNTIME, 'library', 'e2e-kindle.mobi');
const TITLE = 'E2E Kindle 书';

async function rescan(request) {
  const response = await request.post(`${APP_PATH}api/library/scan`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  fs.writeFileSync(MOBI_FILE, createMobiFixture({ title: TITLE, author: 'Playwright' }));
  const library = await rescan(request);
  expect(library.books.some((book) => book.title === TITLE)).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  fs.rmSync(MOBI_FILE, { force: true });
  await rescan(request);
});

async function openKindleBook(page) {
  await page.goto(APP_PATH);
  const card = page.locator('.library-book').filter({ hasText: TITLE });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('#fileName')).toHaveText(TITLE);
  await expect(page.locator('#article')).toContainText('目录');
  await page.waitForTimeout(50);
  if (await page.locator('#readerDrawer').isVisible()) await page.keyboard.press('Escape');
}

test('a MOBI book shows its format and opens as a readable book', async ({ page }) => {
  await page.goto(APP_PATH);
  const card = page.locator('.library-book').filter({ hasText: TITLE });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', /Playwright/);
  await openKindleBook(page);
});

test('the converted table of contents navigates to a later chapter', async ({ page }) => {
  await openKindleBook(page);
  await page.locator('#btnToc').click();
  await expect(page.locator('#readerPanelToc')).toBeVisible();
  const entries = page.locator('#readerPanelToc .toc a');
  await expect(entries.filter({ hasText: '第三章 归来' })).toBeVisible();
  await entries.filter({ hasText: '第三章 归来' }).click();
  await expect(page.locator('#article')).toContainText('第三章是结尾');
});

test('full-text search finds MOBI text and jumps to the hit', async ({ page }) => {
  await openKindleBook(page);
  await page.locator('#btnSearch').click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await page.locator('#readerSearchQuery').fill('重复检索词');
  const response = page.waitForResponse((res) => res.url().includes('/search') && res.ok());
  await page.locator('#readerSearchForm').press('Enter');
  await response;
  const results = page.locator('.reader-search-result');
  await expect(results).toHaveCount(2);
  await results.filter({ hasText: '再次出现' }).click();
  await expect(page.locator('#article')).toContainText('第三章是结尾');
});

test('reading progress in a MOBI book survives returning to the library', async ({ page }) => {
  await openKindleBook(page);
  await page.locator('#btnToc').click();
  await page.locator('#readerPanelToc .toc a').filter({ hasText: '第二章 远行' }).click();
  await expect(page.locator('#article')).toContainText('第二章包含一张图片');
  const saved = page.waitForResponse((res) => res.url().includes('/progress') && res.request().method() === 'PUT');
  await page.locator('#btnBackToLibrary').click();
  await saved;
  await expect(page.locator('.library-recent-card')).toContainText(TITLE);
  await page.locator('.library-recent-card').click();
  await expect(page.locator('#article')).toContainText('第二章包含一张图片');
});
