'use strict';

// Chapter structure for plain-text and Markdown books.
//
// TXT/Markdown have no table of contents, so headings are recognised from
// standalone lines: “第三章 …”, “卷一”, Markdown “# …”, “一、…” sections inside
// a chapter, and common front/back matter (序言、后记…). The result has the same
// shape as the EPUB structure (`chapters` with depth, parentId and start/end
// offsets in the normalised text), so the index treats both formats alike.

const { normalizeBookText } = require('./ai-book-context');

const NUMERAL = '[0-9０-９零〇一二两三四五六七八九十百千万]+';
const CHAPTER_LINE = new RegExp(`^第\\s*(${NUMERAL})\\s*([章回节卷部篇集])(?:[\\s:：、.．]|$)`);
const VOLUME_LINE = new RegExp(`^卷\\s*(${NUMERAL})(?:[\\s:：、.．]|$)`);
const SECTION_LINE = /^([一二三四五六七八九十]{1,3})[、.．]\s*\S/;
const MATTER_LINE = /^(?:序|序言|序章|自序|前言|引言|引子|楔子|导言|导论|后记|尾声|结语|跋|附录|番外)(?:[\s:：一二三四五六七八九十0-9]|$)/;
const MARKDOWN_LINE = /^(#{1,6})\s+(\S.*)$/;
const MAX_HEADING_CHARS = 40;
const MAX_NODES = 5000;

const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

// “十二” → 12, “一百零五” → 105, “３” → 3. Returns null for anything else.
function parseNumeral(value) {
  const text = String(value || '').replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10)).trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (!text || /[^零〇一二两三四五六七八九十百千万]/.test(text)) return null;
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of text) {
    if (char in DIGITS) {
      number = DIGITS[char];
    } else if (char === '万') {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * UNITS[char];
      number = 0;
    }
  }
  return total + section + number;
}

function classifyLine(line) {
  const text = line.trim();
  if (!text || text.length > MAX_HEADING_CHARS) return null;
  const markdown = MARKDOWN_LINE.exec(text);
  if (markdown) return { kind: 'markdown', level: markdown[1].length, label: markdown[2].trim() };
  const chapter = CHAPTER_LINE.exec(text);
  if (chapter) {
    const unit = chapter[2];
    const kind = '卷部篇集'.includes(unit) ? 'volume' : unit === '节' ? 'section' : 'chapter';
    return { kind, label: text, number: parseNumeral(chapter[1]) };
  }
  if (VOLUME_LINE.test(text)) return { kind: 'volume', label: text };
  if (MATTER_LINE.test(text) && text.length <= 16) return { kind: 'matter', label: text };
  if (SECTION_LINE.test(text) && !/[。！？；，,]$/.test(text) && text.length <= 30) return { kind: 'subsection', label: text };
  return null;
}

// Offsets of each line start in the normalised text. Lines are joined by
// whitespace, so the normalised text is the non-empty normalised lines joined
// by single spaces; this keeps the computation linear.
function lineOffsets(lines) {
  const offsets = [];
  let length = 0;
  for (const line of lines) {
    const normalized = normalizeBookText(line);
    offsets.push(length ? length + 1 : 0);
    if (normalized) length += (length ? 1 : 0) + normalized.length;
  }
  return { offsets, length };
}

function buildTextStructure(rawText, { title = '' } = {}) {
  const lines = String(rawText || '').split(/\r?\n/);
  const { offsets, length } = lineOffsets(lines);
  const text = normalizeBookText(rawText);
  if (text.length !== length) return null;

  const candidates = [];
  for (let index = 0; index < lines.length && candidates.length < MAX_NODES; index += 1) {
    const heading = classifyLine(lines[index]);
    if (!heading) continue;
    const label = normalizeBookText(heading.label);
    const line = normalizeBookText(lines[index]);
    const offset = offsets[index];
    // The whole heading line (with any “# ”) must sit exactly at this offset.
    if (!label || text.slice(offset, offset + line.length) !== line) continue;
    if (title && label === normalizeBookText(title) && !candidates.length) continue;
    candidates.push({ ...heading, label, offset });
  }

  const hasMarkdown = candidates.some((item) => item.kind === 'markdown');
  const usable = hasMarkdown
    ? candidates.filter((item) => item.kind === 'markdown')
    : candidates.filter((item) => item.kind !== 'markdown');
  const chapterLike = usable.filter((item) => ['chapter', 'volume', 'markdown'].includes(item.kind));
  if (chapterLike.length < 2) return null;

  const hasVolumes = usable.some((item) => item.kind === 'volume');
  const markdownTop = hasMarkdown ? Math.min(...usable.map((item) => item.level)) : 0;
  const depthOf = (item) => {
    if (item.kind === 'markdown') return Math.min(3, item.level - markdownTop);
    if (item.kind === 'volume') return 0;
    if (item.kind === 'chapter' || item.kind === 'matter') return hasVolumes ? 1 : 0;
    return hasVolumes ? 2 : 1;
  };

  const chapters = [];
  const stack = [];
  for (const [order, item] of usable.entries()) {
    let depth = depthOf(item);
    // “一、…” only counts as a section when it sits inside a chapter.
    if (item.kind === 'subsection' && !stack.some((node) => node.depth < depth)) continue;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length && depth > stack[stack.length - 1].depth + 1) depth = stack[stack.length - 1].depth + 1;
    if (!stack.length) depth = 0;
    const node = {
      id: `txt-${order + 1}`,
      label: item.label,
      depth,
      parentId: stack.length ? stack[stack.length - 1].id : null,
      number: Number.isSafeInteger(item.number) ? item.number : null,
      start: { spineIndex: 0, offset: item.offset },
      end: { spineIndex: 0, offset: text.length },
      mappingQuality: 'exact'
    };
    chapters.push(node);
    stack.push(node);
  }
  for (let index = 0; index < chapters.length; index += 1) {
    const next = chapters.slice(index + 1).find((candidate) => candidate.depth <= chapters[index].depth);
    if (next) chapters[index].end = { spineIndex: 0, offset: next.start.offset };
  }
  return { chapters, textLength: text.length };
}

module.exports = { buildTextStructure, classifyLine, parseNumeral };
