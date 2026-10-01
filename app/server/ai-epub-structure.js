'use strict';

const crypto = require('node:crypto');

const AI_EPUB_PARSER_VERSION = 3;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_SPINE_ITEMS = 10_000;
const MAX_TOC_ITEMS = 10_000;
const MAX_TOC_DEPTH = 32;
const MAX_TOTAL_TEXT_CHARS = 64 * 1024 * 1024;
const MAX_STRUCTURE_JSON_BYTES = 4 * 1024 * 1024;

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

function decodeFile(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return new TextDecoder('utf-8', { fatal: false }).decode(value);
  }
  return String(value || '');
}

function xmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : '';
}

function normalizeArchivePath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes('\0')) return '';
  const parts = [];
  for (const encodedPart of raw.split('/')) {
    if (!encodedPart || encodedPart === '.') continue;
    let part;
    try {
      part = decodeURIComponent(encodedPart);
    } catch {
      return '';
    }
    if (part.includes('/') || part.includes('\\')) return '';
    if (part === '..') {
      if (!parts.length) return '';
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function splitHref(value) {
  const href = decodeEntities(String(value || '').trim());
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    return { path: '', fragment: '', valid: false };
  }
  const hash = href.indexOf('#');
  const withoutFragment = hash < 0 ? href : href.slice(0, hash);
  const query = withoutFragment.indexOf('?');
  const rawPath = query < 0 ? withoutFragment : withoutFragment.slice(0, query);
  const rawFragment = hash < 0 ? '' : href.slice(hash + 1);
  let fragment;
  try {
    fragment = decodeURIComponent(rawFragment);
  } catch {
    return { path: '', fragment: '', valid: false };
  }
  return { path: rawPath, fragment, valid: true };
}

function resolveHref(basePath, href) {
  const split = splitHref(href);
  if (!split.valid) return { path: '', fragment: '', valid: false };
  const base = split.path.startsWith('/') ? '' : (basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : '');
  const resolved = normalizeArchivePath(`${base}${split.path}`);
  if (split.path && !resolved) return { path: '', fragment: split.fragment, valid: false };
  return { path: resolved || normalizeArchivePath(basePath), fragment: split.fragment, valid: Boolean(resolved || !split.path) };
}

function normalizeBookText(value) {
  return decodeEntities(String(value || ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function offsetAfterTag(source, tagEnd, normalizedText) {
  let offset = normalizeBookText(source.slice(0, tagEnd)).length;
  if (offset < normalizedText.length && normalizedText[offset] === ' ') offset += 1;
  return Math.min(offset, normalizedText.length);
}

function extractDocumentStructure(source) {
  const html = String(source || '');
  const text = normalizeBookText(html);
  const anchors = [];
  const headings = [];
  const firstId = new Map();
  const duplicateIds = new Set();
  const tagRe = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const id = xmlAttribute(match[0], 'id');
    if (id) {
      const offset = offsetAfterTag(html, tagRe.lastIndex, text);
      const anchor = { id, offset, isHeading: /^h[1-6]$/.test(tagName) };
      anchors.push(anchor);
      if (firstId.has(id)) duplicateIds.add(id);
      else firstId.set(id, anchor);
    }
    if (/^h[1-6]$/.test(tagName)) {
      const closeRe = new RegExp(`<\\/${tagName}\\s*>`, 'ig');
      closeRe.lastIndex = tagRe.lastIndex;
      const close = closeRe.exec(html);
      const headingText = close ? normalizeBookText(html.slice(tagRe.lastIndex, close.index)) : '';
      if (headingText) {
        headings.push({
          label: headingText.slice(0, 512),
          level: Number(tagName.slice(1)),
          offset: offsetAfterTag(html, tagRe.lastIndex, text),
          id
        });
      }
    }
  }
  return {
    text,
    anchors,
    headings,
    duplicateIds: [...duplicateIds],
    firstAnchorById: firstId
  };
}

function readContainer(files) {
  const container = files['META-INF/container.xml'];
  if (!container) throw Object.assign(new Error('EPUB container.xml is missing'), { code: 'AI_EPUB_CONTAINER_MISSING' });
  const xml = decodeFile(container);
  const rootfile = xml.match(/<rootfile\b[^>]*>/i);
  const rawPath = rootfile ? xmlAttribute(rootfile[0], 'full-path') : '';
  const opfPath = normalizeArchivePath(rawPath);
  if (!opfPath || !files[opfPath]) {
    throw Object.assign(new Error('EPUB package document is missing or invalid'), { code: 'AI_EPUB_PACKAGE_INVALID' });
  }
  return opfPath;
}

function parsePackage(files, opfPath) {
  const opf = decodeFile(files[opfPath]);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = xmlAttribute(tag, 'id');
    const href = xmlAttribute(tag, 'href');
    if (!id || !href) continue;
    const resolved = resolveHref(`${base}__package__.opf`, href);
    if (!resolved.valid || !resolved.path) continue;
    manifest.set(id, {
      id,
      href,
      fullPath: resolved.path,
      fragment: resolved.fragment,
      mediaType: xmlAttribute(tag, 'media-type').toLowerCase(),
      properties: xmlAttribute(tag, 'properties').toLowerCase().split(/\s+/).filter(Boolean)
    });
  }

  const spine = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = xmlAttribute(match[0], 'idref');
    const item = manifest.get(idref);
    if (!item) continue;
    spine.push({
      index: spine.length,
      id: idref,
      href: item.fullPath,
      mediaType: item.mediaType
    });
  }
  if (!spine.length || spine.length > MAX_SPINE_ITEMS) {
    throw Object.assign(new Error('EPUB spine is empty or exceeds the structure limit'), { code: 'AI_EPUB_SPINE_LIMIT' });
  }
  return { manifest, spine, opf };
}

function tocNavigationItem(manifest) {
  return [...manifest.values()].find((item) => item.properties.includes('nav')) || null;
}

function parseNavEntries(navHtml, navPath) {
  const source = String(navHtml || '');
  const navs = [...source.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)];
  const nav = navs.find((item) => /(?:epub:type|type)\s*=\s*(["'])[^"']*\btoc\b[^"']*\1/i.test(item[0])) || navs[0];
  if (!nav) return [];
  const entries = [];
  const html = nav[0];
  const linkRe = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const before = html.slice(0, match.index);
    const depth = Math.max(0, (before.match(/<ol\b[^>]*>/gi) || []).length - (before.match(/<\/ol\s*>/gi) || []).length - 1);
    if (depth >= MAX_TOC_DEPTH) {
      throw Object.assign(new Error('EPUB TOC nesting exceeds the structure limit'), { code: 'AI_EPUB_TOC_LIMIT' });
    }
    const target = resolveHref(navPath, match[2]);
    const label = normalizeBookText(match[3]).slice(0, 512);
    if (!target.valid || !target.path || !label) continue;
    entries.push({ label, href: target.path, fragment: target.fragment, depth });
    if (entries.length > MAX_TOC_ITEMS) {
      throw Object.assign(new Error('EPUB TOC exceeds the structure limit'), { code: 'AI_EPUB_TOC_LIMIT' });
    }
  }
  return entries;
}

