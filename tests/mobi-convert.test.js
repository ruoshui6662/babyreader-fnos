'use strict';

// MOBI plan Task 2: MOBI6 → deterministic EPUB. The chapter href scheme is an
// annotation contract (highlights locate by chapterHref), so it is snapshotted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeUnzip } = require('../app/server/zip');
const { extractEpubMetadata } = require('../app/server/library');
const { convertMobiToEpub, MOBI_CONVERTER_VERSION } = require('../app/server/mobi-convert');
const {
  TINY_PNG,
  createMobiFixture,
  createDrmMobiFixture,
  createTruncatedMobiFixture
} = require('./fixtures/mobi-fixtures');

const decoder = new TextDecoder();
const text = (files, name) => decoder.decode(files[name]);

async function convert(bytes, options = {}) {
  const epub = await convertMobiToEpub(bytes, { identifier: 'urn:zhenshu:test', ...options });
  return { epub, files: safeUnzip(Buffer.from(epub)) };
}

test('converter version is an explicit integer (it keys caches and FTS rebuilds)', () => {
  assert.ok(Number.isInteger(MOBI_CONVERTER_VERSION) && MOBI_CONVERTER_VERSION >= 1);
});

test('MOBI6 converts to a valid EPUB with metadata, cover and one chapter per page break', async () => {
  const { epub, files } = await convert(createMobiFixture({ title: '转换测试', author: '作者甲' }));
  const metadata = extractEpubMetadata(Buffer.from(epub));
  assert.equal(metadata.title, '转换测试');
  assert.equal(metadata.author, '作者甲');
  assert.equal(metadata.language, 'zh');
  assert.equal(metadata.cover.extension, '.png');
  assert.deepEqual(Buffer.from(metadata.cover.bytes), TINY_PNG);

  const opf = text(files, 'OEBPS/content.opf');
  const spine = [...opf.matchAll(/<item id="(c\d+)" href="([^"]+)"/g)].map((match) => match[2]);
  assert.deepEqual(spine, ['text/part-0001.xhtml', 'text/part-0002.xhtml', 'text/part-0003.xhtml', 'text/part-0004.xhtml']);
  assert.match(text(files, 'OEBPS/text/part-0002.xhtml'), /<h1>第一章 启程<\/h1>/);
  assert.match(text(files, 'OEBPS/text/part-0004.xhtml'), /第三章是结尾/);
});

test('entry names follow the frozen href scheme (annotation contract snapshot)', async () => {
  const { files } = await convert(createMobiFixture());
  assert.deepEqual(Object.keys(files).sort(), [
    'META-INF/container.xml',
    'OEBPS/content.opf',
    'OEBPS/images/img-0001.png',
    'OEBPS/nav.xhtml',
    'OEBPS/styles/book.css',
    'OEBPS/text/part-0001.xhtml',
    'OEBPS/text/part-0002.xhtml',
    'OEBPS/text/part-0003.xhtml',
    'OEBPS/text/part-0004.xhtml',
    'OEBPS/toc.ncx',
    'mimetype'
  ]);
});

test('filepos links become chapter-relative anchors that exist in the target chapter', async () => {
  const { files } = await convert(createMobiFixture());
  const chapter3 = text(files, 'OEBPS/text/part-0003.xhtml');
  const link = /<a href="(part-\d{4}\.xhtml)#(fp\d+)">回到第一章<\/a>/.exec(chapter3);
  assert.ok(link, 'link rewritten');
  assert.equal(link[1], 'part-0002.xhtml');
  assert.match(text(files, `OEBPS/text/${link[1]}`), new RegExp(`<a id="${link[2]}"></a><h1>第一章`));
  assert.doesNotMatch(chapter3, /filepos/i);
});

