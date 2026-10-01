'use strict';

// Deterministic MOBI6 (Mobipocket) fixture generator. It writes the real
// on-disk structure — PDB header, PalmDOC record 0, MOBI header, EXTH,
// PalmDOC-compressed text records, image records and an EOF record — so the
// scanner and converter are exercised without shipping any real book.

const RECORD_SIZE = 4096;
const MOBI_HEADER_LENGTH = 232;
const NULL_INDEX = 0xffffffff;
const EOF_RECORD = Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]);
// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=',
  'base64'
);

// PalmDOC LZ77: literals, 0x01-0x08 escapes for bytes that collide with the
// command space, 0xC0-0xFF space+char pairs and 0x80-0xBF back-references
// (distance 1-2047, length 3-10). Greedy search keeps it simple and valid.
function palmdocCompress(input) {
  const output = [];
  // 3-byte hash chains keep compression linear enough for multi-MB fixtures.
  const chains = new Map();
  const remember = (position) => {
    if (position + 2 >= input.length) return;
    const key = (input[position] << 16) | (input[position + 1] << 8) | input[position + 2];
    const chain = chains.get(key);
    if (chain) {
      chain.push(position);
      if (chain.length > 32) chain.shift();
    } else {
      chains.set(key, [position]);
    }
  };
  let index = 0;
  while (index < input.length) {
    let bestLength = 0;
    let bestDistance = 0;
    const key = index + 2 < input.length ? (input[index] << 16) | (input[index + 1] << 8) | input[index + 2] : -1;
    const candidates = chains.get(key) || [];
    for (let slot = candidates.length - 1; slot >= 0; slot--) {
      const candidate = candidates[slot];
      if (index - candidate > 2047) break;
      let length = 0;
      while (length < 10 && index + length < input.length && input[candidate + length] === input[index + length]) length++;
      if (length > bestLength) {
        bestLength = length;
        bestDistance = index - candidate;
        if (length === 10) break;
      }
    }
    if (bestLength >= 3) {
      const pair = 0x8000 | (bestDistance << 3) | (bestLength - 3);
      output.push(pair >> 8, pair & 0xff);
      for (let step = 0; step < bestLength; step++) remember(index + step);
      index += bestLength;
      continue;
    }
    remember(index);
    if (bestLength >= 3) {
      const pair = 0x8000 | (bestDistance << 3) | (bestLength - 3);
      output.push(pair >> 8, pair & 0xff);
      index += bestLength;
      continue;
    }
    const byte = input[index];
    const next = input[index + 1];
    if (byte === 0x20 && next !== undefined && next >= 0x40 && next <= 0x7f) {
      output.push(next ^ 0x80);
      index += 2;
    } else if (byte === 0x00 || (byte >= 0x09 && byte <= 0x7f)) {
      output.push(byte);
      index += 1;
    } else {
      output.push(0x01, byte);
      index += 1;
    }
  }
  return Buffer.from(output);
}

