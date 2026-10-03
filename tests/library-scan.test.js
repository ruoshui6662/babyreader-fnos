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
