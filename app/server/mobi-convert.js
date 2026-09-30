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

const os = require('node:os');
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

// Packages one PDB record as an image, with record-range, type and size checks.
// `key` dedupes references; `name` is the frozen file stem inside images/.
function imageRecord(context, record, key, name) {
  const { structure, bytes, limits, images } = context;
  if (!Number.isInteger(record) || record < 1 || record >= structure.recordCount) return null;
  const href = `images/${name}`;
  const existing = images.get(key);
  if (existing !== undefined) return existing;
  const recindex = key;
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

// MOBI6: recindex is 1-based from the first image record.
function imageFor(recindex, context) {
  if (!Number.isInteger(recindex) || recindex < 1 || context.structure.firstImageIndex === null) return null;
  return imageRecord(context, context.structure.firstImageIndex + recindex - 1, `m${recindex}`, `img-${String(recindex).padStart(4, '0')}`);
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

// Keeps the book's own classes (KF8 CSS targets them) and maps the legacy
// MOBI align attribute to a class, since style attributes are not allowed.
function alignClass(tagName, attribs) {
  const align = String(attribs.align || '').toLowerCase();
  const classes = String(attribs.class || '').split(/\s+/).filter(Boolean);
  if (['center', 'right', 'left', 'justify'].includes(align)) classes.push(`align-${align}`);
  return {
    tagName,
    attribs: { ...(attribs.id ? { id: attribs.id } : {}), ...(classes.length ? { class: classes.join(' ') } : {}) }
  };
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

// ----- MOBI6 -----

async function buildMobi6(bytes, structure, limits, context) {
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
  context.hrefForTarget = (target) => targetHref.get(target) || null;

  const tocTarget = guideTocTarget(raw, body);
  const tocSection = tocTarget === null ? null : sections[sectionIndexFor(sections, tocTarget)];
  const toc = tocSection ? tocEntriesFrom(raw, tocSection, decode, context.hrefForTarget) : [];

  const chapters = sections.map((section, index) => {
    const xhtml = toXhtml(decode(rewriteSection(raw, section, anchorsBySection[index], context)));
    return { href: `text/${partHref(index)}`, title: firstHeading(xhtml) || `第 ${index + 1} 部分`, body: xhtml };
  });
  let cover = null;
  if (structure.coverRecordIndex !== null && structure.firstImageIndex !== null) {
    cover = imageFor(structure.coverRecordIndex - structure.firstImageIndex + 1, context);
  }
  return { chapters, toc, css: BASE_CSS, cover };
}

// ----- KF8 (AZW3, and the KF8 half of combined files) -----
// Every KF8 skeleton becomes exactly one part file; kindle:pos targets become
// <a id="kFID-OFF"> anchors at their exact byte offset in the assembled text.

const KINDLE_POS = /kindle:pos:fid:([0-9A-Va-v]{4}):off:([0-9A-Va-v]{10})/g;
const KINDLE_RESOURCE = /kindle:(flow|embed):([0-9A-Za-z]+)(?:\?mime=([\w.+-]+\/[\w.+-]+))?/;

function kf8AnchorId(fid, off) {
  return `k${fid}-${off}`;
}

function parseKindlePos(value) {
  KINDLE_POS.lastIndex = 0;
  const match = KINDLE_POS.exec(value || '');
  return match ? { fid: Number.parseInt(match[1], 32), off: Number.parseInt(match[2], 32) } : null;
}

// Re-assembles a skeleton with its fragments (same algorithm as upstream
// loadText) but keeps bytes and records where each fragment ended up.
function assembleKf8Chapter(kf8, chapter) {
  const { skel, frags, length } = chapter;
  const raw = Buffer.from(kf8.loadRaw(skel.offset, skel.offset + length));
  let text = raw.subarray(0, skel.length);
  const fragmentStarts = new Map();
  for (const frag of frags) {
    const insert = frag.insertOffset - skel.offset;
    const offset = skel.length + frag.offset;
    const fragment = raw.subarray(offset, offset + frag.length);
    if (insert < 0 || insert > text.length || offset + frag.length > raw.length) {
      throw conversionError('CORRUPT', 'KF8 fragment table is inconsistent');
    }
    for (const [index, start] of fragmentStarts) if (start >= insert) fragmentStarts.set(index, start + fragment.length);
    text = Buffer.concat([text.subarray(0, insert), fragment, text.subarray(insert)]);
    fragmentStarts.set(frag.index, insert);
  }
  return { raw: text.toString('latin1'), fragmentStarts };
}

function kf8ImageName(index) {
  return `img-${index.toString(32).toUpperCase().padStart(4, '0')}`;
}

// KF8 resource ids are 1-based base-32 numbers relative to the first resource.
function kf8ImageFor(id, context) {
  const index = Number.parseInt(id, 32);
  if (!Number.isInteger(index) || index < 1) return null;
  const name = kf8ImageName(index);
  return imageRecord(context, context.resourceStart + index - 1, `k${name}`, name);
}

function kf8FlowText(kf8, id, decode) {
  const index = Number.parseInt(id, 10);
  if (!Number.isInteger(index) || index < 1 || index >= kf8.fdstTable.length) return '';
  const flow = kf8.loadFlow(index);
  return flow ? decode(Buffer.from(flow).toString('latin1')) : '';
}

function rewriteKf8Chapter(raw, anchors, context) {
  let text = raw;
  for (const { point, id } of [...anchors].sort((a, b) => b.point - a.point || (a.id < b.id ? 1 : -1))) {
    text = `${text.slice(0, point)}<a id="${id}"></a>${text.slice(point)}`;
  }
  const open = /<body\b[^>]*>/i.exec(text);
  const close = text.toLowerCase().lastIndexOf('</body>');
  let body = open ? text.slice(open.index + open[0].length, close > open.index ? close : text.length) : text;
  body = body.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => {
    const embed = /kindle:embed:([0-9A-Za-z]+)/.exec(svg);
    const image = embed ? kf8ImageFor(embed[1], context) : null;
    return image ? `<img src="../${image.href}">` : '';
  });
  body = body.replace(/<img\b[^>]*>/gi, (tag) => {
    const source = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag);
    const resource = source ? KINDLE_RESOURCE.exec(source[1]) : null;
    let image = null;
    if (resource?.[1] === 'embed') image = kf8ImageFor(resource[2], context);
    else if (resource?.[1] === 'flow' && /svg/i.test(resource[3] || '')) image = context.kf8FlowImage(resource[2]);
    if (!image) return '';
    const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(tag);
    return `<img src="../${image.href}"${alt ? ` alt="${alt[2]}"` : ''}>`;
  });
  body = body.replace(/\bhref\s*=\s*(["'])(kindle:pos:[^"']*)\1/gi, (whole, quote, value) => {
    const position = parseKindlePos(value);
    const href = position ? context.hrefForPos(position.fid, position.off) : null;
    return href ? `href="${href}"` : '';
  });
  return body;
}

function kf8Css(kf8, heads, decode, context) {
  const ids = [];
  for (const head of heads) {
    for (const link of head.matchAll(/<link\b[^>]*>/gi)) {
      const resource = KINDLE_RESOURCE.exec(link[0]);
      if (resource?.[1] === 'flow' && /css/i.test(resource[3] || '') && !ids.includes(resource[2])) ids.push(resource[2]);
    }
  }
  const sheets = ids.map((id) => kf8FlowText(kf8, id, decode)
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/url\(\s*["']?kindle:embed:([0-9A-Za-z]+)[^)]*\)/gi, (whole, embed) => {
      const image = kf8ImageFor(embed, context);
      return image ? `url("../${image.href}")` : 'none';
    })
    .replace(/url\(\s*["']?kindle:[^)]*\)/gi, 'none'));
  return [BASE_CSS, ...sheets].join('\n');
}

async function buildKf8(bytes, structure, limits, context) {
  const { Kf8 } = await loadParser();
  let kf8;
  try {
    // The resource directory is only used by upstream helpers we never call.
    kf8 = new Kf8(new Uint8Array(bytes), os.tmpdir()); // Kf8 loads Uint8Array/paths, not bare ArrayBuffers
    await kf8.innerLoadFile();
    await kf8.innerInit();
  } catch (error) {
    if (error instanceof MobiFormatError) throw error;
    throw conversionError('CORRUPT', 'KF8 structure could not be read');
  }
  if (kf8.fullRawLength > limits.maxTextBytes) throw conversionError('TOO_LARGE', 'KF8 text exceeds the conversion limit');
  const spine = kf8.getSpine();
  if (!spine.length) throw conversionError('CORRUPT', 'KF8 book has no sections');
  if (spine.length > limits.maxSections) throw conversionError('TOO_LARGE', 'KF8 book has too many sections');
  context.resourceStart = kf8.mobiFile.resourceStart;

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const decode = (latin1) => decoder.decode(Buffer.from(latin1, 'latin1'));
  let assembled;
  try {
    assembled = spine.map((chapter) => assembleKf8Chapter(kf8, chapter));
  } catch (error) {
    if (error instanceof MobiFormatError) throw error;
    throw conversionError('CORRUPT', 'KF8 text could not be decompressed');
  }
  const chapterOfFragment = new Map();
  assembled.forEach((chapter, index) => {
    for (const fragment of chapter.fragmentStarts.keys()) chapterOfFragment.set(fragment, index);
  });

  // Collect every kindle:pos target (TOC and in-book links) and pin its anchor.
  const tocRoot = kf8.getToc() || [];
  const positions = new Map();
  const remember = (position) => {
    if (!position) return;
    const chapter = chapterOfFragment.get(position.fid);
    if (chapter === undefined) return;
    const id = kf8AnchorId(position.fid, position.off);
    if (!positions.has(id)) {
      positions.set(id, { chapter, target: assembled[chapter].fragmentStarts.get(position.fid) + position.off, id });
    }
  };
  const walk = (items) => items.forEach((item) => { remember(parseKindlePos(item.href)); walk(item.children || []); });
  walk(tocRoot);
  for (const { raw } of assembled) {
    for (const match of raw.matchAll(KINDLE_POS)) remember(parseKindlePos(match[0]));
  }

  // Chapters without text or images (for example an empty title page) are
  // dropped; links into them fall through to the next kept part.
  context.kf8FlowImage = (id) => {
    const svg = kf8FlowText(kf8, id, decode);
    const embed = /kindle:embed:([0-9A-Za-z]+)/.exec(svg);
    return embed ? kf8ImageFor(embed[1], context) : null;
  };
  const kept = assembled.map(({ raw }) => {
    const body = bodyRange(raw);
    return hasContent(raw, body) || /kindle:(embed|flow):[^"']*svg|<svg\b/i.test(raw.slice(body.start, body.end));
  });
  if (!kept.some(Boolean)) throw conversionError('CORRUPT', 'KF8 book has no readable text');
  const partIndex = [];
  let nextPart = 0;
  kept.forEach((keep, index) => { partIndex[index] = keep ? nextPart++ : null; });
  const partFor = (chapter) => {
    for (let index = chapter; index < kept.length; index += 1) if (kept[index]) return partIndex[index];
    return null;
  };
  const anchors = assembled.map(() => []);
  const hrefById = new Map();
  for (const position of positions.values()) {
    const part = partFor(position.chapter);
    if (part === null) continue;
    if (!kept[position.chapter]) {
      hrefById.set(position.id, partHref(part));
      continue;
    }
    const { raw } = assembled[position.chapter];
    const body = bodyRange(raw);
    const point = safeInsertionPoint(raw, Math.max(position.target, body.start), body, 'utf-8');
    anchors[position.chapter].push({ point, id: position.id });
    hrefById.set(position.id, `${partHref(part)}#${position.id}`);
  }
  context.hrefForPos = (fid, off) => hrefById.get(kf8AnchorId(fid, off)) || null;

  const chapters = [];
  assembled.forEach(({ raw }, index) => {
    if (!kept[index]) return;
    const xhtml = toXhtml(decode(rewriteKf8Chapter(raw, anchors[index], context)));
    const part = partIndex[index];
    chapters.push({ href: `text/${partHref(part)}`, title: firstHeading(xhtml) || `第 ${part + 1} 部分`, body: xhtml });
  });
  const mapToc = (items) => items.flatMap((item) => {
    const position = parseKindlePos(item.href);
    const href = position ? context.hrefForPos(position.fid, position.off) : null;
    const children = mapToc(item.children || []);
    const label = plainText(String(item.label || '')).slice(0, 200);
    return href && label ? [{ label, href: `text/${href}`, children }] : children;
  });
  const css = kf8Css(kf8, assembled.map(({ raw }) => raw.slice(0, bodyRange(raw).start)), decode, context);
  let cover = null;
  if (structure.coverRecordIndex !== null && structure.coverRecordIndex >= context.resourceStart) {
    const index = structure.coverRecordIndex - context.resourceStart + 1;
    cover = imageRecord(context, structure.coverRecordIndex, `k${kf8ImageName(index)}`, kf8ImageName(index));
  }
  return { chapters, toc: mapToc(tocRoot), css, cover };
}

/**
 * @param {Uint8Array|Buffer} input MOBI/AZW3 file bytes.
 * @param {{identifier:string, limits?:object}} options
 * @returns {Promise<Uint8Array>} EPUB bytes.
 */
async function convertMobiToEpub(input, { identifier, limits: overrides = {} } = {}) {
  if (!identifier) throw new TypeError('identifier is required');
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const structure = parseMobiStructure(bytes);
  if (structure.drm) throw conversionError('DRM_PROTECTED', 'The book is DRM protected');
  if (structure.textLength > limits.maxTextBytes) throw conversionError('TOO_LARGE', 'MOBI text exceeds the conversion limit');

  const context = { structure, bytes, limits, images: new Map(), imageBytes: 0 };
  // The path is fixed by format and never falls back: MOBI6 and KF8 split a
  // book differently, and switching would orphan existing highlights.
  const book = structure.format === 'kf8'
    ? await buildKf8(bytes, structure, limits, context)
    : await buildMobi6(bytes, structure, limits, context);

  const images = [...context.images.values()].filter(Boolean);
  if (book.cover && !images.includes(book.cover)) images.push(book.cover);
  images.sort((left, right) => left.href.localeCompare(right.href));

  const epub = buildEpub({
    identifier,
    title: structure.title || '未命名书籍',
    authors: structure.author ? structure.author.split('、') : [],
    language: structure.language,
    publisher: structure.publisher,
    chapters: book.chapters,
    images,
    toc: book.toc,
    css: book.css,
    coverHref: book.cover ? book.cover.href : null
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