function exthRecord(type, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(type, 0);
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

function exthBlock(records) {
  const body = Buffer.concat(records);
  const header = Buffer.alloc(12);
  header.write('EXTH', 0, 'ascii');
  header.writeUInt32BE(12 + body.length, 4);
  header.writeUInt32BE(records.length, 8);
  const padding = (4 - ((12 + body.length) % 4)) % 4;
  return Buffer.concat([header, body, Buffer.alloc(padding)]);
}

function defaultChapters() {
  return [
    { title: '第一章 启程', body: '<p>这是第一章的正文。重复检索词出现在这里。</p><p>第二段用于验证分页与划线。</p>' },
    { title: '第二章 远行', body: '<p>第二章包含一张图片与一个回到第一章的链接。</p><p><img recindex="00001" alt="插图" /></p><p><a filepos="{{chapter:0}}">回到第一章</a></p>' },
    { title: '第三章 归来', body: '<p>第三章是结尾。重复检索词再次出现。</p>' }
  ];
}

// Builds the MOBI6 HTML stream. Chapters are separated by <mbp:pagebreak/>;
// {{chapter:N}} placeholders become 10-digit filepos values pointing at the
// byte offset of chapter N's heading, as Kindle tools emit them.
function buildMarkup(chapters, { toc = true } = {}) {
  const pad = (value) => String(value).padStart(10, '0');
  const render = (positions) => {
    const tocChapter = toc
      ? `<h2>目录</h2>${chapters.map((chapter, index) => `<p><a filepos=${pad(positions[index] ?? 0)}>${chapter.title}</a></p>`).join('')}<mbp:pagebreak/>`
      : '';
    const guide = toc ? `<guide><reference type="toc" title="目录" filepos=${pad(positions.toc ?? 0)} /></guide>` : '';
    let html = `<html><head>${guide}</head><body>`;
    const offsets = {};
    offsets.toc = Buffer.byteLength(html, 'utf8');
    html += tocChapter;
    chapters.forEach((chapter, index) => {
      if (index > 0) html += '<mbp:pagebreak/>';
      offsets[index] = Buffer.byteLength(html, 'utf8');
      html += `<h1>${chapter.title}</h1>${chapter.body.replace(/\{\{chapter:(\d+)\}\}/g, (_, n) => pad(positions[Number(n)] ?? 0))}`;
    });
    html += '</body></html>';
    return { html, offsets };
  };
  // filepos values are fixed-width, so a second pass resolves them exactly.
  const first = render({});
  return Buffer.from(render(first.offsets).html, 'utf8');
}

function createMobiFixture({
  title = 'MOBI 测试书',
  author = '枕书 Fixtures',
  chapters = defaultChapters(),
  compression = 'palmdoc',
  encryption = 0,
  images = [TINY_PNG],
  coverIndex = 0,
  toc = true,
  language = 4, // zh
  // null: MOBI6 only; 'standalone': an AZW3-style file whose record 0 says
  // version 8; 'combo': MOBI6 followed by a BOUNDARY record and a KF8 record 0
  // located through EXTH 121, as KindleGen emits.
  kf8 = null,
  exthRecordsOverride = null
} = {}) {
  const text = buildMarkup(chapters, { toc });
  const textRecords = [];
  for (let offset = 0; offset < text.length; offset += RECORD_SIZE) {
    const chunk = text.subarray(offset, offset + RECORD_SIZE);
    textRecords.push(compression === 'palmdoc' ? palmdocCompress(chunk) : chunk);
  }
  const firstImageIndex = images.length ? textRecords.length + 1 : NULL_INDEX;

  const exthRecords = exthRecordsOverride || [exthRecord(100, author), exthRecord(503, title), exthRecord(524, 'zh')];
  // Combo files: KF8 record 0 sits after text, images and a BOUNDARY record.
  const kf8HeaderIndex = kf8 === 'combo' ? textRecords.length + 1 + images.length + 1 : null;
  if (kf8HeaderIndex !== null) {
    const boundary = Buffer.alloc(4);
    boundary.writeUInt32BE(kf8HeaderIndex, 0);
    exthRecords.push(exthRecord(121, boundary));
  }
  if (images.length && coverIndex !== null) {
    const cover = Buffer.alloc(4);
    cover.writeUInt32BE(coverIndex, 0);
    exthRecords.push(exthRecord(201, cover));
  }
  const exth = exthBlock(exthRecords);
  const fullName = Buffer.from(title, 'utf8');

  const record0 = Buffer.alloc(16 + MOBI_HEADER_LENGTH);
  record0.writeUInt16BE(compression === 'palmdoc' ? 2 : 1, 0);
  record0.writeUInt32BE(text.length, 4);
  record0.writeUInt16BE(textRecords.length, 8);
  record0.writeUInt16BE(RECORD_SIZE, 10);
  record0.writeUInt16BE(encryption, 12);
  record0.write('MOBI', 16, 'ascii');
  record0.writeUInt32BE(MOBI_HEADER_LENGTH, 20);
  record0.writeUInt32BE(2, 24); // Mobipocket book
  record0.writeUInt32BE(65001, 28); // UTF-8
  record0.writeUInt32BE(0x42524652, 32);
  record0.writeUInt32BE(kf8 === 'standalone' ? 8 : 6, 36); // file version
  for (let offset = 0x28; offset <= 0x4c; offset += 4) record0.writeUInt32BE(NULL_INDEX, offset);
  record0.writeUInt32BE(textRecords.length + 1, 0x50); // first non-book record
  record0.writeUInt32BE(16 + MOBI_HEADER_LENGTH + exth.length, 0x54);
  record0.writeUInt32BE(fullName.length, 0x58);
  record0.writeUInt32BE(language, 0x5c);
  record0.writeUInt32BE(6, 0x68);
  record0.writeUInt32BE(firstImageIndex, 0x6c);
  record0.writeUInt32BE(0x40, 0x80); // has EXTH
  record0.writeUInt32BE(encryption ? 16 + MOBI_HEADER_LENGTH : NULL_INDEX, 0xa8);
  record0.writeUInt32BE(encryption ? 1 : 0, 0xac);
  record0.writeUInt16BE(1, 0xc0);
  record0.writeUInt16BE(textRecords.length, 0xc2);
  record0.writeUInt32BE(1, 0xc4);
  record0.writeUInt32BE(NULL_INDEX, 0xc8);
  record0.writeUInt32BE(NULL_INDEX, 0xd0);
  record0.writeUInt32BE(NULL_INDEX, 0xe0);
  record0.writeUInt32BE(NULL_INDEX, 0xec);
  record0.writeUInt32BE(0, 0xf0); // no trailing multibyte/TBS entries
  record0.writeUInt32BE(NULL_INDEX, 0xf4); // no NCX index
  const header0 = Buffer.concat([record0, exth, fullName, Buffer.alloc(2 + ((4 - (fullName.length + 2) % 4) % 4))]);

  const records = [header0, ...textRecords, ...images];
  if (kf8HeaderIndex !== null) {
    const kf8Header = Buffer.from(header0);
    kf8Header.writeUInt32BE(8, 36);
    kf8Header.writeUInt16BE(encryption, 12);
    records.push(Buffer.from('BOUNDARY', 'ascii'), kf8Header);
  }
  records.push(EOF_RECORD);
  const pdbHeader = Buffer.alloc(78);
  pdbHeader.write(title.replace(/[^\x20-\x7e]/g, '_').slice(0, 31), 0, 'ascii');
  pdbHeader.write('BOOK', 60, 'ascii');
  pdbHeader.write('MOBI', 64, 'ascii');
  pdbHeader.writeUInt32BE(records.length * 2 - 1, 68);
  pdbHeader.writeUInt16BE(records.length, 76);
  const recordList = Buffer.alloc(records.length * 8);
  let offset = 78 + recordList.length + 2;
  records.forEach((record, index) => {
    recordList.writeUInt32BE(offset, index * 8);
    recordList.writeUInt32BE(index * 2, index * 8 + 4);
    offset += record.length;
  });
  return Buffer.concat([pdbHeader, recordList, Buffer.alloc(2), ...records]);
}

function createDrmMobiFixture(options = {}) {
  return createMobiFixture({ ...options, encryption: 2 });
}

function createTruncatedMobiFixture(options = {}) {
  const bytes = createMobiFixture(options);
  return bytes.subarray(0, Math.floor(bytes.length * 0.6));
}

function createNonMobiPdbFixture() {
  const bytes = createMobiFixture();
  bytes.write('TEXt', 60, 'ascii');
  bytes.write('REAd', 64, 'ascii');
  return bytes;
}

// Many chapters of Chinese text, used for size/latency/RSS measurements.
function createLargeMobiFixture({ targetBytes = 8 * 1024 * 1024, compression = 'palmdoc' } = {}) {
  const paragraph = `<p>${'长篇测试文本用于测量解析耗时与内存峰值，包含常见的中文标点与段落结构。'.repeat(8)}</p>`;
  const perChapter = Math.max(1, Math.floor(32 * 1024 / Buffer.byteLength(paragraph)));
  const chapterBytes = Buffer.byteLength(paragraph) * perChapter;
  const count = Math.max(1, Math.ceil(targetBytes / chapterBytes));
  const chapters = Array.from({ length: count }, (_, index) => ({
    title: `第 ${index + 1} 章`,
    body: paragraph.repeat(perChapter)
  }));
  return createMobiFixture({ title: '大体量 MOBI', chapters, compression, toc: false });
}

module.exports = {
  TINY_PNG,
  exthRecord,
  palmdocCompress,
  createMobiFixture,
  createDrmMobiFixture,
  createTruncatedMobiFixture,
  createNonMobiPdbFixture,
  createLargeMobiFixture
};
