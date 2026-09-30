'use strict';

// Bounded MOBI/AZW3 structure and metadata reader. It validates the PDB record
// table, PalmDOC/MOBI headers, EXTH and the KF8 boundary before any
// decompression happens, so DRM, truncated and foreign files are rejected here
// rather than inside the third-party parser (which does not check them).

const fs = require('node:fs/promises');
const nodeFs = require('node:fs');

const PDB_HEADER_BYTES = 78;
const NULL_INDEX = 0xffffffff;
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxRecord0Bytes: 1024 * 1024,
  maxCoverBytes: 8 * 1024 * 1024
});
const COMPRESSION = Object.freeze({ 1: 'none', 2: 'palmdoc', 17480: 'huffcdic' });
const ENCODING = Object.freeze({ 65001: 'utf-8', 1252: 'windows-1252' });
const MAX_EXTH_RECORDS = 2048;
const EXTH = Object.freeze({ AUTHOR: 100, PUBLISHER: 101, KF8_BOUNDARY: 121, COVER: 201, THUMBNAIL: 202, TITLE: 503, LANGUAGE: 524 });

class MobiFormatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MobiFormatError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MobiFormatError(code, message);
}

function parsePdb(header, recordList, fileSize) {
  if (fileSize < PDB_HEADER_BYTES || header.length < PDB_HEADER_BYTES) fail('NOT_MOBI', 'File is too small to be a MOBI book');
  if (header.toString('latin1', 60, 68) !== 'BOOKMOBI') fail('NOT_MOBI', 'File is not a Mobipocket/Kindle book');
  const count = header.readUInt16BE(76);
  if (count < 2) fail('INVALID_HEADER', 'MOBI record table is empty');
  const tableEnd = PDB_HEADER_BYTES + count * 8;
  if (tableEnd > fileSize || recordList.length < count * 8) fail('TRUNCATED', 'MOBI record table is truncated');
  const offsets = [];
  for (let index = 0; index < count; index++) {
    const offset = recordList.readUInt32BE(index * 8);
    if (index === 0 ? offset < tableEnd : offset <= offsets[index - 1]) {
      fail('INVALID_HEADER', 'MOBI record table is not ordered');
    }
    offsets.push(offset);
  }
  if (offsets[count - 1] >= fileSize) fail('TRUNCATED', 'MOBI records extend past the end of the file');
  return {
    count,
    offsets,
    fileSize,
    range(index) {
      if (!Number.isInteger(index) || index < 0 || index >= count) return null;
      return { start: offsets[index], end: index + 1 < count ? offsets[index + 1] : fileSize };
    }
  };
}

function decodeText(bytes, encoding) {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes).replace(/\0+$/, '').trim();
}

function parseExth(record0, start, encoding) {
  const values = new Map();
  if (start + 12 > record0.length || record0.toString('latin1', start, start + 4) !== 'EXTH') return values;
  const declared = Math.min(record0.readUInt32BE(start + 8), MAX_EXTH_RECORDS);
  const end = Math.min(record0.length, start + record0.readUInt32BE(start + 4));
  let cursor = start + 12;
  for (let index = 0; index < declared && cursor + 8 <= end; index++) {
    const type = record0.readUInt32BE(cursor);
    const length = record0.readUInt32BE(cursor + 4);
    if (length < 8 || cursor + length > end) break;
    const data = record0.subarray(cursor + 8, cursor + length);
    if (!values.has(type)) values.set(type, []);
    values.get(type).push(data);
    cursor += length;
  }
  const text = (type) => (values.get(type) || []).map((data) => decodeText(data, encoding)).filter(Boolean);
  const number = (type) => {
    const data = values.get(type)?.[0];
    return data && data.length >= 4 ? data.readUInt32BE(0) : null;
  };
  return {
    authors: text(EXTH.AUTHOR),
    publisher: text(EXTH.PUBLISHER)[0] || '',
    title: text(EXTH.TITLE)[0] || '',
    language: text(EXTH.LANGUAGE)[0] || '',
    kf8Boundary: number(EXTH.KF8_BOUNDARY),
    coverOffset: number(EXTH.COVER),
    thumbnailOffset: number(EXTH.THUMBNAIL)
  };
}

