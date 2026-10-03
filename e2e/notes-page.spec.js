'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  selectArticleText,
  commitSelectionHighlight
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const SCREENSHOT_DIR = process.env.ZHENSHU_SCREENSHOT_DIR || null;

// Notes on two books: three on E2E EPUB across two chapters, one on E2E
// Indent EPUB.
async function seedNotes(page) {
  await page.goto(APP_PATH);
  await resetEpubFixtureState(page);
  return page.evaluate(async () => {
    const library = await window.browserHost.getLibrary();
    const epub = library.books.find((book) => book.title === 'E2E EPUB');
    const indent = library.books.find((book) => book.title === 'E2E Indent EPUB');
    const put = (book, highlights) => fetch(`/app/zhenshu/api/books/${book.id}/highlights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ highlights })
    });
    const at = (offsetMinutes) => new Date(Date.now() - offsetMinutes * 60000).toISOString();
    const locator = (offset) => JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: offset });
    await put(epub, [
      { id: 'n-ch2', locator: locator(3), chapterHref: 'OEBPS/chapter2.xhtml', text: '第二章里划下的一句话。', color: 'blue', createdAt: at(10) },
      { id: 'n-ch1-late', locator: locator(400), chapterHref: 'OEBPS/chapter1.xhtml', text: '第一章后面的句子。', thought: '这一段值得记下来', color: 'green', createdAt: at(30) },
      { id: 'n-ch1', locator: locator(5), chapterHref: 'OEBPS/chapter1.xhtml', text: '第一章开头的句子。', color: 'yellow', createdAt: at(60) }
    ]);
    await put(indent, [
      { id: 'n-indent', locator: locator(0), chapterHref: 'OEBPS/text/css.xhtml', text: '缩进测试书里的一条笔记。', color: 'pink', createdAt: at(5) }
    ]);
    return { epub: epub.id, indent: indent.id };
  });
}

test.describe('笔记', () => {
  test('list: a card per book and one for everything; search; a document in chapter order', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ids = await seedNotes(page);
    await page.goto(`${APP_PATH}?view=notes`);
    await expect(page.locator('.library-view h1')).toHaveText('笔记');
    await expect(page.locator('.library-summary')).toHaveText('2 本书 · 4 条笔记 · 1 条想法');
    await expect(page.locator('.notes-book-card')).toHaveCount(3);
    await expect(page.locator('.notes-all-card')).toContainText('全部笔记汇总');
    // Most recently updated first.
    await expect(page.locator('.notes-book-card:not(.notes-all-card) .notes-book-title')).toHaveText(['E2E Indent EPUB', 'E2E EPUB']);
    // The app's own menu: rounded panel under the trigger, the current choice marked.
    const trigger = page.locator('.notes-toolbar .custom-select-trigger');
    await expect(trigger).toHaveText('最近更新');
    await trigger.click();
    const menu = page.locator('#custom-options-notesPageSort');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[aria-selected="true"]')).toHaveText('最近更新');
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/notes-sort-menu.png`, clip: { x: 0, y: 0, width: 1280, height: 420 } });
    await menu.locator('[data-value="count"]').click();
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveText('笔记最多');
    await expect(page.locator('.notes-book-card:not(.notes-all-card) .notes-book-title')).toHaveText(['E2E EPUB', 'E2E Indent EPUB']);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/notes-list-desktop.png`, fullPage: true });

    await page.locator('.notes-search').fill('值得记下');
    // Sorting does not apply to search results, so the menu steps aside.
    await expect(trigger).toBeHidden();
    await expect(page.locator('.notes-search-results .notes-note')).toHaveCount(1);
    await expect(page.locator('.notes-search-results mark')).toHaveText('值得记下');
    await page.locator('.notes-note-book').click();
    await expect(page).toHaveURL(new RegExp(`view=notes&doc=${ids.epub}`));
    await expect(page.locator('[data-note-id="n-ch1-late"]')).toHaveClass(/is-focused/);

    // Reading order, grouped by the book's own chapter names.
    await expect(page.locator('.notes-doc-title')).toHaveText('E2E EPUB');
    await expect(page.locator('.notes-chapter-title')).toHaveText(['第一章', '第二章']);
    await expect(page.locator('.notes-note .notes-quote')).toHaveText(['第一章开头的句子。', '第一章后面的句子。', '第二章里划下的一句话。']);
    await expect(page.locator('.notes-thought')).toHaveText('这一段值得记下来');
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/notes-document-desktop.png`, fullPage: true });

    // Refresh keeps the document; back returns to the list.
    await page.reload();
    await expect(page.locator('.notes-doc-title')).toHaveText('E2E EPUB');
    await page.locator('.notes-back').click();
    await expect(page.locator('.notes-all-card')).toBeVisible();
    await expect(page).not.toHaveURL(/doc=/);

    await page.locator('.notes-all-card').click();
    await expect(page.locator('.notes-doc-title')).toHaveText('全部笔记汇总');
    await expect(page.locator('.notes-book-heading-title')).toHaveText(['E2E Indent EPUB', 'E2E EPUB']);
    await page.goBack();
    await expect(page.locator('.notes-all-card')).toBeVisible();
  });

  test('跳到原文 opens the book at the passage, and returning lands on the document', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(APP_PATH);
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await openEpubFixture(page);
    if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
    const target = await page.evaluate(() => document.querySelector('#article .epub-chapter p').textContent.trim().slice(2, 12));
    expect(await selectArticleText(page, target)).toBe(true);
    await commitSelectionHighlight(page);
    const bookId = await page.evaluate(() => state.currentBookId);
    await page.locator('#btnBackToLibrary').click();

    await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
    await expect(page.locator('.notes-quote')).toHaveText(target);
    await page.locator('.notes-action', { hasText: '跳到原文' }).click();
    await expect(page.locator('#article')).toContainText(target);
    await expect(page.locator('.br-highlight-box').first()).toBeVisible();
    await page.locator('#btnBackToLibrary').click();
    await expect(page.locator('.notes-doc-title')).toHaveText('E2E EPUB');
  });

  test('phones: one column, nothing wider than the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    const ids = await seedNotes(page);
    await page.goto(`${APP_PATH}?view=notes`);
    await expect(page.locator('.notes-book-card')).toHaveCount(3);
    const overflow = () => page.evaluate(() => document.getElementById('reader').scrollWidth - document.getElementById('reader').clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/notes-list-phone.png` });
    await page.goto(`${APP_PATH}?view=notes&doc=${ids.epub}`);
    await expect(page.locator('.notes-note')).toHaveCount(3);
    expect(await overflow()).toBeLessThanOrEqual(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/notes-document-phone.png` });
  });

  test('no notes yet explains where they come from', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.evaluate(async () => {
      const library = await window.browserHost.getLibrary();
      for (const book of library.books.filter((item) => item.type === 'epub')) {
        await fetch(`/app/zhenshu/api/books/${book.id}/highlights`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ highlights: [] })
        });
      }
    });
    await page.goto(`${APP_PATH}?view=notes`);
    const summary = await page.evaluate(() => window.browserHost.getNotesSummary());
    if (summary.totals.notes === 0) {
      await expect(page.locator('.notes-empty')).toContainText('还没有笔记');
    }
  });
});
