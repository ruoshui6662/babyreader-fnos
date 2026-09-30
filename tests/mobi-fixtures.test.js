'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  palmdocCompress,
  createMobiFixture,
  createDrmMobiFixture,
  createTruncatedMobiFixture,
  createNonMobiPdbFixture
} = require('./fixtures/mobi-fixtures');

// Independent reference decoder (PalmDOC spec) so the generator is checked
// against the format, not against the parser under evaluation.
function palmdocDecompress(input) {
  const output = [];
  for (let index = 0; index < input.length;) {
    const byte = input[index++];
    if (byte === 0 || (byte >= 0x09 && byte <= 0x7f)) {
      output.push(byte);
    } else if (byte <= 0x08) {
      for (let count = 0; count < byte; count++) output.push(input[index++]);
    } else if (byte >= 0xc0) {
      output.push(0x20, byte ^ 0x80);
    } else {
      const pair = (byte << 8) | input[index++];
      const distance = (pair >> 3) & 0x7ff;
      const length = (pair & 7) + 3;
      for (let count = 0; count < length; count++) output.push(output[output.length - distance]);
    }
  }
  return Buffer.from(output);
}

function records(bytes) {
  const count = bytes.readUInt16BE(76);
  const offsets = Array.from({ length: count }, (_, index) => bytes.readUInt32BE(78 + index * 8));
  return offsets.map((start, index) => bytes.subarray(start, offsets[index + 1] ?? bytes.length));
}

test('PalmDOC compression round-trips ASCII, CJK and repeated text', () => {
  const input = Buffer.from(`<p>abc abc abc</p>${'重复检索词'.repeat(40)} \x01\x08 end`, 'utf8');
  const compressed = palmdocCompress(input);
  assert.ok(compressed.length < input.length, 'repeated text should compress');
  assert.deepEqual(palmdocDecompress(compressed), input);
});

test('MOBI fixture has a valid PDB, PalmDOC record 0, MOBI header and EXTH', () => {
  const bytes = createMobiFixture({ title: '标题', author: '作者' });
  assert.equal(bytes.toString('ascii', 60, 68), 'BOOKMOBI');
  const [record0, ...rest] = records(bytes);
  assert.equal(record0.readUInt16BE(0), 2, 'PalmDOC compression');
  assert.equal(record0.readUInt16BE(12), 0, 'not encrypted');
  assert.equal(record0.toString('ascii', 16, 20), 'MOBI');
  assert.equal(record0.readUInt32BE(28), 65001);
  const exthOffset = 16 + record0.readUInt32BE(20);
  assert.equal(record0.toString('ascii', exthOffset, exthOffset + 4), 'EXTH');
  const nameOffset = record0.readUInt32BE(0x54);
  assert.equal(record0.toString('utf8', nameOffset, nameOffset + record0.readUInt32BE(0x58)), '标题');

  const textCount = record0.readUInt16BE(8);
  const text = Buffer.concat(rest.slice(0, textCount).map(palmdocDecompress)).toString('utf8');
  assert.equal(Buffer.byteLength(text), record0.readUInt32BE(4));
  assert.match(text, /<mbp:pagebreak\/>/);
  assert.match(text, /recindex="00001"/);
  const firstImage = record0.readUInt32BE(0x6c);
  assert.equal(rest[firstImage - 1].subarray(1, 4).toString('ascii'), 'PNG');
});

test('MOBI fixture filepos links point at the target chapter heading', () => {
  const bytes = createMobiFixture({ compression: 'none' });
  const [record0, ...rest] = records(bytes);
  const text = Buffer.concat(rest.slice(0, record0.readUInt16BE(8)));
  const link = /<a filepos="(\d{10})">回到第一章/.exec(text.toString('utf8'));
  assert.ok(link);
  assert.equal(text.subarray(Number(link[1]), Number(link[1]) + 4).toString('utf8'), '<h1>');
  assert.match(text.subarray(Number(link[1])).toString('utf8'), /^<h1>第一章 启程<\/h1>/);
});

test('DRM, truncated and non-MOBI fixtures differ only where intended', () => {
  const [drm0] = records(createDrmMobiFixture());
  assert.equal(drm0.readUInt16BE(12), 2);
  assert.ok(createTruncatedMobiFixture().length < createMobiFixture().length);
  assert.equal(createNonMobiPdbFixture().toString('ascii', 60, 68), 'TEXtREAd');
});