// Parses a PalmDOC record 0 with its MOBI header and EXTH block.
function parseRecord0(record0, pdb) {
  if (record0.length < 16 + 24 || record0.toString('latin1', 16, 20) !== 'MOBI') {
    fail('NOT_MOBI', 'Record 0 has no MOBI header');
  }
  const compressionCode = record0.readUInt16BE(0);
  const compression = COMPRESSION[compressionCode];
  if (!compression) fail('UNSUPPORTED_COMPRESSION', `Unsupported MOBI compression ${compressionCode}`);
  const headerLength = record0.readUInt32BE(20);
  if (headerLength < 0x74 - 16 || 16 + headerLength > record0.length) fail('INVALID_HEADER', 'MOBI header length is invalid');
  const encodingCode = record0.readUInt32BE(28);
  const encoding = ENCODING[encodingCode];
  if (!encoding) fail('UNSUPPORTED_ENCODING', `Unsupported MOBI text encoding ${encodingCode}`);
  const textRecordCount = record0.readUInt16BE(8);
  if (textRecordCount < 1) fail('INVALID_HEADER', 'MOBI book has no text records');
  const field = (offset) => (offset + 4 <= 16 + headerLength ? record0.readUInt32BE(offset) : NULL_INDEX);
  const exth = (field(0x80) & 0x40) ? parseExth(record0, 16 + headerLength, encoding) : parseExth(Buffer.alloc(0), 0, encoding);
  const nameOffset = field(0x54);
  const nameLength = field(0x58);
  const fullName = nameOffset !== NULL_INDEX && nameLength !== NULL_INDEX && nameOffset + nameLength <= record0.length
    ? decodeText(record0.subarray(nameOffset, nameOffset + nameLength), encoding)
    : '';
  return {
    compression,
    encoding,
    encrypted: record0.readUInt16BE(12) !== 0,
    textLength: record0.readUInt32BE(4),
    textRecordCount,
    recordSize: record0.readUInt16BE(10),
    version: field(0x24),
    firstImageIndex: field(0x6c),
    fullName,
    exth
  };
}

function assertTextRecords(info, pdb, base = 0) {
  if (base + 1 + info.textRecordCount > pdb.count) fail('TRUNCATED', 'MOBI text records are missing');
}

function kf8IndexFor(info, pdb) {
  const boundary = info.exth.kf8Boundary;
  if (info.version === 8 || boundary === null || boundary === NULL_INDEX) return null;
  return boundary > 0 && boundary < pdb.count ? boundary : null;
}

function coverIndexFor(info, pdb) {
  if (info.firstImageIndex === NULL_INDEX) return null;
  const offset = [info.exth.coverOffset, info.exth.thumbnailOffset]
    .find((value) => value !== null && value !== NULL_INDEX);
  // Offset 0 (the first image) is valid and the most common value.
  if (offset === undefined) return null;
  const index = info.firstImageIndex + offset;
  return index > 0 && index < pdb.count ? index : null;
}

function sniffImageExtension(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return '.png';
  if (bytes.length >= 6 && bytes.toString('latin1', 0, 4) === 'GIF8') return '.gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function buildMetadata(info, kf8Info, kf8Index, coverBytes) {
  const extension = coverBytes ? sniffImageExtension(coverBytes) : null;
  const source = kf8Info || info;
  return {
    format: info.version === 8 || kf8Info ? 'kf8' : 'mobi6',
    title: source.exth.title || info.exth.title || source.fullName || info.fullName,
    author: (source.exth.authors.length ? source.exth.authors : info.exth.authors).join('、'),
    language: source.exth.language || info.exth.language,
    publisher: source.exth.publisher || info.exth.publisher,
    drm: info.encrypted || Boolean(kf8Info?.encrypted),
    compression: source.compression,
    encoding: source.encoding,
    textLength: source.textLength,
    textRecordCount: source.textRecordCount,
    kf8RecordOffset: kf8Index || 0,
    cover: extension ? { bytes: coverBytes, extension } : null
  };
}

