/* 枕书 UI module: reader/settings */

'use strict';

const DEFAULT_TEXT_INDENT = 2;

const TYPOGRAPHY_SLIDER_CONFIG = Object.freeze({
  paragraphSpacing: Object.freeze({
    presets: Object.freeze([0.4, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]),
    defaultValue: 1.1,
    format: (value) => `${Number(value).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}em`
  }),
  fontSize: Object.freeze({
    presets: Object.freeze([83, 100, 111, 122, 133, 144, 156, 167]),
    defaultValue: 100,
    format: (value) => `${Math.round(Number(value) / 100 * 18)}px`
  }),
  lineHeight: Object.freeze({
    presets: Object.freeze([1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6]),
    defaultValue: 1.9,
    format: (value) => Number(value).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')
  }),
  pageMargin: Object.freeze({
    presets: Object.freeze([8, 16, 24, 32, 40, 48, 64, 80, 96]),
    defaultValue: 40,
    format: (value) => `${Math.round(Number(value))}px`
  })
});

function nearestTypographyPreset(key, rawValue) {
  const config = TYPOGRAPHY_SLIDER_CONFIG[key];
  if (!config) return Number(rawValue) || 0;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return config.presets[0];
  return config.presets.reduce((nearest, candidate) => (
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest
  ), config.presets[0]);
}

function formatTypographySliderValue(key, rawValue) {
  const config = TYPOGRAPHY_SLIDER_CONFIG[key];
  if (!config) return String(rawValue ?? '');
  return config.format(Number(rawValue));
}

function resetTypographySettings() {
  zoomLevel = TYPOGRAPHY_SLIDER_CONFIG.fontSize.defaultValue;
  state.lineHeight = TYPOGRAPHY_SLIDER_CONFIG.lineHeight.defaultValue;
  state.pageMargin = TYPOGRAPHY_SLIDER_CONFIG.pageMargin.defaultValue;
  state.textIndent = DEFAULT_TEXT_INDENT;
  state.paragraphSpacing = TYPOGRAPHY_SLIDER_CONFIG.paragraphSpacing.defaultValue;
  applyZoom();
  applyTypography();
  syncSettingsPanel();
  persistUserSettings();
}

