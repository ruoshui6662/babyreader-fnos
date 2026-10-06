'use strict';

// Choosing words on a paged phone page: a selection cannot run into the
// hidden pages or the toolbar, and 续选下页 carries one across a page turn.
const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  waitForHighlightsSave,
  readHighlightState
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openOnPhone(page) {
  await page.addInitScript((ua) => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
  }, PHONE_UA);
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await page.reload({ waitUntil: 'load' });
  await openEpubFixture(page);
  await expect(page.locator('html')).toHaveAttribute('data-reader-surface', 'mobile');
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  await expect.poll(() => page.evaluate(() => state.pageGroupCount)).toBeGreaterThan(2);
}

// Selects from a point on the page to either the page's last visible
// caret, or a paragraph further on that is not on screen.
function selectOnPage(page, { to }) {
  return page.evaluate((target) => {
    const article = document.getElementById('article');
    const visible = article.getBoundingClientRect();
    const caretAt = (x, y) => {
      const range = document.caretRangeFromPoint(x, y);
      return range && range.startContainer.parentElement?.closest('.epub-chapter') ? range : null;
    };
    let end = null;
    for (let y = visible.bottom - 6; !end && y > visible.top; y -= 8) end = caretAt(visible.right - 6, y);
    let start = null;
    for (let y = end.getBoundingClientRect().top - 70; !start && y > visible.top; y -= 8) start = caretAt(visible.left + 40, y);
    const selection = window.getSelection();
    if (target === 'hidden') {
      const paragraphs = [...document.querySelectorAll('#article .epub-chapter p')];
      const hidden = paragraphs.find((p) => p.getBoundingClientRect().left >= visible.right + 10);
      const node = hidden.firstChild;
      selection.setBaseAndExtent(start.startContainer, start.startOffset, node, Math.min(4, node.length));
    } else {
      selection.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
    }
    return selection.toString().length;
  }, to);
}

test.describe('Phone selection on a paged page', () => {
  test.afterEach(async ({ page }) => {
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
  });

  test('a selection running into hidden pages is cut at the end of the visible page', async ({ page }) => {
    await openOnPhone(page);
    const before = await selectOnPage(page, { to: 'hidden' });
    await expect(page.locator('#selectionMenu')).toBeVisible();
    const after = await page.evaluate(() => {
      const selection = window.getSelection();
      const visible = document.getElementById('article').getBoundingClientRect();
      const rects = [...selection.getRangeAt(0).getClientRects()].filter((rect) => rect.width);
      return { length: selection.toString().length, beyond: rects.filter((rect) => rect.left >= visible.right - 1).length };
    });
    expect(after.length).toBeLessThan(before);
    expect(after.beyond).toBe(0);
    // Only the book's words can be chosen: the toolbar is not selectable.
    await expect(page.locator('#mobileReaderToolbar')).toHaveCSS('user-select', 'none');
  });

  test('续选下页 turns the page and a tap ends the selection there; the mark spans both pages', async ({ page }) => {
    await openOnPhone(page);
    const firstPage = await page.evaluate(() => state.pageGroup);
    await selectOnPage(page, { to: 'page-end' });
    const menu = page.locator('#selectionMenu');
    await expect(menu).toBeVisible();
    const extend = menu.locator('[data-selection-action="extend"]');
    await expect(extend).toBeVisible();
    const firstPart = await page.evaluate(() => window.getSelection().toString().replace(/\s+/g, ''));
    await extend.click();
    await expect.poll(() => page.evaluate(() => state.pageGroup)).toBe(firstPage + 1);
    await expect(page.locator('#readerFeedback')).toContainText('点一下要选到的位置');
    // The turn is animated; tap once the page has settled.
    await page.waitForTimeout(600);

    // Tap a few lines down on the new page.
    const point = await page.evaluate(() => {
      const visible = document.getElementById('article').getBoundingClientRect();
      for (let y = visible.top + visible.height / 2; y < visible.bottom; y += 8) {
        const range = document.caretRangeFromPoint(visible.left + 60, y);
        if (range?.startContainer.parentElement?.closest('.epub-chapter')) return { x: visible.left + 60, y };
      }
      return null;
    });
    await page.mouse.click(point.x, point.y);

    await expect(menu).toBeVisible();
    const whole = await page.evaluate(() => window.getSelection().toString().replace(/\s+/g, ''));
    expect(whole.startsWith(firstPart)).toBe(true);
    expect(whole.length).toBeGreaterThan(firstPart.length);
    // The page did not turn again, and the reading chrome stayed closed.
    expect(await page.evaluate(() => state.pageGroup)).toBe(firstPage + 1);

    const saved = waitForHighlightsSave(page);
    await menu.locator('[data-selection-action="highlight"]').click();
    await saved;
    const highlights = await readHighlightState(page);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].text.replace(/\s+/g, '')).toBe(whole);
  });

  test('a tap away from the text while continuing gives up without turning the page', async ({ page }) => {
    await openOnPhone(page);
    const firstPage = await page.evaluate(() => state.pageGroup);
    await selectOnPage(page, { to: 'page-end' });
    await page.locator('#selectionMenu [data-selection-action="extend"]').click();
    await expect.poll(() => page.evaluate(() => state.pageGroup)).toBe(firstPage + 1);
    // The top margin of the page holds no words.
    await page.mouse.click(195, 12);
    await expect(page.locator('#readerFeedback')).toContainText('已取消续选');
    expect(await page.evaluate(() => state.pageGroup)).toBe(firstPage + 1);
  });
});
