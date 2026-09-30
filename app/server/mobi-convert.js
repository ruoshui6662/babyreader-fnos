'use strict';

// MOBI6 → derived EPUB converter (MOBI plan Task 2). Decompression reuses the
// vendored lingo-reader MobiFile; everything else happens here on raw bytes so
// filepos targets land at exact byte offsets:
//   1. split the body at <mbp:pagebreak>, then bound oversized sections at
//      heading/paragraph starts;
//   2. insert <a id="fpN"> anchors and rewrite filepos links;
//   3. map recindex images to packaged files (record-range checked);
//   4. decode, then normalize/sanitize to XHTML with sanitize-html.
// Chapter hrefs `text/part-NNNN.xhtml` are frozen: highlights locate by
// chapterHref. Changing section boundaries requires a CONVERTER_VERSION bump
// together with an annotation migration.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sanitizeHtml = require('sanitize-html');
const { parseMobiStructure, sniffImageExtension, MobiFormatError } = require('./mobi-format');
const { buildEpub } = require('./epub-writer');
const { safeUnzip } = require('./zip');

const MOBI_CONVERTER_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  maxTextBytes: 32 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalImageBytes: 128 * 1024 * 1024,
  maxSections: 5000,
  maxSectionBytes: 400 * 1024,
  targetSectionBytes: 256 * 1024
});
// PDB records that are never book images.
const NON_IMAGE_MAGIC = new Set(['FLIS', 'FCIS', 'SRCS', 'RESC', 'DATP', 'BOUN', 'FDST', 'INDX', 'CMET', 'FONT', 'AUDI', 'VIDE', 'kind']);
const EOF_MAGIC = Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]);
const PAGEBREAK = /<\s*(?:mbp:)?pagebreak[^>]*>/gi;
const BASE_CSS = [
  'p { margin: 0 0 0.6em; }',
  '.align-center { text-align: center; }',
  '.align-right { text-align: right; }',
  '.align-left { text-align: left; }',
  '.align-justify { text-align: justify; }',
  'img { max-width: 100%; height: auto; }',
  ''
].join('\n');

let parserModule = null;
async function loadParser() {
  parserModule ||= import(pathToFileURL(path.join(__dirname, 'vendor', 'lingo-mobi', 'mobi-parser.mjs')).href);
  return parserModule;
}

function conversionError(code, message) {
  return new MobiFormatError(code, message);
}

const partHref = (index) => `part-${String(index + 1).padStart(4, '0')}.xhtml`;

// ----- section boundaries (byte offsets into the decompressed text) -----

function bodyRange(raw) {
  const open = /<body\b[^>]*>/i.exec(raw);
  const start = open ? open.index + open[0].length : 0;
  const close = raw.toLowerCase().lastIndexOf('</body>');
  return { start, end: close >= start ? close : raw.length };
}

function pagebreakSections(raw, body) {
  const sections = [];
  let cursor = body.start;
  PAGEBREAK.lastIndex = body.start;
  for (let match = PAGEBREAK.exec(raw); match && match.index < body.end; match = PAGEBREAK.exec(raw)) {
    sections.push({ start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }
  sections.push({ start: cursor, end: body.end });
  return sections;
}

function splitOversized(raw, section, limits) {
  if (section.end - section.start <= limits.maxSectionBytes) return [section];
  const cuts = new Set();
  // Prefer heading starts, then paragraph starts near the target size.
  const headings = /<h[1-3][\s>]/gi;
  headings.lastIndex = section.start + 1;
  for (let match = headings.exec(raw); match && match.index < section.end; match = headings.exec(raw)) cuts.add(match.index);
  let pieces = [];
  let cursor = section.start;
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    pieces.push({ start: cursor, end: cut });
    cursor = cut;
  }
  pieces.push({ start: cursor, end: section.end });
  const bounded = [];
  for (const piece of pieces) {
    let start = piece.start;
    while (piece.end - start > limits.maxSectionBytes) {
      const paragraph = /<p[\s>]/gi;
      paragraph.lastIndex = start + limits.targetSectionBytes;
      const match = paragraph.exec(raw);
      if (!match || match.index >= piece.end) break;
      bounded.push({ start, end: match.index });
      start = match.index;
    }
    bounded.push({ start, end: piece.end });
  }
  pieces = bounded.filter((piece) => piece.end > piece.start);
  return pieces;
}

function hasContent(raw, section) {
  const slice = raw.slice(section.start, section.end);
  return /<img\b/i.test(slice) || slice.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/gi, '') !== '';
}

// ----- filepos anchors, links and images (still latin1 == raw bytes) -----

function safeInsertionPoint(raw, position, section, encoding) {
  let point = Math.min(Math.max(position, section.start), section.end);
  const lastOpen = raw.lastIndexOf('<', point - 1);
  const lastClose = raw.lastIndexOf('>', point - 1);
  if (lastOpen >= section.start && lastOpen > lastClose) point = lastOpen; // inside a tag
  if (encoding === 'utf-8') {
    while (point > section.start && (raw.charCodeAt(point) & 0xc0) === 0x80) point -= 1;
  }
  return point;
}