test('the guide TOC becomes nav and NCX entries pointing at chapter anchors', async () => {
  const { files } = await convert(createMobiFixture());
  const nav = text(files, 'OEBPS/nav.xhtml');
  const labels = [...nav.matchAll(/<a href="text\/(part-\d{4}\.xhtml)#fp\d+">([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(labels, [
    ['part-0002.xhtml', '第一章 启程'],
    ['part-0003.xhtml', '第二章 远行'],
    ['part-0004.xhtml', '第三章 归来']
  ]);
  assert.match(text(files, 'OEBPS/toc.ncx'), /<content src="text\/part-0003\.xhtml#fp\d+"\/>/);
});

test('without a guide TOC, chapters are listed by their first heading', async () => {
  const { files } = await convert(createMobiFixture({ toc: false }));
  const nav = text(files, 'OEBPS/nav.xhtml');
  assert.match(nav, /<a href="text\/part-0001\.xhtml">第一章 启程<\/a>/);
  assert.match(nav, /<a href="text\/part-0003\.xhtml">第三章 归来<\/a>/);
});

test('recindex images map to packaged files; missing, out-of-range and remote images are dropped', async () => {
  const { files } = await convert(createMobiFixture({
    chapters: [{
      title: '图片',
      body: '<p><img recindex="00001" alt="插图"/></p><p><img recindex="00009"/></p><p><img src="http://example.invalid/x.png"/></p><p><img/></p>'
    }]
  }));
  const chapter = text(files, 'OEBPS/text/part-0002.xhtml');
  assert.match(chapter, /<img src="\.\.\/images\/img-0001\.png" alt="插图" \/>/);
  assert.equal((chapter.match(/<img/g) || []).length, 1);
  assert.doesNotMatch(chapter, /example\.invalid/);
  assert.equal(Object.keys(files).filter((name) => name.startsWith('OEBPS/images/')).length, 1, 'EOF record is never packaged');
});

test('scripts, event handlers, styles and Kindle-only tags are removed; output is well-formed XHTML', async () => {
  const { files } = await convert(createMobiFixture({
    chapters: [{
      title: '清理',
      body: '<p align=center onclick="x()">居中<br>换行<script>alert(1)</script></p><mbp:nu>保留文字</mbp:nu><font size=+1>字号</font><p>未闭合'
    }]
  }));
  const chapter = text(files, 'OEBPS/text/part-0002.xhtml');
  assert.doesNotMatch(chapter, /script|onclick|mbp:|<font/i);
  assert.match(chapter, /<p class="align-center">居中<br \/>换行<\/p>/);
  assert.match(chapter, /保留文字/);
  assert.match(chapter, /<p>未闭合<\/p>/);
});

test('PalmDOC and uncompressed sources of the same book produce identical EPUB bytes', async () => {
  const palmdoc = await convertMobiToEpub(createMobiFixture({ compression: 'palmdoc' }), { identifier: 'x' });
  const none = await convertMobiToEpub(createMobiFixture({ compression: 'none' }), { identifier: 'x' });
  const again = await convertMobiToEpub(createMobiFixture({ compression: 'palmdoc' }), { identifier: 'x' });
  assert.deepEqual(Buffer.from(palmdoc), Buffer.from(again), 'deterministic');
  assert.deepEqual(Buffer.from(palmdoc), Buffer.from(none));
});

test('a book without page breaks is split into bounded parts at headings and paragraphs', async () => {
  const paragraph = `<p>${'没有分页标记的长篇正文。'.repeat(200)}</p>`;
  const body = `<h2>上篇</h2>${paragraph.repeat(60)}<h2>下篇</h2>${paragraph.repeat(60)}`;
  const { files } = await convert(createMobiFixture({ toc: false, chapters: [{ title: '唯一章节', body }] }));
  const parts = Object.keys(files).filter((name) => /^OEBPS\/text\/part-\d{4}\.xhtml$/.test(name)).sort();
  assert.ok(parts.length >= 4, `expected several parts, got ${parts.length}`);
  for (const name of parts) assert.ok(files[name].length < 512 * 1024, `${name} is bounded`);
  const combined = parts.map((name) => text(files, name)).join('');
  assert.equal((combined.match(/没有分页标记的长篇正文。/g) || []).length, 200 * 120, 'no text lost or duplicated');
});

test('DRM, structurally empty KF8, truncated and oversized sources are rejected with typed codes', async () => {
  const cases = [
    [createDrmMobiFixture(), 'DRM_PROTECTED'],
    // Synthetic KF8 headers carry no FDST/skeleton tables: the KF8 path must
    // refuse them rather than fall back to MOBI6.
    [createMobiFixture({ kf8: 'standalone' }), 'CORRUPT'],
    [createMobiFixture({ kf8: 'combo' }), 'CORRUPT'],
    [createTruncatedMobiFixture(), 'TRUNCATED']
  ];
  for (const [bytes, code] of cases) {
    await assert.rejects(convertMobiToEpub(bytes, { identifier: 'x' }), (error) => error.code === code, code);
  }
  await assert.rejects(
    convertMobiToEpub(createMobiFixture(), { identifier: 'x', limits: { maxTextBytes: 64 } }),
    (error) => error.code === 'TOO_LARGE'
  );
});

// Optional real-book check: ZHENSHU_KF8_SAMPLE=/abs/path/book.azw3. The
// sample stays outside the repository (see the MOBI progress ledger).
const kf8Sample = process.env.ZHENSHU_KF8_SAMPLE;
test('a real KF8/AZW3 sample converts deterministically with intact links and TOC', {
  skip: kf8Sample ? false : 'set ZHENSHU_KF8_SAMPLE to an absolute local AZW3 path'
}, async () => {
  const source = require('node:fs').readFileSync(kf8Sample);
  const first = await convertMobiToEpub(source, { identifier: 'urn:sample' });
  const second = await convertMobiToEpub(source, { identifier: 'urn:sample' });
  assert.deepEqual(Buffer.from(first), Buffer.from(second), 'deterministic');
  const files = safeUnzip(Buffer.from(first));
  const parts = Object.keys(files).filter((name) => /^OEBPS\/text\/part-\d{4}\.xhtml$/.test(name)).sort();
  assert.ok(parts.length > 1);
  parts.forEach((name, index) => assert.equal(name, `OEBPS/text/part-${String(index + 1).padStart(4, '0')}.xhtml`));
  const all = parts.map((name) => text(files, name)).join('');
  assert.doesNotMatch(all, /kindle:/);
  for (const [, part, id] of all.matchAll(/href="(part-\d{4}\.xhtml)#([^"]+)"/g)) {
    assert.match(text(files, `OEBPS/text/${part}`), new RegExp(`id="${id}"`), `${part}#${id}`);
  }
  assert.match(text(files, 'OEBPS/nav.xhtml'), /<a href="text\/part-\d{4}\.xhtml/);
});
