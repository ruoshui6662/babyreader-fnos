'use strict';

const fs = require('fs');
const path = require('path');
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

const SAMPLE = {
  text: '我们读书，不是为了记住书里的每一句话，而是为了在某个平常的午后，忽然想起其中一句，觉得自己被理解了。好的句子像一盏灯，照亮的不是书页，而是我们自己走过的路。',
  thought: '读到这里停了很久。原来“被理解”这件事，书比人更擅长。',
  chapter: '第三章 · 灯下',
  createdAt: '2026-10-02T21:30:00+08:00',
  color: 'green'
};

async function seedCardNote(page) {
  await page.goto(APP_PATH);
  await resetEpubFixtureState(page);
  await page.evaluate(() => { try { localStorage.removeItem('zhenshu-note-card'); } catch { /* ignore */ } });
  return page.evaluate(async (sample) => {
    const library = await window.browserHost.getLibrary();
    const epub = library.books.find((book) => book.title === 'E2E EPUB');
    await fetch(`/app/zhenshu/api/books/${epub.id}/highlights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ highlights: [{
        id: 'card-note',
        locator: JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: 5 }),
        chapterHref: 'OEBPS/chapter1.xhtml',
        text: sample.text,
        thought: sample.thought,
        color: 'green',
        createdAt: sample.createdAt
      }] })
    });
    return epub.id;
  }, SAMPLE);
}

async function canvasSize(page) {
  return page.locator('.note-card-preview canvas').evaluate((canvas) => [canvas.width, canvas.height]);
}

test.describe('书摘卡片', () => {
  test('from the notes document: templates, fonts, shapes, toggles, save', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const bookId = await seedCardNote(page);
    await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
    await page.locator('[data-note-id="card-note"] .notes-action', { hasText: '卡片' }).click();

    const dialog = page.locator('.note-card-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.note-card-preview')).not.toHaveAttribute('aria-busy', 'true');
    expect(await canvasSize(page)).toEqual([1080, 1440]);
    // Defaults: 书页, 思源宋体, 3:4, everything shown; the font really loaded.
    await expect(dialog.locator('[data-template="paper"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('[data-font="source-serif"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('[data-toggle]')).toHaveCount(4);
    expect(await page.evaluate(() => document.fonts.check('40px "Noto Serif SC"', '读书'))).toBe(true);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/card-dialog-desktop.png` });

    await dialog.locator('[data-ratio="16:9"]').click();
    await expect.poll(() => canvasSize(page)).toEqual([1920, 1080]);
    await dialog.locator('[data-ratio="1:1"]').click();
    await expect.poll(() => canvasSize(page)).toEqual([1080, 1080]);
    await dialog.locator('[data-template="ink"]').click();
    await dialog.locator('[data-font="wenkai"]').click();
    await expect.poll(() => page.evaluate(() => document.fonts.check('40px "LXGW WenKai"', '读书'))).toBe(true);
    await dialog.locator('[data-toggle="thought"]').click();
    await expect(dialog.locator('[data-toggle="thought"]')).toHaveAttribute('aria-pressed', 'false');

    // Choices are remembered for the next card.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zhenshu-note-card')));
    expect(saved).toMatchObject({ template: 'ink', font: 'wenkai', ratio: '1:1', thought: false });

    const download = page.waitForEvent('download');
    await dialog.locator('.note-card-primary').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^枕书-E2EEPUB-\d{8}-\d{4}\.png$/);
    const saveTo = path.join(test.info().outputDir, 'card.png');
    await file.saveAs(saveTo);
    const bytes = fs.readFileSync(saveTo);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    // 1080 × 1080, read from the PNG header.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1080, 1080]);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('long passages shrink, then are cut with a note; Chinese punctuation never starts a line', async ({ page }) => {
    await page.goto(APP_PATH);
    const result = await page.evaluate(async (sample) => {
      const { renderNoteCard, noteCardBreakLines } = window.__zhenshuNoteCard;
      const short = await renderNoteCard({ ...sample, book: { title: '灯下' } }, { ratio: '3:4' });
      const long = await renderNoteCard({ ...sample, text: sample.text.repeat(8), book: { title: '灯下' } }, { ratio: '1:1' });
      // Fixed-width measure: every character 1 wide, lines of 5.
      const lines = noteCardBreakLines(() => 1, '一二三四五，六七八九十。“甲乙丙丁”', 5)
        .map((line) => line.units.map((unit) => unit.text).join(''));
      return { short: short.noteCard, long: long.noteCard, lines };
    }, SAMPLE);
    expect(result.short.truncated).toBe(false);
    expect(result.short.size).toBeGreaterThanOrEqual(44);
    expect(result.long.truncated).toBe(true);
    expect(result.lines).toEqual(['一二三四五，', '六七八九十。', '“甲乙丙丁”']);
    for (const line of result.lines) expect('，。、；：？！）》」』”’…'.includes(line[0])).toBe(false);
  });

  test('from the reader: the desktop editor and the phone bubble both open a card', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(APP_PATH);
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await openEpubFixture(page);
    if (await page.locator('#readerDrawer').isVisible()) await page.locator('#btnCloseSettings').click();
    const target = await page.evaluate(() => document.querySelector('#article .epub-chapter p').textContent.trim().slice(2, 14));
    expect(await selectArticleText(page, target)).toBe(true);
    await commitSelectionHighlight(page);
    await page.locator('.br-highlight-box').first().click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await page.locator('#highlightEditorThought').fill('还没保存的想法');
    await page.locator('#btnHighlightCard').click();
    const dialog = page.locator('.note-card-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.note-card-preview canvas')).toHaveAttribute('aria-label', new RegExp(target.slice(0, 6)));
    // The unsaved thought is on the card (its toggle is offered).
    await expect(dialog.locator('[data-toggle="thought"]')).toBeVisible();
  });

  test('phones: the dialog fills the screen and the preview fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    const bookId = await seedCardNote(page);
    await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
    await page.locator('[data-note-id="card-note"] .notes-action', { hasText: '卡片' }).click();
    const dialog = page.locator('.note-card-dialog');
    await expect(dialog.locator('.note-card-preview')).not.toHaveAttribute('aria-busy', 'true');
    const box = await dialog.locator('.note-card-preview canvas').boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => {
      const element = document.querySelector('.note-card-layout');
      return element.scrollWidth - element.clientWidth;
    })).toBeLessThanOrEqual(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/card-dialog-phone.png` });
  });

  test('sample cards for review', async ({ page }) => {
    test.skip(!SCREENSHOT_DIR, 'only when collecting screenshots');
    await page.goto(APP_PATH);
    const cover = await page.evaluate(async () => {
      const library = await window.browserHost.getLibrary();
      return library.books.find((book) => book.coverUrl)?.coverUrl || null;
    });
    const shots = await page.evaluate(async ({ sample, cover }) => {
      const { renderNoteCard } = window.__zhenshuNoteCard;
      const book = { title: '灯下读书记', author: '枕书编辑部', coverUrl: cover };
      const out = {};
      for (const [template, font] of [['paper', 'source-serif'], ['letter', 'fangsong'], ['ink', 'wenkai']]) {
        for (const ratio of ['3:4', '1:1', '16:9']) {
          const canvas = await renderNoteCard({ ...sample, book }, { template, font, ratio });
          out[`card-${template}-${ratio.replace(':', 'x')}`] = canvas.toDataURL('image/png');
        }
      }
      return out;
    }, { sample: SAMPLE, cover });
    for (const [name, url] of Object.entries(shots)) {
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
  });
});

const LONG_NOTES = [
  { id: 'l1', chapter: '第一章 · 灯下', color: 'yellow', text: '书是安静的朋友，它不催你，也不怪你来得太迟。', thought: '' },
  { id: 'l2', chapter: '第一章 · 灯下', color: 'green', text: '我们读书，不是为了记住书里的每一句话，而是为了在某个平常的午后，忽然想起其中一句，觉得自己被理解了。', thought: '原来“被理解”这件事，书比人更擅长。' },
  { id: 'l3', chapter: '第二章 · 远行', color: 'blue', text: '走得越远，越知道自己从哪里来；读得越多，越知道自己还不知道什么。', thought: '' },
  { id: 'l4', chapter: '第二章 · 远行', color: 'pink', text: '所谓成长，就是把别人的句子，慢慢读成自己的经验。', thought: '想起第一次读这本书的那个冬天。' }
].map((note, index) => ({ ...note, createdAt: `2026-09-${String(20 + index).padStart(2, '0')}T21:00:00+08:00` }));

async function seedLongNotes(page) {
  await page.goto(APP_PATH);
  await resetEpubFixtureState(page);
  return page.evaluate(async () => {
    const library = await window.browserHost.getLibrary();
    const epub = library.books.find((book) => book.title === 'E2E EPUB');
    const locator = (offset) => JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: offset });
    await fetch(`/app/zhenshu/api/books/${epub.id}/highlights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ highlights: [
        { id: 'a', locator: locator(5), chapterHref: 'OEBPS/chapter1.xhtml', text: '第一章开头的句子。', color: 'yellow', createdAt: new Date().toISOString() },
        { id: 'b', locator: locator(40), chapterHref: 'OEBPS/chapter1.xhtml', text: '第一章后面的句子。', thought: '记一笔', color: 'green', createdAt: new Date().toISOString() },
        { id: 'c', locator: locator(3), chapterHref: 'OEBPS/chapter2.xhtml', text: '第二章里划下的一句话。', color: 'blue', createdAt: new Date().toISOString() }
      ] })
    });
    return epub.id;
  });
}

