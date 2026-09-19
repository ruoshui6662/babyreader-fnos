'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { strToU8, zipSync } = require('fflate');

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, '.runtime', 'e2e');
const configRoot = path.join(runtimeRoot, 'etc');
const dataRoot = path.join(runtimeRoot, 'var');
const libraryRoot = path.join(runtimeRoot, 'library');

fs.rmSync(runtimeRoot, { recursive: true, force: true });
fs.mkdirSync(configRoot, { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(libraryRoot, { recursive: true });

fs.writeFileSync(path.join(libraryRoot, 'e2e-reader.md'), [
  '---',
  'title: E2E Markdown',
  'author: Playwright',
  '---',
  '',
  '# E2E Reader',
  '',
  '这是 Chromium 端到端测试使用的临时书籍。',
  '',
  '第二段用于验证排版设置和真实浏览器渲染。'
].join('\n'), 'utf8');

fs.writeFileSync(path.join(libraryRoot, 'plain-text.txt'), [
  'E2E Plain Text',
  '',
  'A deterministic text fixture for BabyReader.'
].join('\n'), 'utf8');

const epub = zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">babyreader-e2e</dc:identifier>
    <dc:title>E2E EPUB</dc:title>
    <dc:creator>Playwright</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>`),
  'OEBPS/nav.xhtml': strToU8(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>TOC</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="chapter1.xhtml">第一章</a></li>
  <li><a href="chapter2.xhtml">第二章</a></li>
</ol></nav></body>
</html>`),
  'OEBPS/chapter1.xhtml': strToU8(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第一章</title></head>
<body>
  <h1>E2E EPUB Chapter</h1>
  <p>这是 Playwright 使用真实 Chromium 打开的 EPUB 内容。</p>
  <p>第二段用于验证移动端工具栏、目录和阅读器脚本协作。</p>
</body>
</html>`),
  'OEBPS/chapter2.xhtml': strToU8(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第二章</title></head>
<body>
  <h1>E2E EPUB Second Chapter</h1>
  <p>第二章用于验证目录跨章节跳转、阅读进度和状态恢复。</p>
</body>
</html>`)
});
fs.writeFileSync(path.join(libraryRoot, 'e2e-reader.epub'), Buffer.from(epub));

fs.writeFileSync(
  path.join(configRoot, 'settings.json'),
  JSON.stringify({ libraryRoots: [libraryRoot] }, null, 2),
  'utf8'
);

Object.assign(process.env, {
  NODE_ENV: 'development',
  BABYREADER_DEV_PORT: '8099',
  BABYREADER_DEV_UID: 'playwright-user',
  BABYREADER_DEV_USERNAME: 'Playwright User',
  TRIM_PKGETC: configRoot,
  TRIM_PKGVAR: dataRoot,
  TRIM_PKGTMP: path.join(runtimeRoot, 'tmp')
});

const { start } = require('../app/server/index');

async function waitForHealth() {
  const url = 'http://127.0.0.1:8099/app/babyreader-fnos/api/health';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('E2E server did not become healthy');
}

async function main() {
  await start();
  await waitForHealth();
  const response = await fetch('http://127.0.0.1:8099/app/babyreader-fnos/api/library/scan', {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`Initial E2E library scan failed: ${response.status} ${await response.text()}`);
  }
  console.log('BabyReader E2E fixture library is ready');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
