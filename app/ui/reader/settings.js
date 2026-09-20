/* BabyReader UI module: reader/settings */

'use strict';

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
  instance.options.forEach((item) => {
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
    if (event.key === 'Escape') closeAllCustomSelects();
  });
  window.addEventListener('resize', () => {
    customSelectInstances.forEach(positionCustomSelectMenu);
  });
  document.addEventListener('scroll', () => {
    customSelectInstances.forEach(positionCustomSelectMenu);
  }, true);
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
  trigger.setAttribute('aria-label', wrapper.previousElementSibling?.textContent?.trim() || select.id);
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
  document.querySelectorAll('.settings-panel select')
    .forEach(setupCustomSelect);
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
  setupCustomSelects();
  [theme, fontFamily, readingMode, highlightColor].forEach(syncCustomSelectValue);
}


function setupThemeToggle() {
  applyTheme(state.theme, false);
}

function setupTocToggle() {
  // The legacy btnToc ID is retained, while activation is delegated through readerActions.
}

function setupSettingsPanel() {
  setupCustomSelects();
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