// Parses a complete in-memory MOBI file (used by tests and the converter).
function parseMobiStructure(bytes, limits = {}) {
  const { maxCoverBytes } = { ...DEFAULT_LIMITS, ...limits };
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const pdb = parsePdb(buffer.subarray(0, PDB_HEADER_BYTES), buffer.subarray(PDB_HEADER_BYTES), buffer.length);
  const record = (index) => {
    const range = pdb.range(index);
    return range ? buffer.subarray(range.start, range.end) : null;
  };
  const info = parseRecord0(record(0), pdb);
  assertTextRecords(info, pdb);
  const kf8Index = kf8IndexFor(info, pdb);
  const kf8Info = kf8Index ? parseRecord0(record(kf8Index), pdb) : null;
  if (kf8Info) assertTextRecords(kf8Info, pdb, kf8Index);
  const coverIndex = coverIndexFor(info, pdb);
  const coverRecord = coverIndex ? record(coverIndex) : null;
  const metadata = buildMetadata(info, kf8Info, kf8Index,
    coverRecord && coverRecord.length <= maxCoverBytes ? Buffer.from(coverRecord) : null);
  return { ...metadata, recordCount: pdb.count, recordOffsets: pdb.offsets };
}

async function readExactly(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

// Reads only the PDB table, record 0 (and the KF8 record 0 of combined files)
// and the cover record, never the compressed text.
async function readMobiMetadata(filePath, limits = {}) {
  const { maxFileBytes, maxRecord0Bytes, maxCoverBytes } = { ...DEFAULT_LIMITS, ...limits };
  const flags = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0);
  const handle = await fs.open(filePath, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail('NOT_MOBI', 'MOBI source is not a regular file');
    if (stat.size > maxFileBytes) fail('TOO_LARGE', 'MOBI file exceeds the size limit');
    if (stat.size < PDB_HEADER_BYTES) fail('NOT_MOBI', 'File is too small to be a MOBI book');
    const header = await readExactly(handle, 0, PDB_HEADER_BYTES);
    if (header.toString('latin1', 60, 68) !== 'BOOKMOBI') fail('NOT_MOBI', 'File is not a Mobipocket/Kindle book');
    const count = header.readUInt16BE(76);
    const recordList = await readExactly(handle, PDB_HEADER_BYTES, Math.min(count * 8, stat.size - PDB_HEADER_BYTES));
    const pdb = parsePdb(header, recordList, stat.size);
    const readRecord = async (index, cap) => {
      const range = pdb.range(index);
      if (!range || range.end - range.start > cap) return null;
      return readExactly(handle, range.start, range.end - range.start);
    };
    const record0 = await readRecord(0, maxRecord0Bytes);
    if (!record0) fail('INVALID_HEADER', 'MOBI record 0 is too large');
    const info = parseRecord0(record0, pdb);
    assertTextRecords(info, pdb);
    const kf8Index = kf8IndexFor(info, pdb);
    let kf8Info = null;
    if (kf8Index) {
      const kf8Record0 = await readRecord(kf8Index, maxRecord0Bytes);
      if (!kf8Record0) fail('INVALID_HEADER', 'KF8 record 0 is too large');
      kf8Info = parseRecord0(kf8Record0, pdb);
      assertTextRecords(kf8Info, pdb, kf8Index);
    }
    const coverIndex = coverIndexFor(info, pdb);
    const coverBytes = coverIndex ? await readRecord(coverIndex, maxCoverBytes) : null;
    return buildMetadata(info, kf8Info, kf8Index, coverBytes);
  } finally {
    await handle.close();
  }
}

module.exports = {
  MOBI_EXTENSIONS: new Set(['.mobi', '.azw', '.azw3']),
  DEFAULT_MOBI_LIMITS: DEFAULT_LIMITS,
  MobiFormatError,
  parseMobiStructure,
  readMobiMetadata
};
