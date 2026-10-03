'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';
const SCREENSHOT_DIR = process.env.ZHENSHU_SCREENSHOT_DIR || null;

async function seedNotes(page) {
  await page.goto(APP_PATH);
  await resetEpubFixtureState(page);
  return page.evaluate(async () => {
    const library = await window.browserHost.getLibrary();
    const epub = library.books.find((book) => book.title === 'E2E EPUB');
    const indent = library.books.find((book) => book.title === 'E2E Indent EPUB');
    const locator = (offset) => JSON.stringify({ version: 1, type: 'dom-range', startTextOffset: offset });
    const put = (book, highlights) => fetch(`/app/zhenshu/api/books/${book.id}/highlights`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ highlights })
    });
    await put(epub, [
      { id: 'e2', locator: locator(3), chapterHref: 'OEBPS/chapter2.xhtml', text: '第二章里划下的一句话。', color: 'blue', createdAt: '2026-09-22T12:00:00Z' },
      { id: 'e1', locator: locator(5), chapterHref: 'OEBPS/chapter1.xhtml', text: '我们读书，不是为了记住书里的每一句话，而是为了在某个平常的午后，忽然想起其中一句。', thought: '书比人更擅长理解人。', color: 'green', createdAt: '2026-09-21T12:00:00Z' }
    ]);
    await put(indent, [
      { id: 'i1', locator: locator(0), chapterHref: 'OEBPS/text/css.xhtml', text: '缩进测试书里的一条笔记。', color: 'pink', createdAt: '2026-09-23T12:00:00Z' }
    ]);
    return { epub: epub.id, indent: indent.id };
  });
}

async function downloadText(page, button) {
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  const target = path.join(test.info().outputDir, file.suggestedFilename());
  await file.saveAs(target);
  return { name: file.suggestedFilename(), text: fs.readFileSync(target, 'utf8') };
}

// Stand in for the print dialog: keep the page that would be printed.
async function capturePrint(page) {
  await page.evaluate(() => {
    window.__printedHtml = null;
    window.__zhenshuNotesPrint = (win) => { window.__printedHtml = win.document.documentElement.outerHTML; };
  });
}

test.describe('笔记导出', () => {
  test('one book: Markdown in reading order, and a print page for PDF', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const ids = await seedNotes(page);
    await page.goto(`${APP_PATH}?view=notes&doc=${ids.epub}`);
    const { name, text } = await downloadText(page, page.locator('.notes-export-md'));
    expect(name).toMatch(/^E2EEPUB-读书笔记-\d{8}\.md$/);
    expect(text.split('\n')[0]).toBe('# 《E2E EPUB》读书笔记');
    expect(text).toContain('2 条书摘 · 1 条想法');
    expect(text.indexOf('## 第一章')).toBeLessThan(text.indexOf('## 第二章'));
    expect(text).toContain('**想法**：书比人更擅长理解人。');

    await capturePrint(page);
    await page.locator('.notes-export-pdf').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__printedHtml))).toBe(true);
    const html = await page.evaluate(() => window.__printedHtml);
    expect(html).toContain('《E2E EPUB》');
    expect(html).toContain('<h2 class="chapter">第一章</h2>');
    expect(html).toContain('书比人更擅长理解人。');
    // The serif face was loaded inside the frame before printing.
    expect(await page.frameLocator('#notesPrintFrame').locator('body').evaluate(() => document.fonts.check('11pt "Noto Serif SC"', '读书'))).toBe(true);

    if (SCREENSHOT_DIR) {
      const preview = await page.context().newPage();
      await preview.goto(APP_PATH);
      await preview.setContent(html, { waitUntil: 'networkidle' });
      await preview.emulateMedia({ media: 'print' });
      await preview.evaluate(() => document.fonts.ready);
      await preview.pdf({ path: path.join(SCREENSHOT_DIR, 'notes-book.pdf'), format: 'A4', printBackground: true });
      await preview.setViewportSize({ width: 794, height: 1123 });
      await preview.screenshot({ path: path.join(SCREENSHOT_DIR, 'notes-book-print.png') });
      await preview.close();
    }
  });

  test('all notes: Markdown with every book, PDF with a contents list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedNotes(page);
    await page.goto(`${APP_PATH}?view=notes&doc=all`);
    await expect(page.locator('.notes-export-md')).toBeEnabled();
    const { name, text } = await downloadText(page, page.locator('.notes-export-md'));
    expect(name).toMatch(/^全部读书笔记-\d{8}\.md$/);
    expect(text).toContain('## 《E2E EPUB》');
    expect(text).toContain('## 《E2E Indent EPUB》');
    expect(text).toContain('### 第一章');

    await capturePrint(page);
    await page.locator('.notes-export-pdf').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__printedHtml))).toBe(true);
    const html = await page.evaluate(() => window.__printedHtml);
    expect(html).toContain('<ol class="toc">');
    expect((html.match(/<section class="book">/g) || []).length).toBeGreaterThanOrEqual(2);
    if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'notes-all-header.png') });
  });

  test('phones: the four document actions wrap without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    const ids = await seedNotes(page);
    await page.goto(`${APP_PATH}?view=notes&doc=${ids.epub}`);
    await expect(page.locator('.notes-doc-actions button')).toHaveCount(4);
    expect(await page.evaluate(() => document.getElementById('reader').scrollWidth - document.getElementById('reader').clientWidth)).toBeLessThanOrEqual(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'notes-export-phone.png') });
  });
});
