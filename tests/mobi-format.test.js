'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  TINY_PNG,
  exthRecord,
  createMobiFixture,
  createDrmMobiFixture,
  createTruncatedMobiFixture,
  createNonMobiPdbFixture
} = require('./fixtures/mobi-fixtures');
const { readMobiMetadata, parseMobiStructure, MobiFormatError } = require('../app/server/mobi-format');

async function writeTemp(t, name, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-mobi-format-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, name);
  await fs.writeFile(file, bytes);
  return file;
}

test('reads MOBI6 title, author, language and format without decompressing text', async (t) => {
  const file = await writeTemp(t, 'book.mobi', createMobiFixture({ title: '书名', author: '作者甲' }));
  const metadata = await readMobiMetadata(file);
  assert.equal(metadata.format, 'mobi6');
  assert.equal(metadata.title, '书名');
  assert.equal(metadata.author, '作者甲');
  assert.equal(metadata.language, 'zh');
  assert.equal(metadata.drm, false);
  assert.equal(metadata.compression, 'palmdoc');
});

test('extracts the cover when EXTH 201 is 0 (first image), the common Kindle case', async (t) => {
  const file = await writeTemp(t, 'cover.mobi', createMobiFixture({ coverIndex: 0 }));
  const metadata = await readMobiMetadata(file);
  assert.equal(metadata.cover.extension, '.png');
  assert.deepEqual(metadata.cover.bytes, TINY_PNG);
});

test('books without images or cover pointers have no cover', async (t) => {
  const noImages = await writeTemp(t, 'a.mobi', createMobiFixture({ images: [] }));
  assert.equal((await readMobiMetadata(noImages)).cover, null);
  const noPointer = await writeTemp(t, 'b.mobi', createMobiFixture({ coverIndex: null }));
  assert.equal((await readMobiMetadata(noPointer)).cover, null);
});

test('an out-of-range cover pointer is ignored instead of reading another record', async (t) => {
  const cover = Buffer.alloc(4);
  cover.writeUInt32BE(9999, 0);
  const file = await writeTemp(t, 'bad-cover.mobi', createMobiFixture({
    exthRecordsOverride: [exthRecord(503, '越界封面'), exthRecord(201, cover)]
  }));
  const metadata = await readMobiMetadata(file);
  assert.equal(metadata.title, '越界封面');
  assert.equal(metadata.cover, null);
});

test('multiple EXTH authors are joined and uncompressed text is reported', async (t) => {
  const file = await writeTemp(t, 'multi.mobi', createMobiFixture({
    compression: 'none',
    exthRecordsOverride: [exthRecord(100, '甲'), exthRecord(100, '乙'), exthRecord(101, '出版社')]
  }));
  const metadata = await readMobiMetadata(file);
  assert.equal(metadata.author, '甲、乙');
  assert.equal(metadata.publisher, '出版社');
  assert.equal(metadata.title, 'MOBI 测试书', 'falls back to the MOBI full name');
  assert.equal(metadata.compression, 'none');
});

test('detects KF8 in standalone AZW3 and combined MOBI6+KF8 files', async (t) => {
  const standalone = await writeTemp(t, 'a.azw3', createMobiFixture({ kf8: 'standalone' }));
  assert.equal((await readMobiMetadata(standalone)).format, 'kf8');
  const combo = await writeTemp(t, 'b.mobi', createMobiFixture({ kf8: 'combo' }));
  const metadata = await readMobiMetadata(combo);
  assert.equal(metadata.format, 'kf8');
  assert.ok(metadata.kf8RecordOffset > 0);
});

test('DRM-protected files are reported as DRM, never as readable books', async (t) => {
  const file = await writeTemp(t, 'drm.azw', createDrmMobiFixture());
  const metadata = await readMobiMetadata(file);
  assert.equal(metadata.drm, true);
  const combo = await writeTemp(t, 'drm-combo.azw3', createDrmMobiFixture({ kf8: 'combo' }));
  assert.equal((await readMobiMetadata(combo)).drm, true);
});

test('truncated, non-MOBI and garbage files fail with a typed error', async (t) => {
  const cases = [
    ['truncated.mobi', createTruncatedMobiFixture(), 'TRUNCATED'],
    ['text.mobi', createNonMobiPdbFixture(), 'NOT_MOBI'],
    ['tiny.mobi', Buffer.from('not a book'), 'NOT_MOBI'],
    ['zero.mobi', Buffer.alloc(4096), 'NOT_MOBI']
  ];
  for (const [name, bytes, code] of cases) {
    const file = await writeTemp(t, name, bytes);
    await assert.rejects(readMobiMetadata(file), (error) => error instanceof MobiFormatError && error.code === code, name);
  }
});

test('record tables that are non-monotonic or overlap the header are rejected', () => {
  const bytes = Buffer.from(createMobiFixture());
  const first = bytes.readUInt32BE(78);
  bytes.writeUInt32BE(first, 78 + 8); // record 1 starts where record 0 starts
  assert.throws(() => parseMobiStructure(bytes), (error) => error.code === 'INVALID_HEADER');
  const early = Buffer.from(createMobiFixture());
  early.writeUInt32BE(10, 78); // record 0 inside the PDB header
  assert.throws(() => parseMobiStructure(early), (error) => error.code === 'INVALID_HEADER');
});

test('unsupported compression or text encoding is rejected before conversion', () => {
  const compression = Buffer.from(createMobiFixture());
  const record0 = compression.readUInt32BE(78);
  compression.writeUInt16BE(99, record0);
  assert.throws(() => parseMobiStructure(compression), (error) => error.code === 'UNSUPPORTED_COMPRESSION');
  const encoding = Buffer.from(createMobiFixture());
  encoding.writeUInt32BE(1200, encoding.readUInt32BE(78) + 28);
  assert.throws(() => parseMobiStructure(encoding), (error) => error.code === 'UNSUPPORTED_ENCODING');
});

test('files above the size limit are rejected without being read', async (t) => {
  const file = await writeTemp(t, 'big.mobi', createMobiFixture());
  await assert.rejects(readMobiMetadata(file, { maxFileBytes: 64 }), (error) => error.code === 'TOO_LARGE');
});
