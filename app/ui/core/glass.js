'use strict';

/* global state, applyTheme, persistUserSettings, syncSettingsPanel */

/*
 * 液态玻璃 (optional theme, off by default). Floating chrome turns to glass
 * over an ambient light; content stays solid. The ambient light is either
 * taken from the 继续阅读 cover or a very pale iOS blue.
 *
 * Cover colours: draw the cover at 40×60, bucket similar pixels (skipping
 * grey, white and black ones: titles, badges), keep the biggest buckets with
 * clearly different hues, fit them to the theme and write --amb-1/2/3. The
 * variables are registered as <color> in CSS, so a new book glides in.
 */

const GLASS_AMBIENT_CACHE_KEY = 'zhenshu-glass-ambient';
const GLASS_AMBIENT_CACHE_LIMIT = 60;
const GLASS_UNIFORM_AMBIENT = Object.freeze({
  // System blue's hue (#007AFF, 211°): barely there on light, deep on dark.
  light: ['hsl(211 100% 91% / .7)', 'hsl(211 100% 94% / .7)', 'hsl(211 90% 92% / .6)'],
  dark: ['hsl(211 55% 20% / .9)', 'hsl(211 45% 17% / .9)', 'hsl(211 50% 19% / .85)']
});

const glassAmbient = {
  book: null,
  cover: null,
  palette: null,
  sequence: 0
};

function glassEnabled() {
  return state.liquidGlass === true;
}

function glassAmbientMode() {
  return state.glassAmbient === 'uniform' ? 'uniform' : 'cover';
}

// Lensing bends the backdrop through an SVG filter, which only Chromium
// applies to backdrop-filter; Safari and Firefox get plain frosted glass.
function glassLensSupported() {
  const agent = navigator.userAgent || '';
  return /Chrome\/|Edg\//.test(agent) && !/Firefox\//.test(agent);
}

function readGlassAmbientCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(GLASS_AMBIENT_CACHE_KEY) || '{}');
    return cache && typeof cache === 'object' && cache.books && typeof cache.books === 'object' ? cache : { books: {} };
  } catch {
    return { books: {} };
  }
}

function writeGlassAmbientCache(cache) {
  const ids = Object.keys(cache.books);
  if (ids.length > GLASS_AMBIENT_CACHE_LIMIT) {
    ids.sort((left, right) => (cache.books[left].at || 0) - (cache.books[right].at || 0))
      .slice(0, ids.length - GLASS_AMBIENT_CACHE_LIMIT)
      .forEach((id) => { delete cache.books[id]; });
  }
  try { localStorage.setItem(GLASS_AMBIENT_CACHE_KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}

/* ---------- Colour extraction ---------- */

function glassRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Up to three [h, s, l] colours that dominate the pixels, most common first. */
function glassDominantColours(pixels) {
  const buckets = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const [, saturation, lightness] = glassRgbToHsl(r, g, b);
    if (saturation < 0.18 || lightness < 0.08 || lightness > 0.92) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .map((bucket) => glassRgbToHsl(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count));
  const picked = [];
  for (const colour of ranked) {
    const distinct = picked.every((other) => {
      const hue = Math.abs(other[0] - colour[0]);
      return Math.min(hue, 360 - hue) > 12 || Math.abs(other[2] - colour[2]) > 0.14;
    });
    if (distinct) picked.push(colour);
    if (picked.length === 3) break;
  }
  // Too few distinct colours: the main hue, softer — never a hue the cover lacks.
  while (picked.length && picked.length < 3) picked.push([picked[0][0], picked[0][1] * 0.7, picked[0][2]]);
  return picked.map(([h, s, l]) => [Math.round(h), Math.round(s * 100) / 100, Math.round(l * 100) / 100]);
}

function glassFitColour([h, s, l], tone) {
  return tone === 'dark'
    ? `hsl(${h} ${Math.round(Math.min(s, 0.6) * 100)}% ${Math.round(Math.min(Math.max(l, 0.2), 0.3) * 100)}% / .9)`
    : `hsl(${h} ${Math.round(Math.min(s, 0.7) * 100)}% ${Math.round(Math.max(l, 0.8) * 100)}% / .6)`;
}

function glassCoverKey(book, cover) {
  if (book?.coverUrl) return `url:${book.coverUrl}`;
  return `tone:${cover?.dataset?.coverTone ?? ''}`;
}

function loadedGlassImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve(image);
  return new Promise((resolve) => {
    image.addEventListener('load', () => resolve(image.naturalWidth ? image : null), { once: true });
    image.addEventListener('error', () => resolve(null), { once: true });
  });
}

/** Pixels of the cover at 40×60: the image, or the generated cover's gradient. */
async function glassCoverPixels(book, cover) {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 60;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let source = cover instanceof HTMLImageElement ? cover : null;
  if (!source && cover instanceof HTMLCanvasElement) source = cover;
  if (!source && book?.coverUrl) {
    const image = new Image();
    image.src = book.coverUrl;
    source = image;
  }
  if (source instanceof HTMLImageElement) source = await loadedGlassImage(source);
  if (source) {
    ctx.drawImage(source, 0, 0, 40, 60);
  } else if (cover) {
    const style = getComputedStyle(cover);
    const from = style.getPropertyValue('--cover-a').trim();
    const to = style.getPropertyValue('--cover-b').trim();
    if (!from || !to) return null;
    const gradient = ctx.createLinearGradient(0, 0, 40, 60);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 40, 60);
  } else {
    return null;
  }
  try {
    return ctx.getImageData(0, 0, 40, 60).data;
  } catch {
    return null; // a cross-origin cover taints the canvas
  }
}

