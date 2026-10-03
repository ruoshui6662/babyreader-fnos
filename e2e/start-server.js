'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { strToU8, zipSync, unzipSync } = require('fflate');
const { randomBytes } = require('node:crypto');
const { FIXTURE_TEXT } = require('./fixtures/reader-fixtures');
const { createCorruptPdfFixture, createImageOnlyPdfFixture, createMixedImagePdfFixture, createPdfFixture } = require('../tests/fixtures/pdf-fixtures');

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.resolve(process.env.ZHENSHU_E2E_RUNTIME_ROOT || path.join(root, '.runtime', 'e2e'));
const configRoot = path.join(runtimeRoot, 'etc');
const dataRoot = path.join(runtimeRoot, 'var');
const libraryRoot = path.join(runtimeRoot, 'library');
// Empty stand-in for the app's fnOS data share (zhenshu/library); the
// import spec writes here. It adds no books, so other specs see no change.
const shareRoot = path.join(runtimeRoot, 'share', 'zhenshu', 'library');
const sampleEpubPath = process.env.ZHENSHU_E2E_SAMPLE_EPUB;
const samplePdfPath = process.env.ZHENSHU_E2E_SAMPLE_PDF;

fs.rmSync(runtimeRoot, { recursive: true, force: true });
fs.mkdirSync(configRoot, { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(libraryRoot, { recursive: true });
fs.mkdirSync(shareRoot, { recursive: true });

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
  'A deterministic text fixture for 枕书.'
].join('\n'), 'utf8');

const e2ePdf = createPdfFixture({
  pageTexts: [
    '第一页：页面内重复检索词。第二行：标记后仍能选中的文字。重复检索词再次出现。',
    '第二页：这一页含有第二页精确定位词。',
    '第三页：PDF全文搜索的跨页唯一命中。',
    `第四页：末页内容。${'用于验证局部 Range 请求的固定测试文本。'.repeat(1200)}`
  ]
});
// Keep the synthetic document larger than PDF.js's two 64 KiB range chunks
// without inflating a rendered page's text layer or changing searchable text.
fs.writeFileSync(path.join(libraryRoot, 'e2e-reader.pdf'), Buffer.concat([
  e2ePdf,
  Buffer.from(`\n% Range request fixture padding\n${' '.repeat(140_000)}`, 'ascii')
]));
fs.writeFileSync(path.join(libraryRoot, 'e2e-annotation.pdf'), createPdfFixture({
  pageTexts: [
    '第一页：标记选择测试。\n第二行：标记后仍能选中的文字。',
    '第二页：验证远离视口后，标注画布随页面回收。',
    '第三页：覆盖层回收测试。',
    '第四页：返回第一页时重新绘制标注。'
  ]
}));
fs.writeFileSync(path.join(libraryRoot, 'e2e-columns.pdf'), createPdfFixture({
  pageColumns: [
    [{ text: '封面页。', x: 72, y: 720 }],
    [{ text: '跨页左页内容。', x: 72, y: 720 }],
    [
      { text: '左栏重复词，左栏独有结论。', x: 72, y: 720 },
      { text: '右栏重复词，右栏独有依据。', x: 310, y: 720 }
    ]
  ]
}));
fs.writeFileSync(path.join(libraryRoot, 'e2e-image-only.pdf'), createImageOnlyPdfFixture());
fs.writeFileSync(path.join(libraryRoot, 'e2e-corrupt.pdf'), createCorruptPdfFixture());
fs.writeFileSync(path.join(libraryRoot, 'e2e-mixed-images.pdf'), createMixedImagePdfFixture());

