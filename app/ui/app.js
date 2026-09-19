/* ============================================================
   BabyReader — app.js
   ============================================================ */

'use strict';

/* --- State --- */
const state = {
  mode: 'read',        // 'read' | 'edit'
  theme: 'dark',       // 'dark' | 'light'
  currentBookId: null,
  currentPath: null,
  currentName: null,
  content: '',
  epubHtml: '',
  toc: [],
  tocOpen: true,
  epubBook: null,
  epubRendition: null,
  contentType: 'text', // 'text' | 'epub'
  dirty: false,
  session: null,
  userState: { version: 2, books: {}, settings: {} },
  readingMode: 'scroll',       // user preference: 'scroll' | 'double' ('single' is only the narrow-window fallback)
  effectiveReadingMode: 'scroll', // responsive mode after width-based fallback
  continuousScroll: true,     // legacy mirror retained for settings migration
  pageNumber: 1,
  pageCount: 1,
  columnWidth: 0,
  columnGap: 0,
  pageStepWidth: 0,
  pageGroupWidth: 0,
  pageHeight: 0,
  pageGroup: 0,
  pageGroupCount: 1,
  paginationGeometry: null,
  pageOffset: 0,                // current paged track offset in px
  paginationUsesTransform: false, // kept only for settings-shape compat; paging is always scrollLeft now
  lineHeight: 1.9,
  pageMargin: 40,
  highlightColor: 'yellow',
  // Reading typography (P0). Indent is in em (0 = flush); font is a stack key;
  // theme is the background mode ('dark' | 'light' | 'sepia').
  textIndent: 2,
  paragraphSpacing: 1.1,
  fontFamily: 'sans',          // 'sans' | 'songti' | 'source-serif'
  currentChapterIndex: 0,
  chapterPaths: [],
  library: null
};

/* --- Browser Host API --- */
const API_PREFIX = '/app/babyreader-fnos/api';

// Body-font choices. Every stack ends in a generic family so a missing CJK
// serif degrades to the platform's own 宋体-class face instead of a blank.
const FONT_STACKS = Object.freeze({
  'sans': '-apple-system, "PingFang SC", "Helvetica Neue", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  'songti': '"SimSun", "STSong", "Songti SC", "宋体", serif',
  'source-serif': '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", "思源宋体", "SimSun", "Songti SC", serif'
});

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    ...options
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `请求失败：${response.status}`);
  }
  return response;
}

window.browserHost = {
  async getSession() {
    return (await apiRequest('/session')).json();
  },

  async getLibrary() {
    return (await apiRequest('/library')).json();
  },

  async getUserState() {
    return (await apiRequest('/state')).json();
  },

  async saveSettings(settings) {
    return (await apiRequest('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    })).json();
  },

  async getScanStatus() {
    return (await apiRequest('/library/scan/status')).json();
  },

  async scanLibrary() {
    return (await apiRequest('/library/scan', { method: 'POST' })).json();
  },

  async openBook(book) {
    const response = await apiRequest(`/books/${encodeURIComponent(book.id)}/content`, {
      headers: { Accept: book.type === 'epub' ? 'application/epub+zip' : 'text/plain' }
    });
    if (book.type === 'epub') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return window.appHost.receiveDocument({
        path: book.relativePath,
        name: book.title,
        type: 'epub',
        content: '',
        data: btoa(binary),
        bookId: book.id
      });
    }
    return window.appHost.receiveDocument({
      path: book.relativePath,
      name: book.title,
      type: 'text',
      content: await response.text(),
      bookId: book.id
    });
  },

  async saveProgress(progress) {
    if (!state.currentBookId) return;
    await apiRequest(`/books/${state.currentBookId}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progress)
    });
  },

  async saveHighlights(highlights, bookId = state.currentBookId) {
    if (!bookId) return;
    await apiRequest(`/books/${encodeURIComponent(bookId)}/highlights`, {
      method: 'PUT',
      body: JSON.stringify({ highlights })
    });
  }
};

function currentUserSettings() {
  return {
    theme: state.theme,
    fontSize: zoomLevel,
    lineHeight: state.lineHeight,
    pageMargin: state.pageMargin,
    readingMode: state.readingMode,
    continuousScroll: state.readingMode === 'scroll',
    tocOpen: state.tocOpen,
    highlightColor: state.highlightColor,
    textIndent: state.textIndent,
    paragraphSpacing: state.paragraphSpacing,
    fontFamily: state.fontFamily
  };
}

function applyUserState(userState) {
  const next = userState && typeof userState === 'object' ? userState : {};
  state.userState = {
    version: 2,
    books: next.books && typeof next.books === 'object' && !Array.isArray(next.books) ? next.books : {},
    settings: next.settings && typeof next.settings === 'object' && !Array.isArray(next.settings) ? next.settings : {}
  };

  const settings = state.userState.settings;
  state.theme = ['light', 'sepia'].includes(settings.theme) ? settings.theme : 'dark';
  zoomLevel = Number.isFinite(settings.fontSize)
    ? Math.max(60, Math.min(200, Math.round(settings.fontSize)))
    : 100;
  state.lineHeight = Number.isFinite(settings.lineHeight)
    ? Math.max(1.2, Math.min(2.6, Math.round(settings.lineHeight * 10) / 10))
    : 1.9;
  state.pageMargin = Number.isFinite(settings.pageMargin)
    ? Math.max(8, Math.min(96, Math.round(settings.pageMargin)))
    : 40;
  state.highlightColor = ['yellow', 'green', 'blue', 'pink'].includes(settings.highlightColor)
    ? settings.highlightColor
    : 'yellow';
  // User-facing preference. 'single' is no longer offered: it survives only as
  // the effective mode a narrow window degrades to, never as a stored choice.
  const allowedReadingModes = ['scroll', 'double'];
  const storedMode = settings.readingMode === 'single' ? 'double' : settings.readingMode;
  state.readingMode = allowedReadingModes.includes(storedMode)
    ? storedMode
    : settings.continuousScroll === false ? 'double' : 'scroll';
  state.continuousScroll = state.readingMode === 'scroll';
  state.effectiveReadingMode = state.readingMode;
  state.tocOpen = settings.tocOpen !== false;
  // P0 typography: clamped exactly like the server does, so a hand-edited
  // settings file can never push the layout out of range.
  state.textIndent = Number.isFinite(settings.textIndent)
    ? Math.max(0, Math.min(4, Math.round(settings.textIndent * 2) / 2))
    : 2;
  state.paragraphSpacing = Number.isFinite(settings.paragraphSpacing)
    ? Math.max(0.4, Math.min(3, Math.round(settings.paragraphSpacing * 10) / 10))
    : 1.1;
  state.fontFamily = FONT_STACKS[settings.fontFamily] ? settings.fontFamily : 'sans';

  applyTheme(state.theme, false);
  applyZoom();
  applyTypography();
  updateTopbarState();
}

const persistUserSettings = debounce(() => {
  return window.browserHost.saveSettings(currentUserSettings())
    .then((settings) => {
      state.userState.settings = { ...state.userState.settings, ...settings };
      return settings;
    })
    .catch((error) => {
      console.error('保存用户设置失败', error);
      showHighlightHint('设置保存失败');
      throw error;
    });
}, 250);

function currentServerBookState() {
  if (!state.currentBookId) return {};
  return state.userState.books[state.currentBookId] || {};
}

function setDirty(nextDirty) {
  state.dirty = !!nextDirty;
}

function storageKey(prefix) {
  if (!state.currentPath) return null;
  return `babyreader:${prefix}:${state.contentType}:${state.currentPath}`;
}

function savedPosition() {
  const serverProgress = currentServerBookState().progress;
  if (serverProgress?.locator) {
    try {
      return JSON.parse(serverProgress.locator);
    } catch {
      return { locator: serverProgress.locator, percentage: serverProgress.percentage };
    }
  }

  const key = storageKey('position');
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

let _progressSaveChain = Promise.resolve();

function savePosition(value) {
  const key = storageKey('position');
  if (!key || !value) return Promise.resolve();
  localStorage.setItem(key, JSON.stringify(value));

  if (!state.currentBookId) return Promise.resolve();
  const bookId = state.currentBookId;
  const progress = {
    locator: JSON.stringify(value),
    percentage: Number.isFinite(value.percentage) ? value.percentage : null
  };
  const previous = currentServerBookState();
  state.userState.books[bookId] = {
    ...previous,
    progress
  };

  _progressSaveChain = _progressSaveChain.catch(() => {}).then(() => {
    if (!bookId) return;
    return apiRequest(`/books/${encodeURIComponent(bookId)}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progress)
    });
  }).catch((error) => {
    console.error('保存阅读进度失败', { bookId, error });
    throw error;
  });
  return _progressSaveChain;
}

async function flushPendingProgressSave() {
  await _progressSaveChain;
}

function saveHighlights(highlights) {
  const cleaned = Array.isArray(highlights) ? highlights : [];
  if (!state.currentBookId) return;

  const previous = currentServerBookState();
  state.userState.books[state.currentBookId] = {
    ...previous,
    highlights: cleaned
  };

  // The server is authoritative. Remove legacy cached highlights so a deleted
  // highlight cannot reappear after refresh or an application restart.
  const key = storageKey('highlights');
  if (key) localStorage.removeItem(key);
}

function loadHighlights() {
  const serverHighlights = currentServerBookState().highlights;
  if (!Array.isArray(serverHighlights)) return [];

  return serverHighlights.map((highlight) => {
    let domRange = highlight.domRange || highlight.locatorData || null;
    const locator = String(highlight.locator || '');
    if (!domRange && locator.startsWith('{')) {
      try {
        const parsed = JSON.parse(locator);
        if (parsed?.type === 'dom-range') domRange = parsed;
      } catch {
        domRange = null;
      }
    }

    return {
      ...highlight,
      domRange,
      cfi: highlight.cfi || (locator.startsWith('epubcfi(') ? locator : undefined),
      chapterHref: normalizeChapterHref(highlight.chapterHref || domRange?.chapterHref || ''),
      color: ['yellow', 'green', 'blue', 'pink'].includes(highlight.color) ? highlight.color : 'yellow',
      note: String(highlight.note || ''),
      date: highlight.date || String(highlight.createdAt || '').slice(0, 10)
    };
  });
}

/* ============================================================
   Custom Block Preprocessor
   ============================================================ */

/**
 * Replace [[TYPE]]...[[/TYPE]] blocks with <div class="block-type">...</div>
 * before passing the remainder to marked.
 *
 * Supported types:
 *   TITLE, SUBTITLE, SIGN, HEADING — single-content, rendered as-is
 *   LEDE, QUOTE                    — multi-paragraph (split on \n\n)
 *   META                           — lines joined with <br>
 *   BREAK                          — visual separator (renders as <hr>)
 *
 * Returns an object { html, remaining } where:
 *   html      — fully pre-rendered HTML string for all custom blocks
 *   remaining — the leftover text that marked should handle
 *
 * Strategy: walk the content top-to-bottom, collect custom-block segments
 * as pre-rendered HTML, and leave the rest for marked.
 */
