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
