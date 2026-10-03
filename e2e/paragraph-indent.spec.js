'use strict';

const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  selectArticleText,
  commitSelectionHighlight,
  readHighlightState
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

// Where each paragraph's first character sits, in characters (em) from the
// paragraph's content edge, grouped by whether the reader treats it as body.
async function measure(page) {
  return page.evaluate(() => {
    const rows = [];
    for (const element of document.querySelectorAll('#article p, #article div')) {
      if (!element.textContent.trim() || element.closest('.highlight-layer')) continue;
      if (element.tagName === 'DIV' && element.querySelector('p, div')) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let range = null;
      for (let node = walker.nextNode(); node && !range; node = walker.nextNode()) {
        const index = node.nodeValue.search(/[^\s 　]/);
        if (index < 0) continue;
        range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
      }
      const first = element.getClientRects()[0];
      const character = range?.getClientRects()[0];
      if (!first || !character) continue;
      const style = getComputedStyle(element);
      const contentLeft = first.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      rows.push({
        text: element.textContent.trim().slice(0, 8),
        body: element.dataset.zsPara === 'body',
        em: Math.round(((character.left - contentLeft) / parseFloat(style.fontSize)) * 100) / 100
      });
    }
    return rows;
  });
}

async function chooseIndent(page, value) {
  if (!(await page.locator('#readerSettingsSheet').isVisible())) await page.locator('#btnSettings').click();
  await page.locator(`#settingTextIndent [data-text-indent="${value}"]`).click();
  await expect(page.locator('html')).toHaveAttribute('data-text-indent', String(value));
}

async function openChapter(page, index) {
  await page.evaluate((target) => navigateToEpubChapter(target, { page: 1 }), index);
  await expect.poll(() => page.evaluate(() => state.epubChapterIndex)).toBe(index);
  await expect.poll(() => page.evaluate(() => isEpubChapterLoading())).toBe(false);
}

// Justification may stretch leading spaces a little (about 0.03em each).
const near = (value, expected) => Math.abs(value - expected) <= 0.1;

test.describe('First-line indent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_PATH);
    await resetReaderSettings(page);
    await page.reload();
    await page.locator('.library-book').filter({ hasText: 'E2E Indent EPUB' }).click();
    await expect(page.locator('#article')).toContainText('CSS 缩进');
  });

  test('the setting offers 原书 · 无 · 1-4 characters', async ({ page }) => {
    await page.locator('#btnSettings').click();
    await expect(page.locator('#settingTextIndent [data-text-indent]')).toHaveText(['原书', '无', '1', '2', '3', '4']);
    await expect(page.locator('#settingTextIndent [data-text-indent="2"]')).toHaveAttribute('aria-checked', 'true');
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
    await chooseIndent(page, 3);
    expect((await (await saved).json()).textIndent).toBe(3);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-text-indent', '3');
  });

  // [chapter, body paragraphs, kept paragraphs, first-character offset under 原书]
  const chapters = [
    [0, 10, ['注：这是一条悬挂', '内容简介这一段原', '——作者识', '＊　＊　＊', '清风明月枝头动疑'], () => 2],
    [1, 8, [], (row) => (row.text.startsWith('多一个') ? 3 : row.text.startsWith('没有空格') ? 0 : 2)],
    [2, 7, [], null],
    [3, 6, [], () => 1],
    [4, 5, [], () => 2],
    [5, 5, [], () => 0]
  ];

  for (const [index, bodyCount, kept, original] of chapters) {
    test(`chapter ${index + 1}: body text lands exactly N characters in, set-apart lines keep the book's layout`, async ({ page }) => {
      await openChapter(page, index);
      await chooseIndent(page, 'book');
      const book = await measure(page);
      expect(book.filter((row) => row.body)).toHaveLength(bodyCount);
      expect(book.filter((row) => !row.body).map((row) => row.text)).toEqual(kept);
      if (original) {
        for (const row of book.filter((item) => item.body)) {
          expect(near(row.em, original(row)), `${row.text}: ${row.em}em under 原书`).toBe(true);
        }
      }
      for (const value of [0, 1, 2, 3, 4]) {
        await chooseIndent(page, value);
        const rows = await measure(page);
        for (const row of rows.filter((item) => item.body)) {
          expect(near(row.em, value), `${row.text}: ${row.em}em at ${value}`).toBe(true);
        }
        // Lines the book set apart do not move.
        expect(rows.filter((row) => !row.body)).toEqual(book.filter((row) => !row.body));
      }
    });
  }

  test('a hanging note keeps its hang and centred lines stay centred', async ({ page }) => {
    await chooseIndent(page, 4);
    const layout = await page.evaluate(() => {
      const note = [...document.querySelectorAll('#article p')].find((element) => element.textContent.startsWith('注：'));
      const center = [...document.querySelectorAll('#article p')].find((element) => element.textContent.startsWith('＊'));
      return { noteIndent: getComputedStyle(note).textIndent, notePadding: getComputedStyle(note).paddingLeft, centerAlign: getComputedStyle(center).textAlign };
    });
    expect(parseFloat(layout.noteIndent)).toBeLessThan(0);
    expect(parseFloat(layout.notePadding)).toBeGreaterThan(0);
    expect(layout.centerAlign).toBe('center');
  });
});

test('TXT novels: one line per paragraph, chapter lines as headings, indent follows the setting', async ({ page }) => {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await page.reload();
  await page.locator('.library-book').filter({ hasText: 'e2e-indent-novel' }).click();
  await expect(page.locator('#article h2')).toHaveText(['第一章 山居', '第二章 下山']);
  await expect(page.locator('#article p')).toHaveCount(10);
  await chooseIndent(page, 'book');
  const book = await measure(page);
  expect(book.filter((row) => row.text.startsWith('没有空格')).map((row) => row.em)).toEqual([0]);
  expect(book.filter((row) => !row.text.startsWith("没有空格")).every((row) => near(row.em, 2)), JSON.stringify(book)).toBe(true);
  for (const value of [0, 3]) {
    await chooseIndent(page, value);
    const rows = await measure(page);
    expect(rows.every((row) => row.body && near(row.em, value)), JSON.stringify(rows)).toBe(true);
  }
});

test('Markdown documents are not indented', async ({ page }) => {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await page.reload();
  await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
  await expect(page.locator('#article')).toContainText('E2E Reader');
  const rows = await measure(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => !row.body && near(row.em, 0))).toBe(true);
});

test('changing the indent never moves a saved highlight', async ({ page }) => {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
  const target = await page.evaluate(() => document.querySelector('#article .epub-chapter p').textContent.trim().slice(2, 10));
  expect(await selectArticleText(page, target)).toBe(true);
  const { after } = await commitSelectionHighlight(page);
  expect(after).toHaveLength(1);
  for (const value of ['book', 0, 4]) {
    await chooseIndent(page, value);
    await page.reload();
    await expect(page.locator('.br-highlight-box').first()).toBeVisible();
    const marked = await page.evaluate(() => {
      const box = document.querySelector('.br-highlight-box').getBoundingClientRect();
      const range = rangeFromHighlight(loadHighlights()[0]);
      return { text: range?.toString(), overlaps: range ? [...range.getClientRects()].some((rect) => Math.abs(rect.top - box.top) < 4) : false };
    });
    expect(marked.text).toBe(target);
    expect(marked.overlaps).toBe(true);
  }
  expect(await readHighlightState(page)).toHaveLength(1);
});