// Deterministic long paragraph builder. Each chapter repeats the same body
// text so highlight tests can assert that deleting one identical-text
// highlight never removes its twin, and double-page mode yields 5-7 columns.
function longChapter(id, label) {
  const sentence = `第${label}章测试段落。这段正文用于验证分页排版时列宽计算与页组对齐是否真正生效，同时提供足够长度让 Chromium 在双页模式下生成多列。`;
  const repeated = `${sentence}${FIXTURE_TEXT.repeatedPhrase}。${sentence}`;
  const paragraphs = Array.from({ length: 12 }, (_, index) =>
    `<p>第${label}章第${index + 1}段。${repeated}</p>`).join('\n  ');
  return `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第${label}章</title></head>
<body>
  <h1>E2E EPUB Chapter ${id}</h1>
  ${paragraphs}
</body>
</html>`;
}

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
    <dc:identifier id="book-id">zhenshu-e2e</dc:identifier>
    <dc:title>E2E EPUB</dc:title>
    <dc:creator>Playwright</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="chapter3"/>
  </spine>
</package>`),
  'OEBPS/nav.xhtml': strToU8(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>TOC</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="chapter1.xhtml">第一章</a></li>
  <li><a href="chapter2.xhtml">第二章</a></li>
  <li><a href="chapter3.xhtml">第三章</a></li>
</ol></nav></body>
</html>`),
  'OEBPS/chapter1.xhtml': strToU8(longChapter(1, '一')),
  'OEBPS/chapter2.xhtml': strToU8(longChapter(2, '二')),
  'OEBPS/chapter3.xhtml': strToU8(longChapter(3, '三'))
});
fs.writeFileSync(path.join(libraryRoot, 'e2e-reader.epub'), Buffer.from(epub));

// A bounded stress fixture: the image is deliberately larger than the
// browser-side inline-resource budget. The reader should skip the asset and
// keep the chapter interactive instead of building a giant data URL.
const stressAsset = randomBytes(9 * 1024 * 1024);
const stressEpub = zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>E2E Stress EPUB</dc:title></metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="asset" href="large.bin" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
  'OEBPS/chapter.xhtml': strToU8(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1>Stress fixture</h1>
  <img src="large.bin" alt="large fixture asset"/>
  <p>正文必须在超大资源被跳过后仍然可以交互。</p>
</body></html>`),
  'OEBPS/large.bin': stressAsset
});
fs.writeFileSync(path.join(libraryRoot, 'e2e-stress.epub'), Buffer.from(stressEpub));

// The same in-limit PNG is referenced from eight spine documents. Its unique
// payload is below the per-resource limit, while counting every reference
// cumulatively would exceed the former 48 MiB archive-lifetime budget.
const pngHeader = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=', 'base64');
const repeatedImage = Buffer.concat([pngHeader, randomBytes(7 * 1024 * 1024 - pngHeader.length)]);
const repeatedChapters = Array.from({ length: 8 }, (_, index) => ({
  id: `chapter${index + 1}`,
  href: `text/chapter-${String(index + 1).padStart(2, '0')}.xhtml`,
  body: `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Repeated image chapter ${index + 1}</h1><img src="../images/shared.png" alt="Repeated shared image"/><p>Chapter ${index + 1} keeps this shared image in the active chapter.</p></body></html>`
}));
const repeatedImageEpub = zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>E2E Repeated Image EPUB</dc:title><dc:creator>Playwright</dc:creator></metadata>
  <manifest>
    ${repeatedChapters.map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`).join('\n    ')}
    <item id="shared-image" href="images/shared.png" media-type="image/png"/>
  </manifest>
  <spine>${repeatedChapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('')}</spine>
</package>`),
  ...Object.fromEntries(repeatedChapters.map((chapter) => [`OEBPS/${chapter.href}`, strToU8(chapter.body)])),
  'OEBPS/images/shared.png': repeatedImage
});
fs.writeFileSync(path.join(libraryRoot, 'e2e-repeated-image.epub'), Buffer.from(repeatedImageEpub));

// First-line indent: one chapter per way books indent body text, each with
// the paragraphs a book deliberately sets apart (e2e/paragraph-indent.spec.js).
const INDENT_BODY = '这一段正文用于测量首行缩进，需要足够长才能折成好几行，这样首行的位置和其余各行的位置都能看清楚，排版是否整齐也一目了然。';
const indentChapter = (title, head, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>${head}</head><body>
<h2>${title}</h2>
${body}
</body></html>`;
const indentParagraphs = (count, prefix = '', attrs = '') => Array.from({ length: count },
  (_, index) => `<p${attrs}>${prefix}${index + 1}。${INDENT_BODY}</p>`).join('\n');
