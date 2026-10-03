'use strict';

const { test, expect } = require('@playwright/test');
const { resetReaderSettings } = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

async function openMixedPdf(page) {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await page.reload();
  await page.locator('.library-book').filter({ hasText: 'e2e-mixed-images' }).click();
  await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-render-state', 'ready');
}

async function chooseTheme(page, theme) {
  if (!(await page.locator('#readerSettingsSheet').isVisible())) await page.locator('#btnSettings').click();
  await page.locator(`[data-theme-choice="${theme}"]`).click();
  await expect(page.locator('body')).toHaveAttribute('data-pdf-page-colors', theme);
}

test.describe('PDF page colours', () => {
  test('dark pages: soft inverted text, pictures keep their colours, scans invert whole', async ({ page }) => {
    await openMixedPdf(page);
    await chooseTheme(page, 'dark');
    const firstPage = page.locator('.pdf-page[data-page-index="0"]');
    await expect(firstPage.locator('.pdf-page-canvas')).toHaveCSS('filter', 'url("#zsPdfDarkFilter")');
    await expect(firstPage.locator('.pdf-image-restore')).toHaveCount(2);

    const pictures = await firstPage.evaluate((element) => [...element.querySelectorAll('.pdf-image-restore')].map((canvas) => {
      const context = canvas.getContext('2d');
      // Top-left quadrant of the 2x2 picture is red.
      const [r, g, b] = context.getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 4), 1, 1).data;
      return { left: parseFloat(canvas.style.left), top: parseFloat(canvas.style.top), width: parseFloat(canvas.style.width), r, g, b };
    }));
    // Direct image at x 72..232, y 520..640 of a 612x792 page; the form
    // XObject one at x 340..460, y 520..610.
    expect(pictures[0].left).toBeCloseTo((72 / 612) * 100, 0);
    expect(pictures[0].top).toBeCloseTo(((792 - 640) / 792) * 100, 0);
    expect(pictures[0].width).toBeCloseTo((160 / 612) * 100, 0);
    expect(pictures[1].left).toBeCloseTo((340 / 612) * 100, 0);
    for (const picture of pictures) {
      expect(picture.r).toBeGreaterThan(200);
      expect(picture.g).toBeLessThan(60);
      expect(picture.b).toBeLessThan(60);
    }

    // A page that is one big image (a scan) stays inverted as a whole.
    await page.locator('.pdf-page[data-page-index="1"]').scrollIntoViewIfNeeded();
    await expect(page.locator('.pdf-page[data-page-index="1"]')).toHaveAttribute('data-render-state', 'ready');
    await page.waitForTimeout(300);
    await expect(page.locator('.pdf-page[data-page-index="1"] .pdf-image-restore')).toHaveCount(0);

    // Selection and marks lighten a dark page instead of multiplying.
    await expect(firstPage.locator('.pdf-page-text-layer')).toHaveCSS('mix-blend-mode', 'screen');
  });

  test('护眼 tints the paper; 浅色 and 原样 show the page as printed', async ({ page }) => {
    await openMixedPdf(page);
    await chooseTheme(page, 'sepia');
    const firstPage = page.locator('.pdf-page[data-page-index="0"]');
    await expect(firstPage.locator('.pdf-page-canvas')).toHaveCSS('mix-blend-mode', 'multiply');
    await expect(firstPage).toHaveCSS('background-color', 'rgb(243, 232, 207)');

    await chooseTheme(page, 'light');
    await expect(firstPage.locator('.pdf-page-canvas')).toHaveCSS('filter', 'none');
    await expect(firstPage.locator('.pdf-page-canvas')).toHaveCSS('mix-blend-mode', 'normal');

    await chooseTheme(page, 'dark');
    await expect(page.locator('#settingPdfPageColors [data-pdf-page-colors="theme"]')).toHaveAttribute('aria-checked', 'true');
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
    await page.locator('#settingPdfPageColors [data-pdf-page-colors="original"]').click();
    expect((await (await saved).json()).pdfPageColors).toBe('original');
    await expect(page.locator('body')).toHaveAttribute('data-pdf-page-colors', 'original');
    await expect(firstPage.locator('.pdf-page-canvas')).toHaveCSS('filter', 'none');

    await page.reload();
    await expect(page.locator('.pdf-page[data-page-index="0"]')).toHaveAttribute('data-render-state', 'ready');
    await expect(page.locator('body')).toHaveAttribute('data-pdf-page-colors', 'original');
  });

  test('the colour choice only appears for PDFs', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
    await page.locator('#btnSettings').click();
    await expect(page.locator('.settings-pdf-colors-field')).toBeHidden();
  });
});
