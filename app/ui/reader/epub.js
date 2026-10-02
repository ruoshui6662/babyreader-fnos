/* 枕书 UI module: reader/epub */

'use strict';

// EPUBs are untrusted, user-sized documents. Keeping every decoded image,
// font, and CSS asset as a data URL can multiply memory use before the browser
// has even laid out the first page. The text remains readable when an asset is
// over budget; the asset is simply omitted from the first-pass render.
const EPUB_RESOURCE_LIMITS = Object.freeze({
  maxInlineResourceBytes: 8 * 1024 * 1024,
  maxCachedResourceBytes: 48 * 1024 * 1024,
  maxConcurrentInflations: 2
});

function yieldToBrowser() {
  return new Promise((resolve) => {
    const continueWork = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(continueWork);
    else continueWork();
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeXmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getXmlAttribute(tag, name) {
  const attrRe = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = tag.match(attrRe);
  if (!match) return null;
  return decodeXmlEntities(match[1] ?? match[2] ?? '');
}

function escapeHtmlAttribute(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripXmlTags(str) {
  return decodeXmlEntities(String(str).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function getDirPath(filePath) {
  return filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';
}

function decodeEpubPath(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function normalizeZipPath(filePath) {
  const parts = [];
  const decoded = decodeEpubPath(filePath).replace(/\\/g, '/');
  if (/^(?:[a-z]+:|\/)/i.test(decoded)) throw new Error('EPUB 路径无效');
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('EPUB 路径越过压缩包根目录');
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function resolveZipPath(baseDir, href) {
  const { path: hrefPath } = splitHref(href);
  return normalizeZipPath(`${baseDir}${hrefPath}`);
}

function splitHref(href) {
  const value = decodeXmlEntities(String(href || '').trim());
  const hashIndex = value.indexOf('#');
  const beforeFragment = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = beforeFragment.indexOf('?');
  return {
    path: queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment,
    query: queryIndex >= 0 ? beforeFragment.slice(queryIndex + 1) : '',
    fragment: hashIndex >= 0 ? value.slice(hashIndex + 1) : '',
    raw: value
  };
}

function getZipFile(zip, filePath) {
  const normalized = normalizeZipPath(filePath);
  const direct = zip.file(normalized);
  if (direct) return direct;

  const folded = normalized.toLocaleLowerCase('en-US');
  const matchedName = Object.keys(zip.files).find((name) => {
    try {
      return normalizeZipPath(name).toLocaleLowerCase('en-US') === folded;
    } catch {
      return false;
    }
  });
  return matchedName ? zip.file(matchedName) : null;
}

function mimeFromPath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  const mimes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    css: 'text/css',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4'
  };
  return mimes[ext] || 'application/octet-stream';
}

function sanitizeCss(css) {
  return String(css || '')
    .replace(/@import\s+(?:url\s*\()?\s*["']?(?:https?:|file:|javascript:)[^;]+;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:\s*url\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*["']?javascript:[^)]*\)/gi, 'none');
}

function sanitizeEpubHtml(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[\s\S]*?<\/form>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|xlink:href)\s*=\s*(["'])\s*(?:javascript:|file:|https?:\/\/)[\s\S]*?\2/gi, ' $1="#"')
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => `<style${attrs}>${sanitizeCss(css)}</style>`);
}

function zipEntryUncompressedSize(file) {
  const size = Number(file?._data?.uncompressedSize ?? file?.uncompressedSize);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function createEpubResourceManager(zip, mediaTypes, options = {}, urlApi = URL) {
  const limits = {
    maxInlineResourceBytes: Math.max(1, Number(options.maxInlineResourceBytes) || EPUB_RESOURCE_LIMITS.maxInlineResourceBytes),
    maxCachedResourceBytes: Math.max(1, Number(options.maxCachedResourceBytes) || EPUB_RESOURCE_LIMITS.maxCachedResourceBytes),
    maxConcurrentInflations: Math.max(1, Math.floor(Number(options.maxConcurrentInflations) || EPUB_RESOURCE_LIMITS.maxConcurrentInflations))
  };
  const entries = new Map();
  const leases = new Set();
  const skippedResources = [];
  const inflationWaiters = [];
  let cachedBytes = 0;
  let activeInflations = 0;
  let clock = 0;
  let destroyed = false;

  function noteSkipped(resourcePath, bytes, reason) {
    if (skippedResources.length < 20) {
      skippedResources.push({ path: String(resourcePath || '').slice(0, 240), bytes: Number(bytes) || 0, reason });
    }
  }

  function revokeEntry(entry) {
    if (entry.url) {
      try { urlApi.revokeObjectURL(entry.url); } catch {}
      entry.url = null;
    }
    entries.delete(entry.path);
    cachedBytes = Math.max(0, cachedBytes - entry.reservedBytes);
  }

  function makeRoom(bytes, protectedEntry = null) {
    if (bytes > limits.maxCachedResourceBytes) return false;
    while (cachedBytes + bytes > limits.maxCachedResourceBytes) {
      let candidate = null;
      for (const entry of entries.values()) {
        if (entry === protectedEntry || entry.pending || entry.leases.size) continue;
        if (!candidate || entry.lastUsed < candidate.lastUsed) candidate = entry;
      }
      if (!candidate) return false;
      revokeEntry(candidate);
    }
    return true;
  }

  async function withInflationSlot(operation) {
    let acquiredFromQueue = false;
    if (activeInflations >= limits.maxConcurrentInflations) {
      await new Promise((resolve) => inflationWaiters.push(resolve));
      acquiredFromQueue = true;
    }
    if (!acquiredFromQueue) activeInflations += 1;
    try {
      return await operation();
    } finally {
      const next = inflationWaiters.shift();
      if (next) next();
      else activeInflations = Math.max(0, activeInflations - 1);
    }
  }

  function pin(entry, lease) {
    if (!lease || lease.released || destroyed) return false;
    if (!lease.paths.has(entry.path)) {
      lease.paths.add(entry.path);
      entry.leases.add(lease);
      leases.add(lease);
    }
    entry.lastUsed = ++clock;
    return true;
  }

  function unpin(entry, lease) {
    if (!entry || !lease) return;
    entry.leases.delete(lease);
    lease.paths.delete(entry.path);
    if (!lease.paths.size) leases.delete(lease);
  }

  async function acquire(resourcePath, lease) {
    if (destroyed || !lease || lease.released) return null;
    let normalized;
    try {
      normalized = normalizeZipPath(resourcePath);
    } catch {
      noteSkipped(resourcePath, 0, 'invalid-resource-path');
      return null;
    }

    let entry = entries.get(normalized);
    if (entry) {
      if (!pin(entry, lease)) return null;
      const url = await entry.promise;
      if (!url || destroyed) {
        unpin(entry, lease);
        return null;
      }
      return url;
    }

    const file = getZipFile(zip, normalized);
    if (!file) {
      noteSkipped(normalized, 0, 'missing-resource');
      return null;
    }

    const declaredSize = zipEntryUncompressedSize(file);
    if (declaredSize !== null && declaredSize > limits.maxInlineResourceBytes) {
      noteSkipped(normalized, declaredSize, 'single-resource-limit');
      return null;
    }
    const reservation = declaredSize ?? 0;
    if (!makeRoom(reservation)) {
      noteSkipped(normalized, reservation, 'cache-capacity-pinned');
      return null;
    }

    entry = {
      path: normalized,
      reservedBytes: reservation,
      pending: true,
      promise: null,
      url: null,
      leases: new Set(),
      lastUsed: ++clock
    };
    cachedBytes += reservation;
    entries.set(normalized, entry);
    if (!pin(entry, lease)) {
      revokeEntry(entry);
      return null;
    }

    entry.promise = withInflationSlot(async () => {
      try {
        if (destroyed) return null;
        const bytes = await file.async('uint8array');
        const actualSize = bytes?.byteLength ?? 0;
        if (actualSize > limits.maxInlineResourceBytes) {
          noteSkipped(normalized, actualSize, 'single-resource-limit');
          revokeEntry(entry);
          return null;
        }
        if (actualSize > entry.reservedBytes) {
          const extraBytes = actualSize - entry.reservedBytes;
          if (!makeRoom(extraBytes, entry)) {
            noteSkipped(normalized, actualSize, 'cache-capacity-pinned');
            revokeEntry(entry);
            return null;
          }
          entry.reservedBytes += extraBytes;
          cachedBytes += extraBytes;
        } else if (actualSize < entry.reservedBytes) {
          cachedBytes -= entry.reservedBytes - actualSize;
          entry.reservedBytes = actualSize;
        }
        if (destroyed) {
          revokeEntry(entry);
          return null;
        }
        const mime = mediaTypes?.[normalized] || mimeFromPath(normalized);
        entry.url = urlApi.createObjectURL(new Blob([bytes], { type: mime }));
        entry.pending = false;
        entry.lastUsed = ++clock;
        return entry.url;
      } catch (error) {
        noteSkipped(normalized, entry.reservedBytes, 'resource-read-failed');
        revokeEntry(entry);
        return null;
      } finally {
        entry.pending = false;
      }
    });

    const url = await entry.promise;
    if (!url || destroyed) {
      unpin(entry, lease);
      return null;
    }
    return url;
  }

  function release(lease) {
    if (!lease || lease.released) return;
    lease.released = true;
    for (const resourcePath of lease.paths) {
      const entry = entries.get(resourcePath);
      if (entry) entry.leases.delete(lease);
    }
    lease.paths.clear();
    leases.delete(lease);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const lease of leases) {
      lease.released = true;
      lease.paths.clear();
    }
    leases.clear();
    for (const entry of [...entries.values()]) revokeEntry(entry);
    skippedResources.length = 0;
  }

  function snapshot() {
    return {
      cachedBytes,
      resourceCount: entries.size,
      activeInflations,
      queuedInflations: inflationWaiters.length,
      activeLeases: leases.size,
      skippedResources: skippedResources.map((item) => ({ ...item }))
    };
  }

  return {
    createLease() {
      return { paths: new Set(), released: false };
    },
    acquire,
    release,
    destroy,
    snapshot
  };
}

async function inlineCssResources(css, cssPath, resourceManager, lease) {
  const cssDir = getDirPath(cssPath);
  let output = sanitizeCss(css);
  const references = [...output.matchAll(/url\s*\(\s*(["']?)([^"')]+)\1\s*\)/gi)];
  for (const match of references) {
    const href = match[2].trim();
    if (!href || /^(?:data:|blob:|https?:|file:|javascript:|#)/i.test(href)) continue;
    try {
      const resourcePath = resolveZipPath(cssDir, href);
      const resourceUrl = await resourceManager.acquire(resourcePath, lease);
      if (resourceUrl) output = output.replace(match[0], `url("${resourceUrl}")`);
      else output = output.replace(match[0], 'none');
    } catch {
      output = output.replace(match[0], 'none');
    }
  }
  return output;
}

async function inlineResourceRefs(html, chapterPath, zip, resourceManager, lease) {
  const chapterDir = getDirPath(chapterPath);
  let output = html;

  const linkedStyles = [...output.matchAll(/<link\b[^>]*>/gi)];
  for (const match of linkedStyles) {
    const tag = match[0];
    const rel = getXmlAttribute(tag, 'rel') || '';
    const href = getXmlAttribute(tag, 'href');
    if (!/\bstylesheet\b/i.test(rel) || !href || /^(?:data:|blob:|https?:|file:|javascript:)/i.test(href)) {
      output = output.replace(tag, '');
      continue;
    }
    try {
      const cssPath = resolveZipPath(chapterDir, href);
      const cssFile = getZipFile(zip, cssPath);
      if (!cssFile) {
        output = output.replace(tag, '');
        continue;
      }
      const css = await inlineCssResources(await cssFile.async('text'), cssPath, resourceManager, lease);
      output = output.replace(tag, `<style data-source-path="${escapeHtmlAttribute(cssPath)}">${css}</style>`);
    } catch {
      output = output.replace(tag, '');
    }
  }

  const resourceTags = [...output.matchAll(/<(img|image|source|video|audio)\b[^>]*>/gi)];
  for (const match of resourceTags) {
    const tag = match[0];
    let nextTag = tag;
    for (const attrName of ['src', 'href', 'xlink:href', 'poster']) {
      const href = getXmlAttribute(nextTag, attrName);
      if (!href || /^(?:data:|blob:|https?:|file:|javascript:|#)/i.test(href)) continue;
      try {
        const resourcePath = resolveZipPath(chapterDir, href);
        const resourceUrl = await resourceManager.acquire(resourcePath, lease);
        if (!resourceUrl) continue;
        const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRe = new RegExp(`(${attrName.replace(':', '\\:')}\\s*=\\s*)(["'])${escapedHref}\\2`, 'i');
        nextTag = nextTag.replace(attrRe, `$1$2${escapeHtmlAttribute(resourceUrl)}$2`);
      } catch {
        // Invalid paths are recorded by the resource manager; keep the body readable.
      }
    }
    output = output.replace(tag, nextTag);
  }

  output = output.replace(/<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>/gi, (tag, before, quote, href, after) => {
    if (/^(?:https?:|mailto:|tel:|javascript:|file:)/i.test(href)) return `<span${before}${after}>`;
    return `<a${before}href="#" data-epub-href="${escapeHtmlAttribute(href)}"${after}>`;
  });
  return output;
}

function epubPathTarget(chapterPath, fragment = '') {
  return `epub-path:${normalizeZipPath(chapterPath)}#${fragment}`;
}

function tocListDepth(markup, index) {
  const before = String(markup || '').slice(0, index);
  const opened = (before.match(/<(?:ol|ul)\b[^>]*>/gi) || []).length;
  const closed = (before.match(/<\/(?:ol|ul)>/gi) || []).length;
  return Math.max(0, opened - closed - 1);
}

function parseNavToc(navHtml, navPath) {
  const navMatch = navHtml.match(/<nav\b[^>]*(?:epub:type|type)\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)
    || navHtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return [];

  const navDir = getDirPath(navPath);
  const entries = [];
  const linkRe = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(navMatch[1])) !== null) {
    const rawHref = decodeXmlEntities(m[2]);
    const label = stripXmlTags(m[3]);
    if (!rawHref || !label) continue;

    const split = splitHref(rawHref);
    const chapterPath = resolveZipPath(navDir, split.path);
    entries.push({
      label,
      target: epubPathTarget(chapterPath, split.fragment),
      depth: tocListDepth(navMatch[1], m.index)
    });
  }
  return entries;
}

function parseNcxToc(ncxXml, ncxPath) {
  const ncxDir = getDirPath(ncxPath);
  const entries = [];
  const stack = [];
  const pointTokenRe = /<navPoint\b[^>]*>|<\/navPoint>/gi;
  let m;
  while ((m = pointTokenRe.exec(ncxXml)) !== null) {
    if (/^<navPoint\b/i.test(m[0])) {
      stack.push({
        start: m.index + m[0].length,
        depth: stack.length,
        order: m.index
      });
      continue;
    }

    const point = stack.pop();
    if (!point) continue;
    const body = ncxXml.slice(point.start, m.index);
    const labelMatch = body.match(/<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>/i);
    const contentMatch = body.match(/<content\b[^>]*src\s*=\s*(["'])(.*?)\1[^>]*\/?>/i);
    if (!labelMatch || !contentMatch) continue;

    const label = stripXmlTags(labelMatch[1]);
    const rawHref = decodeXmlEntities(contentMatch[2]);
    const split = splitHref(rawHref);
    const chapterPath = resolveZipPath(ncxDir, split.path);
    if (label) {
      entries.push({
        label,
        target: epubPathTarget(chapterPath, split.fragment),
        depth: point.depth,
        order: point.order
      });
    }
  }
  return entries
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...entry }) => entry);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function flattenToc(items, depth = 0) {
  const output = [];
  for (const item of items || []) {
    if (item?.label && item?.href) {
      output.push({ label: item.label, target: item.href, depth });
    }
    if (item?.subitems?.length) {
      output.push(...flattenToc(item.subitems, depth + 1));
    }
  }
  return output;
}

function themeColors() {
  if (state.theme === 'light') {
    return {
      bg: '#FCF8F1',
      text: '#3A342E',
      textMuted: '#8B8378',
      textStrong: '#161513',
      accent: '#C8A26C',
      surface: '#FBF7EF',
      selectionBg: '#75B7F0',
      selectionText: '#102B45'
    };
  }

  return {
    bg: '#1e1e1e',
    text: '#e8e0d4',
    textMuted: '#cdbfb2',
    textStrong: '#f0e8dc',
    accent: '#DA7756',
    surface: '#232323',
    selectionBg: '#75B7F0',
    selectionText: '#102B45'
  };
}

function highlightColor() {
  return state.theme === 'light'
    ? 'rgba(200, 162, 108, 0.25)'
    : 'rgba(218, 119, 86, 0.25)';
}

function getEpubThemeCss() {
  const fontSize = (zoomLevel / 100 * 18).toFixed(2) + 'px';
  const colors = themeColors();
  const fontImports = (typeof readerFontStylesheetUrls === 'function' ? readerFontStylesheetUrls(state.fontFamily) : [])
    .map((href) => `@import url("${href}");`).join('\n');
  return `${fontImports}
    html, body {
      background: ${colors.bg} !important;
      color: ${colors.text} !important;
    }
    body {
      font-family: ${FONT_STACKS[state.fontFamily] || FONT_STACKS[DEFAULT_READER_FONT]} !important;
      font-size: ${fontSize} !important;
      font-weight: 400 !important;
      line-height: ${state.lineHeight} !important;
      max-width: 760px !important;
      margin: 0 auto !important;
      padding: 32px 24px 64px !important;
      box-sizing: border-box !important;
    }
    body, body * {
      color: inherit !important;
      font-family: inherit !important;
      font-size: inherit !important;
      font-weight: 400 !important;
      letter-spacing: 0 !important;
      box-sizing: border-box !important;
    }
    body > *,
    p, li, div, section, article, blockquote {
      max-width: 760px !important;
    }
    p, li, div, section, article {
      color: ${colors.text} !important;
      line-height: ${state.lineHeight} !important;
    }
    p, li {
      text-align: justify !important;
      /* Same P0 typography controls as the single-DOM renderer. */
      text-indent: ${state.textIndent}em !important;
      margin-top: 0 !important;
      margin-bottom: ${state.paragraphSpacing}em !important;
    }
    h1, h2, h3, h4, h5, h6 {
      color: ${colors.textStrong} !important;
      line-height: 1.35 !important;
      font-weight: 700 !important;
      margin: 1.6em 0 0.75em !important;
      text-align: left !important;
    }
    h1 {
      font-size: 1.65em !important;
    }
    h2 {
      font-size: 1.35em !important;
    }
    h3, h4, h5, h6 {
      font-size: 1.12em !important;
    }
    a {
      color: ${colors.accent} !important;
    }
    strong, b, strong *, b * {
      color: ${colors.textStrong} !important;
      font-weight: 650 !important;
    }
    img, svg {
      max-width: 100% !important;
      height: auto !important;
    }
    blockquote {
      border-left: 3px solid ${colors.accent} !important;
      color: ${colors.textMuted} !important;
      margin-left: 0 !important;
      padding-left: 1.2em !important;
    }
    pre, code {
      background: ${colors.surface} !important;
      color: ${colors.text} !important;
    }
    ::selection {
      background: ${colors.selectionBg} !important;
      color: ${colors.selectionText} !important;
    }
    .epubjs-hl { fill: ${highlightColor()} !important; fill-opacity: 1 !important; mix-blend-mode: multiply; }
  `;
}

function applyThemeToEpubFrames() {
  const colors = themeColors();
  const viewer = document.getElementById('epubViewer');
  if (viewer) viewer.style.background = colors.bg;

  bindCurrentEpubContents();

  document.querySelectorAll('#epubViewer iframe').forEach((iframe) => {
    iframe.style.background = colors.bg;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      let style = doc.getElementById('zhenshu-epub-theme');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'zhenshu-epub-theme';
        (doc.head || doc.documentElement || doc.body)?.appendChild(style);
      }
      style.textContent = getEpubThemeCss();
      if (doc.documentElement) {
        doc.documentElement.style.background = colors.bg;
        doc.documentElement.style.color = colors.text;
      }
      if (doc.body) {
        doc.body.style.background = colors.bg;
        doc.body.style.color = colors.text;
        doc.body.style.fontSize = (zoomLevel / 100 * 18).toFixed(2) + 'px';
      }
    } catch {
      // Cross-origin frames should not happen for local EPUBs, but don't break theme switching.
    }
  });
}

function bindCurrentEpubContents() {
  if (!state.epubRendition || typeof state.epubRendition.getContents !== 'function') return;
  try {
    for (const contents of state.epubRendition.getContents()) {
      setupEpubContentKeyboard(contents);
      setupEpubContentSelection(contents);
    }
  } catch {
    // The rendition may be between chapter mounts; the next rendered pass will retry.
  }
}

function applyEpubTheme() {
  if (!state.epubRendition) return;
  state.epubRendition.themes.register('zhenshu', getEpubThemeCss());
  state.epubRendition.themes.select('zhenshu');
  requestAnimationFrame(applyThemeToEpubFrames);
}

function themeIconSvg(nextTheme) {
  if (nextTheme === 'light') {
    return `
      <svg viewBox="0 0 24 24" data-icon="theme" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2"></path><path d="M12 20v2"></path>
        <path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>
        <path d="M2 12h2"></path><path d="M20 12h2"></path>
        <path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>
      </svg>
    `;
  }

  // A full crescent on the same 24 grid and 1.8 stroke as the rail icons.
  return `
    <svg viewBox="0 0 24 24" data-icon="theme" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3.2a6.4 6.4 0 0 0 8.8 8.8A8.8 8.8 0 1 1 12 3.2Z"></path>
    </svg>
  `;
}

function applyTheme(theme, persist = true) {
  state.theme = ['dark', 'light', 'sepia'].includes(theme) ? theme : 'dark';
  document.body.classList.toggle('theme-light', state.theme === 'light');
  document.body.classList.toggle('theme-sepia', state.theme === 'sepia');

  // The toggle buttons only flip dark <-> light; sepia is picked from the
  // background dropdown in the settings drawer.
  for (const btnTheme of [document.getElementById('btnTheme'), document.getElementById('btnLibraryTheme')]) {
    if (!btnTheme) continue;
    const isLightOrSepia = state.theme === 'light' || state.theme === 'sepia';
    btnTheme.innerHTML = themeIconSvg(isLightOrSepia ? 'dark' : 'light');
    btnTheme.setAttribute('aria-label', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
    btnTheme.setAttribute('title', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
  }

  if (persist) {
    localStorage.setItem('zhenshu-theme', state.theme);
  }
  if (typeof syncMobileReadingBar === 'function') syncMobileReadingBar();
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = { light: '#F2F3F5', sepia: '#E9E0CC', dark: '#141416' }[state.theme] || '#141416';

  applyEpubTheme();
}

function toggleTheme() {
  // Any light-class background (浅色 / 护眼米黄) collapses to 深色, and 深色
  // opens 浅色. Without this the button claimed "切换深色模式" while actually
  // landing back on 浅色 whenever a sepia book was open.
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function destroyEpub() {
  dismissHighlightPill();
  if (typeof invalidateEpubChapterRender === 'function') invalidateEpubChapterRender();
  const archive = state.epubArchive;
  if (archive?.resourceManager) {
    if (archive.activeChapterLease) archive.resourceManager.release(archive.activeChapterLease);
    archive.activeChapterLease = null;
    archive.resourceManager.destroy();
  }
  state.epubArchive = null;
  state.epubChapterIndex = 0;
  state.epubChapterCount = 0;
  state.epubMetadata = null;
  state.epubHtml = '';
  state.epubChapters = [];
  state.epubRenderPending = false;
  state.epubChapterLoading = false;
  state.epubDiagnostics = null;
  if (state.epubRendition) {
    state.epubRendition.destroy();
    state.epubRendition = null;
  }
  if (state.epubBook) {
    state.epubBook.destroy();
    state.epubBook = null;
  }

  const viewer = document.getElementById('epubViewer');
  if (viewer) viewer.innerHTML = '';
}

async function renderEpubDocument(base64data) {
  destroyEpub();
  const archive = await openEpubArchive(base64data);
  if (!archive.spine.length) throw new Error('EPUB 中没有可读取的章节');

  state.epubArchive = archive;
  state.epubMetadata = archive.metadata;
  state.epubDiagnostics = archive.diagnostics;
  state.toc = archive.toc;
  state.chapterPaths = archive.spine.map((chapter) => chapter.fullPath);
  state.epubChapterCount = archive.spine.length;
  state.epubChapterIndex = 0;
  state.currentChapterIndex = 0;

  const article = document.getElementById('article');
  if (article) article.dataset.epubSkippedResourceCount = '0';
  renderToc();
  updateTopbarState();

  if (typeof renderEpubChapter === 'function') {
    // Both modes mount one chapter initially. Continuous scroll advances by
    // replacing that chapter at an explicit boundary.
    const rendered = await renderEpubChapter(0);
    if (!rendered) throw new Error('EPUB 首屏章节加载失败');
  } else {
    // Legacy compatibility bridge
    const chapter = await loadEpubChapter(archive, 0);
    state.epubHtml = chapter.html;
    state.epubChapterIndex = chapter.index;
    state.currentChapterIndex = chapter.index;
    if (article) article.dataset.epubSkippedResourceCount = String(archive.diagnostics.skippedResourceCount);
  }
}

/* ============================================================
   EPUB Parser
   ============================================================ */
async function openEpubArchive(data) {
  const zip = await JSZip.loadAsync(
    data,
    typeof data === 'string' ? { base64: true } : {}
  );

  // 1. Find OPF path from META-INF/container.xml
  const containerXml = await zip.file('META-INF/container.xml').async('text');
  const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
  if (!opfMatch) throw new Error('Cannot find OPF file in EPUB');
  const opfPath = normalizeZipPath(opfMatch[1]);
  const opfDir  = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Parse OPF to get spine order
  const opfXml = await zip.file(opfPath).async('text');
  const title = stripXmlTags((opfXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i) || [])[1] || '');
  const creator = stripXmlTags((opfXml.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i) || [])[1] || '');

  // Build manifest: id → item metadata
  const manifest = {};
  const mediaTypes = {};
  const manifestRe = /<item\b[^>]*>/gi;
  let m;
  while ((m = manifestRe.exec(opfXml)) !== null) {
    const id = getXmlAttribute(m[0], 'id');
    const href = getXmlAttribute(m[0], 'href');
    const mediaType = getXmlAttribute(m[0], 'media-type') || '';
    const properties = getXmlAttribute(m[0], 'properties') || '';
    if (id && href) {
      const fullPath = resolveZipPath(opfDir, href);
      manifest[id] = { href, fullPath, mediaType, properties };
      if (mediaType) mediaTypes[fullPath] = mediaType;
    }
  }

  // Keep the spine as metadata only. XHTML bodies are read lazily by
  // loadEpubChapter(), after the reader has already opened the archive.
  const spineRe = /<itemref\b[^>]*>/gi;
  const spine = [];
  while ((m = spineRe.exec(opfXml)) !== null) {
    const idref = getXmlAttribute(m[0], 'idref');
    const item = idref ? manifest[idref] : null;
    if (!item) continue;
    spine.push({
      index: spine.length,
      id: idref,
      href: item.href,
      fullPath: item.fullPath,
      mediaType: item.mediaType
    });
  }

  const resourceManager = createEpubResourceManager(zip, mediaTypes);
  const chapterIndexByPath = Object.fromEntries(
    spine.map((chapter) => [normalizeZipPath(chapter.fullPath), chapter.index])
  );

  let toc = [];
  const navItem = Object.values(manifest).find(item => /\bnav\b/i.test(item.properties));
  if (navItem) {
    const navFile = getZipFile(zip, navItem.fullPath);
    if (navFile) toc = parseNavToc(await navFile.async('text'), navItem.fullPath);
  }

  if (!toc.length) {
    const ncxItem = Object.values(manifest).find(item => item.mediaType === 'application/x-dtbncx+xml')
      || manifest[(opfXml.match(/<spine\b[^>]*toc\s*=\s*(["'])(.*?)\1/i) || [])[2]];
    if (ncxItem) {
      const ncxFile = getZipFile(zip, ncxItem.fullPath);
      if (ncxFile) toc = parseNcxToc(await ncxFile.async('text'), ncxItem.fullPath);
    }
  }

  return {
    zip,
    opfPath,
    manifest,
    mediaTypes,
    spine,
    chapterIndexByPath,
    toc,
    metadata: { title, creator },
    resourceManager,
    diagnostics: {
      chapterCount: spine.length,
      inlinedResourceBytes: 0,
      skippedResourceCount: 0,
      skippedResources: []
    }
  };
}

async function loadEpubChapter(archive, index) {
  if (!archive || !Array.isArray(archive.spine)) throw new Error('EPUB 章节档案无效');
  if (!Number.isInteger(index) || index < 0 || index >= archive.spine.length) {
    throw new Error(`EPUB 章节序号无效：${index}`);
  }

  const chapter = archive.spine[index];
  const file = getZipFile(archive.zip, chapter.fullPath);
  if (!file) throw new Error(`无法打开第 ${index + 1} 章：缺少 ${chapter.fullPath}`);

  const resourceManager = archive.resourceManager || (archive.resourceManager = createEpubResourceManager(archive.zip, archive.mediaTypes));
  const resourceLease = resourceManager.createLease();

  let cleaned;
  try {
    await yieldToBrowser();
    const xhtml = await file.async('text');
    const bodyMatch = xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : xhtml;
    cleaned = (await inlineResourceRefs(
      sanitizeEpubHtml(bodyContent),
      chapter.fullPath,
      archive.zip,
      resourceManager,
      resourceLease
    ))
      .replace(/\s+xmlns(?::\w+)?="[^"]*"/g, '')
      .replace(/\s+xml:\w+="[^"]*"/g, '')
      .replace(/<svg\b/gi, '<svg class="epub-svg"');
  } catch (error) {
    resourceManager.release(resourceLease);
    throw error;
  }
  await yieldToBrowser();

  const resourceSnapshot = resourceManager.snapshot();
  archive.diagnostics.inlinedResourceBytes = resourceSnapshot.cachedBytes;
  archive.diagnostics.skippedResourceCount = resourceSnapshot.skippedResources.length;
  archive.diagnostics.skippedResources = resourceSnapshot.skippedResources.slice(0, 20);

  return {
    index,
    href: chapter.fullPath,
    resourceLease,
    html: `<section class="epub-chapter" id="br-chapter-${index + 1}" data-source-path="${escapeHtmlAttribute(chapter.fullPath)}">${cleaned}</section>`
  };
}

// AI indexing reads only chapter text. It deliberately skips the resource
// inlining path used by the visual renderer so indexing a whole book does not
// decode images, fonts, CSS, or other binary assets.
async function loadEpubChapterText(archive, index) {
  if (!archive || !Array.isArray(archive.spine)) throw new Error('EPUB 章节档案无效');
  if (!Number.isInteger(index) || index < 0 || index >= archive.spine.length) {
    throw new Error(`EPUB 章节序号无效：${index}`);
  }

  const chapter = archive.spine[index];
  const file = getZipFile(archive.zip, chapter.fullPath);
  if (!file) throw new Error(`无法读取第 ${index + 1} 章：缺少 ${chapter.fullPath}`);
  await yieldToBrowser();
  const xhtml = await file.async('text');
  const bodyMatch = xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const sanitizedBody = sanitizeEpubHtml(bodyMatch ? bodyMatch[1] : xhtml)
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const headings = [...sanitizedBody.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((match) => decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const body = sanitizedBody
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|tr|article)\s*>/gi, '\n');
  const text = decodeXmlEntities(body.replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  await yieldToBrowser();
  return { index, href: chapter.fullPath, text, headings };
}

/* ============================================================
   Marked Configuration
   ============================================================ */
