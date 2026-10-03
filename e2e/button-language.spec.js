'use strict';

// Every action button on the shelf pages wears one of the three shared roles,
// and each role looks the same wherever it appears.
const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const ACTION_AREAS = [
  '.library-header-actions',
  '.library-recent-card',
  '.stats-toolbar',
  '.stats-card-head',
  '.notes-doc-header',
  '.notes-note-actions',
  '.notes-select-bar',
  '.note-card-actions'
].join(', ');

async function seed(page) {
  await page.goto(APP_PATH);
  await resetEpubFixtureState(page);
  return page.evaluate(async () => {
    const library = await window.browserHost.getLibrary();
    const epub = library.books.find((book) => book.title === 'E2E EPUB');
    await fetch(`/app/zhenshu/api/books/${epub.id}/highlights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ highlights: [{
        id: 'b1',
        locator: JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: 5 }),
        chapterHref: 'OEBPS/chapter1.xhtml',
        text: '按钮语言测试的一句话。',
        thought: '一条想法',
        color: 'yellow',
        createdAt: new Date().toISOString()
      }] })
    });
    return epub.id;
  });
}

/** Roles and computed looks of the visible buttons in the action areas. */
async function collect(page) {
  return page.evaluate((areas) => {
    const roles = ['zs-btn-primary', 'zs-btn-secondary', 'zs-btn-plain'];
    const found = [];
    for (const area of document.querySelectorAll(areas)) {
      for (const button of area.querySelectorAll('button, .library-recent-action')) {
        if (button.closest('.custom-select, .stats-range') || !button.getClientRects().length) continue;
        const style = getComputedStyle(button);
        const own = roles.filter((role) => button.classList.contains(role));
        found.push({
          label: button.textContent.trim() || button.getAttribute('aria-label'),
          zs: button.classList.contains('zs-btn'),
          roles: own,
          quiet: button.classList.contains('zs-btn-quiet'),
          disabled: button.disabled,
          look: `${style.color} on ${style.backgroundColor}`
        });
      }
    }
    return found;
  }, ACTION_AREAS);
}

test('shelf pages: every action button has one shared role, and each role looks the same', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const bookId = await seed(page);
  const seen = [];
  const visit = async (label) => {
    // Resting looks only: no hover, and colour transitions finished.
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
    for (const button of await collect(page)) seen.push({ ...button, page: label });
  };

  await page.goto(APP_PATH);
  await page.waitForSelector('.library-header-actions button');
  await visit('书库');
  await page.goto(`${APP_PATH}?view=stats`);
  await page.waitForSelector('.stats-toolbar');
  await visit('阅读统计');
  await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
  await page.waitForSelector('.notes-doc-title');
  await visit('笔记文档');
  await page.locator('.notes-long-image').click();
  await expect(page.locator('.notes-select-bar')).toBeVisible();
  await visit('选择长图');
  await page.locator('.notes-select-cancel').click();
  await page.locator('[data-note-id="b1"] .notes-action', { hasText: '卡片' }).click();
  await page.locator('.note-card-preview:not([aria-busy="true"]) canvas').waitFor();
  await visit('卡片面板');

  expect(seen.length).toBeGreaterThan(10);
  const unruled = seen.filter((button) => !button.zs || button.roles.length !== 1);
  expect(unruled, 'each action button takes zs-btn plus exactly one role').toEqual([]);

  // One look per role (quiet text buttons and disabled ones aside).
  for (const role of ['zs-btn-primary', 'zs-btn-secondary', 'zs-btn-plain']) {
    const looks = new Set(seen.filter((button) => button.roles[0] === role && !button.quiet && !button.disabled).map((button) => button.look));
    expect([...looks], `${role} looks`).toHaveLength(1);
  }
  const primary = seen.find((button) => button.roles[0] === 'zs-btn-primary');
  const secondary = seen.find((button) => button.roles[0] === 'zs-btn-secondary');
  expect(primary.look).not.toBe(secondary.look);
});

