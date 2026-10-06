'use strict';

const fs = require('node:fs/promises');
const zlib = require('node:zlib');
const { unzipSync } = require('fflate');
const { enforceZipLimits, validateZipEntryName, ZIP_LIMITS } = require('./security');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const MAX_COMPRESSED_ARCHIVE_BYTES = 128 * 1024 * 1024;

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Invalid ZIP: end of central directory not found');
}

function inspectZip(buffer, limits = ZIP_LIMITS) {
  if (!Buffer.isBuffer(buffer)) throw new Error('ZIP input must be a Buffer');
  if (buffer.length > MAX_COMPRESSED_ARCHIVE_BYTES) {
    throw new Error('ZIP archive exceeds the compressed size limit');
  }
  if (buffer.length < 22) throw new Error('Invalid ZIP: archive is too small');

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Multi-disk ZIP archives are not supported');
  }
  if (
    entryCount === ZIP64_SENTINEL_16 ||
    centralSize === ZIP64_SENTINEL_32 ||
    centralOffset === ZIP64_SENTINEL_32
  ) {
    throw new Error('ZIP64 archives are not supported');
  }
  if (entryCount > limits.maxEntries) throw new Error('ZIP contains too many entries');
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error('Invalid ZIP central directory bounds');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Invalid ZIP central directory entry');
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;

    if (end > buffer.length) throw new Error('Invalid ZIP entry bounds');
    if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported');
    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw new Error('ZIP64 entries are not supported');
    }

    let name;
    try {
      name = decoder.decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw new Error('ZIP entry names must be valid UTF-8');
    }

    entries.push({
      name: validateZipEntryName(name),
      compressedSize,
      uncompressedSize
    });
    offset = end;
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error('ZIP central directory size mismatch');
  }

  enforceZipLimits(entries, limits);
  return entries;
}

function safeUnzip(buffer, limits = ZIP_LIMITS) {
  const entries = inspectZip(buffer, limits);
  const expected = new Map(entries.map((entry) => [entry.name, entry]));
  const result = unzipSync(new Uint8Array(buffer));
  let actualTotal = 0;

  for (const [rawName, data] of Object.entries(result)) {
    const name = validateZipEntryName(rawName);
    const metadata = expected.get(name);
    if (!metadata) throw new Error('Unexpected ZIP entry after decompression');
    if (data.length !== metadata.uncompressedSize) {
      throw new Error('ZIP entry size changed during decompression');
    }
    actualTotal += data.length;
    if (actualTotal > limits.maxTotalBytes) {
      throw new Error('ZIP expands beyond the allowed size');
    }
  }

  return result;
}

const LOCAL_SIGNATURE = 0x04034b50;

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (!bytesRead) throw new Error('Invalid ZIP: unexpected end of file');
    filled += bytesRead;
  }
  return buffer;
}

// Random access to a ZIP on disk: the end record and the central directory
// are read and checked exactly as inspectZip does, but no entry is inflated
// until it is asked for. Reading a book's metadata then costs a few small
// reads instead of loading and unpacking the whole archive.
async function openZipFile(filePath, limits = ZIP_LIMITS) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size > MAX_COMPRESSED_ARCHIVE_BYTES) throw new Error('ZIP archive exceeds the compressed size limit');
    if (size < 22) throw new Error('Invalid ZIP: archive is too small');
    const tailStart = Math.max(0, size - 65557);
    const tail = await readAt(handle, tailStart, size - tailStart);
    const eocd = findEndOfCentralDirectory(tail);
    const diskNumber = tail.readUInt16LE(eocd + 4);
    const centralDisk = tail.readUInt16LE(eocd + 6);
    const entriesOnDisk = tail.readUInt16LE(eocd + 8);
    const entryCount = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new Error('Multi-disk ZIP archives are not supported');
    }
    if (entryCount === ZIP64_SENTINEL_16 || centralSize === ZIP64_SENTINEL_32 || centralOffset === ZIP64_SENTINEL_32) {
      throw new Error('ZIP64 archives are not supported');
    }
    if (entryCount > limits.maxEntries) throw new Error('ZIP contains too many entries');
    if (centralOffset + centralSize > tailStart + eocd) throw new Error('Invalid ZIP central directory bounds');

    const central = await readAt(handle, centralOffset, centralSize);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = [];
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
        throw new Error('Invalid ZIP central directory entry');
      }
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) throw new Error('Invalid ZIP entry bounds');
      if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported');
      if (compressedSize === ZIP64_SENTINEL_32 || uncompressedSize === ZIP64_SENTINEL_32 || localHeaderOffset === ZIP64_SENTINEL_32) {
        throw new Error('ZIP64 entries are not supported');
      }
      let name;
      try {
        name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
      } catch {
        throw new Error('ZIP entry names must be valid UTF-8');
      }
      entries.push({ name: validateZipEntryName(name), method, compressedSize, uncompressedSize, localHeaderOffset });
      offset = end;
    }
    if (offset !== centralSize) throw new Error('ZIP central directory size mismatch');
    enforceZipLimits(entries, limits);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    return {
      entries,
      has: (name) => byName.has(name),
      // The entry's bytes, or null when the archive has no such entry.
      async read(name) {
        const entry = byName.get(name);
        if (!entry) return null;
        const header = await readAt(handle, entry.localHeaderOffset, 30);
        if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error('Invalid ZIP local header');
        const dataOffset = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        if (dataOffset + entry.compressedSize > size) throw new Error('Invalid ZIP entry bounds');
        const data = await readAt(handle, dataOffset, entry.compressedSize);
        let bytes;
        if (entry.method === 0) bytes = data;
        else if (entry.method === 8) bytes = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
        else throw new Error('Unsupported ZIP compression method');
        if (bytes.length !== entry.uncompressedSize) throw new Error('ZIP entry size changed during decompression');
        return bytes;
      },
      close: () => handle.close()
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

module.exports = {
  MAX_COMPRESSED_ARCHIVE_BYTES,
  inspectZip,
  openZipFile,
  safeUnzip
};
