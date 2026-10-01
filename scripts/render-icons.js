'use strict';

// Renders app/ui/images/logo.svg into every PNG fnOS needs, using the
// Playwright Chromium already installed for E2E (no extra tooling).
// fnOS spec: ICON.PNG 64x64, ICON_256.PNG 256x256, square, sRGB, <= 1024 KB;
// launcher icons live in app/ui/images as icon_{size}.png.

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'app/ui/images/logo.svg'), 'utf8');
const outputs = [
  ['ICON.PNG', 64],
  ['ICON_256.PNG', 256],
  ['app/ui/images/icon_64.png', 64],
  ['app/ui/images/icon_256.png', 256]
];

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [file, size] of outputs) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg
        .replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
      const target = path.join(root, file);
      // type is explicit: Playwright infers it from the extension and does not
      // recognise the upper-case .PNG that fnOS requires.
      fs.writeFileSync(target, await page.screenshot({
        type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size }
      }));
      const bytes = fs.statSync(target).size;
      if (bytes > 1024 * 1024) throw new Error(`${file} exceeds the fnOS 1024 KB icon limit`);
      console.log(`${file}: ${size}x${size}, ${(bytes / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