const indentChapters = [
  ['css', 'CSS 缩进', '<link rel="stylesheet" type="text/css" href="../styles/book.css"/>', [
    indentParagraphs(6),
    '<p class="note">注：这是一条悬挂缩进的注释，第一行顶格而后续各行向内缩进，需要足够长才能折行显示出悬挂的效果来。</p>',
    '<p class="intro">内容简介这一段原书刻意不缩进，需要保持原样，同样写得长一些以便折行观察它的位置。</p>',
    '<p class="sign">——作者识</p>',
    '<p class="center">＊　＊　＊</p>',
    '<p class="poem">清风明月枝头动<br/>疑是剑仙宝剑光</p>',
    indentParagraphs(4)
  ].join('\n')],
  ['ideographic', '全角空格缩进', '', [
    indentParagraphs(6, '　　'),
    `<p>　　　多一个全角空格的段落。${INDENT_BODY}</p>`,
    `<p>没有空格的段落。${INDENT_BODY}</p>`
  ].join('\n')],
  ['nbsp', '不换行空格缩进', '', [
    indentParagraphs(6, '&#160;&#160;&#160;&#160;'),
    `<p style="text-indent: 2em">　　行内样式加全角空格。${INDENT_BODY}</p>`
  ].join('\n')],
  ['specific', '高优先级样式', '<style type="text/css">body div.main p { text-indent: 1em !important; } div.para { text-indent: 2em; }</style>', [
    `<div class="main">${indentParagraphs(5)}</div>`,
    `<div class="main"><p style="text-indent: 4em">行内四字缩进。${INDENT_BODY}</p></div>`
  ].join('\n')],
  ['divs', 'div 段落', '<style type="text/css">div.para { text-indent: 2em; }</style>',
    Array.from({ length: 5 }, (_, index) => `<div class="para">第${index + 1}个 div 段落。${INDENT_BODY}</div>`).join('\n')],
  ['western', 'Western', '<style type="text/css">p { text-indent: 0; margin: 0 0 1em; }</style>',
    Array.from({ length: 5 }, (_, index) => `<p>Paragraph ${index + 1}. This English paragraph has no first-line indent in the book and is long enough to wrap over several lines in the reader.</p>`).join('\n')]
];
const indentEpub = zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>E2E Indent EPUB</dc:title><dc:creator>Playwright</dc:creator><dc:language>zh-CN</dc:language></metadata>
  <manifest>
    ${indentChapters.map(([id]) => `<item id="${id}" href="text/${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
    <item id="book-stylesheet" href="styles/book.css" media-type="text/css"/>
  </manifest>
  <spine>${indentChapters.map(([id]) => `<itemref idref="${id}"/>`).join('')}</spine>
</package>`),
  'OEBPS/styles/book.css': strToU8(`body { font-family: serif; color: #333; }
p { text-indent: 2em; margin: 0; line-height: 1.6; }
p.note { text-indent: -2em; padding-left: 2em; }
.intro { text-indent: 0; }
p.sign { text-align: right; text-indent: 0; }
.center { text-align: center; text-indent: 0; }
@media screen { p.poem { text-indent: 0; text-align: center; } }`),
  ...Object.fromEntries(indentChapters.map(([id, title, head, body]) => [`OEBPS/text/${id}.xhtml`, strToU8(indentChapter(title, head, body))]))
});
fs.writeFileSync(path.join(libraryRoot, 'e2e-indent.epub'), Buffer.from(indentEpub));
// A GBK-encoded novel (most Chinese web-novel TXT files): read in its own
// encoding by the reader, search and AI (e2e/text-encoding.spec.js).
fs.writeFileSync(path.join(libraryRoot, 'e2e-gbk-novel.txt'), Buffer.from('b5dad2bbd5c220b1e0c2eb0aa1a1a1a1d5e2cac7d2bbb1bed3c347424bb1e0c2ebb1a3b4e6b5c4d0a1cbb5a3accbd1cbf7b9d8bcfcb4cacac7c7e0caafb0e5c2b7a1a30aa1a1a1a1b5dab6feb6ced2b2d2aad5fdb3a3cfd4cabea3acb2bbc4dcb1e4b3c9c2d2c2eba1a30a', 'hex'));
fs.writeFileSync(path.join(libraryRoot, 'e2e-indent-novel.txt'), [
  '第一章 山居',
  ...Array.from({ length: 6 }, (_, index) => `　　第${index + 1}段。${INDENT_BODY}`),
  `没有空格的一段。${INDENT_BODY}`,
  '第二章 下山',
  ...Array.from({ length: 3 }, (_, index) => `　　下山第${index + 1}段。${INDENT_BODY}`)
].join('\n'), 'utf8');

