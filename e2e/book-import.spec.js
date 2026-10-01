const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { zipSync, strToU8 } = require('fflate');

// MOBI/import plan Task 5: admin import through the file picker and by drag
// and drop in a real browser. The spec turns import on, and afterwards removes
// every imported file, turns import off and rescans (workers: 1).

const APP_PATH = '/app/zhenshu/';
const RUNTIME = path.resolve(__dirname, '..', process.env.ZHENSHU_E2E_RUNTIME_ROOT || '.runtime/e2e-resource-lifecycle');
const IMPORT_DIR = path.join(RUNTIME, 'share', 'zhenshu', 'library', '导入');

function epubBytes(title, body) {
  return Buffer.from(zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>导入测试</dc:creator><dc:language>zh</dc:language></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c"/></spine></package>`),
    'OEBPS/nav.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c.xhtml">正文</a></li></ol></nav></body></html>'),
    'OEBPS/c.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`)
  }));
}

// Built once: ZIP entries carry the build time, so re-zipping the same book
// would not be byte-identical and must not be expected to count as a duplicate.
const FIRST_BOOK = epubBytes('浏览器导入的书', '这是通过导入按钮加入书库的正文。');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  expect((await request.post(`${APP_PATH}api/library/scan`)).ok()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  fs.rmSync(IMPORT_DIR, { recursive: true, force: true });
  await request.post(`${APP_PATH}api/library/scan`);
});

test('an admin imports a book with the file picker and reads it right away', async ({ page }) => {
  await page.goto(APP_PATH);
  const button = page.locator('.library-header-actions .library-import-button');
  await expect(button).toHaveText('导入');
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name: '导入的书.epub', mimeType: 'application/epub+zip', buffer: FIRST_BOOK });

  const row = page.locator('.library-import-item').filter({ hasText: '导入的书.epub' });
  await expect(row).toHaveAttribute('data-status', 'done');
  await expect(page.locator('.library-grid .library-book').filter({ hasText: '浏览器导入的书' })).toBeVisible();
  expect(fs.existsSync(path.join(IMPORT_DIR, '导入的书.epub'))).toBeTruthy();

  await row.locator('.library-import-action').click();
  await expect(page.locator('#fileName')).toHaveText('浏览器导入的书');
  await expect(page.locator('#article')).toContainText('这是通过导入按钮加入书库的正文。');
});

test('importing the same content again points to the existing book', async ({ page }) => {
  await page.goto(APP_PATH);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.library-import-button').click();
  await (await chooser).setFiles({ name: '改了名字.epub', mimeType: 'application/epub+zip', buffer: FIRST_BOOK });
  const row = page.locator('.library-import-item').filter({ hasText: '改了名字.epub' });
  await expect(row).toHaveAttribute('data-status', 'duplicate');
  await expect(row).toContainText('书库中已有这本书');
  await expect(row.locator('.library-import-action')).toHaveText('打开');
});

test('dropping a file on the shelf imports it; unsupported files are refused before upload', async ({ page }) => {
  await page.goto(APP_PATH);
  const shell = page.locator('.library-view');
  const dataTransfer = await page.evaluateHandle(({ bytes }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], '拖进来的书.epub', { type: 'application/epub+zip' }));
    transfer.items.add(new File(['MZ'], '程序.exe'));
    return transfer;
  }, { bytes: [...epubBytes('拖放导入的书', '拖放正文。')] });
  await shell.dispatchEvent('dragenter', { dataTransfer });
  await expect(shell).toHaveClass(/is-import-drop/);
  await shell.dispatchEvent('drop', { dataTransfer });
  await expect(shell).not.toHaveClass(/is-import-drop/);

  await expect(page.locator('.library-import-item').filter({ hasText: '程序.exe' })).toHaveAttribute('data-status', 'rejected');
  await expect(page.locator('.library-import-item').filter({ hasText: '拖进来的书.epub' })).toHaveAttribute('data-status', 'done');
  await expect(page.locator('.library-grid .library-book').filter({ hasText: '拖放导入的书' })).toBeVisible();
  await page.locator('.library-import-close').click();
  await expect(page.locator('#libraryImportPanel')).toBeHidden();
});
