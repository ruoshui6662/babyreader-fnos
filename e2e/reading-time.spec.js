'use strict';

const { test, expect } = require('@playwright/test');

const APP_PATH = '/app/zhenshu/';

// Same rules with short clocks: count every 200 ms, idle after 1.5 s of no
// activity (3 minutes in the app), report every 600 ms.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__zhenshuReadingTimerConfig = { tickMs: 200, idleMs: 1500, flushMs: 600 };
  });
});

async function openBook(page) {
  await page.goto(APP_PATH);
  await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
  await expect(page.locator('#article')).toContainText('E2E Reader');
  return page.evaluate(() => state.currentBookId);
}

async function secondsToday(page, bookId) {
  return page.evaluate(async (id) => {
    const date = (() => {
      const now = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    })();
    await window.__zhenshuReadingTimer.flush();
    const { days } = await window.browserHost.getReadingTime(date, date);
    return days[date]?.[id] || 0;
  }, bookId);
}

async function keepReading(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(150);
  }
}

test('reading time counts while reading and stops when idle, hidden or back on the shelf', async ({ page }) => {
  const bookId = await openBook(page);
  const start = await secondsToday(page, bookId);
  await keepReading(page, 3200);
  await expect.poll(() => secondsToday(page, bookId)).toBeGreaterThanOrEqual(start + 2);

  // Idle: after the idle limit nothing more is added.
  await page.waitForTimeout(2000);
  const idle = await secondsToday(page, bookId);
  await page.waitForTimeout(1500);
  expect(await secondsToday(page, bookId)).toBe(idle);

  // Hidden page: activity alone does not count.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await keepReading(page, 1500);
  expect(await secondsToday(page, bookId)).toBe(idle);
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Back on the shelf: no counting either.
  await page.locator('#btnBackToLibrary').click();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await keepReading(page, 1500);
  expect(await secondsToday(page, bookId)).toBe(idle);
});

test('time that could not be sent waits and is sent after a reload', async ({ page }) => {
  const bookId = await openBook(page);
  const start = await secondsToday(page, bookId);
  await page.route('**/api/reading-time', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await keepReading(page, 3000);
  // A report in flight holds its whole seconds until it fails; wait for it.
  const pending = await page.evaluate(async () => {
    const timer = window.__zhenshuReadingTimer.state;
    while (timer.sending) await timer.sending;
    return [...timer.pending.values()].reduce((sum, ms) => sum + ms, 0);
  });
  expect(pending).toBeGreaterThanOrEqual(2000);
  expect(await page.evaluate((uid) => localStorage.getItem(`zhenshu-reading-time:${uid}`), await page.evaluate(() => state.session.uid))).not.toBeNull();
  await page.unroute('**/api/reading-time');
  await page.reload();
  await expect(page.locator('#article')).toContainText('E2E Reader');
  await expect.poll(() => secondsToday(page, bookId)).toBeGreaterThanOrEqual(start + 2);
});

test('the reading-time API refuses implausible reports', async ({ request }) => {
  const response = await request.post(`${APP_PATH}api/reading-time`, {
    data: { entries: [{ date: '2026-02-30', bookId: 'a'.repeat(64), seconds: 10 }] }
  });
  expect(response.status()).toBe(400);
});