// Optional local-only investigation fixture. It never copies a user EPUB into
// the repository; callers opt in through an absolute path environment value.
if (sampleEpubPath) {
  if (!path.isAbsolute(sampleEpubPath)) {
    throw new Error('ZHENSHU_E2E_SAMPLE_EPUB must be an absolute local EPUB path.');
  }
  if (!fs.existsSync(sampleEpubPath)) {
    throw new Error(`ZHENSHU_E2E_SAMPLE_EPUB does not exist: ${sampleEpubPath}`);
  }
  fs.copyFileSync(sampleEpubPath, path.join(libraryRoot, path.basename(sampleEpubPath)));
  if (process.env.ZHENSHU_E2E_SAMPLE_COMPARE_IMAGES === '1') {
    const files = unzipSync(new Uint8Array(fs.readFileSync(sampleEpubPath)));
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    for (const [name, bytes] of Object.entries(files)) {
      if (/\.(?:html|xhtml)$/i.test(name)) {
        files[name] = encoder.encode(decoder.decode(bytes).replace(/<img\b[^>]*>/gi, ''));
      }
      if (/\.jpg$/i.test(name)) delete files[name];
    }
    const opfName = Object.keys(files).find((name) => /(^|\/)content\.opf$/i.test(name));
    if (opfName) {
      const opf = decoder.decode(files[opfName])
        .replace(/(<dc:title\b[^>]*>)[\s\S]*?(<\/dc:title>)/i, '$1吃的营养科学观（无图对照）$2');
      files[opfName] = encoder.encode(opf);
    }
    fs.writeFileSync(
      path.join(libraryRoot, '吃的营养科学观-无图对照.epub'),
      Buffer.from(zipSync(files))
    );
  }
}

if (samplePdfPath) {
  if (!path.isAbsolute(samplePdfPath) || path.extname(samplePdfPath).toLowerCase() !== '.pdf') {
    throw new Error('ZHENSHU_E2E_SAMPLE_PDF must be an absolute local PDF path.');
  }
  if (!fs.existsSync(samplePdfPath)) {
    throw new Error('ZHENSHU_E2E_SAMPLE_PDF does not exist.');
  }
  fs.copyFileSync(samplePdfPath, path.join(libraryRoot, path.basename(samplePdfPath)));
}

fs.writeFileSync(
  path.join(configRoot, 'settings.json'),
  JSON.stringify({ libraryRoots: [libraryRoot] }, null, 2),
  'utf8'
);

Object.assign(process.env, {
  NODE_ENV: 'development',
  ZHENSHU_DEV_PORT: '8099',
  ZHENSHU_DEV_UID: 'playwright-user',
  ZHENSHU_DEV_USERNAME: 'Playwright User',
  ZHENSHU_PDF_ENABLED: '1',
  TRIM_PKGETC: configRoot,
  TRIM_PKGVAR: dataRoot,
  TRIM_PKGTMP: path.join(runtimeRoot, 'tmp'),
  TRIM_DATA_SHARE_PATHS: shareRoot
});

const { start } = require('../app/server/index');

async function waitForHealth() {
  const url = 'http://127.0.0.1:8099/app/zhenshu/api/health';
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
  const response = await fetch('http://127.0.0.1:8099/app/zhenshu/api/library/scan', {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`Initial E2E library scan failed: ${response.status} ${await response.text()}`);
  }
  console.log('枕书 E2E fixture library is ready');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
