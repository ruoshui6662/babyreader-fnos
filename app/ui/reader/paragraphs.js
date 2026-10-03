/* 枕书 UI module: reader/paragraphs */

'use strict';

/*
 * First-line indent, book by book.
 *
 * Books indent body text in different ways: a CSS text-indent, leading
 * full-width spaces (U+3000), &nbsp; or nothing at all; and they deliberately
 * leave some paragraphs unindented (notes, sign-offs, centred lines, poems,
 * hanging indents). When a chapter is mounted we read the book's own computed
 * layout once and mark the body paragraphs:
 *
 *   data-zs-para="body"   the reader's indent setting applies
 *   --zs-lead: <em>       how far the book already pushed the first
 *                         character in (spaces + its own text-indent)
 *
 * CSS then sets text-indent to (chosen indent - lead), so the first character
 * lands exactly N characters in, or flush for 无. Everything else keeps the
 * book's style, and 原书 ignores the marks altogether.
 *
 * Only attributes and a custom property change: the text and the node tree
 * stay untouched, so saved highlights (node path + text offset) still match.
 */

const PARAGRAPH_SKIP_ANCESTORS = 'li, blockquote, table, figure, figcaption, pre, code, h1, h2, h3, h4, h5, h6, header, nav, aside, .no-indent';
const PARAGRAPH_BLOCK_CHILDREN = 'p, div, table, ul, ol, dl, h1, h2, h3, h4, h5, h6, blockquote, figure, section, article, pre, hr';
const PARAGRAPH_LEADING_SPACE = /[\s  -​　]/;

// A div counts when it holds text itself rather than wrapping other blocks.
function isTextBlockDiv(element) {
  if (element.querySelector(PARAGRAPH_BLOCK_CHILDREN)) return false;
  return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
}

// The first non-space character of an element, as a one-character range.
function firstCharacterRange(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    for (let index = 0; index < text.length; index += 1) {
      if (PARAGRAPH_LEADING_SPACE.test(text[index])) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range;
    }
  }
  return null;
}

// Anything that sits before the first character and is not text (an inline
// image, a float such as a drop cap) makes the measured lead meaningless.
function hasLeadingObject(element, range) {
  for (const object of element.querySelectorAll('img, svg, image, video, [style*="float"]')) {
    const position = range.comparePoint?.(object, 0);
    if (position === -1 || position === undefined) return true;
  }
  return false;
}

function paragraphCandidates(root) {
  return [...root.querySelectorAll('p, div')].filter((element) => {
    if (element.closest(PARAGRAPH_SKIP_ANCESTORS)) return false;
    if (element.tagName === 'DIV' && !isTextBlockDiv(element)) return false;
    return true;
  });
}

function readParagraphLayout(element) {
  const style = getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize) || 16;
  const indent = parseFloat(style.textIndent) || 0;
  const align = style.textAlign;
  const text = element.textContent || '';
  const info = {
    element,
    fontSize,
    indentEm: Math.round((indent / fontSize) * 2) / 2,
    inset: (parseFloat(style.marginLeft) || 0) + (parseFloat(style.paddingLeft) || 0),
    textLength: text.replace(/\s+/g, '').length,
    keep: false,
    lead: 0,
    leadingSpace: /^[ 　]/.test(text.replace(/^[ \t\r\n]+/, ''))
  };
  if (!info.textLength
      || ['center', 'right', 'end', '-webkit-center'].includes(align)
      || style.display === 'none'
      || indent < -0.5
      || element.querySelector('br')) {
    info.keep = true;
    return info;
  }
  const range = firstCharacterRange(element);
  const first = element.getClientRects()[0];
  const character = range?.getClientRects()[0];
  if (!range || !first || !character || hasLeadingObject(element, range)) {
    info.keep = true;
    return info;
  }
  const contentLeft = first.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
  // Everything between the content edge and the first character, minus the
  // book's own text-indent, is leading space the reader has to cancel.
  const lead = character.left - contentLeft - indent;
  if (!(lead >= -0.5 && lead <= fontSize * 4.5)) {
    info.keep = true;
    return info;
  }
  // In em so a later font-size change keeps the cancellation exact.
  info.lead = Math.max(0, Math.round((lead / fontSize) * 1000) / 1000);
  return info;
}

/*
 * Body paragraphs share the chapter's dominant look (most text): the same
 * book indent and left inset. A paragraph that starts with full-width spaces
 * or &nbsp; is body text too. Minority styles the book set apart (indent 0
 * where body text is indented, extra left inset, a larger indent) keep the
 * book's layout.
 */
function classifyParagraphIndents(root) {
  if (!root) return { body: 0, keep: 0 };
  // Measure the book's own layout: our indent rule stands aside meanwhile
  // (re-classifying after a font change must not measure our own indent).
  const html = document.documentElement;
  html.dataset.zsMeasuring = 'true';
  let layouts;
  try {
    layouts = paragraphCandidates(root).map(readParagraphLayout);
  } finally {
    delete html.dataset.zsMeasuring;
  }
  const weight = new Map();
  for (const info of layouts) {
    if (info.keep) continue;
    const key = `${info.indentEm}|${Math.round(info.inset / info.fontSize)}`;
    weight.set(key, (weight.get(key) || 0) + info.textLength);
  }
  const dominant = [...weight.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  let body = 0;
  for (const info of layouts) {
    const key = `${info.indentEm}|${Math.round(info.inset / info.fontSize)}`;
    const isBody = !info.keep && (key === dominant || (info.leadingSpace && info.lead > 0.05));
    if (isBody) {
      info.element.dataset.zsPara = 'body';
      if (info.lead > 0.05) info.element.style.setProperty('--zs-lead', `${info.lead}em`);
      else info.element.style.removeProperty('--zs-lead');
      body += 1;
    } else {
      delete info.element.dataset.zsPara;
      info.element.style.removeProperty('--zs-lead');
    }
  }
  return { body, keep: layouts.length - body };
}
