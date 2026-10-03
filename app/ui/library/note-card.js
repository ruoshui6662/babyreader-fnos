'use strict';

/* global ensureReaderFontStylesheets, isMobileReaderSurface, showHighlightHint */

/*
 * 书摘卡片：one note drawn onto a canvas and saved as a PNG.
 * Self-drawn (no DOM screenshot library) so every device produces the same
 * picture: the card uses one bundled OFL font, loaded before drawing.
 */

const NOTE_CARD_TEMPLATES = Object.freeze({
  paper: '书页',
  letter: '素笺',
  ink: '墨夜'
});

const NOTE_CARD_FONTS = Object.freeze({
  'source-serif': { label: '思源宋体', family: 'Noto Serif SC' },
  wenkai: { label: '霞鹜文楷', family: 'LXGW WenKai' },
  fangsong: { label: '朱雀仿宋', family: 'Zhuque Fangsong' }
});

const NOTE_CARD_RATIOS = Object.freeze({
  '3:4': [1080, 1440],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080]
});

const NOTE_CARD_TOGGLES = Object.freeze({
  thought: '想法',
  book: '书名',
  date: '日期',
  cover: '书封'
});

const NOTE_CARD_DEFAULTS = Object.freeze({
  template: 'paper',
  font: 'source-serif',
  ratio: '3:4',
  thought: true,
  book: true,
  date: true,
  cover: true
});

const NOTE_CARD_PREFS_KEY = 'zhenshu-note-card';

const NOTE_CARD_PALETTES = Object.freeze({
  paper: {
    background: ['#F4EDDE', '#EADFC8'],
    text: '#2F2A22',
    muted: '#7A705F',
    faint: '#B3A68B',
    mark: 'rgba(150, 120, 70, .16)',
    frame: 'rgba(120, 96, 56, .32)',
    rule: 'rgba(120, 96, 56, .28)',
    seal: '#A8372C',
    sealText: '#F6EEDD',
    grain: { tone: 0, alpha: 0.075 },
    vignette: 'rgba(110, 82, 40, .16)'
  },
  letter: {
    background: ['#FBF8F1', '#F6F1E6'],
    text: '#24221E',
    muted: '#857D70',
    faint: '#B9B0A0',
    mark: null,
    frame: 'rgba(178, 58, 46, .42)',
    rule: 'rgba(178, 58, 46, .2)',
    seal: '#B23A2E',
    sealText: '#FBF8F1',
    grain: { tone: 0, alpha: 0.045 },
    vignette: null
  },
  ink: {
    background: ['#23262C', '#17191D'],
    text: '#ECE6D8',
    muted: '#A39C8D',
    faint: '#6F6A60',
    mark: 'rgba(201, 168, 106, .14)',
    frame: 'rgba(201, 168, 106, .38)',
    rule: 'rgba(201, 168, 106, .3)',
    seal: '#C9A86A',
    sealText: null,
    grain: { tone: 255, alpha: 0.05 },
    vignette: 'rgba(0, 0, 0, .35)'
  }
});

const NOTE_CARD_HIGHLIGHT_COLORS = Object.freeze({
  yellow: '#E2B93B',
  green: '#5BAE78',
  blue: '#4F8FD8',
  pink: '#D9688F'
});

/* ---------- Preferences ---------- */

function readNoteCardPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(NOTE_CARD_PREFS_KEY) || '{}') || {}; } catch { saved = {}; }
  const prefs = { ...NOTE_CARD_DEFAULTS };
  if (NOTE_CARD_TEMPLATES[saved.template]) prefs.template = saved.template;
  if (NOTE_CARD_FONTS[saved.font]) prefs.font = saved.font;
  if (NOTE_CARD_RATIOS[saved.ratio]) prefs.ratio = saved.ratio;
  for (const key of Object.keys(NOTE_CARD_TOGGLES)) {
    if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
  }
  return prefs;
}

