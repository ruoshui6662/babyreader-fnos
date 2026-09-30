'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const samplePath = process.env.BABYREADER_E2E_SAMPLE_PDF;
test.skip(!samplePath, 'Set BABYREADER_E2E_SAMPLE_PDF to an absolute local PDF path to run the private sample check.');

test.afterAll(() => {
  if (!samplePath) return;
  const runtimeRoot = path.resolve(process.env.BABYREADER_E2E_RUNTIME_ROOT || '.runtime/e2e-resource-lifecycle');
  const libraryRoot = path.resolve(runtimeRoot, 'library');
  const copiedSample = path.resolve(libraryRoot, path.basename(samplePath));
  if (copiedSample.startsWith(`${libraryRoot}${path.sep}`)) fs.rmSync(copiedSample, { force: true });
});

test('private local PDF sample opens and renders through authorized range loading', async ({ page }) => {
  const ranges = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/books/') && response.url().endsWith('/content')) {
      ranges.push({ status: response.status(), type: response.headers()['content-type'] });
    }
  });
  await page.goto('/app/babyreader-fnos/');
  await page.locator('.library-book').first().waitFor({ state: 'visible' });
  const sampleTitle = path.basename(samplePath, path.extname(samplePath));
  await page.locator('.library-book').filter({ hasText: sampleTitle }).click();
  await expect(page.locator('#pdfReaderSurface')).toBeVisible();
  await expect(page.locator('#pdfReaderStatus')).not.toContainText('无法打开此 PDF');
  await expect(page.locator('#pdfPages canvas').first()).toBeVisible();
  await expect.poll(() => page.locator('#pdfPageCount').textContent()).not.toBe('/ 0');
  expect(ranges.some((response) => response.status === 206 && response.type.startsWith('application/pdf'))).toBeTruthy();
});