function fileposTargets(raw) {
  const targets = new Set();
  for (const match of raw.matchAll(/filepos\s*=\s*["']?0*(\d+)/gi)) targets.add(Number(match[1]));
  return [...targets].sort((a, b) => a - b);
}

function sectionIndexFor(sections, position) {
  // First section whose end is past the position; positions in the head map to part 1.
  let low = 0;
  let high = sections.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sections[middle].end <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function imageFor(recindex, context) {
  const { structure, bytes, limits, images } = context;
  if (!Number.isInteger(recindex) || recindex < 1 || structure.firstImageIndex === null) return null;
  const record = structure.firstImageIndex + recindex - 1;
  if (record >= structure.recordCount) return null;
  const href = `images/img-${String(recindex).padStart(4, '0')}`;
  const existing = images.get(recindex);
  if (existing !== undefined) return existing;
  const start = structure.recordOffsets[record];
  const end = record + 1 < structure.recordCount ? structure.recordOffsets[record + 1] : bytes.length;
  const data = bytes.subarray(start, end);
  const magic = data.subarray(0, 4).toString('latin1');
  const extension = NON_IMAGE_MAGIC.has(magic) || data.subarray(0, 4).equals(EOF_MAGIC) ? null : sniffImageExtension(data);
  if (!extension || data.length > limits.maxImageBytes || context.imageBytes + data.length > limits.maxTotalImageBytes) {
    images.set(recindex, null);
    return null;
  }
  context.imageBytes += data.length;
  const image = { href: `${href}${extension}`, bytes: new Uint8Array(data) };
  images.set(recindex, image);
  return image;
}

function rewriteSection(raw, section, anchors, context) {
  let slice = raw.slice(section.start, section.end);
  // Anchors first, from the end, so earlier offsets stay valid.
  for (const { point, target } of [...anchors].sort((a, b) => b.point - a.point || b.target - a.target)) {
    const offset = point - section.start;
    slice = `${slice.slice(0, offset)}<a id="fp${target}"></a>${slice.slice(offset)}`;
  }
  slice = slice.replace(/<a\b[^>]*>/gi, (tag) => {
    const match = /filepos\s*=\s*["']?0*(\d+)["']?/i.exec(tag);
    if (!match) return tag;
    const href = context.hrefForTarget(Number(match[1]));
    const cleaned = tag.replace(match[0], '').replace(/\shref\s*=\s*(["'])[^"']*\1/i, '');
    return href ? cleaned.replace(/^<a\b/i, `<a href="${href}"`) : cleaned;
  });
  slice = slice.replace(/<img\b[^>]*>/gi, (tag) => {
    const recindex = /recindex\s*=\s*["']?(\d+)/i.exec(tag);
    const image = recindex ? imageFor(Number(recindex[1]), context) : null;
    if (!image) return '';
    const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(tag);
    return `<img src="../${image.href}"${alt ? ` alt="${alt[2]}"` : ''}>`;
  });
  return slice;
}

// ----- XHTML normalization -----

function alignClass(tagName, attribs) {
  const align = String(attribs.align || '').toLowerCase();
  const next = { ...(attribs.id ? { id: attribs.id } : {}) };
  if (['center', 'right', 'left', 'justify'].includes(align)) next.class = `align-${align}`;
  return { tagName, attribs: next };
}

const BLOCK_WITH_ALIGN = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th'];

function toXhtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'div', 'dl', 'dt',
      'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'q', 's',
      'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ],
    allowedAttributes: { '*': ['id', 'class'], a: ['href', 'id'], img: ['src', 'alt'] },
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    selfClosing: ['img', 'br', 'hr'],
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
    transformTags: {
      ...Object.fromEntries(BLOCK_WITH_ALIGN.map((tag) => [tag, alignClass])),
      center: (tagName, attribs) => ({ tagName: 'div', attribs: { class: 'align-center', ...(attribs.id ? { id: attribs.id } : {}) } }),
      font: () => ({ tagName: 'span', attribs: {} }),
      big: () => ({ tagName: 'span', attribs: {} }),
      tt: () => ({ tagName: 'code', attribs: {} })
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src
  }).replace(/<span>([\s\S]*?)<\/span>/g, (whole, inner) => (/<span/.test(inner) ? whole : inner));
}

function plainText(html) {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

function firstHeading(xhtml) {
  const match = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(xhtml);
  return match ? plainText(match[1]).slice(0, 200) : '';
}

function guideTocTarget(raw, body) {
  const head = raw.slice(0, body.start);
  for (const reference of head.matchAll(/<reference\b[^>]*>/gi)) {
    if (!/type\s*=\s*["']?toc/i.test(reference[0])) continue;
    const target = /filepos\s*=\s*["']?0*(\d+)/i.exec(reference[0]);
    if (target) return Number(target[1]);
  }
  return null;
}

function tocEntriesFrom(raw, section, decode, hrefForTarget) {
  const entries = [];
  const slice = raw.slice(section.start, section.end);
  for (const match of slice.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const target = /filepos\s*=\s*["']?0*(\d+)/i.exec(match[1]);
    if (!target) continue;
    const href = hrefForTarget(Number(target[1]));
    const label = plainText(decode(match[2]));
    if (href && label) entries.push({ label: label.slice(0, 200), href: `text/${href}` });
  }
  return entries;
}

/**
 * @param {Uint8Array|Buffer} input MOBI file bytes.
 * @param {{identifier:string, limits?:object}} options
 * @returns {Promise<Uint8Array>} EPUB bytes.
 */
async function convertMobiToEpub(input, { identifier, limits: overrides = {} } = {}) {
  if (!identifier) throw new TypeError('identifier is required');
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const structure = parseMobiStructure(bytes);
  if (structure.drm) throw conversionError('DRM_PROTECTED', 'The book is DRM protected');
  if (structure.format !== 'mobi6') throw conversionError('UNSUPPORTED_FORMAT', 'KF8/AZW3 conversion is not enabled yet');
  if (structure.textLength > limits.maxTextBytes) throw conversionError('TOO_LARGE', 'MOBI text exceeds the conversion limit');

  const { MobiFile } = await loadParser();
  let raw;
  try {
    const file = new MobiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'book.mobi');
    const chunks = [];
    let total = 0;
    for (let index = 0; index < file.palmdocHeader.numTextRecords; index += 1) {
      const chunk = Buffer.from(file.loadTextBuffer(index));
      total += chunk.length;
      if (total > limits.maxTextBytes) throw conversionError('TOO_LARGE', 'MOBI text exceeds the conversion limit');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('latin1');
  } catch (error) {
    if (error instanceof MobiFormatError) throw error;
    throw conversionError('CORRUPT', 'MOBI text could not be decompressed');
  }

  const decoder = new TextDecoder(structure.encoding, { fatal: false });
  const decode = (latin1) => decoder.decode(Buffer.from(latin1, 'latin1'));
  const body = bodyRange(raw);
  const sections = pagebreakSections(raw, body)
    .flatMap((section) => splitOversized(raw, section, limits))
    .filter((section) => hasContent(raw, section));
  if (!sections.length) throw conversionError('CORRUPT', 'MOBI book has no readable text');
  if (sections.length > limits.maxSections) throw conversionError('TOO_LARGE', 'MOBI book has too many sections');

  // Anchor placement is resolved once so links and anchors always agree.
  const anchorsBySection = sections.map(() => []);
  const targetHref = new Map();
  for (const target of fileposTargets(raw)) {
    if (target >= body.end) continue;
    const index = sectionIndexFor(sections, target);
    const point = safeInsertionPoint(raw, target, sections[index], structure.encoding);
    anchorsBySection[index].push({ point, target });
    targetHref.set(target, `${partHref(index)}#fp${target}`);
  }
  const context = {
    structure, bytes, limits, images: new Map(), imageBytes: 0,
    hrefForTarget: (target) => targetHref.get(target) || null
  };

  const tocTarget = guideTocTarget(raw, body);
  const tocSection = tocTarget === null ? null : sections[sectionIndexFor(sections, tocTarget)];
  const toc = tocSection ? tocEntriesFrom(raw, tocSection, decode, context.hrefForTarget) : [];

  const chapters = sections.map((section, index) => {
    const xhtml = toXhtml(decode(rewriteSection(raw, section, anchorsBySection[index], context)));
    return { href: `text/${partHref(index)}`, title: firstHeading(xhtml) || `第 ${index + 1} 部分`, body: xhtml };
  });

  const images = [...context.images.values()].filter(Boolean);
  let coverHref = null;
  if (structure.coverRecordIndex !== null && structure.firstImageIndex !== null) {
    const cover = imageFor(structure.coverRecordIndex - structure.firstImageIndex + 1, context);
    if (cover) {
      coverHref = cover.href;
      if (!images.includes(cover)) images.push(cover);
    }
  }
  images.sort((left, right) => left.href.localeCompare(right.href));

  const epub = buildEpub({
    identifier,
    title: structure.title || '未命名书籍',
    authors: structure.author ? structure.author.split('、') : [],
    language: structure.language,
    publisher: structure.publisher,
    chapters,
    images,
    toc,
    css: BASE_CSS,
    coverHref
  });
  // Never hand out an artifact the reader would refuse to open.
  try {
    safeUnzip(Buffer.from(epub));
  } catch {
    throw conversionError('CONVERSION_INVALID', 'Converted EPUB failed the archive safety checks');
  }
  return epub;
}

module.exports = { MOBI_CONVERTER_VERSION, MOBI_CONVERSION_LIMITS: DEFAULT_LIMITS, convertMobiToEpub };