test.describe('书摘长图', () => {
  test('choose notes in the document, then one tall picture in reading order', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const bookId = await seedLongNotes(page);
    await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
    await page.locator('.notes-long-image').click();
    const bar = page.locator('.notes-select-bar');
    await expect(bar.locator('.notes-select-count')).toHaveText('已选 3 / 3 条');
    await expect(page.locator('.notes-select')).toHaveCount(3);
    // Clicking a note leaves it out; its actions are hidden while choosing.
    await page.locator('[data-note-id="b"] .notes-quote').click();
    await expect(bar.locator('.notes-select-count')).toHaveText('已选 2 / 3 条');
    await expect(page.locator('[data-note-id="b"]')).not.toHaveClass(/is-selected/);
    await expect(page.locator('[data-note-id="a"] .notes-note-actions')).toBeHidden();
    await bar.locator('.notes-select-all').click();
    await expect(bar.locator('.notes-select-count')).toHaveText('已选 3 / 3 条');
    await bar.locator('.notes-select-all').click();
    await expect(bar.locator('.notes-select-generate')).toBeDisabled();
    await page.locator('[data-note-id="a"] .notes-select').check();
    await page.locator('[data-note-id="c"] .notes-select').check();
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/long-select-desktop.png` });
    await bar.locator('.notes-select-generate').click();

    const dialog = page.locator('.note-card-dialog.is-long');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.note-card-preview')).not.toHaveAttribute('aria-busy', 'true');
    await expect(dialog.locator('[data-ratio]')).toHaveCount(0);
    await expect(dialog.locator('.note-card-preview canvas')).toHaveCount(1);
    await expect(dialog.locator('.note-card-status')).toHaveText('2 条书摘，一张图片。');
    const size = await dialog.locator('canvas').evaluate((canvas) => [canvas.width, canvas.height]);
    expect(size[0]).toBe(1080);
    expect(size[1]).toBeGreaterThan(1200);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/long-dialog-desktop.png` });

    const download = page.waitForEvent('download');
    await dialog.locator('.note-card-primary').click();
    expect((await download).suggestedFilename()).toMatch(/^枕书-E2EEPUB-书摘长图-\d{8}-\d{4}\.png$/);
    await page.keyboard.press('Escape');
    await bar.locator('.notes-select-cancel').click();
    await expect(page.locator('.notes-select')).toHaveCount(0);
    await expect(page.locator('[data-note-id="a"] .notes-note-actions')).toBeVisible();
  });

  test('a hundred long notes come out quickly, cut into pages between notes', async ({ page }) => {
    await page.goto(APP_PATH);
    const result = await page.evaluate(async (base) => {
      const notes = Array.from({ length: 100 }, (_, index) => ({
        ...base[index % base.length],
        id: `n${index}`,
        chapter: `第${Math.floor(index / 10) + 1}章`,
        text: base[index % base.length].text.repeat(1 + (index % 3))
      }));
      const started = performance.now();
      const pages = await window.__zhenshuNoteCard.renderNotesLongImage({ book: { title: '百条书摘' }, notes }, { template: 'paper' });
      return { ms: performance.now() - started, heights: pages.map((canvas) => canvas.height), widths: pages.map((canvas) => canvas.width) };
    }, LONG_NOTES);
    expect(result.heights.length).toBeGreaterThan(1);
    for (const height of result.heights) expect(height).toBeLessThanOrEqual(8000);
    expect(new Set(result.widths)).toEqual(new Set([1080]));
    expect(result.ms).toBeLessThan(5000);
  });

  test('phones: choosing and the long picture fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    const bookId = await seedLongNotes(page);
    await page.goto(`${APP_PATH}?view=notes&doc=${bookId}`);
    await page.locator('.notes-long-image').click();
    await expect(page.locator('.notes-select-bar')).toBeVisible();
    const overflow = () => page.evaluate(() => document.getElementById('reader').scrollWidth - document.getElementById('reader').clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/long-select-phone.png` });
    await page.locator('.notes-select-generate').click();
    await expect(page.locator('.note-card-preview')).not.toHaveAttribute('aria-busy', 'true');
    const box = await page.locator('.note-card-preview canvas').boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/long-dialog-phone.png` });
  });

  test('sample long pictures for review', async ({ page }) => {
    test.skip(!SCREENSHOT_DIR, 'only when collecting screenshots');
    await page.goto(APP_PATH);
    const shots = await page.evaluate(async (notes) => {
      const book = { title: '灯下读书记', author: '枕书编辑部' };
      const out = {};
      for (const [template, font] of [['paper', 'source-serif'], ['letter', 'fangsong'], ['ink', 'wenkai']]) {
        const [canvas] = await window.__zhenshuNoteCard.renderNotesLongImage({ book, notes }, { template, font, thought: true, date: true, cover: true });
        out[`long-${template}`] = canvas.toDataURL('image/png');
      }
      return out;
    }, LONG_NOTES);
    for (const [name, url] of Object.entries(shots)) {
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
  });
});
