'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync, strToU8 } = require('fflate');
const {
  enforceZipLimits,
  resolveAuthorizedPath,
  sanitizeEpubHtml,
  validateZipEntryName
} = require('../app/server/security');
const { inspectZip, safeUnzip } = require('../app/server/zip');

test('resolveAuthorizedPath accepts files inside an authorized realpath root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-root-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'book.md');
  await fs.writeFile(file, '# Book', 'utf8');

  assert.equal(await resolveAuthorizedPath(file, [root]), await fs.realpath(file));
});

test('resolveAuthorizedPath rejects files outside authorized roots', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-outside-'));
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true })
  ]));
  const file = path.join(outside, 'secret.txt');
  await fs.writeFile(file, 'secret', 'utf8');

  await assert.rejects(
    resolveAuthorizedPath(file, [root]),
    /outside authorized library roots/
  );
});

test('library traversal skips symbolic links when supported', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-outside-'));
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true })
  ]));

  const target = path.join(outside, 'secret.txt');
  const link = path.join(root, 'linked.txt');
  await fs.writeFile(target, 'secret', 'utf8');
  try {
    await fs.symlink(target, link, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows symbolic-link privilege is unavailable');
      return;
    }
    throw error;
  }

  await assert.rejects(
    resolveAuthorizedPath(link, [root]),
    /outside authorized library roots|Symbolic links are not allowed/
  );
});

test('validateZipEntryName rejects traversal and absolute paths', () => {
  assert.throws(() => validateZipEntryName('../secret.txt'), /traversal/);
  assert.throws(() => validateZipEntryName('OPS/../../secret.txt'), /traversal/);
  assert.throws(() => validateZipEntryName('/etc/passwd'), /Absolute/);
  assert.throws(() => validateZipEntryName('C:/Windows/system.ini'), /Absolute/);
  assert.equal(validateZipEntryName('OPS/./chapter.xhtml'), 'OPS/chapter.xhtml');
});

test('enforceZipLimits rejects oversized entries and compression ratios', () => {
  assert.throws(
    () => enforceZipLimits([{ name: 'large.bin', compressedSize: 1024, uncompressedSize: 4097 }], {
      maxEntries: 10,
      maxEntryBytes: 4096,
      maxTotalBytes: 8192,
      maxCompressionRatio: 100
    }),
    /too large/
  );

  assert.throws(
    () => enforceZipLimits([{ name: 'bomb.txt', compressedSize: 1, uncompressedSize: 1000 }], {
      maxEntries: 10,
      maxEntryBytes: 4096,
      maxTotalBytes: 8192,
      maxCompressionRatio: 10
    }),
    /compression ratio/
  );
});

test('inspectZip and safeUnzip accept a bounded EPUB-like archive', () => {
  const archive = Buffer.from(zipSync({
    'META-INF/container.xml': strToU8('<container/>'),
    'OPS/chapter.xhtml': strToU8('<p>Hello</p>')
  }, { level: 0 }));

  const entries = inspectZip(archive);
  assert.equal(entries.length, 2);
  const files = safeUnzip(archive);
  assert.equal(Buffer.from(files['OPS/chapter.xhtml']).toString('utf8'), '<p>Hello</p>');
});

test('safeUnzip rejects ZIP path traversal', () => {
  const archive = Buffer.from(zipSync({
    '../outside.txt': strToU8('blocked')
  }, { level: 0 }));

  assert.throws(() => safeUnzip(archive), /traversal/);
});

test('sanitizeEpubHtml removes executable and remote content', () => {
  const dirty = [
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<p onclick="alert(1)" style="color:red">Safe text</p>',
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="#chapter">chapter</a>',
    '<img src="https://evil.example/cover.png" onerror="alert(1)">',
    '<img src="data:image/png;base64,AA==" alt="cover">'
  ].join('');

  const clean = sanitizeEpubHtml(dirty);
  assert.doesNotMatch(clean, /script|iframe|onclick|onerror|style=|javascript:|evil\.example/i);
  assert.match(clean, /href="#chapter"/);
  assert.match(clean, /data:image\/png;base64,AA==/);
});
