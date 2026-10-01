'use strict';

// Unified reader shell (2026-10 commercial-grade UX plan, phase 1): every
// format shares one rail, one position pill, the 返回原处 safety net and the
// same selection menu.

const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState, resetReaderSettings, selectArticleText } = require('./helpers/reader');

const APP_PATH = '/app/babyreader-fnos/';
// Compared by ID: labels change with state (e.g. a bookmarked page).
const RAIL = ['btnToc', 'btnSearch', 'btnBookmarks', 'btnNotes', 'btnAi', 'btnSettings'];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  // The shared reset opts in to auto-opening the contents, which for a PDF
  // lands asynchronously once its outline (or page list) is ready. These
  // tests drive the panel themselves.
  await page.evaluate(async () => {
    const response = await fetch('/app/babyreader-fnos/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tocAutoOpen: false })
    });
    if (!response.ok) throw new Error(`Settings setup failed: ${response.status}`);
  });
});

async function openBook(page, title) {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: title }).first().click();
  await expect(page.locator('#readerFloatingToolbar')).toBeVisible();
  await page.waitForTimeout(150);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
}

async function visibleRail(page) {
  return page.locator('#readerFloatingToolbar button').evaluateAll((buttons) => buttons
    .filter((button) => !button.hidden && getComputedStyle(button).display !== 'none')
    .map((button) => button.id));
}

test('EPUB and PDF share one six-button rail and keep the theme toggle in the top bar', async ({ page }) => {
  await openBook(page, 'E2E EPUB');
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter');
  expect(await visibleRail(page)).toEqual(RAIL);
  await expect(page.locator('#btnLibraryTheme')).toBeVisible();

  await openBook(page, 'e2e-reader');
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  // The PDF fixture has no outline: the contents fall back to a page list.
  await expect(page.locator('#btnToc')).toBeVisible();
  expect(await visibleRail(page)).toEqual(RAIL);
  await expect(page.locator('#btnLibraryTheme')).toBeVisible();
});

test('a PDF without an outline lists its pages as contents and jumps to them', async ({ page }) => {
  await openBook(page, 'e2e-reader');
  await expect(page.locator('#pdfReaderStatus')).toContainText('4 页');
  await page.locator('#btnToc').click();
  const entries = page.locator('#tocList a[data-target]');
  await expect(entries).toHaveText(['第 1 页', '第 2 页', '第 3 页', '第 4 页']);
  await entries.nth(2).click();
  await expect(page.locator('#pdfReaderSurface')).toHaveAttribute('data-current-page', '2');
});

test('the top bar shows one whole-book position and pages left sit on the paper', async ({ page }) => {
  await page.evaluate(async () => {
    const response = await fetch('/app/babyreader-fnos/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readingMode: 'double', continuousScroll: false })
    });
    if (!response.ok) throw new Error(`Settings setup failed: ${response.status}`);
  });
  await openBook(page, 'E2E EPUB');
  await expect(page.locator('#readingProgress')).toHaveText(/^第 1\/3 章 · \d+%$/);
  await expect(page.locator('#paginationStatus')).toHaveText(/^本章(还剩 \d+ 页|最后一页)$/);
  // The pages-left line lives on the paper, not in the top bar.
  expect(await page.locator('#paginationStatus').evaluate((element) => Boolean(element.closest('#topbar')))).toBe(false);
  // Chapter jumps sit inside the position pill.
  await expect(page.locator('.reader-status #btnNextChapter')).toBeVisible();

  // Whole-book percentage: chapter 2 of 3 starts at 33%.
  await page.locator('.reader-status #btnNextChapter').click();
  await expect(page.locator('#readingProgress')).toHaveText('第 2/3 章 · 33%');
});

test('返回原处 brings the reader back after a contents jump', async ({ page }) => {
  await page.evaluate(async () => {
    const response = await fetch('/app/babyreader-fnos/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readingMode: 'double', continuousScroll: false })
    });
    if (!response.ok) throw new Error(`Settings setup failed: ${response.status}`);
  });
  await openBook(page, 'E2E EPUB');
  await page.locator('#btnNextPage').click();
  const origin = {
    progress: await page.locator('#readingProgress').textContent(),
    pages: await page.locator('#paginationStatus').textContent()
  };
  await expect(page.locator('#btnJumpBack')).toHaveCount(0);

  await page.locator('#btnToc').click();
  await page.locator('#tocList a[data-target]').nth(2).click();
  await expect(page.locator('#readingProgress')).toContainText('第 3/3 章');
  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#btnJumpBack')).toBeVisible();
  await expect(page.locator('#btnJumpBack')).toHaveText('返回原处');

  await page.locator('#btnJumpBack').click();
  await expect(page.locator('#readingProgress')).toHaveText(origin.progress);
  await expect(page.locator('#paginationStatus')).toHaveText(origin.pages);
  await expect(page.locator('#btnJumpBack')).toBeHidden();
});

test('the selection menu can search the selected words in the book', async ({ page }) => {
  await openBook(page, 'E2E EPUB');
  await expect(selectArticleText(page, '第一章第1段')).resolves.toBeTruthy();
  const search = page.locator('#selectionMenu [data-selection-action="search"]');
  await expect(search).toBeVisible();
  await search.click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await expect(page.locator('#readerSearchQuery')).toHaveValue('第一章第1段');
  await expect(page.locator('#readerSearchForm')).toHaveAttribute('data-reader-search-state', 'results');
  await expect(page.locator('.reader-search-result').first()).toBeVisible();
});