function renderTypographySliderTicks(key, input) {
  const config = TYPOGRAPHY_SLIDER_CONFIG[key];
  const track = input?.closest('.settings-range-track');
  if (!config || !track || track.querySelector('.settings-range-ticks')) return;
  const min = Number(input.min);
  const max = Number(input.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;

  const ticks = document.createElement('span');
  ticks.className = 'settings-range-ticks';
  ticks.setAttribute('aria-hidden', 'true');
  config.presets.forEach((preset) => {
    const tick = document.createElement('i');
    const progress = Math.max(0, Math.min(100, ((preset - min) / (max - min)) * 100));
    tick.className = 'settings-range-tick';
    tick.style.left = `${progress}%`;
    ticks.appendChild(tick);
  });
  track.appendChild(ticks);
}

function updateTypographySliderHint(key, rawValue, visible = true) {
  const input = document.querySelector(`[data-typography-slider="${key}"]`);
  if (!input) return;
  const output = document.getElementById(`${input.id}Value`);
  if (!output) return;
  output.textContent = formatTypographySliderValue(key, rawValue);
  output.hidden = !visible;
  input.closest('.settings-range-field')?.classList.toggle('is-showing-value', visible);
}

function syncTypographySliderAccessibility(key, rawValue) {
  const input = document.querySelector(`[data-typography-slider="${key}"]`);
  if (!input) return;
  const value = Number(rawValue);
  const min = Number(input.min);
  const max = Number(input.max);
  const progress = Number.isFinite(value) && max > min
    ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
    : 0;
  input.style.setProperty('--range-progress', `${progress}%`);
  input.closest('.settings-range-track')?.style.setProperty('--range-progress', `${progress}%`);
  input.setAttribute('aria-valuetext', formatTypographySliderValue(key, rawValue));
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

// Links the bundled stylesheets of the chosen reading font, once each. Faces
// are unicode-range slices, so only the characters on screen are fetched.
function readerFontStylesheetUrls(fontFamily) {
  return (FONT_STYLESHEETS[fontFamily] || []).map((folder) =>
    new URL(`vendor/fonts/${folder}/font.css?v=1`, document.baseURI).href);
}

function ensureReaderFontStylesheets(fontFamily) {
  for (const href of readerFontStylesheetUrls(fontFamily)) {
    if (document.querySelector(`link[data-reader-font][href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.readerFont = '';
    document.head.appendChild(link);
  }
}

/* P0 typography: text indent, paragraph spacing, font family */
function applyTypography() {
  // 原书 leaves every paragraph to the book; a number sets body paragraphs.
  const indent = normalizeTextIndent(state.textIndent);
  document.documentElement.dataset.textIndent = String(indent);
  document.documentElement.style.setProperty('--reader-text-indent', indent === 'book' ? '0em' : `${indent}em`);
  document.documentElement.style.setProperty('--reader-para-spacing', `${state.paragraphSpacing}em`);
  const stack = FONT_STACKS[state.fontFamily] || FONT_STACKS[DEFAULT_READER_FONT];
  ensureReaderFontStylesheets(state.fontFamily);
  document.documentElement.style.setProperty('--reader-font-family', stack);
  // A new font changes how wide leading spaces are: measure the body
  // paragraphs again (the setting itself is pure CSS).
  const article = document.getElementById('article');
  if (article && typeof classifyParagraphIndents === 'function'
      && (state.contentType === 'epub' ? article.querySelector('.epub-chapter') : article.dataset.textKind === 'txt')) {
    classifyParagraphIndents(article);
  }
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

/*
 * Native select popovers are owned by the operating system, so their radius,
 * selected color, and placement vary across platforms. Keep the native
 * element as the value/event source, but render a small app-owned menu for a
 * consistent reader surface.
 */
const customSelectInstances = new Set();
let customSelectGlobalEventsReady = false;

function syncCustomSelectValue(select) {
  const instance = select?._customSelect;
  if (!instance) return;
  const option = select.options[select.selectedIndex];
  instance.trigger.textContent = option?.textContent || '';
  instance.trigger.disabled = select.disabled;
  instance.options.forEach((item) => {
    const nativeOption = [...select.options].find((entry) => entry.value === item.dataset.value);
    if (nativeOption) item.textContent = nativeOption.textContent;
    item.disabled = select.disabled || Boolean(nativeOption?.disabled);
    const selected = item.dataset.value === select.value;
    item.setAttribute('aria-selected', String(selected));
    item.classList.toggle('is-selected', selected);
  });
}

function closeCustomSelect(instance) {
  if (!instance) return;
  instance.wrapper.classList.remove('is-open');
  instance.trigger.setAttribute('aria-expanded', 'false');
  instance.menu.hidden = true;
}

function closeAllCustomSelects(except = null) {
  customSelectInstances.forEach((instance) => {
    if (instance !== except) closeCustomSelect(instance);
  });
  // Also sweep the DOM so an old instance cannot leave a portal visible after
  // a panel rerender or a repeated app-shell initialization.
  document.querySelectorAll('.custom-select-menu').forEach((menu) => {
    const instance = [...customSelectInstances].find((candidate) => candidate.menu === menu);
    if (instance === except) return;
    menu.hidden = true;
    instance?.wrapper.classList.remove('is-open');
    instance?.trigger.setAttribute('aria-expanded', 'false');
  });
}

function isCustomSelectVisible(instance) {
  if (!instance?.wrapper?.isConnected || !instance.trigger?.isConnected) return false;
  if (instance.wrapper.closest('[hidden]')) return false;
  return instance.trigger.getClientRects().length > 0;
}

function positionCustomSelectMenu(instance) {
  if (!instance || instance.menu.hidden) return;
  // A menu is rendered in the document body, while its trigger belongs to a
  // drawer panel. If that panel has been hidden, its rectangle becomes 0,0;
  // retaining the portal would otherwise create an orphan menu at top-left.
  if (!isCustomSelectVisible(instance)) {
    closeCustomSelect(instance);
    return;
  }
  const rect = instance.trigger.getBoundingClientRect();
  instance.menu.style.left = `${Math.round(rect.left)}px`;
  instance.menu.style.top = `${Math.round(rect.bottom + 6)}px`;
  instance.menu.style.width = `${Math.max(136, Math.round(rect.width))}px`;
  instance.menu.style.maxHeight = `${Math.max(96, Math.round(window.innerHeight - rect.bottom - 16))}px`;
}

function openCustomSelect(instance) {
  pruneCustomSelects();
  if (!isCustomSelectVisible(instance)) {
    closeAllCustomSelects();
    return false;
  }
  closeAllCustomSelects(instance);
  instance.menu.hidden = false;
  instance.wrapper.classList.add('is-open');
  instance.trigger.setAttribute('aria-expanded', 'true');
  positionCustomSelectMenu(instance);
  return !instance.menu.hidden;
}

function setupCustomSelectGlobalEvents() {
  if (customSelectGlobalEventsReady) return;
  customSelectGlobalEventsReady = true;
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target instanceof Element && (
      target.closest('.custom-select') || target.closest('.custom-select-menu')
    )) return;
    closeAllCustomSelects();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && [...customSelectInstances].some((item) => !item.menu.hidden)) {
      event.preventDefault();
      closeAllCustomSelects();
    }
  });
  window.addEventListener('resize', () => {
    customSelectInstances.forEach(positionCustomSelectMenu);
  });
  document.addEventListener('scroll', () => {
    customSelectInstances.forEach(positionCustomSelectMenu);
  }, true);
}

// Pages that rebuild their controls (书库 pages) leave old menus behind. Pruned
// when a menu opens: by then every select on screen is in the document, while
// at setup time a page may still be assembling its cards off-document.
function pruneCustomSelects() {
  customSelectInstances.forEach((instance) => {
    if (instance.wrapper.isConnected) return;
    instance.menu.remove();
    customSelectInstances.delete(instance);
  });
}

function setupCustomSelect(select) {
  if (!select || select._customSelect) return select?._customSelect;
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  wrapper.dataset.customSelectFor = select.id;
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || wrapper.previousElementSibling?.textContent?.trim() || select.id);
  wrapper.insertBefore(trigger, select);

  const menu = document.createElement('div');
  menu.id = `custom-options-${select.id}`;
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  document.body.appendChild(menu);

  const instance = { select, wrapper, trigger, menu, options: [] };
  select._customSelect = instance;
  select.classList.add('custom-select-native');
  select.tabIndex = -1;

  Array.from(select.options).forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-select-option';
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.setAttribute('role', 'option');
    item.tabIndex = -1;
    item.addEventListener('click', () => {
      select.value = option.value;
      syncCustomSelectValue(select);
      closeCustomSelect(instance);
      trigger.focus();
      // Let the browser paint the closed menu and the new trigger value before
      // a setting change can perform EPUB reflow or pagination measurement.
      setTimeout(() => {
        if (select.value !== option.value) return;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, 0);
    });
    menu.appendChild(item);
    instance.options.push(item);
  });

  trigger.addEventListener('click', () => {
    if (menu.hidden) openCustomSelect(instance);
    else closeCustomSelect(instance);
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      // Never allow a trigger inside a hidden drawer panel to reopen its
      // body-level portal through a stale keyboard focus target.
      if (!isCustomSelectVisible(instance)) return;
      event.preventDefault();
      if (openCustomSelect(instance)) {
        instance.options[select.selectedIndex]?.focus();
      }
    }
  });
  select.addEventListener('change', () => {
    syncCustomSelectValue(select);
  });
  menu.addEventListener('keydown', (event) => {
    const currentIndex = instance.options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCustomSelect(instance);
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(instance.options.length - 1, currentIndex + offset));
      instance.options[nextIndex]?.focus();
    } else if (event.key === 'Enter' && currentIndex >= 0) {
      event.preventDefault();
      instance.options[currentIndex].click();
    }
  });

  customSelectInstances.add(instance);
  syncCustomSelectValue(select);
  setupCustomSelectGlobalEvents();
  return instance;
}

function setupCustomSelects() {
  // Theme and font are chosen with swatches and font cards; their native
  // selects stay unseen as the source of truth.
  [...document.querySelectorAll('#readerPanelSettings select, #notesSort')]
    .filter((select) => !select.closest('.settings-native-select'))
    .forEach(setupCustomSelect);
}

// Layout presets (WeChat Reading / Apple Books keep spacing to a few choices;
// the sliders stay under 自定义). 标准 is the reset defaults.
const LAYOUT_PRESETS = Object.freeze({
  compact: Object.freeze({ lineHeight: 1.6, paragraphSpacing: 0.5, pageMargin: 24 }),
  standard: Object.freeze({ lineHeight: 1.9, paragraphSpacing: 1.1, pageMargin: 40 }),
  loose: Object.freeze({ lineHeight: 2.2, paragraphSpacing: 1.5, pageMargin: 64 })
});

function activeLayoutPreset() {
  return Object.keys(LAYOUT_PRESETS).find((name) => {
    const preset = LAYOUT_PRESETS[name];
    return Math.abs(state.lineHeight - preset.lineHeight) < 0.001
      && Math.abs(state.paragraphSpacing - preset.paragraphSpacing) < 0.001
      && state.pageMargin === preset.pageMargin;
  }) || null;
}

function applyLayoutPreset(name) {
  const preset = LAYOUT_PRESETS[name];
  if (!preset) return false;
  state.lineHeight = preset.lineHeight;
  state.paragraphSpacing = preset.paragraphSpacing;
  state.pageMargin = preset.pageMargin;
  applyZoom();
  applyTypography();
  syncSettingsPanel();
  persistUserSettings();
  return true;
}

// A− / A+ walk the same size stops as the slider.
function stepFontSize(direction) {
  const stops = TYPOGRAPHY_SLIDER_CONFIG.fontSize.presets;
  const next = direction > 0
    ? stops.find((stop) => stop > zoomLevel)
    : [...stops].reverse().find((stop) => stop < zoomLevel);
  if (next === undefined) return false;
  zoomLevel = next;
  applyZoom();
  syncSettingsPanel();
  persistUserSettings();
  return true;
}

function chooseFromNativeSelect(select, value) {
  if (!select || select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

let _fontPreviewsLoaded = false;
function syncVisualSettingsControls() {
  const panel = document.getElementById('readerPanelSettings');
  if (!panel) return;
  if (!_fontPreviewsLoaded) {
    // Each card previews its own face; only the "Aa 永" glyph slices load.
    _fontPreviewsLoaded = true;
    for (const name of Object.keys(FONT_STYLESHEETS)) ensureReaderFontStylesheets(name);
    panel.querySelectorAll('[data-font-choice]').forEach((button) => {
      const sample = button.querySelector('.settings-font-sample');
      if (sample) sample.style.fontFamily = FONT_STACKS[button.dataset.fontChoice] || '';
    });
  }
  panel.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.theme));
  });
  panel.querySelectorAll('[data-font-choice]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.fontChoice === state.fontFamily));
  });
  const preset = activeLayoutPreset();
  panel.querySelectorAll('[data-layout-preset]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.layoutPreset === preset));
  });
  const stops = TYPOGRAPHY_SLIDER_CONFIG.fontSize.presets;
  const label = document.getElementById('settingFontSizeLabel');
  if (label) label.textContent = TYPOGRAPHY_SLIDER_CONFIG.fontSize.format(zoomLevel);
  const smaller = document.getElementById('btnFontSmaller');
  const larger = document.getElementById('btnFontLarger');
  if (smaller) smaller.disabled = !stops.some((stop) => stop < zoomLevel);
  if (larger) larger.disabled = !stops.some((stop) => stop > zoomLevel);
}

function syncSettingsPanel() {
  const settingsPanel = document.getElementById('readerPanelSettings');
  const format = state.contentType === 'pdf' ? 'pdf' : 'reflow';
  if (settingsPanel && settingsPanel.dataset.contentFormat !== format) {
    closeAllCustomSelects();
    settingsPanel.dataset.contentFormat = format;
  }
  document.querySelectorAll('#readerPanelSettings [data-pdf-inapplicable]')
    .forEach((field) => { field.hidden = format === 'pdf'; });
  document.querySelectorAll('#readerPanelSettings [data-pdf-only]')
    .forEach((field) => { field.hidden = format !== 'pdf'; });
  const theme = document.getElementById('settingTheme');
  const fontSize = document.getElementById('settingFontSize');
  const lineHeight = document.getElementById('settingLineHeight');
  const pageMargin = document.getElementById('settingPageMargin');
  const highlightColor = document.getElementById('settingHighlightColor');
  const readingMode = document.getElementById('settingReadingMode');
  const pdfLayoutMode = document.getElementById('settingPdfLayoutMode');
  const tocOpen = document.getElementById('settingTocOpen');
  const fontFamily = document.getElementById('settingFontFamily');
  const textIndent = document.getElementById('settingTextIndent');
  const paragraphSpacing = document.getElementById('settingParagraphSpacing');
  const settingsUser = document.getElementById('settingsUser');

  if (theme) theme.value = state.theme;
  syncVisualSettingsControls();
  if (fontSize) {
    fontSize.value = String(zoomLevel);
    syncTypographySliderAccessibility('fontSize', zoomLevel);
    updateTypographySliderHint('fontSize', zoomLevel, false);
  }
  if (lineHeight) {
    lineHeight.value = String(state.lineHeight);
    syncTypographySliderAccessibility('lineHeight', state.lineHeight);
    updateTypographySliderHint('lineHeight', state.lineHeight, false);
  }
  if (pageMargin) {
    pageMargin.value = String(state.pageMargin);
    syncTypographySliderAccessibility('pageMargin', state.pageMargin);
    updateTypographySliderHint('pageMargin', state.pageMargin, false);
  }
  if (highlightColor) highlightColor.value = state.highlightColor;
  if (readingMode) {
    // The same two modes, named the way phones name them.
    const phone = typeof isMobileReaderSurface === 'function' && isMobileReaderSurface();
    const labels = phone ? { scroll: '上下滚动', double: '左右翻页' } : { scroll: '连续滚动', double: '双页分页' };
    [...readingMode.options].forEach((option) => { option.textContent = labels[option.value] || option.textContent; });
    readingMode.value = state.readingMode;
    document.querySelectorAll('[data-reading-mode-choice]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.readingModeChoice === state.readingMode));
    });
  }
  if (pdfLayoutMode) pdfLayoutMode.value = state.pdfLayoutMode;
  const pdfPageColors = String(state.pdfPageColors === 'original' ? 'original' : 'theme');
  document.querySelectorAll('[data-pdf-page-colors]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.pdfPageColors === pdfPageColors));
  });
  if (fontFamily) fontFamily.value = state.fontFamily;
  if (textIndent) {
    const current = String(normalizeTextIndent(state.textIndent));
    textIndent.dataset.value = current;
    textIndent.querySelectorAll('[data-text-indent]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.textIndent === current));
    });
  }
  if (paragraphSpacing) {
    paragraphSpacing.value = String(state.paragraphSpacing);
    syncTypographySliderAccessibility('paragraphSpacing', state.paragraphSpacing);
    updateTypographySliderHint('paragraphSpacing', state.paragraphSpacing, false);
  }
  if (tocOpen) tocOpen.checked = state.tocOpen;
  if (settingsUser) {
    settingsUser.textContent = state.session
      ? `当前用户：${state.session.username || state.session.uid}`
      : '';
  }
  setupCustomSelects();
  [theme, fontFamily, readingMode, pdfLayoutMode, highlightColor].forEach(syncCustomSelectValue);
}


function setupThemeToggle() {
  applyTheme(state.theme, false);
}

function setupTocToggle() {
  // The legacy btnToc ID is retained, while activation is delegated through readerActions.
}

function setupTypographySlider(key, input, applyValue) {
  if (!input || input._typographySliderReady) return;
  input._typographySliderReady = true;
  renderTypographySliderTicks(key, input);

  const showHint = () => {
    updateTypographySliderHint(key, input.value, true);
    clearTimeout(input._typographyHintTimer);
    input._typographyHintTimer = setTimeout(() => {
      updateTypographySliderHint(key, input.value, false);
    }, 800);
  };

  input.addEventListener('input', () => {
    applyValue(Number(input.value));
    syncTypographySliderAccessibility(key, input.value);
    syncSettingsPanel();
    showHint();
  });

  input.addEventListener('change', () => {
    const snappedValue = nearestTypographyPreset(key, input.value);
    input.value = String(snappedValue);
    applyValue(snappedValue);
    syncTypographySliderAccessibility(key, snappedValue);
    syncSettingsPanel();
    updateTypographySliderHint(key, snappedValue, true);
    clearTimeout(input._typographyHintTimer);
    input._typographyHintTimer = setTimeout(() => {
      updateTypographySliderHint(key, snappedValue, false);
    }, 800);
    persistUserSettings();
  });

  input.addEventListener('pointerdown', showHint);
  input.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      showHint();
    }
  });
  input.addEventListener('blur', () => {
    clearTimeout(input._typographyHintTimer);
    updateTypographySliderHint(key, input.value, false);
  });
}

function setupSettingsPanel() {
  setupCustomSelects();
  const theme = document.getElementById('settingTheme');
  const fontSize = document.getElementById('settingFontSize');
  const lineHeight = document.getElementById('settingLineHeight');
  const pageMargin = document.getElementById('settingPageMargin');
  const highlightColor = document.getElementById('settingHighlightColor');
  const readingMode = document.getElementById('settingReadingMode');
  const pdfLayoutMode = document.getElementById('settingPdfLayoutMode');
  const tocOpen = document.getElementById('settingTocOpen');
  const fontFamily = document.getElementById('settingFontFamily');
  const textIndent = document.getElementById('settingTextIndent');
  const paragraphSpacing = document.getElementById('settingParagraphSpacing');
  const resetTypography = document.getElementById('btnResetTypography');
  theme?.addEventListener('change', () => {
    applyTheme(theme.value, false);
    syncSettingsPanel();
    persistUserSettings();
  });
  setupTypographySlider('fontSize', fontSize, (value) => {
    zoomLevel = Math.max(60, Math.min(200, Number(value) || 100));
    applyZoom();
  });
  setupTypographySlider('lineHeight', lineHeight, (value) => {
    state.lineHeight = Math.max(1.2, Math.min(2.6, Number(value) || 1.9));
    applyZoom();
  });
  setupTypographySlider('pageMargin', pageMargin, (value) => {
    state.pageMargin = Math.max(8, Math.min(96, Number(value) || 40));
    applyZoom();
  });
  highlightColor?.addEventListener('change', () => {
    state.highlightColor = ['yellow', 'green', 'blue', 'pink'].includes(highlightColor.value)
      ? highlightColor.value
      : 'yellow';
    if (state.contentType === 'pdf') {
      document.body.dataset.highlightColor = state.highlightColor;
    } else {
      applyZoom();
    }
    persistUserSettings();
  });
  readingMode?.addEventListener('change', () => {
    setReadingMode(readingMode.value);
  });
  document.getElementById('settingPdfPageColors')?.addEventListener('click', (event) => {
    const choice = event.target.closest?.('[data-pdf-page-colors]');
    if (!choice) return;
    const next = choice.dataset.pdfPageColors === 'original' ? 'original' : 'theme';
    if (next === state.pdfPageColors) return;
    state.pdfPageColors = next;
    if (typeof syncPdfPageColors === 'function') syncPdfPageColors();
    syncSettingsPanel();
    persistUserSettings();
  });
  pdfLayoutMode?.addEventListener('change', () => {
    if (state.contentType !== 'pdf'
        || !['continuous', 'single', 'double'].includes(pdfLayoutMode.value)
        || !window.pdfReaderController?.setLayoutMode(pdfLayoutMode.value)) return;
    state.pdfLayoutMode = pdfLayoutMode.value;
    syncSettingsPanel();
    persistUserSettings();
  });
  tocOpen?.addEventListener('change', () => {
    state.tocOpen = tocOpen.checked;
    updateTopbarState();
    persistUserSettings();
  });
  // P0 typography controls
  fontFamily?.addEventListener('change', () => {
    state.fontFamily = FONT_STACKS[fontFamily.value] ? fontFamily.value : DEFAULT_READER_FONT;
    applyTypography();
    syncSettingsPanel();
    persistUserSettings();
  });
  textIndent?.addEventListener('click', (event) => {
    const choice = event.target.closest?.('[data-text-indent]');
    if (!choice) return;
    const next = normalizeTextIndent(choice.dataset.textIndent);
    if (next === state.textIndent) return;
    state.textIndent = next;
    applyTypography();
    syncSettingsPanel();
    persistUserSettings();
  });
  setupTypographySlider('paragraphSpacing', paragraphSpacing, (value) => {
    state.paragraphSpacing = Math.max(0.4, Math.min(3, Number(value) || 1.1));
    applyTypography();
  });
  resetTypography?.addEventListener('click', resetTypographySettings);
  document.getElementById('btnFontSmaller')?.addEventListener('click', () => stepFontSize(-1));
  document.getElementById('btnFontLarger')?.addEventListener('click', () => stepFontSize(1));
  const settingsPanel = document.getElementById('readerPanelSettings');
  settingsPanel?.addEventListener('click', (event) => {
    const themeChoice = event.target.closest?.('[data-theme-choice]');
    if (themeChoice) return chooseFromNativeSelect(theme, themeChoice.dataset.themeChoice);
    const fontChoice = event.target.closest?.('[data-font-choice]');
    if (fontChoice) return chooseFromNativeSelect(fontFamily, fontChoice.dataset.fontChoice);
    const preset = event.target.closest?.('[data-layout-preset]');
    if (preset) applyLayoutPreset(preset.dataset.layoutPreset);
    return undefined;
  });

  syncSettingsPanel();
  applyContinuousScroll();
}