function parseNcxEntries(ncxXml, ncxPath) {
  const source = String(ncxXml || '');
  const entries = [];
  const stack = [];
  const tokenRe = /<navPoint\b[^>]*>|<\/navPoint\s*>/gi;
  let match;
  // Entries are recorded in document order (when a navPoint opens) so a
  // parent always precedes its children; its label is filled in once the
  // navPoint closes.
  while ((match = tokenRe.exec(source)) !== null) {
    if (/^<navPoint\b/i.test(match[0])) {
      const entry = { label: '', href: '', fragment: '', depth: stack.length, valid: false };
      entries.push(entry);
      stack.push({ start: tokenRe.lastIndex, entry });
      if (stack.length > MAX_TOC_DEPTH) {
        throw Object.assign(new Error('EPUB NCX nesting exceeds the structure limit'), { code: 'AI_EPUB_TOC_LIMIT' });
      }
      if (entries.length > MAX_TOC_ITEMS) {
        throw Object.assign(new Error('EPUB NCX exceeds the structure limit'), { code: 'AI_EPUB_TOC_LIMIT' });
      }
      continue;
    }
    const point = stack.pop();
    if (!point) continue;
    // Only this navPoint's own label and target, not a child's.
    const body = source.slice(point.start, match.index).replace(/<navPoint\b[\s\S]*$/i, '');
    const labelMatch = body.match(/<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>/i);
    const contentMatch = body.match(/<content\b[^>]*src\s*=\s*(["'])(.*?)\1/i);
    const target = contentMatch ? resolveHref(ncxPath, contentMatch[2]) : null;
    const label = labelMatch ? normalizeBookText(labelMatch[1]).slice(0, 512) : '';
    if (target?.valid && target.path && label) {
      Object.assign(point.entry, { label, href: target.path, fragment: target.fragment, valid: true });
    }
  }
  return entries.filter((entry) => entry.valid).map(({ valid, ...entry }) => entry);
}

function stableChapterId(href, fragment, ordinal) {
  const digest = crypto.createHash('sha256').update(`${href}\0${fragment}\0${ordinal}`).digest('hex').slice(0, 20);
  return `ch_${digest}`;
}

function comparePosition(left, right) {
  return left.spineIndex - right.spineIndex || left.offset - right.offset;
}

function parseEpubStructure(files) {
  if (!files || typeof files !== 'object' || Object.keys(files).length > MAX_ARCHIVE_ENTRIES) {
    throw Object.assign(new Error('EPUB archive exceeds the structure limit'), { code: 'AI_EPUB_ARCHIVE_LIMIT' });
  }
  const opfPath = readContainer(files);
  const { manifest, spine } = parsePackage(files, opfPath);
  const spineIndexByPath = new Map(spine.map((item) => [item.href, item.index]));
  const documentStructures = new Map();
  let totalTextChars = 0;
  for (const item of spine) {
    const value = files[item.href];
    if (!value) continue;
    const mediaTypeIsText = !item.mediaType || /(?:xhtml|html|xml)/i.test(item.mediaType);
    if (!mediaTypeIsText) continue;
    const doc = extractDocumentStructure(decodeFile(value));
    totalTextChars += doc.text.length;
    if (totalTextChars > MAX_TOTAL_TEXT_CHARS) {
      throw Object.assign(new Error('EPUB text exceeds the AI structure limit'), { code: 'AI_EPUB_TEXT_LIMIT' });
    }
    documentStructures.set(item.href, doc);
  }

  let tocEntries = [];
  const navItem = tocNavigationItem(manifest);
  if (navItem && files[navItem.fullPath]) {
    tocEntries = parseNavEntries(decodeFile(files[navItem.fullPath]), navItem.fullPath);
  }
  if (!tocEntries.length) {
    const ncxItem = [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem && files[ncxItem.fullPath]) {
      tocEntries = parseNcxEntries(decodeFile(files[ncxItem.fullPath]), ncxItem.fullPath);
    }
  }

  if (!tocEntries.length) {
    for (const item of spine) {
      const doc = documentStructures.get(item.href);
      const chapterHeadings = (doc?.headings || []).filter((heading) => heading.level === 1);
      if (chapterHeadings.length) {
        for (const heading of chapterHeadings) {
          tocEntries.push({ label: heading.label, href: item.href, fragment: heading.id || '', depth: 0, inferredOffset: heading.offset, mappingQuality: 'inferred' });
        }
      } else if (doc?.text) {
        tocEntries.push({ label: doc.headings[0]?.label || `第${item.index + 1}部分`, href: item.href, fragment: '', depth: 0, inferredOffset: 0, mappingQuality: 'inferred' });
      }
    }
  }

  const toc = [];
  const chapters = [];
  const parentStack = [];
  const occurrenceByTarget = new Map();
  for (const entry of tocEntries) {
    const depth = Math.max(0, Math.min(MAX_TOC_DEPTH - 1, Number(entry.depth) || 0));
    while (parentStack.length > depth) parentStack.pop();
    const parentId = depth ? parentStack[depth - 1]?.id || null : null;
    const occurrenceKey = `${entry.href}\0${entry.fragment}`;
    const occurrence = occurrenceByTarget.get(occurrenceKey) || 0;
    occurrenceByTarget.set(occurrenceKey, occurrence + 1);
    const id = stableChapterId(entry.href, entry.fragment, occurrence);
    const spineIndex = spineIndexByPath.get(entry.href);
    const doc = documentStructures.get(entry.href);
    const anchor = entry.fragment ? doc?.firstAnchorById.get(entry.fragment) : null;
    const duplicateFragment = entry.fragment && doc?.duplicateIds.includes(entry.fragment);
    const startOffset = Number.isInteger(entry.inferredOffset) ? entry.inferredOffset : (anchor?.offset ?? 0);
    const resolved = Number.isInteger(spineIndex) && Boolean(doc);
    const mappingQuality = !resolved
      ? 'unresolved'
      : entry.mappingQuality === 'inferred'
        || !entry.fragment
        || !anchor
        || !anchor.isHeading
        || duplicateFragment
        ? 'inferred'
        : 'exact';
    const node = {
      id,
      label: entry.label,
      href: entry.href,
      fragment: entry.fragment,
      depth,
      parentId,
      spineIndex: Number.isInteger(spineIndex) ? spineIndex : null,
      startOffset: resolved ? startOffset : null,
      mappingQuality,
      children: []
    };
    if (depth === 0) toc.push(node);
    else parentStack[depth - 1]?.children.push(node);
    parentStack[depth] = node;
    if (!resolved) continue;
    chapters.push({
      id,
      label: entry.label,
      parentId,
      kind: depth === 0 ? 'chapter' : 'section',
      depth,
      href: entry.href,
      fragment: entry.fragment,
      spineStart: spineIndex,
      spineEnd: spine.length,
      start: { spineIndex, offset: startOffset },
      end: { spineIndex: spine.length, offset: 0 },
      startOffset,
      endOffset: null,
      mappingQuality
    });
  }

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const nextBoundary = chapters.slice(index + 1).find((next) => (
      next.depth <= chapter.depth && comparePosition(next.start, chapter.start) > 0
    ));
    if (nextBoundary) {
      chapter.end = { ...nextBoundary.start };
      chapter.spineEnd = nextBoundary.start.spineIndex;
      chapter.endOffset = nextBoundary.start.offset;
    }
  }

  const result = {
    parserVersion: AI_EPUB_PARSER_VERSION,
    opfPath,
    spine,
    toc,
    chapters,
    anchors: Object.fromEntries([...documentStructures].map(([href, doc]) => [href, {
      textLength: doc.text.length,
      anchors: doc.anchors,
      headings: doc.headings,
      duplicateIds: doc.duplicateIds
    }]))
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_STRUCTURE_JSON_BYTES) {
    throw Object.assign(new Error('EPUB chapter structure exceeds the storage limit'), { code: 'AI_EPUB_STRUCTURE_LIMIT' });
  }
  return result;
}

function compareLocatorPosition(left, right) {
  return left.spineIndex - right.spineIndex || left.offset - right.offset;
}

function resolveLogicalChapter(structure, locator) {
  const position = locator?.position && typeof locator.position === 'object' ? locator.position : {};
  const rawHref = String(position.href || locator?.href || '');
  const href = normalizeArchivePath(rawHref);
  if (!href || href !== rawHref || rawHref.includes('#') || rawHref.includes('?')) {
    return { status: 'unresolved', reason: 'invalid_href' };
  }
  const spine = Array.isArray(structure?.spine) ? structure.spine : [];
  const matchingSpine = spine.filter((item) => item.href === href);
  const requestedIndex = Number.isInteger(locator?.index) ? locator.index : null;
  if (requestedIndex !== null && (requestedIndex < 0 || spine[requestedIndex]?.href !== href)) {
    return { status: 'unresolved', reason: 'spine_mismatch' };
  }
  const spineIndex = requestedIndex ?? (matchingSpine.length === 1 ? matchingSpine[0].index : null);
  if (!Number.isInteger(spineIndex)) return { status: 'unresolved', reason: 'spine_ambiguous' };

  const document = structure?.anchors?.[href];
  if (!document) return { status: 'unresolved', reason: 'document_unmapped' };
  const anchorId = String(position.anchor || '').slice(0, 500);
  let offset = null;
  if (anchorId) {
    const matches = (document.anchors || []).filter((anchor) => anchor.id === anchorId);
    if (matches.length !== 1 || (document.duplicateIds || []).includes(anchorId)) {
      return { status: 'unresolved', reason: matches.length ? 'anchor_ambiguous' : 'anchor_missing' };
    }
    offset = matches[0].offset;
  } else if (Number.isInteger(position.offset)) {
    if (position.offset < 0 || position.offset > document.textLength) {
      return { status: 'unresolved', reason: 'offset_out_of_range' };
    }
    offset = position.offset;
  }

  const chapters = Array.isArray(structure?.chapters) ? structure.chapters : [];
  let candidates = chapters.filter((chapter) => {
    if (offset === null) return chapter.start.spineIndex <= spineIndex && chapter.end.spineIndex >= spineIndex;
    const current = { spineIndex, offset: offset ?? 0 };
    return compareLocatorPosition(current, chapter.start) >= 0
      && compareLocatorPosition(current, chapter.end) < 0;
  });
  if (offset === null) {
    const topLevel = candidates.filter((chapter) => chapter.depth === 0);
    if (topLevel.length !== 1) return { status: 'unresolved', reason: 'anchor_required' };
    candidates = topLevel;
  }
  if (!candidates.length) return { status: 'unresolved', reason: 'chapter_not_mapped' };
  const maxDepth = Math.max(...candidates.map((chapter) => Number(chapter.depth) || 0));
  candidates = candidates.filter((chapter) => (Number(chapter.depth) || 0) === maxDepth);
  if (candidates.length !== 1) return { status: 'unresolved', reason: 'chapter_ambiguous' };

  const selected = candidates[0];
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  let root = selected;
  while (root.parentId && byId.has(root.parentId)) root = byId.get(root.parentId);
  return {
    status: 'resolved',
    chapterId: root.id,
    chapterLabel: root.label,
    sectionId: selected.depth > 0 ? selected.id : null,
    sectionLabel: selected.depth > 0 ? selected.label : null,
    href,
    spineIndex,
    offset: offset ?? null,
    mappingQuality: root.mappingQuality === 'exact' && selected.mappingQuality === 'exact' ? 'exact' : 'inferred'
  };
}

module.exports = {
  AI_EPUB_PARSER_VERSION,
  MAX_ARCHIVE_ENTRIES,
  MAX_SPINE_ITEMS,
  MAX_TOC_ITEMS,
  MAX_TOC_DEPTH,
  MAX_TOTAL_TEXT_CHARS,
  MAX_STRUCTURE_JSON_BYTES,
  normalizeArchivePath,
  parseEpubStructure,
  resolveLogicalChapter
};
