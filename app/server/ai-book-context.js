'use strict';

const fs = require('node:fs/promises');
const { safeUnzip } = require('./zip');

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeBookText(value) {
  return decodeEntities(String(value || ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value) {
  return normalizeBookText(value).replace(/\s+/g, '').toLocaleLowerCase();
}

function normalizeArchivePath(value) {
  let raw;
  try {
    raw = decodeURIComponent(String(value || '').split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  } catch {
    return '';
  }
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return '';
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function getXmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : '';
}

function resolveArchivePath(base, href) {
  const clean = String(href || '').split(/[?#]/, 1)[0];
  return normalizeArchivePath(`${base}${clean}`);
}

function extractSpinePaths(files) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const container = files['META-INF/container.xml'];
  if (!container) return new Map();
  const rootfileMatch = decoder.decode(container).match(/<rootfile\b[^>]*full-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const opfPath = normalizeArchivePath(rootfileMatch?.[1] ?? rootfileMatch?.[2] ?? '');
  if (!opfPath || !files[opfPath]) return new Map();
  const opf = decoder.decode(files[opfPath]);
  const opfDirectory = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = getXmlAttribute(match[0], 'id');
    const href = getXmlAttribute(match[0], 'href');
    if (id && href) manifest.set(id, resolveArchivePath(opfDirectory, href));
  }
  const paths = new Map();
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const href = manifest.get(getXmlAttribute(match[0], 'idref'));
    if (href) paths.set(paths.size, href);
  }
  return paths;
}

function contextError() {
  return Object.assign(new Error('书本上下文无法确认，请重新打开本书后再试'), {
    code: 'AI_BOOK_CONTEXT_INVALID',
    statusCode: 400
  });
}

async function loadBookSources(book, fsImpl = fs) {
  if (!book?.path) throw contextError();
  const bytes = await fsImpl.readFile(book.path);
  if (book.type !== 'epub') {
    const text = bytes.toString('utf8');
    return { all: compact(text), chapters: new Map([['', compact(text)]]) };
  }

  let files;
  try {
    files = safeUnzip(bytes);
  } catch {
    throw contextError();
  }
  const chapters = new Map();
  for (const [entryName, data] of Object.entries(files)) {
    if (!/\.(?:xhtml?|html?|xml)$/i.test(entryName)) continue;
    chapters.set(normalizeArchivePath(entryName), compact(new TextDecoder('utf-8', { fatal: false }).decode(data)));
  }
  return {
    all: [...chapters.values()].join(''),
    chapters,
    chapterIndexes: extractSpinePaths(files)
  };
}

function containsBookText(source, value, minimumLength = 4) {
  const needle = compact(value);
  if (!needle) return false;
  const haystack = source || '';
  // Very short selections are too ambiguous to be a useful trust proof.
  return needle.length >= minimumLength && haystack.includes(needle);
}

async function validateAiBookContext(book, input, fsImpl = fs) {
  const sources = await loadBookSources(book, fsImpl);
  for (const item of input?.context || []) {
    const href = normalizeArchivePath(item.chapterHref);
    if (book.type === 'epub' && item.chapterHref && !sources.chapters.has(href)) throw contextError();
    if (book.type === 'epub' && Number.isInteger(item.chapterIndex) && item.chapterIndex < 0) throw contextError();
    if (book.type === 'epub' && Number.isInteger(item.chapterIndex) && sources.chapterIndexes.size) {
      if (sources.chapterIndexes.get(item.chapterIndex) !== href) throw contextError();
    }
    const source = book.type === 'epub' && href ? sources.chapters.get(href) : sources.all;
    if (!containsBookText(source, item.text)) throw contextError();
  }
  if (input?.selectedText && !containsBookText(sources.all, input.selectedText, 1)) throw contextError();
  return true;
}

module.exports = {
  normalizeBookText,
  normalizeArchivePath,
  loadBookSources,
  validateAiBookContext
};
