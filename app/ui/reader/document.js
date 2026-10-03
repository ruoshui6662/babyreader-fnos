/* 枕书 UI module: reader/document */

'use strict';

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
let _epubChapterRenderGeneration = 0;

function updateEpubChapterStatus(index) {
  const status = document.getElementById('paginationStatus');
  if (!status) return;
  status.hidden = false;
  status.textContent = `正在打开第 ${index + 1}/${state.epubChapterCount} 章`;
}

function isEpubChapterLoading() {
  return state.epubChapterLoading === true;
}

function invalidateEpubChapterRender() {
  _epubChapterRenderGeneration += 1;
  invalidatePaginationMeasurement();
}

async function renderEpubChapter(index, options = {}) {
  if (typeof clearSearchHit === 'function') clearSearchHit();
  const archive = state.epubArchive;
  const article = document.getElementById('article');
  const reader = document.getElementById('reader');
  if (!archive || !article || !Number.isInteger(index) || index < 0 || index >= state.epubChapterCount) return false;

  invalidateEpubChapterRender();
  const generation = _epubChapterRenderGeneration;
  const isCurrent = () => generation === _epubChapterRenderGeneration
    && state.contentType === 'epub' && state.epubArchive === archive;
  state.epubChapterLoading = true;
  state.epubRenderPending = true;
  article.setAttribute('aria-busy', 'true');
  updateEpubChapterStatus(index);
  updatePaginationControls();
  updateReadingProgress({ chapterIndexHint: state.epubChapterIndex });
  let chapterResourceLease = null;
  let chapterLeaseCommitted = false;

  try {
    const chapter = await loadEpubChapter(archive, index);
    chapterResourceLease = chapter.resourceLease || null;
    if (!isCurrent()) return false;

    // Validate against the same loaded result that will be mounted. A broken
    // fragment must not replace the current chapter or reset its page.
    if (options.fragment) {
      const preview = document.createElement('template');
      preview.innerHTML = chapter.html;
      if (![...preview.content.querySelectorAll('[id]')].some((node) => node.id === options.fragment)) {
        return false;
      }
    }

    const previousLease = archive.activeChapterLease || null;
    applyBookLayoutCss(chapter.layoutCss);
    article.innerHTML = chapter.html;
    archive.activeChapterLease = chapterResourceLease;
    chapterLeaseCommitted = true;
    if (previousLease && previousLease !== chapterResourceLease) {
      archive.resourceManager?.release(previousLease);
    }
    // Replacing the mounted chapter starts a new scroll surface. Locator
    // restoration, when requested, runs after pagination has settled.
    const resetScroll = options.resetScroll !== false;
    if (resetScroll) {
      article.scrollLeft = 0;
      article.scrollTop = 0;
      if (reader) {
        reader.scrollLeft = 0;
        reader.scrollTop = 0;
      }
    }
    state.epubHtml = chapter.html;
    state.epubChapterIndex = chapter.index;
    state.currentChapterIndex = chapter.index;
    article.dataset.epubSkippedResourceCount = String(archive.diagnostics.skippedResourceCount || 0);
    // Mostly-CJK chapters may break a Latin word at a line end (phones
    // otherwise leave a widely spaced short line before it); set before
    // pagination measures.
    article.dataset.textScript = chapterTextScript(article.textContent);
    // Body paragraphs take the reader's first-line indent (before pagination
    // measures, so the page count already reflects it).
    if (typeof classifyParagraphIndents === 'function') classifyParagraphIndents(article);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!isCurrent()) return false;

    const settled = await measurePagination({
      preserveLocator: false,
      allowEpubPending: true,
      isCurrent
    });
    if (!settled || !isCurrent()) return false;

    // Internal restoration uses the ordinary page navigation API, which stays
    // disabled until the destination's pagination has settled.
    state.epubChapterLoading = false;
    state.epubRenderPending = false;
    redrawDomHighlights();
    if (options.locator) {
      restoreReadingLocator(options.locator);
    } else if (options.page === 'last') {
      setPageGroup(state.pageGroupCount - 1, { save: false });
    } else if (Number.isFinite(options.page)) {
      setPageGroup(pageGroupForPage(Math.max(1, Math.floor(options.page))), { save: false });
    }
    updateReadingProgress({ chapterIndexHint: chapter.index });
    return true;
  } catch (error) {
    if (generation !== _epubChapterRenderGeneration || state.contentType !== 'epub') return false;
    console.warn('EPUB 章节加载失败', { index, error });
    showHighlightHint(error?.message || `无法打开第 ${index + 1} 章`);
    return false;
  } finally {
    if (!chapterLeaseCommitted && chapterResourceLease) {
      archive.resourceManager?.release(chapterResourceLease);
    }
    if (generation === _epubChapterRenderGeneration) {
      state.epubChapterLoading = false;
      state.epubRenderPending = false;
      article.removeAttribute('aria-busy');
      updatePaginationControls();
      updateReadingProgress({ chapterIndexHint: state.epubChapterIndex });
    }
  }
}

