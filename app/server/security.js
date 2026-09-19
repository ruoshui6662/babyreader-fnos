'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sanitizeHtml = require('sanitize-html');

const ZIP_LIMITS = Object.freeze({
  maxEntries: 10000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 100
});

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveAuthorizedPath(candidate, authorizedRoots, options = {}) {
  const { mustExist = true, allowDirectory = false } = options;
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('\0')) {
    throw new Error('Invalid path');
  }
  if (!Array.isArray(authorizedRoots) || authorizedRoots.length === 0) {
    throw new Error('No authorized library roots configured');
  }

  const roots = await Promise.all(authorizedRoots.map((root) => fs.realpath(root)));
  let resolved;
  try {
    resolved = await fs.realpath(candidate);
  } catch (error) {
    if (mustExist || error.code !== 'ENOENT') throw error;
    const parent = await fs.realpath(path.dirname(candidate));
    resolved = path.join(parent, path.basename(candidate));
  }

  if (!roots.some((root) => isPathInside(root, resolved))) {
    throw new Error('Path is outside authorized library roots');
  }

  if (mustExist) {
    const stat = await fs.lstat(resolved);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
    if (!allowDirectory && !stat.isFile()) throw new Error('Path is not a regular file');
  }
  return resolved;
}

function validateZipEntryName(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) {
    throw new Error('Invalid ZIP entry name');
  }
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('Absolute ZIP paths are forbidden');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) {
    throw new Error('ZIP path traversal detected');
  }
  return parts.filter((part) => part && part !== '.').join('/');
}

function enforceZipLimits(entries, limits = ZIP_LIMITS) {
  if (!Array.isArray(entries)) throw new Error('ZIP entries must be an array');
  if (entries.length > limits.maxEntries) throw new Error('ZIP contains too many entries');

  let total = 0;
  for (const entry of entries) {
    validateZipEntryName(entry.name);
    const uncompressedSize = Number(entry.uncompressedSize || 0);
    const compressedSize = Number(entry.compressedSize || 0);
    if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0) {
      throw new Error('Invalid ZIP entry size');
    }
    if (uncompressedSize > limits.maxEntryBytes) throw new Error('ZIP entry is too large');
    total += uncompressedSize;
    if (total > limits.maxTotalBytes) throw new Error('ZIP expands beyond the allowed size');
    if (uncompressedSize > 0 && compressedSize === 0) throw new Error('Invalid ZIP compression size');
    if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      throw new Error('ZIP compression ratio exceeds the safety limit');
    }
  }
  return total;
}

function sanitizeEpubHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: [
      'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite',
      'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption',
      'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'main',
      'nav', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strong', 'sub',
      'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ],
    allowedAttributes: {
      '*': ['id', 'class', 'lang', 'dir', 'title'],
      a: ['href', 'name'],
      img: ['src', 'alt', 'width', 'height']
    },
    allowedSchemes: ['data'],
    allowedSchemesByTag: { a: [], img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          href: typeof attribs.href === 'string' && attribs.href.startsWith('#') ? attribs.href : '#'
        }
      })
    }
  });
}

module.exports = {
  ZIP_LIMITS,
  enforceZipLimits,
  isPathInside,
  resolveAuthorizedPath,
  sanitizeEpubHtml,
  validateZipEntryName
};
