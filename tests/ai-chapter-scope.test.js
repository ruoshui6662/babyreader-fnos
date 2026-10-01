'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync } = require('fflate');
const { parseEpubStructure, resolveLogicalChapter } = require('../app/server/ai-epub-structure');
const { isFtsAvailable, resolveBookPosition } = require('../app/server/ai-fts');

function filesForChapters({ spine, toc, documents }) {
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    ...spine.map((href, index) => `<item id="s${index}" href="${href.replace(/^OPS\//, '')}" media-type="application/xhtml+xml"/>`)
  ].join('');
  const links = toc.map(({ label, href }) => `<li><a href="${href}">${label}</a></li>`).join('');
  return {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><manifest>${manifest}</manifest><spine>${spine.map((_, index) => `<itemref idref="s${index}"/>`).join('')}</spine></package>`,
    'OPS/nav.xhtml': `<html><body><nav epub:type="toc"><ol>${links}</ol></nav></body></html>`,
    ...Object.fromEntries(Object.entries(documents).map(([href, html]) => [href, html]))
  };
}

function parse(files) {
  return parseEpubStructure(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)])));
}

test('a file-start locator resolves when its spine resource contains only one chapter', () => {
  const structure = parse(filesForChapters({
    spine: ['OPS/only.xhtml'],
    toc: [{ label: '唯一测试章', href: 'only.xhtml#start' }],
    documents: { 'OPS/only.xhtml': '<html><body><h1 id="start">唯一测试章</h1><p>起始正文</p></body></html>' }
  }));
  const result = resolveLogicalChapter(structure, { index: 0, href: 'OPS/only.xhtml' });

  assert.equal(result.status, 'resolved');
  assert.equal(result.chapterLabel, '唯一测试章');
});

test('reading locator resolves the right fragment within one spine item and stays stable after resume', () => {
  const structure = parse(filesForChapters({
    spine: ['OPS/shared.xhtml'],
    toc: [
      { label: '第一章', href: 'shared.xhtml#one' },
      { label: '第二章', href: 'shared.xhtml#two' }
    ],
    documents: {
      'OPS/shared.xhtml': '<html><body><h1 id="one">第一章</h1><p>第一章正文</p><h1 id="two">第二章</h1><p>第二章正文</p></body></html>'
    }
  }));

  const resolved = resolveLogicalChapter(structure, {
    index: 0,
    href: 'OPS/shared.xhtml',
    position: { href: 'OPS/shared.xhtml', anchor: 'two' }
  });
  const restored = resolveLogicalChapter(structure, {
    index: 0,
    href: 'OPS/shared.xhtml',
    position: { href: 'OPS/shared.xhtml', anchor: 'two' }
  });

  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.chapterLabel, '第二章');
  assert.equal(resolved.sectionId, null);
  assert.deepEqual(restored, resolved);
});

test('offset between two chapter boundaries maps to the preceding chapter', () => {
  const structure = parse(filesForChapters({
    spine: ['OPS/shared.xhtml'],
    toc: [
      { label: '第一章', href: 'shared.xhtml#one' },
      { label: '第二章', href: 'shared.xhtml#two' }
    ],
    documents: {
      'OPS/shared.xhtml': '<html><body><h1 id="one">第一章</h1><p>第一章中段空白区</p><h1 id="two">第二章</h1></body></html>'
    }
  }));
  const firstStart = structure.anchors['OPS/shared.xhtml'].anchors.find((item) => item.id === 'one').offset;
  const secondStart = structure.anchors['OPS/shared.xhtml'].anchors.find((item) => item.id === 'two').offset;

  const result = resolveLogicalChapter(structure, {
    index: 0,
    href: 'OPS/shared.xhtml',
    position: { href: 'OPS/shared.xhtml', offset: Math.floor((firstStart + secondStart) / 2) }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.chapterLabel, '第一章');
});

test('one logical chapter crossing spine resources resolves at the tail resource', () => {
  const structure = parse(filesForChapters({
    spine: ['OPS/part-a.xhtml', 'OPS/part-b.xhtml', 'OPS/next.xhtml'],
    toc: [
      { label: '连续章', href: 'part-a.xhtml#start' },
      { label: '下一章', href: 'next.xhtml#start' }
    ],
    documents: {
      'OPS/part-a.xhtml': '<html><body><h1 id="start">连续章</h1><p>开篇</p></body></html>',
      'OPS/part-b.xhtml': '<html><body><p>跨文件的章尾</p></body></html>',
      'OPS/next.xhtml': '<html><body><h1 id="start">下一章</h1></body></html>'
    }
  }));

  const result = resolveLogicalChapter(structure, {
    index: 1,
    href: 'OPS/part-b.xhtml',
    position: { href: 'OPS/part-b.xhtml', anchor: '' }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.chapterLabel, '连续章');
  assert.equal(result.chapterId, structure.chapters[0].id);
});

test('missing ambiguous location and forged or mismatched href never guess a chapter', () => {
  const structure = parse(filesForChapters({
    spine: ['OPS/shared.xhtml'],
    toc: [
      { label: '第一章', href: 'shared.xhtml#one' },
      { label: '第二章', href: 'shared.xhtml#two' }
    ],
    documents: { 'OPS/shared.xhtml': '<html><body><h1 id="one">第一章</h1><h1 id="two">第二章</h1></body></html>' }
  }));

  assert.equal(resolveLogicalChapter(structure, { index: 0, href: 'OPS/shared.xhtml' }).status, 'unresolved');
  assert.equal(resolveLogicalChapter(structure, { index: 0, href: 'OPS/forged.xhtml', position: { anchor: 'two' } }).status, 'unresolved');
  assert.equal(resolveLogicalChapter(structure, { index: 1, href: 'OPS/shared.xhtml', position: { anchor: 'two' } }).status, 'unresolved');
  assert.equal(resolveLogicalChapter(structure, { index: 0, href: 'OPS/../OPS/shared.xhtml', position: { anchor: 'one' } }).status, 'unresolved');
});

test('server resolves only the current book structure and rejects a client-forged chapter path', { skip: !isFtsAvailable() }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-ai-chapter-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bookPath = path.join(root, 'book.epub');
  const bookFiles = filesForChapters({
    spine: ['OPS/shared.xhtml'],
    toc: [
      { label: '第一章', href: 'shared.xhtml#one' },
      { label: '第二章', href: 'shared.xhtml#two' }
    ],
    documents: { 'OPS/shared.xhtml': '<html><body><h1 id="one">第一章</h1><h1 id="two">第二章</h1></body></html>' }
  });
  await fs.writeFile(bookPath, zipSync(Object.fromEntries(
    Object.entries(bookFiles).map(([name, value]) => [name, new TextEncoder().encode(value)])
  )));

  const book = { id: 'd'.repeat(64), path: bookPath, type: 'epub' };
  const resolved = await resolveBookPosition(book, root, {
    index: 0,
    href: 'OPS/shared.xhtml',
    position: { href: 'OPS/shared.xhtml', anchor: 'two' },
    label: '客户端伪造名称'
  });
  const forged = await resolveBookPosition(book, root, {
    index: 0,
    href: 'OPS/forged.xhtml',
    position: { href: 'OPS/forged.xhtml', anchor: 'two' }
  });

  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.chapterLabel, '第二章');
  assert.notEqual(resolved.chapterLabel, '客户端伪造名称');
  assert.equal(forged.status, 'unresolved');
});