/* ---------- Painting ---------- */

function paintGlassAmbient() {
  const root = document.documentElement;
  if (!glassEnabled()) {
    for (const index of [1, 2, 3]) root.style.removeProperty(`--amb-${index}`);
    return;
  }
  const tone = state.theme === 'dark' ? 'dark' : 'light';
  let colours;
  if (glassAmbientMode() === 'uniform') {
    colours = GLASS_UNIFORM_AMBIENT[tone];
  } else {
    const palette = glassAmbient.palette || readGlassAmbientCache().last?.palette;
    colours = Array.isArray(palette) && palette.length
      ? palette.map((colour) => glassFitColour(colour, tone))
      : GLASS_UNIFORM_AMBIENT[tone];
  }
  colours.forEach((colour, index) => root.style.setProperty(`--amb-${index + 1}`, colour));
}

async function refreshGlassCoverPalette() {
  const { book, cover } = glassAmbient;
  if (!book || !glassEnabled() || glassAmbientMode() !== 'cover') return;
  const sequence = ++glassAmbient.sequence;
  const cache = readGlassAmbientCache();
  const key = glassCoverKey(book, cover);
  const cached = cache.books[book.id];
  let palette = cached?.key === key ? cached.palette : null;
  if (!palette) {
    const pixels = await glassCoverPixels(book, cover);
    if (sequence !== glassAmbient.sequence) return;
    palette = pixels ? glassDominantColours(pixels) : [];
  }
  if (!palette.length) return;
  glassAmbient.palette = palette;
  cache.books[book.id] = { key, palette, at: Date.now() };
  cache.last = { bookId: book.id, palette };
  writeGlassAmbientCache(cache);
  paintGlassAmbient();
}

/**
 * The 继续阅读 book (and its cover element, already on the page) sets the
 * ambient light. Cheap when glass is off: the book is remembered only.
 */
function setGlassAmbientBook(book, cover = null) {
  if (!book?.id) return;
  const same = glassAmbient.book?.id === book.id && glassCoverKey(glassAmbient.book, glassAmbient.cover) === glassCoverKey(book, cover);
  glassAmbient.book = book;
  glassAmbient.cover = cover;
  if (same && glassAmbient.palette) return;
  glassAmbient.palette = null;
  void refreshGlassCoverPalette();
}

/** Applies the saved preference: root attributes, then the light. */
function applyGlass() {
  const root = document.documentElement;
  root.dataset.glass = glassEnabled() ? 'on' : 'off';
  root.dataset.glassAmbient = glassAmbientMode();
  root.dataset.glassLens = glassLensSupported() ? 'on' : 'off';
  paintGlassAmbient();
  if (glassEnabled() && glassAmbientMode() === 'cover' && !glassAmbient.palette) void refreshGlassCoverPalette();
}

function setLiquidGlass(on) {
  state.liquidGlass = Boolean(on);
  applyGlass();
  if (typeof syncSettingsPanel === 'function') syncSettingsPanel();
  syncLibraryAppearanceMenu();
  if (typeof persistUserSettings === 'function') persistUserSettings();
}

function setGlassAmbient(mode) {
  state.glassAmbient = mode === 'uniform' ? 'uniform' : 'cover';
  applyGlass();
  if (typeof syncSettingsPanel === 'function') syncSettingsPanel();
  syncLibraryAppearanceMenu();
  if (typeof persistUserSettings === 'function') persistUserSettings();
}

/* ---------- 外观 menu on the shelf ---------- */

let libraryAppearanceMenu = null;

function glassMenuElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function glassMenuSegment(label, name, choices) {
  const row = glassMenuElement('div', 'glass-menu-row');
  const title = glassMenuElement('span', 'glass-menu-label', label);
  title.id = `glassMenu-${name}`;
  const group = glassMenuElement('div', 'glass-menu-segment');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', title.id);
  for (const [value, text] of choices) {
    const button = glassMenuElement('button', '', text);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset[name] = value;
    group.appendChild(button);
  }
  row.append(title, group);
  return row;
}

function ensureLibraryAppearanceMenu() {
  if (libraryAppearanceMenu) return libraryAppearanceMenu;
  const menu = glassMenuElement('div', 'glass-menu zs-glass zs-glass-lens');
  menu.id = 'libraryAppearanceMenu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '外观');
  menu.hidden = true;
  const toggleRow = glassMenuElement('label', 'glass-menu-row glass-menu-switch');
  const toggleText = glassMenuElement('span', 'glass-menu-label', '液态玻璃');
  const toggle = glassMenuElement('input', 'glass-switch');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  toggle.id = 'libraryLiquidGlass';
  toggle.addEventListener('change', () => setLiquidGlass(toggle.checked));
  toggleRow.append(toggleText, toggle);
  const ambient = glassMenuSegment('背景光', 'glassAmbient', [['cover', '取自封面'], ['uniform', '淡蓝']]);
  ambient.classList.add('glass-menu-ambient');
  ambient.addEventListener('click', (event) => {
    const choice = event.target.closest?.('[data-glass-ambient]');
    if (choice) setGlassAmbient(choice.dataset.glassAmbient);
  });
  const theme = glassMenuSegment('主题', 'themeChoice', [['light', '浅色'], ['sepia', '护眼'], ['dark', '深色']]);
  theme.addEventListener('click', (event) => {
    const choice = event.target.closest?.('[data-theme-choice]');
    if (!choice || typeof applyTheme !== 'function') return;
    applyTheme(choice.dataset.themeChoice);
    paintGlassAmbient();
    if (typeof syncSettingsPanel === 'function') syncSettingsPanel();
    syncLibraryAppearanceMenu();
    if (typeof persistUserSettings === 'function') persistUserSettings();
  });
  const hint = glassMenuElement('p', 'glass-menu-hint', '侧边栏、工具条和菜单变成半透明的玻璃；背景光取自“继续阅读”的封面，或用很淡的蓝色。');
  menu.append(theme, toggleRow, ambient, hint);
  document.body.appendChild(menu);
  libraryAppearanceMenu = menu;
  return menu;
}

function syncLibraryAppearanceMenu() {
  const menu = libraryAppearanceMenu;
  if (!menu) return;
  menu.querySelector('#libraryLiquidGlass').checked = glassEnabled();
  menu.querySelectorAll('[data-glass-ambient]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.glassAmbient === glassAmbientMode()));
    button.disabled = !glassEnabled();
  });
  menu.querySelector('.glass-menu-ambient').classList.toggle('is-disabled', !glassEnabled());
  menu.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.themeChoice === state.theme));
  });
}

function closeLibraryAppearanceMenu({ restoreFocus = false } = {}) {
  const button = document.getElementById('btnLibraryAppearance');
  if (!libraryAppearanceMenu || libraryAppearanceMenu.hidden) return;
  libraryAppearanceMenu.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button?.focus();
}

function openLibraryAppearanceMenu() {
  const button = document.getElementById('btnLibraryAppearance');
  const menu = ensureLibraryAppearanceMenu();
  syncLibraryAppearanceMenu();
  menu.hidden = false;
  button?.setAttribute('aria-expanded', 'true');
  const rect = button?.getBoundingClientRect();
  if (rect) {
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
  }
  menu.querySelector('input, button')?.focus({ preventScroll: true });
}

function setupLibraryAppearance() {
  const button = document.getElementById('btnLibraryAppearance');
  if (!button || button.dataset.glassBound) return;
  button.dataset.glassBound = 'true';
  button.addEventListener('click', () => {
    if (libraryAppearanceMenu && !libraryAppearanceMenu.hidden) closeLibraryAppearanceMenu();
    else openLibraryAppearanceMenu();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!libraryAppearanceMenu || libraryAppearanceMenu.hidden) return;
    if (event.target.closest?.('#libraryAppearanceMenu, #btnLibraryAppearance')) return;
    closeLibraryAppearanceMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && libraryAppearanceMenu && !libraryAppearanceMenu.hidden) {
      event.preventDefault();
      closeLibraryAppearanceMenu({ restoreFocus: true });
    }
  });
  window.addEventListener('resize', () => closeLibraryAppearanceMenu());
}

if (typeof window !== 'undefined') {
  window.__zhenshuGlass = { applyGlass, setGlassAmbientBook, glassDominantColours, glassFitColour, state: glassAmbient };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { glassDominantColours, glassFitColour, glassRgbToHsl };
}
