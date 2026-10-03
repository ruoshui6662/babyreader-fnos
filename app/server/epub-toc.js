'use strict';

// Chapter names for notes. Reads only what a table of contents needs from an
// EPUB — container.xml, the package (OPF) and the nav document or NCX — not
// the chapters themselves, and remembers the result per book.

const fs = require('node:fs/promises');
const { unzipSync, strFromU8 } = require('fflate');
const { inspectZip } = require('./zip');

const MAX_TOC_FILE_BYTES = 4 * 1024 * 1024;
const CACHE_LIMIT = 24;
const tocCache = new Map();

function decodeXmlText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

function directoryOf(path) {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index + 1) : '';
}

// "a/b/../c.xhtml#x" -> "a/c.xhtml"
function resolveHref(base, href) {
  const clean = decodeURIComponent(String(href || '').split('#')[0].split('?')[0]);
  const parts = `${base}${clean}`.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function readSelected(buffer, names) {
  const wanted = new Set(names);
  return unzipSync(buffer, {
    filter: (file) => wanted.has(file.name) && file.originalSize <= MAX_TOC_FILE_BYTES
  });
}

function parseOpf(opf, opfPath) {
  const base = directoryOf(opfPath);
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attribute(match[0], 'id');
    const href = attribute(match[0], 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      href: resolveHref(base, href),
      mediaType: attribute(match[0], 'media-type') || '',
      properties: attribute(match[0], 'properties') || ''
    });
  }
  const spine = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const item = manifest.get(attribute(match[0], 'idref'));
    if (item) spine.push(item.href);
  }
  const nav = [...manifest.values()].find((item) => /\bnav\b/.test(item.properties));
  const tocId = /<spine\b[^>]*\btoc\s*=\s*["']([^"']+)/i.exec(opf)?.[1];
  const ncx = (tocId && manifest.get(tocId)) || [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
  return { spine, nav: nav?.href || null, ncx: ncx?.href || null };
}

function parseNav(html, navPath) {
  const base = directoryOf(navPath);
  const tocNav = /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1]
    || /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1]
    || '';
  const entries = [];
  let depth = -1;
  for (const token of tocNav.matchAll(/<(\/?)(ol|ul)\b[^>]*>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (token[2]) {
      depth += token[1] ? -1 : 1;
      continue;
    }
    const href = attribute(`<a ${token[3]}>`, 'href');
    const label = decodeXmlText(token[4]);
    if (href && label) entries.push({ label, href: resolveHref(base, href), depth: Math.max(0, depth) });
  }
  return entries;
}

function parseNcx(xml, ncxPath) {
  const base = directoryOf(ncxPath);
  const entries = [];
  let depth = -1;
  for (const token of xml.matchAll(/<(\/?)navPoint\b[^>]*>|<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>\s*<content\b([^>]*)>/gi)) {
    if (token[0].startsWith('<navPoint') || token[0].startsWith('</navPoint')) {
      depth += token[1] ? -1 : 1;
      continue;
    }
    const label = decodeXmlText(token[2]);
    const src = attribute(`<content ${token[3]}>`, 'src');
    if (label && src) entries.push({ label, href: resolveHref(base, src), depth: Math.max(0, depth) });
  }
  return entries;
}

// { spine: [path...], toc: [{ label, href, depth }] } — empty when unreadable.
function readEpubToc(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    inspectZip(bytes);
    const container = readSelected(bytes, ['META-INF/container.xml'])['META-INF/container.xml'];
    const opfPath = container ? attribute(/<rootfile\b[^>]*>/i.exec(strFromU8(container))?.[0] || '', 'full-path') : null;
    if (!opfPath) return { spine: [], toc: [] };
    const opfBytes = readSelected(bytes, [opfPath])[opfPath];
    if (!opfBytes) return { spine: [], toc: [] };
    const { spine, nav, ncx } = parseOpf(strFromU8(opfBytes), opfPath);
    const files = readSelected(bytes, [nav, ncx].filter(Boolean));
    let toc = nav && files[nav] ? parseNav(strFromU8(files[nav]), nav) : [];
    if (!toc.length && ncx && files[ncx]) toc = parseNcx(strFromU8(files[ncx]), ncx);
    return { spine, toc };
  } catch {
    return { spine: [], toc: [] };
  }
}

async function epubTocForBook(book) {
  const key = `${book.id}:${book.fingerprint || book.path}`;
  if (tocCache.has(key)) {
    const value = tocCache.get(key);
    tocCache.delete(key);
    tocCache.set(key, value);
    return value;
  }
  const value = readEpubToc(await fs.readFile(book.path));
  tocCache.set(key, value);
  while (tocCache.size > CACHE_LIMIT) tocCache.delete(tocCache.keys().next().value);
  return value;
}

// Chapter of a file: its own table-of-contents entry (shallowest), else the
// last entry before it in reading order, else its position in the book.
function chapterForHref(tocInfo, chapterHref) {
  const href = String(chapterHref || '').replace(/^\/+/, '');
  const spineIndex = tocInfo.spine.indexOf(href);
  const own = tocInfo.toc
    .filter((entry) => entry.href === href)
    .sort((left, right) => left.depth - right.depth)[0];
  if (own) return { label: own.label, order: spineIndex >= 0 ? spineIndex : Number.MAX_SAFE_INTEGER };
  if (spineIndex >= 0) {
    let best = null;
    for (const entry of tocInfo.toc) {
      const entryIndex = tocInfo.spine.indexOf(entry.href);
      if (entryIndex >= 0 && entryIndex <= spineIndex && (!best || entryIndex > best.index || (entryIndex === best.index && entry.depth < best.depth))) {
        best = { label: entry.label, index: entryIndex, depth: entry.depth };
      }
    }
    return { label: best?.label || `第 ${spineIndex + 1} 部分`, order: spineIndex };
  }
  return { label: '其他', order: Number.MAX_SAFE_INTEGER };
}

module.exports = { chapterForHref, epubTocForBook, readEpubToc, resolveHref };
