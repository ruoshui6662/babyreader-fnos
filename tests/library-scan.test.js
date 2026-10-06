'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanLibrary } = require('../app/server/library');

async function library(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '小说'));
  await fs.mkdir(path.join(root, '锁住的文件夹'));
  await fs.mkdir(path.join(root, '@eaDir'));
  await fs.mkdir(path.join(root, '#recycle'));
  await fs.writeFile(path.join(root, '小说', '山居.txt'), '第一章\n山居');
  await fs.writeFile(path.join(root, '笔记.md'), '# 笔记\n\n正文');
  await fs.writeFile(path.join(root, '锁住的文件夹', '看不到.txt'), '读不到');
  // NAS housekeeping folders are never treated as books.
  await fs.writeFile(path.join(root, '@eaDir', '缩略图.txt'), 'thumb');
  await fs.writeFile(path.join(root, '#recycle', '已删除.txt'), 'deleted');
  return root;
}

test('an unreadable sub-folder is skipped and reported instead of hiding the whole library', async (t) => {
  const root = await library(t);
  const realRoot = await fs.realpath(root);
  const locked = path.join(realRoot, '锁住的文件夹');
  const readdir = fs.readdir;
  t.mock.method(fs, 'readdir', async (directory, options) => {
    if (path.resolve(String(directory)) === locked) {
      throw Object.assign(new Error(`EACCES: permission denied, scandir '${directory}'`), { code: 'EACCES' });
    }
    return readdir.call(fs, directory, options);
  });

  const index = await scanLibrary([root]);
  const titles = index.books.map((book) => book.relativePath).sort();
  assert.deepEqual(titles, ['小说/山居.txt', '笔记.md']);
  assert.equal(index.scan.status, 'completed');
  assert.deepEqual(index.scan.rootErrors, []);
  assert.equal(index.scan.skippedCount, 1);
  assert.deepEqual(index.scan.roots, [{
    root: realRoot,
    bookCount: 2,
    skippedCount: 1,
    skipped: [{ path: '锁住的文件夹', code: 'EACCES' }]
  }]);
});

test('a library folder that cannot be opened is still reported as a root error', async (t) => {
  const missing = path.join(os.tmpdir(), `zhenshu-missing-${Date.now()}`);
  const index = await scanLibrary([missing]);
  assert.equal(index.books.length, 0);
  assert.equal(index.scan.rootErrors.length, 1);
  assert.deepEqual(index.scan.roots, []);
});

test('an empty library folder is listed with zero books', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const index = await scanLibrary([root]);
  assert.deepEqual(index.scan.roots, [{ root: await fs.realpath(root), bookCount: 0, skippedCount: 0, skipped: [] }]);
});

// An EPUB with a cover and a long body: the scan reads the container, the
// package document and the cover, and the result matches a full unpack.
function coverEpub(title) {
  const { zipSync, strToU8 } = require('fflate');
  return Buffer.from(zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>作者甲</dc:creator><dc:language>zh</dc:language><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="images/cover.png" media-type="image/png"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`),
    'OEBPS/images/cover.png': [new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { level: 0 }],
    'OEBPS/c.xhtml': strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${Array.from({ length: 3000 }, (_, index) => `<p>第 ${index} 段，${(index * 7919) % 10007}。</p>`).join('')}</body></html>`)
  }));
}

test('EPUB metadata read entry by entry matches a full unpack', async (t) => {
  const { extractEpubMetadata, readEpubMetadata } = require('../app/server/library');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-epub-meta-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, '书.epub');
  const bytes = coverEpub('山海');
  await fs.writeFile(file, bytes);
  const full = extractEpubMetadata(bytes);
  const partial = await readEpubMetadata(file);
  assert.deepEqual(partial, full);
  assert.equal(partial.title, '山海');
  assert.equal(partial.cover.extension, '.png');
  // Not an archive: the same kind of error as before.
  await fs.writeFile(path.join(root, '坏.epub'), 'not a zip');
  await assert.rejects(readEpubMetadata(path.join(root, '坏.epub')), /ZIP/);
});

test('a scan reports its progress: finding books, then reading each, then finishing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-progress-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '甲'));
  for (let index = 0; index < 9; index += 1) {
    await fs.writeFile(path.join(root, '甲', `第${index}本.txt`), '正文');
  }
  await fs.writeFile(path.join(root, '封面书.epub'), coverEpub('封面书'));
  const covers = path.join(root, '..', `${path.basename(root)}-covers`);
  t.after(() => fs.rm(covers, { recursive: true, force: true }));

  const seen = [];
  const index = await scanLibrary([root], { coverDirectory: covers, onProgress: (progress) => seen.push(progress) });
  assert.equal(index.books.length, 10);
  assert.equal(seen[0].phase, 'discovering');
  const indexing = seen.filter((progress) => progress.phase === 'indexing');
  assert.equal(indexing[0].total, 10);
  assert.equal(indexing.at(-1).processed, 10);
  assert.equal(indexing.at(-1).indexed, 10);
  assert.equal(seen.at(-1).phase, 'finishing');
  assert.ok(index.books.find((book) => book.title === '封面书').coverUrl);

  // A second scan reuses every book and keeps the cover.
  const again = [];
  const second = await scanLibrary([root], { coverDirectory: covers, previousIndex: index, onProgress: (progress) => again.push(progress) });
  assert.equal(again.filter((progress) => progress.phase === 'indexing').at(-1).reused, 10);
  assert.equal(second.scan.reusedCount, 10);
  assert.ok((await fs.readdir(covers)).length === 1);
});