// Chapter lines in plain-text books, as the server's AI structure reads them.
const PLAIN_TEXT_HEADING = /^第\s*[0-9０-９零〇一二两三四五六七八九十百千万]+\s*[章回节卷部篇集](?:[\s:：、.．]|$)|^卷\s*[0-9０-９零〇一二两三四五六七八九十百千万]+(?:[\s:：、.．]|$)|^(?:序|序言|序章|自序|前言|引言|引子|楔子|导言|后记|尾声|结语|跋|附录|番外)(?:[\s:：]|$)/;

function renderPlainTextHtml(content) {
  const escape = (text) => text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
  const blocks = [];
  for (const raw of String(content || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/[\s　]+$/, '');
    const trimmed = line.trim().replace(/^　+/, '');
    if (!trimmed) continue;
    if (trimmed.length <= 40 && PLAIN_TEXT_HEADING.test(trimmed)) {
      blocks.push(`<h2>${escape(trimmed)}</h2>`);
      continue;
    }
    // Leading spaces become the paragraph's own (原书) indent instead of
    // text: justified lines would stretch them. A full-width space is one
    // character, any other space half of one.
    const lead = line.match(/^[\s　]*/)[0];
    const leadEm = [...lead].reduce((sum, character) => sum + (character === '　' ? 1 : 0.5), 0);
    const indent = leadEm ? ` style="--zs-book-indent: ${Math.min(8, leadEm)}em"` : '';
    blocks.push(`<p${indent}>${escape(line.slice(lead.length))}</p>`);
  }
  return blocks.join('\n');
}

function applyBookLayoutCss(css) {
  let style = document.getElementById('zsBookLayout');
  if (!style) {
    style = document.createElement('style');
    style.id = 'zsBookLayout';
    document.head.appendChild(style);
  }
  style.textContent = String(css || '');
}

function chapterTextScript(text) {
  const sample = String(text || '').replace(/\s+/g, '').slice(0, 2000);
  if (!sample) return 'latin';
  const cjk = sample.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g)?.length || 0;
  return cjk / sample.length >= 0.3 ? 'cjk' : 'latin';
}

function navigateToEpubChapter(index, options = {}) {
  if (isEpubChapterLoading()) return false;
  // The mounted chapter is authoritative in both modes. Re-render only when
  // crossing a chapter boundary; same-chapter targets are resolved locally by
  // navigateEpubTarget/fragment restoration.
  if (index === state.epubChapterIndex && document.querySelector('#article .epub-chapter')) {
    updateReadingProgress({ chapterIndexHint: index });
    if (options.locator) {
      requestAnimationFrame(() => restoreReadingLocator(options.locator));
    }
    return true;
  }
  return renderEpubChapter(index, options);
}

function renderArticle() {
  if (typeof clearSearchHit === 'function') clearSearchHit();
  const article = document.getElementById('article');
  const reader = document.getElementById('reader');
  const welcome = document.getElementById('welcome');
  const epubShell = document.getElementById('epubShell');
  const isWelcome = !state.currentPath && (!state.content || !state.content.trim());

  if (article) article.classList.remove('is-library');
  if (reader) reader.classList.toggle('is-welcome', isWelcome);
  document.body.classList.toggle('is-welcome', isWelcome);
  document.body.classList.remove('is-library');

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
    }
  } else {
    if (epubShell) epubShell.style.display = 'none';
    if (article) article.style.display = '';
    // TXT is not Markdown: every line is a paragraph (novels rarely leave
    // blank lines between them). Markdown runs through preprocessor + marked.
    const isPlainText = /\.txt$/i.test(String(state.currentPath || ''));
    article.innerHTML = isPlainText ? renderPlainTextHtml(state.content) : preprocessCustomBlocks(state.content);
    // TXT books follow the first-line indent setting; Markdown documents do not.
    article.dataset.textKind = isPlainText ? 'txt' : 'markdown';
    if (isPlainText && typeof classifyParagraphIndents === 'function') classifyParagraphIndents(article);
  }
}
