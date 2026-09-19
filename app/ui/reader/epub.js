/* BabyReader UI module: reader/epub */

'use strict';

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