function saveNoteCardPrefs(prefs) {
  try { localStorage.setItem(NOTE_CARD_PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

/* ---------- Text layout ---------- */

// Chinese line-breaking rules (禁则): these never begin a line…
const NOTE_CARD_NO_LINE_START = '，。、；：？！）》」』〉】〕”’…—～·,.;:!?)]}%';
// …and these never end one.
const NOTE_CARD_NO_LINE_END = '（《「『〈【〔“‘([{';

function noteCardUnits(paragraph) {
  return paragraph.match(/[A-Za-z0-9À-ɏ'’\-]+|[ \t]+|[\s\S]/gu) || [];
}

/**
 * Breaks text into lines no wider than maxWidth. Punctuation that may not
 * start a line hangs past the edge; an opening bracket moves down with the
 * word it opens. Lines that end a paragraph are marked `last`.
 */
function noteCardBreakLines(measure, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text || '').replace(/\r\n?/g, '\n').split(/\n+/).map((part) => part.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    let line = [];
    let width = 0;
    const push = (last) => {
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
      if (line.length) lines.push({ units: line, last });
    };
    for (const text of noteCardUnits(paragraph)) {
      const isSpace = /^\s+$/.test(text);
      if (!line.length && isSpace) continue;
      const unit = { text, width: measure(text) };
      if (!line.length || width + unit.width <= maxWidth + 0.01 || isSpace || NOTE_CARD_NO_LINE_START.includes(text[0])) {
        line.push(unit);
        width += unit.width;
        continue;
      }
      const carry = [];
      while (line.length > 1 && NOTE_CARD_NO_LINE_END.includes(line[line.length - 1].text)) carry.unshift(line.pop());
      push(false);
      line = [...carry, unit];
      width = line.reduce((sum, item) => sum + item.width, 0);
    }
    push(true);
  }
  return lines;
}

function noteCardLineWidth(line) {
  return line.units.reduce((sum, unit) => sum + unit.width, 0);
}

/** Lays out quote and thought at the largest size that fits the box. */
function layoutNoteCardBody(measureAt, { quote, thought, width, height, maxSize, minSize, thoughtGap = 1.4 }) {
  let best = null;
  for (let size = maxSize; size >= minSize; size -= 2) {
    const thoughtSize = Math.max(24, Math.round(size * 0.68));
    const quoteLines = noteCardBreakLines(measureAt(size), quote, width);
    const thoughtLines = thought ? noteCardBreakLines(measureAt(thoughtSize), thought, width) : [];
    const quoteHeight = quoteLines.length * size * 1.78;
    const thoughtHeight = thoughtLines.length ? size * thoughtGap + thoughtLines.length * thoughtSize * 1.72 : 0;
    best = { size, thoughtSize, quoteLines, thoughtLines, quoteHeight, thoughtHeight, height: quoteHeight + thoughtHeight, truncated: false };
    if (best.height <= height) return best;
  }
  // Still too long at the smallest size: keep what fits, end with an ellipsis.
  const room = height - best.thoughtHeight;
  let keep = Math.floor(room / (best.size * 1.78));
  if (keep < 3 && best.thoughtLines.length) {
    // The quote matters more than the thought: drop the thought first.
    best.thoughtLines = [];
    best.thoughtHeight = 0;
    keep = Math.floor(height / (best.size * 1.78));
  }
  keep = Math.max(1, keep);
  if (keep < best.quoteLines.length) {
    const measure = measureAt(best.size);
    const lastLine = best.quoteLines[keep - 1];
    const ellipsis = { text: '……', width: measure('……') };
    const units = lastLine.units.slice();
    while (units.length && units.reduce((sum, unit) => sum + unit.width, 0) + ellipsis.width > width) units.pop();
    best.quoteLines = best.quoteLines.slice(0, keep - 1).concat([{ units: [...units, ellipsis], last: true }]);
    best.truncated = true;
  }
  best.quoteHeight = best.quoteLines.length * best.size * 1.78;
  best.height = best.quoteHeight + best.thoughtHeight;
  return best;
}

/** Draws laid-out lines; full lines are justified like a printed page. */
function drawNoteCardLines(ctx, lines, { x, y, width, size, lineHeight, color, align = 'justify' }) {
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, index) => {
    const baseline = y + index * size * lineHeight + size * (lineHeight / 2 + 0.36);
    const natural = noteCardLineWidth(line);
    const gaps = line.units.length - 1;
    const slack = width - natural;
    const justify = align === 'justify' && !line.last && gaps > 0 && slack > 0 && slack < size * 2.5;
    const spacing = justify ? slack / gaps : 0;
    let cursor = align === 'center' ? x + Math.max(0, slack) / 2 : x;
    for (const unit of line.units) {
      ctx.fillText(unit.text, cursor, baseline);
      cursor += unit.width + spacing;
    }
  });
}

/* ---------- Decoration ---------- */

function noteCardRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paper grain: a fixed noise tile, so the same note always gives the same picture.
function noteCardGrain(tone, alpha) {
  const tile = document.createElement('canvas');
  tile.width = 256;
  tile.height = 256;
  const tileCtx = tile.getContext('2d');
  const image = tileCtx.createImageData(256, 256);
  const random = noteCardRandom(20261002);
  for (let index = 0; index < image.data.length; index += 4) {
    const fibre = random();
    image.data[index] = tone;
    image.data[index + 1] = tone;
    image.data[index + 2] = tone;
    image.data[index + 3] = Math.round(255 * alpha * fibre * fibre);
  }
  tileCtx.putImageData(image, 0, 0);
  return tile;
}

function paintNoteCardBackground(ctx, width, height, palette, template) {
  const gradient = ctx.createLinearGradient(0, 0, width * 0.4, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(1, palette.background[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = ctx.createPattern(noteCardGrain(palette.grain.tone, palette.grain.alpha), 'repeat');
  ctx.fillRect(0, 0, width, height);

  if (template === 'paper') {
    // A few long, faint fibres, as in handmade paper.
    const random = noteCardRandom(7);
    ctx.save();
    ctx.strokeStyle = 'rgba(140, 110, 60, .07)';
    ctx.lineWidth = 1.2;
    const fibres = Math.max(26, Math.round((26 * height) / 1440));
    for (let index = 0; index < fibres; index += 1) {
      const startX = random() * width;
      const startY = random() * height;
      const length = 40 + random() * 120;
      const angle = random() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(
        startX + Math.cos(angle) * length * 0.5 + (random() - 0.5) * 30,
        startY + Math.sin(angle) * length * 0.5 + (random() - 0.5) * 30,
        startX + Math.cos(angle) * length,
        startY + Math.sin(angle) * length
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  if (palette.vignette) {
    const radius = Math.hypot(width, height) / 2;
    const vignette = ctx.createRadialGradient(width / 2, height / 2, radius * 0.55, width / 2, height / 2, radius);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, palette.vignette);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
}

function paintNoteCardFrame(ctx, width, height, palette, template) {
  ctx.save();
  ctx.strokeStyle = palette.frame;
  if (template === 'paper') {
    // Double hairline border, like the frame of an old title page.
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 36, width - 72, height - 72);
    ctx.lineWidth = 1;
    ctx.strokeRect(46, 46, width - 92, height - 92);
  } else if (template === 'ink') {
    ctx.lineWidth = 1.5;
    ctx.strokeRect(40, 40, width - 80, height - 80);
    // Small corner marks.
    ctx.lineWidth = 3;
    const arm = 28;
    for (const [cx, cy, dx, dy] of [[40, 40, 1, 1], [width - 40, 40, -1, 1], [40, height - 40, 1, -1], [width - 40, height - 40, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * arm);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * arm, cy);
      ctx.stroke();
    }
  } else {
    // 素笺: the vermilion border of a letter sheet, heavy outside, fine inside.
    ctx.lineWidth = 2.5;
    ctx.strokeRect(56, 56, width - 112, height - 112);
    ctx.lineWidth = 1;
    ctx.strokeRect(68, 68, width - 136, height - 136);
  }
  ctx.restore();
}

/** A square seal reading 枕书, with worn edges like a real stamp. */
function paintNoteCardSeal(ctx, x, y, size, palette, family) {
  const seal = document.createElement('canvas');
  seal.width = size;
  seal.height = size;
  const sealCtx = seal.getContext('2d');
  const inset = size * 0.06;
  const radius = size * 0.1;
  const outline = !palette.sealText;
  sealCtx.beginPath();
  if (typeof sealCtx.roundRect === 'function') sealCtx.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
  else sealCtx.rect(inset, inset, size - inset * 2, size - inset * 2);
  if (outline) {
    sealCtx.strokeStyle = palette.seal;
    sealCtx.lineWidth = size * 0.05;
    sealCtx.stroke();
  } else {
    sealCtx.fillStyle = palette.seal;
    sealCtx.fill();
  }
  sealCtx.fillStyle = outline ? palette.seal : palette.sealText;
  sealCtx.font = `${Math.round(size * 0.36)}px "${family}", serif`;
  sealCtx.textAlign = 'center';
  sealCtx.textBaseline = 'middle';
  sealCtx.fillText('枕', size / 2, size * 0.32);
  sealCtx.fillText('书', size / 2, size * 0.7);
  // Wear: knock out small specks so the stamp looks pressed, not printed.
  const random = noteCardRandom(42);
  sealCtx.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < size * 1.6; index += 1) {
    sealCtx.globalAlpha = 0.25 + random() * 0.6;
    sealCtx.beginPath();
    sealCtx.arc(random() * size, random() * size, random() * size * 0.012 + 0.4, 0, Math.PI * 2);
    sealCtx.fill();
  }
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(-0.04);
  ctx.drawImage(seal, -size / 2, -size / 2);
  ctx.restore();
}

function noteCardCoverColor(title) {
  // Traditional binding cloths: indigo, ink blue, dark red, pine, ochre.
  const colors = ['#2F3E55', '#283444', '#6E2F2A', '#33493C', '#7A5A32'];
  let hash = 0;
  for (const char of String(title || '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function paintNoteCardCover(ctx, image, book, { x, y, width, height, family }) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = noteCardCoverColor(book.title);
  ctx.fillRect(x, y, width, height);
  ctx.restore();
  if (image) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sw = width / scale;
    const sh = height / scale;
    ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, width, height);
    return;
  }
  // No cover: a thread-bound book — stitches on the left, a title slip on the right.
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
  ctx.lineWidth = Math.max(1, width * 0.012);
  const spine = x + width * 0.12;
  ctx.beginPath();
  ctx.moveTo(spine, y);
  ctx.lineTo(spine, y + height);
  ctx.stroke();
  for (let index = 1; index <= 4; index += 1) {
    const stitchY = y + (height * index) / 5;
    ctx.beginPath();
    ctx.moveTo(x, stitchY);
    ctx.lineTo(spine, stitchY);
    ctx.stroke();
  }
  const chars = [...String(book.title || '').replace(/[\s《》]+/g, '')].slice(0, 7);
  const charSize = Math.round(width * 0.15);
  const slipWidth = charSize * 1.5;
  const slipHeight = Math.min(height * 0.82, charSize * (chars.length + 0.8));
  const slipX = x + width * 0.88 - slipWidth;
  const slipY = y + height * 0.08;
  ctx.fillStyle = '#F3ECDD';
  ctx.fillRect(slipX, slipY, slipWidth, slipHeight);
  ctx.strokeStyle = 'rgba(60, 50, 40, .5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(slipX + 3, slipY + 3, slipWidth - 6, slipHeight - 6);
  ctx.fillStyle = '#2F2A22';
  ctx.font = `${charSize}px "${family}", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = (slipHeight - charSize * 0.8) / Math.max(1, chars.length);
  chars.forEach((char, index) => {
    ctx.fillText(char, slipX + slipWidth / 2, slipY + charSize * 0.4 + step * (index + 0.5));
  });
  ctx.restore();
}

/* ---------- Text pieces ---------- */

const NOTE_CARD_DIGITS = '〇一二三四五六七八九';

function noteCardChineseNumber(value) {
  if (value < 10) return NOTE_CARD_DIGITS[value];
  if (value < 20) return `十${value % 10 ? NOTE_CARD_DIGITS[value % 10] : ''}`;
  return `${NOTE_CARD_DIGITS[Math.floor(value / 10)]}十${value % 10 ? NOTE_CARD_DIGITS[value % 10] : ''}`;
}

/** 2026-10-02 → 二〇二六年十月二日 */
function noteCardDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = [...String(date.getFullYear())].map((digit) => NOTE_CARD_DIGITS[Number(digit)]).join('');
  return `${year}年${noteCardChineseNumber(date.getMonth() + 1)}月${noteCardChineseNumber(date.getDate())}日`;
}

function noteCardBookTitle(title) {
  const clean = String(title || '').trim();
  if (!clean) return '';
  return /^《.*》$/.test(clean) ? clean : `《${clean}》`;
}

function noteCardFit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  while (chars.length && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}

/* ---------- Rendering ---------- */

async function loadNoteCardFont(fontKey, texts) {
  const { family } = NOTE_CARD_FONTS[fontKey] || NOTE_CARD_FONTS['source-serif'];
  if (typeof ensureReaderFontStylesheets === 'function') ensureReaderFontStylesheets(fontKey);
  if (!document.fonts?.load) return;
  const sample = [...new Set(texts.join(''))].join('');
  const loading = document.fonts.load(`40px "${family}"`, sample || '枕书');
  const timeout = new Promise((resolve) => setTimeout(resolve, 8000));
  await Promise.race([loading.catch(() => null), timeout]);
}

function loadNoteCardImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image.naturalWidth ? image : null);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function noteCardTexts(note, prefs) {
  const book = note.book || {};
  return {
    quote: String(note.text || '').trim(),
    thought: prefs.thought ? String(note.thought || '').trim() : '',
    chapter: ['正文', '其他'].includes(String(note.chapter || '').trim()) ? '' : String(note.chapter || '').trim(),
    title: prefs.book ? noteCardBookTitle(book.title) : '',
    author: prefs.book ? String(book.author || '').trim() : '',
    date: prefs.date ? noteCardDate(note.createdAt) : ''
  };
}

/**
 * Draws one note card. Returns the canvas; `canvas.noteCard` tells whether
 * the quote had to be shortened to fit the chosen shape.
 */
async function renderNoteCard(note, options = {}) {
  const prefs = { ...NOTE_CARD_DEFAULTS, ...options };
  const [width, height] = NOTE_CARD_RATIOS[prefs.ratio] || NOTE_CARD_RATIOS['3:4'];
  const palette = NOTE_CARD_PALETTES[prefs.template] || NOTE_CARD_PALETTES.paper;
  const { family } = NOTE_CARD_FONTS[prefs.font] || NOTE_CARD_FONTS['source-serif'];
  const texts = noteCardTexts(note, prefs);
  const book = note.book || {};
  const wantsCover = prefs.cover && prefs.book;
  const [, cover] = await Promise.all([
    loadNoteCardFont(prefs.font, [...Object.values(texts), '枕书“…', book.title || '']),
    wantsCover ? loadNoteCardImage(book.coverUrl) : Promise.resolve(null)
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const font = (size) => `${size}px "${family}", serif`;
  const measureAt = (size) => {
    ctx.font = font(size);
    const cache = new Map();
    return (text) => {
      if (!cache.has(text)) cache.set(text, ctx.measureText(text).width);
      return cache.get(text);
    };
  };

  paintNoteCardBackground(ctx, width, height, palette, prefs.template);
  paintNoteCardFrame(ctx, width, height, palette, prefs.template);

  const wide = width > height;
  const margin = wide ? 132 : 128;
  const sealSize = wide ? 104 : 96;
  const hasBookInfo = Boolean(texts.title || texts.author);
  const showCover = wantsCover && hasBookInfo;

  // Body area and the side/foot reserved for the book.
  let body;
  if (wide) {
    const side = 400;
    const gutter = 110;
    const sideX = width - margin - side;
    body = { x: margin, y: margin + 8, width: sideX - gutter - margin, height: height - margin * 2 - 16 };
    paintNoteCardSide(ctx, { x: sideX, y: margin, width: side, height: height - margin * 2, gutter }, { texts, palette, family, cover, book, showCover, sealSize });
  } else {
    const footHeight = showCover ? 168 : (hasBookInfo || texts.date ? 104 : sealSize);
    const footY = height - margin - footHeight + 10;
    body = { x: margin, y: margin + 8, width: width - margin * 2, height: footY - 64 - margin - 8 };
    paintNoteCardFoot(ctx, { x: margin, y: footY, width: width - margin * 2, height: footHeight }, { texts, palette, family, cover, book, showCover, sealSize });
  }

  // Chapter: a small spaced line at the top of the body.
  if (texts.chapter) {
    ctx.font = font(26);
    ctx.fillStyle = palette.muted;
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '4px';
    ctx.fillText(noteCardFit(ctx, texts.chapter, body.width), body.x, body.y);
    ctx.letterSpacing = '0px';
    body.y += 74;
    body.height -= 74;
  }

  const sizes = wide ? [62, 30] : width === height ? [56, 28] : [60, 30];
  const layout = layoutNoteCardBody(measureAt, {
    quote: texts.quote || texts.thought,
    thought: texts.quote ? texts.thought : '',
    width: body.width,
    height: body.height,
    maxSize: sizes[0],
    minSize: sizes[1]
  });
  // Short passages sit a little above the middle; long ones start at the top.
  const top = body.y + Math.max(0, (body.height - layout.height) * 0.42);

  if (palette.mark) {
    ctx.save();
    ctx.font = font(Math.round(layout.size * 4.2));
    ctx.fillStyle = palette.mark;
    ctx.textBaseline = 'top';
    // Behind the start of the first line, reaching into the margin.
    ctx.fillText('“', body.x - layout.size * 1.25, top - layout.size * 0.95);
    ctx.restore();
  }
  if (prefs.template === 'letter') {
    // Ruled lines under every quote line, like writing on a letter sheet.
    ctx.save();
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 1;
    for (let index = 0; index < layout.quoteLines.length; index += 1) {
      const lineY = Math.round(top + (index + 1) * layout.size * 1.78) - 0.5;
      ctx.beginPath();
      ctx.moveTo(body.x, lineY);
      ctx.lineTo(body.x + body.width, lineY);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.font = font(layout.size);
  drawNoteCardLines(ctx, layout.quoteLines, { x: body.x, y: top, width: body.width, size: layout.size, lineHeight: 1.78, color: palette.text });

  if (layout.thoughtLines.length) {
    const thoughtTop = top + layout.quoteHeight + layout.size * 1.4;
    const accent = prefs.template === 'letter'
      ? (NOTE_CARD_HIGHLIGHT_COLORS[note.color] || palette.seal)
      : palette.rule;
    ctx.fillStyle = accent;
    ctx.fillRect(body.x, thoughtTop - layout.size * 0.7, 56, 3);
    ctx.font = font(layout.thoughtSize);
    drawNoteCardLines(ctx, layout.thoughtLines, { x: body.x, y: thoughtTop, width: body.width, size: layout.thoughtSize, lineHeight: 1.72, color: palette.muted });
  }

  canvas.noteCard = { truncated: layout.truncated, size: layout.size, width, height };
  return canvas;
}

function paintNoteCardFoot(ctx, box, { texts, palette, family, cover, book, showCover, sealSize }) {
  // A hairline with a small diamond in the middle.
  const ruleY = box.y - 36;
  ctx.save();
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(box.x, ruleY);
  ctx.lineTo(box.x + box.width / 2 - 14, ruleY);
  ctx.moveTo(box.x + box.width / 2 + 14, ruleY);
  ctx.lineTo(box.x + box.width, ruleY);
  ctx.stroke();
  ctx.fillStyle = palette.rule;
  ctx.translate(box.x + box.width / 2, ruleY);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();

  const sealY = box.y + box.height - sealSize;
  paintNoteCardSeal(ctx, box.x + box.width - sealSize, sealY, sealSize, palette, family);

  let textX = box.x;
  if (showCover) {
    paintNoteCardCover(ctx, cover, book, { x: box.x, y: box.y, width: 118, height: 164, family });
    textX += 118 + 34;
  }
  const textWidth = box.x + box.width - sealSize - 32 - textX;
  const lines = [];
  if (texts.title) lines.push({ text: texts.title, size: 36, color: palette.text });
  const sub = [texts.author, texts.date].filter(Boolean).join('  ·  ');
  if (sub) lines.push({ text: sub, size: 26, color: palette.muted });
  const total = lines.reduce((sum, line) => sum + line.size * 1.6, 0);
  let lineY = box.y + box.height - total - (showCover ? 8 : 4);
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = `${line.size}px "${family}", serif`;
    ctx.fillStyle = line.color;
    ctx.fillText(noteCardFit(ctx, line.text, textWidth), textX, lineY);
    lineY += line.size * 1.6;
  }
}

function paintNoteCardSide(ctx, box, { texts, palette, family, cover, book, showCover, sealSize }) {
  // Vertical hairline between passage and book.
  const ruleX = box.x - box.gutter / 2;
  ctx.save();
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ruleX, box.y + 30);
  ctx.lineTo(ruleX, box.y + box.height - 30);
  ctx.stroke();
  ctx.restore();

  const centerX = box.x + box.width / 2;
  const coverWidth = 210;
  const coverHeight = 292;
  const lines = [];
  if (texts.title) lines.push({ text: texts.title, size: 38, color: palette.text });
  if (texts.author) lines.push({ text: texts.author, size: 28, color: palette.muted });
  if (texts.date) lines.push({ text: texts.date, size: 26, color: palette.muted });
  const linesHeight = lines.reduce((sum, line) => sum + line.size * 1.7, 0);
  const blockHeight = (showCover ? coverHeight + 48 : 0) + linesHeight;
  let y = box.y + Math.max(0, (box.height - sealSize - 40 - blockHeight) / 2);
  if (showCover) {
    paintNoteCardCover(ctx, cover, book, { x: centerX - coverWidth / 2, y, width: coverWidth, height: coverHeight, family });
    y += coverHeight + 48;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = `${line.size}px "${family}", serif`;
    ctx.fillStyle = line.color;
    ctx.fillText(noteCardFit(ctx, line.text, box.width), centerX, y);
    y += line.size * 1.7;
  }
  ctx.textAlign = 'left';
  paintNoteCardSeal(ctx, centerX - sealSize / 2, box.y + box.height - sealSize, sealSize, palette, family);
}

/* ---------- Long image: several notes of one book ---------- */

const NOTE_LONG_WIDTH = 1080;
const NOTE_LONG_MARGIN = 128;
// Pages are cut between notes once a picture would pass this height; phones
// refuse to draw or share much taller canvases.
const NOTE_LONG_PAGE_HEIGHT = 8000;
const NOTE_LONG_MAX_QUOTE_LINES = 90;
const NOTE_LONG_MAX_THOUGHT_LINES = 36;

function paintNoteCardDivider(ctx, x, y, width, palette) {
  ctx.save();
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width / 2 - 14, y);
  ctx.moveTo(x + width / 2 + 14, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
  ctx.fillStyle = palette.rule;
  ctx.translate(x + width / 2, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
}

function noteCardCapLines(lines, max, measure, width) {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const ellipsis = { text: '……', width: measure('……') };
  const units = kept[max - 1].units.slice();
  while (units.length && units.reduce((sum, unit) => sum + unit.width, 0) + ellipsis.width > width) units.pop();
  kept[max - 1] = { units: [...units, ellipsis], last: true };
  return kept;
}

/** The pieces of a long image, each `{ height, draw(ctx, top) }`. */
function noteLongBlocks(ctx, { book, notes }, prefs, { palette, family, cover }) {
  const width = NOTE_LONG_WIDTH - NOTE_LONG_MARGIN * 2;
  const x = NOTE_LONG_MARGIN;
  const centerX = NOTE_LONG_WIDTH / 2;
  const measureAt = (size) => {
    ctx.font = `${size}px "${family}", serif`;
    const cache = new Map();
    return (text) => {
      if (!cache.has(text)) cache.set(text, ctx.measureText(text).width);
      return cache.get(text);
    };
  };
  const centered = (ctx, text, size, color, top) => {
    ctx.font = `${size}px "${family}", serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(noteCardFit(ctx, text, width), centerX, top);
    ctx.textAlign = 'left';
  };
  const blocks = [];

  // Header: cover, title, author, counts.
  const title = noteCardBookTitle(book.title) || '书摘';
  const titleLines = noteCardCapLines(noteCardBreakLines(measureAt(52), title, width), 2, measureAt(52), width);
  const thoughts = notes.filter((note) => String(note.thought || '').trim()).length;
  const counts = [`${notes.length} 条书摘`, prefs.thought && thoughts ? `${thoughts} 条想法` : ''].filter(Boolean).join(' · ');
  const showCover = prefs.cover;
  blocks.push({
    height: (showCover ? 280 + 56 : 0) + titleLines.length * 52 * 1.5 + (book.author ? 30 * 1.9 : 0) + 26 * 1.8 + 96,
    draw(ctx, top) {
      let y = top;
      if (showCover) {
        paintNoteCardCover(ctx, cover, book, { x: centerX - 100, y, width: 200, height: 280, family });
        y += 280 + 56;
      }
      ctx.font = `${52}px "${family}", serif`;
      drawNoteCardLines(ctx, titleLines, { x, y, width, size: 52, lineHeight: 1.5, color: palette.text, align: 'center' });
      y += titleLines.length * 52 * 1.5;
      if (book.author) {
        centered(ctx, book.author, 30, palette.muted, y + 8);
        y += 30 * 1.9;
      }
      centered(ctx, counts, 26, palette.faint, y + 8);
      y += 26 * 1.8;
      paintNoteCardDivider(ctx, x, y + 52, width, palette);
    }
  });

  const quoteSize = 40;
  const thoughtSize = 30;
  const accent = (note) => (prefs.template === 'letter'
    ? (NOTE_CARD_HIGHLIGHT_COLORS[note.color] || palette.seal)
    : palette.rule);
  let lastChapter = null;
  notes.forEach((note, index) => {
    const chapter = String(note.chapter || '').trim();
    if (chapter && !['正文', '其他'].includes(chapter) && chapter !== lastChapter) {
      blocks.push({
        height: 120,
        draw(ctx, top) {
          ctx.font = `28px "${family}", serif`;
          ctx.letterSpacing = '4px';
          const label = noteCardFit(ctx, chapter, width - 160);
          const labelWidth = ctx.measureText(label).width;
          ctx.fillStyle = palette.muted;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, centerX, top + 60);
          ctx.textAlign = 'left';
          ctx.letterSpacing = '0px';
          ctx.strokeStyle = palette.rule;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(centerX - labelWidth / 2 - 72, top + 60);
          ctx.lineTo(centerX - labelWidth / 2 - 24, top + 60);
          ctx.moveTo(centerX + labelWidth / 2 + 24, top + 60);
          ctx.lineTo(centerX + labelWidth / 2 + 72, top + 60);
          ctx.stroke();
        }
      });
    }
    if (chapter) lastChapter = chapter;

    const quote = String(note.text || '').trim();
    const thought = prefs.thought ? String(note.thought || '').trim() : '';
    const quoteLines = quote
      ? noteCardCapLines(noteCardBreakLines(measureAt(quoteSize), quote, width), NOTE_LONG_MAX_QUOTE_LINES, measureAt(quoteSize), width)
      : [];
    const thoughtLines = thought
      ? noteCardCapLines(noteCardBreakLines(measureAt(thoughtSize), thought, width), NOTE_LONG_MAX_THOUGHT_LINES, measureAt(thoughtSize), width)
      : [];
    const date = prefs.date ? noteCardDate(note.createdAt) : '';
    const quoteHeight = quoteLines.length * quoteSize * 1.78;
    const thoughtHeight = thoughtLines.length ? (quoteLines.length ? 44 : 0) + thoughtLines.length * thoughtSize * 1.72 : 0;
    const dateHeight = date ? 52 : 0;
    const gap = index < notes.length - 1 ? 88 : 24;
    if (!quoteLines.length && !thoughtLines.length) return;
    blocks.push({
      height: 24 + quoteHeight + thoughtHeight + dateHeight + gap,
      draw(ctx, top) {
        let y = top + 24;
        if (quoteLines.length) {
          if (prefs.template === 'letter') {
            ctx.save();
            ctx.strokeStyle = palette.rule;
            ctx.lineWidth = 1;
            for (let line = 0; line < quoteLines.length; line += 1) {
              const lineY = Math.round(y + (line + 1) * quoteSize * 1.78) - 0.5;
              ctx.beginPath();
              ctx.moveTo(x, lineY);
              ctx.lineTo(x + width, lineY);
              ctx.stroke();
            }
            ctx.restore();
          } else {
            // A short highlight-coloured stroke in the margin marks each passage.
            ctx.fillStyle = NOTE_CARD_HIGHLIGHT_COLORS[note.color] || palette.rule;
            ctx.globalAlpha = 0.75;
            ctx.fillRect(x - 30, y + quoteSize * 0.5, 4, quoteSize * 1.1);
            ctx.globalAlpha = 1;
          }
          ctx.font = `${quoteSize}px "${family}", serif`;
          drawNoteCardLines(ctx, quoteLines, { x, y, width, size: quoteSize, lineHeight: 1.78, color: palette.text });
          y += quoteHeight;
        }
        if (thoughtLines.length) {
          if (quoteLines.length) {
            y += 44;
            ctx.fillStyle = accent(note);
            ctx.fillRect(x, y - 14, 44, 3);
          }
          ctx.font = `${thoughtSize}px "${family}", serif`;
          drawNoteCardLines(ctx, thoughtLines, { x, y, width, size: thoughtSize, lineHeight: 1.72, color: palette.muted });
          y += thoughtLines.length * thoughtSize * 1.72;
        }
        if (date) {
          ctx.font = `22px "${family}", serif`;
          ctx.fillStyle = palette.faint;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';
          ctx.fillText(date, x + width, y + 18);
          ctx.textAlign = 'left';
        }
        if (index < notes.length - 1) {
          // Three small dots between passages.
          ctx.fillStyle = palette.faint;
          const dotY = top + this.height - gap / 2 + 6;
          for (const offset of [-18, 0, 18]) {
            ctx.beginPath();
            ctx.arc(centerX + offset, dotY, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });
  });

  // Foot: the seal and when the picture was made.
  const made = noteCardDate(new Date().toISOString());
  blocks.push({
    height: 72 + 96 + 64,
    draw(ctx, top) {
      paintNoteCardDivider(ctx, x, top + 24, width, palette);
      paintNoteCardSeal(ctx, centerX - 48, top + 72, 96, palette, family);
      centered(ctx, `枕书 · ${made}`, 22, palette.faint, top + 72 + 96 + 24);
    }
  });
  return blocks;
}

/**
 * Draws several notes of one book as a tall picture, split into pages of at
 * most NOTE_LONG_PAGE_HEIGHT between notes. Returns the page canvases.
 */
async function renderNotesLongImage({ book = {}, notes = [] }, options = {}) {
  const prefs = { ...NOTE_CARD_DEFAULTS, ...options };
  const palette = NOTE_CARD_PALETTES[prefs.template] || NOTE_CARD_PALETTES.paper;
  const { family } = NOTE_CARD_FONTS[prefs.font] || NOTE_CARD_FONTS['source-serif'];
  const texts = notes.flatMap((note) => [note.text || '', prefs.thought ? note.thought || '' : '', note.chapter || '']);
  const [, cover] = await Promise.all([
    loadNoteCardFont(prefs.font, [...texts, book.title || '', book.author || '', '《》枕书条书摘想法·……〇一二三四五六七八九十年月日续']),
    prefs.cover ? loadNoteCardImage(book.coverUrl) : Promise.resolve(null)
  ]);

  const measuring = document.createElement('canvas').getContext('2d');
  const blocks = noteLongBlocks(measuring, { book, notes }, prefs, { palette, family, cover });
  const top = 150;
  const continuedTop = 190;
  const bottom = 130;
  const pages = [];
  let page = [];
  let used = 0;
  for (const block of blocks) {
    const room = NOTE_LONG_PAGE_HEIGHT - (pages.length ? continuedTop : top) - bottom;
    if (page.length && used + block.height > room) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(block);
    used += block.height;
  }
  if (page.length) pages.push(page);

  const title = noteCardBookTitle(book.title) || '书摘';
  return pages.map((blocksOnPage, index) => {
    const pageTop = index ? continuedTop : top;
    const height = Math.ceil(pageTop + blocksOnPage.reduce((sum, block) => sum + block.height, 0) + bottom);
    const canvas = document.createElement('canvas');
    canvas.width = NOTE_LONG_WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    paintNoteCardBackground(ctx, NOTE_LONG_WIDTH, height, palette, prefs.template);
    paintNoteCardFrame(ctx, NOTE_LONG_WIDTH, height, palette, prefs.template);
    ctx.font = `22px "${family}", serif`;
    ctx.fillStyle = palette.faint;
    ctx.textBaseline = 'top';
    if (index) {
      ctx.textAlign = 'center';
      ctx.fillText(`${title} · 续`, NOTE_LONG_WIDTH / 2, 110);
    }
    if (pages.length > 1) {
      ctx.textAlign = 'center';
      ctx.fillText(`${index + 1} / ${pages.length}`, NOTE_LONG_WIDTH / 2, height - 100);
    }
    ctx.textAlign = 'left';
    let y = pageTop;
    for (const block of blocksOnPage) {
      block.draw(ctx, y);
      y += block.height;
    }
    canvas.noteCard = { page: index + 1, pages: pages.length, width: NOTE_LONG_WIDTH, height };
    return canvas;
  });
}

/* ---------- Saving ---------- */

function noteCardFileName(book, { kind = '', page = 0 } = {}) {
  const title = String(book?.title || '书摘').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30) || '书摘';
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `枕书-${title}${kind ? `-${kind}` : ''}-${stamp}${page ? `-${page}` : ''}.png`;
}

function noteCardBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片生成失败'))), 'image/png');
  });
}

function noteCardCanShare() {
  const phone = typeof isMobileReaderSurface === 'function' && isMobileReaderSurface();
  return phone && typeof navigator.canShare === 'function' && typeof File === 'function';
}

function downloadNoteCardBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Shares (phones) or downloads the pictures; several pages keep their order. */
async function saveNoteCardImages(canvases, names) {
  const blobs = await Promise.all(canvases.map(noteCardBlob));
  if (noteCardCanShare()) {
    const files = blobs.map((blob, index) => new File([blob], names[index], { type: 'image/png' }));
    if (navigator.canShare({ files })) {
      try {
        await navigator.share({ files });
        return 'shared';
      } catch (error) {
        if (error?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  for (let index = 0; index < blobs.length; index += 1) {
    if (index) await new Promise((resolve) => setTimeout(resolve, 350));
    downloadNoteCardBlob(blobs[index], names[index]);
  }
  return 'downloaded';
}

async function copyNoteCardImage(canvas) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': noteCardBlob(canvas) })]);
}

/* ---------- Dialog ---------- */

const noteCardDialogState = { dialog: null, sequence: 0 };

function noteCardElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function noteCardHint(message) {
  if (typeof showHighlightHint === 'function') showHighlightHint(message);
}

function noteCardSegment(label, name, choices, prefs, onChange) {
  const group = noteCardElement('div', 'note-card-group');
  group.appendChild(noteCardElement('span', 'note-card-group-label', label));
  const options = noteCardElement('div', 'note-card-segment');
  options.setAttribute('role', 'radiogroup');
  options.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const button = noteCardElement('button', 'note-card-option', text);
    button.type = 'button';
    button.dataset[name] = value;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(prefs[name] === value));
    button.addEventListener('click', () => {
      prefs[name] = value;
      options.querySelectorAll('button').forEach((item) => item.setAttribute('aria-checked', String(item === button)));
      onChange();
    });
    options.appendChild(button);
  }
  group.appendChild(options);
  return group;
}

/**
 * The shared picture dialog: preview on the left, choices on the right.
 * `render(prefs)` returns the canvases; `names(canvases)` their file names.
 */
function openNoteCardShell({ heading, label, ratios, toggles, render, describe, names, long = false }) {
  closeNoteCardDialog();
  const prefs = readNoteCardPrefs();
  const dialog = noteCardElement('dialog', `note-card-dialog${long ? ' is-long' : ''}`);
  dialog.setAttribute('aria-labelledby', 'noteCardTitle');

  const header = noteCardElement('header', 'note-card-header');
  const title = noteCardElement('h2', 'note-card-title', heading);
  title.id = 'noteCardTitle';
  const close = noteCardElement('button', 'ui-close note-card-close', '关闭');
  close.type = 'button';
  close.setAttribute('aria-label', `关闭${heading}`);
  close.addEventListener('click', closeNoteCardDialog);
  header.append(title, close);

  const preview = noteCardElement('div', 'note-card-preview');
  preview.setAttribute('aria-busy', 'true');
  const status = noteCardElement('p', 'note-card-status', '正在生成…');
  status.setAttribute('role', 'status');

  const draw = async () => {
    saveNoteCardPrefs(prefs);
    const sequence = ++noteCardDialogState.sequence;
    preview.setAttribute('aria-busy', 'true');
    let canvases;
    try {
      canvases = await render(prefs);
    } catch (error) {
      if (sequence !== noteCardDialogState.sequence) return;
      status.textContent = `生成失败：${error.message || '请重试'}`;
      preview.removeAttribute('aria-busy');
      return;
    }
    if (sequence !== noteCardDialogState.sequence || !dialog.isConnected) return;
    canvases.forEach((canvas, index) => {
      canvas.className = 'note-card-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', canvases.length > 1 ? `${label} 第 ${index + 1} 张` : label);
    });
    preview.replaceChildren(...canvases);
    preview.removeAttribute('aria-busy');
    status.textContent = describe(canvases);
    dialog.noteCardCanvases = canvases;
    if (copy) copy.hidden = canvases.length !== 1;
  };

  const controls = noteCardElement('div', 'note-card-controls');
  controls.append(
    noteCardSegment('模板', 'template', Object.entries(NOTE_CARD_TEMPLATES), prefs, draw),
    noteCardSegment('字体', 'font', Object.entries(NOTE_CARD_FONTS).map(([key, value]) => [key, value.label]), prefs, draw)
  );
  if (ratios) controls.appendChild(noteCardSegment('比例', 'ratio', Object.keys(NOTE_CARD_RATIOS).map((key) => [key, key]), prefs, draw));
  if (toggles.length) {
    const group = noteCardElement('div', 'note-card-group');
    group.appendChild(noteCardElement('span', 'note-card-group-label', '显示'));
    const row = noteCardElement('div', 'note-card-toggles');
    for (const key of toggles) {
      const button = noteCardElement('button', 'note-card-toggle', NOTE_CARD_TOGGLES[key]);
      button.type = 'button';
      button.dataset.toggle = key;
      button.setAttribute('aria-pressed', String(prefs[key]));
      button.addEventListener('click', () => {
        prefs[key] = !prefs[key];
        button.setAttribute('aria-pressed', String(prefs[key]));
        void draw();
      });
      row.appendChild(button);
    }
    group.appendChild(row);
    controls.appendChild(group);
  }

  const actions = noteCardElement('div', 'note-card-actions');
  let copy = null;
  if (typeof ClipboardItem === 'function' && navigator.clipboard?.write && !noteCardCanShare()) {
    copy = noteCardElement('button', 'note-card-secondary', '复制图片');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const [canvas] = dialog.noteCardCanvases || [];
      if (!canvas) return;
      try {
        await copyNoteCardImage(canvas);
        noteCardHint('图片已复制');
      } catch {
        noteCardHint('复制失败，请改用保存图片');
      }
    });
    actions.appendChild(copy);
  }
  const save = noteCardElement('button', 'note-card-primary', noteCardCanShare() ? '分享 / 保存' : '保存图片');
  save.type = 'button';
  save.addEventListener('click', async () => {
    const canvases = dialog.noteCardCanvases;
    if (!canvases?.length) return;
    save.disabled = true;
    try {
      const result = await saveNoteCardImages(canvases, names(canvases));
      if (result === 'downloaded') noteCardHint(canvases.length > 1 ? `已保存 ${canvases.length} 张图片` : '图片已保存');
    } catch (error) {
      noteCardHint(`保存失败：${error.message || '请重试'}`);
    } finally {
      save.disabled = false;
    }
  });
  actions.appendChild(save);

  const layout = noteCardElement('div', 'note-card-layout');
  const side = noteCardElement('div', 'note-card-side');
  side.append(controls, status, actions);
  layout.append(preview, side);
  dialog.append(header, layout);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeNoteCardDialog();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeNoteCardDialog();
  });
  document.body.appendChild(dialog);
  noteCardDialogState.dialog = dialog;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  void draw();
  return dialog;
}

