'use strict';

function rejection(kind) {
  return { kind };
}

function parseSingleByteRange(header, size) {
  if (typeof header !== 'string' || !Number.isSafeInteger(size) || size < 0) return rejection('invalid');
  if (header.includes(',')) return rejection('multiple');
  const match = header.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return rejection('invalid');

  let start;
  let end;
  try {
    if (!match[1]) {
      const suffixLength = BigInt(match[2]);
      if (suffixLength === 0n || size === 0) return rejection('unsatisfiable');
      start = suffixLength >= BigInt(size) ? 0 : size - Number(suffixLength);
      end = size - 1;
    } else {
      const requestedStart = BigInt(match[1]);
      const requestedEnd = match[2] ? BigInt(match[2]) : BigInt(size) - 1n;
      if (requestedStart > BigInt(Number.MAX_SAFE_INTEGER)
        || requestedEnd > BigInt(Number.MAX_SAFE_INTEGER)) return rejection('invalid');
      if (size === 0 || requestedStart >= BigInt(size) || requestedStart > requestedEnd) {
        return rejection('unsatisfiable');
      }
      start = Number(requestedStart);
      end = Number(requestedEnd >= BigInt(size) ? BigInt(size) - 1n : requestedEnd);
    }
  } catch {
    return rejection('invalid');
  }

  return { start, end };
}

module.exports = { parseSingleByteRange };