function preprocessCustomBlocks(content) {
  // Supported block types (case-insensitive match)
  const BLOCK_TYPES = ['TITLE', 'SUBTITLE', 'LEDE', 'META', 'HEADING', 'QUOTE', 'SIGN', 'BREAK'];
  const typePattern = BLOCK_TYPES.join('|');

  // Regex: [[TYPE]] ... [[/TYPE]]  — DOTALL via workaround
  const blockRegex = new RegExp(
    `\\[\\[(${typePattern})\\]\\]([\\s\\S]*?)\\[\\[\\/(${typePattern})\\]\\]`,
    'gi'
  );

  // Also detect first h1 and restyle it
  let isFirstH1 = true;

  const segments = []; // { type: 'custom'|'markdown', content: string }
  let lastIndex = 0;

  let match;
  blockRegex.lastIndex = 0;

  while ((match = blockRegex.exec(content)) !== null) {
    const openType  = match[1].toUpperCase();
    const innerRaw  = match[2];
    const closeType = match[3].toUpperCase();

    // Collect markdown text before this block
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', content: content.slice(lastIndex, match.index) });
    }

    // Only process if open/close tags match
    if (openType === closeType) {
      segments.push({ type: 'custom', blockType: openType, content: innerRaw.trim() });
    } else {
      // Mismatched tags — treat as plain markdown
      segments.push({ type: 'markdown', content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last block
  if (lastIndex < content.length) {
    segments.push({ type: 'markdown', content: content.slice(lastIndex) });
  }

  // Now build output HTML
  let outputHTML = '';

  for (const seg of segments) {
    if (seg.type === 'markdown') {
      // Render through marked; then post-process first h1
      let mdHTML = marked.parse(seg.content);
      if (isFirstH1) {
        // Add .is-title class to the very first <h1> in the document
        mdHTML = mdHTML.replace(/<h1([ >])/, (m, rest) => {
          isFirstH1 = false;
          return `<h1 class="is-title"${rest === '>' ? '>' : ' ' + rest}`;
        });
      }
      outputHTML += mdHTML;
    } else {
      outputHTML += renderCustomBlock(seg.blockType, seg.content);
    }
  }

  return outputHTML;
}

/**
 * Render a single custom block to HTML.
 */
function renderCustomBlock(type, inner) {
  const cls = 'block-' + type.toLowerCase();

  switch (type) {
    case 'LEDE':
    case 'QUOTE': {
      // Split on double newlines → multiple <p> tags
      const paragraphs = inner
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `<p>${inlineMarkdown(p)}</p>`)
        .join('');
      return `<div class="${cls}">${paragraphs}</div>\n`;
    }

    case 'META': {
      // Each line becomes text separated by <br>
      const lines = inner
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => inlineMarkdown(l))
        .join('<br>');
      return `<div class="${cls}">${lines}</div>\n`;
    }

    case 'TITLE':
    case 'SUBTITLE':
    case 'SIGN': {
      return `<div class="${cls}">${inlineMarkdown(inner)}</div>\n`;
    }

    case 'HEADING': {
      return `<div class="${cls}">${escapeHtml(inner)}</div>\n`;
    }

    case 'BREAK': {
      return '<hr class="block-break">\n';
    }

    default: {
      // Unknown type — wrap generically
      return `<div class="${cls}">${inlineMarkdown(inner)}</div>\n`;
    }
  }
}

/**
 * Process inline markdown (bold, italic, code, links) but not block-level.
 * Uses a lightweight approach rather than a full marked.parse to avoid
 * wrapping in <p> tags.
 */
function inlineMarkdown(text) {
  // We use marked's lexer trick: parse and strip the outer <p> wrapper.
  const html = marked.parseInline(text);
  return html;
}

/**
 * Escape HTML special characters.
 */
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

async function resourceDataUrl(zip, resourcePath, mediaTypes) {
  const file = getZipFile(zip, resourcePath);
  if (!file) return null;
  const bytes = await file.async('uint8array');
  if (bytes.byteLength > 32 * 1024 * 1024) {
    console.warn('跳过超大 EPUB 资源', resourcePath, bytes.byteLength);
    return null;
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const mime = mediaTypes[resourcePath] || mimeFromPath(resourcePath);
  return `data:${mime};base64,${btoa(binary)}`;
}

async function inlineCssResources(css, cssPath, zip, mediaTypes) {
  const cssDir = getDirPath(cssPath);
  let output = sanitizeCss(css);
  const references = [...output.matchAll(/url\s*\(\s*(["']?)([^"')]+)\1\s*\)/gi)];
  for (const match of references) {
    const href = match[2].trim();
    if (!href || /^(?:data:|blob:|https?:|file:|javascript:|#)/i.test(href)) continue;
    try {
      const resourcePath = resolveZipPath(cssDir, href);
      const dataUrl = await resourceDataUrl(zip, resourcePath, mediaTypes);
      if (dataUrl) output = output.replace(match[0], `url("${dataUrl}")`);
    } catch (error) {
      console.warn('EPUB CSS 资源路径无效', cssPath, href, error);
    }
  }
  return output;
}

async function inlineResourceRefs(html, chapterPath, zip, mediaTypes) {
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
      const css = await inlineCssResources(await cssFile.async('text'), cssPath, zip, mediaTypes);
      output = output.replace(tag, `<style data-source-path="${escapeHtmlAttribute(cssPath)}">${css}</style>`);
    } catch (error) {
      console.warn('EPUB 样式表加载失败', chapterPath, href, error);
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
        const dataUrl = await resourceDataUrl(zip, resourcePath, mediaTypes);
        if (!dataUrl) continue;
        const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRe = new RegExp(`(${attrName.replace(':', '\\:')}\\s*=\\s*)(["'])${escapedHref}\\2`, 'i');
        nextTag = nextTag.replace(attrRe, `$1$2${escapeHtmlAttribute(dataUrl)}$2`);
      } catch (error) {
        console.warn('EPUB 资源加载失败', chapterPath, href, error);
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

function parseNavToc(navHtml, navPath, chapterTargets) {
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
    const fallbackTarget = chapterTargets[chapterPath];
    const target = split.fragment ? `#${split.fragment}` : fallbackTarget;
    if (target) entries.push({ label, target });
  }
  return entries;
}

function parseNcxToc(ncxXml, ncxPath, chapterTargets) {
  const ncxDir = getDirPath(ncxPath);
  const entries = [];
  const pointRe = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let m;
  while ((m = pointRe.exec(ncxXml)) !== null) {
    const labelMatch = m[1].match(/<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>/i);
    const contentMatch = m[1].match(/<content\b[^>]*src\s*=\s*(["'])(.*?)\1[^>]*\/?>/i);
    if (!labelMatch || !contentMatch) continue;

    const label = stripXmlTags(labelMatch[1]);
    const rawHref = decodeXmlEntities(contentMatch[2]);
    const split = splitHref(rawHref);
    const chapterPath = resolveZipPath(ncxDir, split.path);
    const fallbackTarget = chapterTargets[chapterPath];
    const target = split.fragment ? `#${split.fragment}` : fallbackTarget;
    if (label && target) entries.push({ label, target });
  }
  return entries;
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
      surface: '#FBF7EF'
    };
  }

  return {
    bg: '#1e1e1e',
    text: '#e8e0d4',
    textMuted: '#cdbfb2',
    textStrong: '#f0e8dc',
    accent: '#DA7756',
    surface: '#232323'
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
  return `
    html, body {
      background: ${colors.bg} !important;
      color: ${colors.text} !important;
    }
    body {
      font-family: ${FONT_STACKS[state.fontFamily] || FONT_STACKS['sans']} !important;
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
      background: ${highlightColor()} !important;
      color: ${colors.textStrong} !important;
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
      let style = doc.getElementById('babyreader-epub-theme');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'babyreader-epub-theme';
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
  state.epubRendition.themes.register('babyreader', getEpubThemeCss());
  state.epubRendition.themes.select('babyreader');
  requestAnimationFrame(applyThemeToEpubFrames);
}

function themeIconSvg(nextTheme) {
  if (nextTheme === 'light') {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2"></path><path d="M12 20v2"></path>
        <path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>
        <path d="M2 12h2"></path><path d="M20 12h2"></path>
        <path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.4 14.4A7.3 7.3 0 0 1 9.6 3.6a8.7 8.7 0 1 0 10.8 10.8Z"></path>
    </svg>
  `;
}

function applyTheme(theme, persist = true) {
  state.theme = ['dark', 'light', 'sepia'].includes(theme) ? theme : 'dark';
  document.body.classList.toggle('theme-light', state.theme === 'light');
  document.body.classList.toggle('theme-sepia', state.theme === 'sepia');

  const btnTheme = document.getElementById('btnTheme');
  if (btnTheme) {
    // The toggle button only flips dark <-> light; sepia is picked from the
    // background dropdown in the settings drawer.
    const isLightOrSepia = state.theme === 'light' || state.theme === 'sepia';
    btnTheme.innerHTML = themeIconSvg(isLightOrSepia ? 'dark' : 'light');
    btnTheme.setAttribute('aria-label', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
    btnTheme.setAttribute('title', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
  }

  if (persist) {
    localStorage.setItem('babyreader-theme', state.theme);
  }

  applyEpubTheme();
}

function toggleTheme() {
  // Any light-class background (浅色 / 护眼米黄) collapses to 深色, and 深色
  // opens 浅色. Without this the button claimed "切换深色模式" while actually
  // landing back on 浅色 whenever a sepia book was open.
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function highlightIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m14.5 2.5 5 5-9.5 9.5H5V12Z"></path>
      <path d="M3 22h18"></path>
    </svg>
  `;
}

function exportIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>
      <path d="M12 14V3"></path>
      <path d="m8 7 4-4 4 4"></path>
    </svg>
  `;
}

// P0: icon-only toolbar — no text labels
function searchIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
    </svg>
  `;
}
function bookmarkIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
    </svg>
  `;
}
function notesIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
  `;
}
function aiIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a6 6 0 0 1 6 6v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z"></path>
      <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path>
      <path d="M12 18v4"></path><path d="M8 22h8"></path>
    </svg>
  `;
}
function settingsIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.18-.08a2 2 0 0 0-2 2v.44a2 2 0 0 0 2 2h.18a2 2 0 0 1 1.73 1l.25.43a2 2 0 0 1 0 2l-.08.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.18.08a2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2h-.18a2 2 0 0 1-1.73-1l-.25-.43a2 2 0 0 1 0-2l.08-.18a2 2 0 0 0-2-2z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

let _highlightPill = null;
let _highlightPillTimeout = null;
let _pendingCfiRange = null;
let _pendingDomHighlight = null;
let _fileNameFlashTimeout = null;
let _highlightSaveChain = Promise.resolve();
let _highlightSaveRevision = 0;
let _lastLibraryFocusBookId = null;
let _activeHighlightEditorId = null;

function getHighlightPill() {
  if (!_highlightPill) {
    _highlightPill = document.createElement('button');
    _highlightPill.className = 'highlight-pill';
    _highlightPill.textContent = '划线';
    document.body.appendChild(_highlightPill);
  }
  return _highlightPill;
}

function dismissHighlightPill() {
  clearTimeout(_highlightPillTimeout);
  _pendingCfiRange = null;
  _pendingDomHighlight = null;
  const pill = _highlightPill;
  if (pill) {
    pill.classList.remove('visible');
  }
  updateTopbarState();
}

function showHighlightPill(x, y, cfiRange = null) {
  const pill = getHighlightPill();
  dismissHighlightPill();
  _pendingCfiRange = cfiRange;

  pill.style.left = x + 'px';
  pill.style.top = y + 'px';
  pill.classList.add('visible');
  updateTopbarState();

  _highlightPillTimeout = setTimeout(dismissHighlightPill, 3000);
}

function runPendingHighlight() {
  const pill = _highlightPill;
  if (state.contentType === 'epub' && _pendingDomHighlight && pill?._clickHandler) {
    pill._clickHandler();
    return true;
  }
  if (state.contentType === 'epub' && _pendingCfiRange && pill?._clickHandler) {
    pill._clickHandler();
    return true;
  }
  return false;
}

function updateTopbarState() {
  const isEpub = state.contentType === 'epub';
  const hasToc = isEpub && state.toc.length > 0;
  const btnToc = document.getElementById('btnToc');
  const btnEdit = document.getElementById('btnEdit');

  document.body.classList.toggle('is-epub', isEpub);
  document.body.classList.toggle('has-toc', hasToc);
  document.body.classList.toggle('toc-open', hasToc && state.tocOpen);

  if (btnToc) {
    btnToc.hidden = !hasToc;
    btnToc.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h12"/><path d="M4 18h16"/></svg>`;
    const tocLabel = state.tocOpen ? '隐藏目录' : '显示目录';
    btnToc.setAttribute('aria-label', tocLabel);
    btnToc.setAttribute('title', tocLabel);
  }

  const btnHighlight = document.getElementById('btnHighlight');
  if (btnHighlight) {
    btnHighlight.hidden = !isEpub;
    btnHighlight.innerHTML = highlightIconSvg();
  }

  const btnExport = document.getElementById('btnExportHighlights');
  if (btnExport) {
    btnExport.hidden = !isEpub;
    btnExport.innerHTML = exportIconSvg();
  }

  // P0: inject icon-only toolbar buttons
  const btnSearch = document.getElementById('btnSearch');
  const btnBookmarks = document.getElementById('btnBookmarks');
  const btnNotes = document.getElementById('btnNotes');
  const btnAi = document.getElementById('btnAi');
  const btnSettings = document.getElementById('btnSettings');
  const themeBtn = document.getElementById('btnTheme');

  if (btnSearch) btnSearch.innerHTML = searchIconSvg();
  if (btnBookmarks) btnBookmarks.innerHTML = bookmarkIconSvg();
  if (btnNotes) btnNotes.innerHTML = notesIconSvg();
  if (btnAi) btnAi.innerHTML = aiIconSvg();
  if (btnSettings) btnSettings.innerHTML = settingsIconSvg();
  if (themeBtn) {
    const isLightOrSepia = state.theme === 'light' || state.theme === 'sepia';
    themeBtn.innerHTML = themeIconSvg(isLightOrSepia ? 'dark' : 'light');
    themeBtn.setAttribute('aria-label', isLightOrSepia ? '切换深色模式' : '切换浅色模式');
  }

  const btnBack = document.getElementById('btnBackToLibrary');
  const btnPrevious = document.getElementById('btnPreviousChapter');
  const btnNext = document.getElementById('btnNextChapter');
  const readingProgress = document.getElementById('readingProgress');
  const floatingToolbar = document.getElementById('readerFloatingToolbar');
  const mobileToolbar = document.getElementById('mobileReaderToolbar');
  const mobileBack = document.getElementById('btnMobileBackToLibrary');
  const mobilePrevious = document.getElementById('btnMobilePreviousChapter');
  const mobileHighlight = document.getElementById('btnMobileHighlight');
  const mobileNext = document.getElementById('btnMobileNextChapter');
  const hasDocument = Boolean(state.currentPath);

  if (btnBack) btnBack.hidden = !isEpub;
  if (btnPrevious) btnPrevious.hidden = !isEpub;
  if (btnNext) btnNext.hidden = !isEpub;
  if (readingProgress) readingProgress.hidden = !isEpub;
  if (floatingToolbar) floatingToolbar.hidden = !hasDocument;
  if (mobileToolbar) mobileToolbar.hidden = !isEpub;
  if (mobileBack) mobileBack.disabled = !isEpub;
  if (mobilePrevious) mobilePrevious.disabled = !isEpub || state.currentChapterIndex <= 0;
  if (mobileHighlight) mobileHighlight.disabled = !isEpub;
  if (mobileNext) {
    mobileNext.disabled = !isEpub
      || state.currentChapterIndex >= Math.max(0, state.chapterPaths.length - 1);
  }
  if (isEpub) requestAnimationFrame(updateReadingProgress);
}

function toggleToc() {
  state.tocOpen = !state.tocOpen;
  localStorage.setItem('babyreader-toc-open', state.tocOpen ? '1' : '0');
  updateTopbarState();
  requestAnimationFrame(redrawDomHighlights);
}

function highlightId() {
  return `br-hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectedTextSignature(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeChapterHref(value) {
  try {
    return normalizeZipPath(splitHref(value).path);
  } catch {
    return '';
  }
}

function nodePathWithin(root, node) {
  if (!root || !node || (node !== root && !root.contains(node))) return null;
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === root ? path : null;
}

function nodeFromPath(root, path) {
  if (!root || !Array.isArray(path)) return null;
  let current = root;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || !current?.childNodes?.[index]) return null;
    current = current.childNodes[index];
  }
  return current;
}

function textOffsetWithin(root, targetNode, targetOffset) {
  if (!root || !targetNode || (targetNode !== root && !root.contains(targetNode))) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return total + Math.max(0, Math.min(targetOffset, node.nodeValue?.length || 0));
    total += node.nodeValue?.length || 0;
  }
  return null;
}

function textPositionAtOffset(root, absoluteOffset) {
  if (!root || !Number.isFinite(absoluteOffset) || absoluteOffset < 0) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = absoluteOffset;
  let node;
  let last = null;
  while ((node = walker.nextNode())) {
    last = node;
    const length = node.nodeValue?.length || 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return last ? { node: last, offset: last.nodeValue?.length || 0 } : null;
}

function serializeDomRange(range, text) {
  if (!range || range.collapsed) return null;
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  const chapter = commonElement?.closest?.('.epub-chapter');
  if (!chapter) return null;

  const startPath = nodePathWithin(chapter, range.startContainer);
  const endPath = nodePathWithin(chapter, range.endContainer);
  const startTextOffset = textOffsetWithin(chapter, range.startContainer, range.startOffset);
  const endTextOffset = textOffsetWithin(chapter, range.endContainer, range.endOffset);
  if (!startPath || !endPath || startTextOffset === null || endTextOffset === null) return null;

  const chapterText = chapter.textContent || '';
  return {
    chapterHref: normalizeChapterHref(chapter.dataset.sourcePath || ''),
    startPath,
    startOffset: range.startOffset,
    endPath,
    endOffset: range.endOffset,
    startTextOffset,
    endTextOffset,
    text: selectedTextSignature(text),
    contextBefore: chapterText.slice(Math.max(0, startTextOffset - 80), startTextOffset),
    contextAfter: chapterText.slice(endTextOffset, endTextOffset + 80)
  };
}

function rangeFromHighlight(highlight) {
  const locator = highlight?.domRange || highlight?.locatorData;
  const chapter = findChapterBySourcePath(highlight?.chapterHref || locator?.chapterHref);
  if (!chapter || !locator) return null;

  const expectedText = selectedTextSignature(highlight.text || locator.text);
  const createVerifiedRange = (startNode, startOffset, endNode, endOffset) => {
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return selectedTextSignature(range.toString()) === expectedText ? range : null;
    } catch {
      return null;
    }
  };

  const pathStartNode = nodeFromPath(chapter, locator.startPath);
  const pathEndNode = nodeFromPath(chapter, locator.endPath);
  const pathStartOffset = locator.startOffset;
  const pathEndOffset = locator.endOffset;
  const pathsValid = pathStartNode && pathEndNode
    && Number.isInteger(pathStartOffset) && Number.isInteger(pathEndOffset)
    && pathStartOffset >= 0 && pathEndOffset >= 0
    && pathStartOffset <= (pathStartNode.nodeValue?.length ?? pathStartNode.childNodes?.length ?? 0)
    && pathEndOffset <= (pathEndNode.nodeValue?.length ?? pathEndNode.childNodes?.length ?? 0);
  if (pathsValid) {
    const exactRange = createVerifiedRange(
      pathStartNode,
      pathStartOffset,
      pathEndNode,
      pathEndOffset
    );
    if (exactRange) return exactRange;
  }

  const absoluteStart = textPositionAtOffset(chapter, locator.startTextOffset);
  const absoluteEnd = textPositionAtOffset(chapter, locator.endTextOffset);
  const offsetRange = createVerifiedRange(
    absoluteStart?.node,
    absoluteStart?.offset,
    absoluteEnd?.node,
    absoluteEnd?.offset
  );
  if (offsetRange) return offsetRange;

  if (!expectedText) return null;
  const chapterText = chapter.textContent || '';
  const contextBefore = String(highlight.contextBefore || locator.contextBefore || '');
  const contextAfter = String(highlight.contextAfter || locator.contextAfter || '');
  const candidates = [];
  let searchOffset = 0;
  while (searchOffset <= chapterText.length - expectedText.length) {
    const index = chapterText.indexOf(expectedText, searchOffset);
    if (index < 0) break;
    const beforeMatches = !contextBefore
      || chapterText.slice(Math.max(0, index - contextBefore.length), index) === contextBefore;
    const afterStart = index + expectedText.length;
    const afterMatches = !contextAfter
      || chapterText.slice(afterStart, afterStart + contextAfter.length) === contextAfter;
    if (beforeMatches && afterMatches) candidates.push(index);
    searchOffset = index + Math.max(1, expectedText.length);
  }
  if (candidates.length !== 1) return null;

  const recoveredStart = textPositionAtOffset(chapter, candidates[0]);
  const recoveredEnd = textPositionAtOffset(chapter, candidates[0] + expectedText.length);
  return createVerifiedRange(
    recoveredStart?.node,
    recoveredStart?.offset,
    recoveredEnd?.node,
    recoveredEnd?.offset
  );
}

let _highlightEditorReturnFocus = null;

function closeHighlightEditor({ restoreFocus = true } = {}) {
  const editor = document.getElementById('highlightEditor');
  if (editor) editor.hidden = true;
  _activeHighlightEditorId = null;

  if (restoreFocus) {
    const target = _highlightEditorReturnFocus;
    _highlightEditorReturnFocus = null;
    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus();
    } else {
      document.getElementById('btnBackToLibrary')?.focus();
    }
  }
}

function openHighlightEditor(id) {
  const highlight = loadHighlights().find((item) => item.id === id);
  if (!highlight) return false;

  const editor = document.getElementById('highlightEditor');
  const text = document.getElementById('highlightEditorText');
  const color = document.getElementById('highlightEditorColor');
  const note = document.getElementById('highlightEditorNote');
  if (!editor || !text || !color || !note) return false;

  _highlightEditorReturnFocus = document.activeElement;
  _activeHighlightEditorId = id;
  text.textContent = highlight.text || '';
  color.value = ['yellow', 'green', 'blue', 'pink'].includes(highlight.color)
    ? highlight.color
    : 'yellow';
  note.value = String(highlight.note || '');
  editor.hidden = false;
  requestAnimationFrame(() => note.focus());
  return true;
}

async function saveActiveHighlightEdits() {
  if (!_activeHighlightEditorId) return;
  const color = document.getElementById('highlightEditorColor');
  const note = document.getElementById('highlightEditorNote');
  const highlights = loadHighlights();
  const index = highlights.findIndex((item) => item.id === _activeHighlightEditorId);
  if (index < 0) return closeHighlightEditor();

  highlights[index] = {
    ...highlights[index],
    color: ['yellow', 'green', 'blue', 'pink'].includes(color?.value) ? color.value : 'yellow',
    note: String(note?.value || '').slice(0, 4000)
  };
  saveHighlights(highlights);
  redrawDomHighlights();
  try {
    await queueHighlightSave();
    closeHighlightEditor();
  } catch {
    note?.focus();
  }
}

async function deleteActiveHighlight() {
  if (!_activeHighlightEditorId) return;
  const id = _activeHighlightEditorId;
  const remaining = loadHighlights().filter((item) => item.id !== id);
  saveHighlights(remaining);
  redrawDomHighlights();
  try {
    await queueHighlightSave();
    closeHighlightEditor();
  } catch {
    document.getElementById('btnDeleteHighlight')?.focus();
  }
}

function setupHighlightEditor() {
  const editor = document.getElementById('highlightEditor');
  if (!editor || editor._babyreaderBound) return;
  editor._babyreaderBound = true;

  document.getElementById('btnCloseHighlightEditor')?.addEventListener('click', () => closeHighlightEditor());
  document.getElementById('btnSaveHighlight')?.addEventListener('click', saveActiveHighlightEdits);
  document.getElementById('btnDeleteHighlight')?.addEventListener('click', deleteActiveHighlight);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHighlightEditor();
    }
  });
}

function highlightFileName() {
  const bookName = (state.currentName || '未知书籍').replace(/\.epub$/i, '');
  return `${bookName}.md`;
}

function highlightFilePathLabel(filename = highlightFileName()) {
  return `~/Documents/BabyReader/${filename}`;
}

function clearReaderSelection() {
  const sel = window.getSelection?.();
  sel?.removeAllRanges?.();
}

function ensureHighlightLayer() {
  const article = document.getElementById('article');
  if (!article) return null;

  let layer = article.querySelector(':scope > .highlight-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'highlight-layer';
    layer.setAttribute('aria-hidden', 'true');
    article.prepend(layer);
  }
  return layer;
}

function clearRenderedHighlights() {
  const layer = document.querySelector('#article > .highlight-layer');
  if (layer) layer.innerHTML = '';
}

function drawHighlightRects(id, range, color = 'yellow') {
  const layer = ensureHighlightLayer();
  const article = document.getElementById('article');
  if (!layer || !article || !range) return false;

  const allowedColors = ['yellow', 'green', 'blue', 'pink'];
  const normalizedColor = allowedColors.includes(color) ? color : 'yellow';
  const articleRect = article.getBoundingClientRect();
  let drew = false;
  for (const rect of range.getClientRects()) {
    if (rect.width < 2 || rect.height < 2) continue;
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'br-highlight-box';
    box.dataset.highlightId = id;
    box.dataset.highlightColor = normalizedColor;
    box.setAttribute('aria-label', '编辑划线');
    box.style.left = `${rect.left - articleRect.left}px`;
    box.style.top = `${rect.top - articleRect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openHighlightEditor(id);
    });
    layer.appendChild(box);
    drew = true;
  }
  return drew;
}

function findRangeForHighlightText(text) {
  const article = document.getElementById('article');
  const needle = selectedTextSignature(text);
  if (!article || !needle) return null;

  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest('.highlight-layer')) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.includes(needle)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const node = walker.nextNode();
  if (!node) return null;

  const start = node.nodeValue.indexOf(needle);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + needle.length);
  return range;
}

function saveDomHighlight(id, text, range) {
  const locator = serializeDomRange(range, text);
  if (!locator || !state.currentBookId) return false;

  const highlights = loadHighlights();
  if (highlights.some((highlight) => highlight.id === id)) return false;

  highlights.push({
    id,
    bookId: state.currentBookId,
    chapterHref: locator.chapterHref,
    text: selectedTextSignature(text),
    contextBefore: locator.contextBefore,
    contextAfter: locator.contextAfter,
    domRange: locator,
    color: state.highlightColor,
    note: '',
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10)
  });
  saveHighlights(highlights);
  void queueHighlightSave();
  updateTopbarState();
  return true;
}

function applyDomHighlightFromRange(range, text) {
  if (!range || range.collapsed) return false;

  const locator = serializeDomRange(range, text);
  if (!locator) return false;

  const id = highlightId();
  if (!drawHighlightRects(id, range, state.highlightColor)) return false;
  if (!saveDomHighlight(id, text, range)) {
    redrawDomHighlights();
    return false;
  }
  clearReaderSelection();
  return true;
}

function setPendingDomHighlight(range, text) {
  if (!range || range.collapsed || !selectedTextSignature(text)) return;

  const article = document.getElementById('article');
  const common = range.commonAncestorContainer;
  const commonElement = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  if (!article || !commonElement || !article.contains(commonElement)) return;

  let rect;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    return;
  }
  if (!rect || (!rect.width && !rect.height)) return;

  const pill = getHighlightPill();
  const oldHandler = pill._clickHandler;
  if (oldHandler) pill.removeEventListener('click', oldHandler);

  // Identical text may occur more than once. Selection always creates a new
  // precisely located highlight; deletion is available only by highlight ID
  // from the editor dialog.
  pill.textContent = '划线';

  const clonedRange = range.cloneRange();
  const handler = () => {
    const pending = _pendingDomHighlight;
    dismissHighlightPill();
    if (pending) applyDomHighlightFromRange(pending.range, pending.text);
  };
  pill._clickHandler = handler;
  pill.addEventListener('click', handler);

  showHighlightPill(rect.left + rect.width / 2 - 28, rect.top - 42);
  _pendingDomHighlight = { range: clonedRange, text };
}

function setupDomHighlightInteraction() {
  const article = document.getElementById('article');
  if (!article || article._babyreaderDomHighlightBound) return;
  article._babyreaderDomHighlightBound = true;

  const readSelection = () => {
    if (state.contentType !== 'epub') return;
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    setPendingDomHighlight(range, sel.toString());
  };

  article.addEventListener('mouseup', () => setTimeout(readSelection, 0));
  article.addEventListener('keyup', () => setTimeout(readSelection, 0));
  article.addEventListener('touchend', () => setTimeout(readSelection, 120));
}

function highlightCurrentDomSelection() {
  if (state.contentType !== 'epub') return false;
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  return applyDomHighlightFromRange(range, sel.toString());
}

function redrawDomHighlights() {
  const highlights = loadHighlights();
  const article = document.getElementById('article');
  if (!article) return;

  clearRenderedHighlights();
  ensureHighlightLayer();
  for (const highlight of highlights) {
    const hasPreciseLocator = Boolean(
      highlight.domRange
      || highlight.locatorData
      || highlight.chapterHref
    );
    const range = rangeFromHighlight(highlight)
      || (!hasPreciseLocator ? findRangeForHighlightText(highlight.text) : null);
    if (range) drawHighlightRects(highlight.id, range, highlight.color);
  }
}

function iframeRectForContents(contents) {
  for (const iframe of document.querySelectorAll('#epubViewer iframe')) {
    if (iframe.contentWindow === contents?.window) {
      return iframe.getBoundingClientRect();
    }
  }
  return { left: 0, top: 0 };
}

function addHighlight(cfi, text, contents) {
  if (!cfi || !state.epubRendition) return;

  const highlights = loadHighlights();
  if (highlights.some(h => h.cfi === cfi)) {
    contents?.window?.getSelection()?.removeAllRanges();
    return;
  }

  state.epubRendition.annotations.highlight(cfi, {}, (e) => {
    e.stopPropagation();
    state.epubRendition.annotations.remove(cfi, 'highlight');
    const remaining = loadHighlights().filter(x => x.cfi !== cfi);
    saveHighlights(remaining);
    autoSaveHighlights();
    updateTopbarState();
  });

  highlights.push({
    cfi,
    text: String(text || '').slice(0, 500),
    date: new Date().toISOString().slice(0, 10)
  });
  saveHighlights(highlights);
  autoSaveHighlights();
  updateTopbarState();
  contents?.window?.getSelection()?.removeAllRanges();
}

function setPendingHighlight(cfiRange, contents, range, text) {
  if (!cfiRange || !contents || !range) return;

  let x = 0;
  let y = 0;
  try {
    const rect = range.getBoundingClientRect();
    const iframeRect = iframeRectForContents(contents);
    x = iframeRect.left + rect.left + rect.width / 2 - 28;
    y = iframeRect.top + rect.top - 42;
  } catch {
    return;
  }

  const pill = getHighlightPill();
  const oldHandler = pill._clickHandler;
  if (oldHandler) pill.removeEventListener('click', oldHandler);

  const handler = () => {
    const cfi = cfiRange;
    dismissHighlightPill();
    addHighlight(cfi, text, contents);
  };
  pill._clickHandler = handler;
  pill.addEventListener('click', handler);
  showHighlightPill(x, y, cfiRange);
}

function setupHighlightInteraction() {
  if (!state.epubRendition) return;

  state.epubRendition.on('selected', (cfiRange, contents) => {
    const sel = contents.window.getSelection();
    if (!sel || sel.isCollapsed) return;

    try {
      const range = sel.getRangeAt(0);
      setPendingHighlight(cfiRange, contents, range, sel.toString());
    } catch {
      return;
    }
  });

}

function destroyEpub() {
  dismissHighlightPill();
  state.epubMetadata = null;
  state.epubHtml = '';
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
  const epub = await parseEpub(base64data);
  state.epubHtml = epub.html;
  state.epubMetadata = epub.metadata || {};
  state.toc = epub.toc || [];
  state.chapterPaths = Array.isArray(epub.chapterPaths) ? epub.chapterPaths : [];
  state.currentChapterIndex = 0;
  renderToc();
  updateTopbarState();
}

/* ============================================================
   EPUB Parser
   ============================================================ */
async function parseEpub(base64data) {
  const zip = await JSZip.loadAsync(base64data, { base64: true });

  // 1. Find OPF path from META-INF/container.xml
  const containerXml = await zip.file('META-INF/container.xml').async('text');
  const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
  if (!opfMatch) throw new Error('Cannot find OPF file in EPUB');
  const opfPath = opfMatch[1];
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

  // Get spine order (idref list)
  const spineRe = /<itemref\b[^>]*>/gi;
  const spineIds = [];
  while ((m = spineRe.exec(opfXml)) !== null) {
    const idref = getXmlAttribute(m[0], 'idref');
    if (idref) spineIds.push(idref);
  }

  // 3. Read each chapter XHTML and extract body content
  const chapters = [];
  const chapterTargets = {};
  for (const id of spineIds) {
    const item = manifest[id];
    if (!item) continue;
    const fullPath = item.fullPath;
    const file = getZipFile(zip, fullPath);
    if (!file) continue;

    const xhtml = await file.async('text');
    // Extract body content
    const bodyMatch = xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : xhtml;
    // Strip namespace attributes and xml:lang etc
    const chapterId = `br-chapter-${chapters.length + 1}`;
    chapterTargets[fullPath] = `#${chapterId}`;
    const cleaned = await inlineResourceRefs(sanitizeEpubHtml(bodyContent), fullPath, zip, mediaTypes)
      .then(content => content
      .replace(/\s+xmlns(?::\w+)?="[^"]*"/g, '')
      .replace(/\s+xml:\w+="[^"]*"/g, '')
      .replace(/<svg\b/gi, '<svg class="epub-svg"')
      );
    chapters.push(`<section class="epub-chapter" id="${chapterId}" data-source-path="${escapeHtmlAttribute(fullPath)}">${cleaned}</section>`);
  }

  if (!chapters.length) {
    throw new Error('No readable chapters found in EPUB');
  }

  let toc = [];
  const navItem = Object.values(manifest).find(item => /\bnav\b/i.test(item.properties));
  if (navItem) {
    const navFile = getZipFile(zip, navItem.fullPath);
    if (navFile) toc = parseNavToc(await navFile.async('text'), navItem.fullPath, chapterTargets);
  }

  if (!toc.length) {
    const ncxItem = Object.values(manifest).find(item => item.mediaType === 'application/x-dtbncx+xml')
      || manifest[(opfXml.match(/<spine\b[^>]*toc\s*=\s*(["'])(.*?)\1/i) || [])[2]];
    if (ncxItem) {
      const ncxFile = getZipFile(zip, ncxItem.fullPath);
      if (ncxFile) toc = parseNcxToc(await ncxFile.async('text'), ncxItem.fullPath, chapterTargets);
    }
  }

  return {
    html: chapters.join('\n<hr class="chapter-break">\n'),
    toc,
    chapterPaths: Object.keys(chapterTargets),
    metadata: { title, creator }
  };
}

/* ============================================================
   Marked Configuration
   ============================================================ */
function configureMarked() {
  if (typeof marked === 'undefined') return;

  marked.setOptions({
    gfm: true,
    breaks: false
  });
}

/* ============================================================
   Rendering
   ============================================================ */
function renderArticle() {
  const article = document.getElementById('article');
  const reader = document.getElementById('reader');
  const welcome = document.getElementById('welcome');
  const epubShell = document.getElementById('epubShell');
  const isWelcome = !state.currentPath && (!state.content || !state.content.trim());

  if (reader) reader.classList.toggle('is-welcome', isWelcome);
  document.body.classList.toggle('is-welcome', isWelcome);

  if (isWelcome) {
    if (epubShell) epubShell.style.display = 'none';
    if (article) article.style.display = '';
    article.innerHTML = '';
    if (welcome) {
      welcome.style.display = '';
      article.appendChild(welcome);
    }
    return;
  }

  if (!state.content || !state.content.trim()) {
    if (epubShell) epubShell.style.display = 'none';
    if (article) article.style.display = '';
    article.innerHTML = '';
    return;
  }

  if (state.contentType === 'epub') {
    if (epubShell) epubShell.style.display = 'none';
    if (article) {
      article.style.display = '';
      article.innerHTML = state.epubHtml || '';
      ensureHighlightLayer();
      requestAnimationFrame(redrawDomHighlights);
      // Content arrives after the last pagination measurement, and the paper
      // card has a fixed width, so the ResizeObserver never sees the column
      // track grow. Without this the page count stays frozen at the value
      // measured on the empty/placeholder article (cols=1, buttons dead).
      requestAnimationFrame(() => {
        if (state.effectiveReadingMode !== 'scroll') measurePagination({ preserveLocator: true });
      });
      for (const img of article.querySelectorAll('img')) {
        if (img.complete) continue;
        img.addEventListener('load', () => {
          if (state.effectiveReadingMode !== 'scroll') measurePagination({ preserveLocator: true });
        }, { once: true });
      }
    }
  } else {
    if (epubShell) epubShell.style.display = 'none';
    if (article) article.style.display = '';
    // Markdown — run through preprocessor + marked
    const html = preprocessCustomBlocks(state.content);
    article.innerHTML = html;
  }
}

function ensureTocElement() {
  return document.getElementById('toc');
}

function renderToc() {
  const toc = ensureTocElement();
  const list = document.getElementById('tocList');
  const emptyState = document.getElementById('tocEmptyState');
  const hasToc = state.contentType === 'epub' && state.toc.length > 0;

  if (toc) toc.hidden = !hasToc;
  if (emptyState) emptyState.hidden = hasToc;
  updateTopbarState();
  if (!list) return;

  list.innerHTML = hasToc
    ? state.toc.map((item) => {
      const depth = Math.min(Number(item.depth || 0), 3);
      return `<li class="toc-depth-${depth}"><a href="#" data-target="${escapeHtmlAttribute(item.target)}">${escapeHtml(item.label)}</a></li>`;
    }).join('')
    : '';
}

function normalizeTextContext(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function currentReadingLocator(reader) {
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  const readerRect = reader.getBoundingClientRect();
  const paged = state.effectiveReadingMode !== 'scroll';
  const viewportTop = readerRect.top + 8;
  const viewportLeft = readerRect.left + 8;
  const viewportRight = readerRect.right - 8;
  let chapter = chapters[0] || null;

  if (paged) {
    chapter = chapters.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.right >= viewportLeft && rect.left <= viewportRight;
    }) || chapter;
  } else {
    for (const candidate of chapters) {
      if (candidate.getBoundingClientRect().top <= viewportTop) chapter = candidate;
      else break;
    }
  }

  const semanticNodes = chapter
    ? [...chapter.querySelectorAll('[id], p, li, h1, h2, h3, h4, blockquote')]
    : [];
  const visibleNode = semanticNodes.find((node) => {
    const rect = node.getBoundingClientRect();
    if (paged) {
      return rect.right >= viewportLeft && rect.left <= viewportRight
        && rect.bottom >= readerRect.top && rect.top <= readerRect.bottom;
    }
    return rect.bottom >= viewportTop && normalizeTextContext(node.textContent);
  }) || null;
  const anchor = visibleNode?.id ? visibleNode : visibleNode?.closest?.('[id]');
  const scrollRange = Math.max(1, reader.scrollHeight - reader.clientHeight);
  const pageRange = Math.max(1, state.pageCount - 1);
  const percentage = paged
    ? Math.max(0, Math.min(1, (state.pageNumber - 1) / pageRange))
    : Math.max(0, Math.min(1, reader.scrollTop / scrollRange));

  return {
    version: 2,
    type: 'semantic-position',
    href: chapter?.dataset.sourcePath || '',
    anchor: anchor?.id || '',
    textBefore: normalizeTextContext(visibleNode?.textContent).slice(0, 120),
    pageNumber: paged ? state.pageNumber : null,
    scrollTop: Math.max(0, reader.scrollTop),
    percentage
  };
}

function findTextContextNode(context) {
  const needle = normalizeTextContext(context);
  if (!needle) return null;
  return [...document.querySelectorAll('#article p, #article li, #article h1, #article h2, #article h3, #article h4, #article blockquote')]
    .find((node) => normalizeTextContext(node.textContent).includes(needle));
}

function updateReadingProgress() {
  const reader = document.getElementById('reader');
  const progress = document.getElementById('readingProgress');
  if (!reader || !progress || state.contentType !== 'epub') return;

  const paged = state.effectiveReadingMode !== 'scroll';
  const percentage = paged
    ? Math.max(0, Math.min(1, (state.pageNumber - 1) / Math.max(1, state.pageCount - 1)))
    : Math.max(0, Math.min(1, reader.scrollTop / Math.max(1, reader.scrollHeight - reader.clientHeight)));
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  // In paged mode the visible window is the article's own border box (the
  // reader adds viewport insets the track never occupies); in scroll mode it
  // is the reader's vertical viewport.
  const visibleRect = paged
    ? document.getElementById('article')?.getBoundingClientRect() ?? reader.getBoundingClientRect()
    : reader.getBoundingClientRect();
  const viewportTop = visibleRect.top + 8;
  const viewportLeft = visibleRect.left + 8;
  const viewportRight = visibleRect.right - 8;
  let chapterIndex = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    const rect = chapters[index].getBoundingClientRect();
    if (paged) {
      if (rect.right >= viewportLeft && rect.left <= viewportRight) {
        chapterIndex = index;
        break;
      }
    } else if (rect.top <= viewportTop) {
      chapterIndex = index;
    } else {
      break;
    }
  }
  state.currentChapterIndex = chapterIndex;
  progress.textContent = `${Math.round(percentage * 100)}% · ${chapterIndex + 1}/${Math.max(1, chapters.length)}`;

  const previous = document.getElementById('btnPreviousChapter');
  const next = document.getElementById('btnNextChapter');
  const mobilePrevious = document.getElementById('btnMobilePreviousChapter');
  const mobileNext = document.getElementById('btnMobileNextChapter');
  const atStart = chapterIndex <= 0;
  const atEnd = chapterIndex >= chapters.length - 1;
  if (previous) previous.disabled = atStart;
  if (next) next.disabled = atEnd;
  if (mobilePrevious) mobilePrevious.disabled = atStart;
  if (mobileNext) mobileNext.disabled = atEnd;
}

function navigateChapter(delta) {
  if (state.contentType !== 'epub' || !Number.isInteger(delta) || delta === 0) return false;
  const chapters = [...document.querySelectorAll('#article .epub-chapter')];
  if (!chapters.length) return false;

  updateReadingProgress();
  const currentIndex = Math.max(0, Math.min(chapters.length - 1, state.currentChapterIndex));
  const targetIndex = currentIndex + Math.sign(delta);
  if (targetIndex < 0 || targetIndex >= chapters.length) {
    updateTopbarState();
    return false;
  }

  state.currentChapterIndex = targetIndex;
  navigateToSemanticTarget(chapters[targetIndex]);
  requestAnimationFrame(updateReadingProgress);
  return true;
}

function restoreReadingLocator(saved) {
  const reader = document.getElementById('reader');
  if (!reader || !saved) return false;

  let target = null;
  if (saved.href) {
    target = [...document.querySelectorAll('#article .epub-chapter')]
      .find((chapter) => chapter.dataset.sourcePath === saved.href) || null;
  }
  if (saved.anchor) {
    const anchored = document.getElementById(saved.anchor);
    if (anchored && (!target || target.contains(anchored))) target = anchored;
  }
  if (!target && saved.textBefore) target = findTextContextNode(saved.textBefore);

  if (state.effectiveReadingMode === 'scroll') {
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return true;
    }
    if (Number.isFinite(saved.percentage)) {
      const range = Math.max(0, reader.scrollHeight - reader.clientHeight);
      reader.scrollTop = range * Math.max(0, Math.min(1, saved.percentage));
      return true;
    }
    if (Number.isFinite(saved.scrollTop)) {
      reader.scrollTop = Math.max(0, saved.scrollTop);
      return true;
    }
    return false;
  }

  let page = Number.isFinite(saved.pageNumber) ? Math.max(1, Math.floor(saved.pageNumber)) : 1;
  if (target) {
    page = pageNumberForElement(target);
  } else if (Number.isFinite(saved.percentage)) {
    page = Math.max(1, Math.round(saved.percentage * Math.max(1, state.pageCount - 1)) + 1);
  }

  page = Math.min(state.pageCount, page);
  return setPageGroup(pageGroupForPage(page), { behavior: 'auto', save: false });
}

function restoreTextScroll() {
  const saved = savedPosition();
  if (!saved) return;
  requestAnimationFrame(() => requestAnimationFrame(() => restoreReadingLocator(saved)));
}

const saveTextScroll = debounce(() => {
  if (!state.currentPath || state.mode !== 'read') return Promise.resolve();
  const reader = document.getElementById('reader');
  if (!reader) return Promise.resolve();
  updateReadingProgress();
  return savePosition(currentReadingLocator(reader));
}, 250);

function renderPreview() {
  const preview = document.getElementById('preview');
  if (!preview) return;

  const raw = document.getElementById('editor')?.value || '';
  const html = preprocessCustomBlocks(raw);
  preview.innerHTML = html;
}

/* ============================================================
   Mode Switching
   ============================================================ */
function setMode(mode) {
  // EPUB files are read-only — never enter edit mode
  if (mode === 'edit' && state.contentType === 'epub') return;

  const prevMode = state.mode;
  state.mode = mode;

  const reader          = document.getElementById('reader');
  const editorContainer = document.getElementById('editorContainer');
  const editor          = document.getElementById('editor');

  if (mode === 'read') {
    // Flush editor content before switching — only if coming from edit mode
    if (prevMode === 'edit' && editor) {
      state.content = editor.value;
    }

    reader.style.display          = '';
    editorContainer.style.display = 'none';
    renderArticle();

  } else if (mode === 'edit') {
    reader.style.display          = 'none';
    editorContainer.style.display = 'flex';

    // Populate textarea with raw content
    editor.value = state.content;

    // Render initial preview
    renderPreview();

    // Focus editor
    editor.focus();
  }
}

/* ============================================================
   Debounce
   ============================================================ */
function debounce(fn, delay) {
  let timer = null;
  let pendingArgs = null;
  let pendingThis = null;

  const invoke = () => {
    if (!pendingArgs) return Promise.resolve();
    const args = pendingArgs;
    const context = pendingThis;
    pendingArgs = null;
    pendingThis = null;
    if (timer) clearTimeout(timer);
    timer = null;
    return Promise.resolve(fn.apply(context, args));
  };

  const debounced = function (...args) {
    pendingArgs = args;
    pendingThis = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      invoke().catch((error) => console.error('延迟任务执行失败', error));
    }, delay);
  };

  debounced.flush = invoke;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
    pendingThis = null;
  };
  debounced.pending = () => Boolean(pendingArgs);
  return debounced;
}

/* ============================================================
   Zoom
   ============================================================ */
let zoomLevel = 100; // percentage

function applyZoom() {
  document.documentElement.style.fontSize = (zoomLevel / 100 * 16) + 'px';
  document.documentElement.style.setProperty('--reader-line-height', String(state.lineHeight));
  document.documentElement.style.setProperty('--reader-page-margin', `${state.pageMargin}px`);
  document.body.dataset.highlightColor = state.highlightColor;
  applyEpubTheme();
  applyThemeToEpubFrames();
  requestAnimationFrame(() => {
    if (state.effectiveReadingMode !== 'scroll') {
      measurePagination({ preserveLocator: true });
    } else {
      redrawDomHighlights();
      updateReadingProgress();
    }
  });
}

/* P0 typography: text indent, paragraph spacing, font family */
function applyTypography() {
  document.documentElement.style.setProperty('--reader-text-indent', `${state.textIndent}em`);
  document.documentElement.style.setProperty('--reader-para-spacing', `${state.paragraphSpacing}em`);
  const stack = FONT_STACKS[state.fontFamily] || FONT_STACKS['sans'];
  document.documentElement.style.setProperty('--reader-font-family', stack);
  // Update EPUB inner frames as well
  applyEpubTheme();
  applyThemeToEpubFrames();
  // Typography changes reflow text → column count may change. In paged mode we
  // must re-measure the track; resize won't fire (article box size is fixed).
  requestAnimationFrame(() => {
    if (state.effectiveReadingMode !== 'scroll') {
      measurePagination({ preserveLocator: true });
    } else {
      redrawDomHighlights();
      updateReadingProgress();
    }
  });
}

/* ============================================================
   File Operations — Browser Fallback
   ============================================================ */
function openFileBrowser() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.md,.txt,.epub,text/markdown,text/plain,application/epub+zip';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const isEpub = /\.epub$/i.test(file.name);
      const result = ev.target.result || '';
      window.appHost.receiveDocument({
        path: file.name,
        name: file.name,
        type: isEpub ? 'epub' : 'text',
        content: isEpub ? '' : result,
        data: isEpub ? String(result).split(',')[1] : undefined
      });
    };

    if (/\.epub$/i.test(file.name)) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  };

  input.click();
}

function saveFileBrowser() {
  const blob = new Blob([state.content || ''], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = state.currentName || 'document.md';
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   Highlight Export & Auto-save
   ============================================================ */
function formatHighlightsMd(highlights) {
  const bookName = (state.currentName || '未知书籍').replace(/\.epub$/i, '');
  const author = state.epubMetadata?.creator || '';

  let md = `# 《${bookName}》划线笔记\n\n`;
  if (author) md += `作者：${author}\n\n`;
  md += `---\n\n`;

  for (const h of highlights) {
    if (h.text) {
      md += h.date ? `- [${h.date}] ${h.text}\n\n` : `- ${h.text}\n\n`;
    }
  }
  return md;
}

function serializeHighlightForServer(highlight) {
  const domRange = highlight.domRange || highlight.locatorData || null;
  const locator = highlight.cfi || (domRange ? JSON.stringify({
    version: 1,
    type: 'dom-range',
    ...domRange
  }) : String(highlight.locator || highlight.id || ''));

  return {
    id: highlight.id || highlight.cfi || highlightId(),
    locator,
    chapterHref: normalizeChapterHref(highlight.chapterHref || domRange?.chapterHref || ''),
    text: selectedTextSignature(highlight.text),
    contextBefore: String(highlight.contextBefore || domRange?.contextBefore || '').slice(-240),
    contextAfter: String(highlight.contextAfter || domRange?.contextAfter || '').slice(0, 240),
    note: String(highlight.note || '').slice(0, 4000),
    color: ['yellow', 'green', 'blue', 'pink'].includes(highlight.color)
      ? highlight.color
      : state.highlightColor,
    createdAt: highlight.createdAt || highlight.date || new Date().toISOString()
  };
}

function queueHighlightSave() {
  if (!state.currentBookId || state.contentType !== 'epub') return Promise.resolve();

  const bookId = state.currentBookId;
  const revision = ++_highlightSaveRevision;
  const highlights = loadHighlights().map(serializeHighlightForServer);
  _highlightSaveChain = _highlightSaveChain.catch(() => {}).then(async () => {
    // Persist the captured book snapshot even if navigation switched books or
    // returned to the library while this serialized write was pending.
    await window.browserHost.saveHighlights(highlights, bookId);
    if (revision === _highlightSaveRevision) showHighlightHint('划线已保存');
  }).catch((error) => {
    console.error('保存划线失败', { bookId, revision, error });
    showHighlightHint(`划线保存失败：${error.message || '未知错误'}`);
    throw error;
  });
  return _highlightSaveChain;
}

function autoSaveHighlights() {
  return queueHighlightSave();
}

async function flushPendingHighlightSaves() {
  try {
    await _highlightSaveChain;
  } catch {
    throw new Error('仍有划线未能保存，请检查网络后重试');
  }
}

function exportHighlights() {
  if (state.contentType !== 'epub') return;
  const highlights = loadHighlights();
  if (!highlights.length) {
    showHighlightHint('还没有 EPUB 划线');
    return;
  }

  const md = formatHighlightsMd(highlights);

  const showCopied = () => {
    flashFileName(`已导出 ${highlights.length} 条划线`, 2600);
  };

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = highlightFileName();
  a.click();
  URL.revokeObjectURL(url);
  navigator.clipboard?.writeText?.(md).catch(() => {});
  showCopied();
}

function flashFileName(message, duration = 1600) {
  const fileNameEl = document.getElementById('fileName');
  if (!fileNameEl) return;

  const wasHidden = getComputedStyle(fileNameEl).display === 'none';
  const prev = fileNameEl.dataset.flashPrev ?? fileNameEl.textContent;
  fileNameEl.dataset.flashPrev = prev;
  clearTimeout(_fileNameFlashTimeout);

  if (wasHidden) fileNameEl.style.display = 'block';
  fileNameEl.textContent = message;
  fileNameEl.style.color = 'var(--accent)';
  _fileNameFlashTimeout = setTimeout(() => {
    fileNameEl.textContent = fileNameEl.dataset.flashPrev || '';
    fileNameEl.style.color = '';
    if (wasHidden) fileNameEl.style.display = '';
    delete fileNameEl.dataset.flashPrev;
  }, duration);
}

function showHighlightHint(message) {
  flashFileName(message, 1600);
}

/* ============================================================
   Keyboard Shortcuts
   ============================================================ */
function isShortcutModifierDown(e) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  return isMac ? e.metaKey : e.ctrlKey;
}

function handleKeyboardShortcut(e) {
  if (!isShortcutModifierDown(e)) return false;

  switch (e.key.toLowerCase()) {
    case 'o':
      e.preventDefault();
      window.browserHost.getLibrary()
        .then(renderLibrary)
        .catch((error) => showHighlightHint(error.message));
      return true;

    case 's':
      e.preventDefault();
      if (state.mode === 'edit') {
        const editor = document.getElementById('editor');
        if (editor) state.content = editor.value;
      }
      saveFileBrowser();
      return true;

    case '=':
    case '+':
      e.preventDefault();
      zoomLevel = Math.min(200, zoomLevel + 10);
      applyZoom();
      return true;

    case '-':
      e.preventDefault();
      zoomLevel = Math.max(60, zoomLevel - 10);
      applyZoom();
      return true;

    case '0':
      e.preventDefault();
      zoomLevel = 100;
      applyZoom();
      return true;

    case 'h':
      if (state.contentType === 'epub') {
        e.preventDefault();
        if (!runPendingHighlight() && !highlightCurrentDomSelection()) {
          showHighlightHint('先选中一段 EPUB 文本');
        }
        return true;
      }
      return false;

    case 'e':
      if (e.shiftKey && state.contentType === 'epub') {
        e.preventDefault();
        exportHighlights();
        return true;
      }
      if (!e.shiftKey && state.contentType !== 'epub') {
        e.preventDefault();
        setMode(state.mode === 'read' ? 'edit' : 'read');
        return true;
      }
      return false;

    default:
      return false;
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', handleKeyboardShortcut);
}

function setupEpubContentKeyboard(contents) {
  const doc = contents?.document;
  if (!doc || doc._babyreaderShortcutsBound) return;
  doc._babyreaderShortcutsBound = true;
  doc.addEventListener('keydown', handleKeyboardShortcut, true);
}

function setupEpubContentSelection(contents) {
  const doc = contents?.document;
  const win = contents?.window;
  if (!doc || !win || doc._babyreaderSelectionBound) return;
  doc._babyreaderSelectionBound = true;

  const readSelection = () => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    let range;
    let cfiRange;
    try {
      range = sel.getRangeAt(0);
      if (typeof contents.cfiFromRange === 'function') {
        cfiRange = contents.cfiFromRange(range);
      } else if (typeof contents.section?.cfiFromRange === 'function') {
        cfiRange = contents.section.cfiFromRange(range);
      } else if (state.epubBook?.cfiFromRange) {
        cfiRange = state.epubBook.cfiFromRange(range);
      }
    } catch {
      return;
    }

    if (!cfiRange) return;
    setPendingHighlight(cfiRange, contents, range, sel.toString());
  };

  doc.addEventListener('mouseup', () => setTimeout(readSelection, 0));
  doc.addEventListener('keyup', () => setTimeout(readSelection, 0));
  doc.addEventListener('touchend', () => setTimeout(readSelection, 120));
  doc.addEventListener('selectionchange', () => setTimeout(readSelection, 0));
}

function findChapterBySourcePath(sourcePath) {
  if (!sourcePath) return null;
  let normalized;
  try {
    normalized = normalizeZipPath(sourcePath);
  } catch {
    return null;
  }
  return [...document.querySelectorAll('#article .epub-chapter')]
    .find((chapter) => chapter.dataset.sourcePath === normalized) || null;
}

function describeEpubNavigationFailure(target, sourceChapter = null) {
  const source = sourceChapter?.dataset.sourcePath || '目录';
  return `无法跳转：${String(target || '(空链接)')}（来源：${source}）`;
}

function setCurrentTocTarget(target) {
  document.querySelectorAll('.toc a[data-target]').forEach((link) => {
    const current = link.getAttribute('data-target') === target;
    link.classList.toggle('current', current);
    if (current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function navigateEpubTarget(target, sourceChapter = null) {
  if (!target || state.contentType !== 'epub') return false;

  const split = splitHref(target);
  let chapter = sourceChapter;
  if (split.path) {
    try {
      const baseDir = getDirPath(sourceChapter?.dataset.sourcePath || '');
      chapter = findChapterBySourcePath(resolveZipPath(baseDir, split.path));
    } catch (error) {
      console.warn('EPUB 内部链接路径无效', { target, source: sourceChapter?.dataset.sourcePath || '', error });
      return false;
    }
  }

  let node = chapter;
  if (split.fragment) {
    const fragment = decodeEpubPath(split.fragment);
    const anchored = chapter
      ? [...chapter.querySelectorAll('[id]')].find((candidate) => candidate.id === fragment)
      : document.getElementById(fragment);
    if (!anchored) {
      console.warn('EPUB 锚点不存在', { target, fragment, chapter: chapter?.dataset.sourcePath || '' });
      return false;
    }
    node = anchored;
  }
  if (!node) {
    console.warn('EPUB 章节不存在', { target, source: sourceChapter?.dataset.sourcePath || '' });
    return false;
  }

  navigateToSemanticTarget(node);
  setCurrentTocTarget(target);
  requestAnimationFrame(updateReadingProgress);
  return true;
}

function setupTocNavigation() {
  document.addEventListener('click', (e) => {
    const tocLink = e.target.closest?.('.toc a[data-target]');
    if (tocLink) {
      e.preventDefault();
      e.stopPropagation();
      const target = tocLink.getAttribute('data-target');
      if (!navigateEpubTarget(target)) {
        showHighlightHint(describeEpubNavigationFailure(target));
      }
      return;
    }

    const internalLink = e.target.closest?.('#article a[data-epub-href]');
    if (!internalLink || state.contentType !== 'epub') return;
    e.preventDefault();
    e.stopPropagation();
    const sourceChapter = internalLink.closest('.epub-chapter');
    const target = internalLink.getAttribute('data-epub-href');
    if (!navigateEpubTarget(target, sourceChapter)) {
      showHighlightHint(describeEpubNavigationFailure(target, sourceChapter));
    }
  });
}

function syncSettingsPanel() {
  const theme = document.getElementById('settingTheme');
  const fontSize = document.getElementById('settingFontSize');
  const fontSizeValue = document.getElementById('settingFontSizeValue');
  const lineHeight = document.getElementById('settingLineHeight');
  const lineHeightValue = document.getElementById('settingLineHeightValue');
  const pageMargin = document.getElementById('settingPageMargin');
  const pageMarginValue = document.getElementById('settingPageMarginValue');
  const highlightColor = document.getElementById('settingHighlightColor');
  const readingMode = document.getElementById('settingReadingMode');
  const tocOpen = document.getElementById('settingTocOpen');
  const fontFamily = document.getElementById('settingFontFamily');
  const textIndent = document.getElementById('settingTextIndent');
  const textIndentValue = document.getElementById('settingTextIndentValue');
  const paragraphSpacing = document.getElementById('settingParagraphSpacing');
  const paragraphSpacingValue = document.getElementById('settingParagraphSpacingValue');
  const settingsUser = document.getElementById('settingsUser');

  if (theme) theme.value = state.theme;
  if (fontSize) fontSize.value = String(zoomLevel);
  if (fontSizeValue) fontSizeValue.textContent = `${zoomLevel}%`;
  if (lineHeight) lineHeight.value = String(state.lineHeight);
  if (lineHeightValue) lineHeightValue.textContent = state.lineHeight.toFixed(1);
  if (pageMargin) pageMargin.value = String(state.pageMargin);
  if (pageMarginValue) pageMarginValue.textContent = `${state.pageMargin}px`;
  if (highlightColor) highlightColor.value = state.highlightColor;
  if (readingMode) readingMode.value = state.readingMode;
  if (fontFamily) fontFamily.value = state.fontFamily;
  if (textIndent) textIndent.value = String(state.textIndent);
  if (textIndentValue) textIndentValue.textContent = state.textIndent === 0 ? '无' : `${state.textIndent} 字`;
  if (paragraphSpacing) paragraphSpacing.value = String(state.paragraphSpacing);
  if (paragraphSpacingValue) paragraphSpacingValue.textContent = `${state.paragraphSpacing.toFixed(1)} em`;
  if (tocOpen) tocOpen.checked = state.tocOpen;
  if (settingsUser) {
    settingsUser.textContent = state.session
      ? `当前用户：${state.session.username || state.session.uid}`
      : '';
  }
}

const DOUBLE_PAGE_MIN_WIDTH = 900;
// Centre seam. WeChat Reading web measures 98px between the two text columns
// at 1440x900 (column 457px, card padding 70px each side).
const DEFAULT_PAGE_GAP = 98;
const MIN_PAGE_WIDTH = 240;
// Body text must stop short of the floating toolbar. Folded into the right
// inset so the multicol track never runs underneath it.
const READER_TOOLBAR_RESERVE = 78;
// Paper card width, measured from WeChat Reading web across six viewports:
// card = min(0.8 x viewport, viewport - 220) -- 1280->1024, 1440->1152,
// 1600->1280, 1920->1536, 1100->876, 900->676. Our own ceiling keeps ultra
// wide lines from creeping back in.
const PAPER_WIDTH_RATIO = 0.9;
const PAPER_MIN_SIDE_GAP = 128;
// Expand the reading surface while preserving symmetric margins and comfortable
// line length. 1440px viewport the double-page card becomes 1296px wide.
const MAX_PAPER_WIDTH = { single: 700, double: 1344 };
// Symmetric outer margin for the paper card when the tool band isn't needed.
const MIN_OUTER_MARGIN = 40;
// Toolbar clearance on desktop (above mobile breakpoint).
const TOOLBAR_BAND = 40;
// Larger effective reading area: reduce the outer bands and internal vertical
// padding while keeping enough breathing room around chapter headings.
const READER_TOP_BAND = 56;
const READER_BOTTOM_BREATH = 40;
const PAPER_PAD_TOP = 64;
const PAPER_PAD_BOTTOM = 56;
// Hard floor so a short window still shows a usable column.
const MIN_VERTICAL_PADDING = 40;

function pageStep() {
  return state.effectiveReadingMode === 'double' ? 2 : 1;
}

function readingAreaWidth(reader = document.getElementById('reader')) {
  if (!reader) return 0;
  return Math.max(0, Math.floor(Number(reader.clientWidth) || 0));
}

function floorToDevicePixel(value, devicePixelRatio = window.devicePixelRatio || 1) {
  const scale = Math.max(1, Number(devicePixelRatio) || 1);
  return Math.floor(Math.max(0, value) * scale) / scale;
}

function createPaginationGeometry({
  readerWidth,
  readerHeight,
  mode,
  pageMargin = state.pageMargin,
  columnGap = DEFAULT_PAGE_GAP,
  devicePixelRatio = window.devicePixelRatio || 1
}) {
  // Insets live on the reader viewport (CSS), never on the multicol box:
  // padding on a multicol container applies once to the whole flow, which
  // shifts every column start and breaks spread alignment.
  const columns = mode === 'double' ? 2 : 1;
  const viewportWidth = Math.max(1, Math.floor(Number(readerWidth) || 0));
  const viewportHeight = Math.max(1, Math.floor(Number(readerHeight) || 0));
  const requestedMargin = Math.max(0, Number(pageMargin) || 0);
  const mobile = viewportWidth <= 800;
  // Inner text inset of the card. The user's margin slider (8..96, default 40)
  // maps onto the measured WeChat inset of 70px, so the default setting lands
  // on the baseline look and the slider still moves both ways.
  const columnPadding = mobile
    ? Math.max(16, Math.min(32, Math.round(requestedMargin * 0.8)))
    : Math.max(24, Math.min(96, Math.round(requestedMargin * 1.75)));
  // The gap between consecutive columns doubles as the paper's trailing inset:
  // column k+1 starts at padding + columns*(cw+gap). It must clear the paper's
  // right edge (2*padding + columns*cw + (columns-1)*gap), i.e. gap >= padding.
  // Single-page mode therefore requires gap >= padding as well — it's
  // invisible (only one column per view), but it prevents column 2 from
  // leaking into column 1's right margin.
  const naturalGap = columns === 2
    ? Math.max(columnPadding, Math.max(0, Number(columnGap) || DEFAULT_PAGE_GAP))
    : Math.max(columnPadding, 48);
  const gap = floorToDevicePixel(naturalGap, devicePixelRatio);
  const readableMin = columns * MIN_PAGE_WIDTH + gap * (columns - 1) + columnPadding * 2;
  // The floating toolbar only exists above the mobile breakpoint; below it the
  // controls move to the bottom bar and no right-edge clearance is needed.
  const toolbarClearance = viewportWidth > 800 ? TOOLBAR_BAND : MIN_OUTER_MARGIN;
  // Measured WeChat card width: 80% of the window, never closer than 110px to
  // either edge. Our own ceiling still applies on ultra-wide windows.
  const wechatPaper = Math.min(viewportWidth * PAPER_WIDTH_RATIO, viewportWidth - PAPER_MIN_SIDE_GAP);
  const paperCap = Math.min(MAX_PAPER_WIDTH[mode] || MAX_PAPER_WIDTH.single, wechatPaper);
  const desiredPaper = Math.max(
    Math.min(readableMin, viewportWidth - 2 * MIN_OUTER_MARGIN),
    Math.min(viewportWidth - 2 * MIN_OUTER_MARGIN, paperCap)
  );
  const paperWidth = Math.max(1, Math.min(desiredPaper, viewportWidth - 2 * toolbarClearance));
  // Perfectly symmetric margins: the paper is centred in the window, which is
  // what gives the page its WeChat-reading proportions.
  const inset = Math.max(0, Math.floor((viewportWidth - paperWidth) / 2));
  const insetLeftFinal = inset;
  const insetRightFinal = inset;
  const textWidth = Math.max(1, viewportWidth - inset * 2);
  // The content box is the paper card minus left/right padding (columnPadding).
  // With gap >= columnPadding, column 1 starts at position >= paperWidth, so it
  // never leaks into column 0's right margin.
  const contentWidth = Math.max(1, paperWidth - columnPadding * 2);
  const columnWidth = Math.max(1, floorToDevicePixel((contentWidth - gap * (columns - 1)) / columns, devicePixelRatio));
  // One spread of continuous columns. The next page group starts exactly at
  // spreadWidth + gap, so stepping by pageStepWidth * columns is guaranteed
  // to be column-aligned forever.
  const spreadWidth = columnWidth * columns + gap * (columns - 1);
  // Vertical rhythm from the baseline: a 72px band above the card, a 58px
  // breath below it, then 84px / 70px of air inside the card. Both shrink on
  // short windows instead of squeezing the column to nothing.
  const bandTop = viewportHeight >= 560 ? READER_TOP_BAND : Math.round(viewportHeight * 0.08);
  const bandBottom = viewportHeight >= 560 ? READER_BOTTOM_BREATH : Math.round(viewportHeight * 0.07);
  const cardHeight = Math.max(200, viewportHeight - bandTop - bandBottom);
  const blockBudget = Math.max(0, cardHeight - 240);
  const padTop = Math.max(MIN_VERTICAL_PADDING, Math.min(PAPER_PAD_TOP, Math.round(blockBudget * 0.52)));
  const padBottom = Math.max(MIN_VERTICAL_PADDING, Math.min(PAPER_PAD_BOTTOM, Math.round(blockBudget * 0.44)));
  const verticalPadding = padTop;
  const pageHeight = Math.max(1, floorToDevicePixel(cardHeight - padTop - padBottom, devicePixelRatio));

  // Advance for one full page group. NEVER use viewportWidth here: the
  // multicol container is exactly spreadWidth wide (no padding), so the
  // browser places every new column on a k*(columnWidth + gap) grid.
  const pageGroupWidth = columnWidth * columns + gap * columns;

  return Object.freeze({
    columns,
    viewportWidth,
    viewportHeight,
    paperWidth: spreadWidth + columnPadding * 2,
    columnPadding,
    verticalPadding,
    padTop,
    padBottom,
    bandTop,
    bandBottom,
    insetLeft: insetLeftFinal,
    insetRight: insetRightFinal,
    columnGap: gap,
    columnWidth,
    spreadWidth,
    pageStepWidth: columnWidth + gap,
    pageGroupWidth,
    pageHeight,
    trailingSafety: Math.max(0, textWidth - spreadWidth)
  });
}

function paginationInsetStyle(reader, geometry) {
  // The insets belong to the reader viewport, so the custom properties must
  // be declared on (or above) the reader — custom properties inherit
  // downwards only.
  reader.style.setProperty('--reader-inset-left', `${geometry.insetLeft}px`);
  reader.style.setProperty('--reader-inset-right', `${geometry.insetRight}px`);
}

function resolveEffectiveReadingMode(width = readingAreaWidth()) {
  if (state.readingMode !== 'double') return state.readingMode;
  return width >= DOUBLE_PAGE_MIN_WIDTH ? 'double' : 'single';
}

function pageGroupForPage(pageNumber, step = pageStep()) {
  const normalizedPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
  return Math.floor((normalizedPage - 1) / Math.max(1, step));
}

function clampPageGroup(group) {
  return Math.max(0, Math.min(Math.max(0, state.pageGroupCount - 1), Math.round(Number(group) || 0)));
}

function pageLeftForGroup(group, pageGroupWidth = state.pageGroupWidth) {
  const step = Math.max(1, Number(pageGroupWidth) || 1);
  return clampPageGroup(group) * step;
}

function applyPagedOffset(article, left) {
  // Instant positioning only. Smooth scrolling inside heavy EPUB DOM (or a
  // slow fnOS iframe) is exactly where a page turn "looks" dead: buttons
  // update and the animation never visibly lands. WeChat-reading-like paging
  // here is quantized and immediate.
  // ScrollLeft ONLY: the article is now the centred paper card, so a
  // translateX fallback would slide the whole card off-centre. scrollLeft on
  // an overflow:hidden multicol box is verified working in the target browser.
  state.pageOffset = left;
  article.scrollLeft = left;
}

function pagedLogicalLeft(article, target) {
  const articleRect = article.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const delta = targetRect.left - articleRect.left;
  // The article border box is stable and children shift by scrollLeft, so the
  // offset must be added back to get the absolute track position.
  return state.pageOffset + delta;
}

function setPageGroup(group, { behavior = 'auto', save = false } = {}) {
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  if (!reader || !article || state.effectiveReadingMode === 'scroll') return false;

  const nextGroup = clampPageGroup(group);
  const left = pageLeftForGroup(nextGroup);
  state.pageGroup = nextGroup;
  state.pageNumber = Math.min(state.pageCount, nextGroup * pageStep() + 1);
  applyPagedOffset(article, left);
  reader.scrollLeft = 0;
  reader.scrollTop = 0;
  updatePaginationControls();
  if (save) saveTextScroll();
  requestAnimationFrame(redrawDomHighlights);

  // Self-heal: never needed — scrollLeft on the article card works reliably.
  return true;
}

function snapPaginationToNearestGroup({ save = true } = {}) {
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  if (!reader || !article || state.effectiveReadingMode === 'scroll') return false;
  const step = Math.max(1, state.pageGroupWidth || reader.clientWidth || 1);
  return setPageGroup(Math.round(state.pageOffset / step), { behavior: 'auto', save });
}

function pageNumberForElement(target) {
  const article = document.getElementById('article');
  if (!article || !target) return 1;
  const step = Math.max(1, state.pageStepWidth || state.columnWidth + state.columnGap || 1);
  const articleRect = article.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  // The article box is stable while its children shift left by the page
  // offset, so the absolute track position is offset + rect delta.
  const logicalLeft = pagedLogicalLeft(article, target);
  return Math.max(1, Math.min(state.pageCount, Math.floor((logicalLeft + 0.01) / step) + 1));
}

function navigateToSemanticTarget(target, { behavior = 'auto' } = {}) {
  if (!target) return false;
  if (state.effectiveReadingMode === 'scroll') {
    target.scrollIntoView({ block: 'start', behavior });
    return true;
  }
  return setPageGroup(pageGroupForPage(pageNumberForElement(target)), { behavior, save: true });
}

function updatePaginationControls() {
  const paged = state.effectiveReadingMode !== 'scroll';
  const previous = document.getElementById('btnPreviousPage');
  const next = document.getElementById('btnNextPage');
  const status = document.getElementById('paginationStatus');
  const mobilePrevious = document.getElementById('btnMobilePreviousPage');
  const mobileNext = document.getElementById('btnMobileNextPage');
  const atStart = state.pageGroup <= 0;
  const atEnd = state.pageGroup >= Math.max(0, state.pageGroupCount - 1);

  if (previous) {
    previous.hidden = !paged || state.contentType !== 'epub';
    previous.disabled = atStart;
  }
  if (next) {
    next.hidden = !paged || state.contentType !== 'epub';
    next.disabled = atEnd;
  }
  if (mobilePrevious) mobilePrevious.disabled = !paged || atStart;
  if (mobileNext) mobileNext.disabled = !paged || atEnd;
  if (status) {
    status.hidden = !paged || state.contentType !== 'epub';
    status.textContent = paged
      ? `${state.pageNumber}-${Math.min(state.pageCount, state.pageNumber + pageStep() - 1)} / ${state.pageCount}`
      : '';
  }
}

function measureColumnTrackWidth(article, geometry) {
  const columnPitch = Math.max(1, geometry.columnWidth + geometry.columnGap);
  let track = geometry.spreadWidth;
  // 1) Layout-derived ground truth: where the last chapter actually ends in
  //    the column track. It is available as soon as chapters are laid out and
  //    does not race the multicol overflow becoming measurable.
  const chapters = article.querySelectorAll('.epub-chapter');
  const last = chapters[chapters.length - 1];
  if (last) {
    const articleRect = article.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const extent = lastRect.right - articleRect.left;
    if (Number.isFinite(extent) && extent > 0) track = Math.max(track, extent);
  }
  // 2) The multicol box is its own scroll container, so scrollWidth covers the
  //    whole track too; take the larger of the two.
  if (Number.isFinite(article.scrollWidth) && article.scrollWidth > 0) {
    track = Math.max(track, article.scrollWidth);
  }
  const totalColumns = Math.max(geometry.columns, Math.round((track + geometry.columnGap) / columnPitch));
  return { track, totalColumns };
}

function measurePagination({ preserveLocator = true } = {}) {
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  if (!reader || !article) return;

  const locator = preserveLocator && state.currentPath && state.contentType === 'epub'
    ? currentReadingLocator(reader)
    : null;
  state.effectiveReadingMode = resolveEffectiveReadingMode(readingAreaWidth(reader));
  state.continuousScroll = state.readingMode === 'scroll';

  document.body.dataset.readingMode = state.readingMode;
  document.body.dataset.effectiveReadingMode = state.effectiveReadingMode;
  document.body.classList.toggle('continuous-scroll', state.effectiveReadingMode === 'scroll');
  document.body.classList.toggle('paged-reading', state.effectiveReadingMode !== 'scroll');
  document.body.classList.toggle('single-page-reading', state.effectiveReadingMode === 'single');
  document.body.classList.toggle('double-page-reading', state.effectiveReadingMode === 'double');

  if (state.effectiveReadingMode === 'scroll') {
    for (const property of [
      '--reader-column-count',
      '--reader-column-width',
      '--reader-column-gap',
      '--reader-page-height',
      '--reader-horizontal-padding',
      '--reader-vertical-padding',
      '--reader-spread-width'
    ]) article.style.removeProperty(property);
    for (const property of ['--reader-inset-left', '--reader-inset-right']) {
      reader.style.removeProperty(property);
    }
    delete article.dataset.paginationGeometry;
    delete article.dataset.paginationStep;
    article.style.removeProperty('transform');
    state.pageOffset = 0;
    reader.scrollLeft = 0;
    article.scrollLeft = 0;
    state.columnWidth = 0;
    state.columnGap = 0;
    state.pageStepWidth = 0;
    state.pageGroupWidth = 0;
    state.pageHeight = 0;
    state.paginationGeometry = null;
    state.pageNumber = 1;
    state.pageCount = 1;
    state.pageGroup = 0;
    state.pageGroupCount = 1;
    updatePaginationControls();
    if (locator) restoreReadingLocator(locator);
    requestAnimationFrame(redrawDomHighlights);
    return;
  }

  const geometry = createPaginationGeometry({
    readerWidth: reader.clientWidth,
    readerHeight: reader.clientHeight,
    mode: state.effectiveReadingMode,
    pageMargin: state.pageMargin,
    columnGap: DEFAULT_PAGE_GAP,
    devicePixelRatio: window.devicePixelRatio || 1
  });
  state.paginationGeometry = geometry;
  state.columnWidth = geometry.columnWidth;
  state.columnGap = geometry.columnGap;
  state.pageStepWidth = geometry.pageStepWidth;
  state.pageGroupWidth = geometry.pageGroupWidth;
  state.pageHeight = geometry.pageHeight;

  article.style.setProperty('--reader-column-count', String(geometry.columns));
  article.style.setProperty('--reader-column-width', `${geometry.columnWidth}px`);
  article.style.setProperty('--reader-column-gap', `${geometry.columnGap}px`);
  article.style.setProperty('--reader-page-height', `${geometry.pageHeight}px`);
  // Card geometry: the article box is the paper, its inline padding is the
  // text inset, and --reader-spread-width stays the pure column track so the
  // alignment invariants (and tests) keep a single source of truth.
  article.style.setProperty('--reader-spread-width', `${geometry.spreadWidth}px`);
  article.style.setProperty('--reader-paper-width', `${geometry.paperWidth}px`);
  article.style.setProperty('--reader-paper-padding', `${geometry.columnPadding}px`);
  article.style.setProperty('--reader-paper-padding-top', `${geometry.padTop}px`);
  article.style.setProperty('--reader-paper-padding-bottom', `${geometry.padBottom}px`);
  paginationInsetStyle(reader, geometry);
  // Vertical bands live on the reader to give the fixed breathing above/below
  // the card, matching the measured baseline (72/58).
  reader.style.setProperty('--reader-band-top', `${geometry.bandTop}px`);
  reader.style.setProperty('--reader-band-bottom', `${geometry.bandBottom}px`);
  // Live-geometry diagnostics: mirror the numbers the layout was computed
  // from so fnOS field screenshots (or a pasted data-* dump) pin down any
  // remaining viewport vs columnWidth mismatch without guessing.
  article.dataset.paginationGeometry =
    `mode=${state.effectiveReadingMode};vw=${geometry.viewportWidth};` +
    `cols=${geometry.columns};col=${geometry.columnWidth};gap=${geometry.columnGap};` +
    `spread=${geometry.spreadWidth};step=${geometry.pageStepWidth};` +
    `group=${geometry.pageGroupWidth};inset=${geometry.insetLeft}/${geometry.insetRight}`;
  article.dataset.paginationStep = String(geometry.pageGroupWidth);

  // The multicol track only exists after the browser has fragmented the
  // content, which can land a frame or two after the classes are applied.
  // Reading it once, too early, froze pageCount at 1: the page buttons then
  // stayed hidden/disabled and every page turn silently returned false.
  // Converge here, and never depend on a single rAF: rAF is throttled in a
  // background tab, so a timer backs it up.
  let settleAttempts = 0;
  let lastColumns = -1;
  const finalizePagination = () => {
    if (locator) restoreReadingLocator(locator);
    state.pageGroup = Math.max(0, Math.min(state.pageGroupCount - 1, pageGroupForPage(state.pageNumber)));
    state.pageNumber = Math.min(state.pageCount, state.pageGroup * geometry.columns + 1);
    applyPagedOffset(article, pageLeftForGroup(state.pageGroup, geometry.pageGroupWidth));
    reader.scrollLeft = 0;
    reader.scrollTop = 0;
    updatePaginationControls();
    redrawDomHighlights();
  };
  const settlePagination = () => {
    if (state.effectiveReadingMode === 'scroll') return;
    const { track, totalColumns } = measureColumnTrackWidth(article, geometry);
    state.pageCount = totalColumns;
    state.pageGroupCount = Math.max(1, Math.ceil(totalColumns / geometry.columns));
    article.dataset.paginationTrack = `w=${Math.round(track)};cols=${totalColumns};groups=${state.pageGroupCount}`;
    settleAttempts += 1;
    if (totalColumns !== lastColumns && settleAttempts < 6) {
      lastColumns = totalColumns;
      let done = false;
      const once = () => { if (done) return; done = true; settlePagination(); };
      requestAnimationFrame(once);
      setTimeout(once, 60);
      return;
    }
    finalizePagination();
  };
  observePaginationSettle(settlePagination);
  settlePagination();
}

// One observer for the life of the page: late web fonts, images and window
// resizes all change the column track, and the page count has to follow.
let _paginationSettleObserver = null;
let _paginationSettleHandler = null;
function observePaginationSettle(handler) {
  _paginationSettleHandler = handler;
  const article = document.getElementById('article');
  if (!article || typeof ResizeObserver !== 'function' || _paginationSettleObserver) return;
  _paginationSettleObserver = new ResizeObserver(() => {
    if (state.effectiveReadingMode === 'scroll') return;
    const article = document.getElementById('article');
    if (!article) return;
    const recorded = Number((article.dataset.paginationTrack || '').match(/cols=(\d+)/)?.[1] || 0);
    const geometry = state.paginationGeometry;
    if (!geometry) return;
    const { totalColumns } = measureColumnTrackWidth(article, geometry);
    if (totalColumns !== recorded) _paginationSettleHandler?.();
  });
  _paginationSettleObserver.observe(article);
}

function setReadingMode(mode, { persist = true, preserveLocator = true } = {}) {
  // Only two user-selectable modes: scroll and double. (single is responsive fallback)
  if (!['scroll', 'double', 'single'].includes(mode)) return false;
  state.readingMode = mode === 'single' ? 'double' : mode;
  state.continuousScroll = state.readingMode === 'scroll';
  measurePagination({ preserveLocator });
  syncSettingsPanel();
  if (persist) persistUserSettings();
  return true;
}

function navigatePageGroup(delta) {
  if (state.effectiveReadingMode === 'scroll' || !Number.isInteger(delta) || delta === 0) return false;
  const target = state.pageGroup + Math.sign(delta);
  if (target < 0 || target >= state.pageGroupCount) return false;
  return setPageGroup(target, { save: true });
}

function applyContinuousScroll() {
  const migratedMode = state.continuousScroll ? 'scroll' : 'double';
  if (!['scroll', 'double'].includes(state.readingMode)) state.readingMode = migratedMode;
  measurePagination({ preserveLocator: false });
}

function setupThemeToggle() {
  applyTheme(state.theme, false);
}

function setupTocToggle() {
  // The legacy btnToc ID is retained, while activation is delegated through readerActions.
}

function setupSettingsPanel() {
  const theme = document.getElementById('settingTheme');
  const fontSize = document.getElementById('settingFontSize');
  const lineHeight = document.getElementById('settingLineHeight');
  const pageMargin = document.getElementById('settingPageMargin');
  const highlightColor = document.getElementById('settingHighlightColor');
  const readingMode = document.getElementById('settingReadingMode');
  const tocOpen = document.getElementById('settingTocOpen');
  const fontFamily = document.getElementById('settingFontFamily');
  const textIndent = document.getElementById('settingTextIndent');
  const paragraphSpacing = document.getElementById('settingParagraphSpacing');
  theme?.addEventListener('change', () => {
    applyTheme(theme.value, false);
    syncSettingsPanel();
    persistUserSettings();
  });
  fontSize?.addEventListener('input', () => {
    zoomLevel = Math.max(60, Math.min(200, Number(fontSize.value) || 100));
    applyZoom();
    syncSettingsPanel();
    persistUserSettings();
  });
  lineHeight?.addEventListener('input', () => {
    state.lineHeight = Math.max(1.2, Math.min(2.6, Number(lineHeight.value) || 1.9));
    applyZoom();
    syncSettingsPanel();
    persistUserSettings();
  });
  pageMargin?.addEventListener('input', () => {
    state.pageMargin = Math.max(8, Math.min(96, Number(pageMargin.value) || 40));
    applyZoom();
    syncSettingsPanel();
    persistUserSettings();
  });
  highlightColor?.addEventListener('change', () => {
    state.highlightColor = ['yellow', 'green', 'blue', 'pink'].includes(highlightColor.value)
      ? highlightColor.value
      : 'yellow';
    applyZoom();
    redrawDomHighlights();
    persistUserSettings();
  });
  readingMode?.addEventListener('change', () => {
    setReadingMode(readingMode.value);
  });
  tocOpen?.addEventListener('change', () => {
    state.tocOpen = tocOpen.checked;
    updateTopbarState();
    persistUserSettings();
  });
  // P0 typography controls
  fontFamily?.addEventListener('change', () => {
    state.fontFamily = FONT_STACKS[fontFamily.value] ? fontFamily.value : 'sans';
    applyTypography();
    syncSettingsPanel();
    persistUserSettings();
  });
  textIndent?.addEventListener('input', () => {
    state.textIndent = Math.max(0, Math.min(4, Number(textIndent.value) || 2));
    applyTypography();
    syncSettingsPanel();
    persistUserSettings();
  });
  paragraphSpacing?.addEventListener('input', () => {
    state.paragraphSpacing = Math.max(0.4, Math.min(3, Number(paragraphSpacing.value) || 1.1));
    applyTypography();
    syncSettingsPanel();
    persistUserSettings();
  });

  syncSettingsPanel();
  applyContinuousScroll();
}

const readerPanels = Object.freeze({
  toc: {
    id: 'readerPanelToc',
    title: '目录',
    enabled: () => state.contentType === 'epub' && state.toc.length > 0
  },
  settings: {
    id: 'readerPanelSettings',
    title: '显示设置',
    enabled: () => true
  },
  search: {
    id: 'readerPanelSearch',
    title: '搜索',
    enabled: () => false
  },
  bookmarks: {
    id: 'readerPanelBookmarks',
    title: '书签',
    enabled: () => false
  },
  notes: {
    id: 'readerPanelNotes',
    title: '笔记',
    enabled: () => false
  },
  ai: {
    id: 'readerPanelAi',
    title: 'AI',
    enabled: () => false
  }
});

let activeReaderPanel = null;
let readerDrawerReturnFocus = null;

function closeReaderPanel({ restoreFocus = true } = {}) {
  const drawer = document.getElementById('readerDrawer');
  const backdrop = document.getElementById('readerDrawerBackdrop');
  if (drawer) drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('reader-drawer-open');
  document.querySelectorAll('[aria-controls="readerDrawer"]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
  activeReaderPanel = null;

  if (restoreFocus && readerDrawerReturnFocus?.isConnected) {
    readerDrawerReturnFocus.focus();
  }
  readerDrawerReturnFocus = null;
}

function openReaderPanel(panelName, trigger = document.activeElement) {
  const panelConfig = readerPanels[panelName];
  if (!panelConfig) return false;
  if (!panelConfig.enabled()) {
    showHighlightHint(`${panelConfig.title}功能尚未实现`);
    return false;
  }

  const drawer = document.getElementById('readerDrawer');
  const backdrop = document.getElementById('readerDrawerBackdrop');
  const title = document.getElementById('readerDrawerTitle');
  if (!drawer) return false;

  // Preserve the original launcher while switching panels inside the same Drawer.
  // Otherwise Esc may try to restore focus to a tab that has just become hidden.
  if (!activeReaderPanel) readerDrawerReturnFocus = trigger;
  activeReaderPanel = panelName;
  document.querySelectorAll('[data-reader-panel-name]').forEach((panel) => {
    panel.hidden = panel.dataset.readerPanelName !== panelName;
  });
  document.querySelectorAll('[data-reader-panel-target]').forEach((tab) => {
    const selected = tab.dataset.readerPanelTarget === panelName;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[aria-controls="readerDrawer"]').forEach((button) => {
    button.setAttribute('aria-expanded', button === trigger ? 'true' : 'false');
  });
  if (title) title.textContent = panelConfig.title;
  if (panelName === 'settings') syncSettingsPanel();
  drawer.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('reader-drawer-open');
  requestAnimationFrame(() => document.getElementById(panelConfig.id)?.focus?.());
  return true;
}

function triggerHighlightAction() {
  if (state.contentType !== 'epub') return;
  if (!runPendingHighlight() && !highlightCurrentDomSelection()) {
    showHighlightHint('先选中一段 EPUB 文本');
  }
}

const readerActions = Object.freeze({
  backToLibrary: () => returnToLibrary(),
  previousChapter: () => navigateChapter(-1),
  nextChapter: () => navigateChapter(1),
  previousPage: () => navigatePageGroup(-1),
  nextPage: () => navigatePageGroup(1),
  highlight: () => triggerHighlightAction(),
  exportHighlights: () => exportHighlights(),
  toggleTheme: () => {
    toggleTheme();
    syncSettingsPanel();
    persistUserSettings();
  },
  openToc: (trigger) => openReaderPanel('toc', trigger),
  openSettings: (trigger) => openReaderPanel('settings', trigger),
  openSearch: (trigger) => openReaderPanel('search', trigger),
  openBookmarks: (trigger) => openReaderPanel('bookmarks', trigger),
  openNotes: (trigger) => openReaderPanel('notes', trigger),
  openAi: (trigger) => openReaderPanel('ai', trigger),
  closePanel: () => closeReaderPanel()
});

function setupReaderActionMapping() {
  document.addEventListener('click', (event) => {
    const panelTab = event.target.closest?.('[data-reader-panel-target]');
    if (panelTab) {
      event.preventDefault();
      openReaderPanel(panelTab.dataset.readerPanelTarget, panelTab);
      return;
    }

    const trigger = event.target.closest?.('[data-reader-action]');
    if (!trigger || trigger.disabled) return;
    const action = readerActions[trigger.dataset.readerAction];
    if (typeof action !== 'function') return;
    event.preventDefault();
    action(trigger);
  });

  document.getElementById('readerDrawerBackdrop')?.addEventListener('click', () => {
    closeReaderPanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeReaderPanel) {
      event.preventDefault();
      closeReaderPanel();
      return;
    }

    if (event.key !== 'Tab' || !activeReaderPanel) return;
    const drawer = document.getElementById('readerDrawer');
    if (!drawer || drawer.hidden) return;

    const focusable = [...drawer.querySelectorAll(
      'button:not([disabled]):not([hidden]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.closest('[hidden]'));
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

async function returnToLibrary() {
  const bookId = state.currentBookId;
  const reader = document.getElementById('reader');
  const backButtons = [
    document.getElementById('btnBackToLibrary'),
    document.getElementById('btnMobileBackToLibrary')
  ].filter(Boolean);

  if (bookId && reader && state.contentType === 'epub') {
    saveTextScroll();
  }

  backButtons.forEach((button) => { button.disabled = true; });
  try {
    await Promise.all([
      saveTextScroll.flush(),
      persistUserSettings.flush()
    ]);
    await Promise.all([
      flushPendingHighlightSaves(),
      flushPendingProgressSave()
    ]);
    _lastLibraryFocusBookId = bookId;
    const library = await window.browserHost.getLibrary();
    renderLibrary(library);
  } catch (error) {
    showHighlightHint(error.message || '返回书架失败');
  } finally {
    backButtons.forEach((button) => { button.disabled = false; });
  }
}

function setupHighlightButtons() {
  // Desktop actions are delegated through readerActions; retain the mobile compatibility control.
  document.getElementById('btnMobileHighlight')?.addEventListener('click', triggerHighlightAction);
}

function setupReaderNavigation() {
  // Desktop navigation is delegated through readerActions; retain existing mobile IDs and behavior.
  document.getElementById('btnMobilePreviousChapter')?.addEventListener('click', () => navigateChapter(-1));
  document.getElementById('btnMobileNextChapter')?.addEventListener('click', () => navigateChapter(1));
  document.getElementById('btnMobilePreviousPage')?.addEventListener('click', () => navigatePageGroup(-1));
  document.getElementById('btnMobileNextPage')?.addEventListener('click', () => navigatePageGroup(1));
  document.getElementById('btnMobileBackToLibrary')?.addEventListener('click', returnToLibrary);
}

function isTextInputTarget(target) {
  const tag = target?.tagName || '';
  return /^(input|textarea|select)$/i.test(tag) || Boolean(target?.isContentEditable);
}

function isPaginationInteractionTarget(target) {
  return Boolean(target?.closest?.('a, button, input, select, textarea, label, [contenteditable="true"], .br-highlight-box, .highlight-editor, .reader-drawer'));
}

function setupPositionTracking() {
  const reader = document.getElementById('reader');
  if (!reader) return;

  let scrollSnapTimer = null;
  let pointerStartX = null;
  let pointerStartY = null;
  let pointerBlocked = false;

  const handleScroll = () => {
    saveTextScroll();
    if (state.effectiveReadingMode === 'scroll') return;
    clearTimeout(scrollSnapTimer);
    scrollSnapTimer = setTimeout(() => snapPaginationToNearestGroup({ save: true }), 120);
  };

  // scroll events do not bubble, and the scroll container differs per mode:
  // the reader scrolls in continuous mode, the multicol article scrolls in
  // paged mode.
  reader.addEventListener('scroll', handleScroll);
  document.getElementById('article')?.addEventListener('scroll', handleScroll);

  reader.addEventListener('pointerdown', (event) => {
    pointerBlocked = event.button !== 0 || isPaginationInteractionTarget(event.target);
    pointerStartX = pointerBlocked ? null : event.clientX;
    pointerStartY = pointerBlocked ? null : event.clientY;
  });

  reader.addEventListener('pointerup', (event) => {
    if (pointerBlocked || pointerStartX === null || state.effectiveReadingMode === 'scroll') return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    pointerStartX = null;
    pointerStartY = null;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      snapPaginationToNearestGroup({ save: true });
      return;
    }
    navigatePageGroup(deltaX < 0 ? 1 : -1);
  });

  reader.addEventListener('pointercancel', () => {
    pointerStartX = null;
    pointerStartY = null;
    pointerBlocked = false;
  });

  // Real keystrokes land on the focused element and bubble to `document`; a
  // non-focusable div such as #reader never sees them (tabIndex -1), which is
  // why keyboard paging looked dead even though the geometry was correct.
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (state.contentType !== 'epub' || state.effectiveReadingMode === 'scroll') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Typing in the note box or a form field always wins.
    if (isTextInputTarget(event.target)) return;
    // An open Drawer is a focused task of its own; do not move the page under it.
    const drawerOpen = document.body.classList.contains('reader-drawer-open');
    if (drawerOpen) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'PageDown' || key === 'Home' || key === 'End' || key === 'ArrowLeft' || key === 'PageUp') {
      // Arrows and Page keys never activate buttons, so they can page even
      // while a toolbar button still holds focus after a click.
      event.preventDefault();
      if (key === 'ArrowRight' || key === 'PageDown') navigatePageGroup(1);
      else if (key === 'ArrowLeft' || key === 'PageUp') navigatePageGroup(-1);
      else if (key === 'Home') setPageGroup(0, { save: true });
      else setPageGroup(state.pageGroupCount - 1, { save: true });
      return;
    }
    if (key === ' ') {
      // Space activates a focused control; only page when it would otherwise
      // just scroll the viewport.
      if (isPaginationInteractionTarget(event.target)) return;
      event.preventDefault();
      navigatePageGroup(event.shiftKey ? -1 : 1);
    }
  });
}

/* ============================================================
   Library View
   ============================================================ */
function renderLibrary(library) {
  const article = document.getElementById('article');
  const welcome = document.getElementById('welcome');
  if (!article) return;

  state.currentBookId = null;
  state.currentPath = null;
  state.currentName = null;
  state.content = '';
  state.contentType = 'text';
  destroyEpub();

  article.innerHTML = '';
  if (welcome) welcome.style.display = 'none';
  document.body.classList.remove('is-welcome', 'is-epub', 'has-toc', 'toc-open');
  document.getElementById('reader')?.classList.remove('is-welcome');

  const shell = document.createElement('section');
  shell.className = 'library-view';

  const header = document.createElement('div');
  header.className = 'library-header';

  const title = document.createElement('h1');
  title.textContent = '书库';
  header.appendChild(title);

  const scanButton = document.createElement('button');
  scanButton.type = 'button';
  scanButton.className = 'mode-btn';
  scanButton.textContent = '重新扫描';
  scanButton.addEventListener('click', async () => {
    scanButton.disabled = true;
    scanButton.textContent = '扫描中…';
    try {
      renderLibrary(await window.browserHost.scanLibrary());
    } catch (error) {
      showHighlightHint(error.message);
      scanButton.disabled = false;
      scanButton.textContent = '重新扫描';
    }
  });
  header.appendChild(scanButton);
  shell.appendChild(header);

  const validBooks = (library?.books || []).filter((book) => book?.id && !book.error);
  if (!validBooks.length) {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = '书库中还没有可阅读的 EPUB、Markdown 或 TXT 文件。请先在 fnOS 中授权书库目录，然后重新扫描。';
    shell.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'library-grid';
    for (const book of validBooks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-book';

      if (book.coverUrl) {
        const cover = document.createElement('img');
        cover.src = book.coverUrl;
        cover.alt = '';
        cover.loading = 'lazy';
        button.appendChild(cover);
      }

      const name = document.createElement('strong');
      name.textContent = book.title || book.relativePath;
      button.appendChild(name);

      if (book.author) {
        const author = document.createElement('span');
        author.textContent = book.author;
        button.appendChild(author);
      }

      button.addEventListener('click', () => {
        window.browserHost.openBook(book).catch((error) => showHighlightHint(error.message));
      });
      grid.appendChild(button);
    }
    shell.appendChild(grid);
  }

  article.appendChild(shell);
}

/* ============================================================
   appHost API — browser document receiver
   ============================================================ */
window.appHost = {
  async receiveDocument({ path, name, type, content, data, bookId }) {
    state.currentBookId = bookId || null;
    state.currentPath  = path;
    state.currentName  = name;
    state.contentType  = (type === 'epub') ? 'epub' : 'text';
    state.toc          = [];
    _pendingCfiRange   = null;
    renderToc();
    updateTopbarState();

    const fileNameEl = document.getElementById('fileName');
    if (fileNameEl) fileNameEl.textContent = name;

    if (type === 'epub' && data) {
      // Show loading state
      const article = document.getElementById('article');
      const epubShell = document.getElementById('epubShell');
      if (article) {
        article.style.display = '';
        article.innerHTML = '<p style="color:var(--text-dim);padding:80px 40px;">正在打开 EPUB…</p>';
      }
      if (epubShell) epubShell.style.display = 'none';

      try {
        state.content = '[epub]';
        renderArticle();
        await renderEpubDocument(data);
      } catch (err) {
        destroyEpub();
        state.content = `<p style="color:var(--accent)">EPUB 解析失败：${err.message}</p>`;
        state.contentType = 'text';
      } finally {
        // Always re-measure pagination after EPUB content arrives, because the
        // article now contains real chapter content and needs to grow its column
        // track. Resize won't trigger until viewport changes, so do it eagerly.
        const article = document.getElementById('article');
        if (article && state.effectiveReadingMode !== 'scroll') {
          requestAnimationFrame(() => measurePagination({ preserveLocator: true }));
        }
      }
    } else {
      destroyEpub();
      state.content = content || '';
    }

    setDirty(false);
    setMode('read');
    renderArticle();
    restoreTextScroll();
    renderToc();
    updateTopbarState();
  },

  notifySaved({ path, name } = {}) {
    if (path) state.currentPath = path;
    if (name) state.currentName = name;
    setDirty(false, false);

    const fileNameEl = document.getElementById('fileName');
    if (!fileNameEl) return;

    const displayName = name || state.currentName;
    fileNameEl.textContent = '已保存';
    fileNameEl.style.color = 'var(--accent)';

    setTimeout(() => {
      fileNameEl.textContent = displayName;
      fileNameEl.style.color = '';
    }, 1200);
  },

  notifyHighlightFileWritten({ path, silent } = {}) {
    if (silent) return;
    if (path) flashFileName(`已导出到 ${path}`, 4200);
  },

  getContent() {
    if (state.mode === 'edit') {
      const editor = document.getElementById('editor');
      if (editor) state.content = editor.value;
    }
    return state.contentType === 'epub' ? '' : state.content;
  },

  toggleEditMode() {
    // Don't allow editing EPUB files
    if (state.contentType === 'epub') return;
    setMode(state.mode === 'read' ? 'edit' : 'read');
  },

  toggleTheme,

  highlightSelection() {
    if (state.contentType !== 'epub') return;
    if (!runPendingHighlight() && !highlightCurrentDomSelection()) {
      showHighlightHint('先选中一段 EPUB 文本');
    }
  },

  exportHighlights,

  zoomIn()    { zoomLevel = Math.min(200, zoomLevel + 10); applyZoom(); },
  zoomOut()   { zoomLevel = Math.max(60, zoomLevel - 10);  applyZoom(); },
  zoomReset() { zoomLevel = 100; applyZoom(); },

  setImmersive(on) {
    document.body.classList.toggle('immersive', !!on);
  }
};

/* ============================================================
   DOMContentLoaded — Boot
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  configureMarked();
  setupThemeToggle();
  setupTocToggle();
  setupSettingsPanel();
  setupHighlightButtons();
  setupHighlightEditor();
  setupReaderNavigation();
  setupReaderActionMapping();
  // Topbar 阅读/编辑 buttons removed (P0); setMode is now driven only by
  // openDocument/reset flows. No keyboard shortcut exists, so markdown/txt
  // edit mode has no UI entry (editor DOM kept for a future re-add).

  // Set up editor live preview with debounce
  const editor = document.getElementById('editor');
  if (editor) {
    const debouncedPreview = debounce(() => {
      state.content = editor.value;
      renderPreview();
    }, 300);

    editor.addEventListener('input', () => {
      state.content = editor.value;
      setDirty(true);
      debouncedPreview();
    });
  }

  setupKeyboard();
  setupTocNavigation();
  setupDomHighlightInteraction();
  setupPositionTracking();
  renderArticle();
  updateTopbarState();
  window.addEventListener('resize', debounce(() => {
    measurePagination({ preserveLocator: true });
  }, 120));

  document.addEventListener('click', (e) => {
    if (_highlightPill && e.target !== _highlightPill) {
      dismissHighlightPill();
    }
  });

  Promise.all([
    window.browserHost.getSession(),
    window.browserHost.getUserState(),
    window.browserHost.getLibrary()
  ]).then(([session, userState, library]) => {
    state.session = session;
    applyUserState(userState);
    applyContinuousScroll();
    syncSettingsPanel();
    renderLibrary(library);
  }).catch((error) => showHighlightHint(error.message));
});