/**
 * Opens the card dialog for one note:
 * { id, text, thought, color, chapter, createdAt, book: { title, author, coverUrl } }
 */
function openNoteCardDialog(note) {
  const hasThought = Boolean(String(note.thought || '').trim());
  return openNoteCardShell({
    heading: '书摘卡片',
    label: `书摘卡片预览：${String(note.text || note.thought || '').slice(0, 40)}`,
    ratios: true,
    toggles: Object.keys(NOTE_CARD_TOGGLES).filter((key) => key !== 'thought' || hasThought),
    render: async (prefs) => [await renderNoteCard(note, prefs)],
    describe: ([canvas]) => (canvas.noteCard.truncated
      ? '摘录较长，卡片里只放得下前面一部分；换成 3:4 能放下更多。'
      : ''),
    names: () => [noteCardFileName(note.book)]
  });
}

/** Several notes of one book (in reading order) as one tall picture. */
function openNotesLongImageDialog({ book = {}, notes = [] }) {
  const hasThought = notes.some((note) => String(note.thought || '').trim());
  return openNoteCardShell({
    heading: '书摘长图',
    label: `书摘长图预览：${book.title || ''}，${notes.length} 条`,
    ratios: false,
    long: true,
    toggles: ['thought', 'date', 'cover'].filter((key) => key !== 'thought' || hasThought),
    render: (prefs) => renderNotesLongImage({ book, notes }, prefs),
    describe: (canvases) => (canvases.length > 1
      ? `${notes.length} 条书摘较长，已按笔记分成 ${canvases.length} 张图片，保存时依次存下。`
      : `${notes.length} 条书摘，一张图片。`),
    names: (canvases) => canvases.map((canvas, index) => noteCardFileName(book, {
      kind: '书摘长图',
      page: canvases.length > 1 ? index + 1 : 0
    }))
  });
}

function closeNoteCardDialog() {
  const dialog = noteCardDialogState.dialog;
  noteCardDialogState.dialog = null;
  noteCardDialogState.sequence += 1;
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  dialog.remove();
}

/** From the reader: the saved note with its chapter and book, then the dialog. */
async function openNoteCardForAnnotation(bookId, annotationId, fallback = {}, overrides = {}) {
  let note = null;
  try {
    const doc = await window.browserHost.getBookNotes(bookId);
    const found = doc.notes.find((item) => item.id === annotationId);
    if (found) note = { ...found, book: doc.book, ...overrides };
  } catch { /* fall back to what the reader has */ }
  if (!note) note = { ...fallback, ...overrides, id: annotationId, book: fallback.book || {} };
  if (!String(note.text || note.thought || '').trim()) {
    noteCardHint('这条笔记没有可以做成卡片的文字');
    return null;
  }
  return openNoteCardDialog(note);
}

window.__zhenshuNoteCard = { renderNoteCard, renderNotesLongImage, noteCardBreakLines, layoutNoteCardBody, noteCardDate };
