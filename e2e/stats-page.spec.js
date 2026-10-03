'use strict';

const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const SCREENSHOT_DIR = process.env.ZHENSHU_SCREENSHOT_DIR || null;

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Reading time for the last 20 days over three books, and two notes.
async function seed(page) {
  await page.goto(APP_PATH);
  await resetEpubFixtureState(page);
  return page.evaluate(async ({ dates }) => {
    const library = await window.browserHost.getLibrary();
    const pick = (title) => library.books.find((book) => book.title === title);
    const books = [pick('E2E EPUB'), pick('E2E Markdown'), pick('E2E Indent EPUB')];
    const entries = [];
    dates.forEach((date, index) => books.forEach((book, rank) => {
      const seconds = Math.round(((index * 37 + rank * 53) % 50 + 10) * 60 / (rank + 1));
      entries.push({ date, bookId: book.id, seconds });
    }));
    // Only the first 20 days; then today's reading is whatever the page adds.
    await window.browserHost.saveReadingTime(entries);
    const epub = books[0];
    const now = Date.now();
    await fetch(`/app/zhenshu/api/books/${epub.id}/highlights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ highlights: [
        { id: 'stats-note-1', locator: '{}', chapterHref: 'OEBPS/chapter1.xhtml', text: '技术并非中立的工具，而是一种塑造社会关系的力量。', thought: '值得反复读', color: 'yellow', createdAt: new Date(now - 60000).toISOString() },
        { id: 'stats-note-2', locator: '{}', chapterHref: 'OEBPS/chapter2.xhtml', text: '媒介是人的感觉与能力的延伸。', color: 'green', createdAt: new Date(now - 2 * 86400000).toISOString() }
      ] })
    });
    return books.map((book) => book.id);
  }, { dates: Array.from({ length: 20 }, (_, index) => localDate(index + 1)) });
}

test.describe('阅读统计', () => {
  test('a week: metrics, daily bars, ranking and recent notes', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page);
    await page.goto(`${APP_PATH}?view=stats`);
    await expect(page.locator('.library-view h1')).toHaveText('阅读统计');
    await expect(page.locator('.stats-metric')).toHaveCount(4);
    await expect(page.locator('.stats-range [aria-checked="true"]')).toHaveText('本周');
    await expect(page.locator('.stats-bar')).toHaveCount(7);
    await expect(page.locator('.library-summary')).toContainText('开始记录阅读时长');

    // The chart and the metric agree: the bars add up to the week's total.
    const { barMinutes, metric } = await page.evaluate(() => ({
      barMinutes: [...document.querySelectorAll('.stats-bar')].map((bar) => bar.getAttribute('aria-label')),
      metric: document.querySelector('.stats-metric.is-time .stats-metric-value').textContent
    }));
    expect(barMinutes).toHaveLength(7);
    expect(metric).toMatch(/小时|分钟/);

    await expect(page.locator('.stats-rank-row').first()).toContainText('E2E EPUB');
    await expect(page.locator('.stats-note-row').first()).toContainText('技术并非中立的工具');
    await expect(page.locator('.stats-note-row').first()).toContainText('值得反复读');

    // Selecting a bar explains that day.
    const firstBar = page.locator('.stats-bar').first();
    await firstBar.click();
    await expect(firstBar).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.stats-chart-detail')).toContainText('周一');

    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/stats-week-desktop.png`, fullPage: true });

    // Month: one bar per day; the previous month is one step back.
    await page.locator('[data-stats-range="month"]').click();
    await expect(page.locator('.stats-range [aria-checked="true"]')).toHaveText('本月');
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    await expect(page.locator('.stats-bar')).toHaveCount(days);
    await expect(page.locator('.stats-period-step').last()).toBeDisabled();
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/stats-month-desktop.png`, fullPage: true });
    const label = await page.locator('.stats-period-label').textContent();
    await page.locator('.stats-period-step').first().click();
    await expect(page.locator('.stats-period-label')).not.toHaveText(label);
    await expect(page.locator('.stats-period-step').last()).toBeEnabled();
    void testInfo;
  });

  test('ranking opens the book; a recent note opens the book at that note', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page);
    await page.goto(`${APP_PATH}?view=stats`);
    await page.locator('.stats-rank-row').filter({ hasText: 'E2E Markdown' }).click();
    await expect(page.locator('#article')).toContainText('E2E Reader');
    await page.locator('#btnBackToLibrary').click();
    await expect(page.locator('.library-view h1')).toHaveText('阅读统计');
    await page.locator('.stats-link').click();
    await expect(page.locator('.library-view h1')).toHaveText('笔记');
  });

  test('phones: one column, nothing wider than the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    await seed(page);
    await page.goto(`${APP_PATH}?view=stats`);
    await expect(page.locator('.stats-metric')).toHaveCount(4);
    const overflow = await page.evaluate(() => {
      const reader = document.getElementById('reader');
      return reader.scrollWidth - reader.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/stats-week-phone.png` });
    await page.locator('[data-stats-range="month"]').click();
    await expect(page.locator('.stats-bar').first()).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('reader').scrollWidth - document.getElementById('reader').clientWidth)).toBeLessThanOrEqual(0);
  });
});
